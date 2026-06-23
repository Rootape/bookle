"""
Orquestrador do pipeline de ingestão. Junta todas as etapas numa função só.

Fluxo:
    classify → (OCR se preciso) → extract → clean → structure → emit

Este é o ponto de entrada que o worker (Python/BullMQ) vai chamar, e também o
que a CLI usa. Mantemos toda a lógica aqui e deixamos worker/CLI como cascas
finas em volta.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from . import clean, emit, extract, image_mode, ocr
from .classify import PdfKind, classify
from .structure import structure


@dataclass
class IngestResult:
    book_id: str
    manifest: dict
    kind: str
    used_ocr: bool
    mode: str = "text"   # "text" ou "image"


def ingest(
    pdf_path: str,
    out_dir: str,
    book_id: str,
    title: str | None = None,
    ocr_languages: str = "por+eng",
    mode: str = "auto",
) -> IngestResult:
    """Processa um PDF para o formato canônico.

    mode:
      - "text"  : força extração de texto (reflowable). Bom pra PDFs nativos.
      - "image" : renderiza páginas como imagem (lê o livro como ele é, sem OCR).
                  Ideal pra livros ilustrados / com tipografia que derrota o OCR.
      - "auto"  : escolhe sozinho — texto pra PDFs nativos, imagem pra scans.
    """
    if title is None:
        title = os.path.splitext(os.path.basename(pdf_path))[0]

    classification = classify(pdf_path)

    # decide o modo efetivo
    effective_mode = mode
    if mode == "auto":
        # scans (sem texto nativo confiável) vão melhor como imagem; PDFs com
        # texto real vão como texto reflowable.
        effective_mode = "image" if classification.kind != PdfKind.NATIVE else "text"

    # ---- MODO IMAGEM ----
    if effective_mode == "image":
        manifest = image_mode.render_book_images(
            pdf_path=pdf_path, out_dir=out_dir, book_id=book_id
        )
        manifest["title"] = title
        return IngestResult(
            book_id=book_id,
            manifest=manifest,
            kind=classification.kind.value,
            used_ocr=False,
            mode="image",
        )

    # ---- MODO TEXTO (fluxo original) ----
    used_ocr = False
    working_pdf = pdf_path
    ocr_temp: str | None = None

    try:
        # PDFs escaneados ou híbridos passam por OCR.
        if classification.kind in (PdfKind.SCANNED, PdfKind.HYBRID):
            if ocr.ocr_available():
                # NOTA sobre force-ocr: experimentamos reprocessar do zero scans
                # que já vinham com camada de texto, na esperança de melhorar o
                # reconhecimento. Na prática, em livros com layout difícil
                # (capitulares ornamentais, headers estilizados, ilustrações) o
                # ganho foi nulo e o custo de tempo alto. Então mantemos
                # --skip-text (rápido): aproveita o texto existente e só OCRiza
                # páginas sem texto. force_ocr fica disponível como parâmetro
                # pra casos específicos, mas não é mais automático.
                ocr_temp = ocr.ocr_pdf(pdf_path, languages=ocr_languages)
                working_pdf = ocr_temp
                used_ocr = True
            # se OCR indisponível, seguimos só com o texto nativo que houver
            # (híbrido degrada graciosamente; escaneado puro sai quase vazio)

        # após OCR, todas as páginas têm texto → extração nativa unificada
        pages = extract.extract_native(working_pdf)

        # limpeza em duas passadas:
        #  1. remove cabeçalho/rodapé recorrente (detectado no documento todo)
        #  2. remove lixo não-textual de OCR (códigos, símbolos soltos)
        running = clean.find_running_headers_footers(pages)
        cleaned = [
            clean.strip_garbage_lines(
                clean.strip_headers_footers(page, running)
            )
            for page in pages
        ]

        blocks = structure(pages, cleaned)

        manifest = emit.emit(
            out_dir=out_dir,
            book_id=book_id,
            title=title,
            blocks=blocks,
            source_meta={
                "original_filename": os.path.basename(pdf_path),
                "kind": classification.kind.value,
                "page_count": classification.page_count,
                "used_ocr": used_ocr,
                "avg_chars_per_page": classification.avg_chars_per_page,
            },
        )

        return IngestResult(
            book_id=book_id,
            manifest=manifest,
            kind=classification.kind.value,
            used_ocr=used_ocr,
            mode="text",
        )
    finally:
        if ocr_temp and os.path.exists(ocr_temp):
            os.remove(ocr_temp)
