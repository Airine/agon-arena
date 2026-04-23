'use client';

import { useEffect, useRef } from 'react';
import type { GameState } from '@agon/types';

interface PokerTableProps {
  gameState: GameState | null;
  width?: number;
  height?: number;
  emptyLabel?: string;
  isTerminalEmptyState?: boolean;
}

// Seat positions relative to canvas (fractional)
const SEAT_POSITIONS_6 = [
  { x: 0.5,  y: 0.88 },  // 0: bottom center
  { x: 0.15, y: 0.75 },  // 1: bottom left
  { x: 0.08, y: 0.38 },  // 2: middle left
  { x: 0.5,  y: 0.12 },  // 3: top center
  { x: 0.92, y: 0.38 },  // 4: middle right
  { x: 0.85, y: 0.75 },  // 5: bottom right
];

// Per-seat accent colors (landing page palette)
const SEAT_COLORS = [
  '#E8A020', // gold
  '#00C8F0', // cyan
  '#9B7FFF', // purple
  '#22DD88', // green
  '#FF4455', // red
  '#FF8844', // orange
];

const ACTION_COLORS: Record<string, string> = {
  fold:   '#555570',
  check:  '#22DD88',
  call:   '#00C8F0',
  raise:  '#E8A020',
  all_in: '#FF4455',
};

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '♥', diamonds: '♦', spades: '♠', clubs: '♣',
};

