// ============================================================
// runner.ts — Replays the event stream and prints per-day summary
//
// MONEY RULE: All monetary values are integers in minor units (fils).
// No floats for money anywhere in this file.
// ============================================================

import { Ledger } from './ledger';
import {
  Account,
  LedgerEvent,
} from './types';

// ------------------------------------------------------------------
// Account definitions
// ------------------------------------------------------------------

const ACCOUNTS: Account[] = [
  { account_id: 'ACC-001', currency: 'AED', minor_unit: 100, opening_balance: 0 },
  { account_id: 'ACC-002', currency: 'BHD', minor_unit: 1000, opening_balance: 0 },
];

// ------------------------------------------------------------------
// Event stream (10 events, processed in order)
// ------------------------------------------------------------------

const EVENTS: LedgerEvent[] = [
  // E1: posted=1, value_date=1, CREDIT, ACC-001, 120000 fils (AED 1200.00)
  {
    event_id: 'E1',
    type: 'CREDIT',
    account_id: 'ACC-001',
    posted_day: 1,
    value_date: 1,
    amount_fils: 120000,
  },

  // E2: posted=1, value_date=1, DEBIT, ACC-001, 95000 fils (AED 950.00)
  {
    event_id: 'E2',
    type: 'DEBIT',
    account_id: 'ACC-001',
    posted_day: 1,
    value_date: 1,
    amount_fils: 95000,
  },

  // E3: posted=2, value_date=2, AUTHORIZATION, ACC-001, Auth-A, 20000 fils (AED 200.00)
  {
    event_id: 'E3',
    type: 'AUTHORIZATION',
    account_id: 'ACC-001',
    posted_day: 2,
    value_date: 2,
    auth_id: 'Auth-A',
    hold_amount_fils: 20000,
  },

  // E4: posted=3, value_date=3, CREDIT, ACC-001, 40000 fils (AED 400.00)
  {
    event_id: 'E4',
    type: 'CREDIT',
    account_id: 'ACC-001',
    posted_day: 3,
    value_date: 3,
    amount_fils: 40000,
  },

  // E5: posted=4, value_date=4, SETTLEMENT, ACC-001, Auth-A, 18500 fils (AED 185.00)
  {
    event_id: 'E5',
    type: 'SETTLEMENT',
    account_id: 'ACC-001',
    posted_day: 4,
    value_date: 4,
    auth_id: 'Auth-A',
    settlement_amount_fils: 18500,
  },

  // E6: posted=4, value_date=4, SETTLEMENT, ACC-001, Auth-Z, 18000 fils [expected: REJECTED]
  {
    event_id: 'E6',
    type: 'SETTLEMENT',
    account_id: 'ACC-001',
    posted_day: 4,
    value_date: 4,
    auth_id: 'Auth-Z',
    settlement_amount_fils: 18000,
  },

  // E7: posted=5, value_date=2, DEBIT, ACC-001, 62000 fils (AED 620.00)
  {
    event_id: 'E7',
    type: 'DEBIT',
    account_id: 'ACC-001',
    posted_day: 5,
    value_date: 2,
    amount_fils: 62000,
  },

  // E8: posted=5, value_date=5, AUTHORIZATION, ACC-001, Auth-B, 9000 fils [expected: DECLINED]
  {
    event_id: 'E8',
    type: 'AUTHORIZATION',
    account_id: 'ACC-001',
    posted_day: 5,
    value_date: 5,
    auth_id: 'Auth-B',
    hold_amount_fils: 9000,
  },

  // E9: posted=6, value_date=2, REVERSAL, ACC-001, reverses E7
  {
    event_id: 'E9',
    type: 'REVERSAL',
    account_id: 'ACC-001',
    posted_day: 6,
    value_date: 2,
    reverses_event_id: 'E7',
  },

  // E10: posted=5, value_date=5, CREDIT, ACC-002, 10000 fils (BHD 10.000) in 3 instalments
  // Note: appears after E9 in the stream — process in stream order
  {
    event_id: 'E10',
    type: 'INSTALMENT_CREDIT',
    account_id: 'ACC-002',
    posted_day: 5,
    value_date: 5,
    total_amount_fils: 10000,
    instalments: 3,
  },
];

// ------------------------------------------------------------------
// Formatting helpers (integer arithmetic only)
// ------------------------------------------------------------------

/**
 * Format integer fils as currency string using integer arithmetic.
 * AED: minor_unit=100 → 2 decimal places
 * BHD: minor_unit=1000 → 3 decimal places
 */
