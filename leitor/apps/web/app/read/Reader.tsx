'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getContent, saveProgress } from '@/app/lib/api';

// Preferências de leitura ficam no localStorage (por isso são por-dispositivo).
// Progresso por livro também é guardado local e sincronizado com a API quando
// dá — assim a leitura funciona offline e nunca perde a posição.
const PREFS_KEY = 'leitor:prefs';
const posKey = (id: string) => `leitor:pos:${id}`;

interface Prefs {
  theme: 'dark' | 'sepia';
  fontScale: number;
  serif: boolean;
}

const DEFAULT_PREFS: Prefs = { theme: 'dark', fontScale: 1, serif: true };

const THEMES = {
  dark: { bg: '#0d0d0f', fg: '#d8d4cc', muted: '#6b6862', accent: '#c9a86a' },
  sepia: { bg: '#f4ecd8', fg: '#3a3326', muted: '#9a8f78', accent: '#a8743a' },
};

function loadPrefs(): Prefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

export default function Reader({ bookId, title, initialPosition = 0 }: { bookId: string; title: string; initialPosition?: number }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [chromeVisible, setChromeVisible] = useState(false);
  const [posLoaded, setPosLoaded] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // dimensões medidas: largura da coluna e gap, em pixels. Guardadas em state
  // pra que o render use exatamente os mesmos números do cálculo de páginas —
  // é isso que impede a "próxima coluna" de vazar pra dentro da tela.
  const [metrics, setMetrics] = useState({ colWidth: 0, gap: 0, step: 0 });

  const t = THEMES[prefs.theme];

  // carrega prefs no cliente (evita mismatch de hidratação)
  useEffect(() => setPrefs(loadPrefs()), []);

  function updatePrefs(patch: Partial<Prefs>) {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // busca o HTML canônico da API
  useEffect(() => {
    let alive = true;
    getContent(bookId)
      .then((text) => { if (alive) setHtml(text); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [bookId]);

  // recalcula geometria e nº de páginas. A regra que fecha a conta:
  //   - cada coluna tem a largura EXATA da viewport (uma página = uma tela)
  //   - o gap entre colunas é igual à largura da viewport, então a coluna
  //     seguinte começa exatamente uma tela à direita (fica fora da tela)
  //   - o passo do translate é (coluna + gap) = 2x a largura da viewport
  // assim nenhuma fração da próxima coluna aparece antes de virar a página.
  // Geometria de paginação por colunas — versão sem gap, que é a robusta:
  //   - cada coluna tem a largura EXATA do viewport (uma coluna = uma página)
  //   - columnGap = 0 (o respiro lateral vem do padding interno do conteúdo)
  //   - o passo do translate é exatamente a largura do viewport
  // Sem gap não há como a contagem de páginas e o translate dessincronizarem
  // (foi o que causava páginas em branco e deslocamento).
  const recompute = useCallback(() => {
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;
    const w = vp.clientWidth;
    // nº de páginas = largura total do conteúdo dividida pela largura de uma tela
    const total = Math.max(1, Math.round(content.scrollWidth / w));
    setMetrics({ colWidth: w, gap: 0, step: w });
    setPageCount(total);
    setPage((p) => Math.min(p, total - 1));
  }, []);

  useEffect(() => {
    if (!html) return;
    recompute();
    const ro = new ResizeObserver(recompute);
    if (viewportRef.current) ro.observe(viewportRef.current);
    return () => ro.disconnect();
  }, [html, recompute, prefs.fontScale, prefs.serif]);

  // restaura posição: maior entre servidor (sincroniza entre aparelhos) e local
  useEffect(() => {
    if (!html || pageCount <= 1) return;
    let local = 0;
    try {
      const saved = localStorage.getItem(posKey(bookId));
      if (saved !== null) local = parseInt(saved, 10) || 0;
    } catch {}
    const start = Math.min(Math.max(initialPosition, local), pageCount - 1);
    setPage(Math.max(0, start));
    setPosLoaded(true);
  }, [html, pageCount, bookId, initialPosition]);

  // salva posição: só após carregar a inicial (não sobrescreve outro aparelho)
  useEffect(() => {
    if (!html || !posLoaded) return;
    try { localStorage.setItem(posKey(bookId), String(page)); } catch {}
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => { saveProgress(bookId, page); }, 1500);
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [page, bookId, html, posLoaded]);

  const go = useCallback((dir: number) => {
    setPage((p) => Math.max(0, Math.min(pageCount - 1, p + dir)));
  }, [pageCount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const onTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const w = e.currentTarget.clientWidth;
    if (x < w * 0.33) go(-1);
    else if (x > w * 0.67) go(1);
    else setChromeVisible((v) => !v);
  };

  const bodyFont = prefs.serif
    ? 'Georgia, "Iowan Old Style", "Palatino Linotype", serif'
    : '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

  const offset = -(page * metrics.step);
  const progress = pageCount > 1 ? page / (pageCount - 1) : 0;

  if (error) {
    return (
      <div style={errBox(t)}>
        <p style={{ marginBottom: '1rem' }}>Não foi possível abrir este livro.</p>
        <p style={{ color: t.muted, fontSize: '0.85rem' }}>{error}</p>
        <a href="/" style={{ color: t.accent, marginTop: '1.5rem', display: 'inline-block' }}>
          Voltar à biblioteca
        </a>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      background: t.bg, color: t.fg, transition: 'background 0.4s, color 0.4s',
      fontFamily: bodyFont,
    }}>
      <div ref={viewportRef} onClick={onTap} style={{
        position: 'absolute', inset: 0,
        boxSizing: 'border-box', cursor: 'pointer',
        overflow: 'hidden',   // mascara as colunas fora da tela
      }}>
        {html ? (
          <div ref={contentRef} className="reader-content" style={{
            height: '100%',
            // cada coluna = largura exata do viewport; gap zero. O respiro
            // lateral (margem de leitura) vem do padding interno aplicado via
            // CSS na .reader-content. Sem gap, translate e contagem batem.
            columnWidth: metrics.colWidth ? `${metrics.colWidth}px` : undefined,
            columnGap: 0,
            columnFill: 'auto',
            transform: `translateX(${offset}px)`,
            transition: 'transform 0.35s cubic-bezier(0.4,0,0.2,1)',
            fontSize: `${1.15 * prefs.fontScale}rem`,
            lineHeight: 1.7,
          }} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div style={{ ...center, color: t.muted, gap: '0.6rem' }}>
            <span className="leitor-spinner" style={{ color: t.accent }} /> Carregando…
          </div>
        )}
      </div>

      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, pointerEvents: 'none' }}>
        <div style={{
          height: '100%', width: `${progress * 100}%`,
          background: t.accent, opacity: 0.5, transition: 'width 0.35s ease',
        }} />
      </div>

      <div style={{
        position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center',
        fontSize: '0.7rem', letterSpacing: '0.08em', color: t.muted,
        opacity: chromeVisible ? 0 : 0.55, transition: 'opacity 0.3s',
        pointerEvents: 'none', fontFamily: 'system-ui, sans-serif',
      }}>
        {page + 1} / {pageCount}
      </div>

      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, padding: '1rem 1.25rem',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: `linear-gradient(${t.bg}, transparent)`,
        opacity: chromeVisible ? 1 : 0,
        transform: chromeVisible ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'opacity 0.3s, transform 0.3s',
        fontFamily: 'system-ui, sans-serif',
      }}>
        <a href="/" style={{
          fontSize: '0.85rem', letterSpacing: '0.05em', color: t.muted,
          textDecoration: 'none',
        }}>‹ {title}</a>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Ctrl t={t} onClick={() => updatePrefs({ fontScale: Math.max(0.7, prefs.fontScale - 0.1) })}>A−</Ctrl>
          <Ctrl t={t} onClick={() => updatePrefs({ fontScale: Math.min(1.6, prefs.fontScale + 0.1) })}>A+</Ctrl>
          <Ctrl t={t} onClick={() => updatePrefs({ serif: !prefs.serif })}>{prefs.serif ? 'Serif' : 'Sans'}</Ctrl>
          <Ctrl t={t} onClick={() => updatePrefs({ theme: prefs.theme === 'dark' ? 'sepia' : 'dark' })}>
            {prefs.theme === 'dark' ? '◐' : '◑'}
          </Ctrl>
        </div>
      </div>

      <style>{`
        .reader-content {
          /* respiro vertical: empurra o conteúdo do topo/base de cada coluna */
          padding-block: clamp(2rem, 6vw, 5rem);
        }
        /* respiro lateral (medida de linha) aplicado a cada bloco — funciona em
           TODAS as colunas, ao contrário de padding no container de colunas que
           só afeta a primeira/última. */
        .reader-content h1,
        .reader-content h2,
        .reader-content p {
          padding-inline: clamp(1.5rem, 9vw, 8rem);
          box-sizing: border-box;
        }
        .reader-content h1 {
          font-size: 1.6em; font-weight: 600; line-height: 1.2;
          margin: 0 0 0.8em; letter-spacing: -0.01em;
        }
        .reader-content h2 {
          font-size: 1.15em; font-weight: 600; line-height: 1.3;
          margin: 1.8em 0 0.6em; color: ${t.fg};
        }
        .reader-content p { margin: 0; text-align: justify; hyphens: auto; text-indent: 1.4em; }
        .reader-content h1 + p, .reader-content h2 + p { text-indent: 0; }
      `}</style>
    </div>
  );
}

const center: React.CSSProperties = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function errBox(t: typeof THEMES.dark): React.CSSProperties {
  return {
    position: 'fixed', inset: 0, background: t.bg, color: t.fg,
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', textAlign: 'center', padding: '2rem',
    fontFamily: 'system-ui, sans-serif',
  };
}

function Ctrl({ children, onClick, t }: {
  children: React.ReactNode; onClick: () => void; t: typeof THEMES.dark;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        background: 'transparent', border: `1px solid ${t.muted}44`,
        color: t.fg, borderRadius: 6, padding: '0.3rem 0.6rem',
        fontSize: '0.8rem', cursor: 'pointer', minWidth: 36, fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}
