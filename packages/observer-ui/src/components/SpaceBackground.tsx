import { useRef, useEffect } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseOpacity: number;
  twinkleSpeed: number;
  twinkleOffset: number;
}

interface MoltBot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
}

const PARTICLE_COUNT = 70;
const BOT_COUNT = 10;
const CONNECTION_DIST = 200;
const BOT_CONNECTION_DIST = 250;

function createParticles(w: number, h: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    radius: Math.random() * 2 + 0.5,
    baseOpacity: Math.random() * 0.5 + 0.2,
    twinkleSpeed: Math.random() * 0.02 + 0.005,
    twinkleOffset: Math.random() * Math.PI * 2,
  }));
}

function createBots(w: number, h: number): MoltBot[] {
  return Array.from({ length: BOT_COUNT }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.2,
    vy: (Math.random() - 0.5) * 0.2,
    size: Math.random() * 8 + 16,
    opacity: Math.random() * 0.12 + 0.1,
  }));
}

function drawMiniBot(ctx: CanvasRenderingContext2D, bot: MoltBot) {
  const { x, y, size, opacity } = bot;
  const r = size / 2;

  ctx.save();
  ctx.globalAlpha = opacity;

  // Body
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#e94560';
  ctx.fill();

  // Highlight
  ctx.beginPath();
  ctx.ellipse(x - r * 0.2, y - r * 0.25, r * 0.45, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,107,129,0.3)';
  ctx.fill();

  // Left eye
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.05, r * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a2e';
  ctx.fill();
  // Left highlight
  ctx.beginPath();
  ctx.arc(x - r * 0.22, y - r * 0.12, r * 0.07, 0, Math.PI * 2);
  ctx.fillStyle = '#43b581';
  ctx.fill();

  // Right eye
  ctx.beginPath();
  ctx.arc(x + r * 0.3, y - r * 0.05, r * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a2e';
  ctx.fill();
  // Right highlight
  ctx.beginPath();
  ctx.arc(x + r * 0.38, y - r * 0.12, r * 0.07, 0, Math.PI * 2);
  ctx.fillStyle = '#43b581';
  ctx.fill();

  // Claw nubs
  ctx.beginPath();
  ctx.ellipse(x - r * 1.15, y + r * 0.1, r * 0.25, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#e94560';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + r * 1.15, y + r * 0.1, r * 0.25, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#e94560';
  ctx.fill();

  // Antennae
  ctx.strokeStyle = '#e94560';
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.3, y - r * 0.8);
  ctx.quadraticCurveTo(x - r * 0.35, y - r * 1.3, x - r * 0.55, y - r * 1.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + r * 0.3, y - r * 0.8);
  ctx.quadraticCurveTo(x + r * 0.35, y - r * 1.3, x + r * 0.55, y - r * 1.5);
  ctx.stroke();

  ctx.restore();
}

function wrap(val: number, max: number): number {
  if (val < -30) return max + 30;
  if (val > max + 30) return -30;
  return val;
}

export function SpaceBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{
    particles: Particle[];
    bots: MoltBot[];
    animId: number;
    time: number;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.scale(dpr, dpr);
    };

    resize();

    const w = window.innerWidth;
    const h = window.innerHeight;

    stateRef.current = {
      particles: createParticles(w, h),
      bots: createBots(w, h),
      animId: 0,
      time: 0,
    };

    const animate = () => {
      const state = stateRef.current!;
      const cw = window.innerWidth;
      const ch = window.innerHeight;

      ctx.clearRect(0, 0, cw, ch);
      state.time += 1;

      // Update & draw particles
      for (const p of state.particles) {
        p.x = wrap(p.x + p.vx, cw);
        p.y = wrap(p.y + p.vy, ch);

        const twinkle = Math.sin(state.time * p.twinkleSpeed + p.twinkleOffset) * 0.3 + 0.7;
        const alpha = p.baseOpacity * twinkle;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(67, 181, 129, ${alpha})`;
        ctx.fill();
      }

      // Update bots
      for (const bot of state.bots) {
        bot.x = wrap(bot.x + bot.vx, cw);
        bot.y = wrap(bot.y + bot.vy, ch);
      }

      // Draw network lines between bots
      for (let i = 0; i < state.bots.length; i++) {
        for (let j = i + 1; j < state.bots.length; j++) {
          const a = state.bots[i];
          const b = state.bots[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < BOT_CONNECTION_DIST) {
            const alpha = (1 - dist / BOT_CONNECTION_DIST) * 0.15;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(67, 181, 129, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      // Draw lighter lines from bots to nearby particles
      for (const bot of state.bots) {
        for (const p of state.particles) {
          const dx = bot.x - p.x;
          const dy = bot.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            const alpha = (1 - dist / CONNECTION_DIST) * 0.06;
            ctx.beginPath();
            ctx.moveTo(bot.x, bot.y);
            ctx.lineTo(p.x, p.y);
            ctx.strokeStyle = `rgba(67, 181, 129, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // Draw bots on top
      for (const bot of state.bots) {
        drawMiniBot(ctx, bot);
      }

      state.animId = requestAnimationFrame(animate);
    };

    stateRef.current.animId = requestAnimationFrame(animate);

    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(stateRef.current?.animId ?? 0);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
