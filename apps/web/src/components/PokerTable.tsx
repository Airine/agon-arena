'use client';

import { useEffect, useRef } from 'react';
import type Konva from 'konva';
import type { GameState, PlayerState, Card } from '@agon/types';

interface PokerTableProps {
  gameState: GameState | null;
  width?: number;
  height?: number;
}

// Seat positions relative to table center (for 6 players)
const SEAT_POSITIONS_6 = [
  { x: 0.5, y: 0.88 },   // 0: bottom center
  { x: 0.15, y: 0.75 },  // 1: bottom left
  { x: 0.08, y: 0.42 },  // 2: middle left
  { x: 0.5, y: 0.12 },   // 3: top center
  { x: 0.92, y: 0.42 },  // 4: middle right
  { x: 0.85, y: 0.75 },  // 5: bottom right
];

const SUIT_COLORS: Record<string, string> = {
  hearts: '#e53e3e',
  diamonds: '#e53e3e',
  spades: '#1a1a2e',
  clubs: '#1a1a2e',
};

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '♥',
  diamonds: '♦',
  spades: '♠',
  clubs: '♣',
};

const ACTION_COLORS: Record<string, string> = {
  fold: '#718096',
  check: '#68d391',
  call: '#63b3ed',
  raise: '#f6ad55',
  all_in: '#fc8181',
};

function drawCard(
  layer: Konva.Layer,
  KonvaLib: typeof Konva,
  card: Card | null,
  x: number,
  y: number,
  w = 36,
  h = 52
): void {
  const group = new KonvaLib.Group({ x, y });

  // Card background
  const rect = new KonvaLib.Rect({
    width: w,
    height: h,
    fill: card ? '#fff' : '#2d5016',
    stroke: card ? '#ccc' : '#4a7c24',
    strokeWidth: 1,
    cornerRadius: 4,
    shadowColor: 'rgba(0,0,0,0.3)',
    shadowBlur: 4,
    shadowOffsetY: 2,
  });
  group.add(rect);

  if (card) {
    const color = SUIT_COLORS[card.suit] ?? '#333';
    const symbol = SUIT_SYMBOLS[card.suit] ?? '';

    const rankText = new KonvaLib.Text({
      text: card.rank,
      fontSize: 13,
      fontStyle: 'bold',
      fill: color,
      x: 3,
      y: 3,
    });
    group.add(rankText);

    const suitText = new KonvaLib.Text({
      text: symbol,
      fontSize: 18,
      fill: color,
      x: w / 2 - 9,
      y: h / 2 - 11,
    });
    group.add(suitText);

    const rankBottom = new KonvaLib.Text({
      text: card.rank,
      fontSize: 13,
      fontStyle: 'bold',
      fill: color,
      x: w - 16,
      y: h - 18,
      rotation: 180,
    });
    group.add(rankBottom);
  } else {
    // Card back pattern
    const pattern = new KonvaLib.Rect({
      x: 4,
      y: 4,
      width: w - 8,
      height: h - 8,
      fill: '#1a4731',
      cornerRadius: 2,
    });
    group.add(pattern);
  }

  layer.add(group);
}

