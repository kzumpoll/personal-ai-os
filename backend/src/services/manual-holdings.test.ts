/**
 * Tests for manual holdings logic — snapshot selection, total calculation,
 * and asset grouping used by the Crypto/Stocks tab.
 *
 * These are unit tests for the pure logic; they don't hit a database.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Types matching the DB schema
// ---------------------------------------------------------------------------
interface ManualHolding {
  id: string;
  as_of_date: string;
  asset_type: 'crypto' | 'stock';
  asset_name: string;
  platform: string;
  quantity: number | null;
  usd_value: number;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers that mirror dashboard logic
// ---------------------------------------------------------------------------

/** Select the latest snapshot (max as_of_date) from a list of holdings */
function latestSnapshot(holdings: ManualHolding[]): ManualHolding[] {
  if (holdings.length === 0) return [];
  const maxDate = holdings.reduce(
    (max, h) => (h.as_of_date > max ? h.as_of_date : max),
    holdings[0].as_of_date
  );
  return holdings.filter(h => h.as_of_date === maxDate);
}

/** Calculate total USD value for a set of holdings */
function totalUsd(holdings: ManualHolding[]): number {
  return holdings.reduce((sum, h) => sum + Number(h.usd_value), 0);
}

/** Group holdings by asset_type */
function groupByType(holdings: ManualHolding[]): { crypto: ManualHolding[]; stock: ManualHolding[] } {
  return {
    crypto: holdings.filter(h => h.asset_type === 'crypto'),
    stock: holdings.filter(h => h.asset_type === 'stock'),
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
function makeHolding(overrides: Partial<ManualHolding> & Pick<ManualHolding, 'as_of_date' | 'asset_type' | 'asset_name' | 'usd_value'>): ManualHolding {
  return {
    id: crypto.randomUUID(),
    platform: 'Manual',
    quantity: null,
    notes: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('latestSnapshot — picks only the most recent date', () => {
  it('returns holdings from the max as_of_date only', () => {
    const holdings = [
      makeHolding({ as_of_date: '2026-03-01', asset_type: 'crypto', asset_name: 'BTC', usd_value: 50000 }),
      makeHolding({ as_of_date: '2026-03-01', asset_type: 'crypto', asset_name: 'ETH', usd_value: 3000 }),
      makeHolding({ as_of_date: '2026-03-10', asset_type: 'crypto', asset_name: 'BTC', usd_value: 52000 }),
      makeHolding({ as_of_date: '2026-03-10', asset_type: 'stock', asset_name: 'NVDA', usd_value: 8000 }),
    ];
    const latest = latestSnapshot(holdings);
    expect(latest).toHaveLength(2);
    expect(latest.every(h => h.as_of_date === '2026-03-10')).toBe(true);
  });

  it('returns empty for empty input', () => {
    expect(latestSnapshot([])).toEqual([]);
  });

  it('returns all holdings when there is only one date', () => {
    const holdings = [
      makeHolding({ as_of_date: '2026-03-13', asset_type: 'crypto', asset_name: 'SOL', usd_value: 1200 }),
      makeHolding({ as_of_date: '2026-03-13', asset_type: 'stock', asset_name: 'AAPL', usd_value: 5000 }),
    ];
    const latest = latestSnapshot(holdings);
    expect(latest).toHaveLength(2);
  });
});

describe('totalUsd — sums usd_value correctly', () => {
  it('sums multiple holdings', () => {
    const holdings = [
      makeHolding({ as_of_date: '2026-03-13', asset_type: 'crypto', asset_name: 'BTC', usd_value: 50000 }),
      makeHolding({ as_of_date: '2026-03-13', asset_type: 'stock', asset_name: 'NVDA', usd_value: 8000 }),
      makeHolding({ as_of_date: '2026-03-13', asset_type: 'crypto', asset_name: 'ETH', usd_value: 3200.50 }),
    ];
    expect(totalUsd(holdings)).toBeCloseTo(61200.50);
  });

  it('returns 0 for empty holdings', () => {
    expect(totalUsd([])).toBe(0);
  });
});

describe('groupByType — separates crypto and stock', () => {
  it('groups correctly', () => {
    const holdings = [
      makeHolding({ as_of_date: '2026-03-13', asset_type: 'crypto', asset_name: 'BTC', usd_value: 50000 }),
      makeHolding({ as_of_date: '2026-03-13', asset_type: 'stock', asset_name: 'NVDA', usd_value: 8000 }),
      makeHolding({ as_of_date: '2026-03-13', asset_type: 'crypto', asset_name: 'SOL', usd_value: 1200 }),
      makeHolding({ as_of_date: '2026-03-13', asset_type: 'stock', asset_name: 'AAPL', usd_value: 5000 }),
    ];
    const groups = groupByType(holdings);
    expect(groups.crypto).toHaveLength(2);
    expect(groups.stock).toHaveLength(2);
    expect(groups.crypto.map(h => h.asset_name)).toContain('BTC');
    expect(groups.stock.map(h => h.asset_name)).toContain('NVDA');
  });

  it('handles all-crypto holdings', () => {
    const holdings = [
      makeHolding({ as_of_date: '2026-03-13', asset_type: 'crypto', asset_name: 'BTC', usd_value: 50000 }),
    ];
    const groups = groupByType(holdings);
    expect(groups.crypto).toHaveLength(1);
    expect(groups.stock).toHaveLength(0);
  });
});

describe('snapshot duplication — simulates copying rows to new date', () => {
  it('duplicated holdings get new date but same values', () => {
    const original = [
      makeHolding({ as_of_date: '2026-03-10', asset_type: 'crypto', asset_name: 'BTC', usd_value: 50000, platform: 'Trezor', quantity: 0.5 }),
      makeHolding({ as_of_date: '2026-03-10', asset_type: 'stock', asset_name: 'NVDA', usd_value: 8000, platform: 'Broker' }),
    ];
    const newDate = '2026-03-13';
    const duplicated = original.map(h => ({
      ...h,
      id: crypto.randomUUID(),
      as_of_date: newDate,
    }));
    expect(duplicated).toHaveLength(2);
    expect(duplicated[0].as_of_date).toBe('2026-03-13');
    expect(duplicated[0].asset_name).toBe('BTC');
    expect(duplicated[0].usd_value).toBe(50000);
    expect(duplicated[0].quantity).toBe(0.5);
    // Latest snapshot should now be the duplicated date
    const all = [...original, ...duplicated];
    const latest = latestSnapshot(all);
    expect(latest).toHaveLength(2);
    expect(latest[0].as_of_date).toBe('2026-03-13');
  });
});
