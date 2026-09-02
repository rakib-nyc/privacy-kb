# Privacy-KB: complete reference

A single document describing what this project is, how it works, what it contains, what it
refuses to do, and where it is weak. Written to be read cold by a person or by another AI system
with no prior context.

**Repository:** https://github.com/rakib-nyc/privacy-kb (private)
**Version:** 0.2.3 · **Licence:** Apache 2.0 · **Author:** Muhammad Rakibul Islam

---

## 0. Read this first

**This is an experimental research project. It is not a legal product, it is not legal advice,
and it carries no warranty of any kind** as to accuracy, completeness, currency or fitness for
any purpose. See `LICENSE` sections 7 and 8, which govern.

**Parts of the corpus were assembled with AI assistance, and AI makes mistakes.** So do people.
The verification apparatus described in this document exists because that is true, not because
it has been solved. It reduces specific, named classes of error. It cannot catch a misreading
that is internally consistent, and several such errors were found *after* shipping. They are
catalogued in `meta/validation-events.yaml` and `meta/red-team-0.1.md`.

**Every output must be checked against the primary source by a qualified person before it is
relied on.** Every record carries its source URL, fetch date and content hash specifically so
that checking is possible. That is the design intent. Do not skip it.

Nothing here creates an attorney-client relationship.

---

## 1. What this is, in one paragraph

Privacy-KB is a versioned, citation-anchored, machine-readable model of United States federal
privacy law with a New York State and New York City layer, plus a deterministic engine that
answers *which obligations apply, as of what date, with what exemptions and what preemption
posture*. Every obligation is quoted character-for-character from a stored primary source and
carries the SHA-256 of the bytes it was verified against. No language model participates in the
applicability decision: the engine is ordinary code, and a model may narrate its output but
cannot change it.

### 1.1 What problem it addresses

General-purpose language models answer privacy-law questions fluently and are wrong in
characteristic, hard-to-detect ways:

- They cite provisions that do not exist, or that exist but say something else.
- They report bills that never passed, or laws not yet in force, as binding today.
- They collapse entity-level and data-level exemptions, which is the distinction separating
  expert analysis from novice analysis.
- They answer "no law applies" when no sectoral statute reaches a practice, missing the
  deceptive-practices backstops that always do.
- They give a confident answer over a gap in their own knowledge, with nothing marking the gap.

Every one of those is a *silent* failure: the output looks the same whether it is right or
wrong. Privacy-KB is built so that each of those five failures is either structurally impossible
or loudly reported.

### 1.2 What it is not

- Not a compliance platform, DSAR tool, consent manager, or data-discovery scanner.
- Not a replacement for legal advice or for reading the statute.
- Not comprehensive: it covers US federal privacy law, New York, and New York City. No other
  state. No GDPR beyond transfer-mechanism touchpoints. Almost no case law.

---

## 2. The eight invariants

These are correctness properties, not preferences. Violating one is a bug. They are stated in
`BRIEF.md` section 3 and enforced by the gates in section 6 below.

| # | Invariant | What it means in practice |
|---|---|---|
| **I1** | Verbatim or nothing | Every record carries a `verbatim_span` copied character-for-character from a stored primary source plus the URL it was fetched from. A record that cannot be verified is `verification_status: unverified` and is suppressed from every output. |
| **I2** | Everything is time-indexed | Every record has `effective_from` and `effective_to`. Every query resolves *as of a date*. There is no "current law", only law as of a timestamp. A query with no date, or a malformed date, is refused. |
| **I3** | Status is not binary | `in_force`, `enacted_pending`, `proposed`, `vetoed`, `superseded`, `enjoined`. Encoding pending law as in force is the single most damaging error this system could make, because training data is dense with commentary about bills that never became law. |
| **I4** | Exemptions are typed objects | `entity_level`, `data_level`, `activity_level`, `size_threshold`, `temporal`. A covered entity exempt for one *record* is not exempt as an *entity*. Collapsing the two is the headline failure mode. |
| **I5** | Preemption is a first-class field | `floor`, `ceiling`, `field`, `express_partial`, `none`. HIPAA is a floor, so stricter state law survives. FCRA has express partial preemption. Getting this wrong produces confidently incorrect advice, which is worse than refusing. |
| **I6** | The backstops never turn off | FTC Act section 5 and the applicable state deceptive-practices statute are always in the result set, along with the entity's own published privacy notice. The system never returns "no law applies". |
| **I7** | Guidance is not law | `authority_tier` separates statute, regulation, agency guidance, enforcement action and case law. Agency guidance materially changes advice but is surfaced separately and never blended into a statutory citation. |
| **I8** | No LLM in the applicability path | Thresholds, dates, deadlines, version resolution and exemption checks are code. A model writes prose over a computed result. It never computes. |

