# Ledger Design Notes

## 1. Domain Model

### Accounts

| Field          | Type                  | Notes                                           |
|----------------|-----------------------|-------------------------------------------------|
| account_id     | string                | e.g. ACC-001, ACC-002                           |
| currency       | enum { AED, BHD }     | Fixed at account creation                       |
| minor_unit     | integer               | AED = 100 (1 fil = 0.01 AED); BHD = 1000 (1 fil = 0.001 BHD) |
| opening_balance| integer (fils)        | AED 0.00 = 0; BHD 0.000 = 0                   |

### Ledger Entry

| Field          | Type                 | Notes                                            |
|----------------|----------------------|--------------------------------------------------|
| entry_id       | uuid                 | Immutable, unique                                |
| account_id     | string               | Foreign key to Account                           |
| amount_fils    | integer              | Positive = credit, negative = debit              |
| value_date     | integer (day 1..6)   | The date the entry is economically effective     |
| entry_type     | enum                 | CREDIT, DEBIT, SETTLEMENT, OVERDRAFT_FEE, INTEREST_CAPITALISATION, REVERSAL |
| source_event   | string               | Event identifier (E1..E10, FEE-D2, etc.)        |
| posted_day     | integer (day 1..6)   | The day the entry was appended to the ledger     |

**Invariants:**
- No entry is ever mutated or deleted (append-only).
- `amount_fils` is always a non-zero integer.
- `value_date` may be less than `posted_day` (backdated entries).
- All balances are computed by summing `amount_fils` for `value_date <= target_day`.

### Authorization Hold

| Field          | Type                 | Notes                                            |
|----------------|----------------------|--------------------------------------------------|
| auth_id        | string               | e.g. Auth-A, Auth-B                              |
| account_id     | string               |                                                  |
| hold_amount_fils | integer            | Amount frozen at authorization time              |
| status         | enum                 | PENDING, SETTLED, CANCELLED, EXPIRED             |
| value_date     | integer              | Day the authorization was placed                 |
| posted_day     | integer              | Day the authorization event arrived              |

**Invariants:**
- Only PENDING holds count toward active holds.
- A hold's `hold_amount_fils` is fixed at authorization time.
- Settlement posts the settlement amount (which may differ from the hold amount) to the ledger as a debit; the hold transitions to SETTLED.

---

## 2. Event Types and Ledger Impact

| Event type    | Ledger entry appended?               | Hold effect                       | Available balance effect          |
|---------------|--------------------------------------|-----------------------------------|-----------------------------------|
| CREDIT        | Yes: +amount at value_date           | None                              | Increases                         |
| DEBIT         | Yes: -amount at value_date           | None                              | Decreases                         |
| AUTHORIZATION | No ledger entry                      | Creates PENDING hold              | Decreases by hold_amount          |
| SETTLEMENT    | Yes: -settlement_amount at value_date; ONLY if auth_id is known | Hold -> SETTLED | Hold removed from active holds |
| SETTLEMENT (unknown auth_id) | Rejected; no entry  | None                              | No change                         |
| REVERSAL      | Yes: +reversed_amount at original value_date | None               | Increases by reversed amount      |
| OVERDRAFT_FEE | Yes: -2500 fils (AED) at fee_date    | None                              | Decreases                         |
| INTEREST_CAP  | Yes: +total_accrual at value_date Day 6 | None                          | Increases                         |

Fee assessment and interest capitalization are system-generated events, not part of the input stream. They are appended to the ledger as a consequence of other events.

---

## 3. Backdated Entry and Fee Re-assessment Algorithm

### Algorithm

When any ledger entry is appended with `value_date < posted_day` (or any entry at all, since same-day entries can also trigger fees for the current day):

1. Identify `start_day = entry.value_date`.
2. For each day D from `start_day` to `posted_day` (inclusive), in **ascending order**:
   a. Compute `closing_balance(D)` = sum of all ledger entries (including fees already assessed) where `value_date <= D`.
   b. If `closing_balance(D) < 0` AND no fee has yet been booked for day D on this account:
      - Append a new OVERDRAFT_FEE entry: `amount_fils = -2500`, `value_date = D`.
      - Mark day D as "fee assessed" (idempotency guard).
   c. The newly assessed fee is immediately part of the ledger and affects the balance computation for all subsequent days in this loop.
