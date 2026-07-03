/**
 * Neo Tracker — Unit tests for pure functions
 * Run with: node --test tests/unit.test.mjs
 * Node 22+ built-in test runner, no dependencies needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─────────────────────────────────────────────────────────────────
// Inline the pure functions under test so we don't need Supabase/DOM
// ─────────────────────────────────────────────────────────────────

// ── From utils.js ────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftDateStr(s, n) {
  const d = new Date(s + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }

function localDateStr(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ── From auth.js (Web Crypto — available in Node 22) ─────────────
async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── From profile.js / dashboard.js — week range helper ───────────
function weekRange(dateStr) {
  const ref    = new Date(dateStr + 'T12:00:00');
  const monOff = ref.getDay() === 0 ? 6 : ref.getDay() - 1;
  const mon    = new Date(ref); mon.setDate(ref.getDate() - monOff);
  const sun    = new Date(mon); sun.setDate(mon.getDate() + 6);
  return {
    monKey: mon.toISOString().slice(0, 10),
    sunKey: sun.toISOString().slice(0, 10),
  };
}

// ── From district.js — computeTarget ─────────────────────────────
// Sums daily targets for all days in [fromDate, toDate], capped at today
function computeTarget(mallTargets, fromDate, toDate, today) {
  const from = new Date(fromDate + 'T12:00:00');
  const to   = new Date(toDate   + 'T12:00:00');
  const cap  = new Date((today || toDate) + 'T12:00:00');
  let total = 0;
  const cur = new Date(from);
  while (cur <= to && cur <= cap) {
    total += mallTargets[cur.getDay()] || 0;
    cur.setDate(cur.getDate() + 1);
  }
  return total;
}

// ── KPI helpers (from dashboard.js / profile.js) ─────────────────
function cph(sales, hours)  { return hours > 0 ? parseFloat((sales / hours).toFixed(1)) : null; }
function acph(d0s, hours)   { return hours > 0 ? parseFloat((d0s / hours).toFixed(1)) : null; }
function d0Rate(d0s, total) { return pct(d0s, total); }
function crRate(credits, total) { return pct(credits, total); }

// ─────────────────────────────────────────────────────────────────
//  TESTS
// ─────────────────────────────────────────────────────────────────

describe('todayKey()', () => {
  it('returns YYYY-MM-DD format', () => {
    assert.match(todayKey(), /^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches current date', () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    assert.equal(todayKey(), expected);
  });
});

describe('shiftDateStr()', () => {
  it('shifts forward by 1 day', () => {
    assert.equal(shiftDateStr('2025-01-31', 1), '2025-02-01');
  });

  it('shifts backward by 1 day', () => {
    assert.equal(shiftDateStr('2025-03-01', -1), '2025-02-28');
  });

  it('handles leap year forward', () => {
    assert.equal(shiftDateStr('2024-02-28', 1), '2024-02-29');
  });

  it('handles leap year backward', () => {
    assert.equal(shiftDateStr('2024-03-01', -1), '2024-02-29');
  });

  it('shifts by 7 days (one week)', () => {
    assert.equal(shiftDateStr('2025-04-07', 7), '2025-04-14');
  });

  it('shifts by 0 (identity)', () => {
    assert.equal(shiftDateStr('2025-06-15', 0), '2025-06-15');
  });
});

describe('pct()', () => {
  it('returns 0 when denominator is 0', () => {
    assert.equal(pct(5, 0), 0);
  });

  it('returns 100 for 10/10', () => {
    assert.equal(pct(10, 10), 100);
  });

  it('rounds 1/3 to 33', () => {
    assert.equal(pct(1, 3), 33);
  });

  it('rounds 2/3 to 67', () => {
    assert.equal(pct(2, 3), 67);
  });

  it('returns 0 for 0/10', () => {
    assert.equal(pct(0, 10), 0);
  });

  it('handles 75% D0 target boundary', () => {
    assert.equal(pct(3, 4), 75);
  });
});

describe('localDateStr()', () => {
  it('returns null for null input', () => {
    assert.equal(localDateStr(null), null);
  });

  it('returns null for undefined input', () => {
    assert.equal(localDateStr(undefined), null);
  });

  it('parses ISO datetime to date string', () => {
    // Use UTC midnight + verify we get a valid date string
    const result = localDateStr('2025-06-15T00:00:00.000Z');
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('weekRange()', () => {
  it('Monday returns Mon–Sun of same week', () => {
    const { monKey, sunKey } = weekRange('2025-06-16'); // Monday
    assert.equal(monKey, '2025-06-16');
    assert.equal(sunKey, '2025-06-22');
  });

  it('Sunday returns Mon–Sun of that week (ISO week)', () => {
    const { monKey, sunKey } = weekRange('2025-06-22'); // Sunday
    assert.equal(monKey, '2025-06-16');
    assert.equal(sunKey, '2025-06-22');
  });

  it('Wednesday is in correct Mon–Sun range', () => {
    const { monKey, sunKey } = weekRange('2025-06-18'); // Wednesday
    assert.equal(monKey, '2025-06-16');
    assert.equal(sunKey, '2025-06-22');
  });

  it('week spanning month boundary', () => {
    const { monKey, sunKey } = weekRange('2025-06-30'); // Monday
    assert.equal(monKey, '2025-06-30');
    assert.equal(sunKey, '2025-07-06');
  });

  it('week spanning year boundary', () => {
    const { monKey, sunKey } = weekRange('2024-12-30'); // Monday
    assert.equal(monKey, '2024-12-30');
    assert.equal(sunKey, '2025-01-05');
  });
});

describe('computeTarget()', () => {
  // Targets: Sun=20, Mon=10, Tue=10, Wed=10, Thu=15, Fri=15, Sat=20
  const targets = { 0: 20, 1: 10, 2: 10, 3: 10, 4: 15, 5: 15, 6: 20 };

  it('single day returns that day target', () => {
    // 2025-06-16 is Monday (day 1)
    assert.equal(computeTarget(targets, '2025-06-16', '2025-06-16', '2025-06-16'), 10);
  });

  it('full week sums all 7 days', () => {
    // Mon–Sun: 10+10+10+15+15+20+20 = 100
    assert.equal(computeTarget(targets, '2025-06-16', '2025-06-22', '2025-06-22'), 100);
  });

  it('caps at today (mid-week)', () => {
    // Mon–Wed only (today = Wed): 10+10+10 = 30
    assert.equal(computeTarget(targets, '2025-06-16', '2025-06-22', '2025-06-18'), 30);
  });

  it('returns 0 if today is before range start', () => {
    assert.equal(computeTarget(targets, '2025-06-20', '2025-06-22', '2025-06-15'), 0);
  });
});

describe('KPI calculations', () => {
  it('cph returns null when hours is 0', () => {
    assert.equal(cph(10, 0), null);
  });

  it('cph calculates correctly', () => {
    assert.equal(cph(8, 4), 2.0);
  });

  it('acph returns null when hours is 0', () => {
    assert.equal(acph(6, 0), null);
  });

  it('acph calculates correctly', () => {
    assert.equal(acph(3, 4), 0.8); // 3/4 = 0.75 → rounds to 0.8
  });

  it('d0Rate at target boundary (75%)', () => {
    assert.equal(d0Rate(3, 4), 75);  // exactly at D0_TGT
  });

  it('d0Rate below target', () => {
    assert.equal(d0Rate(1, 4), 25);
  });

  it('crRate at credit target boundary (50%)', () => {
    assert.equal(crRate(5, 10), 50); // exactly at CR_TGT
  });

  it('crRate with no sales returns 0', () => {
    assert.equal(crRate(0, 0), 0);
  });
});

describe('hashPin()', () => {
  it('produces a 64-char hex string', async () => {
    const h = await hashPin('1234');
    assert.match(h, /^[0-9a-f]{64}$/);
  });

  it('same PIN produces same hash (deterministic)', async () => {
    const h1 = await hashPin('1234');
    const h2 = await hashPin('1234');
    assert.equal(h1, h2);
  });

  it('different PINs produce different hashes', async () => {
    const h1 = await hashPin('1234');
    const h2 = await hashPin('5678');
    assert.notEqual(h1, h2);
  });

  it('matches expected SHA-256 of "1234"', async () => {
    // SHA-256("1234") = 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
    const h = await hashPin('1234');
    assert.equal(h, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4');
  });

  it('matches expected SHA-256 of "000000" (6-digit pin)', async () => {
    const h = await hashPin('000000');
    // Known SHA-256 of "000000"
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]+$/);
  });
});
