"""
Classifica um PDF como 'native' (texto real) ou 'scanned' (imagem de páginas).

Heurística: amostramos algumas páginas e medimos a razão entre caracteres de
texto extraível e área de imagem. Um PDF nativo tem texto abundante; um
escaneado tem páginas que são essencialmente uma imagem grande e ~zero texto.

Há um terceiro caso real: PDFs "híbridos" (texto + páginas escaneadas no meio,
comum em livros com apêndices fotografados). Por isso retornamos também a lista
de páginas que parecem escaneadas, para o extrator decidir página a página.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

import fitz  # PyMuPDF


class PdfKind(str, Enum):
    NATIVE = "native"
    SCANNED = "scanned"
    HYBRID = "hybrid"


@dataclass
class Classification:
    kind: PdfKind
    page_count: int
    # índices (0-based) das páginas que parecem ser só imagem
    scanned_pages: list[int] = field(default_factory=list)
    # diagnóstico, útil pra debugar livros problemáticos
    avg_chars_per_page: float = 0.0


# Abaixo deste nº médio de caracteres por página, suspeitamos de escaneado.
# Uma página de livro nativo típica tem ~1500-3000 caracteres.
_CHARS_THRESHOLD = 100

# Quantas páginas amostrar no máximo pra classificação rápida (livros grandes).
_SAMPLE_SIZE = 12


def _sample_indices(page_count: int, sample_size: int) -> list[int]:
    """Amostra páginas distribuídas ao longo do livro, evitando capa/contracapa
    que frequentemente são imagem mesmo em PDFs nativos."""
    if page_count <= sample_size:
        return list(range(page_count))
    # pula a primeira e última (capas) e distribui o resto
    step = page_count / sample_size
    return [min(int(i * step), page_count - 1) for i in range(sample_size)]


def _page_is_scanned(page: fitz.Page) -> bool:
    text = page.get_text("text").strip()
    if len(text) >= _CHARS_THRESHOLD:
        return False
    # pouco texto: confirma que há uma imagem grande ocupando a página
    images = page.get_images(full=True)
    if not images:
        # sem texto e sem imagem = página em branco; não conta como escaneada
        return False
    return True


def classify(pdf_path: str) -> Classification:
    doc = fitz.open(pdf_path)
    try:
        page_count = doc.page_count
        sample = _sample_indices(page_count, _SAMPLE_SIZE)

        total_chars = 0
        scanned_in_sample: list[int] = []
        for idx in sample:
            page = doc[idx]
            total_chars += len(page.get_text("text").strip())
            if _page_is_scanned(page):
                scanned_in_sample.append(idx)

        avg_chars = total_chars / len(sample) if sample else 0.0
        scanned_ratio = len(scanned_in_sample) / len(sample) if sample else 0.0

        if scanned_ratio == 0:
            kind = PdfKind.NATIVE
            scanned_pages: list[int] = []
        elif scanned_ratio >= 0.8:
            kind = PdfKind.SCANNED
            # se quase tudo é escaneado, marcamos todas para OCR
            scanned_pages = list(range(page_count))
        else:
            kind = PdfKind.HYBRID
            # varre o documento inteiro pra achar exatamente quais páginas
            scanned_pages = [
                i for i in range(page_count) if _page_is_scanned(doc[i])
            ]

        return Classification(
            kind=kind,
            page_count=page_count,
            scanned_pages=scanned_pages,
            avg_chars_per_page=round(avg_chars, 1),
        )
    finally:
        doc.close()