---

## 3. Data model

### 3.1 Record types

The corpus holds **248 records** across nine types. One record per file, YAML, small on purpose:
git diffs on legal change are the point.

| Type | Count | What it is |
|---|---|---|
| `obligation` | 218 | A duty imposed by a specific provision. The primary content. |
| `authority` | 9 | A regulator, its statutory grant, its reach and its penalty structure. |
| `definition` | 5 | A defined term, decomposed into elements, with a computed comparison against other definitions of the same term. |
| `principle` | 5 | A non-binding framework principle, with its enforceability pathway stated. |
| `workflow_constraint` | 5 | A constraint a deliverable must satisfy, composed from other records. |
| `doctrine` | 3 | A constitutional or common-law rule that constrains what other instruments may do. Carries no paragraph path because there is no paragraph. |
| `taxonomy` | 2 | A model the corpus documents about the sources of law themselves. |
| `enforcement_action` | 1 | An agency action interpreting a duty. |

### 3.2 The obligation record

Twenty required fields. The ones that carry the weight:

```yaml
id: ny.gbl.899_aa.9.hipaa_ag_notice        # dotted, stable, jurisdiction-prefixed
record_type: obligation
verification_status: verbatim_confirmed     # or `unverified`, which suppresses it entirely

source:
  citation: N.Y. Gen. Bus. Law § 899-aa(9)
  instrument_id: ny.gbl.899_aa
  url: https://legislation.nysenate.gov/api/3/laws/GBS/899-AA
  fetched: '2026-08-19'
  raw_file: corpus/state/ny/shield-act/raw/ny-gbs-899-aa.json
  raw_sha256: <64 hex>                      # hash of the source bytes
  text_file: ...txt                         # the rendering spans are checked against
  text_sha256: <64 hex>
  segment_sha256: <64 hex>                  # hash of the SEGMENTATION LEAF this quotes
  format: openleg_json                      # drives risk_tier and which gates apply
  risk_tier: low                            # low | medium | high, derived from format
  structured_source_check: {...}            # what was tried before falling back to PDF

verbatim_span: "Any covered entity required to provide notification of a breach ..."

paragraph_path:                             # WHERE in the enacted hierarchy
  path: ['9']
  anchor: '899-AA'
  derivation: reconstructed                 # structural (read) | reconstructed (parsed)
  confidence: high
  evidence: "subdivision designators reconstructed from the flat text field ..."

status: in_force
effective_from: '2025-03-28'
effective_to: null

applies_if:                                 # a closed predicate grammar, not code
  all:
    - entity.is_hipaa_covered_entity == true
    - practice.notified_hhs_secretary_of_breach == true

obligation_type: notify                     # 12-value enum
deadline:
  trigger_event: notification to the Secretary of Health and Human Services
  duration: { value: 5, unit: business_days }
  computation: "..."                        # the governing language, verbatim in effect

exemptions: []                              # typed objects, see I4
preemption: { posture: ceiling, authority: ..., note: ... }
enforcement: { enforcers: [state_ag], private_right_of_action: false, penalty: {...} }
interpreted_by: []                          # guidance / enforcement action, with its own span

subject: { domain: 'V.A.1', lifecycle: ['III'] }   # classification coordinates
```

Two hashes matter and are different. `raw_sha256` covers the **source bytes**, which never
change. `segment_sha256` covers the **segmentation leaf**, which changes whenever the text
walker changes. That distinction exists because a walker fix silently re-cuts the provisions
under every record over that source. See gate 38.

### 3.3 The predicate grammar

`applies_if` is a tiny closed grammar, deliberately not code:

```
<expr>      := { all: [<expr>] } | { any: [<expr>] } | { none: [<expr>] } | <predicate>
<predicate> := <namespace>.<field> <op> <literal>
<op>        := == | != | >= | <= | > | < | in | not_in
<literal>   := true | false | null | number | 'quoted string' | [list]
```

