# Migration 005 — an entity-level exemption must say how far it reaches

**Status:** APPLIED 2026-08-19.
**Raised by:** DEBT-012, Part B3 (type-adequacy verdict).

## What is broken

Two exemptions in the same instrument are both `entity_level` and mean different things.

| | reach |
|---|---|
| `16 C.F.R. § 313.1(b)` dealer exclusion | the dealer is outside **part 313 entirely** |
| `16 C.F.R. § 313.5(e)(1)` no-disclosure/no-change | the dealer owes **no annual notice**, and remains fully covered by every other provision |

`engine/exemptions.mjs` reports both as *"the instrument does not reach this entity at all"*. That
is true of the first and false of the second.

## Why it has not produced a wrong answer yet

Atom granularity is carrying it. Because atoms are one-per-obligation (PROMPTS.md C1), the
§ 313.5(e) exemption sits on the annual-notice atom and nowhere else, so the engine's **verdict**
per obligation is right — the annual notice is exempt, the other four obligations stay applicable,
which is what the corpus shows and what the evals assert. Only the **sentence** over-claims.

In an artifact whose entire purpose is explaining itself, that is still a defect. And
obligation-scoped relief will get more common, not less: it is how modern rules are drafted.

## The change

Additive, with a conditional requirement.

```diff
 "exemptions": { "items": {
   "properties": {
     "type": {"enum":["entity_level","data_level","activity_level","size_threshold","temporal"]},
+    "reach": {
+      "enum": ["instrument","obligation"],
+      "description":
+        "How far entity-level relief extends. 'instrument' means the entity is outside this
+         instrument altogether (16 C.F.R. § 313.1(b)). 'obligation' means the entity is fully
+         covered and does not owe THIS duty (16 C.F.R. § 313.5(e)(1)). Both are entity_level and
+         the type alone cannot tell them apart, which made the engine's explanation false for
+         the second. data_level and activity_level do not take a reach: they carve out records or
+         conduct, never a duty."
+    }
   },
+  "allOf": [{
+    "if":   {"properties":{"type":{"enum":["entity_level","size_threshold"]}}},
+    "then": {"required":["reach"]}
+  }]
 }}
```

## Engine changes

`applyExemptions` phrases entity-level reasoning from `reach`:

- `instrument` → "the instrument does not reach this entity at all" (unchanged).
- `obligation` → "this entity does not owe THIS obligation. It remains fully covered by the rest of
  the instrument — do not read this as relief from the instrument."

`exempt` stays `true` in both cases, because at atom granularity the atom is the obligation. Only
the explanation changes, and `level` gains a companion field in the returned object.

## Gate changes

**New gate 24**: an `entity_level` or `size_threshold` exemption whose `reach` is `instrument` must
be the *only* exemption of that reach on every atom of its instrument — instrument-wide relief that
appears on one obligation and not its siblings is a transcription error, not a legal distinction.
Fires-fixture: the § 313.1(b) exclusion present on four of five part-313 atoms.

## Alternative considered and rejected

Splitting the enum into `entity_level_instrument` / `entity_level_obligation`. Equivalent in
expressive power, but it invalidates every existing `entity_level` record and forces a rewrite of
`engine/exemptions.mjs`'s branch structure, for no gain over an added field.

## Migration steps

1. Add `reach` plus the conditional requirement to all five schemas.
2. Backfill: `reach: instrument` on `cfr.16.313.1.b.retail_credit_dealer` (5 atoms),
   `reach: obligation` on `cfr.16.313.5.e1.no_disclosure_no_change` (1 atom).
3. Update `engine/exemptions.mjs` reasoning.
4. Add gate 24 and its fixture.
5. Clear the type-adequacy `open_questions` entry on `us.cfr.16.313.5.a1.annual_notice`.
6. `npm test`.

## Reversibility

Reversible by dropping the field, the conditional, gate 24, and the engine branch. Backfilled
values are additive and harmless if the field is removed.

## APPLIED 2026-08-19

Applied to `schemas/atom.schema.json`. Backfilled six exemptions: `reach: instrument` on the
§ 313.1(b) dealer exclusion across five atoms, `reach: obligation` on § 313.5(e)(1).

**The reasoning string changes with the field, which was the point.** `applyExemptions` now emits
one of three sentences, and `analyze()` propagates `reach` onto the exempt entry — without that
the field would have been recorded in the corpus and never reached a reader:

    reach=instrument  "the instrument does not reach this entity at all. Note that this is not
                       necessarily relief from the underlying LAW — an exclusion can allocate
                       the entity to a different regulator's rule."
    reach=obligation  "this entity does not owe THIS obligation. It REMAINS FULLY COVERED by the
                       rest of the instrument — every other notice, opt out and restriction still
                       applies. Do not read this as relief from the instrument."
    (absent)          "exempt, but the exemption declares no reach, so the engine CANNOT say
                       whether the entity is outside the instrument or merely relieved of this
                       duty."

The third case is unreachable through the schema and kept anyway: the engine should refuse rather
than guess if a record ever arrives another way.

Gate 24 added with fixture `gate24-instrument-reach-gap`. Fixture `gate1-entity-level-no-reach`
proves the conditional requirement fires. `gate21-inert-exemption` gained a `reach` so it keeps
testing exactly one thing.
