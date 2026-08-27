# Crocoblock Site Factory - Agent Instructions

## Project

Crocoblock Site Factory (CSF) is an AI control plane for creating,
changing, verifying, recovering, and eventually publishing dynamic
WordPress/Crocoblock business sites.

CSF owns product semantics, policy, transaction authority, recovery,
and proof. Low-level runtimes, WordPress/Crocoblock APIs, builders,
and deployment systems are execution layers.

Do not redesign this product architecture as part of an unrelated task.

## Task Authority

The current user/task prompt defines the active implementation slice.

Work only inside that slice.

Do not independently:
- expand scope;
- start adjacent roadmap work;
- redesign architecture;
- perform opportunistic refactors;
- implement unrelated improvements discovered while working.

If the requested slice cannot be completed safely without a materially
larger change, stop and report:
1. the blocker;
2. the smallest viable solution;
3. the broader alternative;
4. the trade-off.

Wait for a new planning decision before broadening the work.

## WIP

Mainline WIP is 1.

Do not begin another product slice while the current slice is active.

Research or disposable experiments are allowed only when explicitly
requested by the current task.

## Git Safety

Before modifying files, inspect:
- current branch;
- HEAD;
- working-tree status;
- staged changes.

Treat pre-existing user work as protected.

Never discard, overwrite, normalize, stage, or commit unrelated changes.

Do not run destructive Git commands such as:
- `git reset --hard`;
- `git clean`;
- commands that overwrite user changes.

Do not stash user work unless explicitly requested.

Do not create a commit unless the user explicitly authorizes it.

Do not push unless the user explicitly authorizes it.

When commit authorization is given, stage only the accepted slice.
Never use broad staging such as `git add .` when unrelated changes exist.

## Scope Discipline

Make the smallest change that satisfies the accepted task contract.

Do not modify unrelated files for:
- formatting;
- cleanup;
- renaming;
- modernization;
- dependency updates;
- architectural consistency;

unless the task explicitly requires those changes.

If repository state makes slice ownership ambiguous, stop and report
the ambiguity instead of guessing.

## Validation

Use risk-based validation.

FAST changes:
- focused validation appropriate to the changed behavior.

STANDARD changes:
- focused tests;
- related regression coverage;
- syntax/static checks when applicable;
- `git diff --check`.

CRITICAL changes include areas such as:
- Recovery;
- Site Transactions;
- database/filesystem mutation;
- authentication/security;
- RuntimeProvider;
- Studio/MCP/provider mutation boundaries;
- installer;
- deployment;
- migration.

For CRITICAL changes:
- run focused tests;
- run the relevant broader regression suite;
- perform disposable runtime proof when required by the task contract;
- provide evidence for independent review;
- do not commit before the required review/acceptance gate.

A passing test suite does not override a failed acceptance invariant.

## Runtime Safety

Do not perform stateful or destructive runtime operations unless they
are explicitly required by the current task contract.

This includes operations such as:
- restoring a managed site;
- destructive database/filesystem mutation;
- deleting projects;
- destructive cleanup;
- modifying real/non-disposable WordPress environments;
- installing or replacing managed runtime dependencies.

Prefer disposable proof environments when runtime mutation is required.

## Evidence

Do not claim behavior that was not actually verified.

Distinguish:
- code/test evidence;
- runtime evidence;
- product/manual evidence.

If a required proof could not be executed, report it explicitly.

Do not expose secrets, credentials, raw secret material, or sensitive
environment values in reports or proof artifacts.

## Final Handoff

Keep routine handoffs concise.

Report:

### Result
What was completed.

### Changed
Exact changed paths and the purpose of the changes.

### Validation
Tests/checks/runtime proof actually executed and their results.

### Acceptance
Which task acceptance conditions are satisfied or unresolved.

### Git State
Branch, HEAD, staged/dirty state, commit/push status.

### Residual Risks
Only meaningful unresolved risks or blockers.

Do not commit or push unless separately authorized.
