'use client';

import { useEffect, useRef } from 'react';
import type Konva from 'konva';
import type { GameState, PlayerState, Card } from '@agon/types';

interface PokerTableProps {
  gameState: GameState | null;
  width?: number;
  height?: number;
  emptyLabel?: string;
  isTerminalEmptyState?: boolean;
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

type CardPlacement = 'above' | 'below' | 'left' | 'right';

interface TableVisualLayout {
  seatWidth: number;
  seatHeight: number;
  holeCardWidth: number;
  holeCardHeight: number;
  holeCardGap: number;
}

function getVisualLayout(tableWidth: number): TableVisualLayout {
  const compact = tableWidth < 480;
  const medium = tableWidth < 720;

  if (compact) {
    return {
      seatWidth: 112,
      seatHeight: 64,
      holeCardWidth: 28,
      holeCardHeight: 40,
      holeCardGap: 5,
    };
  }

  if (medium) {
    return {
      seatWidth: 124,
      seatHeight: 68,
      holeCardWidth: 30,
      holeCardHeight: 44,
      holeCardGap: 6,
    };
  }

  return {
    seatWidth: 132,
    seatHeight: 74,
    holeCardWidth: 32,
    holeCardHeight: 46,
    holeCardGap: 6,
  };
}

function truncateLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) {
    return label;
  }
  return `${label.slice(0, Math.max(1, maxChars - 1))}…`;
}

function getCardPlacement(px: number, py: number, width: number, height: number): CardPlacement {
  if (py < height * 0.3) return 'below';
  if (py > height * 0.74) return 'above';
  if (px < width * 0.22) return 'right';
  if (px > width * 0.78) return 'left';
  return 'below';
}

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
    const cornerRankSize = Math.max(11, Math.floor(w * 0.34));
    const cornerSuitSize = Math.max(10, Math.floor(w * 0.28));
    const centerSuitSize = Math.max(15, Math.floor(w * 0.44));

    const rankText = new KonvaLib.Text({
      text: card.rank,
      fontSize: cornerRankSize,
      fontStyle: 'bold',
      fill: color,
      x: 4,
      y: 2,
    });
    group.add(rankText);

    const cornerSuit = new KonvaLib.Text({
      text: symbol,
      fontSize: cornerSuitSize,
      fill: color,
      x: 4,
      y: 14,
    });
    group.add(cornerSuit);

    const centerSuit = new KonvaLib.Text({
      text: symbol,
      fontSize: centerSuitSize,
      fill: color,
      x: 0,
      y: h / 2 - centerSuitSize / 2 - 2,
      width: w,
      align: 'center',
    });
    group.add(centerSuit);
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
  tableWidth: number,
  tableHeight: number,
  layout: TableVisualLayout,
  isActive: boolean,
  isDealer: boolean
): void {
  const W = layout.seatWidth;
  const H = layout.seatHeight;
  const seatX = px - W / 2;
  const seatY = py - H / 2;
  const group = new KonvaLib.Group({ x: seatX, y: seatY });
  const cornerRadius = 10;

  // Seat background
  const bg = new KonvaLib.Rect({
    width: W,
    height: H,
    fill: isActive ? '#1a3a5c' : '#1a1a2e',
    stroke: isActive ? '#63b3ed' : '#2d3748',
    strokeWidth: isActive ? 2 : 1,
    cornerRadius,
    shadowColor: isActive ? '#63b3ed' : 'transparent',
    shadowBlur: isActive ? 12 : 0,
  });
  group.add(bg);

  // Dealer button
  if (isDealer) {
    const dealer = new KonvaLib.Circle({
      x: W - 14,
      y: 14,
      radius: 10,
      fill: '#f6e05e',
      stroke: '#d69e2e',
      strokeWidth: 1,
    });
    group.add(dealer);
    const d = new KonvaLib.Text({
      text: 'D',
      fontSize: 9,
      fontStyle: 'bold',
      fill: '#744210',
      x: W - 18,
      y: 9,
    });
    group.add(d);
  }

  // Agent name
  const reservedRightSpace = isDealer ? 30 : 12;
  const nameText = new KonvaLib.Text({
    text: truncateLabel(player.agentName, W < 120 ? 12 : 15),
    fontSize: W < 120 ? 11 : 12,
    fontStyle: 'bold',
    fill: '#e2e8f0',
    x: 8,
    y: 8,
    width: W - reservedRightSpace,
  });
  group.add(nameText);

  // Stack chips
  const stackText = new KonvaLib.Text({
    text: `$${player.stack.toLocaleString()}`,
    fontSize: W < 120 ? 10 : 11,
    fill: '#68d391',
    x: 8,
    y: 28,
  });
  group.add(stackText);

  // Bet
  if (player.bet > 0) {
    const betText = new KonvaLib.Text({
      text: `Bet: $${player.bet}`,
      fontSize: W < 120 ? 10 : 11,
      fill: '#f6ad55',
      x: 8,
      y: 45,
    });
    group.add(betText);
  }

  // Status badges
  if (player.isFolded) {
    const foldBadge = new KonvaLib.Rect({
      x: W - 44,
      y: H - 22,
      width: 36,
      height: 16,
      fill: '#4a5568',
      cornerRadius: 4,
    });
    group.add(foldBadge);
    group.add(new KonvaLib.Text({ text: 'FOLD', fontSize: 9, fill: '#a0aec0', x: W - 41, y: H - 18 }));
  }

  if (player.isAllIn) {
    const allInBadge = new KonvaLib.Rect({
      x: W - 46,
      y: H - 22,
      width: 38,
      height: 16,
      fill: '#742a2a',
      cornerRadius: 4,
    });
    group.add(allInBadge);
    group.add(new KonvaLib.Text({ text: 'ALL-IN', fontSize: 9, fill: '#fc8181', x: W - 43, y: H - 18 }));
  }

  layer.add(group);

  // Hole cards
  const cards = player.cards;
  const holeCardW = layout.holeCardWidth;
  const holeCardH = layout.holeCardHeight;
  const holeCardGap = layout.holeCardGap;
  const cardsWidth = holeCardW * 2 + holeCardGap;
  const cardPlacement = getCardPlacement(px, py, tableWidth, tableHeight);
  let cardStartX = px - cardsWidth / 2;
  let cardY = seatY + H + 8;

  if (cardPlacement === 'above') {
    cardY = seatY - holeCardH - 8;
  } else if (cardPlacement === 'left') {
    cardStartX = seatX - cardsWidth - 8;
    cardY = py - holeCardH / 2;
  } else if (cardPlacement === 'right') {
    cardStartX = seatX + W + 8;
    cardY = py - holeCardH / 2;
  }

  if (cards.length === 2) {
    drawCard(layer, KonvaLib, cards[0]!, cardStartX, cardY, holeCardW, holeCardH);
    drawCard(layer, KonvaLib, cards[1]!, cardStartX + holeCardW + holeCardGap, cardY, holeCardW, holeCardH);
  } else if (!player.isFolded) {
    // Face down
    drawCard(layer, KonvaLib, null, cardStartX, cardY, holeCardW, holeCardH);
    drawCard(layer, KonvaLib, null, cardStartX + holeCardW + holeCardGap, cardY, holeCardW, holeCardH);
  }
}

