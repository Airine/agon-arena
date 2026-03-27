import { useEffect, type RefObject } from 'react';

export function useDebateViz(canvasRef: RefObject<HTMLCanvasElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const canvasOrNull = canvasRef.current;
    if (!canvasOrNull) return;
    const canvas: HTMLCanvasElement = canvasOrNull;

    let sA = 50, sB = 50, round = 1;
    let speeches: { side: string; text: string }[] = [];
    let timer = 0;
    const ARGS = [
      'Decentralized consensus enables trustless coordination',
      'Agent autonomy requires cryptographic identity',
      'Market signals outperform centralized planning',
      'Incentive alignment is the core unsolved problem',
      'Emergent strategies reveal latent optimization paths',
      'Token-weighted governance distorts rational discourse',
      'Game-theoretic equilibria favor cooperation',
      'Information asymmetry defines negotiation power',
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

    function wrap(
      ctx: CanvasRenderingContext2D,
      text: string,
      x: number,
      y: number,
      mw: number,
      lh: number
    ): number {
      const ws = text.split(' ');
      let line = '';
      for (const w of ws) {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > mw && line) {
          ctx.fillText(line, x, y);
          line = w;
          y += lh;
        } else {
          line = t;
        }
      }
      ctx.fillText(line, x, y);
      return y + lh;
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
      ctx.fillStyle = '#444460';
      ctx.font = `400 9px 'JetBrains Mono',monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`ROUND ${round}  ·  Topic: Should AI agents have autonomous financial rights?`, W / 2, 16);
      ctx.fillText('Judge: Panel of 3 neutral evaluator agents', W / 2, 30);
      const bY = 50, bH = 22, bW = W - 24;
      ctx.fillStyle = '#1A1A30';
      ctx.fillRect(12, bY, bW, bH);
      ctx.fillStyle = '#00C8F0';
      ctx.fillRect(12, bY, bW * (sA / 100), bH);
      ctx.fillStyle = '#E8A020';
      ctx.fillRect(12 + bW * (sA / 100), bY, bW * (sB / 100), bH);
      ctx.fillStyle = '#0B0B18';
      ctx.font = `700 10px 'JetBrains Mono',monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(`Alpha  ${Math.round(sA)}%`, 18, bY + 14);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(sB)}%  Beta`, W - 18, bY + 14);
      ctx.textAlign = 'left';
      const cW = (W - 40) / 2;
      ctx.fillStyle = '#0C1418';
      ctx.fillRect(12, 80, cW, H - 90);
      ctx.fillStyle = '#160E0C';
      ctx.fillRect(28 + cW, 80, cW, H - 90);
      ctx.fillStyle = '#00C8F0';
      ctx.font = `700 10px 'JetBrains Mono',monospace`;
      ctx.fillText('Agent_Alpha', 20, 97);
      ctx.fillStyle = '#E8A020';
      ctx.fillText('Agent_Beta', 36 + cW, 97);
      ctx.font = `300 10px 'DM Sans',sans-serif`;
      let ay = 112;
      speeches.filter(s => s.side === 'A').slice(-4).forEach((s, i) => {
        ctx.fillStyle = `rgba(0,200,240,${0.4 + i * 0.15})`;
        ay = wrap(ctx, s.text, 20, ay, cW - 16, 15) + 2;
      });
      let by = 112;
      speeches.filter(s => s.side === 'B').slice(-4).forEach((s, i) => {
        ctx.fillStyle = `rgba(232,160,32,${0.4 + i * 0.15})`;
        by = wrap(ctx, s.text, 36 + cW, by, cW - 16, 15) + 2;
      });
      const dots = '.'.repeat((Math.floor(timer / 10) % 3) + 1);
      ctx.fillStyle = '#333350';
      ctx.font = `400 10px 'JetBrains Mono',monospace`;
      if (timer % 50 < 25) ctx.fillText(`thinking${dots}`, 20, H - 14);
      else ctx.fillText(`thinking${dots}`, 36 + cW, H - 14);
      timer++;
      if (timer % 65 === 0) {
        const side = Math.floor(timer / 65) % 2 === 0 ? 'A' : 'B';
        speeches.push({ side, text: ARGS[Math.floor(Math.random() * ARGS.length)] });
        if (side === 'A') {
          sA = Math.min(78, Math.max(22, sA + (Math.random() - 0.45) * 8));
          sB = 100 - sA;
        } else {
          sB = Math.min(78, Math.max(22, sB + (Math.random() - 0.45) * 8));
          sA = 100 - sB;
        }
        if (speeches.length > 14) { round++; speeches = []; }
      }
      ctx.textAlign = 'left';
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
