/**
 * supplementary/realStream.ts
 *
 * NOT part of the graded deliverable. See supplementary/README.md.
 *
 * A local copy of the E1-E10 replay helper. Deliberately duplicated rather than
 * imported from tests/, so that nothing in supplementary/ is coupled to the
 * graded suite — the required 38 tests must stand alone and remain exactly what
 * `npm test` runs.
 */

import { Ledger } from '../src/ledger';

export function makeLedger(): Ledger {
  const ledger = new Ledger();
  ledger.registerAccount({
    account_id: 'ACC-001',
    currency: 'AED',
    minor_unit: 100,
    opening_balance: 0,
  });
  ledger.registerAccount({
    account_id: 'ACC-002',
    currency: 'BHD',
    minor_unit: 1000,
    opening_balance: 0,
  });
  return ledger;
}

/** Replays the real E1-E10 stream, then capitalises interest at end of Day 6. */
export function replayRealStream(ledger: Ledger): void {
  ledger.processEvent({ type: 'CREDIT', event_id: 'E1', account_id: 'ACC-001', amount_fils: 120000, value_date: 1, posted_day: 1 });
  ledger.processEvent({ type: 'DEBIT', event_id: 'E2', account_id: 'ACC-001', amount_fils: 95000, value_date: 1, posted_day: 1 });
  ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E3', account_id: 'ACC-001', auth_id: 'Auth-A', hold_amount_fils: 20000, value_date: 2, posted_day: 2 });
  ledger.processEvent({ type: 'CREDIT', event_id: 'E4', account_id: 'ACC-001', amount_fils: 40000, value_date: 3, posted_day: 3 });
  ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E5', account_id: 'ACC-001', auth_id: 'Auth-A', settlement_amount_fils: 18500, value_date: 4, posted_day: 4 });
  ledger.processEvent({ type: 'SETTLEMENT', event_id: 'E6', account_id: 'ACC-001', auth_id: 'Auth-Z', settlement_amount_fils: 18000, value_date: 4, posted_day: 4 });
  ledger.processEvent({ type: 'DEBIT', event_id: 'E7', account_id: 'ACC-001', amount_fils: 62000, value_date: 2, posted_day: 5 });
  ledger.processEvent({ type: 'AUTHORIZATION', event_id: 'E8', account_id: 'ACC-001', auth_id: 'Auth-B', hold_amount_fils: 9000, value_date: 5, posted_day: 5 });
  ledger.processEvent({ type: 'REVERSAL', event_id: 'E9', account_id: 'ACC-001', reverses_event_id: 'E7', value_date: 2, posted_day: 6 });
  ledger.processEvent({ type: 'INSTALMENT_CREDIT', event_id: 'E10', account_id: 'ACC-002', total_amount_fils: 10000, instalments: 3, value_date: 5, posted_day: 5 });

  ledger.capitaliseInterest('ACC-001', 6);
  ledger.capitaliseInterest('ACC-002', 6);
}

export const ACCOUNTS = ['ACC-001', 'ACC-002'] as const;
export const WINDOW_DAYS = 6;
