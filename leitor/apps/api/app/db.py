"""
Setup do banco. Engine SQLModel + helper de sessão e criação de tabelas.

connect_args com check_same_thread=False é necessário pro SQLite quando usado
por FastAPI (múltiplas threads). Inofensivo pra outros bancos? Não — então só
aplicamos quando a URL é sqlite.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings

_settings = get_settings()

_connect_args = (
    {"check_same_thread": False}
    if _settings.database_url.startswith("sqlite")
    else {}
)

engine = create_engine(_settings.database_url, connect_args=_connect_args)


def init_db() -> None:
    # importa os modelos pra registrá-los no metadata antes de criar as tabelas
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
