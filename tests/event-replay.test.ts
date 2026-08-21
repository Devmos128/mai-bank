// tests/event-replay.test.ts — Backdated entries and cascade correctness

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

describe('Event replay and backdated entries', () => {
  test('AC1: After E7, Day 2 ledger balance excluding fees = -37000 fils (AED -370.00)', () => {
    // Process only through E7
    const ledger = makeLedger();
    ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E3', account_id: 'ACC-001', auth_id: 'Auth-A', hold_amount_fils: 20000, value_date: 2, posted_day: 2 });
    ledger.processEvent({ type: 'CREDIT', event_id: 'E4', account_id: 'ACC-001', amount_fils: 40000, value_date: 3, posted_day: 3 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E5', account_id: 'ACC-001', auth_id: 'Auth-A', settlement_amount_fils: 18500, value_date: 4, posted_day: 4 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E6', account_id: 'ACC-001', auth_id: 'Auth-Z', settlement_amount_fils: 18000, value_date: 4, posted_day: 4 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E7', account_id: 'ACC-001', amount_fils: 62000, value_date: 2, posted_day: 5 });

    // Balance for Day 2 excluding OVERDRAFT_FEE entries
    const entries = ledger.getEntries();
    const day2BalanceExclFees = entries
      .filter(e => e.account_id === 'ACC-001' && e.value_date <= 2 && e.entry_type !== EntryType.OVERDRAFT_FEE)
      .reduce((sum, e) => sum + e.amount_fils, 0);

    // E1(+120000) + E2(-95000) + E7(-62000) = -37000
    expect(day2BalanceExclFees).toBe(-37000);
  });

  test('Cascade: after E7, exactly 3 overdraft fees are booked on ACC-001 (Day 2, Day 4, Day 5)', () => {
    const ledger = makeLedger();
    ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E3', account_id: 'ACC-001', auth_id: 'Auth-A', hold_amount_fils: 20000, value_date: 2, posted_day: 2 });
    ledger.processEvent({ type: 'CREDIT', event_id: 'E4', account_id: 'ACC-001', amount_fils: 40000, value_date: 3, posted_day: 3 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E5', account_id: 'ACC-001', auth_id: 'Auth-A', settlement_amount_fils: 18500, value_date: 4, posted_day: 4 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E6', account_id: 'ACC-001', auth_id: 'Auth-Z', settlement_amount_fils: 18000, value_date: 4, posted_day: 4 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E7', account_id: 'ACC-001', amount_fils: 62000, value_date: 2, posted_day: 5 });

    const fees = ledger.getEntries().filter(
      e => e.account_id === 'ACC-001' && e.entry_type === EntryType.OVERDRAFT_FEE
    );

    expect(fees).toHaveLength(3);

    // Verify the specific days
    const feeDays = fees.map(f => f.value_date).sort((a, b) => a - b);
    expect(feeDays).toEqual([2, 4, 5]);

    // Confirm Day 3 has NO fee (balance was +500, still positive)
    const day3Fees = fees.filter(f => f.value_date === 3);
    expect(day3Fees).toHaveLength(0);
  });

  test('After E9 reversal, the 3 fees from E7 cascade still exist (append-only)', () => {
    const ledger = makeLedger();
    replayAllEvents(ledger);

    const fees = ledger.getEntries().filter(
      e => e.account_id === 'ACC-001' && e.entry_type === EntryType.OVERDRAFT_FEE
    );

    // Still exactly 3 fees — E9 does NOT remove or neutralize them
    expect(fees).toHaveLength(3);
  });

  test('After E9: Day 2 balance = 22500 fils (AED 225.00) — fee remains, balance does NOT return to pre-E7', () => {
    const ledger = makeLedger();
    replayAllEvents(ledger);

    const entries = ledger.getEntries();
    const day2Balance = entries
      .filter(e => e.account_id === 'ACC-001' && e.value_date <= 2)
      .reduce((sum, e) => sum + e.amount_fils, 0);

    // E1(+120000) + E2(-95000) + E7(-62000) + E9-reversal(+62000) + fee-day2(-2500)
    // = 120000 - 95000 - 62000 + 62000 - 2500 = 22500
    expect(day2Balance).toBe(22500);
  });

  test('Chain: after E9, Day 5 balance = 39000 fils (AED 390.00) — three fees are permanently in the ledger', () => {
    const ledger = makeLedger();
    replayAllEvents(ledger);

    const entries = ledger.getEntries();
    // Day 5 balance (before interest cap which posts at value_date 6)
    const day5Balance = entries
      .filter(e => e.account_id === 'ACC-001' && e.value_date <= 5 && e.entry_type !== EntryType.INTEREST_CAPITALISATION)
      .reduce((sum, e) => sum + e.amount_fils, 0);

    // After full replay (minus interest cap):
    // E1(+120000) + E2(-95000) + E3(auth,no entry) + E4(+40000) + E5(-18500)
    // + E7(-62000) + E7-fee-day2(-2500) + E7-fee-day4(-2500) + E7-fee-day5(-2500)
    // + E9-reversal(+62000)
    // = 120000 - 95000 + 40000 - 18500 - 62000 - 2500 - 2500 - 2500 + 62000
    // = 39000
    expect(day5Balance).toBe(39000);
  });
});
