// tests/instalments.test.ts — Instalment arithmetic exactness

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

describe('Instalment arithmetic exactness', () => {
  test('1. E10: exactly 3 CREDIT entries for ACC-002, all with value_date=5', () => {
    const ledger = makeLedger();
    replayAllEvents(ledger);

    const instalmentEntries = ledger.getEntries().filter(
      e => e.account_id === 'ACC-002'
        && e.entry_type === EntryType.CREDIT
        && e.value_date === 5
    );

    expect(instalmentEntries).toHaveLength(3);
  });

  test('2. Sum of instalment amounts = 10000 fils exactly', () => {
    const ledger = makeLedger();
    replayAllEvents(ledger);

    const instalmentEntries = ledger.getEntries().filter(
      e => e.account_id === 'ACC-002'
        && e.entry_type === EntryType.CREDIT
        && e.value_date === 5
    );

    const total = instalmentEntries.reduce((sum, e) => sum + e.amount_fils, 0);
    expect(total).toBe(10000);
  });

  test('3. First two instalments = 3333 fils each (floor division)', () => {
    const ledger = makeLedger();
    replayAllEvents(ledger);

    const instalmentEntries = ledger.getEntries()
      .filter(
        e => e.account_id === 'ACC-002'
          && e.entry_type === EntryType.CREDIT
          && e.value_date === 5
      )
      // Sort ascending by amount_fils to find the two smaller ones
      .sort((a, b) => a.amount_fils - b.amount_fils);

    // First two should each be 3333
    expect(instalmentEntries[0].amount_fils).toBe(3333);
    expect(instalmentEntries[1].amount_fils).toBe(3333);
  });

  test('4. Third (last) instalment = 3334 fils (base + remainder)', () => {
    const ledger = makeLedger();
    replayAllEvents(ledger);

    const instalmentEntries = ledger.getEntries()
      .filter(
        e => e.account_id === 'ACC-002'
          && e.entry_type === EntryType.CREDIT
          && e.value_date === 5
      )
      .sort((a, b) => a.amount_fils - b.amount_fils);

    expect(instalmentEntries[2].amount_fils).toBe(3334);
  });

  test('5. Arbitrary exactness: sum(instalments) == T for T=10000,N=3 and T=7,N=3 and T=100,N=7', () => {
    const cases: Array<{ total: number; count: number }> = [
      { total: 10000, count: 3 },
      { total: 7, count: 3 },
      { total: 100, count: 7 },
    ];

    for (const { total, count } of cases) {
      const ledger = new Ledger();
      ledger.registerAccount({ account_id: 'TEST', currency: 'BHD', minor_unit: 1000, opening_balance: 0 });

      ledger.processEvent({
        type: 'INSTALMENT_CREDIT',
        event_id: `IC-${total}-${count}`,
        account_id: 'TEST',
        total_amount_fils: total,
        instalments: count,
        value_date: 1,
        posted_day: 1,
      });

      const instalmentEntries = ledger.getEntries().filter(
        e => e.account_id === 'TEST' && e.entry_type === EntryType.CREDIT
      );

      expect(instalmentEntries).toHaveLength(count);
      const actualTotal = instalmentEntries.reduce((sum, e) => sum + e.amount_fils, 0);
      expect(actualTotal).toBe(total);
    }
  });

  test('6. AC7 disproof: implementation does NOT produce three equal 3334 fils entries (which would sum to 10002)', () => {
    const ledger = makeLedger();
    replayAllEvents(ledger);

    const instalmentEntries = ledger.getEntries().filter(
      e => e.account_id === 'ACC-002'
        && e.entry_type === EntryType.CREDIT
        && e.value_date === 5
    );

    // Three 3334s would sum to 10002, not 10000 — confirm the implementation rejects this
    const allEqual3334 = instalmentEntries.every(e => e.amount_fils === 3334);
    expect(allEqual3334).toBe(false);

    // Total must be 10000, not 10002
    const actualTotal = instalmentEntries.reduce((sum, e) => sum + e.amount_fils, 0);
    expect(actualTotal).not.toBe(10002);
    expect(actualTotal).toBe(10000);
  });
});
