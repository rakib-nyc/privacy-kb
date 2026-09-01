# SCHEMA

Freeze this before extracting a single atom. Changing it later means re-touching every file.

---

## 1. The obligation atom

One YAML file per atom. Filename = atom ID with dots replaced by dashes.

```yaml
# corpus/federal/domain-2-private-sector/hipaa-breach/atoms/
#   hipaa-breach-164-404-individual-notice.yaml

id: us.hipaa.breach.164_404.individual_notice
schema_version: 1

# ---- provenance (invariant I1) -----------------------------------------
source:
  citation: "45 C.F.R. § 164.404(b)"
  instrument_id: us.hipaa.breach_notification_rule
  url: https://www.ecfr.gov/current/title-45/section-164.404
  fetched: 2026-08-17
  raw_file: raw/ecfr-45-164-404-20260817.txt
  raw_sha256: "…"
verbatim_span: >
  [character-for-character copy of the operative text. No ellipsis inside
  a quoted obligation. If the operative text spans subsections, quote each
  as its own atom.]
verification_status: verbatim_confirmed   # verbatim_confirmed | secondary_only | unverified

# ---- taxonomy ----------------------------------------------------------
subject:
  domain: "II.B.1"        # <DOMAIN>.<COMPETENCY>.<PI_ORDINAL>, must exist as a
                           # leaf in meta/coverage.yaml (CI gate 6). The taxonomy has
                           # no nested outline — see meta/taxonomy-versions.yaml.
  lifecycle: ["VI"]             # lifecycle stages this obligation lives in
jurisdiction: US-FED
jurisdiction_level: federal   # federal | state | local
regulator: [hhs_ocr]
sector: [healthcare]
data_types: [phi]

# ---- temporal (invariant I2, I3) ---------------------------------------
status: in_force          # in_force | enacted_pending | proposed | vetoed
                          # | superseded | enjoined
effective_from: 2009-09-23
effective_to: null
supersedes: null
superseded_by: null
amendment_history:
  - {date: 2013-03-26, note: "Omnibus Rule — risk assessment replaced harm standard",
     source_url: "…"}

# ---- applicability -----------------------------------------------------
applies_if:                # boolean expression over EntityFacts / DataFacts
  all:
    - entity.hipaa_role in [covered_entity]
    - event.type == "breach_of_unsecured_phi"
applies_to_role: covered_entity   # covered_entity | business_associate | both | any

# ---- the obligation ----------------------------------------------------
obligation_type: notify   # notify | disclose | obtain_consent | restrict_use
                          # | secure | retain | delete | contract | assess
                          # | register | train | prohibit
summary: >
  One sentence, factual, no hedging. This is what gets rendered in a memo.
requirement_detail: >
  Structured restatement. Must be traceable to verbatim_span. If you cannot
  point at the words, do not write the sentence.

deadline:
  trigger_event: discovery_of_breach
  duration: {value: 60, unit: calendar_days}
  computation: "without unreasonable delay and in no case later than"
  tolling: []

# ---- exemptions (invariant I4) -----------------------------------------
exemptions:
  - id: us.hipaa.breach.lowprob_exception
    type: data_level          # entity_level | data_level | activity_level
                              # | size_threshold | temporal
    scope: "PHI for which a risk assessment demonstrates low probability
            of compromise"
    source_citation: "45 C.F.R. § 164.402(2)"
    verbatim_span: "…"
    burden_of_proof: covered_entity

# ---- preemption (invariant I5) -----------------------------------------
preemption:
  posture: floor            # floor | ceiling | field | express_partial | none
  authority: "42 U.S.C. § 1320d-7"
  note: >
    More stringent state law is not preempted. State breach-notification
    obligations run in parallel and may impose shorter deadlines.

# ---- enforcement -------------------------------------------------------
enforcement:
  enforcers: [hhs_ocr, state_ag]
  private_right_of_action: false
  penalty:
    structure: tiered_by_culpability
    range: {min: 100, max: 2000000, unit: usd_per_violation}
    note: "annually adjusted for inflation — verify current figures"
  statute_of_limitations: null

# ---- relationships -----------------------------------------------------
related:
  - {id: us.ftc.hbnr.notice, relation: parallel_regime}
  - {id: ny.shield.899aa.notice, relation: state_overlay}
federal_relationship: null   # state atoms only: gap_fills | exceeds_floor
                             # | mirrors | independent

# ---- guidance layer (invariant I7) -------------------------------------
interpreted_by:
  - {id: hhs.guidance.breach_risk_assessment, authority_tier: agency_guidance}

# ---- practitioner layer ------------------------------------------------
common_errors:
  - "Treating the 60-day outer limit as the standard rather than the ceiling."
  - "Assuming HIPAA compliance discharges state breach obligations (it does not)."
open_questions: []
confidence: high            # high | medium | low — extractor's own read
```

