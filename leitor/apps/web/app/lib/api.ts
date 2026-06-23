// Cliente da API do leitor. Um único lugar que sabe falar com o backend
// FastAPI.
//
// Resolução da URL da API (importante pro acesso mobile via Tailscale):
// o problema é que NEXT_PUBLIC_* é embutido no BUILD (valor fixo no bundle).
// Uma URL fixa não serve aos dois cenários ao mesmo tempo — no desktop o host
// é "localhost", no iPhone (via Tailscale) é um IP "100.x.y.z". Por isso, em
// runtime, derivamos a API do MESMO host que serviu a página: seja qual for o
// endereço pelo qual você abriu o leitor, a API é aquele host na porta 8000.
// Assim o mesmo build funciona no desktop e no celular sem reconfigurar.
//
// Precedência:
//   1. NEXT_PUBLIC_API_URL, se definido (override explícito, ex.: proxy)
//   2. host atual da janela + porta 8000 (caso normal, multi-dispositivo)
//   3. localhost:8000 (SSR / build, onde não há window)
function resolveApiBase(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL;
  // trata string vazia (default do build) como "não definido" — só um valor
  // real e não-vazio força a URL; caso contrário derivamos do host.
  if (fromEnv && fromEnv.trim() !== '') return fromEnv;
  if (typeof window !== 'undefined') {
    // mesmo protocolo e hostname da página, porta 8000
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8000`;
  }
  return 'http://localhost:8000';
}

const API_BASE = resolveApiBase();

export type BookStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type ImportMode = 'auto' | 'text' | 'image';

export interface Book {
  id: string;
  title: string;
  author: string | null;
  status: BookStatus;
  original_filename: string;
  cover_path: string | null;
  requested_mode: ImportMode;
  mode: 'text' | 'image' | null;
  kind: string | null;
  used_ocr: boolean;
  page_count: number | null;
  block_count: number | null;
  error_message: string | null;
  reading_position: number;
  normal_pages_json: string;
  created_at: string;
  updated_at: string;
}

// manifest do modo imagem
export interface ImagePage {
  index: number;
  file: string;
  illustration: boolean;
}
export interface ImageManifest {
  id: string;
  mode: 'image';
  title: string;
  page_count: number;
  pages: ImagePage[];
}

export async function listBooks(): Promise<Book[]> {
  const r = await fetch(`${API_BASE}/books`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Falha ao listar livros (${r.status})`);
  return r.json();
}

export async function getBook(id: string): Promise<Book> {
  const r = await fetch(`${API_BASE}/books/${id}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Livro não encontrado (${r.status})`);
  return r.json();
}

export async function getContent(id: string): Promise<string> {
  const r = await fetch(`${API_BASE}/books/${id}/content`);
  if (!r.ok) throw new Error(`Conteúdo indisponível (${r.status})`);
  return r.text();
}

export async function getManifest(id: string): Promise<ImageManifest> {
  const r = await fetch(`${API_BASE}/books/${id}/manifest`);
  if (!r.ok) throw new Error(`Manifest indisponível (${r.status})`);
  return r.json();
}

// URL de uma imagem de página (modo imagem)
export function pageImageUrl(id: string, file: string): string {
  return `${API_BASE}/books/${id}/pages/${file}`;
}

// URL da capa do livro (capa customizada → página 0 → 404). O cache-buster
// `v` força recarregar após trocar a capa.
export function coverUrl(id: string, v?: string | number): string {
  const q = v !== undefined ? `?v=${encodeURIComponent(String(v))}` : '';
  return `${API_BASE}/books/${id}/cover${q}`;
}

export async function editBook(
  id: string,
  data: { title?: string; author?: string }
): Promise<Book> {
  const r = await fetch(`${API_BASE}/books/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Falha ao salvar (${r.status})`);
  return r.json();
}

export async function uploadCover(id: string, file: File): Promise<Book> {
  const form = new FormData();
  form.append('file', file);
  const r = await fetch(`${API_BASE}/books/${id}/cover`, { method: 'PUT', body: form });
  if (!r.ok) throw new Error(`Falha ao enviar capa (${r.status})`);
  return r.json();
}

export async function uploadBook(file: File, mode: ImportMode = 'auto'): Promise<Book> {
  const form = new FormData();
  form.append('file', file);
  const r = await fetch(`${API_BASE}/books?mode=${mode}`, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`Falha no upload (${r.status})`);
  return r.json();
}

export async function saveProgress(id: string, position: number): Promise<void> {
  // best-effort: se falhar (offline), o chamador já guardou local
  await fetch(`${API_BASE}/books/${id}/progress?position=${position}`, {
    method: 'PATCH',
  }).catch(() => {});
}

export async function setNormalPages(id: string, pages: number[]): Promise<void> {
  // envia o conjunto completo de páginas marcadas como "normal" (sem negativo).
  // best-effort: se offline, a marcação local já valeu; sincroniza depois.
  await fetch(`${API_BASE}/books/${id}/normal-pages`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pages),
  }).catch(() => {});
}

export async function deleteBook(id: string): Promise<void> {
  const r = await fetch(`${API_BASE}/books/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`Falha ao remover (${r.status})`);
}

export { API_BASE };
