/**
 * tests/supplementary/reconciliation.test.ts
 *
 * NOT part of the graded deliverable. See supplementary/README.md.
 *
 * The double-entry check: for each account, the sum of every booked ledger entry
 * must equal the balance the ledger reports. If these ever disagree, the ledger
 * is reporting a number it cannot derive from its own entries — the single worst
 * failure mode for an append-only book, because it means the log is no longer
 * the source of truth.
 *
 * Note on the method name: the brief referred to `currentRunningBalance()`. No
 * such method exists on the public interface — the equivalent is
 * `ledgerBalance(account_id, as_of_day)` evaluated past the end of the window,
 * which sums every entry with value_date <= that day. It is used here rather
 * than adding a method to src/, since supplementary work must not alter the
 * graded deliverable.
 */

import { EntryType } from '../../src/types';
import { ACCOUNTS, WINDOW_DAYS, makeLedger, replayRealStream } from '../../supplementary/realStream';

/** Any day past the window: every entry has value_date <= this. */
const BEYOND_WINDOW = 10_000;

describe('Reconciliation — entries reconcile to reported balance', () => {
  test('sum of all booked entries equals the reported balance, per account', () => {
    const ledger = makeLedger();
    replayRealStream(ledger);

    for (const account of ACCOUNTS) {
      const summed = ledger
        .getEntries()
        .filter((e) => e.account_id === account)
        .reduce((total, e) => total + e.amount_fils, 0);

      expect(ledger.ledgerBalance(account, BEYOND_WINDOW)).toBe(summed);
    }
  });

  test('reconciliation holds at every day boundary, not just at the end', () => {
    const ledger = makeLedger();
    replayRealStream(ledger);

    for (const account of ACCOUNTS) {
      for (let day = 1; day <= WINDOW_DAYS; day++) {
        const summed = ledger
          .getEntries()
          .filter((e) => e.account_id === account && e.value_date <= day)
          .reduce((total, e) => total + e.amount_fils, 0);

        expect(ledger.ledgerBalance(account, day)).toBe(summed);
      }
    }
  });

  test('no entry belongs to an unregistered account', () => {
    const ledger = makeLedger();
    replayRealStream(ledger);

    for (const entry of ledger.getEntries()) {
      expect(ledger.getAccount(entry.account_id)).toBeDefined();
    }
  });

  test('every booked amount is a safe integer — no float contamination anywhere', () => {
    const ledger = makeLedger();
    replayRealStream(ledger);

    for (const entry of ledger.getEntries()) {
      expect(Number.isSafeInteger(entry.amount_fils)).toBe(true);
    }
  });

  test('rejected events contribute nothing to any balance', () => {
    const ledger = makeLedger();
    replayRealStream(ledger);

    // E6 (Auth-Z, 18000 fils) is rejected, so no entry may cite it as its source.
    expect(ledger.rejections.length).toBeGreaterThan(0);
    for (const rejection of ledger.rejections) {
      const orphan = ledger.getEntries().filter((e) => e.source_event === rejection.event_id);
      expect(orphan).toHaveLength(0);
    }
  });

  test('fees reconcile: every overdraft fee is exactly one -2500 entry on its day', () => {
    const ledger = makeLedger();
    replayRealStream(ledger);

    const fees = ledger.getEntries().filter((e) => e.entry_type === EntryType.OVERDRAFT_FEE);
    const byDay = new Map<string, number>();

    for (const fee of fees) {
      expect(fee.amount_fils).toBe(-2500);
      const key = `${fee.account_id}|${fee.value_date}`;
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }

    // The per-day idempotency guard means no account/day pair may carry two fees.
    for (const [key, count] of byDay) {
      expect(`${key} -> ${count}`).toBe(`${key} -> 1`);
    }
  });
});
