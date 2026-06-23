# leitor — pipeline de ingestão

Converte qualquer PDF de livro num **formato canônico** (HTML semântico sem
estilo + `manifest.json`). O objetivo é que todo livro, não importa a origem,
seja renderizado pelo *mesmo* CSS do seu leitor — você sempre lê no formato a
que está acostumado.

Este é o primeiro corte do projeto: só o pipeline Python, validado de ponta a
ponta. API (NestJS) e leitor (Next.js PWA) vêm depois e consomem esta saída.

## Como funciona

```
PDF → classify → (OCR se preciso) → extract → clean → structure → emit
```

| Etapa       | Arquivo         | O que faz |
|-------------|-----------------|-----------|
| classify    | `classify.py`   | Detecta nativo / escaneado / híbrido por amostragem de texto vs imagem. |
| ocr         | `ocr.py`        | OCRmyPDF (Tesseract) adiciona camada de texto a páginas escaneadas; depois reusa o extrator nativo. |
| extract     | `extract.py`    | PyMuPDF: extrai linhas com fonte, tamanho, bold/itálico e posição (bbox). |
| clean       | `clean.py`      | Remove cabeçalho/rodapé repetido (recorrência + zona), desfaz hifenização, junta linhas. |
| structure   | `structure.py`  | Infere títulos (por tamanho de fonte relativo ao corpo) e quebra parágrafos (linha curta / indentação). |
| emit        | `emit.py`       | Escreve `content.html` (semântico, sem estilo) + `manifest.json` (título, sumário, metadados). |

## Uso

```bash
pip install -e .            # instala PyMuPDF
# OCR (opcional, só p/ escaneados) — Arch:
# sudo pacman -S ocrmypdf tesseract tesseract-data-por tesseract-data-eng

python -m ingest.cli livro.pdf --out ./storage/canonical
python -m ingest.cli livro.pdf --out ./out --id meu-id --title "Meu Livro"
```

## Decisão de design central

O HTML de saída **não tem estilo nenhum** — só `<h1>`, `<p>`, etc. Toda a
tipografia mora no leitor. É isso que garante que cada livro saia no seu molde,
independentemente do PDF de origem. EPUB, se um dia quiser, vira um *export*, não
o formato de trabalho.

## Onde a iteração vai morar (limitações conhecidas)

A estruturação é **heurística** e depende dos sinais de layout do PDF:

- **Quebra de parágrafo** precisa de um sinal visual (última linha curta ou
  indentação de início). PDFs com linhas de comprimento uniforme e sem recuo não
  dão como inferir parágrafos — limitação fundamental, não bug. Livros reais quase
  sempre têm esses sinais.
- **De-hifenização** é conservadora: preserva o hífen quando a palavra seguinte
  começa com maiúscula (provável nome composto). Pode errar em casos raros.
- **Títulos** são inferidos por tamanho de fonte. PDFs que usam só negrito (sem
  variar tamanho) caem na heurística secundária (bold + linha curta).
- **OCR** de escaneados depende da qualidade do scan; livros tortos/manchados
  pioram. `--deskew` e `--clean` ajudam.

Cada heurística está isolada e documentada pra você ligar/desligar e calibrar
com livros reais sem quebrar o resto.

## Próximos passos do projeto

1. `docker-compose.yml` + Postgres + Redis.
2. API NestJS: upload → enfileira (BullMQ) → grava `Book`.
3. Worker Python consumindo a fila e chamando `ingest()`.
4. Leitor Next.js (PWA) servindo o canônico com o seu CSS.
5. Acesso externo via Tailscale (sem expor a rede; PWA no iPhone).
