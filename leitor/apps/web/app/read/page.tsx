'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Reader from './Reader';
import ImageReader from './ImageReader';
import { getBook, type Book } from '@/app/lib/api';

function ReaderPage() {
  const params = useSearchParams();
  const id = params.get('id');
  const [book, setBook] = useState<Book | null>(null);

  useEffect(() => {
    if (!id) return;
    getBook(id).then(setBook).catch(() => setBook(null));
  }, [id]);

  if (!id) {
    return (
      <div style={fallback}>
        Nenhum livro selecionado. <a href="/" style={{ color: '#c9a86a' }}>Voltar</a>
      </div>
    );
  }

  // enquanto não sabemos o modo, mostra loading
  if (!book) {
    return <div style={fallback}>Carregando…</div>;
  }

  // escolhe o leitor conforme o modo do livro
  if (book.mode === 'image') {
    // marcações de página normal vêm do servidor (sincronizam entre dispositivos)
    let initialNormal: number[] = [];
    try { initialNormal = JSON.parse(book.normal_pages_json || '[]'); } catch {}
    return <ImageReader bookId={id} title={book.title} initialNormalPages={initialNormal} initialPosition={book.reading_position ?? 0} />;
  }
  return <Reader bookId={id} title={book.title} initialPosition={book.reading_position ?? 0} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div style={fallback}>Carregando…</div>}>
      <ReaderPage />
    </Suspense>
  );
}

const fallback: React.CSSProperties = {
  position: 'fixed', inset: 0, background: '#0d0d0f', color: '#6b6862',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'system-ui, sans-serif',
};
