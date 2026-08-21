# REJECTED.md — Wrong Acceptance Criteria

Every acceptance criterion from the spec that is arithmetically or
logically incorrect, refused with proof. Also includes a section
confirming the criteria that are correct.

---

## REJECTED: Criterion 2 — "E7 causes exactly one overdraft fee to be assessed, on Day 2"

**Why it's wrong**: E7 is a backdated debit (posted Day 5, value_date
Day 2). The fee re-assessment algorithm processes every day from
value_date through posted_day in ascending order. A fee assessed on
Day 2 reduces the closing balance of Day 3 and beyond, which can push
subsequent days negative and trigger additional fees. The cascade
produces three fees, not one.

**Arithmetic proof**:

Setup before E7: E1–E6 have been processed. No overdraft fees exist.
Pre-E7 closing balances (from DESIGN.md §3):
  - Day 1: +120000 − 95000 = +25000 fils = AED 250.00
  - Day 2: +25000 fils = AED 250.00 (Auth-A is a hold, not a ledger entry)
  - Day 3: +25000 + 40000 = +65000 fils = AED 650.00
  - Day 4: +65000 − 18500 = +46500 fils = AED 465.00

E7 arrives: DEBIT ACC-001 AED 620.00 = −62000 fils, value_date Day 2.
Re-assessment runs Days 2 through 5:

  Day 2:
    Balance = +120000 − 95000 − 62000 = −37000 fils = AED −370.00
    Negative, no prior fee for Day 2 → ASSESS FEE: −2500 fils, value_date Day 2
    Balance after fee: −37000 − 2500 = −39500 fils

  Day 3:
    Balance = −39500 + 40000 = +500 fils = AED +5.00
    Positive → NO fee for Day 3

  Day 4:
    Balance = +500 − 18500 = −18000 fils = AED −180.00
    Negative, no prior fee for Day 4 → ASSESS FEE: −2500 fils, value_date Day 4
    Balance after fee: −18000 − 2500 = −20500 fils

  Day 5:
    Balance = −20500 (no new ledger entries between Day 4 and Day 5)
    Negative, no prior fee for Day 5 → ASSESS FEE: −2500 fils, value_date Day 5
    Balance after fee: −20500 − 2500 = −23000 fils

  Spec claims: exactly one fee, on Day 2
  Correct value: three fees — Day 2 (−2500), Day 4 (−2500), Day 5 (−2500)
  Error: the spec undercounts by 2 fees (AED 50.00 = 5000 fils missing)

**Consequence if implemented as written**: Implementing exactly one fee
(on Day 2 only) would undercharge ACC-001 by AED 50.00 in overdraft
fees. Days 4 and 5 would remain negative without fees, contradicting
the spec's own rule that "a fee is assessed once per day per account
when that day's closing ledger balance is negative." The Day 5
available-balance check for Auth-B would also be wrong: with only
one fee the Day 5 balance would be −23000 + 5000 = −18000 fils, not
−23000 fils, which still causes Auth-B to be declined (so AC5's
conditional premise is still not triggered), but the displayed balance
would be incorrect.

---

## REJECTED: Criterion 6 — "After E9, all balances and fees return to their pre-E7 values"

**Why it's wrong**: E9 is a reversal of E7; it appends +62000 fils at
value_date Day 2. This undoes the economic effect of E7's debit on the
ledger balance. However, the spec also states "The ledger is
append-only. No event record is ever mutated or deleted." The three
overdraft fees triggered by E7's cascade (Day 2: −2500, Day 4: −2500,
Day 5: −2500) are ledger entries. They are never removed. The reversal
does not de-assess fees.

**Arithmetic proof**:

Pre-E7 closing balances (DESIGN.md §9):
  - Day 1: +25000 fils = AED 250.00
  - Day 2: +25000 fils = AED 250.00
  - Day 3: +65000 fils = AED 650.00
  - Day 4: +46500 fils = AED 465.00

