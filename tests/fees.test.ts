// tests/fees.test.ts — Fee assessment correctness and idempotency

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

describe('Fee assessment', () => {
  test('1. No fee on Day 1 — balance is 25000 fils (positive)', () => {
    const ledger = makeLedger();
    ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });

    const fees = ledger.getEntries().filter(
      e => e.account_id === 'ACC-001' && e.entry_type === EntryType.OVERDRAFT_FEE && e.value_date === 1
    );
    expect(fees).toHaveLength(0);
  });

  test('2. E7 triggers exactly one fee on Day 2 (idempotent: re-assessment still has exactly 1 fee for Day 2)', () => {
    const ledger = makeLedger();
    ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E3', account_id: 'ACC-001', auth_id: 'Auth-A', hold_amount_fils: 20000, value_date: 2, posted_day: 2 });
    ledger.processEvent({ type: 'CREDIT', event_id: 'E4', account_id: 'ACC-001', amount_fils: 40000, value_date: 3, posted_day: 3 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E5', account_id: 'ACC-001', auth_id: 'Auth-A', settlement_amount_fils: 18500, value_date: 4, posted_day: 4 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E6', account_id: 'ACC-001', auth_id: 'Auth-Z', settlement_amount_fils: 18000, value_date: 4, posted_day: 4 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E7', account_id: 'ACC-001', amount_fils: 62000, value_date: 2, posted_day: 5 });

    const day2Fees = ledger.getEntries().filter(
      e => e.account_id === 'ACC-001' && e.entry_type === EntryType.OVERDRAFT_FEE && e.value_date === 2
    );
    expect(day2Fees).toHaveLength(1);
    expect(day2Fees[0].amount_fils).toBe(-2500);
  });

  test('3. Double-event idempotency: Day 2 fee is not doubled after a second debit', () => {
    const ledger = makeLedger();
    // Process E1, E2, E7 to push Day 2 negative and get 1 fee
    ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E7', account_id: 'ACC-001', amount_fils: 62000, value_date: 2, posted_day: 5 });

    const feesAfterFirst = ledger.getEntries().filter(
      e => e.account_id === 'ACC-001' && e.entry_type === EntryType.OVERDRAFT_FEE && e.value_date === 2
    );
    expect(feesAfterFirst).toHaveLength(1);

    // Process a second backdated debit also at value_date Day 2
    ledger.processEvent({ type: 'DEBIT', event_id: 'E7B', account_id: 'ACC-001', amount_fils: 1, value_date: 2, posted_day: 5 });

    const feesAfterSecond = ledger.getEntries().filter(
      e => e.account_id === 'ACC-001' && e.entry_type === EntryType.OVERDRAFT_FEE && e.value_date === 2
    );
    // Still only 1 fee — idempotency guard must block duplicate
    expect(feesAfterSecond).toHaveLength(1);
  });

  test('4. Deterministic replay: two separate ledger instances produce identical results', () => {
    const ledger1 = makeLedger();
    const ledger2 = makeLedger();

    replayAllEvents(ledger1);
    replayAllEvents(ledger2);

    const entries1 = ledger1.getEntries()
      .map(e => ({ account_id: e.account_id, amount_fils: e.amount_fils, value_date: e.value_date, entry_type: e.entry_type }))
      .sort((a, b) => a.value_date - b.value_date || a.amount_fils - b.amount_fils);

    const entries2 = ledger2.getEntries()
      .map(e => ({ account_id: e.account_id, amount_fils: e.amount_fils, value_date: e.value_date, entry_type: e.entry_type }))
      .sort((a, b) => a.value_date - b.value_date || a.amount_fils - b.amount_fils);

    expect(entries1).toEqual(entries2);
  });

  test('5. Day 3 has NO fee — balance is +500 fils (positive) after Day 2 fee cascade', () => {
    const ledger = makeLedger();
    ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E3', account_id: 'ACC-001', auth_id: 'Auth-A', hold_amount_fils: 20000, value_date: 2, posted_day: 2 });
    ledger.processEvent({ type: 'CREDIT', event_id: 'E4', account_id: 'ACC-001', amount_fils: 40000, value_date: 3, posted_day: 3 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E5', account_id: 'ACC-001', auth_id: 'Auth-A', settlement_amount_fils: 18500, value_date: 4, posted_day: 4 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E6', account_id: 'ACC-001', auth_id: 'Auth-Z', settlement_amount_fils: 18000, value_date: 4, posted_day: 4 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E7', account_id: 'ACC-001', amount_fils: 62000, value_date: 2, posted_day: 5 });

    // Day 3 closing balance = Day 2 after fee (-39500) + E4 (+40000) = +500 fils
    const day3Fees = ledger.getEntries().filter(
      e => e.account_id === 'ACC-001' && e.entry_type === EntryType.OVERDRAFT_FEE && e.value_date === 3
    );
    expect(day3Fees).toHaveLength(0);

    // Also verify Day 3 balance is indeed +500
    const day3Balance = ledger.getEntries()
      .filter(e => e.account_id === 'ACC-001' && e.value_date <= 3)
      .reduce((sum, e) => sum + e.amount_fils, 0);
    expect(day3Balance).toBe(500);
  });
});
