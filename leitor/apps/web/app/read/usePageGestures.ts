'use client';

import { useCallback, useRef, useState } from 'react';

// Gestos de toque para o leitor de imagem. Coordena três interações que
// precisam coexistir sem brigar:
//
//   - SWIPE (1 dedo, sem zoom): arrastar horizontal vira a página. Só vale
//     quando a escala é 1 — com zoom, o mesmo gesto vira PAN (mover a imagem).
//   - PINÇA (2 dedos): ajusta a escala (zoom).
//   - DUPLO-TOQUE: alterna entre escala 1 e ZOOM_STEP (volta a 1 se já ampliado).
//   - PAN (1 dedo, com zoom): arrasta a imagem ampliada.
//
// A regra que evita conflito: o swipe-pra-virar só dispara quando NÃO há zoom.
// Assim que a escala passa de 1, o arrasto de um dedo move a imagem em vez de
// virar a página.

const ZOOM_STEP = 2.5;          // escala do duplo-toque
const MAX_SCALE = 4;
const MIN_SCALE = 1;
const SWIPE_THRESHOLD = 60;     // px de arrasto horizontal pra contar como swipe
const DOUBLE_TAP_MS = 280;      // janela do duplo-toque

interface GestureState {
  scale: number;
  tx: number;   // deslocamento X (pan)
  ty: number;   // deslocamento Y (pan)
}

export interface PageGestures {
  scale: number;
  transform: string;
  isZoomed: boolean;
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: (e: React.TouchEvent) => void;
  };
  reset: () => void;
}

export function usePageGestures(opts: {
  onSwipeLeft: () => void;   // virou pra próxima
  onSwipeRight: () => void;  // virou pra anterior
  onTapZones: (clientX: number, width: number) => void;  // toque sem arrasto
}): PageGestures {
  const [st, setSt] = useState<GestureState>({ scale: 1, tx: 0, ty: 0 });

  // refs de rastreio do gesto em curso (não causam re-render)
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const startState = useRef<GestureState>({ scale: 1, tx: 0, ty: 0 });
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef<number>(0);
  const moved = useRef(false);
  const isPinching = useRef(false);

  const dist = (t: React.TouchList) => {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  };

  const reset = useCallback(() => setSt({ scale: 1, tx: 0, ty: 0 }), []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // início de pinça
      isPinching.current = true;
      pinchStart.current = { dist: dist(e.touches), scale: st.scale };
      start.current = null;
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, t: Date.now() };
      startState.current = st;
      moved.current = false;
    }
  }, [st]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    // pinça (2 dedos): ajusta escala
    if (e.touches.length === 2 && pinchStart.current) {
      const ratio = dist(e.touches) / pinchStart.current.dist;
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchStart.current.scale * ratio));
      setSt((s) => ({ ...s, scale: next, ...(next === 1 ? { tx: 0, ty: 0 } : {}) }));
      return;
    }
    // 1 dedo
    if (e.touches.length === 1 && start.current) {
      const t = e.touches[0];
      const dx = t.clientX - start.current.x;
      const dy = t.clientY - start.current.y;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved.current = true;

      if (startState.current.scale > 1) {
        // COM zoom: arrastar move a imagem (pan)
        setSt({
          scale: startState.current.scale,
          tx: startState.current.tx + dx,
          ty: startState.current.ty + dy,
        });
      }
      // SEM zoom: não move nada durante o arrasto; decide no touchEnd se foi swipe
    }
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    // fim de pinça
    if (isPinching.current) {
      isPinching.current = false;
      pinchStart.current = null;
      // se ficou perto de 1, normaliza
      setSt((s) => (s.scale <= 1.05 ? { scale: 1, tx: 0, ty: 0 } : s));
      return;
    }

    const s0 = start.current;
    if (!s0) return;
    const changed = e.changedTouches[0];
    const dx = changed.clientX - s0.x;
    const dy = changed.clientY - s0.y;
    const dt = Date.now() - s0.t;
    start.current = null;

    // DUPLO-TOQUE: dois toques rápidos sem arrasto
    const now = Date.now();
    if (!moved.current && dt < 250) {
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        // alterna zoom
        lastTap.current = 0;
        setSt((s) => (s.scale > 1 ? { scale: 1, tx: 0, ty: 0 } : { scale: ZOOM_STEP, tx: 0, ty: 0 }));
        return;
      }
      lastTap.current = now;
      // toque simples (sem arrasto): zonas de virar/mostrar controles.
      // só dispara se não estiver ampliado (com zoom, toque é só pra pan/duplo)
      if (startState.current.scale === 1) {
        const target = e.currentTarget as HTMLElement;
        opts.onTapZones(changed.clientX, target.clientWidth);
      }
      return;
    }

    // SWIPE horizontal: só quando NÃO ampliado
    if (startState.current.scale === 1 && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
      if (dx < 0) opts.onSwipeLeft();   // arrastou pra esquerda → próxima
      else opts.onSwipeRight();         // arrastou pra direita → anterior
    }
  }, [opts]);

  return {
    scale: st.scale,
    transform: `translate(${st.tx}px, ${st.ty}px) scale(${st.scale})`,
    isZoomed: st.scale > 1,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
    reset,
  };
}