Post-E9 closing balances (DESIGN.md §9, confirmed by TEST_RUN.md):
  - Day 1: +25000 fils = AED 250.00  [same as pre-E7]
  - Day 2: +25000 − 2500 = +22500 fils = AED 225.00
    Spec claims: AED 250.00   Correct value: AED 225.00   Error: −AED 25.00
  - Day 3: +22500 + 40000 = +62500 fils = AED 625.00
    Spec claims: AED 650.00   Correct value: AED 625.00   Error: −AED 25.00
  - Day 4: +62500 − 18500 − 2500 = +41500 fils = AED 415.00
    Spec claims: AED 465.00   Correct value: AED 415.00   Error: −AED 50.00
  - Day 5: +41500 − 2500 = +39000 fils = AED 390.00
    Spec claims: AED 465.00   Correct value: AED 390.00   Error: −AED 75.00

The three fees total: 3 × 2500 = 7500 fils = AED 75.00. This amount
permanently reduces every balance from Day 2 onward. The reversal
restores the principal (62000 fils) but cannot remove the fees.

  Spec claims: balances return to pre-E7 values
  Correct outcome: all balances from Day 2 onward remain reduced by the
                   accumulated fee total (AED 25.00 to AED 75.00
                   depending on the day)
  Error: the three fees (AED 75.00 total) are permanent

**Consequence if implemented as written**: Crediting fee-reversal
amounts after E9 would require either (a) appending negative-fee entries
(a "fee credit" type not defined in the spec), which violates the
domain model, or (b) mutating or deleting the existing fee entries,
which violates the append-only rule. Either approach contradicts the
spec's own non-negotiable rules. The correct implementation is
confirmed by TEST_RUN.md: the post-E9 Day 5 balance is 39000 fils,
not the 46500 fils that "returning to pre-E7 values" would require.

---

## REJECTED: Criterion 7 — "The three BHD instalments in E10 must each be BHD 3.334"

**Why it's wrong**: BHD 10.000 = 10000 fils. If each of three
instalments were BHD 3.334 = 3334 fils, their sum would exceed the
original amount. The spec's own requirement that instalments sum exactly
to the total is violated.

**Arithmetic proof**:

  3 × 3334 fils = 10002 fils = BHD 10.002
  Spec claims: 3 × BHD 3.334 = BHD 10.000
  Correct sum: BHD 10.002
  Error: overcounts by 2 fils = BHD 0.002

Correct instalment computation (DESIGN.md §6, floor+residual algorithm):
  Total T = 10000 fils, N = 3 instalments
  base = 10000 ÷ 3 = 3333 fils (floor division)
  remainder = 10000 mod 3 = 1 fil
  Instalment 1: 3333 fils = BHD 3.333
  Instalment 2: 3333 fils = BHD 3.333
  Instalment 3: 3333 + 1 = 3334 fils = BHD 3.334
  Sum: 3333 + 3333 + 3334 = 10000 fils = BHD 10.000  (exact)

  Spec claims: each instalment = BHD 3.334
  Correct values: first two = BHD 3.333, last = BHD 3.334
  Error: 2 fils = BHD 0.002 created from nothing

**Consequence if implemented as written**: Crediting ACC-002 with
10002 fils instead of 10000 fils would create BHD 0.002 ex nihilo,
meaning the account holds more than was deposited. This violates
double-entry accounting. The interest capitalisation would also be
slightly wrong (off by floor(2 × 4 / 10000) = 0 fils for this
specific case, but the principal error would remain in the balance).
TEST_RUN.md test 6 (instalments.test.ts) explicitly confirms the
implementation produces 3333 + 3333 + 3334 = 10000 fils and does
NOT produce three equal 3334-fil entries.

---

## REJECTED: Criterion 8 — "If the rounded daily interest accruals do not sum to the capitalized total, the remainder is discarded"

**Why it's wrong**: This criterion directly contradicts the spec's own
non-negotiable rule. The spec states in §Non-negotiable rules: "The
rounded daily accruals must sum exactly to the capitalized total."
Discarding the remainder would violate that exact-sum invariant.

