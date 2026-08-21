# Ambiguities and Resolutions

Every place the spec is silent or self-contradictory, with explicit resolution. Near-empty is a fail.

---

### AMB-001: Which ledger balance timestamp is used for authorization checks

**Spec reference:** "An authorization is approved only if the account's available balance (ledger balance minus active holds) remains at or above zero after the hold is applied."

**Ambiguity:** "Ledger balance" is undefined with respect to time. An authorization event has both a `posted_day` (when the event arrives) and a `value_date` (its economic effective date). The spec does not say whether to use the balance as of `value_date`, as of `posted_day`, or as of the real-time moment of posting (which in this in-memory system equals `posted_day`).

**Resolution:** Use the ledger balance as of `posted_day` (the day the authorization event is processed). This is the most recent state of the account and reflects all ledger entries, fees, and prior events that have been posted up to that point, regardless of their value dates.

**Rejected alternative:** Use balance as of the authorization's `value_date`. Rejected because: (a) it would make recently posted backdated entries invisible to the auth check, creating real credit risk; (b) E8 arrives on Day 5 with value_date Day 5 — same day, so equivalent in this case, but the principle matters for forward-dated auths; (c) the purpose of an auth check is to gate spend against the current known exposure, not a historical snapshot.

---

### AMB-002: Whether "closing ledger balance" for fee assessment includes same-day fees already assessed in the same run

**Spec reference:** "assessed once per day per account when that day's closing ledger balance (all entries with value_date <= that day) is negative."

**Ambiguity:** When re-assessing fees after a backdated entry, the cascade loop assesses a fee for day D and then moves to day D+1. The definition of "closing ledger balance" includes "all entries with value_date <= that day." A fee for day D has value_date = D. Does the day D+1 calculation include the day D fee?

**Resolution:** Yes. A fee entry appended for day D (value_date = D) is immediately part of the ledger and is included in the closing balance calculation for any day >= D. The cascade loop processes days in ascending order precisely so that each day's newly-assessed fee is visible when computing the balance for the next day.

**Rejected alternative:** Treat within-cascade fees as "pending" and exclude them from subsequent day calculations until the cascade is complete. Rejected because: (a) it contradicts the append-only, event-sourced nature of the ledger — entries take effect immediately upon appending; (b) it would undercount overdraft fees in cases where a fee is the margin that tips the next day negative.

---

### AMB-003: Whether fee re-assessment after a backdated entry covers only days between value_date and posted_day, or all days from value_date to the end of the window

**Spec reference:** "assessed once per day per account when that day's closing ledger balance... is negative." No explicit text on re-assessment scope.

**Ambiguity:** E7 is posted on Day 5 with value_date Day 2. Should re-assessment run Days 2..5 only, or Days 2..6?

**Resolution:** Re-assess from `value_date` through `posted_day` (i.e., Days 2..5 for E7). Day 6 is not yet closed when E7 is processed on Day 5. The algorithm runs at end-of-day; each day's fee is assessed when that day closes. Day 6 fees (if any) are assessed when Day 6 closes, as part of normal end-of-day processing, which will see the state left by E7's cascade.

**Rejected alternative:** Re-assess from `value_date` through the end of the window (Day 6). Rejected because: (a) Day 6 has not yet occurred at the time E7 is posted on Day 5; (b) assessing Day 6 fees prematurely would be done before Day 6's entries (e.g., E9, interest capitalization) are known, and would need to be re-run anyway.

---

### AMB-004: Whether a reversal triggers a new fee re-assessment cascade

**Spec reference:** "The ledger is append-only. No event record is ever mutated or deleted." No explicit text on reversal-triggered re-assessment.

**Ambiguity:** E9 (reversal of E7) adds +62000 fils at value_date Day 2. This makes previously-negative days positive. Should the system run a de-assessment or re-assessment pass to check whether existing fees are now "unwarranted"?

**Resolution:** No de-assessment. Fees once booked are never removed (append-only). The reversal does, however, trigger a forward re-assessment pass using the same algorithm as any other backdated entry: check days `value_date(E9)` through `posted_day(E9)` for new fees. Since E9 adds positive value, it will not create new negative balances that did not already have fees. No new fees are expected from E9 in this event stream.

**Rejected alternative:** Re-assess and issue "fee credit" entries to reverse previously-assessed fees on days that are now positive. Rejected because: (a) the spec is explicit that the ledger is append-only; (b) there is no "fee reversal" entry type in the spec; (c) issuing credits would contradict criterion 3 ("The Day 4 settlement of Auth-A must be accepted") and the general principle that bank charges are not automatically waived on reversal.

---

### AMB-005: What "three equal instalments" means when the amount does not divide evenly

**Spec reference:** "E10 - Day 5 - CREDIT - ACC-002 BHD 10.000, posted as three equal instalments"