There is **no `eval`**. An unrecognised shape is REFUSED and evaluates to UNKNOWN, never to
true. Six fact namespaces, **192 keys total**, documented in `meta/fact-keys.yaml`:

| Namespace | Keys | Meaning |
|---|---|---|
| `entity` | 73 | What the organisation *is*: sector, HIPAA role, employer status, nexus |
| `practice` | 50 | What it *does*: monitors communications, notified HHS, provides a feed |
| `data` | 42 | What the data *is*: PHI, NY private information, minor, biometric |
| `event` | 11 | What *happened*: a breach, a request, a determination |
| `purpose` | 9 | *Why* data is used |
| `law` | 7 | Cross-instrument facts for preemption predicates |

64 of those 192 keys appear only inside exemption predicates, which means nothing else in the
repository demonstrates them. `meta/fact-keys.yaml` marks them `discoverable: false` so the
condition is visible rather than hidden.

---

## 4. Architecture

```
corpus/          248 YAML records + the fetched primary sources they quote
  federal/         US Code, CFR
  state/ny/        NY consolidated law, NYC Admin Code, 6 RCNY
  **/raw/          the fetched bytes, hashed and logged in meta/sources.yaml
  **/*.seg.json    segmentation: the source cut into addressable provisions

engine/          deterministic solver. No network, no model, no I/O beyond reading corpus/
  corpus.mjs       load, index, inForceOn, surfaceable
  predicates.mjs   the closed grammar evaluator, total, never throws
  applicability.mjs the main solver
  exemptions.mjs   typed exemption resolution (I4)
  preemption.mjs   five postures, refuses unknown ones (I5)
  timeline.mjs     deadline arithmetic
  backstops.mjs    invariant I6
  coverage.mjs     declared-vs-actual completeness

mcp/server.mjs   9 tools over stdio JSON-RPC. What Claude Desktop connects to.
bin/privacy-kb.mjs  the CLI. Wraps the same call() the MCP server uses.
workflows/       4 lifecycle-indexed deliverable templates
evals/           30 scenario files with all-pass rubrics
tools/           24 fetchers, extractors, validators, generators
meta/            declarations: coverage, sources ledger, debt, decisions, drift
schemas/         9 JSON Schemas, one per record type
tests/           56 gate fixtures + CLI tests
```

**The dependency direction is strict.** The corpus knows nothing about the engine. The engine
knows nothing about MCP. The CLI and the MCP server share one `call()` function so the terminal
and the assistant cannot drift apart.

### 4.1 The analysis order

Steps 1 to 6 are deterministic. Steps 7 and 8 are computed and then written up.

1. Characterise the data (PHI, NPI, consumer report, minor, biometric)
2. Characterise the entity (sector, HIPAA role, GLBA status, size, nexus)
3. Federal sectoral regime: which applies, at entity level or data level
4. Preemption resolution: federal displaces, floors, or coexists
5. State overlay (New York, if enabled)
6. Exemption check, typed, per instrument
7. Obligations and enforcement: who enforces, what the exposure is
8. Backstops: FTC section 5, state UDAP, published notice. Always.

---

## 5. The engine's refusals

More engineering went into what it declines to answer than into what it answers.

| It refuses to | Because | Mechanism |
|---|---|---|
| Answer without a date | There is no "current law" (I2) | `analyze()` returns an error object |
| Accept a malformed date | Comparisons are string comparisons, so `'not-a-date'` sorts above every ISO date and would report not-yet-effective law as in force | strict `YYYY-MM-DD` plus real-calendar validation |
| Return pending law as an obligation | I3 | status is checked *before* dates, so no as-of date promotes it |
| Surface an unverified record | I1 | `surfaceable()` filters every output path |
| Report silence | I6 | backstops appended unconditionally |
| Guess an unknown preemption posture | An unrecognised value used to fall through to `none`, the most permissive answer | `default:` returns `outcome: 'unresolved'` |
| Evaluate a malformed predicate as false | It would be grammatical, satisfiable, and permanently unsatisfied | unrecognised right-hand side is REFUSED, not coerced to a string |
| Hide a partial instrument | A confident answer over a void | `instrument_completeness` names the absent duty categories inside the result |

