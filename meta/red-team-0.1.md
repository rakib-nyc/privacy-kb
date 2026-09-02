# QA / red-team findings — 0.1

## QA-01  CRITICAL — verbatim_span is never correlated with its own paragraph_path
Gate 3 checks the span is a substring of THE WHOLE SOURCE. Gate 23 checks the path resolves to
exactly one leaf. Gate 38 hashes that leaf. NOTHING checks the span is inside the leaf it cites.
PROVEN: rewrote ny.gbl.1501.1 to quote § 1501(5)'s text while keeping citation § 1501(1) and
path ['1'] — all 38 gates pass. Same class as the § 250.00 defect that needed a human re-read.

## QA-02  CRITICAL — meaning-inverting truncation is unguarded
Gate 3 accepts ANY substring. Cutting a span at "unless"/"except"/"provided that" yields a
genuinely verbatim quotation that states the opposite rule. PROVEN on ny.gbl.1502: dropping the
consent limb passed every structural gate. It was caught ONLY because gate 35 noticed that the
atom's own requirement_detail quoted the removed words — coincidence, not a guard. A record
whose prose does not quote the dropped clause truncates freely.

## QA-03  MAJOR — privacy_coverage surfaces I1-suppressed records
Invariant I1: an unverified record "must not be surfaced in any output". privacy_coverage
filters corpus.all with NO surfaceable() filter and returns their ids, so 4 suppressed records
(3 doctrines + 1 enforcement_action) are reported as coverage. It returns ids not spans, so no
unverified TEXT escapes — but the corpus reports itself as covering more than it can answer.

## QA-04  MINOR — stale identifier survived the taxonomy rename
mcp/server.mjs still uses `bok_coordinate` as the privacy_coverage argument name and echoes it
in the response, while every record now carries `subject.domain`. Public API name inconsistent
with the data model, and a leftover of the previous naming.

## QA-05  CRITICAL — as_of is required but never validated; garbage dates silently widen results
analyze() rejects a MISSING as_of but accepts any non-empty string. Comparisons are
lexicographic (`a.effective_from > asOf`), so 'not-a-date' or 'zzz' sorts above every ISO date
and EVERY record resolves as in force. PROVEN: same facts return 5 obligations for '2026-01-01'
and 7 for 'not-a-date' — the extra two are SAFE for Kids records that do not bind until
2027-01-25. A typo in a date silently returns law that is not yet in force. Directly violates I2.
Numbers (as_of: 20260101) are likewise accepted.

## QA-06  MODERATE — ratchets are self-declared and can be relaxed without a trace
gate 34's allowance lives in meta/coverage.yaml, gate 35's ALLOW is a literal in validate.mjs,
gate 8's floor is evals/baseline.json which `--baseline` regenerates. Each may be loosened by
editing one number, and NOTHING requires a reason to be recorded when it goes the wrong way.
The gates catch silent regression; they do not catch a deliberate, undocumented relaxation.

## QA-07  MINOR — related[] accepts arbitrary objects that are silently ignored
No items schema. gate 10 resolves `typeof r === 'string' ? r : r?.id` and filters falsy, so
`related: [{garbage: 1}]` passes every gate while recording a cross-reference that points at
nothing. Same shape for open_questions[] and amendment_history[].

## QA-08  MAJOR — identical provision text surfaces twice as two obligations
us.usc.15.45.a1.deception and us.usc.15.45.a1.public_commitment_deception share the same
citation, the same paragraph_path, and a byte-identical verbatim_span. B's predicate is a strict
superset of A's, so whenever a public privacy commitment exists BOTH fire and the reader sees
§ 5(a)(1) quoted twice as two separate duties. Nothing detects two records quoting one provision.

## QA-09  MAJOR — exemption predicates speak fact keys nothing else in the system uses
64 of 69 distinct fact keys appearing in exemption predicates appear in NO atom predicate and NO
eval scenario. The machinery works (partial_carve_out does surface), but a caller has no way to
learn these keys exist: they are not in any example, any eval, or any atom. In practice the
carve-out silently never fires. Gate 21 checks evaluability, 28 the namespace, 29 satisfiability
— nothing checks the key is one the rest of the system actually speaks.

## QA-10  MINOR — computeDeadline is not total, unlike analyze()
Throws TypeError on an atom lacking source.citation. analyze() is explicitly total on hostile
input and property-tested for it; the deadline path is not, and nothing tests it.

## QA-11  MODERATE — "business days" means weekdays; public holidays are not excluded, and this is undeclared
A 10-business-day clock from 2026-12-24 returns 2027-01-07, counting Christmas Day and New
Year's Day as business days. The error direction is conservative (earlier than the true
deadline), but the engine returns a bare computed date with no statement of the approximation,
and "holiday" appears nowhere in the engine, SCHEMA.md or BRIEF.md.

## QA-12  MODERATE — 8 ledger rows point at files that no longer exist
The third-party purge deleted the documents but left their meta/sources.yaml rows. Gate 33 only
checks the other direction (a cited raw_file must be in the ledger), so dangling rows are
invisible. The ledger overstates what the repository holds.

## QA-13  MODERATE — 5 fetched raw files are in no ledger row
corpus/federal/authorities/raw/{12-u-s-c-5564,15-u-s-c-46,15-u-s-c-57a,42-u-s-c-1320d-6,
47-u-s-c-503}.xml sit on disk with no provenance entry. Gate 33 only examines files that an atom
CITES, so a fetched-but-uncited source is untracked — contrary to the Phase 0 rule that every
fetch is logged.