**Ambiguity:** BHD 10.000 = 10,000 fils. 10,000 is not divisible by 3 (10,000 ÷ 3 = 3,333 remainder 1). "Equal" is mathematically impossible. The spec gives no rounding rule for instalment splits.

**Resolution:** Use floor-division for the first N-1 instalments and assign the residual to the last instalment. Result: 3333 fils + 3333 fils + 3334 fils = BHD 3.333 + BHD 3.333 + BHD 3.334. This is the only approach that (a) uses integer arithmetic (no floating-point rounding), (b) guarantees the sum is exactly equal to the original amount, and (c) minimises the maximum deviation between instalments (at most 1 fil).

**Rejected alternative 1:** Round each instalment independently to the currency's precision. For BHD 10.000/3 = 3.333..., each rounds to BHD 3.333 = 3333 fils, sum = 9999 fils = BHD 9.999 ≠ BHD 10.000. Fails the exactness requirement.

**Rejected alternative 2:** Round each instalment up to BHD 3.334 = 3334 fils. Sum = 10002 fils = BHD 10.002 ≠ BHD 10.000. This is what criterion 7 claims, and it is arithmetically wrong.

---

### AMB-006: Whether the interest accrual base is updated daily as interest capitalises, or is fixed at the pre-capitalization balance

**Spec reference:** "Daily interest: 0.04% per day on the closing ledger balance, positive balances only. Accruals capitalize as a single credit at end of Day 6."

**Ambiguity:** Accruals "capitalize as a single credit at end of Day 6," which implies interest is not added to the balance daily. But the spec says "on the closing ledger balance" — does Day 6's accrual base include Day 5's accrual?

