// tests/domain.test.ts — Ledger invariants

import { Ledger } from '../src/ledger';
import { EntryType, HoldStatus } from '../src/types';

function makeLedger(): Ledger {
  const ledger = new Ledger();
  ledger.registerAccount({ account_id: 'ACC-001', currency: 'AED', minor_unit: 100, opening_balance: 0 });
  ledger.registerAccount({ account_id: 'ACC-002', currency: 'BHD', minor_unit: 1000, opening_balance: 0 });
  return ledger;
}

function replayAllEvents(ledger: Ledger): void {
  // E1
  ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
  // E2
  ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });
  // E3
  ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E3', account_id: 'ACC-001', auth_id: 'Auth-A', hold_amount_fils: 20000, value_date: 2, posted_day: 2 });
  // E4
  ledger.processEvent({ type: 'CREDIT', event_id: 'E4', account_id: 'ACC-001', amount_fils: 40000, value_date: 3, posted_day: 3 });
  // E5
  ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E5', account_id: 'ACC-001', auth_id: 'Auth-A', settlement_amount_fils: 18500, value_date: 4, posted_day: 4 });
  // E6
  ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E6', account_id: 'ACC-001', auth_id: 'Auth-Z', settlement_amount_fils: 18000, value_date: 4, posted_day: 4 });
  // E7
  ledger.processEvent({ type: 'DEBIT', event_id: 'E7', account_id: 'ACC-001', amount_fils: 62000, value_date: 2, posted_day: 5 });
  // E8
  ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E8', account_id: 'ACC-001', auth_id: 'Auth-B', hold_amount_fils: 9000, value_date: 5, posted_day: 5 });
  // E9
  ledger.processEvent({ type: 'REVERSAL', event_id: 'E9', account_id: 'ACC-001', reverses_event_id: 'E7', value_date: 2, posted_day: 6 });
  // E10
  ledger.processEvent({ type: 'INSTALMENT_CREDIT', event_id: 'E10', account_id: 'ACC-002', total_amount_fils: 10000, instalments: 3, value_date: 5, posted_day: 5 });
  // Interest capitalisation at end of Day 6
  ledger.capitaliseInterest('ACC-001', 6);
  ledger.capitaliseInterest('ACC-002', 6);
}

describe('Domain invariants', () => {
  test('1. Opening balance is 0 for ACC-001 (AED)', () => {
    const ledger = makeLedger();
    const entries = ledger.getEntries().filter(e => e.account_id === 'ACC-001');
    const balance = entries.reduce((sum, e) => sum + e.amount_fils, 0);
    expect(balance).toBe(0);
  });

  test('2. Opening balance is 0 for ACC-002 (BHD)', () => {
    const ledger = makeLedger();
    const entries = ledger.getEntries().filter(e => e.account_id === 'ACC-002');
    const balance = entries.reduce((sum, e) => sum + e.amount_fils, 0);
    expect(balance).toBe(0);
  });

  test('3. All ledger entries have integer amount_fils (never float or fractional)', () => {
    const ledger = makeLedger();
    replayAllEvents(ledger);
    const entries = ledger.getEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(Number.isInteger(entry.amount_fils)).toBe(true);
    }
  });

  test('4. Entries are append-only: entry count never decreases after each event', () => {
    const ledger = makeLedger();
    const events = [
      { type: 'CREDIT' as const, event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 },
      { type: 'DEBIT' as const, event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 },
      { type: 'AUTHORIZATION' as const, event_id: 'E3', account_id: 'ACC-001', auth_id: 'Auth-A', hold_amount_fils: 20000, value_date: 2, posted_day: 2 },
      { type: 'CREDIT' as const, event_id: 'E4', account_id: 'ACC-001', amount_fils: 40000, value_date: 3, posted_day: 3 },
      { type: 'SETTLEMENT' as const, event_id: 'E5', account_id: 'ACC-001', auth_id: 'Auth-A', settlement_amount_fils: 18500, value_date: 4, posted_day: 4 },
      { type: 'SETTLEMENT' as const, event_id: 'E6', account_id: 'ACC-001', auth_id: 'Auth-Z', settlement_amount_fils: 18000, value_date: 4, posted_day: 4 },
      { type: 'DEBIT' as const, event_id: 'E7', account_id: 'ACC-001', amount_fils: 62000, value_date: 2, posted_day: 5 },
      { type: 'AUTHORIZATION' as const, event_id: 'E8', account_id: 'ACC-001', auth_id: 'Auth-B', hold_amount_fils: 9000, value_date: 5, posted_day: 5 },
      { type: 'REVERSAL' as const, event_id: 'E9', account_id: 'ACC-001', reverses_event_id: 'E7', value_date: 2, posted_day: 6 },
      { type: 'INSTALMENT_CREDIT' as const, event_id: 'E10', account_id: 'ACC-002', total_amount_fils: 10000, instalments: 3, value_date: 5, posted_day: 5 },
    ];

    let prevCount = 0;
    for (const event of events) {
      ledger.processEvent(event);
      const currentCount = ledger.getEntries().length;
      expect(currentCount).toBeGreaterThanOrEqual(prevCount);
      prevCount = currentCount;
    }
  });

  test('5. Only PENDING holds count toward active holds total', () => {
    const ledger = makeLedger();
    replayAllEvents(ledger);

    // Auth-A: stored in holds Map (was created as PENDING, then transitioned to SETTLED)
    const holds = ledger.getHolds();
    const authA = holds.find(h => h.auth_id === 'Auth-A');
    expect(authA).toBeDefined();
    expect(authA!.status).toBe(HoldStatus.SETTLED);

    // Auth-B was DECLINED — it was never inserted into the holds Map, but its outcome
    // is recorded in authOutcomes. Confirm the outcome is DECLINED.
    const authBOutcome = ledger.authOutcomes.find(o => o.auth_id === 'Auth-B');
    expect(authBOutcome).toBeDefined();
    expect(authBOutcome!.status).toBe('DECLINED');

    // Active holds (PENDING) should sum to 0 since Auth-A settled and Auth-B was never created
    const activeHoldsTotal = holds
      .filter(h => h.status === HoldStatus.PENDING && h.account_id === 'ACC-001')
      .reduce((sum, h) => sum + h.hold_amount_fils, 0);
    expect(activeHoldsTotal).toBe(0);
  });
});
