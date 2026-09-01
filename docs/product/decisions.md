# Product Decisions

## Crocoblock-native-first — ACCEPTED

CSF owns business semantics, policy, verification requirements, and recovery
acceptance. A suitable Crocoblock-native mechanism is preferred after an
explicit fitness check. Custom implementation is permitted only when that
check demonstrates that native capability is insufficient.

## First Site Change Contract boundary

`add_optional_viewing_date@1` is the only approved change-profile in this
contract. It specifies a provider-neutral optional preferred viewing date for
the existing Request Viewing form and preserves its existing identity, contact,
content, and surface invariants.

The profile is a specification. Its classifier consumes supplied semantic
facts only and returns applicability classification; it is not execution
authority, runtime readiness, delivery evidence, or a proof result. Recovery
and verification statements are future lifecycle requirements, not snapshot,
restore, transaction, or Proof Gate implementation.

## Real Estate capability freeze after Slice 4

Real Estate semantic capabilities are frozen after Slice 4. An exception
requires a demonstrated blocker in the first Site Transaction and separately
approved scope. Phase 1 remains ordered as Phase 1 → Site Transaction → Proof
Gate. This decision does not close Phase 1 before independent Review and the
Planning checkpoint.