Every entry point is **total**: `analyze`, `computeDeadline`, `preemption.resolve` and all four
workflows return a shaped result on null, undefined, arrays, strings and numbers rather than
throwing.

---

## 6. The verification apparatus

### 6.1 42 CI gates

A commit fails if any gate trips. They fall into five families.

**Provenance and quotation**
- **1** schema validity, and `risk_tier` matches `format`
- **2** `verbatim_confirmed` needs a resolvable raw file whose hash matches
- **3** every span is an exact substring of the source
- **11** two independent renderers must agree on what a PDF says
- **12** visual spot-check coverage, sampled by document feature
- **14** non-vacuity: a check that examined almost nothing is not a pass
- **15** no span may contain apparatus (footnote markers, publisher lines)
- **33** every source an atom cites appears in the ledger
- **41** one provision one record, and the ledger matches the disk in both directions

**Citation precision**
- **16** paragraph-path confidence; low confidence refuses the atom
- **17** no anchor inside a non-operative region (quoted historical text)
- **18** nested text needs its governing context recorded
- **20** no anchor to a repealed document
- **23** a path must resolve to exactly one provision
- **30** a reconstructed path must agree with its own citation
- **38** an atom is anchored to the segmentation it was written against
- **39** a span must not belong to a different provision than the one cited
- **40** a span cut short of a qualifier states the opposite rule

**Semantics**
- **4** nothing in force from the future
- **5** state atoms declare their federal relationship
- **7** a `notify` obligation without a deadline is incomplete
- **9** a principle is not an obligation
- **21** every predicate must be one the engine can evaluate
- **24** instrument-wide relief must apply instrument-wide
- **26** a definition's `differs_from` is computed, and still computes the same way
- **28** an atom may only predicate on a namespace the engine actually fills
- **29** no predicate may be unsatisfiable
- **35** a phrase quoted in the analysis must appear in the law it cites
- **36/37** composed records may not invent what they compose

**Completeness, declared before measured**
- **6** taxonomy coordinate must exist
- **13** a record not anchored to a taxonomy leaf must say why
- **25** a jurisdiction with records must declare what it should hold
- **27** an instrument with obligations must declare its duty categories
- **31** a declared citation must have been resolved against the source
- **34** the completeness argument must be true or its shortfall declared

**Meta: the gates watching the gates**
- **8** eval all-pass rate must not regress
- **10** referential integrity on every cross-reference
- **19** a declared unguarded gap needs written acceptance
- **22** no gate may be listed and unimplemented
- **32** every declined examination must have a declared reason
- **42** a ratchet may not move without a recorded reason

### 6.2 Fixtures

**56 fixture cases**, each a miniature corpus built to trip exactly the gates named for it in
`tests/fixtures/expected.yaml`. **31 of 42 gates** are exercised this way. The other **11 are
declared unexercisable** in `tests/fixtures/no-fixture.yaml` with a written reason, because
their subject is the corpus as a whole or the harness itself. `tools/test-gates.mjs` asserts
that every gate is either exercised or declared, so a new gate cannot quietly join the untested
set.

### 6.3 Test suite

`npm test` runs fifteen steps: gate fixtures, extractor conformance, dual-parse, authority
tiering, feature scan, engine/schema correspondence, the gates, ancestry diff, coverage
freshness, fact-key freshness, engine properties, MCP, workflows, and the CLI. `node
evals/runner.mjs` runs 30 scenario files with all-pass rubrics. Both run in GitHub Actions on
every push.

### 6.4 Ratchets

Three thresholds may only move in one direction, and `meta/ratchets.yaml` records the current
value and the reason for the last move. Gate 42 asserts the live values still match the
declaration, so relaxing one requires a diff that carries a reason rather than a number that
quietly changed.

---

## 7. Coverage

**54 declared instruments, 53 complete** against their declared duty categories.

### 7.1 Federal (43 instruments)

HIPAA Privacy, Security and Breach Notification Rules · GLBA Privacy and Safeguards Rules ·
FCRA and FACTA Disposal · COPPA · TCPA and the Telemarketing Sales Rule · FERPA and PPRA ·
ECPA (Wiretap and Stored Communications) · CAN-SPAM · VPPA · CPNI · Cable Act · DPPA ·
Privacy Act of 1974 · HITECH · FTC Act section 5 · CFPB UDAAP · 42 C.F.R. Part 2 ·
21st Century Cures information blocking · Common Rule · Title VII, ADA, GINA, EPPA ·
FISA 702 · CLOUD Act · CALEA · RFPA · BSA/AML · and others.

