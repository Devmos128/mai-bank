/**
 * supplementary/determinism.test.ts
 *
 * NOT part of the graded deliverable. See supplementary/README.md.
 *
 * Replay is the only way this ledger reconstructs state, so replay has to be a
 * pure function of the event stream. If two fresh instances fed identical events
 * could diverge — through iteration order, shared mutable state, a stray
 * Date.now(), or an id counter leaking across instances — then rebuilding an
 * account from its log would not be trustworthy, and an append-only design
 * offers nothing.
 */

import { EntryType } from '../src/types';
import { ACCOUNTS, WINDOW_DAYS, makeLedger, replayRealStream } from './realStream';

describe('Replay determinism', () => {
  test('two independent replays produce identical closing balances', () => {
    const a = makeLedger();
    const b = makeLedger();
    replayRealStream(a);
    replayRealStream(b);

    for (const account of ACCOUNTS) {
      for (let day = 1; day <= WINDOW_DAYS; day++) {
        expect(a.ledgerBalance(account, day)).toBe(b.ledgerBalance(account, day));
      }
    }
  });

  test('two independent replays produce identical fee counts, per day and per account', () => {
    const a = makeLedger();
    const b = makeLedger();
    replayRealStream(a);
    replayRealStream(b);

    for (const account of ACCOUNTS) {
      for (let day = 1; day <= WINDOW_DAYS; day++) {
        const feesA = a.feesOnDay(account, day);
        const feesB = b.feesOnDay(account, day);
        expect(feesA.length).toBe(feesB.length);
        expect(feesA.map((f) => f.amount_fils)).toEqual(feesB.map((f) => f.amount_fils));
      }
    }
  });

  test('two independent replays produce identical rejection lists', () => {
    const a = makeLedger();
    const b = makeLedger();
    replayRealStream(a);
    replayRealStream(b);

    expect(a.rejections.length).toBe(b.rejections.length);
    expect(a.rejections.map((r) => `${r.event_id}|${r.reason}`)).toEqual(
      b.rejections.map((r) => `${r.event_id}|${r.reason}`),
    );
  });

  test('two independent replays produce identical authorization outcomes', () => {
    const a = makeLedger();
    const b = makeLedger();
    replayRealStream(a);
    replayRealStream(b);

    expect(a.authOutcomes.map((o) => `${o.auth_id}|${o.status}|${o.hold_amount_fils}`)).toEqual(
      b.authOutcomes.map((o) => `${o.auth_id}|${o.status}|${o.hold_amount_fils}`),
    );
  });

  test('entry sequences match on everything except the instance-local entry_id', () => {
    const a = makeLedger();
    const b = makeLedger();
    replayRealStream(a);
    replayRealStream(b);

    // entry_id comes from a module-level counter, so it is not expected to match
    // across instances. Every field that describes the *economic* result must.
    const shape = (l: ReturnType<typeof makeLedger>) =>
      l.getEntries().map((e) => ({
        account_id: e.account_id,
        amount_fils: e.amount_fils,
        value_date: e.value_date,
        entry_type: e.entry_type,
        source_event: e.source_event,
        posted_day: e.posted_day,
      }));

    expect(shape(a)).toEqual(shape(b));
  });

  test('replay is stable across repeated runs, not just two', () => {
    const signature = () => {
      const l = makeLedger();
      replayRealStream(l);
      return JSON.stringify({
        balances: ACCOUNTS.map((acc) => l.ledgerBalance(acc, WINDOW_DAYS)),
        fees: l.getEntries().filter((e) => e.entry_type === EntryType.OVERDRAFT_FEE).length,
        rejections: l.rejections.length,
      });
    };

    const first = signature();
    for (let i = 0; i < 25; i++) {
      expect(signature()).toBe(first);
    }
  });
});
