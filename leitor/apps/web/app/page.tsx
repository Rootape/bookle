'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  listBooks, uploadBook, deleteBook, editBook, uploadCover, coverUrl,
  type Book, type ImportMode,
} from '@/app/lib/api';

const C = {
  bg: '#0d0d0f', fg: '#d8d4cc', muted: '#6b6862', accent: '#c9a86a',
  card: '#16161a', line: '#26262c',
};

const STATUS_LABEL: Record<Book['status'], string> = {
  pending: 'na fila', processing: 'processando', ready: 'pronto', failed: 'falhou',
};

const MODE_INFO: { id: ImportMode; label: string; desc: string }[] = [
  { id: 'auto', label: 'Automático', desc: 'Detecta sozinho: texto para PDFs digitais, imagem para scans.' },
  { id: 'text', label: 'Texto', desc: 'Extrai o texto e deixa você ajustar fonte e tamanho. Melhor para PDFs digitais.' },
  { id: 'image', label: 'Imagem', desc: 'Lê o livro como ele é, página por página, com tema escuro. Ideal para livros ilustrados ou OCR difícil.' },
];

const PAGE_SIZE = 12;   // cards renderizados por "página" do scroll infinito

export default function Library() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // 'query' = o que está sendo digitado (alimenta o dropdown de sugestões).
  // 'applied' = o termo confirmado com Enter (filtra a grid de baixo).
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [modePicker, setModePicker] = useState(false);
  const [pendingMode, setPendingMode] = useState<ImportMode>('auto');
  const [editing, setEditing] = useState<Book | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try { setBooks(await listBooks()); setErr(null); }
    catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    refresh();
    const iv = setInterval(() => {
      setBooks((cur) => {
        if (cur.some((b) => b.status === 'pending' || b.status === 'processing')) refresh();
        return cur;
      });
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  // ORDENAÇÃO: livros em andamento primeiro, depois não-iniciados, por fim os
  // terminados. Dentro de cada grupo, atualizados mais recentemente primeiro.
  // Roda antes do filtro de busca — busca filtra, isto ordena o que sobra.
  function readingRank(b: Book): number {
    const total = b.page_count ?? 0;
    const pos = b.reading_position ?? 0;
    if (total > 0 && pos > 0) {
      const pct = pos / total;
      if (pct >= 0.98) return 2;   // praticamente terminado → por último
      return 0;                    // em andamento → primeiro
    }
    return 1;                      // não-iniciado → meio
  }

  const ordered = useMemo(() => {
    return [...books].sort((a, b) => {
      const ra = readingRank(a), rb = readingRank(b);
      if (ra !== rb) return ra - rb;
      // desempate: mais recente primeiro
      return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
    });
  }, [books]);

  // SUGESTÕES (dropdown): usa o que está sendo digitado, limitado a poucos.
  const SUGGEST_LIMIT = 7;
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return ordered.filter((b) =>
      b.title.toLowerCase().includes(q) ||
      (b.author ?? '').toLowerCase().includes(q)
    );
  }, [ordered, query]);

  // FILTRO da GRID: usa o termo CONFIRMADO com Enter (applied), não o digitado.
  // A busca varre a lista completa; a paginação vem depois, sobre o resultado.
  const filtered = useMemo(() => {
    const q = applied.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((b) =>
      b.title.toLowerCase().includes(q) ||
      (b.author ?? '').toLowerCase().includes(q)
    );
  }, [ordered, applied]);

  // PAGINAÇÃO DEPOIS: só recorta quantos dos resultados filtrados renderizar.
  const shown = filtered.slice(0, visible);

  // ao mudar a busca, reseta o quanto está visível
  useEffect(() => { setVisible(PAGE_SIZE); }, [applied]);

  // abre o dropdown ao digitar; fecha ao limpar
  useEffect(() => { setDropdownOpen(query.trim().length > 0); }, [query]);

  // fecha o dropdown ao clicar fora
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Enter: aplica o termo na grid e fecha o dropdown
  function applySearch() {
    setApplied(query);
    setDropdownOpen(false);
  }

  function clearSearch() {
    setQuery('');
    setApplied('');
    setDropdownOpen(false);
  }

  // scroll infinito: quando a sentinela aparece, mostra mais
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisible((v) => Math.min(v + PAGE_SIZE, filtered.length));
      }
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length]);

  function chooseMode(mode: ImportMode) {
    setPendingMode(mode);
    setModePicker(false);
    fileRef.current?.click();
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try { await uploadBook(file, pendingMode); await refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function onDelete(id: string) {
    await deleteBook(id);
    refresh();
  }

  return (
    <main style={{
      minHeight: '100vh', background: C.bg, color: C.fg,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      // safe-area no topo: no PWA em tela cheia (standalone), o conteúdo vai até
      // o topo atrás da barra de status/notch. O max() garante o respiro normal
      // no desktop e o espaço da safe-area no iPhone.
      padding: 'calc(clamp(1.5rem, 5vw, 4rem) + env(safe-area-inset-top)) max(clamp(1.5rem, 5vw, 4rem), env(safe-area-inset-right)) clamp(1.5rem, 5vw, 4rem) max(clamp(1.5rem, 5vw, 4rem), env(safe-area-inset-left))',
      maxWidth: 1100, margin: '0 auto',
    }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 600, fontSize: '1.8rem', letterSpacing: '-0.01em', margin: 0 }}>
          Biblioteca
        </h1>
        <button onClick={() => setModePicker(true)} disabled={uploading} style={{
          background: C.accent, color: '#1a1408', border: 'none', borderRadius: 8,
          padding: '0.55rem 1.1rem', fontSize: '0.9rem', fontWeight: 600,
          cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1,
        }}>
          {uploading ? 'Enviando…' : '+ Adicionar PDF'}
        </button>
        <input ref={fileRef} type="file" accept="application/pdf" onChange={onPick} style={{ display: 'none' }} />
      </header>

      {/* busca */}
      <div ref={searchRef} style={{ position: 'relative', marginBottom: '2rem' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (query.trim()) setDropdownOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applySearch();
            if (e.key === 'Escape') setDropdownOpen(false);
          }}
          placeholder="Buscar por título ou autor"
          style={{
            width: '100%', boxSizing: 'border-box',
            background: C.card, border: `1px solid ${C.line}`, borderRadius: 10,
            padding: '0.7rem 1rem 0.7rem 2.6rem', fontSize: '0.95rem',
            color: C.fg, outline: 'none', fontFamily: 'inherit',
          }}
        />
        <span style={{ position: 'absolute', left: '0.9rem', top: '0.7rem', color: C.muted, fontSize: '1rem' }}>⌕</span>
        {query && (
          <button onClick={clearSearch} style={{
            position: 'absolute', right: '0.7rem', top: '0.55rem',
            background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: '1.1rem',
          }}>×</button>
        )}

        {/* dropdown de sugestões (estilo Spotify) — prévia ao digitar */}
        {dropdownOpen && suggestions.length > 0 && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 0.4rem)', left: 0, right: 0, zIndex: 50,
            background: C.card, border: `1px solid ${C.line}`, borderRadius: 10,
            overflow: 'hidden', boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          }}>
            {suggestions.slice(0, SUGGEST_LIMIT).map((b) => (
              <a key={b.id}
                href={b.status === 'ready' ? `/read/?id=${b.id}` : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.55rem 0.8rem', textDecoration: 'none', color: C.fg,
                  cursor: b.status === 'ready' ? 'pointer' : 'default',
                  borderBottom: `1px solid ${C.line}`,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.bg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ width: 34, height: 50, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: C.bg, border: `1px solid ${C.line}` }}>
                  <img src={coverUrl(b.id, b.updated_at)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0'; }} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '0.88rem', fontFamily: 'Georgia, serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.title}
                  </div>
                  {b.author && (
                    <div style={{ fontSize: '0.76rem', color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {b.author}
                    </div>
                  )}
                </div>
              </a>
            ))}
            {/* rodapé: ver todos na grid (= Enter) */}
            <button onClick={applySearch} style={{
              display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
              border: 'none', color: C.accent, padding: '0.6rem 0.8rem', fontSize: '0.82rem',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Ver todos os {suggestions.length} resultados
            </button>
          </div>
        )}
        {dropdownOpen && query.trim() && suggestions.length === 0 && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 0.4rem)', left: 0, right: 0, zIndex: 50,
            background: C.card, border: `1px solid ${C.line}`, borderRadius: 10,
            padding: '0.8rem', fontSize: '0.85rem', color: C.muted,
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          }}>
            Nenhum livro encontrado para “{query}”.
          </div>
        )}
      </div>

      {err && (
        <p style={{ color: '#c97a6a', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          {err} — a API está rodando?
        </p>
      )}

      {loading ? (
        <p style={{ color: C.muted, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span className="leitor-spinner" style={{ color: C.accent }} /> Carregando…
        </p>
      ) : filtered.length === 0 ? (
        <EmptyState hasBooks={books.length > 0} query={applied} />
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: '1.5rem 1.25rem',
          }}>
            {shown.map((b) => (
              <BookCard key={b.id} book={b} onEdit={() => setEditing(b)} onDelete={() => onDelete(b.id)} />
            ))}
          </div>
          {/* sentinela do scroll infinito */}
          {visible < filtered.length && (
            <div ref={sentinelRef} style={{ height: 40, marginTop: '1.5rem' }} />
          )}
        </>
      )}

      {modePicker && <ModePicker onPick={chooseMode} onClose={() => setModePicker(false)} />}
      {editing && (
        <EditModal
          book={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setBooks((cur) => cur.map((x) => (x.id === updated.id ? updated : x)));
            setEditing(null);
          }}
        />
      )}
    </main>
  );
}