### 7.2 New York and New York City (11 instruments)

| Instrument | Records | Status |
|---|---|---|
| SHIELD Act breach notification, GBL § 899-aa | 4 | complete |
| SHIELD Act safeguards, GBL § 899-bb | 2 | complete |
| Child Data Protection Act, GBL §§ 899-ee, 899-ff | 4 | complete, with OAG guidance attached |
| SAFE for Kids Act, GBL art. 44-D | 7 | **partial**, see below |
| GBL § 349 deceptive acts | 3 | complete |
| GBL § 350 false advertising | 1 | complete |
| Education Law § 2-d, student data | 3 | complete |
| Civil Rights Law §§ 50 and 51, right of publicity | 2 | complete |
| Civil Rights Law § 52-c, employee monitoring notice | 2 | complete |
| Penal Law §§ 250.00 and 250.05, eavesdropping | 3 | complete |
| NYC Local Law 144 with 6 RCNY Subchapter T | 9 | complete |

### 7.3 Declared gaps

Gaps are stated inside the answer, not discovered later.

- **SAFE for Kids** is missing `age_determination_methods` (13 N.Y.C.R.R. Part 700) and
  `language_list` (N.Y. Exec. Law § 202-a). Part 700 is where "commercially reasonable and
  technically feasible" is actually defined, so the § 1501 answer is honest but incomplete.
- **23 NYCRR Part 500** (NYDFS Cybersecurity) is declared and not held. No structured source
  serves NYCRR, and the only available document is an amendatory diff whose underscoring
  `pdftotext` discards.
- **Four records are held but never surfaced**: three constitutional doctrines and one
  enforcement action, all `unverified`, suppressed by I1.

---

## 8. Interfaces

### 8.1 MCP server (9 tools)

`node mcp/server.mjs` speaks JSON-RPC over stdio. This is what Claude Desktop connects to.

| Tool | Purpose |
|---|---|
| `privacy_analyze` | Full applicability analysis for an entity and its data, as of a date |
| `privacy_applicable` | Cheap variant: which instruments apply, nothing else |
| `privacy_obligations` | Obligations for one instrument in force on a date |
| `privacy_cite` | The anti-hallucination primitive: verbatim span, URL, hash, or a refusal |
| `privacy_definition` | Definitions of a term, with computed divergence between them |
| `privacy_deadline` | A deadline from a trigger date, with the governing language |
| `privacy_diff` | What changed between two dates, and what is pending |
| `privacy_preemption` | Posture and resolution between a federal and a state instrument |
| `privacy_coverage` | Completeness at a coordinate, with what is missing |

Every tool description carries a rule the model is told not to override: anything in
`pending_watch` is not law, and a citation must come from `privacy_cite` rather than from
memory.

### 8.2 CLI

```
privacy-kb doctor                          check the install, five named checks
privacy-kb setup [--write]                 print or write the Claude Desktop config
privacy-kb ask [flags]                     which obligations apply
privacy-kb deadlines --from <date>         every clock a breach starts
privacy-kb cite <record-id>                verbatim text, source URL, hash, in-force dates
privacy-kb coverage                        what the corpus holds
```

Flags: `--hipaa --ny-data --ny-employer --nyc-hiring --minors --breach --told-hhs
--as-of <date> --json`

---

## 9. Worked example, with real output

A telehealth company: Delaware incorporated, offices in Austin, **no New York office and no New
York employees**, one New York patient, hires in New York City with an automated screening tool,
minors on the platform. Breach discovered 8 September 2026, HHS notified the same day.

### 9.1 Deadlines

```
$ privacy-kb deadlines --hipaa --ny-data --told-hhs --from 2026-09-08

  2026-09-15   5 business_days   N.Y. Gen. Bus. Law § 899-aa(9)
               from: notification to the Secretary of Health and Human Services
               business days = weekdays; public holidays NOT excluded
  2026-10-08  30 calendar_days   45 C.F.R. § 164.524(b)(2)(i)
  2026-10-08  30 calendar_days   N.Y. Gen. Bus. Law § 899-aa(2)
               from: discovery of the breach
  2026-11-07  60 calendar_days   45 C.F.R. § 164.526(a)(1)
```