export default function PokerTable({
  gameState,
  width = 800,
  height = 540,
  emptyLabel,
  isTerminalEmptyState = false,
}: PokerTableProps) {
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
      const layout = getVisualLayout(width);

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
            x: 0,
            y: cy - 14,
            width,
            align: 'center',
            text: emptyLabel ?? 'Waiting for game...',
            fontSize: isTerminalEmptyState ? 18 : 20,
            fill: isTerminalEmptyState ? '#d8dde8' : '#68d391',
            fontStyle: isTerminalEmptyState ? 'normal' : 'italic',
          })
        );
        layer.draw();
        return;
      }

      const { players, communityCards, pots, currentActorIndex, dealerIndex, stage: gameStage } = gameState;
      const endedBeforeFlop = gameStage === 'finished' && communityCards.length === 0;

      // Community cards
      const numCommunity = communityCards.length;
      if (numCommunity > 0) {
        const cardW = width < 520 ? 36 : 42;
        const cardH = width < 520 ? 54 : 62;
        const cardGap = width < 520 ? 5 : 7;
        const totalW = numCommunity * cardW + (numCommunity - 1) * cardGap;
        let startX = cx - totalW / 2;
        for (const card of communityCards) {
          drawCard(layer, KonvaLib, card, startX, cy - cardH / 2 - 2, cardW, cardH);
          startX += cardW + cardGap;
        }
      }

      // Pot display
      const totalPot = pots.reduce((sum, p) => sum + p.amount, 0);
      if (totalPot > 0) {
        const potY = numCommunity > 0 ? cy + 58 : cy - 14;
        layer.add(
          new KonvaLib.Text({
            x: 0,
            y: potY,
            width,
            align: 'center',
            text: `Pot: $${totalPot.toLocaleString()}`,
            fontSize: width < 520 ? 13 : 14,
            fontStyle: 'bold',
            fill: '#f6e05e',
          })
        );
      }

      // Stage label
      if (gameStage && gameStage !== 'waiting') {
        layer.add(
          new KonvaLib.Text({
            x: 0,
            y: cy - 78,
            width,
            align: 'center',
            text: gameStage.replace('_', ' ').toUpperCase(),
            fontSize: 11,
            fill: '#a0aec0',
            letterSpacing: 2,
          })
        );
      }

      if (endedBeforeFlop) {
        layer.add(
          new KonvaLib.Text({
            x: 0,
            y: cy - 24,
            width,
            align: 'center',
            text: 'Hand ended before the flop. No community cards were dealt.',
            fontSize: 13,
            fill: '#d8dde8',
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
        drawSeat(layer, KonvaLib, player, px, py, width, height, layout, isActive, isDealer);
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
  }, [emptyLabel, gameState, height, isTerminalEmptyState, width]);

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