// ---- Card de livro ----
function BookCard({ book, onEdit, onDelete }: { book: Book; onEdit: () => void; onDelete: () => void }) {
  const ready = book.status === 'ready';
  const [imgOk, setImgOk] = useState(true);
  // quando o livro termina de processar, o updated_at muda — reseta o estado da
  // imagem pra tentar carregar a capa de novo (sem precisar recarregar a página).
  useEffect(() => { setImgOk(true); }, [book.updated_at]);
  const progress = ready && book.page_count
    ? Math.min(100, Math.round((book.reading_position / Math.max(1, book.page_count)) * 100))
    : 0;

  return (
    <div style={{ position: 'relative' }}>
      <a
        href={ready ? `/read/?id=${book.id}` : undefined}
        style={{ textDecoration: 'none', color: 'inherit', cursor: ready ? 'pointer' : 'default', display: 'block' }}
      >
        {/* capa */}
        <div style={{
          position: 'relative', aspectRatio: '2 / 3', borderRadius: 8, overflow: 'hidden',
          background: C.card, border: `1px solid ${C.line}`, marginBottom: '0.6rem',
          opacity: ready ? 1 : 0.55,
        }}>
          {ready && imgOk ? (
            <img
              src={coverUrl(book.id, book.updated_at)}
              alt={book.title}
              onError={() => setImgOk(false)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : ready && !imgOk ? (
            // pronto mas sem capa disponível → fallback com o título
            <div style={{
              width: '100%', height: '100%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', padding: '1rem', textAlign: 'center',
              fontFamily: 'Georgia, serif', fontSize: '0.95rem', color: C.muted,
            }}>
              {book.title}
            </div>
          ) : (
            // ainda processando → área limpa (o spinner abaixo cobre)
            null
          )}
          {/* progresso */}
          {progress > 0 && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'rgba(0,0,0,0.4)' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: C.accent }} />
            </div>
          )}
          {!ready && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
              fontSize: '0.78rem', color: C.muted, background: 'rgba(13,13,15,0.55)',
            }}>
              {book.status === 'failed'
                ? <span style={{ color: '#c97a6a' }}>falhou</span>
                : <>
                    <span className="leitor-spinner" style={{ color: C.accent }} />
                    <span>{STATUS_LABEL[book.status]}</span>
                  </>}
            </div>
          )}
        </div>
        {/* título + autor */}
        <div style={{ fontFamily: 'Georgia, serif', fontSize: '0.92rem', lineHeight: 1.25, marginBottom: '0.15rem',
          overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {book.title}
        </div>
        {book.author && (
          <div style={{ fontSize: '0.78rem', color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {book.author}
          </div>
        )}
        {progress > 0 && (
          <div style={{ fontSize: '0.72rem', color: C.accent, marginTop: '0.15rem' }}>{progress}% lido</div>
        )}
      </a>
      {/* menu de ações */}
      <CardMenu onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

function CardMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'absolute', top: 6, right: 6 }}>
      <button onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }} style={{
        background: 'rgba(13,13,15,0.7)', border: 'none', color: C.fg, borderRadius: 6,
        width: 28, height: 28, cursor: 'pointer', fontSize: '1rem', lineHeight: 1,
      }}>⋯</button>
      {open && (
        <>
          <div onClick={(e) => { e.preventDefault(); setOpen(false); }} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
          <div style={{
            position: 'absolute', top: 32, right: 0, zIndex: 11, background: C.card,
            border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden', minWidth: 120,
          }}>
            <button onClick={(e) => { e.preventDefault(); setOpen(false); onEdit(); }} style={menuItem}>Editar</button>
            <button onClick={(e) => { e.preventDefault(); setOpen(false); onDelete(); }} style={{ ...menuItem, color: '#c97a6a' }}>Remover</button>
          </div>
        </>
      )}
    </div>
  );
}

