"""
Worker ARQ. Consome jobs da fila Redis e roda o pipeline de ingestão.

Por que ARQ e não Celery: async nativo (combina com FastAPI), retry/backoff
embutido, e leve — ideal pra single-user. Por que não BackgroundTasks do
FastAPI: aquilo roda no mesmo processo da API; um OCR de livro grande
bloquearia o servidor. ARQ roda num processo separado.

Fluxo do job:
    1. marca Book.status = PROCESSING
    2. chama ingest() (classify → OCR? → extract → clean → structure → emit)
    3. grava metadados do manifest e marca READY
    4. em erro: marca FAILED com a mensagem (ARQ ainda re-tenta conforme config)

Rodar:
    arq app.worker.WorkerSettings
"""

from __future__ import annotations

from datetime import datetime, timezone

from arq.connections import RedisSettings
from sqlmodel import Session

# o pacote ingest é importado direto — mesmo backend, mesma linguagem, sem ponte
from ingest import ingest

from .config import get_settings
from .db import engine
from .models import Book, BookStatus

settings = get_settings()


async def process_book(ctx: dict, book_id: str) -> None:
    """Job ARQ: processa um livro já gravado no banco com status PENDING."""
    with Session(engine) as session:
        book = session.get(Book, book_id)
        if book is None:
            return  # livro removido antes de processar; nada a fazer

        book.status = BookStatus.PROCESSING
        book.updated_at = datetime.now(timezone.utc)
        session.add(book)
        session.commit()
        session.refresh(book)

        try:
            result = ingest(
                pdf_path=book.original_path,
                out_dir=str(settings.storage_canonical),
                book_id=book.id,
                title=book.title,
                ocr_languages=settings.ocr_languages,
                mode=book.requested_mode,
            )
            m = result.manifest
            book.status = BookStatus.READY
            book.kind = result.kind
            book.used_ocr = result.used_ocr
            book.mode = result.mode
            book.error_message = None
            # o manifest difere entre modos: no texto, page_count vem em
            # m["source"]; no imagem, vem na raiz. Tratamos os dois.
            if result.mode == "image":
                book.page_count = m.get("page_count")
                book.block_count = None
            else:
                book.page_count = m["source"].get("page_count")
                book.block_count = m.get("block_count")
        except Exception as exc:  # noqa: BLE001 — queremos registrar qualquer falha
            book.status = BookStatus.FAILED
            book.error_message = str(exc)
            raise  # re-levanta pra ARQ contabilizar retry/backoff
        finally:
            book.updated_at = datetime.now(timezone.utc)
            session.add(book)
            session.commit()


class WorkerSettings:
    """Configuração do worker ARQ. `arq app.worker.WorkerSettings` lê isto."""

    functions = [process_book]
    max_tries = 3            # re-tenta até 3x (OCR pode falhar transitoriamente)
    job_timeout = 1800       # 30 min — OCR de livro grande é lento

    # ARQ espera `redis_settings` como ATRIBUTO contendo o RedisSettings, não um
    # método que o retorna. Construímos o valor uma vez, na definição da classe.
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
