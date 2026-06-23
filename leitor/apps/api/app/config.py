"""
Configuração central da API. Tudo via variáveis de ambiente com defaults
sensatos pra rodar local sem configurar nada.

Os caminhos de storage são resolvidos relativos à raiz do projeto (dois níveis
acima de apps/api), pra funcionar tanto rodando direto quanto no Docker.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


# raiz do monorepo: .../leitor  (este arquivo está em leitor/apps/api/app/config.py)
PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LEITOR_", env_file=".env")

    # Banco: SQLite por padrão (zero setup, perfeito pra single-user local).
    # Em produção/Docker, troque por postgresql+psycopg://... via env.
    database_url: str = f"sqlite:///{PROJECT_ROOT / 'leitor.db'}"

    # Redis para a fila ARQ
    redis_url: str = "redis://localhost:6379"

    # Onde ficam os PDFs originais e o canônico gerado
    storage_originals: Path = PROJECT_ROOT / "storage" / "originals"
    storage_canonical: Path = PROJECT_ROOT / "storage" / "canonical"

    # Idiomas padrão pro OCR (Tesseract)
    ocr_languages: str = "por+eng"

    # Origens permitidas pro navegador (CORS). O leitor web roda numa porta/host
    # diferente da API, então precisa ser autorizado explicitamente. Separe por
    # vírgula.
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost,http://127.0.0.1"

    # Regex de origens permitidas — usada pra liberar a faixa do Tailscale
    # (100.64.0.0/10, o range CGNAT que o Tailscale usa) em qualquer porta, sem
    # precisar saber o IP exato de antemão. Cobre 100.64.x.x a 100.127.x.x.
    # Pro caso single-user numa tailnet privada, isso é seguro: só quem está na
    # sua tailnet alcança esses IPs.
    cors_origin_regex: str = r"http://100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}(:\d+)?"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def ensure_dirs(self) -> None:
        self.storage_originals.mkdir(parents=True, exist_ok=True)
        self.storage_canonical.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.ensure_dirs()
    return s