function formatAmount(fils: number, currency: 'AED' | 'BHD', minor_unit: number): string {
  // Determine decimal places from minor_unit (100→2, 1000→3)
  const decimals = minor_unit === 1000 ? 3 : 2;

  // Integer parts — no floats
  const absFilsRaw = fils < 0 ? -fils : fils;
  const wholePart = Math.floor(absFilsRaw / minor_unit);
  const fracPart = absFilsRaw - wholePart * minor_unit; // integer remainder, no %

  const sign = fils < 0 ? '-' : '';
  const fracStr = String(fracPart).padStart(decimals, '0');

  return `${currency} ${sign}${wholePart}.${fracStr}`;
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

function main(): void {
  const ledger = new Ledger();

  // Register accounts
  for (const acc of ACCOUNTS) {
    ledger.registerAccount(acc);
  }

  // Replay events in stream order
  for (const event of EVENTS) {
    ledger.processEvent(event);
  }

  // Capitalise interest for each account at end of Day 6
  for (const acc of ACCOUNTS) {
    ledger.capitaliseInterest(acc.account_id, 6);
  }

  // ------------------------------------------------------------------
  // Per-day summary
  // ------------------------------------------------------------------

  for (let day = 1; day <= 6; day++) {
    console.log(`\n=== Day ${day} ===`);

    for (const acc of ACCOUNTS) {
      const ledgerBal = ledger.ledgerBalance(acc.account_id, day);
      const availBal = ledger.availableBalance(acc.account_id, day);

      console.log(
        `${acc.account_id} ledger balance: ${formatAmount(ledgerBal, acc.currency, acc.minor_unit)}` +
          `  (all entries value_date <= ${day})`,
      );
      console.log(
        `${acc.account_id} available balance: ${formatAmount(availBal, acc.currency, acc.minor_unit)}` +
          `  (ledger - active holds)`,
      );
    }

    // Fees assessed today (value_date = day) for all accounts
    const allFees: string[] = [];
    for (const acc of ACCOUNTS) {
      const fees = ledger.feesOnDay(acc.account_id, day);
      for (const f of fees) {
        const absAmount = -f.amount_fils; // fees are negative; display as positive cost
        allFees.push(
          `${acc.account_id} OVERDRAFT_FEE ${formatAmount(-absAmount, acc.currency, acc.minor_unit)} (source: ${f.source_event})`,
        );
      }
    }
    console.log(`Fees assessed today (value_date=${day}): ${allFees.length > 0 ? allFees.join('; ') : 'none'}`);

    // Active holds (PENDING) as of this day
    const activeHolds: string[] = [];
    for (const acc of ACCOUNTS) {
      const holds = ledger.activeHoldsForAccount(acc.account_id);
      for (const h of holds) {
        activeHolds.push(
          `${h.auth_id} on ${acc.account_id} ${formatAmount(h.hold_amount_fils, acc.currency, acc.minor_unit)} [${h.status}]`,
        );
      }
    }
    console.log(`Active holds: ${activeHolds.length > 0 ? activeHolds.join('; ') : 'none'}`);

    // Authorization outcomes on this day
    const outcomes = ledger.authOutcomesOnDay(day);
    const outcomeStrs = outcomes.map((o) => {
      const acc = ACCOUNTS.find((a) => a.account_id === o.account_id)!;
      return `${o.auth_id} ${o.status} ${formatAmount(o.hold_amount_fils, acc.currency, acc.minor_unit)}`;
    });
    console.log(`Authorization outcomes: ${outcomeStrs.length > 0 ? outcomeStrs.join('; ') : 'none'}`);

    // Errors/rejections on this day
    const rejs = ledger.rejectionsOnDay(day);
    const rejStrs = rejs.map((r) => `[${r.event_id}] ${r.reason}`);
    console.log(`Errors/rejections: ${rejStrs.length > 0 ? rejStrs.join('; ') : 'none'}`);
  }

  // ------------------------------------------------------------------
  // Full ledger dump (for verification)
  // ------------------------------------------------------------------

  console.log('\n=== Full Ledger Entries ===');
  const header = ['entry_id', 'account_id', 'amount_fils', 'value_date', 'entry_type', 'source_event', 'posted_day'];
  console.log(header.join('\t'));
  for (const e of ledger.getEntries()) {
    console.log(
      [e.entry_id, e.account_id, e.amount_fils, e.value_date, e.entry_type, e.source_event, e.posted_day].join('\t'),
    );
  }

  console.log('\n=== Hold History ===');
  for (const h of ledger.getHolds()) {
    console.log(`${h.auth_id}\t${h.account_id}\t${h.hold_amount_fils}\t${h.status}\tv_date=${h.value_date}`);
  }
}

main();