**Spec's exact contradiction**:

  Non-negotiable rule (SPEC.md §Non-negotiable rules):
    "The rounded daily accruals must sum exactly to the capitalized
     total."

  Criterion 8 (SPEC.md §Acceptance criteria):
    "If the rounded daily interest accruals do not sum to the
     capitalized total, the remainder is discarded."

Discarding the remainder means the capitalized total equals the
floor-sum of daily accruals, which may be less than the exact total.
The non-negotiable rule says they must be equal. These two statements
cannot both be true when floor-rounding produces a sum less than the
exact total.

**Resolution adopted** (DESIGN.md §5 Reconciliation step):
After computing the floor-sum of daily accruals, compare to the
exact integer total. If they differ, add the residual to the last
positive-balance day's accrual before capitalizing. This guarantees
the sum of per-day accruals equals the capitalized total, satisfying
the non-negotiable rule.

  Spec claims (AC8): discard the remainder
  Correct behavior: add the residual to the last positive day's accrual
  Error: AC8 violates the spec's own §Non-negotiable rules

**Consequence if implemented as written**: For any account where
floor-rounding of daily accruals produces a sum less than the exact
total, the capitalized amount would be underpaid. The per-day accrual
records would not sum to the capitalized total, violating the
non-negotiable rule. For ACC-001 in the full E1–E10 replay, floor-sum
= 90 fils and the reconciliation step would correct any residual;
discarding it instead would produce a capitalized amount that does not
match the sum of documented per-day figures.

---

## Criteria confirmed correct

### AC1 — "The Day 2 closing ledger balance, evaluated at end of Day 5 and before any fee is assessed, is AED −370.00"

**Confirmed correct.**
DESIGN.md §3 E7 cascade trace: "Closing balance = E1(+120000) +
E2(−95000) + E7(−62000) = −37000 fils = AED −370.00." The qualifier
"before any fee is assessed" is important — it refers to the raw
ledger balance from the three entries only, before the fee cascade
runs. TEST_RUN.md confirms: "AC1: After E7, Day 2 ledger balance
excluding fees = −37000 fils (AED −370.00)."

### AC3 — "The Day 4 settlement of Auth-A must be accepted"

**Confirmed correct.**
Auth-A was created as a PENDING hold on Day 2 (E3). E5 arrives on
Day 4 referencing Auth-A, which is a known pending hold. DESIGN.md §2
and §7: "Auth-A (E3, Day 2): PENDING → SETTLED by E5 (Day 4). Hold
released; settlement amount (18500 fils) posts to ledger." The
settlement amount (AED 185.00 = 18500 fils) is less than the hold
amount (AED 200.00 = 20000 fils), which is permitted. TEST_RUN.md
confirms: "Auth-A settlement (E5): ledger balance includes −18500
(not −20000), hold transitions to SETTLED."

### AC4 — "Any settlement referencing an authorization ID not present in the ledger must be rejected and the funds must not leave the account"

**Confirmed correct.**
DESIGN.md §2: "SETTLEMENT (unknown auth_id): Rejected; no entry." E6
references Auth-Z, which has no preceding authorization event. E6 is
rejected; no ledger entry is created; the balance is unchanged.
TEST_RUN.md confirms: "E6 (Auth-Z): rejected — no ledger entry posted,
balance unchanged" and "Only 1 SETTLEMENT ledger entry exists on
ACC-001 (E5, Auth-A, −18500 fils). No −18000 fils entry exists. E6 is
in ledger.rejections."

### AC5 — "If Auth-B is approved, its hold reduces available balance but not ledger balance"

**Confirmed correct as a general rule; however, Auth-B is actually
DECLINED in this event stream.**
The rule itself is correct: an authorization hold reduces available
balance (ledger balance minus active holds) but does not create a
ledger entry, so ledger balance is unaffected. This is stated in
DESIGN.md §2 and §8. The conditional premise ("if Auth-B is approved")
is never triggered in this event stream: Auth-B is DECLINED at Day 5
because the available balance is −23000 fils = AED −230.00 (after E7's
cascade), and approving a 9000-fil hold would produce −32000 fils <
0. The criterion is not wrong — it correctly describes how holds work
— but its conditional premise is false for this specific replay.