**The earliest deadline is one that doing the federal thing correctly created.** § 899-aa(9)
gives a covered entity five business days *from notifying the Secretary* to notify the New York
Attorney General. Not five days from discovery. A company that files federally and then works
through its 30-day and 60-day obligations has already missed the first one.

Three things a naive answer gets wrong here:

1. **No nexus threshold.** § 899-aa attaches to holding a New York resident's private
   information. No office, employees or revenue floor appears in the text or the predicate.
2. **HIPAA does not preempt it.** `resolve(45 C.F.R. § 164.502(a), GBL § 899-aa(2))` returns
   `both_apply` on the authority of 45 C.F.R. § 160.203: HIPAA is a floor.
3. **The compliance-deemed pathway does not rescue it.** § 899-aa(2)(b) is typed
   `activity_level`, not `entity_level`. It removes notice to people already notified federally
   and expressly preserves notice to the Attorney General.

### 9.2 Verifying a citation

```
$ privacy-kb cite ny.gbl.899_aa.9.hipaa_ag_notice

N.Y. Gen. Bus. Law § 899-aa(9)

  Any covered entity required to provide notification of a breach, including breach of
  information that is not "private information" as defined in paragraph (b) of subdivision
  one of this section, to the secretary of health and human services pursuant to the Health
  Insurance Portability and Accountability Act of 1996 ... shall provide such notification
  to the state attorney general within five business days of notifying the secretary.

  source:   https://legislation.nysenate.gov/api/3/laws/GBS/899-AA
  fetched:  2026-08-19
  sha256:   cb912ca3a2a1da483cfbc51c28abeb69...
  in force: 2025-03-28 → present  (status: in_force)
```

### 9.3 Law that is not law yet

```
IN FORCE today (2026-09-08)
  GBL § 899-ee(1), § 899-ff(1), § 899-ff(5)     Child Data Protection Act
  GBL § 899-bb(1), § 899-bb(2)                  SHIELD safeguards

PENDING. NOT LAW. Watch feed only.
  § 1501(1) · § 1501(3) · § 1501(5) · § 1502 · § 1504 · § 1506(1) · § 1508(1)
  status=enacted_pending    binds from 2027-01-25
```

Verified at 2026-09-08, 2027-01-25, 2027-06-01 and 2030-01-01: the SAFE for Kids records never
enter `obligations` at any date. Status is checked before dates are.

**The cost of that refusal**, stated plainly: those records stay `enacted_pending` even after
25 January 2027, when the Act actually takes effect. Nothing silently becomes law, which is the
point. It also means **the corpus goes stale on that date unless a person updates it.**

### 9.4 Two definitions of one term

New York defines **"covered user" twice** in the same chapter of the General Business Law:

- **GBL § 899-ee(1)** (Child Data Protection Act): a user in New York whom the operator actually
  knows to be a minor, or who is using a service primarily directed to minors.
- **GBL § 1500(4)** (SAFE for Kids): a user in New York who is not the operator or its agent or
  affiliate. Which is very nearly everybody, adults included.

The only element the two share is *being in New York*. The corpus holds both as definition
records whose divergence is **computed from their elements** and re-verified by gate 26, so the
prose and the computation cannot disagree.

### 9.5 Other use cases the corpus supports

- **NYC Local Law 144 bias audits.** Nine records across the Administrative Code and 6 RCNY.
  The requirement most often missed is § 5-301(b)(3): impact ratios must be computed for
  **intersectional** categories of sex, ethnicity and race, not only single-axis.
- **Employee monitoring.** N.Y. Civil Rights Law § 52-c requires prior written notice on hiring
  plus conspicuous posting. New York requires *notice*, not consent.
- **Session replay and chat interception.** Penal Law § 250.00 supplies the one-party-consent
  definitions that § 250.05 relies on, including the separate in-person limb at § 250.00(2).
- **Change watch.** `privacy_diff` reports what came into force, what ceased, and what is pending
  between two dates.

---

## 10. Installation

Needs Node 20 or newer. Nothing else.

```bash
git clone https://github.com/rakib-nyc/privacy-kb.git
cd privacy-kb
npm install
npm run setup -- --write     # writes the Claude Desktop MCP config, or omit --write to print it
npm run doctor               # five named checks
```