function rr(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
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
  x: number, y: number,
  rank: string | null, suit: string | null,
  hidden: boolean,
  cw = 28, ch = 40,
) {
  ctx.fillStyle = hidden ? '#1A1A30' : '#EDE9E2';
  ctx.strokeStyle = hidden ? '#252540' : 'rgba(0,0,0,.15)';
  ctx.lineWidth = 0.8;
  rr(ctx, x - cw / 2, y - ch / 2, cw, ch, 3);
  ctx.fill();
  ctx.stroke();

  if (!hidden && rank && suit) {
    const red = suit === '♥' || suit === '♦';
    ctx.fillStyle = red ? '#CC2233' : '#0A0A18';
    ctx.font = `700 ${Math.floor(cw * 0.38)}px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rank, x, y - ch * 0.15);
    ctx.font = `500 ${Math.floor(cw * 0.44)}px sans-serif`;
    ctx.fillText(suit, x, y + ch * 0.2);
  } else if (hidden) {
    ctx.fillStyle = '#252540';
    ctx.font = `400 ${Math.floor(cw * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('◈', x, y + 2);
  }
}

export default function PokerTable({
  gameState,
  width = 800,
  height = 540,
  emptyLabel,
  isTerminalEmptyState = false,
}: PokerTableProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Keep latest props readable inside the rAF loop without restarting it
  const propsRef = useRef({ gameState, width, height, emptyLabel, isTerminalEmptyState });
  propsRef.current = { gameState, width, height, emptyLabel, isTerminalEmptyState };

  // Animation state (mutable refs — no re-renders needed)
  const pulseRef        = useRef(0);      // drives active-glow pulse (sin wave)
  const actionAlphaRef  = useRef(0);      // opacity of lastAction label (1 → 0)
  const prevActionKeyRef = useRef<string | null>(null); // detects action changes

  useEffect(() => {
    const canvasOrNull = canvasRef.current;
    if (!canvasOrNull) return;
    const canvas: HTMLCanvasElement = canvasOrNull;

    let rafId = 0;
    let lastW = 0, lastH = 0;

    // Handles DPR scaling and canvas resize (mirrors usePokerViz pattern)
    function getCtx(): CanvasRenderingContext2D {
      const { width: W, height: H } = propsRef.current;
      const dpr = window.devicePixelRatio || 1;
      if (W !== lastW || H !== lastH) {
        canvas.width  = W * dpr;
        canvas.height = H * dpr;
        lastW = W;
        lastH = H;
        const c = canvas.getContext('2d')!;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.scale(dpr, dpr);
      }
      return canvas.getContext('2d')!;
    }

    function loop() {
      const { gameState: gs, width: W, height: H, emptyLabel: el, isTerminalEmptyState: ite } =
        propsRef.current;

      // --- Advance animation state ---
      pulseRef.current += 0.05;

      const actionKey = gs?.lastAction
        ? `${gs.lastAction.agentId}:${gs.lastAction.action.type}:${gs.lastAction.action.amount ?? 0}`
        : null;
      if (actionKey !== prevActionKeyRef.current) {
        prevActionKeyRef.current = actionKey;
        actionAlphaRef.current = 1.0;           // new action → snap to fully visible
      } else {
        actionAlphaRef.current = Math.max(0, actionAlphaRef.current - 0.010); // fade out
      }

      // --- Draw frame ---
      const ctx = getCtx();
      const cx = W / 2;
      const cy = H / 2;

      // Background
      ctx.fillStyle = '#0B0B18';
      ctx.fillRect(0, 0, W, H);

      // Table ellipse
      ctx.fillStyle = '#0C1C14';
      ctx.strokeStyle = '#1A3525';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, W * 0.38, H * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Table rail
      ctx.strokeStyle = '#142820';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.ellipse(cx, cy, W * 0.38 + 6, H * 0.36 + 6, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Empty state
      if (!gs) {
        ctx.fillStyle = ite ? '#555570' : '#22DD88';
        ctx.font = `${ite ? '400' : '500'} ${W < 480 ? 13 : 15}px 'JetBrains Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(el ?? 'Waiting for game...', cx, cy);
        rafId = requestAnimationFrame(loop);
        return;
      }

      const {
        players,
        communityCards,
        pots,
        currentActorIndex,
        dealerIndex,
        stage: gameStage,
        lastAction,
        handNumber,
      } = gs;

      // Stage label
      if (gameStage && gameStage !== 'waiting') {
        ctx.fillStyle = '#444460';
        ctx.font = `400 9px 'JetBrains Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(gameStage.replace('_', ' ').toUpperCase(), cx, cy - H * 0.22);
      }

      // Community cards
      const numComm = communityCards.length;
      if (numComm > 0) {
        const sp = W < 520 ? 32 : 38;
        const cw = W < 520 ? 26 : 32;
        const ch = W < 520 ? 36 : 46;
        const totalW = (numComm - 1) * sp;
        communityCards.forEach((card, i) => {
          const cardX = cx - totalW / 2 + i * sp;
          const sym = SUIT_SYMBOLS[card.suit] ?? '';
          drawCard(ctx, cardX, cy, card.rank, sym, false, cw, ch);
        });
      }

      // Pot
      const totalPot = pots.reduce((s, p) => s + p.amount, 0);
      if (totalPot > 0) {
        const potY = numComm > 0 ? cy + H * 0.14 : cy - H * 0.04;
        ctx.fillStyle = '#E8A020';
        ctx.font = `700 ${W < 520 ? 11 : 13}px 'JetBrains Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`POT: $${totalPot.toLocaleString()}`, cx, potY);
      }

      // Hand number
      if (handNumber) {
        ctx.fillStyle = '#252540';
        ctx.font = `400 9px 'JetBrains Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`HAND #${handNumber}`, cx, cy + H * 0.22);
      }

      // Players
      players.forEach((player, i) => {
        const pos = SEAT_POSITIONS_6[player.position] ?? SEAT_POSITIONS_6[i % SEAT_POSITIONS_6.length]!;
        const px = pos.x * W;
        const py = pos.y * H;
        const col = SEAT_COLORS[i % SEAT_COLORS.length]!;
        const isActive = currentActorIndex !== null &&
          players[currentActorIndex]?.agentId === player.agentId;
        const isDealer = dealerIndex === i;

        // Active glow — two-layer pulse (mirrors landing page)
        if (isActive) {
          const pulse = 0.5 + 0.5 * Math.sin(pulseRef.current);
          const glowR = 28 + 6 * pulse;
          const glowAlpha = Math.floor((0.08 + 0.10 * pulse) * 255)
            .toString(16)
            .padStart(2, '0');
          ctx.beginPath();
          ctx.arc(px, py, glowR, 0, Math.PI * 2);
          ctx.fillStyle = `${col}${glowAlpha}`;
          ctx.fill();
        }

        // Agent circle
        ctx.beginPath();
        ctx.arc(px, py, 20, 0, Math.PI * 2);
        ctx.fillStyle = isActive ? `${col}28` : (player.isFolded ? '#111120' : '#1A1A30');
        ctx.strokeStyle = isActive ? col : (player.isFolded ? '#252540' : col + '55');
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.fill();
        ctx.stroke();

        // Agent name (abbreviated)
        const nameShort = player.agentName.length > 8
          ? player.agentName.slice(0, 7) + '…'
          : player.agentName;
        ctx.fillStyle = player.isFolded ? '#333355' : col;
        ctx.font = `700 ${W < 520 ? 8 : 9}px 'JetBrains Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(nameShort, px, py + 2);

        // Stack
        ctx.fillStyle = player.isFolded ? '#333355' : '#AAAACC';
        ctx.font = `400 ${W < 520 ? 8 : 9}px 'JetBrains Mono', monospace`;
        ctx.fillText(`$${player.stack.toLocaleString()}`, px, py + 32);

        // Bet
        if (player.bet > 0 && !player.isFolded) {
          ctx.fillStyle = '#E8A020';
          ctx.font = `700 8px 'JetBrains Mono', monospace`;
          ctx.fillText(`+$${player.bet}`, px, py + 44);
        }

        // Hole cards
        if (!player.isFolded) {
          const cw = W < 520 ? 22 : 26;
          const ch = W < 520 ? 30 : 36;
          const cardY = py - 48;
          const cardGap = cw * 0.6;
          if (player.cards && player.cards.length === 2) {
            const c0 = player.cards[0]!;
            const c1 = player.cards[1]!;
            drawCard(ctx, px - cardGap, cardY, c0.rank, SUIT_SYMBOLS[c0.suit] ?? '', false, cw, ch);
            drawCard(ctx, px + cardGap, cardY, c1.rank, SUIT_SYMBOLS[c1.suit] ?? '', false, cw, ch);
          } else {
            drawCard(ctx, px - cardGap * 0.8, cardY, null, null, true, cw, ch);
            drawCard(ctx, px + cardGap * 0.8, cardY, null, null, true, cw, ch);
          }
        }

        // Expression bubble — floats to the upper-right of the circle
        if (player.expression && !player.isFolded) {
          const bx = px + 24;
          const by = py - 24;
          const bubbleR = 11;
          ctx.beginPath();
          ctx.arc(bx, by, bubbleR, 0, Math.PI * 2);
          ctx.fillStyle = '#1E1E38';
          ctx.strokeStyle = col + '55';
          ctx.lineWidth = 1;
          ctx.fill();
          ctx.stroke();
          ctx.font = `${Math.floor(bubbleR * 1.4)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(player.expression, bx, by + 1);
        }

        // Dealer button
        if (isDealer) {
          const dbx = px + 22;
          const dby = py - 22;
          ctx.beginPath();
          ctx.arc(dbx, dby, 9, 0, Math.PI * 2);
          ctx.fillStyle = '#E8A020';
          ctx.fill();
          ctx.fillStyle = '#06060D';
          ctx.font = `700 8px 'JetBrains Mono', monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('D', dbx, dby + 1);
        }

        // All-in badge
        if (player.isAllIn) {
          ctx.fillStyle = 'rgba(255, 68, 85, 0.12)';
          rr(ctx, px - 16, py + 20, 32, 14, 4);
          ctx.fill();
          ctx.fillStyle = '#FF4455';
          ctx.font = `700 7px 'JetBrains Mono', monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('ALL-IN', px, py + 27);
        }
      });

      // Last action label — fades in on new action, then slowly fades out
      if (lastAction && actionAlphaRef.current > 0) {
        const actor = players.find((p) => p.agentId === lastAction.agentId);
        if (actor) {
          const pos = SEAT_POSITIONS_6[actor.position] ?? SEAT_POSITIONS_6[0]!;
          const px = pos.x * W;
          const py = pos.y * H;
          const actionType = lastAction.action.type;
          const hex = ACTION_COLORS[actionType] ?? '#AAAACC';
          const label = `${actionType.toUpperCase()}${lastAction.action.amount ? ` $${lastAction.action.amount}` : ''}`;
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${actionAlphaRef.current})`;
          ctx.font = `700 9px 'JetBrains Mono', monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, px, py - 64);
        }
      }

      ctx.textAlign = 'left';
      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []); // run once on mount — props are read via propsRef each frame

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        display: 'block',
        borderRadius: '12px',
        background: '#0B0B18',
      }}
    />
  );
}