## QA-14  MAJOR — 11 of 38 gates have no fixture, and the README claims otherwise
Never exercised: gates 8, 19, 22, 31, 32, 33, 34, 35, 36, 37, 38. That includes gate 38 (added
this session), and 33/34/35 — the corpus-wide integrity ratchets. README.md states "51 fixtures
— one fixture per gate, each tripping exactly the gate it names", which is not true. A gate with
no fixture is a gate nobody has proven fires.

## QA-15  MINOR — malformed JSON-RPC is silently dropped
A garbage line produces no response at all. JSON-RPC requires a -32700 Parse error object. A
client waiting on a reply hangs rather than learning it sent nonsense.

## QA-05b — the as_of hole reaches the product surface
privacy_analyze via MCP with as_of:"not-a-date" returns a full analysis object rather than
refusing, so QA-05 is not merely an internal API wart.

## QA-16  MAJOR — gate 22 does not exist
It is listed in ALL_GATES and declared format_independent, and has ZERO bump(22) and ZERO
fail(22) anywhere in validate.mjs. It has printed `g22:0(examined)` on every run since it was
introduced and nothing flagged it. The advertised gate count of 38 includes one number with no
implementation behind it. A gate that examines nothing is indistinguishable from a gate that
passes — which is the exact failure gate 32 was built to prevent, occurring one level up on
gate 32's own list.

# ROUND 3 — surfaces not reached in round 1

## QA-17  CRITICAL — a malformed predicate passed all 42 gates and could never be true
The literal parser ended `return t`, so an unrecognised right-hand side became a bare STRING to
compare against. `entity.x == true || nonsense(` compared entity.x to the literal text
"true || nonsense(": grammatical, evaluable, satisfiable, and permanently false. Gate 21 probed
only EXEMPTION predicates, so a record's own applies_if was never asked. Closed three ways: the
parser refuses an unrecognised RHS; the shape is now checked BEFORE the fact lookup (an UNKNOWN
left-hand side used to return first, so gate 21's empty-facts probe never reached the RHS); and
gate 21 now probes applies_if as well as exemptions. Fixture gate21-malformed-predicate.

## QA-18  MODERATE — preemption resolve() was not total
Threw on a null record, the same class as QA-10. Now returns an unresolved verdict.

## QA-19  MAJOR — an unrecognised preemption posture resolved to "no displacement"
`case 'none': default:` shared a branch, so a typo, or a posture added to the schema and not to
the switch, returned the MOST PERMISSIVE answer available: state law survives, nothing is
displaced. That is the one direction a preemption engine must never guess in. Unknown postures
now return outcome:'unresolved' and say they are not a finding of no preemption.

## QA-20  MODERATE — all four workflows threw on a null argument
They destructure their options object in the parameter list, and a default covers undefined
only. The outermost surface a caller touches was the only layer with no totality test. All four
now normalise the argument and return an INCOMPLETE artifact, which is what they already did for
an empty one. Pinned by 40 assertions in workflows/test-workflows.mjs.

## QA-21  CRITICAL — the MCP layer dropped three of six fact namespaces
privacy_analyze forwarded entity, data and event and silently dropped practice, purpose and law.
74 of 248 records carry at least one predicate on a dropped namespace, so through the PRODUCT
SURFACE those predicates could never be true — including
practice.notified_hhs_secretary_of_breach, the trigger for the earliest deadline in the worked
example on the front page. privacy_applicable was worse: it dropped state_layers, include_pending
and event as well. Found while building the CLI, because the demo's headline result would not
reproduce through the server a user would actually run. DEBT-009's shape at the outermost layer.
Closed by a single ctx() builder used by every handler, schema declarations for the three
namespaces, and 7 assertions in mcp/test-mcp.mjs — six that each namespace is forwarded, one
end-to-end proving a practice.* predicate can be satisfied through the tool boundary.

## QA-22  MAJOR — `privacy-kb cite` was broken and exited 0 while broken
It passed record_id/id to a tool whose parameter is atom_id, so every invocation printed
'no record with id "undefined"' — and still exited 0, so a smoke test checking exit codes
reported it green. It also mapped the response as source.url/source.fetched when the shape is
flat (source_url/fetched/raw_sha256), which printed "source: n/a" — removing the one field that
makes the standing instruction "check it against the primary source" possible to follow.
Closed by tests/test-cli.mjs, 17 assertions, every one on OUTPUT rather than exit status.

## QA-23  MODERATE — the front-page headline date crossed a federal holiday
The example used a 2 September 2026 breach, so the five-business-day clock ran across Labor Day
(7 September 2026). The engine counts business days as WEEKDAYS and declares that in
business_day_basis, but the README and the diagram showed a bare "Sep 9" — a figure that needed
an asterisk. Moved the scenario to 8 September, where no clock crosses a holiday and every
published figure is exactly correct, and stated the limitation explicitly rather than relying on
the caveat field.

## QA-24  MINOR — documentation asserted things not checked
A fabricated Node version in sample output; macOS menu paths that vary by OS version; a Claude
Desktop icon described by shape. Replaced with version-robust instructions and checks the reader
can actually run. All published numeric claims (248 records, 42 gates, 56 fixtures, 31 exercised,
11 declared, 30 evals) re-verified against the live repository; all six matched.
