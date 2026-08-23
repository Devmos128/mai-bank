/**
 * supplementary/benchmark.ts
 *
 * NOT part of the graded deliverable. See supplementary/README.md.
 *
 * Purpose: empirically demonstrate the recompute-from-scratch cost that the
 * architecture document refers to. The ledger answers every balance question
 * by scanning the full entry list (`ledgerBalance` sums all entries with
 * value_date <= D), and fee re-assessment calls that scan once per day in the
 * affected range — plus a second full scan for the per-day idempotency guard.
 *
 * So the cost of processing event N is O(entries so far), and the cost of a
 * whole replay is O(N^2). This script measures that curve directly.
 *
 * Run:  npm run benchmark
 */

import { Ledger } from '../src/ledger';
import { LedgerEvent } from '../src/types';

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — a fixed seed keeps runs comparable.
// ---------------------------------------------------------------------------

function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));

// ---------------------------------------------------------------------------
// Synthetic stream generation
//
// The real stream is 10 events over a 6-day window. A multiplier M scales both
// axes: 10*M events over a 6*M day window, so M=100 gives the "100x-longer day
// window" (600 days) the architecture note discusses.
//
// Backdating is bounded (0-5 days, mirroring E7's 3-day backdate) so that the
// per-event re-assessment range stays realistic. The growth we are measuring is
// the full-entry-list scan, not an artificially unbounded day loop.
// ---------------------------------------------------------------------------

const ACCOUNT = 'BENCH-001';
const REAL_EVENTS = 10;
const REAL_WINDOW_DAYS = 6;

interface GeneratedStream {
  events: LedgerEvent[];
  windowDays: number;
}

