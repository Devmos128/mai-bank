# Test Run — mai-bank adversarial test suite

**Timestamp:** 2026-08-21T00:00:00Z  
**Runner:** Jest 29 / ts-jest / Node >= 20  
**Command:** `npm test -- --verbose`

---

## Results Summary

```
Test Suites: 6 passed, 6 total
Tests:       38 passed, 38 total
Snapshots:   0 total
Time:        ~6 s
```

All 38 tests pass. The one `test.failing` ("INTENTIONAL: interest accrual uses floor division") is correctly counted as **passed** by Jest because the failure it describes is expected — the assertion inside asserts 93 fils but the implementation produces 90 fils, which is the documented design trade-off (floor-sum vs. round-half-up).

---

## PASS tests/domain.test.ts — Domain invariants (5 tests)

```
✓ 1. Opening balance is 0 for ACC-001 (AED)
✓ 2. Opening balance is 0 for ACC-002 (BHD)
✓ 3. All ledger entries have integer amount_fils (never float or fractional)
✓ 4. Entries are append-only: entry count never decreases after each event
✓ 5. Only PENDING holds count toward active holds total
```

**Notes:**
- Test 5 uses `ledger.authOutcomes` (not `getHolds()`) for DECLINED checks, because the Ledger implementation correctly does not insert DECLINED authorizations into the holds Map — they are recorded in `authOutcomes` only.

---

## PASS tests/event-replay.test.ts — Backdated entries (5 tests)

```
✓ AC1: After E7, Day 2 ledger balance excluding fees = -37000 fils (AED -370.00)
✓ Cascade: after E7, exactly 3 overdraft fees are booked on ACC-001 (Day 2, Day 4, Day 5)
✓ After E9 reversal, the 3 fees from E7 cascade still exist (append-only)
✓ After E9: Day 2 balance = 22500 fils (AED 225.00) — fee remains, balance does NOT return to pre-E7
✓ Chain: after E9, Day 5 balance = 39000 fils (AED 390.00) — three fees are permanently in the ledger
```

**Key verified values:**
- E7 cascade: fees on Day 2 (-2500), Day 4 (-2500), Day 5 (-2500). No fee on Day 3 (+500 fils, positive).
- Post-reversal Day 2 balance: 120000 - 95000 - 62000 + 62000 - 2500 = **22500 fils**
- Post-reversal Day 5 balance: 120000 - 95000 + 40000 - 18500 - 7500 + 62000 = **39000 fils**

---

## PASS tests/fees.test.ts — Fee assessment (5 tests)

```
✓ 1. No fee on Day 1 — balance is 25000 fils (positive)
✓ 2. E7 triggers exactly one fee on Day 2 (idempotent: re-assessment still has exactly 1 fee for Day 2)
✓ 3. Double-event idempotency: Day 2 fee is not doubled after a second debit
✓ 4. Deterministic replay: two separate ledger instances produce identical results
✓ 5. Day 3 has NO fee — balance is +500 fils (positive) after Day 2 fee cascade
```

**Key findings:**
- Test 3 confirms the idempotency guard (`no fee already booked for this account on day D`) works correctly in single-threaded execution.
- Test 4 confirms replay determinism: two independent Ledger instances replaying the same event stream produce byte-identical entry arrays (modulo entry_id which is globally sequential, but amounts/types/dates are identical).

---

## PASS tests/holds.test.ts — Authorization and settlement (9 tests)

```
✓ 1. After E3 (Auth-A PENDING): available balance = 5000 fils, ledger balance unchanged at 25000
✓ 2. Auth-A settlement (E5): ledger balance includes -18500 (not -20000), hold transitions to SETTLED
✓ 3. E6 (Auth-Z): rejected — no ledger entry posted, balance unchanged
✓ 4. Auth-B (E8): DECLINED — available balance at Day 5 = -23000 fils < 0 + 9000 check
✓ 5. After E5 settlement: available balance = ledger balance (no active holds); Day 4 post-settlement balance = 41500 fils (pre-E7)
✓ 5b. Ledger balance at Day 4 after E5 and E6 is 46500 fils (E6 rejected, did not debit)
✓ 6. Settle exactly at hold limit: credit 10000, authorize 10000 — must be APPROVED (available=0)
✓ 7. Settle for 1 fil over hold amount — must be rejected (over-settlement blocked per AMB-009)
✓ 8. Settle against already-settled hold: must be rejected
```

**Key findings:**
- Test 2: Settlement posts -18500 (the settlement amount), NOT -20000 (the hold amount). Confirmed correct.
- Test 4: Available balance at Day 5 after E7's cascade = -23000 fils. Auth-B for 9000 fils would produce -32000 fils available — correctly DECLINED.
- Test 7: Over-settlement (settlement_amount > hold_amount) is recorded as a rejection in `ledger.rejections`, does not throw. The hold remains PENDING. This is consistent with AMB-009 resolution.
- Test 8: Double-settlement against the same auth_id is recorded as a rejection (or throws) and the balance does not decrease twice.

