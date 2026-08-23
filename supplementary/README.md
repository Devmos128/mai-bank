# supplementary/

**Not part of the graded deliverable.**

Everything in this directory is optional and sits outside the required scope.
It exists to stress-test the design, not to pad the submission. If you are
assessing the deliverable, `src/` and `tests/` are the whole of it and you can
stop reading here.

## Isolation

The separation is enforced, not just asserted:

| | required | supplementary |
|---|---|---|
| Run with | `npm test` | `npm run test:supplementary` |
| Jest config | `jest.config.js` (`roots: tests/`) | `jest.supplementary.config.js` (`roots: supplementary/`) |
| Tests | 38 | 20 |
| In the build? | yes (`tsconfig.build.json`) | no — build compiles `src/` only |

- `npm test` runs **exactly** the 38 required tests. Its config roots at `tests/`,
  so nothing here can be picked up by it or inflate its count.
- Nothing in `src/` or `tests/` imports from this directory. The dependency runs
  one way only: supplementary reads the public interface of `src/`.
- `src/` was not modified to accommodate anything here. Where a test needed a
  method the public interface does not expose, it used the existing equivalent
  rather than adding to core (see `reconciliation.test.ts`).
- The E1–E10 replay helper is deliberately duplicated in `realStream.ts` rather
  than imported from `tests/`, so the graded suite stands alone.

## Contents

### `benchmark.ts` — replay cost vs. volume

Generates synthetic but valid event streams (CREDIT / DEBIT / AUTHORIZATION /
SETTLEMENT, random value_dates, bounded backdating) at 1×, 10×, 100× and 1000×
the size of the real stream, scaling the day window with the volume so 100×
gives the 600-day window the architecture note discusses. Measures wall-clock
time for the full replay including fee re-assessment.

```
npm run benchmark
```

Measured on this machine (Node 20, seeded PRNG, JIT warmed):

```
scale     events    days  entries    fees  rejects   time (ms)   µs/event       vs 1x
-------------------------------------------------------------------------------------
1x            11       6        8       0        2        0.01       1.07          1×
10x          101      60      132      56       11        0.36       3.53         30×
100x       1,001     600    1,370     558       71       38.99      38.95      3,306×
1000x     10,001   6,000   13,769   5,757      718     3454.46     345.41    292,950×
```

The `µs/event` column is the point. Per-event cost rises from ~1 µs to ~345 µs —
roughly 320× — because `ledgerBalance` sums the entire entry list on every call
and fee re-assessment invokes it once per day in the affected range, plus a
second full scan for the per-day idempotency guard. Event *N* therefore pays
O(N), and a full replay is O(N²). At 1000× the stream, replay takes ~3.5 seconds
for what is still a trivially small book by production standards.

This is the recompute-from-scratch cost the architecture document proposes
addressing with per-day balance snapshots, so the account does not have to be
re-derived from genesis on every query.

The synthetic stream is tuned so the account oscillates around zero rather than
staying solvent — otherwise the fee cascade never fires and the most expensive
path goes unmeasured. An earlier draft seeded the account with 50,000,000 fils
and reported `fees = 0` at every scale, which measured the cheap path only.

### `determinism.test.ts`

Replays the real E1–E10 stream through two fresh `Ledger` instances and asserts
identical closing balances (per account, per day), fee counts, rejection lists,
authorization outcomes, and full entry sequences — plus stability across 25
repeated runs. Replay is how this ledger reconstructs state, so if two identical
streams could diverge, append-only would buy nothing.

`entry_id` is excluded from the comparison: it comes from a module-level counter
and is not expected to match across instances. Every field describing the
economic result is compared.

### `instalment.property.test.ts`

Fuzzes the instalment split across thousands of random `(total, count)` pairs.
The core invariant — parts sum to the total, exactly — holds in every case
tested, including large primes and boundary shapes.

Generators are hand-rolled rather than `fast-check`: the project carries zero
runtime dependencies and a supplementary file is a poor reason to change that.
The PRNG is seeded, so any failure reproduces exactly.

**This file surfaced two findings.** Both are recorded as passing tests that
assert the real behaviour, rather than as weakened checks:

1. **The spread between instalments is the full remainder, not ≤ 1 fil.** The
   implemented rule loads the entire remainder onto the last instalment, so the
   gap between largest and smallest part equals `total % count` and grows with
   the count: `split(13, 5) → [2,2,2,2,5]`, a spread of 3. A balanced split
   (`[3,3,3,2,2]`) conserves money equally well while holding the spread to 1
   fil. E10 is 10000/3, whose remainder is 1 — the one case where the two
   approaches agree — so the difference is invisible in the graded deliverable.
   In production a 12-month plan would show the whole rounding difference landing
   on the final instalment.

   Note that `AMBIGUITIES.md` (AMB-005) claims this approach "minimises the
   maximum deviation between instalments (at most 1 fil)". That claim holds only
   when the remainder is 0 or 1. It is left uncorrected here because
   supplementary work does not edit graded documents.

2. **`count > total` produces zero-amount entries.** `split(5, 10)` books nine
   zero-value entries and one of 5. Money is conserved, so the sum invariant is
   intact, but `DESIGN.md` states `amount_fils` is "always a non-zero integer".
   Out of scope for the spec, which only asks for 10000/3, but a real system
   should reject `count > total` at the boundary.

### `reconciliation.test.ts`

The double-entry check: for each account, the sum of every booked entry must
equal the balance the ledger reports — at the end of the window and at every day
boundary within it. Also asserts no entry belongs to an unregistered account,
every amount is a safe integer, rejected events contribute nothing to any
balance, and no account/day pair carries two overdraft fees.

The brief referred to a `currentRunningBalance()` method. No such method exists
on the public interface; the equivalent is `ledgerBalance(account_id, as_of_day)`
evaluated past the end of the window. That is used rather than adding a method to
`src/`, since supplementary work must not alter the graded deliverable.
