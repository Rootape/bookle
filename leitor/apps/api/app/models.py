"""
Modelo de dados. Um único modelo `Book` cobre tudo que o leitor single-user
precisa: metadados, status de processamento e progresso de leitura.

O HTML canônico NÃO fica no banco — fica em disco (storage/canonical/<id>/).
O banco só guarda o ponteiro e os metadados, mantendo-o leve e o serviço de
leitura rápido (HTML servido como arquivo estático).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum

from sqlmodel import Field, SQLModel


class BookStatus(str, Enum):
    PENDING = "pending"        # upload recebido, aguardando processamento
    PROCESSING = "processing"  # worker está extraindo/OCR
    READY = "ready"            # canônico gerado, pronto pra ler
    FAILED = "failed"          # algo quebrou (ver error_message)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


class Book(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    title: str
    author: str | None = None
    status: BookStatus = Field(default=BookStatus.PENDING)

    # caminho do PDF original (em storage/originals)
    original_filename: str
    original_path: str

    # capa customizada enviada pelo usuário (em storage/canonical/<id>/cover.*).
    # Se ausente, a API cai pra página 0 do modo imagem (quando houver).
    cover_path: str | None = None

    # modo de importação escolhido no upload: "auto" | "text" | "image".
    # 'requested_mode' é o que o usuário pediu; 'mode' é o efetivo (resolvido
    # pelo pipeline, ex.: auto → text ou image).
    requested_mode: str = "auto"
    mode: str | None = None              # "text" | "image" (após processar)

    # preenchidos pelo worker após processar
    kind: str | None = None              # native / scanned / hybrid
    used_ocr: bool = False
    page_count: int | None = None
    block_count: int | None = None
    error_message: str | None = None

    # progresso de leitura: índice do bloco (modo texto) ou página (modo imagem)
    reading_position: int = 0

    # modo imagem: páginas marcadas como "normal" (sem negativo), guardadas como
    # JSON de uma lista de índices. Fica no backend pra seguir entre dispositivos
    # (desktop ↔ celular via Tailscale).
    normal_pages_json: str = "[]"

    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