---

## 2. Non-obligation record types

Same directory structure, different `record_type`.

| Type | Purpose | Key fields |
|------|---------|-----------|
| `principle` | FIPPs, OECD, APEC | `text`, `derived_obligations[]` |
| `definition` | PHI, NPI, consumer report, personal information, RHI | `term`, `verbatim_definition`, `instrument_id`, `differs_from[]` |
| `authority` | FTC, HHS OCR, state AGs, DOIs | `powers[]`, `penalty_authority`, `rulemaking_authority` |
| `enforcement_action` | consent decrees, settlements | `doctrinal_rule`, `parties`, `date`, `precedential_weight` |
| `interaction` | US ↔ GDPR/FADP, HIPAA ↔ info blocking | `instrument_a`, `instrument_b`, `tension`, `resolution` |
| `workflow_constraint` | M&A, BYOD — no single statute | `scenario`, `constraints[]`, `sources[]` |
| `taxonomy` | sources of law, regulator map | free structure |

`definition` records matter more than people expect. **"Personal information" means five
different things across FCRA, GLBA, HIPAA, COPPA and NY SHIELD.** The `differs_from` field
is where a lot of expert value lives.

---

## 3. Facts model — the engine's input

```ts
interface EntityFacts {
  sectors: Sector[];
  hipaa_role: 'covered_entity' | 'business_associate' | 'neither' | 'hybrid';
  glba_financial_institution: boolean;
  is_cra: boolean;                     // FCRA consumer reporting agency
  is_furnisher: boolean;
  is_data_broker: boolean;
  annual_revenue_usd?: number;
  employee_count?: number;
  consumer_counts: Record<Jurisdiction, number>;
  nexus: Jurisdiction[];               // where it operates
  data_subject_jurisdictions: Jurisdiction[];  // WHOSE data — often the real trigger
  public_company: boolean;
  government_contractor: boolean;
}

interface DataFacts {
  types: DataType[];                   // phi | npi | consumer_report | biometric
                                       // | precise_geolocation | minor_data | rhi | …
  minors_involved: MinorPosture;       // none | actual_knowledge
                                       // | primarily_directed | signal_received
  collected_via: Channel[];            // web | app | wearable | call | email | sms | fax
  purposes: Purpose[];
  disclosed_to: RecipientClass[];
  sold_or_shared: boolean;
  cross_border: boolean;
}

interface QueryContext {
  as_of: ISODate;                      // required. no default. (invariant I2)
  state_layers: Jurisdiction[];        // ['US-NY'] or []
  include_pending: boolean;            // pending law → watch feed only, never obligations
}
```

`data_subject_jurisdictions` being separate from `nexus` is deliberate. It is what makes
the SHIELD Act extraterritoriality question resolve correctly, and it is the most common
thing a naive model gets wrong.

---

## 4. Engine output contract

```ts
interface AnalysisResult {
  as_of: ISODate;
  applicable: InstrumentResult[];
  exempt: { instrument_id: string; exemption: Exemption; reasoning: string }[];
  not_applicable: { instrument_id: string; failed_predicate: string }[];
  preemption_notes: PreemptionNote[];
  backstops: InstrumentResult[];        // never empty (invariant I6)
  obligations: ObligationAtom[];
  deadlines: ComputedDeadline[];
  enforcement_summary: EnforcementExposure[];
  pending_watch: PendingItem[];         // separate channel, never mixed in
  coverage_gaps: string[];              // taxonomy leaves this query touched but KB lacks
  unverified_excluded: string[];        // atoms suppressed by I1 — surfaced honestly
}
```

Two fields do disproportionate work. `coverage_gaps` makes the system say *"this question
touches Domain II.E.4 and I have no verified atoms there"* instead of improvising.
`unverified_excluded` makes suppression visible rather than silent.

---

## 5. MCP tool surface

Read-only. Every tool takes `as_of`.

