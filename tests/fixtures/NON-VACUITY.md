# Gate non-vacuity

Every gate needs two things: a fixture proving it **fires** on known-bad input, and
an argument that it is **examining a real haystack**. A gate that examines nothing
is indistinguishable from a gate that passes.

`tools/validate.mjs` prints per-gate examination counts on every run
(`examined  g3:41 g8:0 g11:28 g12:6`). Gate 14 is the vacuity gate: it fires when a
check's haystack collapsed.

| Gate | Non-vacuity | Fixture |
|---|---|---|
| 1 schema | **Structural.** ajv compiles the schema at startup; a broken or empty schema throws rather than passing everything. The `pass` fixture proves the validator reaches records at all. | `pass` |
| 2 hash | **Fail-safe.** A missing or unreadable `raw_file` fails the gate; there is no state where it silently examines nothing. | `gate2-hash-mismatch` |
| 3 verbatim | **Asserted.** Haystack under 200 chars fires gate 14 — a collapsed rendering would otherwise make every substring check meaningless. Count reported as `g3`. | `nonvacuity3-collapsed-haystack` |
| 4 temporal | **Meaningless.** Pure field comparison, no haystack. | — |
| 5 federal_relationship | **Meaningless.** Pure field presence check. | — |
| 6 taxonomy coordinate | **Fail-safe.** If `coverage.yaml` failed to load, `VALID_COORDS` is empty and every coordinate is rejected. It fires, loudly, rather than passing. | `gate6-nonexistent-leaf` |
| 7 deadline | **Meaningless.** Pure field presence check. | — |
| 8 evals | **Asserted.** The gate executes `evals/runner.mjs` rather than reading a file that may be stale, and fails if the runner does not run or writes nothing. Scenario count is reported and may not fall below baseline — deleting a failing scenario is caught. | `evals/runner.mjs` exit path |
| 9 principle/scheme | **Meaningless.** Pure field comparison. | `gate9-binding-no-tier`, `gate9-framework-claims-adherence` |
| 10 references | **Fail-safe.** An empty `known` set makes every reference unresolvable, so the gate fires rather than passing. | `gate10-dangling-xref` |
| 11 dual render | **Asserted.** Before comparing spans: the independent rendering must exceed 200 chars, and the two renderings must be within a 0.5 size ratio. Observed ratios across this corpus are 0.88–0.97. This is the `min_height` lesson — a parameter that erased the alt rendering would have left the gate comparing spans against an empty string while its FIRES fixture stayed green. Count reported as `g11`. | `nonvacuity11-empty-alt-render` |
| 12 visual | **Asserted by construction.** The gate's failure condition *is* insufficient examination: fewer than three logged checks fires it. Count reported as `g12`. | `gate12-no-visual-check` |
| 13 anchoring | **Meaningless.** Pure field presence check. | `gate13-unanchored-no-justification` |
| 14 vacuity | The gate that makes the others non-vacuous. Fires when a haystack collapsed. | both `nonvacuity*` fixtures |

**Gate 11 now covers structured sources too, and it is a STANDING GUARD.** For XML and
HTML it runs `tools/dual-parse.py`: two engines compared on serialized text **and** an
identifier inventory. It is not a validation exercise to be run once and retired. The
`.tail` failure — removing an element silently deletes the text that followed it — is a
property of tree-walking serializers in general, not of footnotes in particular, so every
structured extraction is exposed to it permanently. `tools/test-dual-parse.py` freezes both
historical failure directions found on 15 U.S.C. § 1681c(f) and runs in CI.

**Gate 11 is exhaustive, not sampled.** Every `pdf_*` span is checked, because you cannot
predict from a document's shape whether a renderer fault manifests in it: the APEC Privacy
Framework sets its subparagraph markers on the same baseline as their text and hid the
identical bug through an entire instrument, while the Global CBPR Framework exposed it
immediately. Gate 12 is sampled — it needs a human or model in the loop — which is exactly
why gate 11 must not be.
