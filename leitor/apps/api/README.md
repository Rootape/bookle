# leitor — API

Backend FastAPI do leitor pessoal. Recebe uploads de PDF, dispara o pipeline de
ingestão (pacote `ingest`) num worker, e serve o HTML canônico pro leitor.

**Backend mono-linguagem em Python** — sem ponte entre linguagens. A API importa
`ingest` direto e o worker chama `ingest()` na mesma stack.

## Stack

- **FastAPI** — API HTTP
- **SQLModel** — ORM (Pydantic + SQLAlchemy num modelo só)
- **SQLite** — banco padrão, zero setup (trocável por Postgres via env)
- **ARQ** — fila/worker sobre Redis (async, leve, retry embutido)

## Rotas

| Método | Rota                       | O que faz |
|--------|----------------------------|-----------|
| POST   | `/books`                   | Upload de PDF → cria Book(pending) → enfileira |
| GET    | `/books`                   | Lista a biblioteca |
| GET    | `/books/{id}`              | Metadados + status |
| GET    | `/books/{id}/content`      | HTML canônico (quando READY) |
| PATCH  | `/books/{id}/progress`     | Salva posição de leitura |
| DELETE | `/books/{id}`              | Remove livro (banco + arquivos) |

## Rodar (desenvolvimento)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ../ingest        # o pipeline
pip install -e .                # a API

# precisa de um Redis rodando pra fila:
#   docker run -p 6379:6379 redis   (ou pacman -S redis && systemctl start redis)

# terminal 1 — API
uvicorn app.main:app --reload

# terminal 2 — worker
arq app.worker.WorkerSettings
```

API em http://localhost:8000 — docs interativas em http://localhost:8000/docs.

## Configuração (env, prefixo `LEITOR_`)

| Variável                  | Default            |
|---------------------------|--------------------|
| `LEITOR_DATABASE_URL`     | SQLite local       |
| `LEITOR_REDIS_URL`        | redis://localhost:6379 |
| `LEITOR_OCR_LANGUAGES`    | por+eng            |

Storage de PDFs e canônico fica em `../../storage/` (raiz do monorepo).

## Próximo passo

Leitor Next.js (PWA): consome `/books` e `/books/{id}/content`, aplica o CSS de
leitura, salva progresso via PATCH. Acesso externo no iPhone via Tailscale.
