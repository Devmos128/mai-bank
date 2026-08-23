# In-Memory Account Ledger Core

This project is a pure, append-only, in-memory account ledger engine that
replays a fixed six-day event stream across two accounts — ACC-001 (AED)
and ACC-002 (BHD) — computing per-day closing ledger balances, overdraft
fee assessments (including backdated cascade re-assessment), authorization
and settlement lifecycle, instalment credit splits, and interest accrual
and capitalization. There is no web layer, no database, no UI, and no
persistence; the engine is exercised entirely through a runnable test
suite and a console runner script, per the assessment spec.

## Prerequisites

- Node.js >= 20 (see `engines` field in `package.json`)
- TypeScript 5.4.x (installed as a dev dependency; no global install required)

## Install

```bash
npm install
```

## Run the event stream

```bash
npx ts-node src/runner.ts
```

Or via the npm script alias:

```bash
npm run runner
```

The runner replays all ten events (E1–E10) in the canonical order
specified by the assessment, then prints a per-day summary for each
account.

## Run the tests

```bash
npm test
```

Pass `--verbose` to see individual test names:

```bash
npm test -- --verbose
```

Expected output: **38 tests, 37 passed, 1 failed** across 6 test suites
(~6 s). The single failure is deliberate and is the assessment's
required failing test — see
[The one intentionally-failing test](#the-one-intentionally-failing-test)
below. `npm test` therefore exits non-zero by design.

## How to read the runner output

The runner prints output in chronological order, Day 1 through Day 6.
For each day it reports:

- **Closing ledger balance** — the sum of all ledger entries whose
  `value_date` is on or before that day, in both major-unit display
  (e.g. AED 390.90) and raw integer fils (e.g. 39090 fils). This is
  the authoritative balance used for fee assessment and interest accrual.
- **Fee assessments** — any OVERDRAFT_FEE entries booked on that day,
  including fees triggered retroactively by backdated entries (E7's
  cascade produces fees on Day 2, Day 4, and Day 5, all booked during
  Day 5 processing).
- **Authorization states** — each authorization's current status:
  PENDING, SETTLED, DECLINED, or CANCELLED. Auth-A transitions
  PENDING → SETTLED on Day 4 (E5). Auth-B is DECLINED on Day 5 (E8)
  because the available balance is AED −230.00 at the time of the check.
  Auth-Z is rejected on Day 4 (E6) because no matching pending hold
  exists.
- **Errors / rejections** — settlements or operations that were refused.
  E6 (Auth-Z settlement) appears here because Auth-Z has no prior
  authorization event; no ledger entry is created.
- **Interest capitalization** — shown on Day 6 only: a single credit
  entry summarizing the sum of all daily accruals (ACC-001: 90 fils
  = AED 0.90; ACC-002: 8 fils = BHD 0.008).

## The one intentionally-failing test

In `tests/adversarial.test.ts` there is one deliberately failing test,
labelled:

> INTENTIONAL: interest accrual uses floor division — floor-sum (90)
> differs from round-half-up total (93)

It asserts `interestEntry.amount_fils === 93` while the implementation
produces 90 fils, so `npm test` reports a genuine failure:

```
 FAIL  tests/adversarial.test.ts
  ● Adversarial edge cases › INTENTIONAL: interest accrual uses floor division — floor-sum (90) differs from round-half-up total (93)

    expect(received).toBe(expected) // Object.is equality

    Expected: 93
    Received: 90

    > 308 |     expect(interestEntry!.amount_fils).toBe(93);

Test Suites: 1 failed, 5 passed, 6 total
Tests:       1 failed, 37 passed, 38 total
```

**This failure is expected and is the only one.** A clean run is 37
passed, 1 failed, 38 total. Any other failure is a real problem.

What the test reveals: the design chose floor division for daily
accruals (`accrual = floor(balance × 4 / 10000)`). For ACC-001 after
the E7 cascade and E9 reversal, Days 4, 5, and 6 have balances of
41500, 39000, and 39000 fils respectively; their accruals floor-truncate
to 16, 15, and 15 fils, shedding fractional fils. Under round-half-up
semantics those three days would yield 17, 16, and 16 fils — a
difference of 3 fils total, producing 93 instead of 90.

It is a plain `test(...)`, not `test.skip` and not `test.failing`.
Skipping would hide the limitation; `test.failing` inverts the result so
Jest counts it as a **pass**, which would leave the suite reporting 38/38
green with no failing test visible anywhere — the opposite of the point.
Letting it fail for real is what documents the trade-off: floor division
guarantees the exact-sum invariant via the reconciliation step
(DESIGN.md §5), while round-half-up cannot make that guarantee without
additional bookkeeping.

## Further reading

- **NUMBERS.md** — every numeric constant used in the implementation,
  its exact value and units, and the reasoning for that value over
  plausible alternatives.
- **AMBIGUITIES.md** — every place the spec was silent or
  self-contradictory, with the resolution adopted and alternatives
  rejected (13 entries).
- **REJECTED.md** — every acceptance criterion that is arithmetically
  wrong, with step-by-step proof and consequence if implemented as
  written (AC2, AC6, AC7, AC8).

## Supplementary material (optional, not part of the graded deliverable)

`supplementary/` holds extra stress-tests I added after the required
work was done — a scale benchmark, a determinism check, a
property-based fuzz test on the instalment split, and a reconciliation
invariant. None of it is required, none of it is imported by `src/`
or the required tests, and `npm test` never runs it — see
`supplementary/README.md` for what's there and why, and
`jest.supplementary.config.js` / `npm run test:supplementary` to run
it separately. Worth a look if you have time, but `src/` and the 38
tests under `tests/` are the complete required submission on their
own.
