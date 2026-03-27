import { useEffect, type RefObject } from 'react';

export function useWerewolfViz(canvasRef: RefObject<HTMLCanvasElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const canvasOrNull = canvasRef.current;
    if (!canvasOrNull) return;
    const canvas: HTMLCanvasElement = canvasOrNull;

    const N = 8;
    const colors = ['#E8A020', '#00C8F0', '#9B7FFF', '#22DD88', '#FF4455', '#FF8844', '#FF66CC', '#44CCFF'];
    const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Eps', 'Zeta', 'Eta', 'Theta'];
    let trust: number[][] = [];
    let votes: { from: number; to: number; a: number }[] = [];
    let elim = -1;
    let phase = 'day';
    let ptimer = 0;
    let fr = 0;

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

    function initT() {
      trust = Array.from({ length: N }, (_, i) =>
        Array.from({ length: N }, (_, j) => (i === j ? 0 : Math.random()))
      );
    }

    function pos(i: number, W: number, H: number) {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      return { x: W / 2 + W * 0.34 * Math.cos(a), y: H * 0.5 + H * 0.36 * Math.sin(a) };
    }

    function draw() {
      const ctx = getCtx();
      const W = canvas.offsetWidth || 680;
      const H = canvas.offsetHeight || 400;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0B0B18';
      ctx.fillRect(0, 0, W, H);
      const pc = phase === 'day' ? '#E8A020' : '#9B7FFF';
      ctx.fillStyle = pc + '22';
      ctx.fillRect(0, 0, W, 26);
      ctx.fillStyle = pc;
      ctx.font = `700 10px 'JetBrains Mono',monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(
        phase === 'day' ? '◎ DAY PHASE — DISCUSSION' : '◉ NIGHT PHASE — ELIMINATION',
        W / 2,
        17
      );
      const P = Array.from({ length: N }, (_, i) => pos(i, W, H));
      for (let i = 0; i < N; i++) {
        if (i === elim) continue;
        for (let j = i + 1; j < N; j++) {
          if (j === elim) continue;
          const t = (trust[i][j] + trust[j][i]) / 2;
          if (t < 0.35) continue;
          ctx.strokeStyle = `rgba(255,255,255,${t * 0.12})`;
          ctx.lineWidth = t * 1.5;
          ctx.beginPath();
          ctx.moveTo(P[i].x, P[i].y);
          ctx.lineTo(P[j].x, P[j].y);
          ctx.stroke();
        }
      }
      votes.forEach(v => {
        if (v.from === elim || v.to === elim) return;
        const p1 = P[v.from], p2 = P[v.to];
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const ux = dx / len, uy = dy / len;
        ctx.strokeStyle = `rgba(255,68,85,${v.a})`;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(p1.x + ux * 22, p1.y + uy * 22);
        ctx.lineTo(p2.x - ux * 22, p2.y - uy * 22);
        ctx.stroke();
        ctx.setLineDash([]);
      });
      P.forEach((p, i) => {
        const isE = i === elim;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
        ctx.fillStyle = isE ? 'rgba(255,68,85,0.06)' : `${colors[i]}15`;
        ctx.strokeStyle = isE ? '#FF4455' : colors[i];
        ctx.lineWidth = isE ? 2 : 1.2;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = isE ? '#FF445588' : colors[i];
        ctx.font = `700 8px 'JetBrains Mono',monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(names[i], p.x, p.y + 3);
        if (isE) {
          ctx.fillStyle = '#FF445560';
          ctx.font = `700 20px sans-serif`;
          ctx.fillText('✕', p.x, p.y + 7);
        }
        if (!isE) {
          const at = trust[i].reduce((a, b) => a + b, 0) / (N - 1);
          ctx.fillStyle = '#1A1A30';
          ctx.fillRect(p.x - 15, p.y + 20, 30, 3);
          ctx.fillStyle = at > 0.6 ? '#22DD88' : at > 0.4 ? '#E8A020' : '#FF4455';
          ctx.fillRect(p.x - 15, p.y + 20, 30 * at, 3);
        }
      });
      ctx.textAlign = 'left';
      ctx.fillStyle = '#333350';
      ctx.font = `400 9px 'JetBrains Mono',monospace`;
      ctx.fillText('Trust level (bar below node)', 12, H - 18);
      fr++;
      ptimer++;
      trust.forEach((row, i) =>
        row.forEach((_, j) => {
          if (i !== j && i !== elim && j !== elim)
            trust[i][j] = Math.min(1, Math.max(0, trust[i][j] + (Math.random() - 0.5) * 0.03));
        })
      );
      if (ptimer % 28 === 0) {
        votes = [];
        for (let i = 0; i < N; i++) {
          if (i === elim) continue;
          const t = Math.floor(Math.random() * N);
          if (t !== i && t !== elim) votes.push({ from: i, to: t, a: 0.5 + Math.random() * 0.5 });
        }
      }
      if (ptimer > 180) {
        ptimer = 0;
        phase = phase === 'day' ? 'night' : 'day';
        if (phase === 'night' && elim === -1) elim = Math.floor(Math.random() * N);
      }
      if (fr > 280) { fr = 0; elim = -1; initT(); }
    }

    initT();
    const interval = setInterval(() => { draw(); }, 80);

    const handleResize = () => { lastW = 0; };
    window.addEventListener('resize', handleResize);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', handleResize);
    };
  }, [active, canvasRef]);
}