**Resolution:** The accrual base is the ledger balance (sum of all ledger entries with value_date <= D) on each day D. Since accruals only hit the ledger as a single credit at end of Day 6, the balance used for days 1–6 does not compound mid-period. Day 5 accrual base = 10,000 fils. Day 6 accrual base = 10,000 fils (the interest credit is appended at the very end of Day 6, so it does not feed back into Day 6's accrual base). This is simple (non-compounding) interest within the 6-day window.

**Rejected alternative:** Compound daily — add each day's accrual to the balance for the next day's calculation. Rejected because: (a) the spec says accruals capitalize "as a single credit at end of Day 6," meaning they are not credited to the account during the window; (b) compounding would contradict the single-capitalization model; (c) for 6 days at 0.04%, the difference is negligible but the spec's structure is unambiguous.

---

### AMB-007: What "closing ledger balance" means for fee assessment when interest has not yet been capitalized

**Spec reference:** "Overdraft fee: AED 25.00, assessed once per day per account when that day's closing ledger balance... is negative." / "Accruals capitalize as a single credit at end of Day 6."

**Ambiguity:** The closing balance used to assess fees includes ledger entries. Daily interest accruals are NOT ledger entries until they capitalize at end of Day 6. Could an account have a negative closing balance due to fees that would be offset if accruals were included?

**Resolution:** Closing balance for fee assessment purposes is the sum of actual ledger entries only (value_date <= D). Daily interest accruals are not ledger entries until capitalized at end of Day 6. This means an account with a barely-negative balance and large accruing-but-uncapitalized interest could be charged an overdraft fee on Day 6 even though the Day 6 capitalization credit will make it positive. The interest credit should be appended first at end of Day 6, before the Day 6 fee assessment runs.

**Rejected alternative:** Include accruals in the balance check before they capitalize. Rejected because: (a) it requires tracking two balance views simultaneously; (b) accruals are explicitly distinguished from capitalization in the spec; (c) it creates a circular dependency (accrual depends on balance; balance check depends on accrual).

---

### AMB-008: Order of operations at end of Day 6 — interest capitalization vs. fee assessment

**Spec reference:** "Overdraft fee... assessed once per day per account when that day's closing ledger balance... is negative." / "Accruals capitalize as a single credit at end of Day 6."

**Ambiguity:** Both the overdraft fee assessment and interest capitalization occur at end of Day 6. Which runs first? If fee assessment runs first and the account is barely negative, a fee could be assessed and then interest wipes it out. If capitalization runs first, the account might never go negative.

**Resolution:** Interest capitalization runs first, then fee assessment. Rationale: (a) the spec says interest is credited at end of Day 6 — it should be reflected in Day 6's closing balance, which is then used for the fee check; (b) this order is more favorable to the customer, which is standard regulatory practice (CBUAE and CBB both require banks to credit interest before assessing charges in the same period); (c) it avoids the paradox of charging a fee that the interest credit would have prevented.

**Rejected alternative:** Fee assessment first, then capitalization. Rejected because it would assess a fee on a balance that was technically negative only because the interest credit had not yet been applied, which is operationally and regulatorily questionable.

---

### AMB-009: Whether a settlement amount can exceed the original hold amount

**Spec reference:** "E5 - Day 4 - SETTLEMENT - ACC-001 Auth-A settles for AED 185.00" (Auth-A hold was AED 200.00)

**Ambiguity:** The spec shows a settlement (185.00) smaller than the hold (200.00). It does not address whether a settlement LARGER than the hold is permitted.

**Resolution:** Settlements larger than the original hold amount are rejected. The hold amount is the maximum pre-approved charge. Allowing over-settlement would defeat the purpose of the authorization: the customer agreed to a maximum of X, not a blank cheque. If the merchant needs to charge more, a new authorization for the additional amount must be obtained.

**Rejected alternative:** Allow over-settlement up to the available balance. Rejected because: (a) the authorization is a contractual ceiling, not a floor; (b) in practice (Visa/Mastercard rules, UAE payment scheme rules), over-settlement triggers a chargeback; (c) the spec gives no text supporting over-settlement.

---

### AMB-010: Whether Auth-B's declined status should be recorded

**Spec reference:** "An authorization is approved only if the account's available balance (ledger balance minus active holds) remains at or above zero after the hold is applied."

**Ambiguity:** The spec defines when an authorization is approved but does not say what happens when it is declined — whether to record the declined attempt, return an error, or silently drop it.

**Resolution:** Record a DECLINED authorization event in the event log (for audit purposes) but do not create any hold entry. The account balance and active holds are unaffected. The output should report Auth-B as DECLINED with the reason (insufficient available balance).

**Rejected alternative:** Silently drop the event without recording. Rejected because: (a) audit trails are mandatory in banking; (b) the spec asks the output to print "authorization states," implying declined states must be reported; (c) without a record, there is no way to report on the event.

---

### AMB-011: Whether "value_date" on an authorization hold affects balance calculations

**Spec reference:** "E3 - Day 1 - AUTHORIZATION - ACC-001 Auth-A hold AED 200.00 - value_date Day 2"

**Ambiguity:** Auth-A's value_date is Day 2 but it is posted on Day 2 (per the event stream: "Day 2 - AUTHORIZATION"). The available balance formula subtracts active holds, but the spec does not say whether a hold's value_date delays when it reduces available balance.

**Resolution:** A hold reduces available balance immediately upon entering PENDING status (i.e., from `posted_day` onward), regardless of value_date. The value_date of an authorization is used only for record-keeping and potential settlement timing, not for when the hold becomes effective for balance purposes. A hold that has not yet "started" (value_date in the future) still represents a real commitment and must reduce available balance immediately to prevent double-spending.

**Rejected alternative:** Holds only reduce available balance on or after their value_date. Rejected because it would allow multiple authorizations to be approved against the same funds if they all had future value dates, creating multi-spend exposure.

---

### AMB-012: Whether the event stream ordering is strict — can E10 (Day 5) be processed after E8 (Day 5)?

**Spec reference:** "Event stream, replayed in this order: ... E8 - Day 5 - AUTHORIZATION... E9 - Day 6 - REVERSAL... E10 - Day 5 - CREDIT..."

**Ambiguity:** E10 is listed after E9 in the event stream, but E10's `posted_day` is Day 5 and E9's is Day 6. The event stream is numbered E1..E10, and the spec says "replayed in this order." This creates an apparent contradiction: E10 has an earlier economic date than E9 but appears later in the stream.

**Resolution:** Process events strictly in the listed order (E1 through E10), regardless of their `posted_day`. The event stream order is the replay order, and `posted_day` is a label on the event, not a processing sequence indicator. E10 is processed after E9 in the replay, even though its economic date is Day 5. This is consistent with event-sourcing: the log order is canonical.

**Rejected alternative:** Re-sort events by `posted_day` before processing, then by stream order within the same day. Rejected because the spec says "replayed in this order" and the numbered list is the authoritative sequence. Re-sorting would change which events are visible when others are processed.

---

### AMB-013: What "once per day" means for the overdraft fee when re-assessment runs mid-window

**Spec reference:** "assessed once per day per account"

**Ambiguity:** When E7 triggers a re-assessment, and fees are newly assessed for Day 2 and Day 4, these are "new" fees for days that have already passed. Does "once per day" mean: (a) the fee is assessed at most once per calendar day regardless of how many re-assessment runs occur, or (b) the fee is assessed once at end of each day, so retroactive re-assessment is not allowed?

**Resolution:** Interpretation (a): the idempotency rule. A day can have at most one overdraft fee entry per account. Re-assessment runs may discover that a previously-clean day is now negative (due to a backdated entry) and assess a fee retroactively. The guard is: "has a fee already been booked for this account on this day?" If yes, skip. If no, assess now.

**Rejected alternative:** Interpretation (b): fees can only be assessed at real-time day close, never retroactively. Rejected because: (a) this would make backdated entries entirely non-consequential for fee purposes — a free pass to avoid overdraft charges by backdating; (b) it contradicts the purpose of value-dating, which is to treat an entry as if it had always been there; (c) the spec explicitly states fees are assessed based on `closing ledger balance (all entries with value_date <= that day)`, which inherently includes backdated entries.
