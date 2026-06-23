// Service worker do Leitor.
//
// Estratégia de cache pensada pro caso real: você abre um livro em casa (na
// rede Tailscale), e depois quer ler fora, possivelmente sem alcançar o
// servidor. Então:
//
//   - Shell do app (HTML/JS/CSS do Next): cache-first, atualizado em background.
//     O app abre instantâneo e funciona offline.
//   - Conteúdo dos livros (/books/{id}/content): stale-while-revalidate —
//     serve do cache na hora se já foi aberto, e atualiza por trás. Uma vez
//     aberto, o livro fica disponível offline pra sempre (até você limpar).
//   - Lista/metadados (/books, /books/{id}): network-first com fallback pro
//     cache — dados frescos quando online, últimos conhecidos quando offline.

const SHELL_CACHE = 'leitor-shell-v1';
const CONTENT_CACHE = 'leitor-content-v1';

// O shell é cacheado sob demanda (não pré-listamos os hashes do Next build).
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== CONTENT_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function isContent(url) {
  return /\/books\/[^/]+\/content$/.test(url.pathname);
}
function isPageImage(url) {
  // imagens de página do modo imagem: /books/{id}/pages/{file}.png
  return /\/books\/[^/]+\/pages\/[^/]+$/.test(url.pathname);
}
function isMetadata(url) {
  return url.pathname === '/books'
    || /\/books\/[^/]+$/.test(url.pathname)
    || /\/books\/[^/]+\/manifest$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // uploads/patch/delete sempre na rede

  const url = new URL(request.url);

  // conteúdo do livro e imagens de página: stale-while-revalidate (offline)
  if (isContent(url) || isPageImage(url)) {
    event.respondWith(
      caches.open(CONTENT_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // metadados: network-first com fallback pro cache
  if (isMetadata(url)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CONTENT_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // shell do app (mesma origem): cache-first com atualização em background
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