3. Proceed with the next day in ascending order.

**Key properties:**
- Days are processed in ascending order so that a fee on day D is reflected in the balance of day D+1 before day D+1 is evaluated.
- The idempotency guard (`fee already booked for this day`) ensures fees are not doubled on re-assessment runs.
- This algorithm is also run at end-of-day during normal (non-backdated) processing.

### E7 Full Cascade Trace

**Setup before E7:** E1..E6 processed. No overdraft fees assessed (all days positive).

Pre-E7 closing balances (AED):
- Day 1: E1(+120000 fils) + E2(-95000 fils) = +25000 fils = AED 250.00
- Day 2: +25000 fils = AED 250.00 (no new entries; Auth-A is a hold, not a ledger entry)
- Day 3: +25000 + E4(+40000) = +65000 fils = AED 650.00
- Day 4: +65000 + E5(-18500) = +46500 fils = AED 465.00

**E7 arrives on Day 5:** DEBIT AED 620.00 = -62000 fils, value_date Day 2.

Re-assessment runs from `start_day = 2` through `posted_day = 5`:

**Day 2:**
- Closing balance = E1(+120000) + E2(-95000) + E7(-62000) = -37000 fils = AED -370.00
- Balance < 0, no prior fee for Day 2.
- **Assess overdraft fee: -2500 fils, value_date Day 2.**
- Balance after: -37000 - 2500 = -39500 fils = AED -395.00

