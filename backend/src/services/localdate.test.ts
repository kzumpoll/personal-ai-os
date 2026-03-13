/**
 * Tests for wallClockToUtc — the timezone-safe conversion used for reminders.
 *
 * Covers the requirements:
 * - "tomorrow at 12" → correct USER_TZ wall-clock
 * - "next Wed 10am" → correct USER_TZ wall-clock
 * - "March 30 6pm" → correct USER_TZ wall-clock
 * - "10am ART" converted to USER_TZ (Claude converts before returning)
 * - Z-suffixed and offset-suffixed strings are stripped before conversion
 * - DST-safe two-pass conversion (tested with America/New_York)
 */
import { describe, it, expect } from 'vitest';
import { wallClockToUtc, naiveToUtc, utcIsoToLocalParts } from './localdate';

// ---------------------------------------------------------------------------
// wallClockToUtc — always strips Z/offset, then converts
// ---------------------------------------------------------------------------
describe('wallClockToUtc', () => {
  const makassar = 'Asia/Makassar'; // UTC+8, no DST

  it('"tomorrow at 12" — noon Makassar → 04:00 UTC', () => {
    const result = wallClockToUtc('2026-03-14T12:00:00', makassar);
    const d = new Date(result);
    expect(d.getUTCHours()).toBe(4);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it('"next Wed 10am" — 10:00 Makassar → 02:00 UTC', () => {
    // 2026-03-18 is a Wednesday
    const result = wallClockToUtc('2026-03-18T10:00:00', makassar);
    const d = new Date(result);
    expect(d.getUTCHours()).toBe(2);
  });

  it('"March 30 6pm" — 18:00 Makassar → 10:00 UTC', () => {
    const result = wallClockToUtc('2026-03-30T18:00:00', makassar);
    const d = new Date(result);
    expect(d.getUTCHours()).toBe(10);
  });

  it('"10am ART" → Claude converts to Makassar before returning (ART=UTC-3, +11h to Makassar = 21:00)', () => {
    // ART 10:00 = UTC 13:00 = Makassar 21:00
    // Claude is instructed to return wall-clock in USER_TZ, so it returns 21:00
    const result = wallClockToUtc('2026-03-14T21:00:00', makassar);
    const d = new Date(result);
    expect(d.getUTCHours()).toBe(13); // 21:00 Makassar = 13:00 UTC
  });

  it('strips Z suffix — treats "12:00:00Z" as wall-clock, not UTC', () => {
    const withZ = wallClockToUtc('2026-03-14T12:00:00Z', makassar);
    const withoutZ = wallClockToUtc('2026-03-14T12:00:00', makassar);
    expect(withZ).toBe(withoutZ);
    // Both should be 04:00 UTC (noon Makassar)
    expect(new Date(withZ).getUTCHours()).toBe(4);
  });

  it('strips +HH:MM offset — treats "12:00:00+08:00" as wall-clock, not offset-aware', () => {
    const withOffset = wallClockToUtc('2026-03-14T12:00:00+08:00', makassar);
    const withoutOffset = wallClockToUtc('2026-03-14T12:00:00', makassar);
    expect(withOffset).toBe(withoutOffset);
  });

  it('strips -HH:MM offset', () => {
    const result = wallClockToUtc('2026-03-14T10:00:00-03:00', makassar);
    // Should treat as 10:00 Makassar = 02:00 UTC
    expect(new Date(result).getUTCHours()).toBe(2);
  });

  it('roundtrips: wallClockToUtc → utcIsoToLocalParts gives back original time', () => {
    const naive = '2026-03-14T15:30:00';
    const utc = wallClockToUtc(naive, makassar);
    const parts = utcIsoToLocalParts(utc, makassar);
    expect(parts.hour).toBe(15);
    expect(parts.minute).toBe(30);
  });

  it('returns unparseable input as-is', () => {
    expect(wallClockToUtc('not-a-date', 'UTC')).toBe('not-a-date');
  });
});

// ---------------------------------------------------------------------------
// DST safety — test with a timezone that has DST
// ---------------------------------------------------------------------------
describe('wallClockToUtc — DST safety (America/New_York)', () => {
  const ny = 'America/New_York';

  it('winter time (EST, UTC-5): 12:00 NY → 17:00 UTC', () => {
    // 2026-01-15 is in winter (EST)
    const result = wallClockToUtc('2026-01-15T12:00:00', ny);
    expect(new Date(result).getUTCHours()).toBe(17);
  });

  it('summer time (EDT, UTC-4): 12:00 NY → 16:00 UTC', () => {
    // 2026-07-15 is in summer (EDT)
    const result = wallClockToUtc('2026-07-15T12:00:00', ny);
    expect(new Date(result).getUTCHours()).toBe(16);
  });

  it('spring forward: 2:30 AM on DST transition day', () => {
    // 2026-03-08 is spring forward in US — 2:00 AM jumps to 3:00 AM
    // 2:30 AM doesn't really exist, but should still produce a reasonable result
    const result = wallClockToUtc('2026-03-08T02:30:00', ny);
    const d = new Date(result);
    expect(d.toISOString()).toBeTruthy(); // should not NaN
  });

  it('fall back roundtrip: 1:30 AM EST after fall-back', () => {
    // 2026-11-01 is fall back in US — 1:30 AM could be EDT or EST
    // The function should produce a valid UTC time regardless
    const result = wallClockToUtc('2026-11-01T01:30:00', ny);
    const d = new Date(result);
    expect(d.toISOString()).toBeTruthy();
    // Should round-trip back to 1:30 in NY
    const parts = utcIsoToLocalParts(result, ny);
    expect(parts.hour).toBe(1);
    expect(parts.minute).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// naiveToUtc — backward compatibility (still passes through Z/offset)
// ---------------------------------------------------------------------------
describe('naiveToUtc — backward compat', () => {
  it('passes through Z-suffixed strings', () => {
    const input = '2026-03-14T05:00:00Z';
    expect(naiveToUtc(input, 'Asia/Bangkok')).toBe(input);
  });

  it('passes through offset strings', () => {
    const input = '2026-03-14T12:00:00+07:00';
    expect(naiveToUtc(input, 'Asia/Bangkok')).toBe(input);
  });

  it('converts naive strings correctly', () => {
    const result = naiveToUtc('2026-03-14T12:00:00', 'Asia/Makassar');
    expect(new Date(result).getUTCHours()).toBe(4);
  });
});
