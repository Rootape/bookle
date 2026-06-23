# Imagem única para API e worker — ambos rodam o mesmo código (importam o
# pacote `ingest`); só muda o comando de entrada. Evita duplicar build.

FROM python:3.12-slim AS base

# Dependências de SISTEMA para o branch de OCR (não são pip):
#   - ocrmypdf: wrapper do Tesseract
#   - tesseract-ocr + idiomas: o motor de OCR e os dados de língua
#   - ghostscript, pngquant: usados pelo OCRmyPDF para otimizar/rasterizar
# A API não usa OCR, mas o worker sim; como compartilham imagem, instalamos aqui.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ocrmypdf \
    tesseract-ocr \
    tesseract-ocr-por \
    tesseract-ocr-eng \
    ghostscript \
    pngquant \
    unpaper \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala primeiro o pacote ingest, depois a api. Copiamos os pyproject e o
# código; a ordem aproveita o cache do Docker entre builds.
COPY apps/ingest /app/apps/ingest
RUN pip install --no-cache-dir -e /app/apps/ingest

COPY apps/api /app/apps/api
RUN pip install --no-cache-dir -e /app/apps/api

WORKDIR /app/apps/api

# Comando padrão = API. O serviço worker sobrescreve no compose.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
