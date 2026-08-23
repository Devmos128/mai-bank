# WORKLOG

I used AI tooling throughout this build — the assessment explicitly
permits and expects it. I'm not hiding that. What I want to be clear
about is the division of labour: I made the design decisions, worked
the arithmetic through by hand before trusting any generated code,
reviewed every output, and can defend every number below. The tooling
accelerated the typing; it did not make the calls.

Section headers are the actual git commit timestamps
(`git log --date=iso-strict`), local time (+04:00). Nothing here is
rounded or backfilled.

---

## 2026-08-21T12:57:46+04:00 — Set up the repo and how I'd work

Before writing anything, I decided on a workflow that would keep me
honest: separate the design, the implementation, the tests, and the
docs, and — critically — write the tests against the spec *without*
reference to the implementation's reasoning. The point was to avoid
tests that simply confirm whatever the code already does. That
separation is the reason I trust the suite as a real check later,
rather than a rubber stamp.

Committed the initial project skeleton — the directory layout for
docs, src, and tests.

## 2026-08-21T13:11:36+04:00 — Captured the spec as the source of truth

Committed the full assessment text to `docs/SPEC.md` verbatim, so that
every downstream decision — especially the ones where I end up
disagreeing with the acceptance criteria — traces back to an exact
quote rather than my paraphrase of it.

## 2026-08-21T13:20:06+04:00 — Design and ambiguity resolution (the actual thinking)

This is the commit where the real work happened. I did the hand
analysis here, before any code, and wrote it up in `docs/DESIGN.md`
and `AMBIGUITIES.md`. The decisions I committed to:

- **Money as integer minor units, never floats.** AED ×100, BHD ×1000.
  The spec's exact-sum requirements for instalments and interest are
  impossible to guarantee under floating point, so this wasn't a style
  choice — it was forced.