const menuItem: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
  border: 'none', color: C.fg, padding: '0.55rem 0.9rem', fontSize: '0.85rem',
  cursor: 'pointer', fontFamily: 'inherit',
};

// ---- Modal de edição ----
function EditModal({ book, onClose, onSaved }: { book: Book; onClose: () => void; onSaved: (b: Book) => void }) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const [coverV, setCoverV] = useState(book.updated_at);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const updated = await editBook(book.id, { title, author });
      onSaved(updated);
    } catch (e) { setErr((e as Error).message); setSaving(false); }
  }

  async function onCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true); setErr(null);
    try {
      const updated = await uploadCover(book.id, file);
      setCoverV(updated.updated_at);
      onSaved(updated);
      setSaving(false);
    } catch (e) { setErr((e as Error).message); setSaving(false); }
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalBox, maxWidth: 480 }}>
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.1rem', fontFamily: 'Georgia, serif' }}>Editar livro</h2>
        <div style={{ display: 'flex', gap: '1.25rem' }}>
          {/* capa */}
          <div>
            <div style={{ width: 110, aspectRatio: '2 / 3', borderRadius: 6, overflow: 'hidden', background: C.bg, border: `1px solid ${C.line}` }}>
              <img src={coverUrl(book.id, coverV)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0'; }} />
            </div>
            <button onClick={() => coverInput.current?.click()} style={{ ...secondaryBtn, marginTop: '0.5rem', width: 110 }}>
              Trocar capa
            </button>
            <input ref={coverInput} type="file" accept="image/*" onChange={onCover} style={{ display: 'none' }} />
          </div>
          {/* campos */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label style={fieldLabel}>Título
              <input value={title} onChange={(e) => setTitle(e.target.value)} style={fieldInput} />
            </label>
            <label style={fieldLabel}>Autor
              <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="—" style={fieldInput} />
            </label>
          </div>
        </div>
        {err && <p style={{ color: '#c97a6a', fontSize: '0.82rem', marginTop: '1rem' }}>{err}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.5rem' }}>
          <button onClick={onClose} style={secondaryBtn}>Cancelar</button>
          <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}

// ---- Seletor de modo ----
function ModePicker({ onPick, onClose }: { onPick: (m: ImportMode) => void; onClose: () => void }) {
  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modalBox}>
        <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.1rem', fontFamily: 'Georgia, serif' }}>Como importar este livro?</h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.85rem', color: C.muted, lineHeight: 1.5 }}>
          Escolha como o PDF deve ser lido. Você pode ter livros diferentes em modos diferentes.
        </p>
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {MODE_INFO.map((m) => (
            <button key={m.id} onClick={() => onPick(m.id)} style={{
              textAlign: 'left', background: 'transparent', color: C.fg,
              border: `1px solid ${C.line}`, borderRadius: 10, padding: '0.85rem 1rem', cursor: 'pointer',
            }}>
              <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.2rem' }}>{m.label}</div>
              <div style={{ fontSize: '0.8rem', color: C.muted, lineHeight: 1.45 }}>{m.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ hasBooks, query }: { hasBooks: boolean; query: string }) {
  if (hasBooks && query) {
    return <p style={{ color: C.muted, lineHeight: 1.6 }}>Nenhum livro encontrado para “{query}”.</p>;
  }
  return (
    <p style={{ color: C.muted, lineHeight: 1.6 }}>
      Nenhum livro ainda. Adicione um PDF para começar — ele será convertido para o formato de leitura automaticamente.
    </p>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1.5rem',
};
const modalBox: React.CSSProperties = {
  background: C.card, borderRadius: 14, padding: '1.75rem', maxWidth: 460, width: '100%',
  border: `1px solid ${C.line}`,
};
const fieldLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.8rem', color: C.muted };
const fieldInput: React.CSSProperties = {
  background: C.bg, border: `1px solid ${C.line}`, borderRadius: 8, padding: '0.55rem 0.7rem',
  color: C.fg, fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit',
};
const primaryBtn: React.CSSProperties = {
  background: C.accent, color: '#1a1408', border: 'none', borderRadius: 8,
  padding: '0.5rem 1.1rem', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
const secondaryBtn: React.CSSProperties = {
  background: 'transparent', color: C.fg, border: `1px solid ${C.line}`, borderRadius: 8,
  padding: '0.5rem 1rem', fontSize: '0.88rem', cursor: 'pointer', fontFamily: 'inherit',
};
