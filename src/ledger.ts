// ============================================================
// ledger.ts — In-memory account ledger
//
// MONEY RULE: All monetary values are integers in minor units.
// NO floats for money — not even as intermediates.
// Integer floor-divisions: Math.floor(a / b) for all money divisions.
// ============================================================

import {
  Account,
  AuthorizationHold,
  AuthOutcome,
  EntryType,
  HoldStatus,
  LedgerEntry,
  LedgerEvent,
  RejectionRecord,
} from './types';

let _entryCounter = 0;
function nextEntryId(): string {
  _entryCounter += 1;
  return `entry-${String(_entryCounter).padStart(4, '0')}`;
}

export class Ledger {
  private readonly accounts: Map<string, Account> = new Map();

  /** Append-only ledger. Never mutate or delete. */
  private readonly entries: LedgerEntry[] = [];

  /** Authorization holds, keyed by auth_id */
  private readonly holds: Map<string, AuthorizationHold> = new Map();

  /** Authorization outcomes recorded (for reporting) */
  readonly authOutcomes: AuthOutcome[] = [];

  /** Rejection records (for reporting) */
  readonly rejections: RejectionRecord[] = [];

  /**
   * Map from event_id -> entry_id so REVERSAL can look up the original entry.
   * Only the first ledger entry produced by an event is tracked here.
   */
  private readonly eventToEntryId: Map<string, string> = new Map();

  // ------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------

  registerAccount(account: Account): void {
    this.accounts.set(account.account_id, account);
  }

  // ------------------------------------------------------------------
  // Core balance queries
  // ------------------------------------------------------------------

  /**
   * Returns the sum of amount_fils for all entries on account_id with
   * value_date <= as_of_day. Opening balance is 0 per spec.
   * Result is an integer.
   */
  ledgerBalance(account_id: string, as_of_day: number): number {
    let total = 0;
    for (const e of this.entries) {
      if (e.account_id === account_id && e.value_date <= as_of_day) {
        total += e.amount_fils;
      }
    }
    return total;
  }

  /**
   * Sum of hold_amount_fils for all PENDING holds on account_id.
   */
  private pendingHoldsTotal(account_id: string): number {
    let total = 0;
    for (const h of this.holds.values()) {
      if (h.account_id === account_id && h.status === HoldStatus.PENDING) {
        total += h.hold_amount_fils;
      }
    }
    return total;
  }

  /**
   * available_balance = ledger_balance(posted_day) - sum(PENDING holds)
   * Uses posted_day for ledger balance per the spec's Decision 6.
   */
  availableBalance(account_id: string, as_of_day: number): number {
    return this.ledgerBalance(account_id, as_of_day) - this.pendingHoldsTotal(account_id);
  }

  // ------------------------------------------------------------------
  // Append helper
  // ------------------------------------------------------------------

  private appendEntry(entry: Omit<LedgerEntry, 'entry_id'>): LedgerEntry {
    const e: LedgerEntry = { entry_id: nextEntryId(), ...entry };
    this.entries.push(e);
    return e;
  }

  // ------------------------------------------------------------------
  // Fee re-assessment (CRITICAL)
  //
  // For D = start_day..end_day (ascending):
  //   balance = sum(amount_fils where account_id=A and value_date <= D)
  //   if balance < 0 AND no OVERDRAFT_FEE for account A on day D:
  //     append OVERDRAFT_FEE: amount_fils=-2500, value_date=D
  // The newly appended fee is included in subsequent iterations.
  // ------------------------------------------------------------------