function generateStream(multiplier: number, seed = 0x5eed): GeneratedStream {
  const rng = makeRng(seed);
  const count = REAL_EVENTS * multiplier;
  const windowDays = REAL_WINDOW_DAYS * multiplier;

  const events: LedgerEvent[] = [];

  // Seed the account so authorizations have funds to work against, but keep the
  // seed small: debits are drawn from a slightly wider range than credits, so the
  // running balance oscillates around zero and the overdraft-fee cascade actually
  // fires. A large seed keeps the account solvent forever and would leave the
  // most expensive code path (fee re-assessment) unmeasured.
  events.push({
    type: 'CREDIT',
    event_id: 'SEED',
    account_id: ACCOUNT,
    amount_fils: 250_000,
    value_date: 1,
    posted_day: 1,
  });

  const pendingAuths: { auth_id: string; hold: number; day: number }[] = [];
  let authSeq = 0;

  for (let i = 0; i < count; i++) {
    const value_date = randInt(rng, 1, windowDays);
    const posted_day = value_date + randInt(rng, 0, 5); // bounded backdating
    const roll = rng();
    const id = `S${i}`;

    if (roll < 0.45) {
      events.push({
        type: 'CREDIT',
        event_id: id,
        account_id: ACCOUNT,
        amount_fils: randInt(rng, 100, 300_000),
        value_date,
        posted_day,
      });
    } else if (roll < 0.8) {
      events.push({
        type: 'DEBIT',
        event_id: id,
        account_id: ACCOUNT,
        amount_fils: randInt(rng, 100, 380_000),
        value_date,
        posted_day,
      });
    } else if (roll < 0.92) {
      const auth_id = `AUTH-${authSeq++}`;
      const hold = randInt(rng, 100, 200_000);
      events.push({
        type: 'AUTHORIZATION',
        event_id: id,
        account_id: ACCOUNT,
        auth_id,
        hold_amount_fils: hold,
        value_date,
        posted_day,
      });
      pendingAuths.push({ auth_id, hold, day: posted_day });
    } else {
      // Settle a previously created authorization when one exists; otherwise
      // emit a settlement against an unknown id, which exercises the rejection
      // path (as E6/Auth-Z does in the real stream).
      const idx = pendingAuths.length > 0 ? randInt(rng, 0, pendingAuths.length - 1) : -1;
      if (idx >= 0) {
        const auth = pendingAuths.splice(idx, 1)[0];
        events.push({
          type: 'SETTLEMENT',
          event_id: id,
          account_id: ACCOUNT,
          auth_id: auth.auth_id,
          settlement_amount_fils: randInt(rng, 1, auth.hold), // never over-settles
          value_date: Math.max(value_date, auth.day),
          posted_day: Math.max(posted_day, auth.day),
        });
      } else {
        events.push({
          type: 'SETTLEMENT',
          event_id: id,
          account_id: ACCOUNT,
          auth_id: `MISSING-${i}`,
          settlement_amount_fils: randInt(rng, 100, 50_000),
          value_date,
          posted_day,
        });
      }
    }
  }

  return { events, windowDays };
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

interface Result {
  label: string;
  events: number;
  windowDays: number;
  entries: number;
  fees: number;
  rejections: number;
  ms: number;
}

function measure(label: string, multiplier: number): Result {
  const { events, windowDays } = generateStream(multiplier);

  const ledger = new Ledger();
  ledger.registerAccount({
    account_id: ACCOUNT,
    currency: 'AED',
    minor_unit: 100,
    opening_balance: 0,
  });

  const start = process.hrtime.bigint();
  for (const event of events) {
    ledger.processEvent(event);
  }
  const end = process.hrtime.bigint();

  const entries = ledger.getEntries();
  return {
    label,
    events: events.length,
    windowDays,
    entries: entries.length,
    fees: entries.filter((e) => e.entry_type === 'OVERDRAFT_FEE').length,
    rejections: ledger.rejections.length,
    ms: Number(end - start) / 1e6,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function pad(s: string | number, w: number, left = false): string {
  const str = String(s);
  return left ? str.padEnd(w) : str.padStart(w);
}

function main(): void {
  const scales: [string, number][] = [
    ['1x', 1],
    ['10x', 10],
    ['100x', 100],
    ['1000x', 1000],
  ];

  console.log('Replay cost vs. stream volume');
  console.log('(real stream = 10 events / 6-day window; multiplier scales both)\n');

  // Warm the JIT before measuring. Without this the first (smallest) row absorbs
  // compilation cost and reads as artificially slow, which would flatter the
  // larger rows in the relative column.
  for (let i = 0; i < 3; i++) {
    measure('warmup', 10);
  }

  const results: Result[] = [];
  for (const [label, multiplier] of scales) {
    results.push(measure(label, multiplier));
  }

  const header =
    pad('scale', 7, true) +
    pad('events', 9) +
    pad('days', 8) +
    pad('entries', 9) +
    pad('fees', 8) +
    pad('rejects', 9) +
    pad('time (ms)', 12) +
    pad('µs/event', 11) +
    pad('vs 1x', 12);
  console.log(header);
  console.log('-'.repeat(header.length));

  const base = results[0];
  for (const r of results) {
    const perEvent = (r.ms * 1000) / r.events;
    // Growth in per-event cost is the headline: flat would mean O(n) overall,
    // rising means each event pays for every entry already booked.
    const relative = r.ms / base.ms;
    console.log(
      pad(r.label, 7, true) +
        pad(r.events.toLocaleString(), 9) +
        pad(r.windowDays.toLocaleString(), 8) +
        pad(r.entries.toLocaleString(), 9) +
        pad(r.fees.toLocaleString(), 8) +
        pad(r.rejections.toLocaleString(), 9) +
        pad(r.ms.toFixed(2), 12) +
        pad(perEvent.toFixed(2), 11) +
        pad(relative.toLocaleString(undefined, { maximumFractionDigits: 0 }) + '×', 12),
    );
  }

  console.log('\nPer-event cost (µs/event) is the column that matters: it rises with');
  console.log('volume because every balance query rescans the whole entry list, so');
  console.log('event N pays O(N). Total replay is therefore quadratic, which is the');
  console.log('recompute-from-scratch cost the architecture document proposes fixing');
  console.log('with per-day balance snapshots.');
}

main();
