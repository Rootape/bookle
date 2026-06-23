"""
Transforma linhas limpas em uma estrutura semântica de blocos:
título de nível N, parágrafo, etc.

Princípio central: NÃO existe marcação semântica num PDF. O que existe é
tipografia. Inferimos a semântica a partir de:

  - tamanho de fonte relativo ao corpo (maior = mais "alto" na hierarquia)
  - bold
  - tamanho da linha / isolamento (títulos costumam ser linhas curtas e isoladas)

Abordagem:
  1. Descobrir o "tamanho do corpo" = tamanho de fonte mais comum no livro
     inteiro (a moda). Tudo é relativo a ele.
  2. Tamanhos acima do corpo viram níveis de heading (h1, h2, ... por ordem
     decrescente de tamanho).
  3. Linhas no tamanho do corpo são agrupadas em parágrafos.

Saída: lista de Block, o formato canônico intermediário antes do HTML.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from enum import Enum

from .clean import join_lines_to_paragraph
from .extract import Line, PageContent


class BlockType(str, Enum):
    HEADING = "heading"
    PARAGRAPH = "paragraph"


@dataclass
class Block:
    type: BlockType
    text: str
    level: int = 0  # só para heading: 1..6


def _body_size(pages: list[list[Line]]) -> float:
    """Tamanho de fonte do corpo = altura de linha mais comum (a moda),
    ponderada por nº de palavras. Como agora o tamanho vem da altura do bbox
    das palavras, arredondamos pra agrupar variações mínimas."""
    sizes: Counter[float] = Counter()
    for lines in pages:
        for line in lines:
            size = round(line.dominant_size)
            if size > 0:
                sizes[size] += len(line.words)
    if not sizes:
        return 12.0
    return float(sizes.most_common(1)[0][0])


def _heading_levels(pages: list[list[Line]], body: float) -> dict[float, int]:
    """Mapeia cada tamanho de linha > corpo para um nível de heading.
    O maior tamanho vira h1, o próximo h2, etc. (limitado a h6)."""
    bigger = sorted(
        {
            round(line.dominant_size)
            for lines in pages
            for line in lines
            if line.dominant_size > body * 1.15  # 15% maior pra evitar ruído de OCR
        },
        reverse=True,
    )
    return {float(size): min(i + 1, 6) for i, size in enumerate(bigger)}


def _line_is_heading(line: Line, body: float, levels: dict[float, int]) -> int:
    """Retorna o nível de heading da linha, ou 0 se for corpo.
    Inferido pelo tamanho (altura) da linha relativo ao corpo. Sem informação
    de bold por palavra (modo words não a fornece), usamos o tamanho como sinal
    principal — robusto pra a maioria dos livros, onde títulos são maiores."""
    size = round(line.dominant_size)
    if float(size) in levels:
        return levels[float(size)]
    return 0


def structure(pages: list[PageContent], cleaned: list[list[Line]]) -> list[Block]:
    """`pages` original (pra metadados) e `cleaned` = linhas já sem header/footer,
    na mesma ordem."""
    body = _body_size(cleaned)
    levels = _heading_levels(cleaned, body)

    # Larguras de texto típicas, pra detectar "linha curta" (fim de parágrafo).
    # Medimos o x-direito máximo observado no corpo: linhas que terminam bem
    # antes disso provavelmente encerram um parágrafo.
    body_lines = [
        line
        for lines in cleaned
        for line in lines
        if _line_is_heading(line, body, levels) == 0
    ]
    right_edges = sorted(line.bbox[2] for line in body_lines)
    left_edges = [line.bbox[0] for line in body_lines]
    min_left = min(left_edges) if left_edges else 0.0
    # "Largura de linha cheia" = mediana das bordas direitas. Linhas que
    # terminam um bom tanto antes disso encerram parágrafo. Usar a mediana (e
    # não o máximo) é robusto a outliers: uma única linha muito longa não
    # distorce o limiar, e linhas normais do meio do parágrafo não são lidas
    # como "curtas" por engano.
    if right_edges:
        median_right = right_edges[len(right_edges) // 2]
    else:
        median_right = 0.0
    short_threshold = median_right - body * 1.2   # margem de tolerância
    indent_threshold = min_left + body * 0.8       # início recuado = novo parágrafo

    blocks: list[Block] = []
    para_buffer: list[str] = []

    def flush_paragraph():
        if para_buffer:
            text = join_lines_to_paragraph(para_buffer)
            if text:
                blocks.append(Block(type=BlockType.PARAGRAPH, text=text))
            para_buffer.clear()

    prev_was_short = False
    for lines in cleaned:
        for line in lines:
            level = _line_is_heading(line, body, levels)
            if level > 0:
                flush_paragraph()
                prev_was_short = False
                blocks.append(
                    Block(
                        type=BlockType.HEADING,
                        text=line.text.strip(),
                        level=level,
                    )
                )
                continue

            indented = line.bbox[0] > indent_threshold
            # Começa parágrafo novo se: a linha anterior era curta (terminou o
            # parágrafo) OU esta linha está indentada (recuo de início).
            if para_buffer and (prev_was_short or indented):
                flush_paragraph()

            para_buffer.append(line.text)
            prev_was_short = line.bbox[2] < short_threshold

    flush_paragraph()
    return blocks
