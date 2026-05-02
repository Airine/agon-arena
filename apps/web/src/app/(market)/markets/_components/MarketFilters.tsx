'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

const GAME_TYPE_FILTERS = [
  { label: 'All', value: '' },
  { label: "Texas Hold'em", value: 'texas_holdem' },
  { label: 'LOB Market-Making', value: 'lob_market_making' },
];

const SORT_OPTIONS = [
  { label: 'Prize Pool', value: 'prize' },
  { label: 'Most Bets', value: 'bets' },
  { label: 'Ending Soon', value: 'ending' },
];

export default function MarketFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentType = searchParams.get('type') ?? '';
  const currentSort = searchParams.get('sort') ?? 'prize';

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/markets?${params.toString()}`);
    },
    [router, searchParams],
  );

  return (
    <div className="markets-page__filters">
      <div className="market-filter-pills">
        {GAME_TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            className={`market-filter-pill${currentType === f.value ? ' market-filter-pill--active' : ''}`}
            onClick={() => updateParam('type', f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <select
        className="market-sort-select"
        value={currentSort}
        onChange={(e) => updateParam('sort', e.target.value)}
        aria-label="Sort arenas by"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
