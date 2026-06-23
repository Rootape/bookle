"""
Modo de importação "imagem": em vez de extrair texto, renderiza cada página do
PDF como uma imagem PNG. O leitor exibe as páginas como são e aplica um negativo
(inverter cores) nas páginas de texto pra combinar com o tema escuro, deixando
as páginas com ilustração intactas.

Por que existe: livros muito ilustrados ou com tipografia/capitulares que
derrotam o OCR (ex.: mangás, art books, scans estilizados) ficam ilegíveis no
modo texto. Lê-los como imagem preserva o livro exatamente como ele é — sem
OCR, sem texto grudado, sem lixo. O custo é perder reflow/ajuste de fonte.

Detecção de ilustração: páginas de texto são quase tudo branco com letras
pretas (pouquíssimo meio-tom); páginas com arte têm muita área de tons
intermediários. Medimos a proporção de pixels em meio-tom — acima de um limiar,
a página é "ilustração" e NÃO deve ser invertida pelo negativo.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

import fitz


# limiar de proporção de meios-tons acima do qual a página é considerada
# ilustração (não inverter). Calibrado: texto ~0.02, ilustração ~0.5.
_ILLUSTRATION_THRESHOLD = 0.15

# resolução de renderização das páginas (matriz de escala). 2.0 = 144 DPI
# aproximado, bom equilíbrio entre nitidez e tamanho de arquivo.
_RENDER_SCALE = 2.0


@dataclass
class PageImage:
    index: int
    filename: str
    is_illustration: bool


def _illustration_score(page: fitz.Page) -> float:
    """Proporção de pixels em meio-tom numa renderização cinza de baixa res.
    Rápido (0.5x) e suficiente pra classificar texto vs ilustração."""
    pix = page.get_pixmap(matrix=fitz.Matrix(0.5, 0.5), colorspace=fitz.csGRAY)
    data = pix.samples
    if not data:
        return 0.0
    midtones = 0
    sampled = 0
    # amostra a cada 4 bytes pra velocidade (não precisa varrer tudo)
    for i in range(0, len(data), 4):
        v = data[i]
        sampled += 1
        if 40 < v < 215:
            midtones += 1
    return midtones / sampled if sampled else 0.0


def render_book_images(
    pdf_path: str,
    out_dir: str,
    book_id: str,
) -> dict:
    """Renderiza cada página do PDF como PNG em <out_dir>/<book_id>/pages/ e
    grava um manifest com a lista de páginas e se cada uma é ilustração.
    Retorna o manifest."""
    book_dir = os.path.join(out_dir, book_id)
    pages_dir = os.path.join(book_dir, "pages")
    os.makedirs(pages_dir, exist_ok=True)

    doc = fitz.open(pdf_path)
    pages: list[PageImage] = []
    try:
        for i in range(doc.page_count):
            page = doc[i]
            is_illu = _illustration_score(page) >= _ILLUSTRATION_THRESHOLD
            # a primeira página (capa) é tratada como ilustração por padrão —
            # capas são quase sempre arte e não devem ser invertidas.
            if i == 0:
                is_illu = True
            pix = page.get_pixmap(matrix=fitz.Matrix(_RENDER_SCALE, _RENDER_SCALE))
            filename = f"{i:04d}.png"
            pix.save(os.path.join(pages_dir, filename))
            pages.append(PageImage(index=i, filename=filename, is_illustration=is_illu))
    finally:
        doc.close()

    manifest = {
        "id": book_id,
        "mode": "image",
        "page_count": len(pages),
        "format": "page-images-v1",
        "pages": [
            {"index": p.index, "file": p.filename, "illustration": p.is_illustration}
            for p in pages
        ],
    }
    with open(os.path.join(book_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    return manifest
