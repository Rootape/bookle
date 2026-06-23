"""
CLI fina para rodar o pipeline na mão durante desenvolvimento.

Uso:
    python -m ingest.cli caminho/do/livro.pdf --out ./storage/canonical
    python -m ingest.cli livro.pdf --out ./out --id meu-livro --title "Meu Livro"

O leitor de verdade vai chamar `ingest()` via worker; isto é só pra você
testar a qualidade da conversão livro a livro e iterar nas heurísticas.
"""

from __future__ import annotations

import argparse
import sys
import uuid

from .pipeline import ingest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingestão de PDF → HTML canônico")
    parser.add_argument("pdf", help="Caminho do PDF de entrada")
    parser.add_argument("--out", default="./storage/canonical", help="Diretório de saída")
    parser.add_argument("--id", default=None, help="ID do livro (default: uuid)")
    parser.add_argument("--title", default=None, help="Título (default: nome do arquivo)")
    parser.add_argument("--lang", default="por+eng", help="Idiomas OCR (Tesseract)")
    args = parser.parse_args(argv)

    book_id = args.id or str(uuid.uuid4())[:8]
    result = ingest(
        pdf_path=args.pdf,
        out_dir=args.out,
        book_id=book_id,
        title=args.title,
        ocr_languages=args.lang,
    )

    m = result.manifest
    print(f"✓ Livro processado: {m['title']}")
    print(f"  id:        {result.book_id}")
    print(f"  tipo:      {result.kind}" + (" (OCR aplicado)" if result.used_ocr else ""))
    print(f"  blocos:    {m['block_count']}  (headings: {m['heading_count']})")
    print(f"  saída:     {args.out}/{result.book_id}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
