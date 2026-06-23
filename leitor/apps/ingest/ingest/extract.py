"""
Extrai conteúdo estruturado de um PDF usando PyMuPDF.

DECISÃO IMPORTANTE: usamos o modo "words" do PyMuPDF, não "dict"/spans.

Por quê: em PDFs com camada de OCR (e em alguns PDFs nativos mal gerados), o
texto de uma linha inteira pode vir como um único span SEM espaços internos —
o que cola tudo ("hesettingsunwasstaining"). O modo "words" usa o detector de
palavras do MuPDF, que segmenta por GEOMETRIA (posição de cada caractere), não
pelos espaços do fluxo de texto. Resultado: palavras corretamente separadas
mesmo quando o OCR não emitiu espaços.

Cada "word" vem como (x0, y0, x1, y1, texto, block_no, line_no, word_no) — já
com agrupamento de bloco e linha feito pelo MuPDF. Reconstruímos as linhas a
partir disso. O tamanho de fonte é aproximado pela altura do bbox da palavra
(suficiente pra distinguir título de corpo na etapa de estruturação).

Saída: lista de PageContent (mesma interface de antes), pra não quebrar o resto
do pipeline (clean, structure).
"""

from __future__ import annotations

from dataclasses import dataclass

import fitz


@dataclass
class Word:
    text: str
    bbox: tuple[float, float, float, float]

    @property
    def height(self) -> float:
        return self.bbox[3] - self.bbox[1]


@dataclass
class Line:
    words: list[Word]
    bbox: tuple[float, float, float, float]

    @property
    def text(self) -> str:
        # palavras já segmentadas pelo MuPDF: basta juntar com espaço
        return " ".join(w.text for w in self.words).strip()

    @property
    def dominant_size(self) -> float:
        """Tamanho aproximado pela mediana da altura das palavras (proxy de
        font-size). Robusto a uma palavra ocasionalmente maior/menor."""
        if not self.words:
            return 0.0
        heights = sorted(w.height for w in self.words)
        return round(heights[len(heights) // 2], 1)


@dataclass
class PageContent:
    index: int
    width: float
    height: float
    lines: list[Line]


def extract_page(page: fitz.Page) -> PageContent:
    # words: (x0, y0, x1, y1, text, block_no, line_no, word_no), já ordenado
    raw = page.get_text("words", sort=True)

    # agrupa por (block_no, line_no) — o MuPDF já fez a segmentacao de linha
    groups: dict[tuple[int, int], list[Word]] = {}
    order: list[tuple[int, int]] = []
    for x0, y0, x1, y1, text, block_no, line_no, _word_no in raw:
        if not text.strip():
            continue
        key = (block_no, line_no)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(Word(text=text, bbox=(x0, y0, x1, y1)))

    lines: list[Line] = []
    for key in order:
        words = groups[key]
        if not words:
            continue
        x0 = min(w.bbox[0] for w in words)
        y0 = min(w.bbox[1] for w in words)
        x1 = max(w.bbox[2] for w in words)
        y1 = max(w.bbox[3] for w in words)
        lines.append(Line(words=words, bbox=(x0, y0, x1, y1)))

    return PageContent(
        index=page.number,
        width=page.rect.width,
        height=page.rect.height,
        lines=lines,
    )


def extract_native(pdf_path: str, skip_pages: set[int] | None = None) -> list[PageContent]:
    """Extrai todas as paginas. skip_pages permite pular paginas tratadas por
    OCR num caso hibrido (mantido por compatibilidade de interface)."""
    skip_pages = skip_pages or set()
    doc = fitz.open(pdf_path)
    try:
        return [
            extract_page(doc[i])
            for i in range(doc.page_count)
            if i not in skip_pages
        ]
    finally:
        doc.close()
