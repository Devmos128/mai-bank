// ============================================================
// types.ts — Domain types for the in-memory account ledger
// All monetary values are integers in minor units (fils).
// NEVER use a float for a monetary amount.
// ============================================================

export type Currency = 'AED' | 'BHD';

export interface Account {
  account_id: string;
  currency: Currency;
  /** AED = 100, BHD = 1000 */
  minor_unit: number;
  /** Integer fils */
  opening_balance: number;
}

export enum EntryType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
  SETTLEMENT = 'SETTLEMENT',
  REVERSAL = 'REVERSAL',
  OVERDRAFT_FEE = 'OVERDRAFT_FEE',
  INTEREST_CAPITALISATION = 'INTEREST_CAPITALISATION',
}

export interface LedgerEntry {
  entry_id: string;
  account_id: string;
  /** Positive = credit, negative = debit. ALWAYS INTEGER. */
  amount_fils: number;
  /** Day 1..6 — economically effective date */
  value_date: number;
  entry_type: EntryType;
  source_event: string;
  posted_day: number;
}

export enum HoldStatus {
  PENDING = 'PENDING',
  SETTLED = 'SETTLED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  DECLINED = 'DECLINED',
}

export interface AuthorizationHold {
  auth_id: string;
  account_id: string;
  /** ALWAYS INTEGER, fixed at authorization time */
  hold_amount_fils: number;
  status: HoldStatus;
  value_date: number;
  posted_day: number;
}

// ---- Events (input stream) ----

export type EventType =
  | 'CREDIT'
  | 'DEBIT'
  | 'AUTHORIZATION'
  | 'SETTLEMENT'
  | 'REVERSAL'
  | 'INTEREST_CAPITALISATION';

export interface BaseEvent {
  event_id: string;
  posted_day: number;
  account_id: string;
}

export interface CreditEvent extends BaseEvent {
  type: 'CREDIT';
  value_date: number;
  /** Integer fils */
  amount_fils: number;
}

export interface DebitEvent extends BaseEvent {
  type: 'DEBIT';
  value_date: number;
  /** Integer fils */
  amount_fils: number;
}

export interface AuthorizationEvent extends BaseEvent {
  type: 'AUTHORIZATION';
  value_date: number;
  auth_id: string;
  /** Integer fils */
  hold_amount_fils: number;
}

export interface SettlementEvent extends BaseEvent {
  type: 'SETTLEMENT';
  value_date: number;
  auth_id: string;
  /** Integer fils */
  settlement_amount_fils: number;
}

export interface ReversalEvent extends BaseEvent {
  type: 'REVERSAL';
  value_date: number;
  /** event_id of the entry being reversed */
  reverses_event_id: string;
}

export interface InstalmentCreditEvent extends BaseEvent {
  type: 'INSTALMENT_CREDIT';
  value_date: number;
  /** Total integer fils before splitting */
  total_amount_fils: number;
  instalments: number;
}

export type LedgerEvent =
  | CreditEvent
  | DebitEvent
  | AuthorizationEvent
  | SettlementEvent
  | ReversalEvent
  | InstalmentCreditEvent;

// ---- Outcome records (for reporting) ----

export interface AuthOutcome {
  auth_id: string;
  account_id: string;
  posted_day: number;
  status: 'PENDING' | 'DECLINED';
  hold_amount_fils: number;
}

export interface RejectionRecord {
  event_id: string;
  account_id: string;
  posted_day: number;
  reason: string;
}
