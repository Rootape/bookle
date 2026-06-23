# leitor — web (leitor PWA)

Front-end do leitor pessoal. Next.js (static export) + PWA. Consome a API,
mostra a biblioteca, e abre os livros num leitor paginado tipo Kindle com a sua
tipografia — todo livro renderizado no mesmo formato, não importa o PDF de origem.

## Design

- **Paginado** (vira página tipo Kindle) via CSS multi-coluna — reflow nativo do
  navegador, leve, funciona offline.
- **Minimalista**: a tela é o livro. Controles (fonte, tema, serif/sans) somem
  durante a leitura e aparecem ao tocar no centro.
- **Tema escuro** por padrão (toggle pra sepia). Tipografia serifada, medida de
  linha confortável (~65 caracteres), recuo de parágrafo estilo livro.
- **Toque**: terço esquerdo = página anterior, terço direito = próxima, centro =
  mostra/esconde controles. Setas do teclado também viram página.

## PWA / offline

- Instalável na tela inicial do iPhone (Safari → Compartilhar → Adicionar à Tela
  de Início). Abre em tela cheia, sem barra do navegador.
- Service worker cacheia o shell e o conteúdo dos livros já abertos. Um livro
  aberto uma vez fica disponível offline.
- Progresso de leitura salva local na hora e sincroniza com a API quando online
  (resiliente a ficar sem conexão).

## Rodar

```bash
npm install
cp .env.example .env.local      # ajuste NEXT_PUBLIC_API_URL se preciso

npm run dev                     # desenvolvimento → http://localhost:3000
# ou
npm run build                   # gera export estático em out/
npx serve out                   # serve o build (ou deixe a API servir out/)
```

A API precisa estar rodando (ver apps/api). Sem ela, a biblioteca mostra erro de
conexão.

## Acesso externo (iPhone fora de casa)

Sem expor a rede: **Tailscale**. Instale na máquina que roda a API e no iPhone.
No `.env.local`, aponte `NEXT_PUBLIC_API_URL` para o IP Tailscale da máquina
(`http://100.x.y.z:8000`). O iPhone acessa o leitor como se estivesse em casa,
sem porta aberta no roteador.

## Ícones (pendente)

O `manifest.json` referencia `icon-192.png` e `icon-512.png` em `public/`. Gere
dois PNGs quadrados (192 e 512 px) com a identidade que quiser — sem eles o PWA
funciona, mas usa um ícone genérico na tela inicial.
