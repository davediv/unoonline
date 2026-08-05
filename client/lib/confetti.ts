/**
 * Confetti for a won round, in the four card colours.
 *
 * A throwaway canvas on top of everything, animated for a second and a half
 * and then removed. No dependency, no lingering DOM.
 */

import { prefersReducedMotion } from './prefs';

const COLORS = ['#e4322b', '#f5b222', '#2fa84f', '#227fd6', '#f2f4f7'];
const DURATION = 1600;

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  width: number;
  height: number;
  color: string;
}

export function burstConfetti(count = 90): void {
  if (prefersReducedMotion()) return;
  if (typeof document === 'undefined') return;

  const canvas = document.createElement('canvas');
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(ratio, ratio);

  const bits: Bit[] = Array.from({ length: count }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
    const speed = 7 + Math.random() * 9;
    return {
      x: width / 2 + (Math.random() - 0.5) * 140,
      y: height * 0.52,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: (Math.random() - 0.5) * 0.4,
      angle: Math.random() * Math.PI,
      width: 6 + Math.random() * 6,
      height: 9 + Math.random() * 8,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  });

  const started = performance.now();

  const frame = (now: number) => {
    const elapsed = now - started;
    if (elapsed > DURATION) {
      canvas.remove();
      return;
    }
    ctx.clearRect(0, 0, width, height);
    const fade = Math.max(0, 1 - elapsed / DURATION);

    for (const bit of bits) {
      bit.vy += 0.36; // gravity
      bit.vx *= 0.995;
      bit.x += bit.vx;
      bit.y += bit.vy;
      bit.angle += bit.spin;

      ctx.save();
      ctx.translate(bit.x, bit.y);
      ctx.rotate(bit.angle);
      ctx.globalAlpha = fade;
      ctx.fillStyle = bit.color;
      ctx.fillRect(-bit.width / 2, -bit.height / 2, bit.width, bit.height);
      ctx.restore();
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}
