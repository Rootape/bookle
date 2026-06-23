"""Pipeline de ingestão de PDFs para o formato canônico do leitor."""

from .pipeline import IngestResult, ingest

__all__ = ["ingest", "IngestResult"]