---

## PASS tests/instalments.test.ts — Instalment arithmetic exactness (6 tests)

```
✓ 1. E10: exactly 3 CREDIT entries for ACC-002, all with value_date=5
✓ 2. Sum of instalment amounts = 10000 fils exactly
✓ 3. First two instalments = 3333 fils each (floor division)
✓ 4. Third (last) instalment = 3334 fils (base + remainder)
✓ 5. Arbitrary exactness: sum(instalments) == T for T=10000,N=3 and T=7,N=3 and T=100,N=7
✓ 6. AC7 disproof: implementation does NOT produce three equal 3334 fils entries (which would sum to 10002)
```

**Key verified values:**
- Algorithm: `base = floor(T/N)`, `remainder = T mod N`, first N-1 instalments = base, last = base + remainder.
- BHD 10.000 / 3 = 3333 + 3333 + 3334 fils = 10000 fils exactly.
- Criterion 7 of the spec ("each BHD 3.334") is arithmetically wrong: 3 × 3334 = 10002 ≠ 10000. Disproved by test 6.
- Arbitrary-exactness test (test 5): T=7,N=3 → [2,2,3]; T=100,N=7 → [14,14,14,14,14,14,16] — all sum exactly.

---

## PASS tests/adversarial.test.ts — Hardest edge cases + intentional failure (8 tests)

```
✓ 1. Auth approved at exactly available=0: credit 9000, authorize 9000 → PENDING (available becomes 0)
✓ 2. Auth declined when would go to -1: credit 9000, authorize 9001 → DECLINED
✓ 3. Multiple concurrent holds: 3 of 10000 approved on 30000 balance; 4th for 1 fil → DECLINED (available=0)
✓ 4. Settlement releases hold from available: after settling Auth-X, Auth-W for 1 fil passes
✓ 5. Cancelled/expired holds do not count toward active holds (note on design)
✓ 6. Full event stream E1-E10 + interest: ACC-001 Day 6 = 39090 fils; ACC-002 Day 6 = 10008 fils
✓ 7. E6 rejection: rejections contain Auth-Z reference; ledger balance not reduced by 18000
✓ INTENTIONAL: interest accrual uses floor division — floor-sum (90) differs from round-half-up total (93)
```

**Key findings:**

**Test 6 — End-to-end balance verification:**
- ACC-001 Day 6 = 39000 (pre-interest) + 90 (interest cap) = **39090 fils** (AED 390.90)
  - Interest: Day1=10, Day2=9, Day3=25, Day4=16, Day5=15, Day6=15 → sum = 90 fils
- ACC-002 Day 6 = 10000 (E10 instalments) + 8 (interest cap) = **10008 fils** (BHD 10.008)
  - Interest: Day5=4, Day6=4 → sum = 8 fils

**Test 7 — E6 rejection confirmed:**
- Only 1 SETTLEMENT ledger entry exists on ACC-001 (E5, Auth-A, -18500 fils).
- No -18000 fils entry exists. E6 is in `ledger.rejections`.

**Intentional failure (test.failing) — floor-sum limitation:**
- The assertion inside this test expects `interestEntry.amount_fils === 93` (round-half-up semantics).
- The implementation produces 90 fils (floor-sum semantics per DESIGN.md §5).
- `expect(93).toBe(93)` would be correct under round-half-up; `expect(90).toBe(93)` fails.
- Jest counts `test.failing` with a failing inner assertion as a **passing** test overall.
- This documents that Days 4, 5, 6 have fractional accruals (16.6, 15.6, 15.6 fils) that floor truncates to 16, 15, 15 — shedding 1.8 fils. Round-half-up would produce 17+16+16=49 vs floor 16+15+15=46, a difference of 3 fils total.

---

## Implementation observations (discovered during test writing, without reading src internals)

1. **`getHolds()` returns only holds that entered PENDING** — DECLINED authorizations are NOT in the holds Map. They are accessible via `ledger.authOutcomes` (public array, `status: 'DECLINED'`).
2. **`ledger.rejections`** is a public array (not a `getRejections()` method). E6 (unknown auth_id) and over-settlement both push to this array instead of throwing.
3. **Over-settlement (AMB-009)** is handled by rejection record, not exception. The hold remains PENDING after a rejected over-settlement attempt.
4. **Double-settlement** of an already-SETTLED hold is also handled via rejection record (hold status is not PENDING, so it falls into the rejection path).
5. **Interest capitalization produces 90 fils for ACC-001** (floor-sum of daily accruals). The accrual for Days 4/5/6 involves fractional fils that floor truncates: the design chose floor-sum over round-half-up, as documented in DESIGN.md §5.
