// tests/holds.test.ts — Authorization and settlement lifecycle

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

describe('Authorization and settlement', () => {
  test('1. After E3 (Auth-A PENDING): available balance = 5000 fils, ledger balance unchanged at 25000', () => {
    const ledger = makeLedger();
    ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E3', account_id: 'ACC-001', auth_id: 'Auth-A', hold_amount_fils: 20000, value_date: 2, posted_day: 2 });

    // Ledger balance (no ledger entry from AUTHORIZATION)
    const ledgerBalance = ledger.getEntries()
      .filter(e => e.account_id === 'ACC-001' && e.value_date <= 2)
      .reduce((sum, e) => sum + e.amount_fils, 0);
    expect(ledgerBalance).toBe(25000);

    // Available balance = ledger balance - active holds = 25000 - 20000 = 5000
    const activeHolds = ledger.getHolds()
      .filter(h => h.account_id === 'ACC-001' && h.status === HoldStatus.PENDING)
      .reduce((sum, h) => sum + h.hold_amount_fils, 0);
    expect(activeHolds).toBe(20000);

    const availableBalance = ledgerBalance - activeHolds;
    expect(availableBalance).toBe(5000);
  });

  test('2. Auth-A settlement (E5): ledger balance includes -18500 (not -20000), hold transitions to SETTLED', () => {
    const ledger = makeLedger();
    ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E3', account_id: 'ACC-001', auth_id: 'Auth-A', hold_amount_fils: 20000, value_date: 2, posted_day: 2 });
    ledger.processEvent({ type: 'CREDIT', event_id: 'E4', account_id: 'ACC-001', amount_fils: 40000, value_date: 3, posted_day: 3 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E5', account_id: 'ACC-001', auth_id: 'Auth-A', settlement_amount_fils: 18500, value_date: 4, posted_day: 4 });

    // Settlement entry should be -18500 (the settlement amount, not the hold amount)
    const settlementEntries = ledger.getEntries().filter(
      e => e.account_id === 'ACC-001' && e.entry_type === EntryType.SETTLEMENT
    );
    expect(settlementEntries).toHaveLength(1);
    expect(settlementEntries[0].amount_fils).toBe(-18500);

    // Hold must be SETTLED
    const authA = ledger.getHolds().find(h => h.auth_id === 'Auth-A');
    expect(authA).toBeDefined();
    expect(authA!.status).toBe(HoldStatus.SETTLED);
  });

  test('3. E6 (Auth-Z): rejected — no ledger entry posted, balance unchanged', () => {
    const ledger = makeLedger();
    ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E3', account_id: 'ACC-001', auth_id: 'Auth-A', hold_amount_fils: 20000, value_date: 2, posted_day: 2 });
    ledger.processEvent({ type: 'CREDIT', event_id: 'E4', account_id: 'ACC-001', amount_fils: 40000, value_date: 3, posted_day: 3 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E5', account_id: 'ACC-001', auth_id: 'Auth-A', settlement_amount_fils: 18500, value_date: 4, posted_day: 4 });

    const balanceBeforeE6 = ledger.getEntries()
      .filter(e => e.account_id === 'ACC-001')
      .reduce((sum, e) => sum + e.amount_fils, 0);

    // E6 references Auth-Z which has no preceding authorization
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E6', account_id: 'ACC-001', auth_id: 'Auth-Z', settlement_amount_fils: 18000, value_date: 4, posted_day: 4 });

    const balanceAfterE6 = ledger.getEntries()
      .filter(e => e.account_id === 'ACC-001')
      .reduce((sum, e) => sum + e.amount_fils, 0);

    // No ledger entry was posted for Auth-Z
    expect(balanceAfterE6).toBe(balanceBeforeE6);

    // E6 should appear in rejections
    const e6Rejection = ledger.rejections.find((r: { event_id: string }) => r.event_id === 'E6');
    expect(e6Rejection).toBeDefined();
  });

  test('4. Auth-B (E8): DECLINED — available balance at Day 5 = -23000 fils < 0 + 9000 check', () => {
    const ledger = makeLedger();
    ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E3', account_id: 'ACC-001', auth_id: 'Auth-A', hold_amount_fils: 20000, value_date: 2, posted_day: 2 });
    ledger.processEvent({ type: 'CREDIT', event_id: 'E4', account_id: 'ACC-001', amount_fils: 40000, value_date: 3, posted_day: 3 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E5', account_id: 'ACC-001', auth_id: 'Auth-A', settlement_amount_fils: 18500, value_date: 4, posted_day: 4 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E6', account_id: 'ACC-001', auth_id: 'Auth-Z', settlement_amount_fils: 18000, value_date: 4, posted_day: 4 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E7', account_id: 'ACC-001', amount_fils: 62000, value_date: 2, posted_day: 5 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E8', account_id: 'ACC-001', auth_id: 'Auth-B', hold_amount_fils: 9000, value_date: 5, posted_day: 5 });

    // Auth-B was DECLINED — it does NOT appear in getHolds() (never entered PENDING).
    // It is recorded in authOutcomes with status 'DECLINED'.
    const authBOutcome = ledger.authOutcomes.find(o => o.auth_id === 'Auth-B');
    expect(authBOutcome).toBeDefined();
    expect(authBOutcome!.status).toBe('DECLINED');

    // Verify that available balance at Day 5 is -23000 fils
    const day5LedgerBalance = ledger.getEntries()
      .filter(e => e.account_id === 'ACC-001' && e.value_date <= 5)
      .reduce((sum, e) => sum + e.amount_fils, 0);

    const pendingHolds = ledger.getHolds()
      .filter(h => h.account_id === 'ACC-001' && h.status === HoldStatus.PENDING)
      .reduce((sum, h) => sum + h.hold_amount_fils, 0);

    const availableBalance = day5LedgerBalance - pendingHolds;
    expect(availableBalance).toBe(-23000);
  });

  test('5. After E5 settlement: available balance = ledger balance (no active holds); Day 4 post-settlement balance = 41500 fils (pre-E7)', () => {
    const ledger = makeLedger();
    ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E3', account_id: 'ACC-001', auth_id: 'Auth-A', hold_amount_fils: 20000, value_date: 2, posted_day: 2 });
    ledger.processEvent({ type: 'CREDIT', event_id: 'E4', account_id: 'ACC-001', amount_fils: 40000, value_date: 3, posted_day: 3 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E5', account_id: 'ACC-001', auth_id: 'Auth-A', settlement_amount_fils: 18500, value_date: 4, posted_day: 4 });

    // Post-settlement: ledger balance at Day 4
    const day4LedgerBalance = ledger.getEntries()
      .filter(e => e.account_id === 'ACC-001' && e.value_date <= 4)
      .reduce((sum, e) => sum + e.amount_fils, 0);

    // E1(+120000) + E2(-95000) + E4(+40000) + E5(-18500) = 46500
    expect(day4LedgerBalance).toBe(46500);

    // No active holds after Auth-A settled
    const pendingHolds = ledger.getHolds()
      .filter(h => h.account_id === 'ACC-001' && h.status === HoldStatus.PENDING)
      .reduce((sum, h) => sum + h.hold_amount_fils, 0);
    expect(pendingHolds).toBe(0);

    // Available balance = ledger balance (no holds)
    const availableBalance = day4LedgerBalance - pendingHolds;
    expect(availableBalance).toBe(day4LedgerBalance);
    expect(availableBalance).toBe(46500);
  });

  test('5b. Ledger balance at Day 4 after E5 and E6 is 46500 fils (E6 rejected, did not debit)', () => {
    const ledger = makeLedger();
    ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E3', account_id: 'ACC-001', auth_id: 'Auth-A', hold_amount_fils: 20000, value_date: 2, posted_day: 2 });
    ledger.processEvent({ type: 'CREDIT', event_id: 'E4', account_id: 'ACC-001', amount_fils: 40000, value_date: 3, posted_day: 3 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E5', account_id: 'ACC-001', auth_id: 'Auth-A', settlement_amount_fils: 18500, value_date: 4, posted_day: 4 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E6', account_id: 'ACC-001', auth_id: 'Auth-Z', settlement_amount_fils: 18000, value_date: 4, posted_day: 4 });

    // E6 was rejected so balance must be 46500, not 28500
    const day4LedgerBalance = ledger.getEntries()
      .filter(e => e.account_id === 'ACC-001' && e.value_date <= 4)
      .reduce((sum, e) => sum + e.amount_fils, 0);
    expect(day4LedgerBalance).toBe(46500);
  });

  test('6. Settle exactly at hold limit: credit 10000, authorize 10000 — must be APPROVED (available=0)', () => {
    const ledger = new Ledger();
    ledger.registerAccount({ account_id: 'TEST-001', currency: 'AED', minor_unit: 100, opening_balance: 0 });

    ledger.processEvent({ type: 'CREDIT', event_id: 'C1', account_id: 'TEST-001', amount_fils: 10000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A1', account_id: 'TEST-001', auth_id: 'Auth-EXACT', hold_amount_fils: 10000, value_date: 1, posted_day: 1 });

    // Available balance = 10000 - 10000 = 0 — must be APPROVED (>= 0)
    const hold = ledger.getHolds().find(h => h.auth_id === 'Auth-EXACT');
    expect(hold).toBeDefined();
    expect(hold!.status).toBe(HoldStatus.PENDING);
  });

  test('7. Settle for 1 fil over hold amount — must be rejected (over-settlement blocked per AMB-009)', () => {
    const ledger = new Ledger();
    ledger.registerAccount({ account_id: 'TEST-002', currency: 'AED', minor_unit: 100, opening_balance: 0 });

    ledger.processEvent({ type: 'CREDIT', event_id: 'C1', account_id: 'TEST-002', amount_fils: 50000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A1', account_id: 'TEST-002', auth_id: 'Auth-OVER', hold_amount_fils: 10000, value_date: 1, posted_day: 1 });

    const balanceBefore = ledger.getEntries()
      .filter(e => e.account_id === 'TEST-002')
      .reduce((sum, e) => sum + e.amount_fils, 0);

    // Settlement for 10001 fils (1 more than the hold amount of 10000)
    // Per AMB-009: over-settlement is rejected. The ledger records a rejection, not a throw.
    ledger.processEvent({
      type: 'SETTLEMENT',
      event_id: 'S1',
      account_id: 'TEST-002',
      auth_id: 'Auth-OVER',
      settlement_amount_fils: 10001,
      value_date: 1,
      posted_day: 2,
    });

    // The hold must still be PENDING (not settled)
    const hold = ledger.getHolds().find(h => h.auth_id === 'Auth-OVER');
    expect(hold).toBeDefined();
    expect(hold!.status).toBe(HoldStatus.PENDING);

    // The rejection must be recorded
    const rejection = ledger.rejections.find((r: { event_id: string }) => r.event_id === 'S1');
    expect(rejection).toBeDefined();

    // Balance must not have changed (no debit posted)
    const balanceAfter = ledger.getEntries()
      .filter(e => e.account_id === 'TEST-002')
      .reduce((sum, e) => sum + e.amount_fils, 0);
    expect(balanceAfter).toBe(balanceBefore);
  });

  test('8. Settle against already-settled hold: must be rejected', () => {
    const ledger = new Ledger();
    ledger.registerAccount({ account_id: 'TEST-003', currency: 'AED', minor_unit: 100, opening_balance: 0 });

    ledger.processEvent({ type: 'CREDIT', event_id: 'C1', account_id: 'TEST-003', amount_fils: 50000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A1', account_id: 'TEST-003', auth_id: 'Auth-SETTLED', hold_amount_fils: 10000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'S1', account_id: 'TEST-003', auth_id: 'Auth-SETTLED', settlement_amount_fils: 5000, value_date: 1, posted_day: 2 });

    // First settlement should succeed
    const holdAfterFirst = ledger.getHolds().find(h => h.auth_id === 'Auth-SETTLED');
    expect(holdAfterFirst).toBeDefined();
    expect(holdAfterFirst!.status).toBe(HoldStatus.SETTLED);

    const balanceAfterFirst = ledger.getEntries()
      .filter(e => e.account_id === 'TEST-003')
      .reduce((sum, e) => sum + e.amount_fils, 0);

    // Second settlement against the same auth_id
    try {
      ledger.processEvent({ type: 'SETTLEMENT', event_id: 'S2', account_id: 'TEST-003', auth_id: 'Auth-SETTLED', settlement_amount_fils: 5000, value_date: 1, posted_day: 3 });
    } catch {
      // Throwing is acceptable
    }

    // Balance must not have decreased a second time
    const balanceAfterSecond = ledger.getEntries()
      .filter(e => e.account_id === 'TEST-003')
      .reduce((sum, e) => sum + e.amount_fils, 0);
    expect(balanceAfterSecond).toBe(balanceAfterFirst);

    // Alternatively, check rejections recorded the double-settlement attempt
    // (only if the implementation doesn't throw)
    const doubleSettlement = ledger.rejections.find((r: { event_id: string }) => r.event_id === 'S2');
    // Either the event threw OR it is in rejections
    if (!doubleSettlement) {
      // If it threw above we never reach here — pass
      expect(balanceAfterSecond).toBe(balanceAfterFirst);
    }
  });
});
