import { useEffect, type RefObject } from 'react';

export function useLobViz(canvasRef: RefObject<HTMLCanvasElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const canvasOrNull = canvasRef.current;
    if (!canvasOrNull) return;
    const canvas: HTMLCanvasElement = canvasOrNull;

    interface Agent {
      id: string;
      col: string;
      pnl: number[];
      drift: number;
    }

    interface OrderLevel {
      p: number;
      q: number;
    }

    let bids: OrderLevel[] = [];
    let asks: OrderLevel[] = [];
    let fr = 0;
    const AGENTS: Agent[] = [
      { id: '0x7f4a', col: '#E8A020', pnl: [0], drift: 0.02 },
      { id: 'Orion',  col: '#00C8F0', pnl: [0], drift: -0.01 },
      { id: 'Fox',    col: '#9B7FFF', pnl: [0], drift: 0.01 },
      { id: 'Kappa',  col: '#22DD88', pnl: [0], drift: 0.00 },
      { id: 'Delta',  col: '#FF6677', pnl: [0], drift: -0.02 },
    ];

    let lastW = 0, lastH = 0;

    function getCtx(): CanvasRenderingContext2D {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth || 680;
      const h = canvas.offsetHeight || 400;
      if (w !== lastW || h !== lastH) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        lastW = w;
        lastH = h;
        const c = canvas.getContext('2d')!;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.scale(dpr, dpr);
      }
      return canvas.getContext('2d')!;
    }

    function initBook() {
      const m = 100 + Math.random() * 0.5;
      bids = Array.from({ length: 8 }, (_, i) => ({ p: m - 0.03 * (i + 1), q: 100 + Math.random() * 700 }));
      asks = Array.from({ length: 8 }, (_, i) => ({ p: m + 0.03 * (i + 1), q: 100 + Math.random() * 700 }));
    }

    function draw() {
      const ctx = getCtx();
      const W = canvas.offsetWidth || 680;
      const H = canvas.offsetHeight || 400;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0B0B18';
      ctx.fillRect(0, 0, W, H);

      // ── Order book (left 46%) ──
      const mx = Math.max(...bids.map(b => b.q), ...asks.map(a => a.q));
      const rH = 18, sY = 28, bW = W * 0.40;
      const mid = (bids[0].p + asks[0].p) / 2;
      ctx.fillStyle = '#333350';
      ctx.font = `400 10px 'JetBrains Mono',monospace`;
      ctx.fillText('PRICE', 14, sY);
      ctx.textAlign = 'right';
      ctx.fillText('SIZE', W * 0.43, sY);
      ctx.textAlign = 'left';
      asks.slice().reverse().forEach((a, i) => {
        const y = sY + 8 + (8 - i) * rH;
        ctx.fillStyle = 'rgba(255,68,85,0.1)';
        ctx.fillRect(W * 0.43 - bW * (a.q / mx), y - 12, bW * (a.q / mx), rH - 2);
        ctx.fillStyle = `rgba(255,100,120,${0.5 + i * 0.06})`;
        ctx.font = `400 11px 'JetBrains Mono',monospace`;
        ctx.fillText(a.p.toFixed(2), 14, y);
        ctx.textAlign = 'right';
        ctx.fillText(String(Math.round(a.q)), W * 0.43, y);
        ctx.textAlign = 'left';
      });
      const spY = sY + 8 + 9 * rH;
      ctx.strokeStyle = '#1A1A30';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, spY - 8);
      ctx.lineTo(W * 0.46, spY - 8);
      ctx.stroke();
      ctx.fillStyle = '#444460';
      ctx.font = `400 10px 'JetBrains Mono',monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`MID ${mid.toFixed(2)}  spd ${(asks[0].p - bids[0].p).toFixed(2)}`, W * 0.23, spY);
      ctx.textAlign = 'left';
      bids.forEach((b, i) => {
        const y = spY + 8 + i * rH;
        ctx.fillStyle = 'rgba(34,221,136,0.1)';
        ctx.fillRect(W * 0.43 - bW * (b.q / mx), y - 12, bW * (b.q / mx), rH - 2);
        ctx.fillStyle = `rgba(34,221,136,${1 - 0.1 * i})`;
        ctx.font = `400 11px 'JetBrains Mono',monospace`;
        ctx.fillText(b.p.toFixed(2), 14, y);
        ctx.textAlign = 'right';
        ctx.fillText(String(Math.round(b.q)), W * 0.43, y);
        ctx.textAlign = 'left';
      });

      // Vertical divider
      ctx.strokeStyle = '#1A1A30';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(W * 0.47, 12);
      ctx.lineTo(W * 0.47, H - 12);
      ctx.stroke();
      ctx.setLineDash([]);

      // ── Multi-agent PnL chart (right 50%) ──
      const cX = W * 0.49, cW = W * 0.49, cH = H * 0.6, cY = H * 0.08;

      // Header
      ctx.fillStyle = '#333350';
      ctx.font = `400 10px 'JetBrains Mono',monospace`;
      ctx.fillText('AGENT PnL  (cumulative · ETH)', cX, cY - 8);

      // Zero baseline
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(cX, cY + cH / 2);
      ctx.lineTo(cX + cW, cY + cH / 2);
      ctx.stroke();

      // Compute shared scale across all agents
      const allVals = AGENTS.flatMap(a => a.pnl);
      const minV = Math.min(...allVals, -0.5);
      const maxV = Math.max(...allVals, 0.5);
      const rangeV = maxV - minV || 1;

      // Draw each agent's line
      AGENTS.forEach(ag => {
        if (ag.pnl.length < 2) return;
        ctx.strokeStyle = ag.col;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        const n = ag.pnl.length;
        ag.pnl.forEach((v, i) => {
          const x = cX + i * (cW / (n - 1));
          const y = cY + cH - (v - minV) / rangeV * cH;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
        const lx = cX + cW;
        const ly = cY + cH - (ag.pnl[n - 1] - minV) / rangeV * cH;
        ctx.beginPath();
        ctx.arc(lx, ly, 3, 0, Math.PI * 2);
        ctx.fillStyle = ag.col;
        ctx.fill();
      });

      // Legend + last value
      const legY = cY + cH + 18;
      AGENTS.forEach((ag, i) => {
        const lx = cX + i * (cW / AGENTS.length);
        const last = ag.pnl[ag.pnl.length - 1];
        ctx.fillStyle = ag.col;
        ctx.font = `500 9px 'JetBrains Mono',monospace`;
        ctx.fillText(ag.id, lx, legY);
        ctx.fillStyle = last >= 0 ? '#22DD88' : '#FF4455';
        ctx.font = `400 9px 'JetBrains Mono',monospace`;
        ctx.fillText((last >= 0 ? '+' : '') + last.toFixed(2), lx, legY + 13);
      });

      // Update book + PnL each frame
      if (fr % 40 === 0) initBook();
      else {
        bids.forEach(b => { b.q = Math.max(50, b.q + (Math.random() - 0.5) * 50); });
        asks.forEach(a => { a.q = Math.max(50, a.q + (Math.random() - 0.5) * 50); });
      }
      if (fr % 4 === 0) {
        AGENTS.forEach(ag => {
          ag.drift = ag.drift * 0.92 + (Math.random() - 0.5) * 0.06;
          if (Math.random() < 0.05) ag.drift += (Math.random() - 0.5) * 0.3;
          const prev = ag.pnl[ag.pnl.length - 1];
          ag.pnl.push(prev + ag.drift + (Math.random() - 0.5) * 0.12);
          // never shift — always keep origin point so curve starts at 0
        });
      }
      fr++;
    }

    initBook();
    const interval = setInterval(() => { draw(); }, 80);

    const handleResize = () => { lastW = 0; };
    window.addEventListener('resize', handleResize);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', handleResize);
    };
  }, [active, canvasRef]);
}
