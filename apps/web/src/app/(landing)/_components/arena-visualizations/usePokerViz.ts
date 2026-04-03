import { useEffect, type RefObject } from 'react';

export function usePokerViz(canvasRef: RefObject<HTMLCanvasElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const canvasOrNull = canvasRef.current;
    if (!canvasOrNull) return;
    const canvas: HTMLCanvasElement = canvasOrNull;

    let activeAgent = 0, pot = 1240, btimer = 0;
    const agents = [
      { id: '0x7f4a', chips: 3200, action: '', col: '#E8A020', ax: 0.18, ay: 0.25 },
      { id: 'Orion',  chips: 2800, action: '', col: '#00C8F0', ax: 0.5,  ay: 0.1  },
      { id: 'Fox',    chips: 1900, action: '', col: '#9B7FFF', ax: 0.82, ay: 0.25 },
      { id: 'Kappa',  chips: 4100, action: '', col: '#22DD88', ax: 0.82, ay: 0.72 },
      { id: 'Delta',  chips: 900,  action: '', col: '#FF4455', ax: 0.5,  ay: 0.88 },
      { id: 'Zeta',   chips: 2600, action: '', col: '#FF8844', ax: 0.18, ay: 0.72 },
    ];
    const comm = [
      { r: 'A', s: '♠' },
      { r: 'K', s: '♥' },
      { r: '7', s: '♦' },
      { r: null as string | null, s: null as string | null },
      { r: null as string | null, s: null as string | null },
    ];
    const ACTS = ['RAISE', 'CALL', 'FOLD', 'CHECK', 'ALL-IN', 'BET'];

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

    function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    function drawCard(
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      rank: string | null,
      suit: string | null,
      hidden: boolean
    ) {
      const cw = 28, ch = 40;
      ctx.fillStyle = hidden ? '#1A1A30' : '#EDE9E2';
      ctx.strokeStyle = hidden ? '#252540' : 'rgba(0,0,0,.2)';
      ctx.lineWidth = 0.8;
      rr(ctx, x - cw / 2, y - ch / 2, cw, ch, 3);
      ctx.fill();
      ctx.stroke();
      if (!hidden && rank) {
        const red = suit === '♥' || suit === '♦';
        ctx.fillStyle = red ? '#CC2233' : '#0A0A18';
        ctx.font = `700 10px 'JetBrains Mono',monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(rank, x, y - 5);
        ctx.font = `500 12px sans-serif`;
        ctx.fillText(suit!, x, y + 10);
      } else if (hidden) {
        ctx.fillStyle = '#252540';
        ctx.font = `400 14px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('◈', x, y + 5);
      }
    }

    function draw() {
      const ctx = getCtx();
      const W = canvas.offsetWidth || 680;
      const H = canvas.offsetHeight || 400;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0B0B18';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#0C1C14';
      ctx.strokeStyle = '#1A3525';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2, W * 0.38, H * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#142820';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.ellipse(W / 2, H / 2, W * 0.38, H * 0.36, 0, 0, Math.PI * 2);
      ctx.stroke();
      const sp = 36, ccX = W / 2 - 2 * sp, ccY = H / 2;
      comm.forEach((c, i) => drawCard(ctx, ccX + i * sp, ccY, c.r, c.s, c.r === null));
      ctx.fillStyle = '#E8A020';
      ctx.font = `700 12px 'JetBrains Mono',monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('POT: ' + pot.toLocaleString(), W / 2, H / 2 - 48);
      ctx.fillStyle = '#444460';
      ctx.font = `400 9px 'JetBrains Mono',monospace`;
      ctx.fillText('CHIPS', W / 2, H / 2 - 36);
      agents.forEach((ag, i) => {
        const x = ag.ax * W, y = ag.ay * H, isA = i === activeAgent;
        if (isA) {
          ctx.beginPath();
          ctx.arc(x, y, 30, 0, Math.PI * 2);
          ctx.fillStyle = `${ag.col}18`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x, y, 18, 0, Math.PI * 2);
        ctx.fillStyle = isA ? `${ag.col}30` : '#1A1A30';
        ctx.strokeStyle = isA ? ag.col : '#252540';
        ctx.lineWidth = isA ? 2 : 1;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = ag.col;
        ctx.font = `700 9px 'JetBrains Mono',monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(ag.id.slice(-4), x, y + 4);
        ctx.fillStyle = '#AAAACC';
        ctx.font = `400 9px 'JetBrains Mono',monospace`;
        ctx.fillText(ag.chips.toLocaleString(), x, y + 28);
        if (ag.action) {
          ctx.fillStyle = ag.action === 'FOLD' ? '#FF4455' : (ag.action === 'RAISE' || ag.action === 'ALL-IN') ? '#E8A020' : '#22DD88';
          ctx.font = `700 8px 'JetBrains Mono',monospace`;
          ctx.fillText(ag.action, x, y - 24);
        }
        if (ag.action !== 'FOLD') {
          drawCard(ctx, x - 8, y - 44, null, null, true);
          drawCard(ctx, x + 4, y - 44, null, null, true);
        }
      });
      ctx.textAlign = 'left';
      btimer++;
      if (btimer > 40) {
        btimer = 0;
        agents[activeAgent].action = '';
        activeAgent = (activeAgent + 1) % 6;
        agents[activeAgent].action = ACTS[Math.floor(Math.random() * ACTS.length)];
        if (agents[activeAgent].action === 'RAISE') pot += Math.floor(Math.random() * 200 + 100);
        else if (agents[activeAgent].action === 'CALL') pot += Math.floor(Math.random() * 100 + 50);
      }
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