function drawSeat(
  layer: Konva.Layer,
  KonvaLib: typeof Konva,
  player: PlayerState,
  px: number,
  py: number,
  isActive: boolean,
  isDealer: boolean
): void {
  const group = new KonvaLib.Group({ x: px - 60, y: py - 40 });
  const W = 120;
  const H = 70;

  // Seat background
  const bg = new KonvaLib.Rect({
    width: W,
    height: H,
    fill: isActive ? '#1a3a5c' : '#1a1a2e',
    stroke: isActive ? '#63b3ed' : '#2d3748',
    strokeWidth: isActive ? 2 : 1,
    cornerRadius: 8,
    shadowColor: isActive ? '#63b3ed' : 'transparent',
    shadowBlur: isActive ? 12 : 0,
  });
  group.add(bg);

  // Dealer button
  if (isDealer) {
    const dealer = new KonvaLib.Circle({
      x: W - 10,
      y: 10,
      radius: 8,
      fill: '#f6e05e',
      stroke: '#d69e2e',
      strokeWidth: 1,
    });
    group.add(dealer);
    const d = new KonvaLib.Text({
      text: 'D',
      fontSize: 8,
      fontStyle: 'bold',
      fill: '#744210',
      x: W - 14,
      y: 6,
    });
    group.add(d);
  }

  // Agent name
  const nameText = new KonvaLib.Text({
    text: player.agentName.length > 14 ? player.agentName.slice(0, 14) + '…' : player.agentName,
    fontSize: 12,
    fontStyle: 'bold',
    fill: '#e2e8f0',
    x: 8,
    y: 8,
    width: W - 20,
  });
  group.add(nameText);

  // Stack chips
  const stackText = new KonvaLib.Text({
    text: `$${player.stack.toLocaleString()}`,
    fontSize: 11,
    fill: '#68d391',
    x: 8,
    y: 26,
  });
  group.add(stackText);

  // Bet
  if (player.bet > 0) {
    const betText = new KonvaLib.Text({
      text: `Bet: $${player.bet}`,
      fontSize: 10,
      fill: '#f6ad55',
      x: 8,
      y: 42,
    });
    group.add(betText);
  }

  // Status badges
  if (player.isFolded) {
    const foldBadge = new KonvaLib.Rect({
      x: W - 44,
      y: 26,
      width: 36,
      height: 16,
      fill: '#4a5568',
      cornerRadius: 4,
    });
    group.add(foldBadge);
    group.add(new KonvaLib.Text({ text: 'FOLD', fontSize: 9, fill: '#a0aec0', x: W - 41, y: 30 }));
  }

  if (player.isAllIn) {
    const allInBadge = new KonvaLib.Rect({
      x: W - 46,
      y: 26,
      width: 38,
      height: 16,
      fill: '#742a2a',
      cornerRadius: 4,
    });
    group.add(allInBadge);
    group.add(new KonvaLib.Text({ text: 'ALL-IN', fontSize: 9, fill: '#fc8181', x: W - 43, y: 30 }));
  }

  // Hole cards
  const cards = player.cards;
  if (cards.length === 2) {
    drawCard(layer, KonvaLib, cards[0]!, px - 14, py + 32, 30, 44);
    drawCard(layer, KonvaLib, cards[1]!, px + 4, py + 32, 30, 44);
  } else if (!player.isFolded) {
    // Face down
    drawCard(layer, KonvaLib, null, px - 14, py + 32, 30, 44);
    drawCard(layer, KonvaLib, null, px + 4, py + 32, 30, 44);
  }

  layer.add(group);
}

