# WORKLOG.md — Agent Activity Log

Chronological record of agent activity for the mai-bank assessment.
All work occurred on 2026-08-21. Exact wall-clock times are
approximate; the test run timestamp (2026-08-21T00:00:00Z) is taken
from docs/TEST_RUN.md.

---

## 2026-08-21T08:00:00Z

**Agent**: ledger-architect

**What happened**: Produced the authoritative design document and the
ambiguity resolution log. The design document covers 10 sections:
domain model (accounts, ledger entries, authorization holds), event
types and ledger impact, the backdated-entry fee re-assessment
algorithm with a full E7 cascade trace, the fee idempotency rule,
interest accrual and capitalization with worked examples for both
accounts, instalment arithmetic (floor+residual algorithm with E10
worked example), the hold lifecycle state machine, the available
balance formula with the E8 Auth-B evaluation, reversal semantics
with the E9 post-reversal balance table, and 6 verified design
decisions. The ambiguity log documents 13 resolutions (AMB-001
through AMB-013), each with a rejected alternative. The analysis of
acceptance criteria identified AC2, AC6, AC7, and AC8 as wrong and
flagged them for REJECTED.md.

**Artifacts**: docs/DESIGN.md, AMBIGUITIES.md

---

## 2026-08-21T10:00:00Z

**Agent**: ledger-builder

**What happened**: Produced the full TypeScript implementation.
src/types.ts defines the domain types: Currency, Account, EntryType
(enum with CREDIT, DEBIT, SETTLEMENT, REVERSAL, OVERDRAFT_FEE,
INTEREST_CAPITALISATION), LedgerEntry, HoldStatus (enum with PENDING,
SETTLED, CANCELLED, EXPIRED, DECLINED), AuthorizationHold, all event
interfaces (CreditEvent, DebitEvent, AuthorizationEvent,
SettlementEvent, ReversalEvent, InstalmentCreditEvent), and outcome
records (AuthOutcome, RejectionRecord). src/ledger.ts implements the
Ledger class with the re-assessment cascade, idempotency guard, floor-
division interest, reconciliation step, and instalment splitting.
src/runner.ts replays all ten events (E1–E10) and prints per-day
output. package.json sets the engine to Node >= 20, jest and ts-jest
at ^29, typescript at ^5.4.5. tsconfig.json and jest.config.js
configure the TypeScript/Jest pipeline.

**Artifacts**: src/types.ts, src/ledger.ts, src/runner.ts,
package.json, tsconfig.json, jest.config.js

---

## 2026-08-21T00:00:00Z

**Agent**: ledger-adversary

**What happened**: Produced 6 test files containing 38 tests total,
and the test run record. tests/domain.test.ts (5 tests) verifies
domain invariants: opening balances, integer-only amounts,
append-only entry count, only PENDING holds count. tests/event-
replay.test.ts (5 tests) verifies backdated entry behaviour: AC1
balance, the 3-fee cascade, fee persistence through E9, and post-E9
Day 2 and Day 5 balances. tests/fees.test.ts (5 tests) verifies fee
assessment: no fee on positive days, idempotency guard, deterministic
replay, Day 3 positive after cascade. tests/holds.test.ts (9 tests)
verifies authorization and settlement: Auth-A PENDING/SETTLED,
E5 settlement amount vs. hold amount, E6 Auth-Z rejection, Auth-B
decline, over-settlement rejection, double-settlement rejection.
tests/instalments.test.ts (6 tests) verifies E10 instalment
arithmetic: 3 entries, sum exactness, first-two = 3333, last = 3334,
arbitrary-exactness property, AC7 disproof. tests/adversarial.test.ts
(8 tests including the intentional test.failing) verifies edge cases
and the full end-to-end balance (ACC-001 Day 6 = 39090 fils,
ACC-002 Day 6 = 10008 fils). All 38 tests pass; the one test.failing
(floor-sum 90 vs. round-half-up 93) is correctly counted as passed by
Jest.

**Artifacts**: tests/domain.test.ts, tests/event-replay.test.ts,
tests/fees.test.ts, tests/holds.test.ts, tests/instalments.test.ts,
tests/adversarial.test.ts, docs/TEST_RUN.md

---

## 2026-08-21T14:00:00Z

**Agent**: ledger-scribe

**What happened**: Produced the four documentation files by reading
(in order) docs/SPEC.md, docs/DESIGN.md, AMBIGUITIES.md,
docs/TEST_RUN.md, src/types.ts, and package.json, then writing only
values verifiable from those sources. README.md describes the project,
prerequisites, install/run/test commands, how to read the runner
output, the intentionally-failing test and what it reveals, and
pointers to NUMBERS.md, AMBIGUITIES.md, and REJECTED.md. NUMBERS.md
documents all 17 numeric constants with value, source quote, and
reasoning for the chosen value over plausible alternatives.
AMBIGUITIES.md was not overwritten (already produced by
ledger-architect). REJECTED.md documents all four wrong criteria
(AC2, AC6, AC7, AC8) with step-by-step arithmetic proofs, and
confirms the four correct criteria (AC1, AC3, AC4, AC5) with the
note that AC5's conditional premise is never triggered in this
event stream.

**Artifacts**: README.md, NUMBERS.md, REJECTED.md, WORKLOG.md
