# Migration 002 — `openleg_json` source format

**Forced by:** the New York layer. `nysenate.gov` is Cloudflare-blocked; the NY Senate
OpenLegislation API is the acquisition path, and it returns JSON — a format the frozen
`source.format` enum did not contain, so gate 1 rejected every NY atom.

**Change:** add `"openleg_json"` to `source.format` in all five record schemas, and to the
derived `risk_tier` map (low — it is structured data, not a rendering of a page).

**Records requiring transformation:** **none.** Purely additive, the same shape as
migration 001. No existing record carries the new value.

**New tooling this migration requires:**

- `tools/render-text.py` gains `.json` support: extract `result.text` and unescape the
  literal `\n` sequences the API returns.
- `tools/dual-parse.py --format openleg_json`: two independent unescape implementations,
  compared, plus an inventory of the document's identity fields.
- **Gate 20** — repealed-anchor check. The API exposes `repealed: true` on law-tree
  documents (12 of 1592 in General Business). An atom anchored to one quotes repealed law
  as current. Kept separate from gate 17 because its mechanism is a flag on a tree node,
  not a containing region, and folding it in would hide that difference.

**Why the transformation needs guarding at all.** `result.text` contains *literal
backslash-n two-character sequences*, not newlines. Every span requires an unescape before
gate 3 can check it, so there is a transformation between source and quotation — exactly
the class gate 11 exists for. Only one escape type appears in the sampled section (82 × `\n`,
no `\t`, no `\"`), which makes it well bounded. That is not reassurance: `min_height` also
looked well bounded, and it erased a document.

**Verification:** both spike corpora re-run, full gate suite, engine, MCP and workflow
tests, and a non-vacuity assertion that the unescape is complete and reversible.