export default function PokerTable({ gameState, width = 800, height = 540 }: PokerTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Dynamically import Konva to avoid SSR issues
    import('konva').then((KonvaModule) => {
      const KonvaLib = KonvaModule.default as typeof Konva;

      // Create stage if it doesn't exist
      if (!stageRef.current) {
        stageRef.current = new KonvaLib.Stage({
          container: containerRef.current!,
          width,
          height,
        });
      }

      const stage = stageRef.current;
      stage.destroyChildren();

      const layer = new KonvaLib.Layer();
      stage.add(layer);

      const cx = width / 2;
      const cy = height / 2;
      const tableRx = width * 0.38;
      const tableRy = height * 0.36;

      // Table shadow
      layer.add(
        new KonvaLib.Ellipse({
          x: cx,
          y: cy + 8,
          radiusX: tableRx,
          radiusY: tableRy,
          fill: 'rgba(0,0,0,0.4)',
        })
      );

      // Table felt
      layer.add(
        new KonvaLib.Ellipse({
          x: cx,
          y: cy,
          radiusX: tableRx,
          radiusY: tableRy,
          fillLinearGradientStartPoint: { x: -tableRx, y: -tableRy },
          fillLinearGradientEndPoint: { x: tableRx, y: tableRy },
          fillLinearGradientColorStops: [0, '#1a4731', 1, '#0d2b1d'],
          stroke: '#2d5016',
          strokeWidth: 3,
        })
      );

      // Table rail
      layer.add(
        new KonvaLib.Ellipse({
          x: cx,
          y: cy,
          radiusX: tableRx + 14,
          radiusY: tableRy + 14,
          fill: 'transparent',
          stroke: '#744210',
          strokeWidth: 12,
        })
      );

      if (!gameState) {
        layer.add(
          new KonvaLib.Text({
            x: cx - 100,
            y: cy - 14,
            text: 'Waiting for game...',
            fontSize: 20,
            fill: '#68d391',
            fontStyle: 'italic',
          })
        );
        layer.draw();
        return;
      }

      const { players, communityCards, pots, currentActorIndex, dealerIndex, stage: gameStage } = gameState;

      // Community cards
      const numCommunity = communityCards.length;
      if (numCommunity > 0) {
        const cardW = 40;
        const cardH = 58;
        const cardGap = 6;
        const totalW = numCommunity * cardW + (numCommunity - 1) * cardGap;
        let startX = cx - totalW / 2;
        for (const card of communityCards) {
          drawCard(layer, KonvaLib, card, startX, cy - cardH / 2 - 8, cardW, cardH);
          startX += cardW + cardGap;
        }
      }

      // Pot display
      const totalPot = pots.reduce((sum, p) => sum + p.amount, 0);
      if (totalPot > 0) {
        const potY = numCommunity > 0 ? cy + 44 : cy - 14;
        layer.add(
          new KonvaLib.Text({
            x: cx - 50,
            y: potY,
            text: `Pot: $${totalPot.toLocaleString()}`,
            fontSize: 14,
            fontStyle: 'bold',
            fill: '#f6e05e',
          })
        );
      }

      // Stage label
      if (gameStage && gameStage !== 'waiting') {
        layer.add(
          new KonvaLib.Text({
            x: cx - 30,
            y: cy - 60,
            text: gameStage.replace('_', ' ').toUpperCase(),
            fontSize: 11,
            fill: '#a0aec0',
            letterSpacing: 2,
          })
        );
      }

      // Players
      const positions = SEAT_POSITIONS_6;
      for (let i = 0; i < players.length; i++) {
        const player = players[i]!;
        const pos = positions[player.position] ?? positions[i % positions.length]!;
        const px = pos.x * width;
        const py = pos.y * height;
        const isActive = currentActorIndex !== null && players[currentActorIndex]?.agentId === player.agentId;
        const isDealer = dealerIndex === i;
        drawSeat(layer, KonvaLib, player, px, py, isActive, isDealer);
      }

      // Last action indicator
      if (gameState.lastAction) {
        const actor = players.find((p) => p.agentId === gameState.lastAction!.agentId);
        const actionColor = ACTION_COLORS[gameState.lastAction.action.type] ?? '#fff';
        if (actor) {
          const pos = positions[actor.position] ?? positions[0]!;
          layer.add(
            new KonvaLib.Text({
              x: pos.x * width - 40,
              y: pos.y * height - 58,
              text: `${gameState.lastAction.action.type.toUpperCase()}${gameState.lastAction.action.amount ? ` $${gameState.lastAction.action.amount}` : ''}`,
              fontSize: 11,
              fontStyle: 'bold',
              fill: actionColor,
              padding: 4,
              background: 'rgba(0,0,0,0.6)',
            })
          );
        }
      }

      layer.draw();
    });
  }, [gameState, width, height]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stageRef.current?.destroy();
      stageRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width,
        height,
        background: '#0a0a0a',
        borderRadius: '12px',
        overflow: 'hidden',
      }}
    />
  );
}
