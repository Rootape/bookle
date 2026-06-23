"""
Emite o formato canônico: HTML semântico + manifest.json.

DECISÃO DE DESIGN: o HTML emitido NÃO carrega estilo nenhum. É puramente
semântico (<h1>, <h2>, <p>). Toda a tipografia — fonte, tamanho, margem,
espaçamento, tema claro/escuro — fica no LEITOR (front-end), não no conteúdo.

É isso que resolve a dor original: não importa de que PDF veio, todo livro é
renderizado pelo MESMO CSS do seu leitor. O conteúdo é só estrutura; a
aparência é sempre a sua.

manifest.json carrega os metadados que o leitor/biblioteca consome (título,
nº de blocos, origem, etc.).
"""

from __future__ import annotations

import html
import json
import os
from dataclasses import asdict

from .structure import Block, BlockType


def blocks_to_html(blocks: list[Block]) -> str:
    parts: list[str] = []
    for b in blocks:
        safe = html.escape(b.text)
        if b.type == BlockType.HEADING:
            lvl = max(1, min(b.level, 6))
            parts.append(f"<h{lvl}>{safe}</h{lvl}>")
        else:
            parts.append(f"<p>{safe}</p>")
    # HTML mínimo, semântico, sem estilo. O <body> é o que o leitor injeta.
    return "\n".join(parts)


def emit(
    out_dir: str,
    book_id: str,
    title: str,
    blocks: list[Block],
    source_meta: dict,
) -> dict:
    """Grava <out_dir>/<book_id>/content.html e manifest.json. Retorna o
    manifest (também útil pro worker gravar no Postgres)."""
    book_dir = os.path.join(out_dir, book_id)
    os.makedirs(book_dir, exist_ok=True)

    content_html = blocks_to_html(blocks)
    with open(os.path.join(book_dir, "content.html"), "w", encoding="utf-8") as f:
        f.write(content_html)

    headings = [
        {"level": b.level, "text": b.text}
        for b in blocks
        if b.type == BlockType.HEADING
    ]

    manifest = {
        "id": book_id,
        "title": title,
        "block_count": len(blocks),
        "heading_count": len(headings),
        "toc": headings,  # sumário derivado dos headings
        "source": source_meta,
        "format": "canonical-html-v1",
    }
    with open(os.path.join(book_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    return manifest
