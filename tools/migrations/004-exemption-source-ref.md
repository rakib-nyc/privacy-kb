# Migration 004 — an exemption may name its own source

**Status:** APPLIED 2026-08-19.
**Raised by:** DEBT-011, Part B2 (HIPAA covered-entity/PHI split).

## What is broken

The exemption object carries `source_citation` (a free string) and `verbatim_span`, but nothing
that says *which document* the span was quoted from. Gate 3 therefore verifies every exemption
span against the **atom's** `source.raw_file`.

That assumes an exemption is always quoted from the same document as the obligation it qualifies.
US law is not written that way.

    45 C.F.R. § 164.502(a)   the operative HIPAA prohibition          — part 164
    45 C.F.R. § 160.103      the definition of "protected health
                             information", carrying the exclusions
                             that decide most real questions          — part 160

All six spans across the two parked HIPAA atoms are present in `45-cfr-160.txt` and absent from
`45-cfr-164.txt`. Gate 3 refused all six by name. The gate is right; the schema is too narrow.

This is not a HIPAA quirk. It is the normal shape: a statute or definitions part defines, an
operative part obligates. It will recur in FCRA (definitions at 15 U.S.C. § 1681a, duties at
§§ 1681b–1681s) and in GLBA (definitions at 15 U.S.C. § 6809, rule at 16 C.F.R. part 313).

## What is NOT the fix

- **Point the atom at part 160.** Misstates where the obligation lives.
- **Concatenate the raw files.** Fabricates a source artifact no publisher issued, and breaks the
  hash chain back to ecfr.gov.
- **Let gate 3 search every raw file in the corpus.** A span could match an unrelated instrument
  by coincidence, and `source_citation` goes back to being unverified prose. That is the exact
  property gate 3 exists to destroy.

## The change

Additive. Every existing exemption stays valid.

```diff
 "exemptions": { "items": {
   "required": ["id","type","scope","source_citation","verbatim_span","applies_if"],
   "properties": {
     ...
+    "source_ref": {
+      "type": ["object","null"],
+      "additionalProperties": false,
+      "required": ["raw_file","raw_sha256","instrument_id"],
+      "description":
+        "The document this exemption's verbatim_span was quoted from, when it is NOT the atom's
+         own source. Absent means the atom's source. Gate 3 verifies the span against this file.
+         Exists because an exemption is routinely defined somewhere other than the provision it
+         qualifies: 45 C.F.R. § 164.502(a) is obligated in part 164 and excepted in part 160.",
+      "properties": {
+        "raw_file":      {"type":"string"},
+        "raw_sha256":    {"type":"string","pattern":"^[0-9a-f]{64}$"},
+        "instrument_id": {"type":"string"}
+      }
+    }
   }
 }}
```

## Gate changes

- **Gate 3** resolves each exemption span against `source_ref.raw_file` when present, the atom's
  `source.raw_file` otherwise. Unchanged behaviour for every record now in the corpus.
- **Gate 2** hashes `source_ref.raw_file` and compares to `source_ref.raw_sha256`, exactly as it
  already does for the atom's own source. A cross-instrument citation gets the same integrity
  guarantee as a same-instrument one, or it is worth nothing.
- **Gate 22** is unaffected: `source_ref` is read by tooling, not by the engine.
- **New fires-fixture** `gate3-exemption-wrong-source`: an exemption whose `source_ref` points at a
  file that does not contain its span. **Non-vacuity** `gate3-exemption-cross-source`: the same
  span with a `source_ref` that does contain it, which must pass.

## Migration steps

1. Add `source_ref` to the exemption object in all five schemas.
2. Extend gates 2 and 3.
3. Add both fixtures to `tests/fixtures/expected.yaml`.
4. Move `staging/hipaa-privacy-rule/atoms/` back into
   `corpus/federal/domain-2-federal-privacy/hipaa-privacy-rule/`, adding `source_ref` pointing at
   `45-cfr-160.xml` on all six exemptions.
5. `npm test`. Expect 36 fixtures, gate 3 examining 6 more spans.

## Reversibility

Fully reversible: drop the field and the two gate clauses. No existing record is rewritten.

## APPLIED 2026-08-19

Applied to `schemas/atom.schema.json` only. The draft said "all five schemas"; that was
inherited from migration 003's wording and is wrong — only the atom schema carries the
exemption object. Corrected rather than followed.

Gate 3 resolves an exemption span against `source_ref.raw_file` when present, preferring the
rendered `.txt` beside it exactly as the atom's own source does, and gate 2 hashes it. The six
parked HIPAA exemptions moved back into the corpus with `source_ref` pointing at
`45-cfr-160.xml`; gate 2 went 81 -> 87 spans and gate 3 81 -> 87.

Fixtures: `gate3-exemption-wrong-source` (fires), `gate2-exemption-source-hash` (fires),
`gate3-exemption-cross-source` (non-vacuity — the same span against the document that DOES
contain it must pass, or `source_ref` would just be a way to fail every cross-part exemption).
