'use client';
import { useEffect, useRef } from 'react';

export function HeroParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let animId: number;

    type NodeType = 'g' | 'c' | 'd';
    interface Node {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      ph: number;
      sp: number;
      t: NodeType;
    }

    let nodes: Node[] = [];

    function resize() {
      W = canvas!.width = canvas!.offsetWidth;
      H = canvas!.height = canvas!.offsetHeight;
    }

    function init() {
      nodes = Array.from({ length: 38 }, (_, i) => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2.5 + 1,
        ph: Math.random() * Math.PI * 2,
        sp: Math.random() * 0.02 + 0.01,
        t: (i < 8 ? 'g' : i < 16 ? 'c' : 'd') as NodeType,
      }));
    }

    let t0: number | null = null;

    function frame(ts: number) {
      if (!t0) t0 = ts;
      const t = (ts - t0) / 1000;
      ctx!.clearRect(0, 0, W, H);

      // Draw edges
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 160) {
            const al = (1 - d / 160) * 0.18;
            ctx!.beginPath();
            ctx!.strokeStyle =
              a.t === 'g' || b.t === 'g'
                ? `rgba(232,160,32,${al})`
                : a.t === 'c' || b.t === 'c'
                  ? `rgba(0,200,240,${al * 0.8})`
                  : `rgba(80,80,120,${al * 0.5})`;
            ctx!.lineWidth = 0.5;
            ctx!.moveTo(a.x, a.y);
            ctx!.lineTo(b.x, b.y);
            ctx!.stroke();
          }
        }
      }

      // Draw nodes
      nodes.forEach((n) => {
        const p = Math.sin(t * n.sp + n.ph) * 0.5 + 0.5;
        if (n.t !== 'd') {
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, n.r * 3, 0, Math.PI * 2);
          ctx!.fillStyle =
            n.t === 'g' ? 'rgba(232,160,32,0.12)' : 'rgba(0,200,240,0.1)';
          ctx!.fill();
        }
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx!.fillStyle =
          n.t === 'g'
            ? `rgba(232,160,32,${0.5 + p * 0.5})`
            : n.t === 'c'
              ? `rgba(0,200,240,${0.4 + p * 0.4})`
              : `rgba(80,80,140,${0.2 + p * 0.2})`;
        ctx!.fill();
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
      });

      animId = requestAnimationFrame(frame);
    }

    resize();
    init();
    animId = requestAnimationFrame(frame);

    const handleResize = () => {
      resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="arena-canvas"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.6 }}
    />
  );
}