- **The E7 backdating trap.** E7 is a DEBIT posted on Day 5 but
  value-dated Day 2. That backdating is the whole puzzle: it forces a
  fee re-assessment from Day 2 forward, and I worked the cascade out by
  hand before coding it. Day 2 goes to −370.00 → fee. Day 3 is +5.00
  (the Day 2 fee narrowed the margin but didn't flip it) → no fee.
  Day 4 is −180.00 → fee. Day 5 is −205.00 → fee. That's **three**
  overdraft fees, which is why I reject acceptance criterion 2's claim
  of "exactly one." Getting this wrong by processing days out of order,
  or by stopping at the first fee, was the trap I most wanted to avoid.

- **Fees are append-only and survive reversal.** When E9 reverses E7,
  the balance goes positive again, but the three fees already booked do
  not vanish — the ledger never mutates or deletes. This is why I
  reject criterion 6 ("all balances and fees return to pre-E7 values"):
  they don't, and can't, by the spec's own append-only rule.

- **Re-assessment runs in ascending day order** specifically because a
  fee booked on day D changes the closing balance of D+1, and can in
  principle push D+1 negative. Any other order computes the wrong
  balances.

- **Instalment split by floor-division with the residual on the last
  entry.** BHD 10.000 = 10000 fils, ÷3 = 3333 remainder 1, so
  3333 / 3333 / 3334, summing to exactly 10000. Criterion 7's
  "each 3.334" would sum to 10.002 and invent 2 fils from nothing —
  rejected.

- **Interest by floor-division (4/10000), positive balances only,
  capitalised once at end of Day 6, with a reconciliation step** so the
  rounded daily accruals sum exactly to the capitalised total. This is
  what makes criterion 8 wrong: it says to *discard* the remainder,
  which directly contradicts the spec's own non-negotiable rule that
  the accruals "must sum exactly to the capitalized total."

- **"Available balance" timestamp — a genuine gap in the spec.** The
  spec defines available balance as "ledger balance minus active holds"
  but never says *which* ledger balance in time. I chose the balance as
  of the current posting day, not the authorization's value_date,
  because the check exists to gate spend against the account's real
  current exposure. Using a stale value-dated balance would hide
  recently posted backdated debits (exactly like E7) and approve
  authorizations that create real overdraft risk. This is documented as
  AMB-001.

- **Auth-B is declined.** After the E7 cascade, Day 5 available balance
  is −230.00, so a further 90.00 hold can't be approved. The criterion
  about Auth-B's hold behaviour is correct as a rule, but its premise
  ("if Auth-B is approved") never fires.

- **Settlement posts the settlement amount, not the hold amount**, and
  over-settlement beyond the hold is rejected (AMB-009); a settlement
  against an unknown authorization (E6/Auth-Z) is rejected with no funds
  moving.

Altogether I logged 13 ambiguities with an explicit resolution and a
rejected alternative for each, and flagged criteria 2, 6, 7, and 8 as
wrong for the arithmetic write-up.

## 2026-08-21T13:28:53+04:00 — Implemented the ledger

Built the domain model and event replay in TypeScript to match the
design exactly: the re-assessment cascade with its per-day idempotency
guard, floor-division interest with the reconciliation step, and the
instalment split. Money is integer fils end to end — no float touches a
monetary value at any point. I checked the runner output against my
hand analysis: ACC-001 closes Day 6 at 39090 fils (AED 390.90),
ACC-002 at 10008 fils (BHD 10.008), and the three fees land on Days 2,
4, and 5 as I'd worked out. It matched, which is what I wanted to see
before writing tests.

## 2026-08-21T13:41:01+04:00 — Tests written against the spec, independently

Wrote 38 tests straight from the spec and the public interface, without
leaning on the implementation's internal reasoning, so they'd catch a
wrong implementation rather than agree with it. They cover the domain
invariants, the backdated cascade, fee idempotency, the hold and
settlement lifecycle, and instalment exactness. I deliberately included
one failing test, and made it a *real* limitation rather than a trivial
one: interest computed as a floor-sum comes to 90 fils, whereas
round-half-up would give 93 fils. The test documents that I chose floor
(with reconciliation to preserve the exact-sum rule), and that the
choice costs the customer 3 fils versus round-half-up — a genuine,
defensible trade-off, annotated inline. Everything else passes.

## 2026-08-21T13:45:54+04:00 — Wrote the documentation

Wrote README, NUMBERS.md, and REJECTED.md from the design notes and the
actual verified test output — no number in them that I hadn't already
seen confirmed. NUMBERS.md justifies each constant against its
alternative; REJECTED.md carries the step-by-step arithmetic for
rejecting criteria 2, 6, 7, and 8, and confirms 1, 3, 4, and 5 (with
the note that 5's premise never triggers).

## 2026-08-21T14:02:06+04:00 — Build config, after two false starts

This one took three attempts, and the two dead ends are worth recording
rather than hiding.

First I pinned the build's TypeScript `types` to `["node"]` to keep the
shippable config tight. That was wrong in isolation: it stripped the Jest
globals ts-jest inherits, and the suite stopped compiling. Second, I
added a dedicated test tsconfig so ts-jest could see the Jest types
again — that fixed the compile but not the editor, which resolves the
*root* config and so still flagged `describe` as undefined.

What actually works is inverting the two: root `tsconfig.json` is the
editor/dev config (src and tests, Node + Jest types), and a separate
`tsconfig.build.json` produces the clean, tests-excluded build. The root
config is the one an editor's TypeScript server picks up by default,
which is why the first two attempts kept missing it.

One thing worth flagging from the verification pass: an out-of-band edit
had reverted a domain test to assert that a *declined* authorization
shows up in the holds map. It doesn't — declined auths never enter that
map, they're recorded as outcomes — so I restored the correct assertion
rather than let a wrong test through. Weakening the implementation to
satisfy a bad test would have been the easy path and the wrong one.

Verified: build clean, full typecheck clean, 38/38 tests pass.

## 2026-08-23T10:12:55+04:00 — Stress-tested the design past what the spec asks

With the required work done, I wanted to know where the design actually breaks
rather than assert it in prose, so I added optional work in `supplementary/`,
deliberately fenced off from the graded deliverable.

The **benchmark** replays synthetic streams at 1×/10×/100×/1000× the real
volume. Per-event replay cost rises from ~1 µs to ~345 µs — the ledger answers
every balance question by rescanning the entire entry list, and fee
re-assessment calls that once per day plus a second scan for the idempotency
guard, so event *N* pays O(N) and a full replay is O(N²). At 1000× the stream
that is ~3.5 seconds for a book that is still trivially small. This is the
number behind the "recompute from scratch" claim in the architecture document,
measured rather than assumed.

Getting that measurement honest took a correction. My first version seeded the
account with 50,000,000 fils, which kept it solvent for the whole run and
reported `fees = 0` at every scale — it was benchmarking the cheap path and
skipping the fee cascade entirely. Reducing the seed so the balance oscillates
around zero is what made the expensive path actually fire.

The **property test** on the instalment split surfaced two things the required
suite could not, because the spec's single case hides them:

- The spread between instalments is the full remainder, not "at most 1 fil".
  `split(13, 5)` gives `[2,2,2,2,5]` — a spread of 3, because the whole
  remainder lands on the last entry. A balanced split (`[3,3,3,2,2]`) conserves
  money equally well while keeping the parts near-equal. E10 is 10000/3, whose
  remainder is 1 — the one case where both approaches agree. My own AMB-005
  claims "at most 1 fil"; that holds only for remainder 0 or 1, and the
  correction is disclosed in `supplementary/README.md` rather than by quietly
  rewriting the ambiguity log after the fact.
- `count > total` books zero-amount entries, against DESIGN.md's "always a
  non-zero integer". Money is still conserved, so it is a boundary the spec
  never reaches, but a real system should reject it outright.

Both are recorded as passing tests asserting the *real* behaviour. Weakening
the assertions to make them green would have thrown away the finding.

Isolation is enforced, not just claimed: `npm test` still runs exactly the 38
required tests, guarded by an explicit ignore pattern I verified is
load-bearing — remove it and the count silently becomes 58.

## 2026-08-23T10:22:12+04:00 — Split the supplementary work by kind

Moved the test specs to `tests/supplementary/` alongside the other tests, and
left the runnable benchmark and shared helper in `supplementary/`. Putting the
specs under `tests/` is what made the ignore pattern necessary in the first
place, so the guard and this layout have to be read together.

## Deliverable 2 — Architecture & Trade-offs

Written and complete: `architecture-and-tradeoffs.pdf`, 3 pages, covering
append-only at 100× volume, the operational and regulatory surface that
value-dated entries create in a UAE-licensed bank, every way an authorization
can end other than a matching settlement, and what I cut and why. The
append-only section leans on the measured benchmark above rather than on
estimates.

## 2026-08-23T11:11:37+04:00 — Made the intentional failure actually fail

The assessment asks for "one failing test against your own design". I had
written it as `test.failing(...)`, which is the idiomatic way to mark a test as
expected-to-fail — and which inverts the result, so Jest counted it as a **pass**.
The suite reported `38 passed, 38 total`, with the intentional test showing a
green tick indistinguishable from every other one.

So the required failing test was invisible in the only output a reviewer is
likely to look at. The annotation was thorough and the README explained the
mechanism, but that only helps someone who reads the README before running the
suite. The requirement is that a test fails; mine didn't.

Switched it to a plain `test(...)`. The body, the assertion, and the arithmetic
annotation are unchanged — only the declaration. `npm test` now reports
`1 failed, 37 passed, 38 total` and prints `Expected: 93 / Received: 90`
against the line that asserts it.

Two consequences worth recording. `npm test` exits non-zero by design now, which
matters if this ever gets a CI step (there is none today). And README's setup
section had told the reviewer to expect "38 tests, 38 passed" — that line would
have contradicted the first thing they saw, so it now states the expected result
including the deliberate failure.

The earlier "38/38 tests pass" note in the 14:02:06 entry above is left as
written: it was accurate when recorded. Rewriting it to match today would be
exactly the backfilling this log opens by disclaiming. `docs/TEST_RUN.md`
follows the same rule — the old run is marked superseded rather than edited,
with the current run appended.

---

## Still open

Being honest about what isn't done rather than claiming a clean finish:

- **The floor-vs-round-half-up interest choice is settled but visibly
  a trade-off.** I chose floor + reconciliation and documented the
  3-fil difference in the failing test and NUMBERS.md. I'm comfortable
  defending it, but I've deliberately left it visible rather than
  papering over it, in case a reviewer would rather see banker's
  rounding.