| Tool | Returns |
|------|---------|
| `privacy_analyze(entity, data, context)` | full `AnalysisResult` |
| `privacy_applicable(entity, data, as_of)` | instrument list only, cheap |
| `privacy_obligations(instrument_id, as_of)` | atoms in force on that date |
| `privacy_cite(atom_id)` | verbatim span + source URL + fetch date |
| `privacy_definition(term, instrument_id?)` | definition record(s) + `differs_from` |
| `privacy_deadline(trigger, date, instrument_id)` | computed date + tolling notes |
| `privacy_diff(from_date, to_date, filter?)` | what changed, what is coming |
| `privacy_preemption(federal_id, state_id)` | posture + resolution |
| `privacy_coverage(bok_coordinate)` | KB completeness at that node |

Annotate all as `readOnlyHint: true`, `openWorldHint: false`.

`privacy_cite` is the anti-hallucination primitive: any model can be instructed to call it
before asserting any citation, and the call either returns verbatim text or fails loudly.

---

## 6. CI gates

A commit fails if any of these trip:

1. Any atom fails JSON Schema validation.
2. Any atom has `verification_status: verbatim_confirmed` without a resolvable
   `raw_file` whose hash matches `raw_sha256`.
3. Any `verbatim_span` does not appear as an exact substring of its `raw_file`.
4. Any atom with `status: in_force` has `effective_from > today`.
5. Any state atom lacks `federal_relationship`.
6. Any atom lacks a `subject.domain` coordinate present in `meta/coverage.yaml`.
7. Any obligation with `obligation_type: notify` lacks a `deadline`.
8. Eval suite all-pass rate regresses against the previous commit.

9. Any `principle` record with `framework.binding: true` and no `authority_tier`, or
   carrying an `obligation_type`. A principle is not an obligation.
10. Any cross-reference (`differs_from`, `derived_obligations`, `related`, `interpreted_by`)
   that does not resolve to a record that exists.
11. Any `verbatim_span` from a `pdf_*` source that does not also appear in a rendering
   produced by an independent engine (pdfplumber/pdfminer, via `tools/render-alt.py`).
12. Any `risk_tier: high` instrument with fewer than three passing visual spot-checks in
   `meta/visual-checks.yaml`, none covering a subparagraph marker or table, or whose
   recorded span hash no longer matches the record.
13. Any record whose `subject.domain` is not a performance indicator and which has no
   `scope_justification`.

14. Any check whose haystack collapsed — a rendering under 200 characters, or two
   renderings disagreeing on size by more than 2×. A gate examining nothing is
   indistinguishable from a gate that passed.
15. Any `verbatim_span` containing apparatus, or any span the feature inventory reports
   a footnote reference on which declares no `span_interruptions` entry for it.

Gate 3 is the important one. It is a mechanical check that makes fabricated quotation
structurally impossible to commit.

## 6a. Apparatus

**Apparatus** is what the publisher put around the text rather than enacted as text:
footnote/endnote reference markers, footnote text, page numbers, running heads and feet,
line numbers, watermarks, revision bars, column rules, editorial brackets in an official
rendering.

**A `verbatim_span` is never edited to remove apparatus.** Exclude it by choosing span
boundaries. Deleting a character puts an unrecorded transformation between source and
quotation, which is what I1 forbids.

Where operative text is unavoidably interrupted mid-sentence, record the removal:

```yaml
span_interruptions:
  - offset: 306              # index into verbatim_span
    excluded_text: " 1 "     # exact characters, verbatim, never normalised
    kind: footnote_ref
```

Gate 3 rebuilds the raw substring by re-inserting every entry at its offset and requires
the result to appear in the source. The removal is therefore mechanically reversible, and
the operative words cannot be edited without breaking reconstruction.

Chosen over splitting the span into linked spans, because splitting loses the fact that
the text is one sentence — and a sentence is frequently the unit an obligation lives in.
The cost is one more field and one more reconstruction step; the benefit is that the
quotation stays whole and the deletion stays auditable.

**Gate 3's limit, and why 11 and 12 exist.** Gate 3 proves a span is faithful to the
*rendering*. It cannot prove the rendering is faithful to the *document*. A baseline-offset
bug in this repo's column extractor once emitted `"with the consent of the individual a)
whose ..."` — markers moved out of position — and every gate passed, because the span
matched the broken rendering exactly. Gate 11 answers that with a second engine that shares
no layout code with the first. Gate 12 answers it by rasterising the page and reading the
passage back off the image, which is the only check that inspects the document rather than
a transformation of it. `tools/ancestry-diff.mjs` is the third line: when one instrument
adapts another, a "difference" that is only punctuation, whitespace, or the inside of a
subparagraph label is far more likely an extraction artefact than a drafting decision.
