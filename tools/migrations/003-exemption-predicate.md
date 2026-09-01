# Migration 003 — exemptions gain a predicate

**Forced by:** DEBT-009. The exemption object had `additionalProperties: false` and no field
for a predicate, while `engine/exemptions.mjs` reads `ex.applies_if`. The schema won, so
**every exemption evaluated UNKNOWN and was never applied.** Invariant I4 — the one BRIEF.md
says makes the tool worthless if wrong — could not fire at all.

**Change:** add `applies_if` to the exemption object, and make it **required**. An exemption
without a predicate is not a partial record; it is an inert one.

**Records requiring transformation:** the two GBL § 349 exemptions gain predicates. No other
record carries an exemption.

**Why three green signals hid it.** The engine implemented I4, the property tests passed, and
the schema validated. All three were true and the capability still could not fire, because
the property tests constructed exemption objects **carrying `applies_if`** — objects the
schema would have rejected. They proved a function works on input the corpus can never
contain. That is the difference between testing a function and testing a system.

**Gate 21** — an exemption without an evaluable predicate is flagged. Narrow, and it would
have caught this on day one.

**Gate 22** — the general form, and the more valuable one: walk every field the engine reads
off a record and assert the schema guarantees it. Any engine read the schema does not
require is a defect of exactly this shape. Engine and schema were built in separate
sessions; this is where that seam leaks.
