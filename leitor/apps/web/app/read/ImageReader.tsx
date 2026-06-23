'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { getManifest, pageImageUrl, saveProgress, setNormalPages, type ImageManifest } from '@/app/lib/api';
import { usePageGestures } from './usePageGestures';

// Leitor em modo imagem: exibe cada página do PDF como imagem renderizada.
// TODAS as páginas recebem um NEGATIVO por padrão pra combinar com o tema
// escuro. Exceções: a capa (página 0) e páginas que o usuário marca como
// "normal". As marcações ficam no BACKEND (seguem entre dispositivos) com cache
// local pra resposta instantânea e funcionamento offline.

const posKey = (id: string) => `leitor:pos:${id}`;
const C = { bg: '#0d0d0f', fg: '#d8d4cc', muted: '#6b6862', accent: '#c9a86a' };

const normalKey = (id: string) => `leitor:normal-pages:${id}`;

function loadNormalLocal(id: string): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(normalKey(id));
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch { return new Set(); }
}

export default function ImageReader({
  bookId, title, initialNormalPages = [], initialPosition = 0,
}: { bookId: string; title: string; initialNormalPages?: number[]; initialPosition?: number }) {
  const [manifest, setManifest] = useState<ImageManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [normalPages, setNormalPagesState] = useState<Set<number>>(new Set());
  // só passa a salvar progresso DEPOIS de aplicar a posição inicial — senão o
  // estado inicial (page=0) sobrescreveria no servidor o progresso real que
  // veio de outro dispositivo. Esse era o bug do "reiniciou no celular".
  const [posLoaded, setPosLoaded] = useState(false);
  const syncTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // marcações: une o que veio do servidor (sincroniza entre dispositivos) com
  // o cache local (resposta instantânea / offline).
  useEffect(() => {
    const local = loadNormalLocal(bookId);
    const fromServer = new Set(initialNormalPages);
    setNormalPagesState(new Set([...fromServer, ...local]));
  }, [bookId, initialNormalPages]);

  function toggleNormal(idx: number) {
    setNormalPagesState((cur) => {
      const next = new Set(cur);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      const arr = [...next];
      try { localStorage.setItem(normalKey(bookId), JSON.stringify(arr)); } catch {}
      setNormalPages(bookId, arr);   // sincroniza com o servidor (best-effort)
      return next;
    });
  }

  useEffect(() => {
    let alive = true;
    getManifest(bookId)
      .then((m) => { if (alive) setManifest(m); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [bookId]);

  const pageCount = manifest?.page_count ?? 0;

  // restaura posição salva
  // posição inicial: usa a MAIOR entre o servidor (sincroniza entre aparelhos)
  // e o cache local (caso você tenha avançado offline). Assim abrir no celular
  // retoma os 12% do desktop, em vez de zerar.
  useEffect(() => {
    if (!manifest) return;
    let local = 0;
    try {
      const saved = localStorage.getItem(posKey(bookId));
      if (saved !== null) local = parseInt(saved, 10) || 0;
    } catch {}
    const start = Math.min(
      Math.max(initialPosition, local),
      manifest.page_count - 1
    );
    setPage(Math.max(0, start));
    setPosLoaded(true);   // a partir daqui, salvar é seguro
  }, [manifest, bookId, initialPosition]);

  // salva posição (local + API com debounce) — só DEPOIS de carregar a inicial,
  // pra não sobrescrever o progresso vindo de outro dispositivo com zero.
  useEffect(() => {
    if (!manifest || !posLoaded) return;
    try { localStorage.setItem(posKey(bookId), String(page)); } catch {}
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => saveProgress(bookId, page), 1500);
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [page, bookId, manifest, posLoaded]);

  const go = useCallback((dir: number) => {
    setPage((p) => Math.max(0, Math.min(pageCount - 1, p + dir)));
  }, [pageCount]);

  // zonas de toque (sem arrasto): esquerda/direita viram página, centro mostra
  // ou esconde os controles. Reutilizada pelo gesto de toque simples.
  const tapZones = useCallback((clientX: number, width: number) => {
    if (clientX < width * 0.33) go(-1);
    else if (clientX > width * 0.67) go(1);
    else setChromeVisible((v) => !v);
  }, [go]);

  // gestos de toque: swipe pra virar, pinça e duplo-toque pra zoom, pan quando
  // ampliado. Integra tudo numa camada só.
  const gestures = usePageGestures({
    onSwipeLeft: () => go(1),    // arrastou pra esquerda → próxima página
    onSwipeRight: () => go(-1),  // arrastou pra direita → página anterior
    onTapZones: tapZones,
  });

  // ao trocar de página, zera qualquer zoom/pan da página anterior
  useEffect(() => { gestures.reset(); }, [page]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  // clique do mouse (desktop): mantém as zonas de toque
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    tapZones(e.clientX - e.currentTarget.getBoundingClientRect().left, e.currentTarget.clientWidth);
  };

  if (error) {
    return (
      <div style={errBox}>
        <p style={{ marginBottom: '1rem' }}>Não foi possível abrir este livro.</p>
        <p style={{ color: C.muted, fontSize: '0.85rem' }}>{error}</p>
        <a href="/" style={{ color: C.accent, marginTop: '1.5rem', display: 'inline-block' }}>
          Voltar à biblioteca
        </a>
      </div>
    );
  }

  const current = manifest?.pages[page];
  // Inverte TODAS as páginas por padrão. Exceções (mostradas normais):
  //   - a capa (página 0), que é sempre arte
  //   - páginas que o usuário marcou manualmente como "normal"
  const isNormal = page === 0 || normalPages.has(page);
  const applyInvert = !isNormal;
  const progress = pageCount > 1 ? page / (pageCount - 1) : 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, overflow: 'hidden', background: C.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div
        onClick={onClick}
        onTouchStart={gestures.handlers.onTouchStart}
        onTouchMove={gestures.handlers.onTouchMove}
        onTouchEnd={gestures.handlers.onTouchEnd}
        style={{
          position: 'absolute', inset: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 'clamp(0.5rem, 3vw, 2.5rem)',
          touchAction: 'none',   // desativa gestos nativos do browser; nós controlamos
        }}
      >
        {current ? (
          <img
            src={pageImageUrl(bookId, current.file)}
            alt={`Página ${page + 1}`}
            style={{
              maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
              filter: applyInvert ? 'invert(1) hue-rotate(180deg)' : 'none',
              // transform do zoom/pan. Sem transição durante o gesto (resposta
              // imediata ao dedo); a transição do filtro continua separada.
              transform: gestures.transform,
              transition: gestures.isZoomed ? 'filter 0.3s' : 'filter 0.3s, transform 0.2s',
              transformOrigin: 'center center',
              willChange: 'transform',
            }}
            draggable={false}
          />
        ) : (
          <div style={{ color: C.muted, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span className="leitor-spinner" style={{ color: C.accent }} /> Carregando…
          </div>
        )}
      </div>

      {/* barra de progresso */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, pointerEvents: 'none' }}>
        <div style={{ height: '100%', width: `${progress * 100}%`, background: C.accent, opacity: 0.5, transition: 'width 0.3s' }} />
      </div>

      {/* indicador de página */}
      <div style={{
        position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center',
        fontSize: '0.7rem', letterSpacing: '0.08em', color: C.muted,
        opacity: chromeVisible ? 0 : 0.55, transition: 'opacity 0.3s',
        pointerEvents: 'none', fontFamily: 'system-ui, sans-serif',
      }}>
        {page + 1} / {pageCount}
      </div>

      {/* controles */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: 'max(1rem, env(safe-area-inset-top)) max(1.25rem, env(safe-area-inset-right)) 1rem max(1.25rem, env(safe-area-inset-left))',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem',
        background: `linear-gradient(${C.bg}, transparent)`,
        opacity: chromeVisible ? 1 : 0,
        transform: chromeVisible ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'opacity 0.3s, transform 0.3s',
        fontFamily: 'system-ui, sans-serif',
        pointerEvents: chromeVisible ? 'auto' : 'none',
      }}>
        <a href="/" style={{
          fontSize: '0.85rem', letterSpacing: '0.05em', color: C.muted, textDecoration: 'none',
          // trunca o título longo pra não empurrar o botão pra fora no celular
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1,
        }}>
          ‹ {title}
        </a>
        <button
          onClick={(e) => { e.stopPropagation(); toggleNormal(page); }}
          disabled={page === 0}
          style={{
            background: 'transparent', border: `1px solid ${C.muted}44`, color: C.fg,
            borderRadius: 6, padding: '0.35rem 0.7rem', fontSize: '0.8rem',
            cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1,
            fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          {page === 0
            ? 'Capa'
            : isNormal
              ? '◐ Normal'
              : '◑ Negativo'}
        </button>
      </div>
    </div>
  );
}

const errBox: React.CSSProperties = {
  position: 'fixed', inset: 0, background: C.bg, color: C.fg,
  display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', textAlign: 'center', padding: '2rem',
  fontFamily: 'system-ui, sans-serif',
};
