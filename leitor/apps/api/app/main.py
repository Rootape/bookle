"""
API FastAPI do leitor. Rotas essenciais pra single-user:

    POST   /books            upload de PDF → cria Book(pending) → enfileira job
    GET    /books            lista a biblioteca
    GET    /books/{id}       metadados + status de um livro
    GET    /books/{id}/content    HTML canônico (quando READY)
    PATCH  /books/{id}/progress   salva posição de leitura
    DELETE /books/{id}       remove livro (banco + arquivos)

O HTML canônico é lido do disco e servido como está — o leitor (Next.js) aplica
o próprio CSS por cima. O conteúdo é só semântica; a aparência é sempre a sua.
"""

from __future__ import annotations

import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
from pathlib import Path

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import Depends, FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from .config import get_settings
from .db import get_session, init_db
from .models import Book, BookStatus

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # pool Redis pra enfileirar jobs; guardado no estado do app
    app.state.redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    yield
    await app.state.redis.close()


app = FastAPI(title="Leitor", lifespan=lifespan)

# CORS: autoriza o leitor web (origem diferente: porta 3000) a chamar a API.
# Sem isto, o navegador bloqueia os fetch com NetworkError.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex,  # libera a faixa do Tailscale
    allow_methods=["*"],
    allow_headers=["*"],
)


def _touch(book: Book) -> None:
    book.updated_at = datetime.now(timezone.utc)


@app.post("/books", status_code=201)
async def upload_book(
    file: UploadFile,
    mode: str = "auto",
    session: Session = Depends(get_session),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Envie um arquivo .pdf")
    if mode not in ("auto", "text", "image"):
        raise HTTPException(400, "mode deve ser 'auto', 'text' ou 'image'")

    title = Path(file.filename).stem
    book = Book(
        title=title,
        original_filename=file.filename,
        original_path="",  # preenchido abaixo após saber o id
        requested_mode=mode,
    )

    # grava o PDF com o id do livro pra evitar colisão de nomes
    dest = settings.storage_originals / f"{book.id}.pdf"
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    book.original_path = str(dest)

    session.add(book)
    session.commit()
    session.refresh(book)

    # enfileira o processamento (worker ARQ pega daqui)
    await app.state.redis.enqueue_job("process_book", book.id)

    return book


@app.get("/books")
def list_books(session: Session = Depends(get_session)) -> list[Book]:
    return list(session.exec(select(Book).order_by(Book.created_at.desc())))


@app.get("/books/{book_id}")
def get_book(book_id: str, session: Session = Depends(get_session)) -> Book:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "Livro não encontrado")
    return book


@app.get("/books/{book_id}/content", response_class=HTMLResponse)
def get_content(book_id: str, session: Session = Depends(get_session)) -> str:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "Livro não encontrado")
    if book.status != BookStatus.READY:
        raise HTTPException(409, f"Livro ainda não está pronto (status: {book.status.value})")

    content_path = settings.storage_canonical / book.id / "content.html"
    if not content_path.exists():
        raise HTTPException(500, "Arquivo canônico ausente no disco")
    return content_path.read_text(encoding="utf-8")


@app.get("/books/{book_id}/manifest")
def get_manifest(book_id: str, session: Session = Depends(get_session)):
    """Manifest do livro. No modo imagem, contém a lista de páginas e quais são
    ilustração (não invertidas pelo negativo). O leitor usa isto pra paginar."""
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "Livro não encontrado")
    if book.status != BookStatus.READY:
        raise HTTPException(409, f"Livro ainda não está pronto (status: {book.status.value})")

    manifest_path = settings.storage_canonical / book.id / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(500, "Manifest ausente no disco")
    return JSONResponse(content=json.loads(manifest_path.read_text(encoding="utf-8")))


