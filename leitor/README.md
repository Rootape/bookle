# leitor

Leitor pessoal de PDFs. Você joga um PDF (nativo ou escaneado), ele é convertido
para um formato canônico de leitura, e você lê num leitor paginado tipo Kindle —
sempre com a sua tipografia, não importa de que PDF veio.

## Arquitetura

```
PDF → [ingest] → canônico (HTML) → [api] → [web/leitor PWA]
```

- **apps/ingest** — pipeline Python (PyMuPDF + OCRmyPDF/Tesseract). Classifica,
  extrai, limpa, estrutura e emite HTML canônico semântico. Sem estilo: a
  aparência mora no leitor.
- **apps/api** — FastAPI + SQLModel (SQLite). Upload, biblioteca, serve o
  canônico, salva progresso. Enfileira o processamento.
- **worker** — ARQ (sobre Redis). Consome a fila e roda o pipeline. Mesma imagem
  da api, comando diferente.
- **apps/web** — Next.js (static export) + PWA. Leitor minimalista, paginado,
  tema escuro, offline. Instalável no iPhone.

Backend mono-linguagem em Python: a api importa `ingest` direto, sem ponte entre
linguagens.

## Subir tudo (Docker)

```bash
docker compose up -d --build
```

- Leitor: http://localhost:3000
- API: http://localhost:8000 (docs em /docs)

Banco SQLite e os arquivos (originais + canônico) ficam no volume `app-data`,
persistente entre recriações.

## Rodar em desenvolvimento (sem Docker)

Precisa de um Redis local (`docker run -p 6379:6379 redis`).

```bash
# pipeline + api (um venv)
python -m venv .venv && source .venv/bin/activate
pip install -e apps/ingest -e apps/api

# terminal 1: api
cd apps/api && uvicorn app.main:app --reload

# terminal 2: worker
cd apps/api && arq app.worker.WorkerSettings

# terminal 3: web
cd apps/web && npm install && npm run dev
```

## Acesso externo (iPhone fora de casa, sem expor a rede)

Use **Tailscale** — rede privada (WireGuard), zero porta aberta no roteador.

1. Instale o Tailscale na máquina que roda o leitor e no iPhone (mesma conta).
2. Descubra o IP Tailscale da máquina: `tailscale ip -4` (algo como `100.x.y.z`).
3. Rebuilde o web apontando a API pra esse IP:
   ```bash
   docker compose build web --build-arg NEXT_PUBLIC_API_URL=http://100.x.y.z:8000
   docker compose up -d
   ```
4. No iPhone (com Tailscale ativo), acesse `http://100.x.y.z:3000` no Safari e
   adicione à tela inicial. Abre em tela cheia, funciona offline depois de abrir
   cada livro uma vez.

## OCR (PDFs escaneados)

O worker já vem com Tesseract (por+eng) na imagem Docker. PDFs nativos não usam
OCR; escaneados/híbridos passam por ele automaticamente. Para rodar OCR fora do
Docker, instale no Arch:
`sudo pacman -S ocrmypdf tesseract tesseract-data-por tesseract-data-eng`

## Pendência

Ícones do PWA: gere `apps/web/public/icon-192.png` e `icon-512.png` (PNGs
quadrados). Sem eles o app funciona, mas o ícone na tela inicial fica genérico.
