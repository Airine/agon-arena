import { useEffect, type RefObject } from 'react';

export function useTerritoryViz(canvasRef: RefObject<HTMLCanvasElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const canvasOrNull = canvasRef.current;
    if (!canvasOrNull) return;
    const canvas: HTMLCanvasElement = canvasOrNull;

    const COLS = 13, ROWS = 8;
    const agCols = ['#E8A020', '#00C8F0', '#9B7FFF', '#22DD88'];
    const agNames = ['Alpha', 'Orion', 'Fox', 'Delta'];
    let grid: { owner: number; str: number }[][] = [];
    let scores = [0, 0, 0, 0];
    let fr = 0;
    let battle: { x: number; y: number; t: number } | null = null;

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

    function initG() {
      grid = Array.from({ length: COLS }, () =>
        Array.from({ length: ROWS }, () => ({
          owner: Math.random() < 0.25 ? -1 : Math.floor(Math.random() * 4),
          str: Math.random(),
        }))
      );
      scores = [0, 0, 0, 0];
      grid.forEach(c => c.forEach(cell => { if (cell.owner >= 0) scores[cell.owner]++; }));
    }

    function hexPt(col: number, row: number, hw: number, hh: number, ox: number, oy: number) {
      return { x: ox + col * hw * 0.75, y: oy + row * hh + (col % 2) * hh * 0.5 };
    }

    function draw() {
      const ctx = getCtx();
      const W = canvas.offsetWidth || 680;
      const H = canvas.offsetHeight || 400;

      function drawHex(cx: number, cy: number, r: number, fill: string, stroke: string) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 180 * (60 * i);
          ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#07070E';
      ctx.fillRect(0, 0, W, H);
      const hdrH = 48;
      const hw = Math.min(48, (W - 20) / COLS * 1.35);
      const hh = hw * 0.866;
      const ox = hw * 0.6 + (W - COLS * hw * 0.75 - hw * 0.25) / 2;
      const oy = hdrH + hh * 0.5 + (H - hdrH - ROWS * hh - 0.5 * hh) / 2;
      grid.forEach((col, c) =>
        col.forEach((cell, r) => {
          const { x, y } = hexPt(c, r, hw, hh, ox, oy);
          const o = cell.owner;
          const base = o >= 0 ? agCols[o] : '#14141E';
          const fa = o >= 0 ? 0.12 + cell.str * 0.32 : 0.95;
          const fill = o >= 0
            ? `${base}${Math.round(fa * 255).toString(16).padStart(2, '0')}`
            : base;
          const stroke = o >= 0 ? `${base}55` : '#1C1C2E';
          drawHex(x, y, hw * 0.46, fill, stroke);
          if (cell.str > 0.82 && o >= 0) {
            ctx.fillStyle = base;
            ctx.font = `600 7px 'JetBrains Mono',monospace`;
            ctx.textAlign = 'center';
            ctx.fillText('◈', x, y + 3);
          }
        })
      );
      if (battle) {
        const { x, y, t } = battle;
        const al = Math.max(0, 1 - t / 18);
        ctx.beginPath();
        ctx.arc(x, y, 10 + t * 0.6, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,68,85,${al})`;
        ctx.lineWidth = 1.8;
        ctx.stroke();
        battle.t++;
        if (battle.t > 18) battle = null;
      }
      const tot = COLS * ROWS, bY = 10, bH = 10;
      let bx = 12;
      scores.forEach((s, i) => {
        const bw = (W - 24) * s / tot;
        ctx.fillStyle = agCols[i];
        ctx.fillRect(bx, bY, bw, bH);
        bx += bw;
      });
      ctx.strokeStyle = '#07070E';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(12, bY, W - 24, bH);
      ctx.font = `700 9px 'JetBrains Mono',monospace`;
      agNames.forEach((n, i) => {
        ctx.fillStyle = agCols[i];
        ctx.textAlign = 'left';
        ctx.fillText(`${n} ${Math.round(scores[i] * 100 / tot)}%`, 14 + i * (W - 28) / 4, hdrH - 10);
      });
      ctx.textAlign = 'left';
      fr++;
      if (fr % 10 === 0) {
        const att = Math.floor(Math.random() * 4);
        const c = Math.floor(Math.random() * COLS);
        const r = Math.floor(Math.random() * ROWS);
        const cell = grid[c][r];
        if (cell.owner !== att) {
          const { x, y } = hexPt(c, r, hw, hh, ox, oy);
          if (cell.owner >= 0) {
            scores[cell.owner]--;
            battle = { x, y, t: 0 };
          } else {
            scores[att]++;
          }
          cell.owner = att;
          cell.str = Math.random() * 0.5 + 0.3;
        }
      }
      if (fr > 500) { fr = 0; initG(); }
    }

    initG();
    const interval = setInterval(() => { draw(); }, 80);

    const handleResize = () => { lastW = 0; };
    window.addEventListener('resize', handleResize);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', handleResize);
    };
  }, [active, canvasRef]);
}
