import { useEffect, type RefObject } from 'react';

export function useAuctionViz(canvasRef: RefObject<HTMLCanvasElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const canvasOrNull = canvasRef.current;
    if (!canvasOrNull) return;
    const canvas: HTMLCanvasElement = canvasOrNull;

    const agents = [
      { n: 'Alpha', col: '#E8A020', bids: [] as number[], budget: 10000 },
      { n: 'Orion', col: '#00C8F0', bids: [] as number[], budget: 8000  },
      { n: 'Fox',   col: '#9B7FFF', bids: [] as number[], budget: 12000 },
      { n: 'Delta', col: '#22DD88', bids: [] as number[], budget: 9500  },
    ];
    let fr = 0, item = 1, cd = 70;
    let lead: { i: number; v: number } = { i: -1, v: 0 };

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

    function draw() {
      const ctx = getCtx();
      const W = canvas.offsetWidth || 680;
      const H = canvas.offsetHeight || 400;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0B0B18';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#0D0D1A';
      ctx.fillRect(0, 0, W, 44);
      ctx.fillStyle = '#E8A020';
      ctx.font = `700 11px 'JetBrains Mono',monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`ITEM #${item}  —  Rare Strategy NFT · Sealed-bid`, W / 2, 16);
      ctx.fillStyle = '#444460';
      ctx.font = `400 10px 'JetBrains Mono',monospace`;
      ctx.fillText(`Closing in ${cd}s`, W / 2, 30);
      ctx.textAlign = 'left';
      const cX = 12, cY = 52, cW = W - 24, cH = H * 0.44;
      const maxB = Math.max(...agents.flatMap(a => a.bids), 2000);
      ctx.fillStyle = '#0C0C1A';
      ctx.fillRect(cX, cY, cW, cH);
      for (let g = 0; g <= 4; g++) {
        const gy = cY + cH - g * (cH / 4);
        ctx.strokeStyle = '#1A1A30';
        ctx.lineWidth = 0.4;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(cX, gy);
        ctx.lineTo(cX + cW, gy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#2A2A40';
        ctx.font = `400 9px 'JetBrains Mono',monospace`;
        ctx.fillText(Math.round(maxB / 4 * g).toLocaleString(), cX + 4, gy - 3);
      }
      const mLen = Math.max(...agents.map(a => a.bids.length), 1);
      agents.forEach(ag => {
        if (ag.bids.length < 2) return;
        ctx.strokeStyle = ag.col;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ag.bids.forEach((b, i) => {
          const x = cX + i * (cW / (mLen - 1 || 1));
          const y = cY + cH - b / maxB * cH;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
        const lx = cX + (ag.bids.length - 1) * (cW / (mLen - 1 || 1));
        const ly = cY + cH - ag.bids[ag.bids.length - 1] / maxB * cH;
        ctx.beginPath();
        ctx.arc(lx, ly, 4, 0, Math.PI * 2);
        ctx.fillStyle = ag.col;
        ctx.fill();
      });
      const caY = cY + cH + 14;
      const caW = (W - 48) / 4;
      agents.forEach((ag, i) => {
        const isL = i === lead.i;
        ctx.fillStyle = isL ? `${ag.col}18` : '#0D0D1A';
        ctx.strokeStyle = isL ? ag.col : '#1A1A30';
        ctx.lineWidth = isL ? 1.2 : 0.4;
        ctx.beginPath();
        if ((ctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect) {
          (ctx as CanvasRenderingContext2D & { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(12 + i * (caW + 12), caY, caW, H - caY - 10, 6);
        } else {
          ctx.rect(12 + i * (caW + 12), caY, caW, H - caY - 10);
        }
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = ag.col;
        ctx.font = `700 9px 'JetBrains Mono',monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(ag.n, 12 + i * (caW + 12) + caW / 2, caY + 16);
        const last = ag.bids[ag.bids.length - 1] || 0;
        ctx.fillStyle = '#CCCCEE';
        ctx.font = `500 11px 'JetBrains Mono',monospace`;
        ctx.fillText(last.toLocaleString(), 12 + i * (caW + 12) + caW / 2, caY + 30);
        ctx.fillStyle = '#333350';
        ctx.font = `400 8px 'JetBrains Mono',monospace`;
        ctx.fillText('Bdgt: ' + ag.budget.toLocaleString(), 12 + i * (caW + 12) + caW / 2, caY + 44);
        if (isL) {
          ctx.fillStyle = '#E8A020';
          ctx.fillText('◎ LEADING', 12 + i * (caW + 12) + caW / 2, caY + 56);
        }
        ctx.textAlign = 'left';
      });
      fr++;
      if (fr % 22 === 0) {
        cd = Math.max(1, cd - 2);
        agents.forEach((ag, i) => {
          const last = ag.bids[ag.bids.length - 1] || 0;
          const hi = lead.v;
          if (Math.random() < 0.65 && last < ag.budget * 0.8) {
            const nb = Math.min(ag.budget * 0.8, Math.max(last + 50, hi + Math.floor(Math.random() * 150 + 20)));
            ag.bids.push(nb);
            if (nb > lead.v) lead = { i, v: nb };
          } else {
            ag.bids.push(last);
          }
        });
      }
      if (cd <= 0) { cd = 75; item++; lead = { i: -1, v: 0 }; agents.forEach(ag => { ag.bids = []; }); }
    }

    const interval = setInterval(() => { draw(); }, 80);

    const handleResize = () => { lastW = 0; };
    window.addEventListener('resize', handleResize);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', handleResize);
    };
  }, [active, canvasRef]);
}
