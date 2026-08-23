// tests/adversarial.test.ts — Hardest edge cases + intentional failure

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

describe('Adversarial edge cases', () => {
  test('1. Auth approved at exactly available=0: credit 9000, authorize 9000 → PENDING (available becomes 0)', () => {
    const ledger = new Ledger();
    ledger.registerAccount({ account_id: 'ADV-001', currency: 'AED', minor_unit: 100, opening_balance: 0 });

    ledger.processEvent({ type: 'CREDIT', event_id: 'C1', account_id: 'ADV-001', amount_fils: 9000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A1', account_id: 'ADV-001', auth_id: 'Auth-ZERO', hold_amount_fils: 9000, value_date: 1, posted_day: 1 });

    const hold = ledger.getHolds().find(h => h.auth_id === 'Auth-ZERO');
    expect(hold).toBeDefined();
    // Available after hold = 9000 - 9000 = 0 >= 0 → must be APPROVED (PENDING)
    expect(hold!.status).toBe(HoldStatus.PENDING);

    // Verify available balance is now 0
    const ledgerBal = ledger.getEntries()
      .filter(e => e.account_id === 'ADV-001' && e.value_date <= 1)
      .reduce((sum, e) => sum + e.amount_fils, 0);
    const activePendingHolds = ledger.getHolds()
      .filter(h => h.account_id === 'ADV-001' && h.status === HoldStatus.PENDING)
      .reduce((sum, h) => sum + h.hold_amount_fils, 0);
    expect(ledgerBal - activePendingHolds).toBe(0);
  });

  test('2. Auth declined when would go to -1: credit 9000, authorize 9001 → DECLINED', () => {
    const ledger = new Ledger();
    ledger.registerAccount({ account_id: 'ADV-002', currency: 'AED', minor_unit: 100, opening_balance: 0 });

    ledger.processEvent({ type: 'CREDIT', event_id: 'C1', account_id: 'ADV-002', amount_fils: 9000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A1', account_id: 'ADV-002', auth_id: 'Auth-NEG', hold_amount_fils: 9001, value_date: 1, posted_day: 1 });

    // DECLINED auths do not enter the holds Map; they are recorded in authOutcomes only.
    const outcome = ledger.authOutcomes.find(o => o.auth_id === 'Auth-NEG');
    expect(outcome).toBeDefined();
    // Available after hold = 9000 - 9001 = -1 < 0 → must be DECLINED
    expect(outcome!.status).toBe('DECLINED');

    // Confirm no hold was created in the holds Map
    const holdInMap = ledger.getHolds().find(h => h.auth_id === 'Auth-NEG');
    expect(holdInMap).toBeUndefined();
  });

  test('3. Multiple concurrent holds: 3 of 10000 approved on 30000 balance; 4th for 1 fil → DECLINED (available=0)', () => {
    const ledger = new Ledger();
    ledger.registerAccount({ account_id: 'ADV-003', currency: 'AED', minor_unit: 100, opening_balance: 0 });

    ledger.processEvent({ type: 'CREDIT', event_id: 'C1', account_id: 'ADV-003', amount_fils: 30000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A1', account_id: 'ADV-003', auth_id: 'Auth-X', hold_amount_fils: 10000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A2', account_id: 'ADV-003', auth_id: 'Auth-Y', hold_amount_fils: 10000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A3', account_id: 'ADV-003', auth_id: 'Auth-Z', hold_amount_fils: 10000, value_date: 1, posted_day: 1 });

    const holdX = ledger.getHolds().find(h => h.auth_id === 'Auth-X');
    const holdY = ledger.getHolds().find(h => h.auth_id === 'Auth-Y');
    const holdZ = ledger.getHolds().find(h => h.auth_id === 'Auth-Z');

    expect(holdX!.status).toBe(HoldStatus.PENDING);
    expect(holdY!.status).toBe(HoldStatus.PENDING);
    expect(holdZ!.status).toBe(HoldStatus.PENDING);

    // 4th attempt for just 1 fil — available = 0, would go to -1 → DECLINED
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A4', account_id: 'ADV-003', auth_id: 'Auth-W', hold_amount_fils: 1, value_date: 1, posted_day: 1 });
    // DECLINED auths are in authOutcomes, not in holds Map
    const outcomeW = ledger.authOutcomes.find(o => o.auth_id === 'Auth-W');
    expect(outcomeW).toBeDefined();
    expect(outcomeW!.status).toBe('DECLINED');

    // Confirm Auth-W does not appear as a PENDING hold
    const holdWInMap = ledger.getHolds().find(h => h.auth_id === 'Auth-W');
    expect(holdWInMap).toBeUndefined();
  });

  test('4. Settlement releases hold from available: after settling Auth-X, Auth-W for 1 fil passes', () => {
    const ledger = new Ledger();
    ledger.registerAccount({ account_id: 'ADV-004', currency: 'AED', minor_unit: 100, opening_balance: 0 });

    ledger.processEvent({ type: 'CREDIT', event_id: 'C1', account_id: 'ADV-004', amount_fils: 30000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A1', account_id: 'ADV-004', auth_id: 'Auth-X', hold_amount_fils: 10000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A2', account_id: 'ADV-004', auth_id: 'Auth-Y', hold_amount_fils: 10000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A3', account_id: 'ADV-004', auth_id: 'Auth-Z-ADV', hold_amount_fils: 10000, value_date: 1, posted_day: 1 });

    // Settle Auth-X: posts -10000 debit, removes 10000 from active holds
    // Net effect on available: -10000 (ledger balance falls) + 10000 (hold released) = 0 net
    // So available = ledger_bal - active_holds = (30000-10000) - (10000+10000) = 20000-20000 = 0
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'S1', account_id: 'ADV-004', auth_id: 'Auth-X', settlement_amount_fils: 10000, value_date: 1, posted_day: 2 });

    // Now available = 0 — Auth-W for 1 should be DECLINED
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A4', account_id: 'ADV-004', auth_id: 'Auth-W', hold_amount_fils: 1, value_date: 1, posted_day: 2 });
    // After settlement of Auth-X: ledger_bal = 20000, active_holds = 20000, available = 0
    // Holding 1 fil would make available = -1 < 0 → DECLINED
    // DECLINED auths are in authOutcomes, not in holds Map
    const outcomeW = ledger.authOutcomes.find(o => o.auth_id === 'Auth-W');
    expect(outcomeW).toBeDefined();

    // Now settle Auth-Y too: ledger_bal = 10000, active_holds = 10000, available = 0
    // But we first test that settling X alone allows W through when settled below active holds
    // The real test: settle X for 5000 (partial), so ledger_bal = 25000, active_holds = 20000, available = 5000
    const ledger2 = new Ledger();
    ledger2.registerAccount({ account_id: 'ADV-004B', currency: 'AED', minor_unit: 100, opening_balance: 0 });

    ledger2.processEvent({ type: 'CREDIT', event_id: 'C1', account_id: 'ADV-004B', amount_fils: 30000, value_date: 1, posted_day: 1 });
    ledger2.processEvent({ type: 'AUTHORIZATION', event_id: 'A1', account_id: 'ADV-004B', auth_id: 'Auth-X2', hold_amount_fils: 10000, value_date: 1, posted_day: 1 });
    ledger2.processEvent({ type: 'AUTHORIZATION', event_id: 'A2', account_id: 'ADV-004B', auth_id: 'Auth-Y2', hold_amount_fils: 10000, value_date: 1, posted_day: 1 });
    ledger2.processEvent({ type: 'AUTHORIZATION', event_id: 'A3', account_id: 'ADV-004B', auth_id: 'Auth-Z2', hold_amount_fils: 10000, value_date: 1, posted_day: 1 });

    // Settle Auth-X2 for 5000 (not full hold amount)
    // ledger_bal goes from 30000 to 25000, active holds go from 30000 to 20000
    // available = 25000 - 20000 = 5000 → Auth-W2 for 1 fil should PASS
    ledger2.processEvent({ type: 'SETTLEMENT', event_id: 'S1', account_id: 'ADV-004B', auth_id: 'Auth-X2', settlement_amount_fils: 5000, value_date: 1, posted_day: 2 });
    ledger2.processEvent({ type: 'AUTHORIZATION', event_id: 'A4', account_id: 'ADV-004B', auth_id: 'Auth-W2', hold_amount_fils: 1, value_date: 1, posted_day: 2 });
    const holdW2 = ledger2.getHolds().find(h => h.auth_id === 'Auth-W2');
    expect(holdW2).toBeDefined();
    expect(holdW2!.status).toBe(HoldStatus.PENDING);
  });

  test('5. Cancelled/expired holds do not count toward active holds (note on design)', () => {
    // Per DESIGN.md §7, holds can be in states: PENDING, SETTLED, CANCELLED, EXPIRED, DECLINED.
    // Only PENDING holds count toward active holds (per DESIGN.md §2 and §7).
    // The spec event stream does not include explicit CANCEL or EXPIRE events,
    // and the Ledger may not expose a cancelHold method.
    // This test verifies that only PENDING status holds reduce available balance.
    const ledger = new Ledger();
    ledger.registerAccount({ account_id: 'ADV-005', currency: 'AED', minor_unit: 100, opening_balance: 0 });

    ledger.processEvent({ type: 'CREDIT', event_id: 'C1', account_id: 'ADV-005', amount_fils: 10000, value_date: 1, posted_day: 1 });
    ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'A1', account_id: 'ADV-005', auth_id: 'Auth-PEND', hold_amount_fils: 5000, value_date: 1, posted_day: 1 });

    // After AUTHORIZATION: available = 10000 - 5000 = 5000 (hold PENDING)
    const pendingHolds = ledger.getHolds()
      .filter(h => h.account_id === 'ADV-005' && h.status === HoldStatus.PENDING)
      .reduce((sum, h) => sum + h.hold_amount_fils, 0);
    const ledgerBal = ledger.getEntries()
      .filter(e => e.account_id === 'ADV-005')
      .reduce((sum, e) => sum + e.amount_fils, 0);

    expect(pendingHolds).toBe(5000);
    expect(ledgerBal - pendingHolds).toBe(5000);

    // After settling, hold is no longer PENDING → does not count
    ledger.processEvent({ type: 'SETTLEMENT', event_id: 'S1', account_id: 'ADV-005', auth_id: 'Auth-PEND', settlement_amount_fils: 3000, value_date: 1, posted_day: 2 });

    const pendingHoldsAfter = ledger.getHolds()
      .filter(h => h.account_id === 'ADV-005' && h.status === HoldStatus.PENDING)
      .reduce((sum, h) => sum + h.hold_amount_fils, 0);
    expect(pendingHoldsAfter).toBe(0);

    const ledgerBalAfter = ledger.getEntries()
      .filter(e => e.account_id === 'ADV-005')
      .reduce((sum, e) => sum + e.amount_fils, 0);
    // available = ledger_bal (7000) - 0 active holds = 7000
    expect(ledgerBalAfter - pendingHoldsAfter).toBe(7000);
  });

  test('6. Full event stream E1-E10 + interest: ACC-001 Day 6 = 39090 fils; ACC-002 Day 6 = 10008 fils', () => {
    const ledger = makeLedger();
    replayAllEvents(ledger);

    const entries = ledger.getEntries();

    // ACC-001 Day 6 full ledger balance (includes interest cap at value_date 6)
    const acc001Day6 = entries
      .filter(e => e.account_id === 'ACC-001' && e.value_date <= 6)
      .reduce((sum, e) => sum + e.amount_fils, 0);

    // After E9: 39000 fils + interest cap of 10 fils = 39010 fils
    // Wait — per DESIGN.md §5: Day 1 balance = 25000 fils → accrual = floor(25000*4/10000) = 10 fils
    // Days 2-6 after E7/E9/fees: all negative days had 0 accrual, Day 5 and 6 are positive again
    // After E9 reversal:
    //   Day 1: 25000 → accrual = 10
    //   Day 2: 22500 → accrual = floor(22500*4/10000) = floor(9.0) = 9
    //   Day 3: 62500 → accrual = floor(62500*4/10000) = floor(25.0) = 25
    //   Day 4: 41500 → accrual = floor(41500*4/10000) = floor(16.6) = 16
    //   Day 5: 39000 → accrual = floor(39000*4/10000) = floor(15.6) = 15
    //   Day 6: 39000 → accrual = floor(39000*4/10000) = floor(15.6) = 15
    // Sum = 10 + 9 + 25 + 16 + 15 + 15 = 90 fils
    // ACC-001 Day 6 = 39000 + 90 = 39090 fils
    expect(acc001Day6).toBe(39090);

    // ACC-002 Day 6 full ledger balance (includes interest cap)
    const acc002Day6 = entries
      .filter(e => e.account_id === 'ACC-002' && e.value_date <= 6)
      .reduce((sum, e) => sum + e.amount_fils, 0);

    // ACC-002: E10 = 10000 fils, interest cap = 8 fils (4 + 4)
    expect(acc002Day6).toBe(10008);
  });

  test('7. E6 rejection: rejections contain Auth-Z reference; ledger balance not reduced by 18000', () => {
    const ledger = makeLedger();
    replayAllEvents(ledger);

    // Rejections must include Auth-Z or event E6
    const authZRejection = ledger.rejections.find(
      (r: { event_id: string }) => r.event_id === 'E6'
    );
    expect(authZRejection).toBeDefined();

    // Ledger balance for ACC-001 must NOT reflect a -18000 debit from Auth-Z
    // (The settlement for Auth-Z should not have posted.)
    // All settlement entries that were posted should reference Auth-A (E5 only)
    const settlementEntries = ledger.getEntries().filter(
      e => e.account_id === 'ACC-001' && e.entry_type === EntryType.SETTLEMENT
    );

    // Only one valid settlement: E5 for Auth-A (-18500)
    expect(settlementEntries).toHaveLength(1);
    expect(settlementEntries[0].amount_fils).toBe(-18500);

    // No entry of -18000 exists
    const rejectedEntry = ledger.getEntries().find(
      e => e.account_id === 'ACC-001' && e.amount_fils === -18000
    );
    expect(rejectedEntry).toBeUndefined();
  });

  // =========================================================================
  // INTENTIONAL_FAILURE: This test exposes a real arithmetic limitation in the
  // fee accrual algorithm: daily accruals computed via floor division, then
  // summed, produce a lower total than would be obtained by round-half-up.
  //
  // For ACC-001 after all events (post-reversal balances):
  //   Day 1: 25000 fils × 0.0004 = 10.0 fils → floor = 10
  //   Day 2: 22500 fils × 0.0004 = 9.0 fils → floor = 9
  //   Day 3: 62500 fils × 0.0004 = 25.0 fils → floor = 25
  //   Day 4: 41500 fils × 0.0004 = 16.6 fils → floor = 16
  //   Day 5: 39000 fils × 0.0004 = 15.6 fils → floor = 15
  //   Day 6: 39000 fils × 0.0004 = 15.6 fils → floor = 15
  //
  // Sum of floors: 10 + 9 + 25 + 16 + 15 + 15 = 90 fils (what the design produces)
  //
  // "Economically exact" total using round-half-up for each day would be:
  //   10 + 9 + 25 + 17 + 16 + 16 = 93 fils
  //   (16.6 rounds up to 17, 15.6 rounds up to 16)
  //
  // Or, using banker's rounding (round-half-even) for each day:
  //   10 + 9 + 25 + 17 + 16 + 16 = 93 fils
  //
  // The design explicitly uses floor division and the reconciliation step sums
  // the floors (DESIGN.md §5). The capitalized total IS 90 fils. The test
  // below asserts 93 fils (round-half-up expectation), which FAILS because the
  // implementation produces 90 fils. That failure documents that the floor-sum
  // approach undercharges vs. round-half-up, and that correcting it would
  // require a change to DESIGN.md §5.
  //
  // What a proper fix would require: use round-half-up (or banker's rounding)
  // for each daily accrual and reconcile the residual explicitly into the last
  // positive-balance day's accrual to guarantee the exact sum invariant.
  //
  // NOTE: this is deliberately a plain `test(...)`, so it reports as a genuine
  // failure in the suite output (37 passed, 1 failed). It was previously
  // `test.failing(...)`, which inverts the result and made Jest count it as a
  // PASS — hiding the very limitation it exists to surface, and leaving the
  // suite showing 38/38 green with no failing test visible anywhere.
  // =========================================================================
  test('INTENTIONAL: interest accrual uses floor division — floor-sum (90) differs from round-half-up total (93)', () => {
    const ledger = makeLedger();
    replayAllEvents(ledger);

    const entries = ledger.getEntries();
    const interestEntry = entries.find(
      e => e.account_id === 'ACC-001' && e.entry_type === EntryType.INTEREST_CAPITALISATION
    );
    expect(interestEntry).toBeDefined();

    // This assertion FAILS: the implementation produces 90, not 93.
    // It reveals that floor-division daily accrual undercharges by 3 fils
    // compared to round-half-up per-day accrual on ACC-001 in this event stream.
    // Days 4, 5, 6 all have fractional accruals (16.6, 15.6, 15.6) that floor
    // truncates, whereas round-half-up would produce 17, 16, 16.
    // The capitalized total should be 93 fils under round-half-up semantics,
    // but the design chose floor-sum = 90 fils.
    expect(interestEntry!.amount_fils).toBe(93);
  });
});
