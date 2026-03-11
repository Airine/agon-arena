'use client';

import { useEffect, useRef } from 'react';
import type { ChipSnapshot } from '../hooks/useArenaSocket';

interface Props {
  snapshots: ChipSnapshot[];
  height?: number;
}

// Color palette for up to 10 players
const COLORS = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#6e7074',
];

export default function ChipEquityChart({ snapshots, height = 200 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || snapshots.length === 0) return;

    let disposed = false;

    import('echarts').then((echarts) => {
      if (disposed || !containerRef.current) return;

      if (!chartRef.current) {
        chartRef.current = echarts.init(containerRef.current, 'dark');
      }

      const agentIds = snapshots[0]!.stacks.map((s) => s.agentId);
      const agentNames = new Map(snapshots[0]!.stacks.map((s) => [s.agentId, s.agentName]));
      const xData = snapshots.map((s) => `H${s.handNumber}`);

      const series = agentIds.map((agentId, idx) => ({
        name: agentNames.get(agentId) ?? agentId,
        type: 'line' as const,
        smooth: true,
        symbol: 'none',
        color: COLORS[idx % COLORS.length],
        data: snapshots.map((s) => s.stacks.find((p) => p.agentId === agentId)?.stack ?? 0),
      }));

      chartRef.current.setOption(
        {
          backgroundColor: 'transparent',
          grid: { top: series.length <= 6 ? 28 : 8, right: 8, bottom: 24, left: 50 },
          tooltip: { trigger: 'axis' },
          legend: {
            show: series.length <= 6,
            top: 0,
            textStyle: { color: '#ccc', fontSize: 10 },
          },
          xAxis: {
            type: 'category',
            data: xData,
            axisLabel: { color: '#888', fontSize: 10 },
            axisLine: { lineStyle: { color: '#444' } },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: '#888', fontSize: 10 },
            splitLine: { lineStyle: { color: '#2a2a2a' } },
          },
          series,
        },
        false,
      );
    });

    const observer = new ResizeObserver(() => {
      chartRef.current?.resize();
    });
    observer.observe(containerRef.current);

    return () => {
      disposed = true;
      observer.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [snapshots]);

  if (snapshots.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-gray-500 text-sm"
      >
        Waiting for first hand to complete…
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
