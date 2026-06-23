# Build multi-stage: Node gera o export estático; nginx serve os arquivos.
# O resultado é uma imagem pequena, sem Node em runtime — combina com a escolha
# de static export do Next.

# --- estágio de build ---
FROM node:22-slim AS builder

WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm install

COPY apps/web ./

# A URL da API NÃO é fixada no build. Por padrão a deixamos vazia: o cliente
# (lib/api.ts) então deriva a URL em runtime do host que serviu a página —
# mesmo IP, porta 8000 — funcionando no desktop e no iPhone (Tailscale) com um
# único build. Só passe --build-arg NEXT_PUBLIC_API_URL=... se quiser forçar
# uma URL específica (ex.: um proxy reverso).
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build

# --- estágio de runtime ---
FROM nginx:alpine

# config simples: serve o export e faz fallback pra index nas rotas do app
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/out /usr/share/nginx/html

EXPOSE 80
