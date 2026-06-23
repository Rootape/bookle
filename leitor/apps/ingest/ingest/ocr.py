"""
Branch de OCR para PDFs escaneados ou páginas escaneadas em PDFs híbridos.

Estratégia: usamos OCRmyPDF, que é o wrapper certo em volta do Tesseract.
Ele adiciona uma CAMADA de texto invisível por cima da imagem original,
gerando um novo PDF que agora é "nativo" (texto extraível). Depois desse passo,
reaproveitamos exatamente o mesmo extrator nativo — não duplicamos lógica.

Por que OCRmyPDF e não chamar Tesseract direto:
  - faz deskew, remove ruído, otimiza, lida com rotação automaticamente
  - preserva a estrutura de páginas (posições), que o nosso extrator usa
  - idempotente e robusto a PDFs estranhos

Dependências de sistema (NÃO são pip): ocrmypdf, tesseract-ocr e os pacotes de
idioma. No Arch:
    sudo pacman -S ocrmypdf tesseract tesseract-data-por tesseract-data-eng

Este módulo só orquestra o subprocess; mantemos a fronteira clara.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile


class OcrUnavailable(RuntimeError):
    pass


def ocr_available() -> bool:
    return shutil.which("ocrmypdf") is not None


def ocr_pdf(
    src_path: str,
    languages: str = "por+eng",
    force: bool = False,
    page_segmentation: int = 1,
) -> str:
    """Roda OCR e retorna o caminho de um novo PDF temporário com camada de
    texto. O chamador é responsável por limpar o arquivo depois.

    languages: códigos Tesseract separados por '+'. 'por+eng' cobre a maioria
    dos livros que você lê (PT-BR com termos técnicos em inglês).
    force: re-OCR mesmo se já houver texto. IMPORTANTE pra PDFs que já vêm com
    uma camada de OCR ruim (scans previamente OCRizados): sem isto, o OCRmyPDF
    PULA essas páginas (--skip-text) e herda o texto ruim. Com force=True, ele
    refaz o OCR do zero — é o que dá chance de melhorar o reconhecimento.
    page_segmentation: PSM do Tesseract. 1 = segmentação automática com detecção
    de orientação (bom default pra livro). 3 = automática sem OSD. 6 = bloco
    único uniforme. Ajustar isto pode ajudar capitulares e fluxo de parágrafo.
    """
    if not ocr_available():
        raise OcrUnavailable(
            "ocrmypdf não encontrado. Instale com: "
            "sudo pacman -S ocrmypdf tesseract tesseract-data-por tesseract-data-eng"
        )

    out_fd, out_path = tempfile.mkstemp(suffix=".ocr.pdf")
    import os

    os.close(out_fd)

    cmd = [
        "ocrmypdf",
        "-l", languages,
        "--rotate-pages",      # corrige páginas rotacionadas
        "--deskew",            # endireita o scan
        "--optimize", "1",
        "--tesseract-pagesegmode", str(page_segmentation),
    ]
    # --clean depende do programa `unpaper`. Se estiver disponível, usamos (melhora
    # o OCR em scans ruidosos); se não, seguimos sem ele em vez de falhar o livro
    # inteiro. Degradar é melhor que abortar num leitor pessoal.
    if shutil.which("unpaper"):
        cmd.append("--clean")

    if force:
        # refaz o OCR do zero, ignorando qualquer camada de texto existente
        cmd.append("--force-ocr")
    else:
        # se a página já tem texto, pula (rápido em híbridos genuínos)
        cmd.append("--skip-text")
    cmd += [src_path, out_path]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"OCR falhou (exit {proc.returncode}):\n{proc.stderr}")
    return out_path