  private reassessFeesFrom(account_id: string, start_day: number, end_day: number): void {
    for (let D = start_day; D <= end_day; D++) {
      const balance = this.ledgerBalance(account_id, D);
      const alreadyHasFee = this.entries.some(
        (e) =>
          e.account_id === account_id &&
          e.entry_type === EntryType.OVERDRAFT_FEE &&
          e.value_date === D,
      );
      if (balance < 0 && !alreadyHasFee) {
        this.appendEntry({
          account_id,
          amount_fils: -2500, // AED 25.00 in fils — integer
          value_date: D,
          entry_type: EntryType.OVERDRAFT_FEE,
          source_event: `FEE-D${D}`,
          posted_day: D,
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // Event processing
  // ------------------------------------------------------------------

  processEvent(event: LedgerEvent): void {
    switch (event.type) {
      case 'CREDIT':
        this.handleCredit(event);
        break;
      case 'DEBIT':
        this.handleDebit(event);
        break;
      case 'AUTHORIZATION':
        this.handleAuthorization(event);
        break;
      case 'SETTLEMENT':
        this.handleSettlement(event);
        break;
      case 'REVERSAL':
        this.handleReversal(event);
        break;
      case 'INSTALMENT_CREDIT':
        this.handleInstalmentCredit(event);
        break;
      default:
        // Exhaustiveness guard
        throw new Error(`Unknown event type: ${(event as LedgerEvent).type}`);
    }
  }

  // ---- CREDIT ----

  private handleCredit(event: { event_id: string; account_id: string; amount_fils: number; value_date: number; posted_day: number }): void {
    const entry = this.appendEntry({
      account_id: event.account_id,
      amount_fils: event.amount_fils,
      value_date: event.value_date,
      entry_type: EntryType.CREDIT,
      source_event: event.event_id,
      posted_day: event.posted_day,
    });
    this.eventToEntryId.set(event.event_id, entry.entry_id);
    this.reassessFeesFrom(event.account_id, event.value_date, event.posted_day);
  }

  // ---- DEBIT ----

  private handleDebit(event: { event_id: string; account_id: string; amount_fils: number; value_date: number; posted_day: number }): void {
    // amount_fils for debit is stored as negative
    const entry = this.appendEntry({
      account_id: event.account_id,
      amount_fils: -event.amount_fils,
      value_date: event.value_date,
      entry_type: EntryType.DEBIT,
      source_event: event.event_id,
      posted_day: event.posted_day,
    });
    this.eventToEntryId.set(event.event_id, entry.entry_id);
    this.reassessFeesFrom(event.account_id, event.value_date, event.posted_day);
  }

  // ---- AUTHORIZATION ----

  private handleAuthorization(event: { event_id: string; account_id: string; hold_amount_fils: number; value_date: number; posted_day: number; auth_id: string }): void {
    const available = this.availableBalance(event.account_id, event.posted_day);
    if (available - event.hold_amount_fils >= 0) {
      const hold: AuthorizationHold = {
        auth_id: event.auth_id,
        account_id: event.account_id,
        hold_amount_fils: event.hold_amount_fils,
        status: HoldStatus.PENDING,
        value_date: event.value_date,
        posted_day: event.posted_day,
      };
      this.holds.set(event.auth_id, hold);
      this.authOutcomes.push({
        auth_id: event.auth_id,
        account_id: event.account_id,
        posted_day: event.posted_day,
        status: 'PENDING',
        hold_amount_fils: event.hold_amount_fils,
      });
    } else {
      // DECLINED — record outcome, do not create a hold
      this.authOutcomes.push({
        auth_id: event.auth_id,
        account_id: event.account_id,
        posted_day: event.posted_day,
        status: 'DECLINED',
        hold_amount_fils: event.hold_amount_fils,
      });
    }
  }

  // ---- SETTLEMENT ----

  private handleSettlement(event: { event_id: string; account_id: string; auth_id: string; settlement_amount_fils: number; value_date: number; posted_day: number }): void {
    const hold = this.holds.get(event.auth_id);

    if (!hold || hold.status !== HoldStatus.PENDING) {
      this.rejections.push({
        event_id: event.event_id,
        account_id: event.account_id,
        posted_day: event.posted_day,
        reason: `Settlement rejected: auth_id ${event.auth_id} not found or not PENDING`,
      });
      return;
    }

    if (event.settlement_amount_fils > hold.hold_amount_fils) {
      this.rejections.push({
        event_id: event.event_id,
        account_id: event.account_id,
        posted_day: event.posted_day,
        reason: `AMB-009: Settlement amount ${event.settlement_amount_fils} exceeds hold amount ${hold.hold_amount_fils}`,
      });
      return;
    }

    // Post debit of settlement_amount to the ledger
    const entry = this.appendEntry({
      account_id: event.account_id,
      amount_fils: -event.settlement_amount_fils,
      value_date: event.value_date,
      entry_type: EntryType.SETTLEMENT,
      source_event: event.event_id,
      posted_day: event.posted_day,
    });
    this.eventToEntryId.set(event.event_id, entry.entry_id);

    // Transition hold to SETTLED
    hold.status = HoldStatus.SETTLED;

    this.reassessFeesFrom(event.account_id, event.value_date, event.posted_day);
  }

  // ---- REVERSAL ----

  private handleReversal(event: { event_id: string; account_id: string; reverses_event_id: string; value_date: number; posted_day: number }): void {
    // Find the original entry by source_event
    const originalEntry = this.entries.find(
      (e) => e.source_event === event.reverses_event_id && e.account_id === event.account_id,
    );

    if (!originalEntry) {
      this.rejections.push({
        event_id: event.event_id,
        account_id: event.account_id,
        posted_day: event.posted_day,
        reason: `Reversal rejected: source event ${event.reverses_event_id} not found`,
      });
      return;
    }

    // Append reversal entry: opposite sign, same value_date as original
    const entry = this.appendEntry({
      account_id: event.account_id,
      amount_fils: -originalEntry.amount_fils,
      value_date: originalEntry.value_date,
      entry_type: EntryType.REVERSAL,
      source_event: `reversal of ${event.reverses_event_id}`,
      posted_day: event.posted_day,
    });
    this.eventToEntryId.set(event.event_id, entry.entry_id);

    this.reassessFeesFrom(event.account_id, originalEntry.value_date, event.posted_day);
  }

  // ---- INSTALMENT CREDIT ----

  private handleInstalmentCredit(event: { event_id: string; account_id: string; total_amount_fils: number; instalments: number; value_date: number; posted_day: number }): void {
    const n = event.instalments;
    const total = event.total_amount_fils;

    // Integer floor division per spec
    const base = Math.floor(total / n);
    // remainder = total % n (also integer)
    const remainder = total - base * n; // equivalent to total % n, avoids any float

    for (let i = 1; i <= n; i++) {
      // Last instalment absorbs the remainder
      const amount = i < n ? base : base + remainder;
      const entry = this.appendEntry({
        account_id: event.account_id,
        amount_fils: amount,
        value_date: event.value_date,
        entry_type: EntryType.CREDIT,
        source_event: `${event.event_id}-inst${i}`,
        posted_day: event.posted_day,
      });
      if (i === 1) {
        this.eventToEntryId.set(event.event_id, entry.entry_id);
      }
    }

    this.reassessFeesFrom(event.account_id, event.value_date, event.posted_day);
  }

  // ------------------------------------------------------------------
  // Interest Capitalisation (called at end of day 6)
  //
  // For each day D = 1..6:
  //   balance_d = ledgerBalance(account, D)
  //   if balance_d > 0: accrual[D] = Math.floor(balance_d * 4 / 10000)
  //   else: accrual[D] = 0
  // total = sum(accrual[1..6])
  // Append INTEREST_CAPITALISATION entry: amount_fils=total, value_date=6
  // ------------------------------------------------------------------

  capitaliseInterest(account_id: string, end_day: number): void {
    let total = 0;

    for (let D = 1; D <= end_day; D++) {
      const balance = this.ledgerBalance(account_id, D);
      if (balance > 0) {
        // 0.04% per day = 4/10000; integer floor division — NO floats
        const accrual = Math.floor((balance * 4) / 10000);
        total += accrual;
      }
    }

    if (total > 0) {
      this.appendEntry({
        account_id,
        amount_fils: total,
        value_date: end_day,
        entry_type: EntryType.INTEREST_CAPITALISATION,
        source_event: `INTEREST-D${end_day}`,
        posted_day: end_day,
      });
    }
  }

  // ------------------------------------------------------------------
  // Reporting helpers
  // ------------------------------------------------------------------

  getEntries(): readonly LedgerEntry[] {
    return this.entries;
  }

  getHolds(): readonly AuthorizationHold[] {
    return Array.from(this.holds.values());
  }

  /**
   * Fees assessed for account_id with value_date = day.
   */
  feesOnDay(account_id: string, day: number): LedgerEntry[] {
    return this.entries.filter(
      (e) =>
        e.account_id === account_id &&
        e.entry_type === EntryType.OVERDRAFT_FEE &&
        e.value_date === day,
    );
  }

  /**
   * Active (PENDING) holds for account_id.
   */
  activeHoldsForAccount(account_id: string): AuthorizationHold[] {
    return Array.from(this.holds.values()).filter(
      (h) => h.account_id === account_id && h.status === HoldStatus.PENDING,
    );
  }

  /**
   * Authorization outcomes recorded on a given day (by posted_day).
   */
  authOutcomesOnDay(day: number): AuthOutcome[] {
    return this.authOutcomes.filter((o) => o.posted_day === day);
  }

  /**
   * Rejections recorded on a given day (by posted_day).
   */
  rejectionsOnDay(day: number): RejectionRecord[] {
    return this.rejections.filter((r) => r.posted_day === day);
  }

  getAccount(account_id: string): Account | undefined {
    return this.accounts.get(account_id);
  }
}