@app.get("/books/{book_id}/pages/{filename}")
def get_page_image(
    book_id: str, filename: str, session: Session = Depends(get_session)
):
    """Serve uma imagem de página (modo imagem). filename ex.: '0003.png'."""
    # validação simples do nome pra evitar path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Nome de arquivo inválido")

    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "Livro não encontrado")

    img_path = settings.storage_canonical / book.id / "pages" / filename
    if not img_path.exists():
        raise HTTPException(404, "Página não encontrada")
    return FileResponse(img_path, media_type="image/png")


@app.patch("/books/{book_id}/progress")
def save_progress(
    book_id: str, position: int, session: Session = Depends(get_session)
) -> Book:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "Livro não encontrado")
    book.reading_position = max(0, position)
    _touch(book)
    session.add(book)
    session.commit()
    session.refresh(book)
    return book


@app.put("/books/{book_id}/normal-pages")
def set_normal_pages(
    book_id: str, pages: list[int], session: Session = Depends(get_session)
) -> Book:
    """Define o conjunto completo de páginas marcadas como 'normal' (sem
    negativo) no modo imagem. O leitor envia a lista inteira a cada mudança.
    Guardado no backend pra sincronizar entre dispositivos."""
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "Livro não encontrado")
    # normaliza: únicos, ordenados, não-negativos
    clean = sorted({p for p in pages if isinstance(p, int) and p >= 0})
    book.normal_pages_json = json.dumps(clean)
    _touch(book)
    session.add(book)
    session.commit()
    session.refresh(book)
    return book


@app.delete("/books/{book_id}", status_code=204)
def delete_book(book_id: str, session: Session = Depends(get_session)) -> None:
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "Livro não encontrado")

    # remove arquivos: original + diretório canônico
    original = Path(book.original_path)
    if original.exists():
        original.unlink()
    canonical_dir = settings.storage_canonical / book.id
    if canonical_dir.exists():
        shutil.rmtree(canonical_dir)

    session.delete(book)
    session.commit()


class BookEdit(BaseModel):
    title: str | None = None
    author: str | None = None


@app.patch("/books/{book_id}")
def edit_book(
    book_id: str, edit: BookEdit, session: Session = Depends(get_session)
) -> Book:
    """Edita metadados do livro (título e/ou autor)."""
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "Livro não encontrado")
    if edit.title is not None:
        title = edit.title.strip()
        if not title:
            raise HTTPException(400, "Título não pode ser vazio")
        book.title = title
    if edit.author is not None:
        # string vazia limpa o autor
        book.author = edit.author.strip() or None
    _touch(book)
    session.add(book)
    session.commit()
    session.refresh(book)
    return book


@app.put("/books/{book_id}/cover", status_code=200)
async def upload_cover(
    book_id: str, file: UploadFile, session: Session = Depends(get_session)
) -> Book:
    """Sobe uma capa customizada (imagem). Sobrescreve a anterior se houver."""
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "Livro não encontrado")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Envie um arquivo de imagem")

    book_dir = settings.storage_canonical / book.id
    book_dir.mkdir(parents=True, exist_ok=True)
    # extensão a partir do content-type (png/jpeg/webp)
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(
        file.content_type, "png"
    )
    dest = book_dir / f"cover.{ext}"
    # remove capas antigas de outra extensão
    for old in book_dir.glob("cover.*"):
        old.unlink()
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    book.cover_path = str(dest)
    _touch(book)
    session.add(book)
    session.commit()
    session.refresh(book)
    return book


@app.get("/books/{book_id}/cover")
def get_cover(book_id: str, session: Session = Depends(get_session)):
    """Serve a capa do livro. Prioridade: capa customizada → página 0 do modo
    imagem → 404 (o front mostra um placeholder)."""
    book = session.get(Book, book_id)
    if book is None:
        raise HTTPException(404, "Livro não encontrado")

    # 1. capa customizada
    if book.cover_path and Path(book.cover_path).exists():
        return FileResponse(book.cover_path)

    # 2. página 0 do modo imagem
    if book.mode == "image":
        page0 = settings.storage_canonical / book.id / "pages" / "0000.png"
        if page0.exists():
            return FileResponse(page0, media_type="image/png")

    raise HTTPException(404, "Sem capa")
