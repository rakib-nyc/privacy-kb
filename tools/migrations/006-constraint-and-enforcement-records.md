# Migration 006 — three record types the corpus cannot currently express

**Status:** PROPOSED, then APPLIED 2026-08-20 on owner instruction ("8 ordinary extractions and 4
scheme get it done").
**Raised by:** the last four manifest lines that are not extraction work.

## What cannot be recorded today

| Manifest line | Why no existing type fits |
|---|---|
| FTC consent decrees as authority | An `authority` record describes a regulator's *powers*. A consent decree is a *doctrinal rule* extracted from a settlement — binding on one party, persuasive as to everyone, and `authority_tier: enforcement_action` already exists in the vocabulary with no record type behind it. |
| M&A due diligence; BYOD | No single statute. The constraint is assembled from several instruments plus practice. `obligation` requires a `verbatim_span` from one source. |
| Fourth Amendment / *Carpenter*; Dormant Commerce Clause; *Sorrell* | Constitutional doctrine. It constrains what other instruments may do, and it has no `paragraph_path` in any code. |

`taxonomy` would hold all three and would be wrong: these are not classifications. `interaction` is
nearer for the third but does not fit the first two.

## The three types

**`enforcement_action`** — a consent decree or settlement, with the doctrinal rule it establishes.
Required: `doctrinal_rule`, `parties`, `date`, `precedential_weight`, plus the standard source
block. Invariant I7 already forbids blending it into a statutory citation, and this makes that
enforceable rather than advisory.

**`workflow_constraint`** — a scenario with no single governing instrument. Required: `scenario`,
`constraints[]` (each naming the record it derives from), `sources[]`. Every constraint must point
at an existing record id, so a workflow cannot invent an obligation: it composes ones already
verified.

**`doctrine`** — a constitutional or common-law rule that constrains other instruments. Required:
`doctrine_statement`, `source_authority` (the case or clause), `constrains[]` (instrument ids it
limits), `status`. It carries NO `paragraph_path`, because there is no paragraph — and that is
exactly why it must be a separate type rather than an obligation with fields left null.

## Gate consequences

- **Gate 6** (taxonomy anchoring) applies to all three; they take coordinates like any record.
- **Gate 3** applies to `enforcement_action` (a decree has a text) and to `doctrine` where the
  source is a constitutional clause; it is **INAPPLICABLE-BY-DESIGN** for `workflow_constraint`,
  which quotes nothing of its own — declared in `meta/gate-applicability.yaml` rather than silently
  skipped, per the lesson of gate 32.
- **Gate 23/30** (paragraph paths) do not apply to `doctrine` or `workflow_constraint`; both are
  recorded as declined examinations with reason `record-carries-no-paragraph-path`, which gate 32
  already accepts.
- **New gate 36**: a `workflow_constraint`'s `constraints[].from_record` must resolve to a record
  that exists — otherwise a workflow can assert a duty nothing backs.
- **New gate 37**: a `doctrine` record's `constrains[]` must name instruments that exist, and it
  may not carry `obligation_type` — a doctrine is not a duty, and letting it wear one would put
  *Carpenter* in an obligations list.

## Reversibility

Additive. Three new schema files, two new gates, one `gate-applicability` block. No existing record
changes shape.
