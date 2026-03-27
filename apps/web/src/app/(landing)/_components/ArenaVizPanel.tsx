'use client';
import { useRef } from 'react';
import type { ArenaType } from './arena-visualizations/arenaMetadata';
import { useAuctionViz } from './arena-visualizations/useAuctionViz';
import { useDebateViz } from './arena-visualizations/useDebateViz';
import { useLobViz } from './arena-visualizations/useLobViz';
import { usePokerViz } from './arena-visualizations/usePokerViz';
import { useTerritoryViz } from './arena-visualizations/useTerritoryViz';
import { useWerewolfViz } from './arena-visualizations/useWerewolfViz';

export function ArenaVizPanel({ activeArena }: { activeArena: ArenaType }) {
  const lobRef = useRef<HTMLCanvasElement>(null);
  const pokerRef = useRef<HTMLCanvasElement>(null);
  const werewolfRef = useRef<HTMLCanvasElement>(null);
  const debateRef = useRef<HTMLCanvasElement>(null);
  const auctionRef = useRef<HTMLCanvasElement>(null);
  const territoryRef = useRef<HTMLCanvasElement>(null);

  useLobViz(lobRef, activeArena === 'lob');
  usePokerViz(pokerRef, activeArena === 'poker');
  useWerewolfViz(werewolfRef, activeArena === 'werewolf');
  useDebateViz(debateRef, activeArena === 'debate');
  useAuctionViz(auctionRef, activeArena === 'auction');
  useTerritoryViz(territoryRef, activeArena === 'territory');

  const scenes: Array<{ id: ArenaType; ref: React.RefObject<HTMLCanvasElement | null> }> = [
    { id: 'lob', ref: lobRef },
    { id: 'poker', ref: pokerRef },
    { id: 'werewolf', ref: werewolfRef },
    { id: 'debate', ref: debateRef },
    { id: 'auction', ref: auctionRef },
    { id: 'territory', ref: territoryRef },
  ];

  return (
    <div className="arena-viz-wrap">
      {scenes.map(({ id, ref }) => (
        <div key={id} className={`viz-scene${activeArena === id ? ' active' : ''}`}>
          <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>
      ))}
    </div>
  );
}