**Day 3:**
- Closing balance = Day2-balance(-39500) + E4(+40000) = +500 fils = AED +5.00
- Balance >= 0. **No fee for Day 3.**
- (Note: the AED 25.00 fee on Day 2 reduced Day 3's positive balance from +250 to +5, but did not push it negative. In a scenario where E4 were smaller, the Day 2 fee could cascade to Day 3.)

**Day 4:**
- Closing balance = Day3-balance(+500) + E5(-18500) = -18000 fils = AED -180.00
- Balance < 0, no prior fee for Day 4.
- **Assess overdraft fee: -2500 fils, value_date Day 4.**
- Balance after: -18000 - 2500 = -20500 fils = AED -205.00

**Day 5:**
- Closing balance = Day4-balance(-20500). No new ledger entries between Day 4 and Day 5.
- Balance < 0, no prior fee for Day 5.
- **Assess overdraft fee: -2500 fils, value_date Day 5.**
- Balance after: -20500 - 2500 = -23000 fils = AED -230.00

**Result of E7 cascade:** Three overdraft fees assessed — Day 2, Day 4, Day 5. Criterion 2 ("exactly one fee on Day 2") is arithmetically wrong.

**Can a fee on Day D push Day D+1 negative?** Yes, in general — and the algorithm must account for it. In this specific trace, the Day 2 fee (-2500 fils) narrowed Day 3's margin from +25000 to +500, but did not flip it. The Day 4 fee was triggered by E5's debit overwhelming the remaining positive balance, not by the Day 2 fee cascading directly. The algorithm handles both cases identically by processing in strict ascending day order.

---

## 4. Fee Idempotency Rule

**Rule:** Once a OVERDRAFT_FEE entry is appended for account A on day D, no further fee entry is ever appended for account A on day D, regardless of subsequent events.

**Formal check (per re-assessment run):** Before appending a fee for day D, query: `EXISTS (SELECT 1 FROM ledger WHERE account_id = A AND entry_type = OVERDRAFT_FEE AND value_date = D)`. If true, skip.

**What this means for reversals:** E9 reverses E7 by appending +62000 fils at value_date Day 2. After E9, the Day 2 closing balance becomes +22500 fils (positive). The system does NOT re-run a "de-assessment" — fees are never removed. The three fees from the E7 cascade (Day 2, Day 4, Day 5) remain permanently in the ledger. This is an intentional consequence of append-only semantics: the fee was correctly charged at the time the balance was negative; the reversal does not retroactively change that fact.

**What a reversal does NOT do:** It does not remove, cancel, credit-back, or otherwise neutralise any previously assessed fee.

---

## 5. Interest Accrual and Capitalization

### Algorithm

1. At end of each day D (days 1 through 6), compute `closing_balance(D)` for the account.
2. If `closing_balance(D) > 0`, record a daily accrual (not a ledger entry yet): `accrual[D] = floor(closing_balance(D) * 4) / 1000` in fils. (0.04% = 4/10000; for integer fils: `accrual_fils[D] = closing_balance_fils(D) * 4 / 10000`, using floor division.)
3. After computing all 6 daily accruals, sum them: `raw_sum = sum(accrual_fils[1..6])`.
4. Compute the "exact" total: `exact_total = closing_balance_fils(1) * 4 / 10000 + ... + closing_balance_fils(6) * 4 / 10000` (integer arithmetic throughout).
5. **Reconciliation:** If `raw_sum` differs from `exact_total` (due to accumulation of floor rounding), add the residual to the last positive-balance day's accrual. The sum of rounded accruals must equal the capitalized total.
6. At end of Day 6, append a single INTEREST_CAPITALISATION entry: `amount_fils = raw_sum` (after reconciliation), `value_date = Day 6`.

### ACC-002 (BHD) Worked Example

- Days 1–4: balance = 0 fils. No accrual.
- Day 5: balance = 10000 fils (BHD 10.000 from E10). Accrual = floor(10000 × 4 / 10000) = floor(4.0) = 4 fils.
- Day 6: balance = 10000 fils (before capitalization). Accrual = floor(10000 × 4 / 10000) = 4 fils.
- Sum = 8 fils = BHD 0.008. Total is exact; no reconciliation needed.
- At end of Day 6: append +8 fils, value_date Day 6.

### ACC-001 (AED) After E7

- Days 2–6: balance negative (AED -395.00 through -230.00). No accrual (only positive balances earn interest).
- Day 1: balance = AED 250.00 = 25000 fils. Accrual = floor(25000 × 4 / 10000) = floor(10.0) = 10 fils.
- Days 2–6: 0 accrual.
- Sum = 10 fils = AED 0.10. Append +10 fils at value_date Day 6.

### Rounding Rule

Daily accrual uses floor division in integer minor units. The reconciliation step (add residual to last positive day) guarantees the spec's invariant: "The rounded daily accruals must sum exactly to the capitalized total."

---

## 6. Instalment Arithmetic

### Algorithm

Given: total amount T (in fils), split into N instalments.

1. `base = T // N` (integer floor division)
2. `remainder = T % N`
3. Instalments 1 through N-1: each = `base` fils.
4. Instalment N (last): `base + remainder` fils.
5. Sum check: `(N-1) * base + (base + remainder) = N * base + remainder = T`. Exact by construction.

**Why floor+last-residual, not round-each:** Rounding each independently can produce a sum that is off by ±1 per instalment (N/2 fils total in the worst case). Floor+residual guarantees the exact sum in all cases.

### E10 Worked Example

E10: CREDIT ACC-002 BHD 10.000, three equal instalments.

- Total: BHD 10.000 = 10,000 fils
- N = 3
- base = 10000 // 3 = **3333 fils** (BHD 3.333)
- remainder = 10000 % 3 = **1 fil**
- Instalment 1: 3333 fils = **BHD 3.333**
- Instalment 2: 3333 fils = **BHD 3.333**
- Instalment 3: 3333 + 1 = 3334 fils = **BHD 3.334**
- Sum: 3333 + 3333 + 3334 = 10,000 fils = BHD 10.000 (exact)

Criterion 7 states "each BHD 3.334." That is wrong: 3 × 3334 fils = 10,002 fils = BHD 10.002 ≠ BHD 10.000. See REJECTED.md.

---

## 7. Hold Lifecycle

```
[CREATE AUTHORIZATION]
        |
        v
    PENDING ─────────────────────────┐
        |                            |
        | matching SETTLEMENT        | SETTLEMENT with
        | event received             | unknown auth_id
        |                            | (different hold)
        v                            |
   SETTLED                      REJECTED (settlement rejected)
        
    PENDING ──→ CANCELLED  (explicit cancellation event; not in this spec's event stream)
    PENDING ──→ EXPIRED    (time-based expiry; not in this spec's window)
```

**State transitions in this event stream:**
- Auth-A (E3, Day 2): PENDING → SETTLED by E5 (Day 4). Hold released; settlement amount (18500 fils) posts to ledger.
- Auth-Z (referenced in E6): No PENDING hold exists. E6 is rejected; no state created.
- Auth-B (E8, Day 5): Declined at authorization time (available balance insufficient). No hold created; status DECLINED (never enters PENDING).

**Hold amount vs. settlement amount:** The hold freezes `hold_amount_fils`. The settlement debits `settlement_amount_fils` to the ledger. These may differ (E5: hold=20000, settlement=18500). The difference (the unspent hold amount) is simply released — it does not become a credit entry.

**Active holds:** Only holds in PENDING state count as active holds for the available-balance calculation.

---

## 8. Available Balance Formula

### Formula

```
available_balance(account, as_of_day) =
    ledger_balance(account, as_of_day)
    - sum(hold_amount_fils for all PENDING holds on account)
```

where `ledger_balance(account, as_of_day) = sum(amount_fils for all ledger entries where value_date <= as_of_day)`.

### Timestamp Choice: Current Posting Day

**Decision:** When evaluating an authorization, use `as_of_day = event.posted_day` (the day the authorization event arrives), not `event.value_date`.

**Justification:** The authorization check must reflect the account's actual, current exposure including all ledger entries already posted. If a backdated debit (like E7) was posted on Day 5, the Day 5 ledger balance already reflects that debit and any resulting fees. Using a stale `value_date` balance would miss those entries and overstate the available funds, creating a real credit risk. The purpose of the check is to prevent overdrafts given the current known state of the account.

### E8 (Auth-B) Evaluation

- Posted Day 5. As-of-day = 5.
- Ledger balance Day 5 (after E7 cascade): -23000 fils = AED -230.00.
- Active holds: 0 (Auth-A settled by E5; Auth-Z never created a hold).
- Available balance: -23000 - 0 = -23000 fils = AED -230.00.
- Auth-B requested hold: 9000 fils = AED 90.00.
- Available after hold: -23000 - 9000 = -32000 fils = AED -320.00 < 0.
- **Auth-B is DECLINED.**

---

## 9. Reversal Semantics

### What a Reversal Appends

A reversal of event X appends a new ledger entry with:
- `amount_fils = -X.amount_fils` (opposite sign, equal magnitude)
- `value_date = X.value_date` (same value date as the original)
- `entry_type = REVERSAL`
- `source_event = "reversal of X"`

### What a Reversal Does NOT Undo

- Any **fees** assessed because of X remain in the ledger permanently. The append-only rule applies. If X pushed the balance negative and triggered fees on days D, D+1, ..., those fees survive the reversal.
- Any **authorization holds** evaluated against the balance state that included X are not retroactively re-evaluated.
- The **original entry X** remains in the ledger. The reversal does not delete or flag X.

### E9 Reversal of E7

- E9 posted Day 6, value_date Day 2: appends +62000 fils at value_date Day 2.
- The three fees booked due to E7 (Day 2: -2500, Day 4: -2500, Day 5: -2500) are NOT removed.
- Post-E9 closing balances (AED):
  - Day 1: +25000 fils = AED 250.00 (unchanged from pre-E7)
  - Day 2: 25000 - 2500 = +22500 fils = AED 225.00 (pre-E7 was AED 250.00)
  - Day 3: 22500 + 40000 = +62500 fils = AED 625.00 (pre-E7 was AED 650.00)
  - Day 4: 62500 - 18500 - 2500 = +41500 fils = AED 415.00 (pre-E7 was AED 465.00)
  - Day 5: 41500 - 2500 = +39000 fils = AED 390.00 (pre-E7 was AED 465.00)
  - Day 6: 39000 fils = AED 390.00 (plus interest capitalisation)
- Criterion 6 ("balances return to pre-E7 values") is wrong. The 75 AED in fees (3 × AED 25.00) remain.

---

## 10. Known Design Decisions — Verification

### Decision 1: Money stored as integer minor units (fils)

**Spec quote:** "AED is 2 decimal places, BHD is 3. Amounts stored and rounded to their own precision."

**Analysis:** The spec mandates precision but is silent on internal representation. Using integer minor units (AED × 100, BHD × 1000) is the direct, loss-free translation of that precision requirement. Floating-point representation would introduce rounding errors that violate the "exact sum" requirement for instalment splits and interest capitalization.

**Verdict: CONFIRMED.** Integer minor units are the necessary implementation of the spec's precision requirement.

---

### Decision 2: Fee/interest re-assessment runs in ascending day order from value_date onward

**Spec quote:** "assessed once per day per account when that day's closing ledger balance (all entries with value_date <= that day) is negative. Booked with value_date equal to the day assessed."

**Analysis:** A fee is a ledger entry. Once booked for day D, it affects the closing balance of every day >= D. If days were processed out of order (e.g., D+1 before D), the D+1 calculation would miss the D fee, and the algorithm would produce incorrect results. The spec's problem statement explicitly warns that "a fee on day D can itself push day D+1 negative" — this is only meaningful if the days are processed in sequence.

**Verdict: CONFIRMED.** Ascending-order processing is the only consistent interpretation.

---

### Decision 3: Fees are never un-assessed even if a later reversal makes the balance positive

**Spec quote:** "The ledger is append-only. No event record is ever mutated or deleted."

**Analysis:** Fees are ledger entries. The append-only rule applies without exception. There is no "negative fee" or "fee reversal" event type in the spec. Criterion 6 implicitly claims fees are reversed, but that claim is arithmetically wrong.

**Verdict: CONFIRMED.** Append-only is unconditional; fees survive reversals.

---

### Decision 4: Instalment splits use floor-division + residual absorbed by last entry

**Spec quote:** "posted as three equal instalments"

**Analysis:** The word "equal" is imprecise for amounts that do not divide evenly. BHD 10.000 / 3 = 3.333... recurring. Floor-division gives 3333 + 3333 + 3334 fils, summing exactly to 10000. This is the only integer-arithmetic approach that guarantees an exact sum. Criterion 7 claims each instalment is BHD 3.334, which overcounts by BHD 0.002.

**Verdict: CONFIRMED** (algorithm correct). Criterion 7 is wrong.

---

### Decision 5: Settlement amount (not original hold amount) hits ledger balance

**Spec quote:** "E5 - Day 4 - SETTLEMENT - ACC-001 Auth-A settles for AED 185.00" (Auth-A hold was AED 200.00)

**Analysis:** The spec uses "settles for AED 185.00" — distinct from the hold of AED 200.00. This phrasing unambiguously means the 185.00 is what is charged. The 15.00 difference (unspent hold) is simply released. No spec text suggests the hold amount is used instead.

**Verdict: CONFIRMED.** Settlement amount posts; hold released; difference neither credited nor charged.

---

### Decision 6: Available balance uses ledger balance as of current posting day

**Spec quote:** "available balance (ledger balance minus active holds) remains at or above zero after the hold is applied"

**Analysis:** The spec says "ledger balance" without specifying a timestamp. Using the posting day's balance is the only choice that reflects the account's true current state. Using value_date's balance for a forward-dated auth (value_date > posted_day) would produce a stale picture. Using it for a same-day auth is equivalent. The real risk of using any other timestamp is that recently posted debits or fees (like E7's cascade) would be invisible, allowing authorizations that create real overdraft exposure.

**Verdict: CONFIRMED.** Balance as of `posted_day` is used for all authorization checks.