Then quit Claude Desktop completely and reopen it. `INSTALL.md` is the version written for
readers with no terminal experience.

---

## 11. Known limitations and open defects

Stated because a tool that hides these is less trustworthy than one that does not.

| Limitation | Detail |
|---|---|
| **Business days mean weekdays** | Public holidays are not excluded, so a clock crossing one lands a day early. Every affected result says so in `business_day_basis`. |
| **Pending law does not self-promote** | A record stays `enacted_pending` after its effective date until a person updates it. |
| **Gate 40 is keyword-based** | It detects truncation before `unless`, `except`, `provided that` and similar. A drafter's synonym outside that list would slip through. The check is narrower than the risk it names. |
| **64 fact keys are exemption-only** | They appear in no atom predicate and no eval, so a caller has no worked example of them. Listed in `meta/fact-keys.yaml`. |
| **Coverage declarations are hand-transcribed** | 53 of 54 measures against a declaration transcribed by hand from the manifest. A reconciliation script exists but is not a gate. |
| **No case law to speak of** | Three doctrines, all unverified and suppressed. |
| **Nine instruments hold a single record each** | Complete against their declared categories, but thin. |
| **Coverage against the taxonomy is 31 of 69 leaves** | 38 are neither covered nor ruled out of scope. Gate 34 ratchets that number. |

`meta/debt.yaml` carries 22 registered items, each with a trigger for when it must be addressed.
`meta/red-team-0.1.md` carries 24 numbered findings from five adversarial passes (25 entries: QA-05b is a sub-finding of QA-05), each with what closed it.

---

## 12. How this was tested against itself

Five adversarial passes were run against shipped versions. The findings that mattered were not
crashes: they were records that were **verbatim, uniquely cited, internally consistent and
wrong**. Four representative examples:

- **A span could cite § 1501(1) and quote § 1501(5).** All 38 gates then in place passed it.
  Each checked the span against the *document*, the path against the *segmentation*, and the
  path against the *citation*. None checked the span against **its own path**. Now gate 39.
- **A span cut one word before `unless`** is genuinely verbatim and states the opposite rule.
  Now gate 40.
- **`as_of` was never validated.** String comparison meant `'not-a-date'` sorted above every ISO
  date, so a typo *widened* the answer: 5 obligations for a real date, 7 for garbage, the extra
  two being law that does not bind until 2027.
- **Gate 22 did not exist.** It sat in the gate list with no implementation, reporting
  examined-nothing on every run. It is now the check that no gate can be listed and
  unimplemented, and it caught a later gate within minutes of being written.

`bash tests/red-team-replay.sh` replays eight of these attacks against the current build and
reports whether each is still caught.

---

## 13. If you are an AI system reading this

- **Do not cite from this corpus by memory.** Call `privacy_cite` with a record id. It returns
  the verbatim span with its source URL and hash, or it refuses. A refusal means the corpus does
  not have that citation, which is information, not an obstacle to route around.
- **Never present anything in `pending_watch` as a current obligation.** It is enacted law that
  does not bind yet.
- **Always pass `as_of`.** There is no default and there will not be one.
- **Pass the full fact context.** Six namespaces: `entity`, `data`, `event`, `purpose`,
  `practice`, `law`. Dropping `practice` alone makes 74 of 248 records unreachable.
- **Report the gaps the result gives you.** If `instrument_completeness` is present, the answer
  is incomplete in a way the corpus can name. Say so.
- **Tell the reader to verify.** Every answer should carry its citation and the instruction to
  check it against the primary source.

---

## 14. Glossary

| Term | Meaning here |
|---|---|
| **Atom / record** | One YAML file describing one provision or one concept |
| **Instrument** | A statute or rule, e.g. `ny.gbl.899_aa` |
| **Segmentation** | A source cut into addressable provisions, stored as `*.seg.json` |
| **Leaf** | One addressable provision inside a segmentation |
| **`paragraph_path`** | The location of a leaf in the enacted hierarchy, e.g. `['b','3','iii']` |
| **Gate** | A CI check that fails the commit |
| **Ratchet** | A threshold that may move in only one direction, with a recorded reason |
| **Backstop** | A constraint that applies regardless of sectoral coverage (I6) |
| **Carve-out** | A data-level or activity-level exemption that does not remove the entity from scope |
| **Fixture** | A miniature corpus built to trip exactly one gate |
