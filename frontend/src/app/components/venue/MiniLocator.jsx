'use client';

import { useEffect, useRef } from 'react';

/**
 * Where you are in the room, at a glance: every seat as a dot, the stage as a
 * bar, the chosen seat as a pin. Drawn on a canvas, because a stadium is tens
 * of thousands of dots and an SVG of that many nodes stalls a phone.
 */
export default function MiniLocator({ model, seatId, colorFor, colorKey, className = '' }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !model) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 160;
    const h = canvas.clientHeight || 120;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const r = model.radius + 2;
    const scale = Math.min(w, h) / (r * 2);
    const px = (x) => w / 2 + x * scale;
    const pz = (z) => h / 2 + z * scale;

    for (const z of model.zones) {
      if (z.kind !== 'stage') continue;
      ctx.save();
      ctx.translate(px(z.x), pz(z.z));
      ctx.rotate(-z.rot);
      ctx.fillStyle = '#1b2a2e';
      ctx.fillRect((-z.w / 2) * scale, (-z.d / 2) * scale, z.w * scale, z.d * scale);
      ctx.restore();
    }

    const dot = Math.max(0.8, Math.min(2.4, 0.3 * scale));
    let pin = null;
    for (const s of model.seats) {
      if (s.id === seatId) pin = s;
      ctx.fillStyle = colorFor(s);
      ctx.fillRect(px(s.x) - dot / 2, pz(s.z) - dot / 2, dot, dot);
    }
    if (pin) {
      const x = px(pin.x);
      const y = pz(pin.z);
      ctx.fillStyle = 'rgba(13,91,94,0.25)';
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0d5b5e';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }, [model, seatId, colorFor, colorKey]);

  return <canvas ref={ref} className={`block ${className}`} aria-hidden="true" />;
}
