---
name: csf-build-slice
description: Execute a bounded Crocoblock Site Factory implementation or correction slice from Planning through Git preflight, minimal implementation, risk-based validation, scope verification, and a structured handoff. Use for CSF Build/Implementation work. Do not use for product planning, independent Review/Audit, competitor research, or commit-only tasks.
---

# CSF Build Slice

Execute one accepted Crocoblock Site Factory implementation slice safely and with the smallest sufficient change.

Follow the repository `AGENTS.md` at all times. This skill supplements those standing rules; it does not override them.

## Required Inputs

Before implementation, identify from the current task:

- the intended product/technical outcome;
- acceptance criteria;
- explicit scope and exclusions;
- required tests or runtime proof;
- risk classification when Planning provided one;
- any expected Git baseline or candidate paths.

If a materially necessary input cannot be determined from the task or repository, stop and report the missing decision instead of inventing it.

## 1. Preflight

Before editing:

1. inspect the current branch;
2. record HEAD;
3. inspect staged changes;
4. inspect dirty and untracked paths;
5. compare repository state with the task assumptions.

Treat all pre-existing work as protected.

If repository state creates ambiguous ownership or conflicts with the accepted task contract, stop before modifying files and report the discrepancy.

## 2. Understand the Existing Behavior

Inspect only enough code and tests to understand the requested behavior.

Prefer:

- the directly affected implementation;
- directly related tests;
- relevant contracts or manifests;
- nearby call sites required to understand the boundary.

Do not perform broad repository archaeology unless the task genuinely requires it.

Before editing, identify:

- the current behavior;
- the failed or missing invariant;
- the smallest plausible mutation surface.

## 3. Confirm Risk Level

Use the task's explicit risk classification when provided.

Otherwise classify the slice using the repository rules as:

- FAST;
- STANDARD;
- CRITICAL.

Do not add CRITICAL ceremony to a low-risk change without evidence.

If implementation reveals a substantially higher-risk boundary than the task assumed, stop and report it before crossing that boundary.

## 4. Implement the Smallest Sufficient Change

Make the minimum coherent change that satisfies the acceptance contract.

Prefer:

- existing architecture;
- existing abstractions;
- existing terminology;
- local regression coverage.

Avoid:

- opportunistic cleanup;
- unrelated formatting;
- speculative abstraction;
- future-provider frameworks;
- broad renames;
- dependency upgrades;
- adjacent roadmap work.

If the smallest safe implementation requires a materially broader refactor, stop and report:

1. why the narrow solution is insufficient;
2. the minimal broader option;
3. the larger architectural option;
4. the trade-off.

Do not choose the broader option without Planning approval.

## 5. Add or Update Regression Coverage

Tests should prove the requested invariant, not merely exercise the changed lines.

When correcting a defect:

- reproduce the failing boundary when practical;
- add a regression that would fail before the correction;
- cover important negative/fail-closed behavior when applicable.

Do not weaken an existing assertion merely to make the suite pass unless the acceptance contract explicitly changes that behavior.

## 6. Validate by Risk

### FAST

Run the smallest focused validation that proves the changed behavior.

### STANDARD

Run:

- focused tests;
- related regression tests;
- relevant syntax/static checks when applicable;
- `git diff --check`.

### CRITICAL

Run:

- focused regression tests;
- the relevant broader suite;
- syntax/static checks as applicable;
- `git diff --check`;
- disposable runtime proof when required by the task contract.

Do not substitute synthetic tests for a required real runtime proof.

Do not claim a proof that was not executed.

A passing suite does not override a failed acceptance invariant.

## 7. Verify Scope Before Handoff

Before reporting completion:

1. inspect `git status`;
2. inspect changed path names;
3. inspect the relevant diff;
4. run `git diff --check`;
5. confirm each changed path belongs to the accepted slice.

Separate:

- changes created by this slice;
- protected pre-existing changes;
- generated or disposable evidence.

If ownership is ambiguous, report the ambiguity and do not guess.

Do not stage, commit, or push unless separately authorized.

## 8. Evaluate Acceptance

Check each acceptance condition against actual evidence.

Classify the implementation result as one of:

- READY FOR NEXT GATE;
- PARTIAL;
- BLOCKED.

For a CRITICAL slice, "READY FOR NEXT GATE" normally means ready for independent Review/Audit, not ready to commit.

Do not independently declare a roadmap phase complete.

## 9. Final Handoff

Return a concise report using this structure.

### Result

State what was implemented and whether it is READY FOR NEXT GATE, PARTIAL, or BLOCKED.

### Changed

List exact paths changed by this slice and their purpose.

### Validation

List only checks and proofs actually executed, with results.

### Acceptance

Map the important acceptance conditions to PASS, FAIL, or NOT PROVEN.

### Git State

Report:

- branch;
- HEAD;
- staged state;
- dirty/untracked state;
- commit status;
- push status.

### Residual Risks

Report only meaningful unresolved risks, blockers, or proof gaps.

If no meaningful residual risk remains, say so explicitly.

## Stop Conditions

Stop rather than continuing when:

- scope ownership is ambiguous;
- the Git baseline contradicts the task contract;
- a required destructive action lacks explicit authority;
- a required acceptance condition needs an architectural decision;
- a narrow fix would require material scope expansion;
- required proof cannot be obtained without changing the agreed risk boundary.

This skill never grants commit or push authority.
