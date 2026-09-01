# PROMPT PACK

Session prompts. Run them in order. Each is designed for **one
instrument or one artifact per session** — the whole method depends on not batching.

---

## 0. Session kickoff (paste at the start of every session)

```
Read BRIEF.md, SCHEMA.md, and CORPUS-MANIFEST.md in full before doing anything.

Then report, in under 150 words:
  - which manifest item is next
  - which invariants (I1–I8) are most at risk for that item and why
  - what primary sources you will need to fetch

Do not begin work until I confirm.
```

---

## 1. taxonomy ingestion (run twice — legal-domain, then lifecycle)

```
TASK: Ingest the {legal-domain | lifecycle} taxonomy and question weighting into
meta/coverage.yaml (or meta/workflows.yaml for lifecycle).

STEPS
1. Locate and fetch the current taxonomy PDF and question weighting PDF from the recorded source. Record the
   exact version string, the document date, and the stated effective date. If you cannot
   fetch them, STOP and tell me — do not proceed from memory or from third-party summaries
   of the taxonomy. Third-party study-site descriptions are NOT acceptable sources for this step.
2. Transcribe the complete nested outline, preserving the own numbering exactly
   (e.g. "II.C.h", "I.A.d.vii"). Every leaf, not just the headings.
3. For each leaf emit:
     coordinate:   "II.C.h"
     title:        "Mergers, Acquisitions & Divestitures"
     blueprint_q:  {min: 3, max: 5}     # from the question weighting, at its own granularity
     atoms:        []                   # to be filled as the corpus is built
     status:       not_started          # not_started | in_progress | covered | out_of_scope
     out_of_scope_reason: null
4. Cross-check the leaf count against the question weighting's section list. Report any
   mismatch rather than silently reconciling.
5. Write meta/taxonomy-versions.yaml with both version strings and your fetch date.

CONSTRAINTS
- Do not editorialize, reorder, merge, or "improve" the taxonomy. It is the schema.
- Where the taxonomy names an example in parentheses (e.g. "(e.g., GDPR, FADP)"), preserve it —
  those examples define scope.
- Flag every leaf whose subject matter you believe has changed since the taxonomy was published.
  Do not act on it; just list it in meta/taxonomy-drift.yaml.

OUTPUT: the yaml file, plus a summary of leaf counts per domain.
```

---

## 2. Instrument extraction — THE WORKHORSE

Run once per manifest item. This is where the corpus actually gets built.

```
TASK: Extract obligation atoms for a single instrument.

INSTRUMENT: {name}
STARTING CITATION: {citation from CORPUS-MANIFEST.md — treat as a hypothesis to verify,
                    not as fact}
taxonomy COORDINATE(S): {e.g. II.B.c}

────────────────────────────────────────────────────────────────────────
PHASE A — ACQUIRE THE PRIMARY TEXT (do not skip, do not shortcut)
────────────────────────────────────────────────────────────────────────
A1. Find the authoritative primary source. Order of preference:
      statutes    → uscode.house.gov, govinfo.gov
      regulations → ecfr.gov (current), federalregister.gov (amendments/preambles)
      NY statutes → nysenate.gov, assembly.state.ny.us
      NY regs     → the promulgating agency's own publication
      guidance    → the issuing agency's own site only
    Law-firm alerts, study sites, and vendor blogs are NEVER a source for text. They may be
    used ONLY to locate a citation, and never appear in a `source` block.

A1b. STRUCTURED SOURCE FIRST — this is a hard requirement, not a preference.
    A PDF is a *rendering* of a document, and every transformation of a rendering is a
    place a quotation can silently drift. That is not hypothetical: a baseline-offset bug
    in this repo's own column extractor once moved subparagraph markers out of position
    and every gate passed, because the gates checked the span against the broken
    rendering. Structured formats do not have that failure mode.

    Before falling back to a PDF you must CHECK, and RECORD the result of checking:
      federal statutes  → uscode.house.gov USLM XML; govinfo bulk data
      federal regs      → eCFR XML API; Federal Register API
      NY                → nysenate.gov / assembly API or structured export
      other issuers     → look for an API, an HTML rendering, or a .docx original
                          before accepting the PDF. The OECD PDF was avoidable:
                          legalinstruments.oecd.org exposes a JSON API whose
                          bodyText.ref names an official HTML rendering.

    Record the outcome in the atom's `source.structured_source_check`
    ({checked[], result, note}), and record a negative result in meta/sources.yaml so the
    next session does not repeat the search. `source.format` and the derived
    `source.risk_tier` follow from what you found.

    Most of Priority 1 should never touch a PDF. If an instrument does, the
    structured_source_check must say why — and it will carry risk_tier high or medium,
    which pulls in gate 11 (dual-renderer agreement) and, at high, gate 12 (sampled
    visual spot-checks).

A2. Fetch the full text. Store unmodified under raw/. Compute and record sha256.
    Log the URL + fetch date to meta/sources.yaml.

A3. Confirm currency: is this the operative version as of today? Check for recent
    amendments, pending effective dates, and any injunction or stay. If the instrument is
    subject to litigation that has enjoined enforcement, that is a `status: enjoined` fact
    and must be captured.

A4. If you CANNOT obtain the primary text: create the instrument record with
    verification_status: unverified, write down exactly what blocked you, and STOP.
    Do not extract atoms from secondary sources. An empty verified corpus beats a full
    unverified one.

────────────────────────────────────────────────────────────────────────
PHASE B — SEGMENT
────────────────────────────────────────────────────────────────────────
B1. Walk the text section by section. Classify every provision as exactly one of:
      DEFINITION | SCOPE/APPLICABILITY | OBLIGATION | EXEMPTION | PROHIBITION
      | RIGHT (of the data subject) | ENFORCEMENT | PREEMPTION | RULEMAKING
      | EFFECTIVE-DATE | HOUSEKEEPING (skip)

B2. Produce a segmentation table BEFORE writing any atom, and show it to me:
      | section | classification | one-line gist | atom? |
    This is the step that prevents you from inventing obligations that aren't there and
    from missing ones that are. I will review it before you continue.

────────────────────────────────────────────────────────────────────────
PHASE C — EXTRACT
────────────────────────────────────────────────────────────────────────
C1. One atom per operative obligation. Split rather than merge: if a section imposes
    notice AND a deadline AND a content requirement, that is three atoms linked by
    `related`, not one atom with a long summary.

C2. For every atom, fill the full SCHEMA.md structure. Specifically:
    - verbatim_span: character-for-character. No ellipsis inside a quoted obligation.
      You will be mechanically checked against raw/ — CI gate 3 fails the commit if the
      span is not an exact substring.
    - applies_if: a real boolean expression over EntityFacts/DataFacts, not prose.
      If you cannot express it as a predicate, the applicability is genuinely ambiguous —
      say so in open_questions rather than faking precision.
    - deadline: if the provision imposes any time limit, this field is mandatory.
    - status + effective_from/to: derive from the text and the Federal Register / session
      law, never from your prior knowledge of "when this took effect."

C3. EXEMPTIONS — extract these with more care than the obligations.
    For each, determine and record whether it is:
      entity_level   — the organization is outside the regime entirely
      data_level     — only the specified data is carved out; the entity remains regulated
                       for everything else
      activity_level — the processing activity is carved out
      size_threshold — applicability floor
      temporal       — sunset, grace period, transition relief
    Write out the practical consequence in `scope`. Test yourself: "if this entity does
    something adjacent, are they still covered?" That answer distinguishes entity- from
    data-level and is the #1 expert/novice divider in US privacy law.

C4. DEFINITIONS — emit a `definition` record for every defined term. Then populate
    `differs_from` by comparing against definitions already in the KB for the same or a
    similar term. "Personal information," "consumer," "sale," "de-identified," "breach"
    and "security incident" all vary meaningfully across instruments. This comparison is
    a required output, not optional enrichment.

C5. PREEMPTION — find the preemption provision. If there is none, record
    `posture: none` with the reason. Do not leave it null.

C6. ENFORCEMENT — enforcers, private right of action (yes/no — this drives litigation
    risk more than penalty size), penalty structure, limitations period.

C7. common_errors — 2 to 4 entries, drawn from what the text actually says versus what
    people commonly assume. Only include an error you can trace to a specific provision.

────────────────────────────────────────────────────────────────────────
PHASE D — SELF-AUDIT (report results before committing)
────────────────────────────────────────────────────────────────────────
D1. Re-read your extracted atoms against the raw text. For each verbatim_span, confirm by
    string search that it appears exactly. Report the count checked and any failures.
D2. Coverage: every section marked OBLIGATION in Phase B has ≥1 atom. List any that don't
    and explain.
D3. Fabrication sweep: for every citation you wrote — including in `related`,
    `interpreted_by` and `exemptions` — confirm it against a fetched source. Any citation
    you cannot confirm gets DELETED, not flagged.
D4. Update meta/coverage.yaml: mark the taxonomy leaves this instrument covers.
D5. Report:
      atoms created · definitions created · exemptions by type
      open_questions raised · citations deleted in D3
      taxonomy leaves now covered · anything in this instrument you deliberately skipped

────────────────────────────────────────────────────────────────────────
HARD RULES
────────────────────────────────────────────────────────────────────────
- You are extracting, not advising. Do not write what the law "generally requires."
  Write what THIS text says.
- If the text is ambiguous, that ambiguity is a finding. Record it in open_questions.
  Do not resolve it by picking the most common interpretation.
- Never fill a field from training-data recall. If it is not in the fetched text or a
  fetched official source, it is not in the KB.
- Do not proceed to the next manifest item. One instrument, then stop.
```

---

## 3. Adversarial verification (run after every extraction, as a separate session)

Fresh context matters here — do not run this in the same session that did the extraction.

```
TASK: Adversarial review of the atoms committed for {instrument}.

You did not write these. Your job is to break them. Assume they are wrong.

CHECKS
1. CITATION INTEGRITY — for every atom, independently fetch the cited provision and
   confirm the verbatim_span appears there. Do not trust raw/; re-fetch from source.
   Report any drift between raw/ and the live source (that is a currency finding).
2. FABRICATION — list every citation across all fields. Verify each independently.
   Report any that do not resolve.
3. OVER-EXTRACTION — for each atom, ask: does the quoted text actually impose this
   obligation, or is the requirement being inferred? Flag every inferred requirement.
4. UNDER-EXTRACTION — read the raw text independently and list operative provisions with
   no corresponding atom.
5. EXEMPTION TYPING — challenge every entity_level/data_level call. Construct a concrete
   counterexample scenario for each and check the typing holds.
6. TEMPORAL — is any atom marked in_force that is actually pending, enjoined, or
   superseded? Check for litigation and for amendments after the raw/ fetch date.
7. PREEMPTION — is the posture defensible from the text, or imported from general
   knowledge of how this statute is usually described?
8. PREDICATE SOUNDNESS — do the applies_if expressions type-check against the
   EntityFacts/DataFacts model? Are any silently always-true?

OUTPUT: a findings list, each tagged BLOCKER | MAJOR | MINOR, with the specific atom ID
and the specific fix. Do not fix anything yourself — report only.
```

---

## 4. Engine construction

```
TASK: Build /engine against the verified corpus. No LLM calls anywhere in this code path.

MODULES
- applicability.ts  — evaluate applies_if predicates over EntityFacts/DataFacts at as_of.
                      Pure function. Returns applicable / exempt / not_applicable with the
                      specific predicate that decided each.
- exemptions.ts     — apply typed exemptions. entity_level removes the instrument;
                      data_level removes only the matching data from scope and MUST leave
                      the entity in scope for other data. Getting this wrong is the
                      headline failure mode — write the tests first.
- preemption.ts     — resolve federal↔state. floor: both apply, stricter governs.
                      ceiling: federal caps state. field: federal only. express_partial:
                      apply the carve-out map. Emit a PreemptionNote for every pair.
- timeline.ts       — deadline computation. calendar vs business days, tolling, "without
                      unreasonable delay and in no case later than" ceilings. Return the
                      computed date AND the governing language.
- backstops.ts      — always append FTC Act §5 and applicable state UDAP. (invariant I6)

REQUIREMENTS
- Total function: every input produces a result, never an exception, never an empty answer.
- Explainability: every decision carries the atom ID and predicate that produced it.
- as_of is required, no default.
- include_pending: true routes pending law to `pending_watch` ONLY. It never enters
  `obligations`. Write a test that asserts this.
- Property test: for any facts, `backstops.length > 0`.
- Property test: no atom appears in both `applicable` and `exempt`.
- Property test: for every atom in `obligations`, verification_status == verbatim_confirmed.
```

---

## 5. Eval authoring (write alongside, never after)

```
TASK: Author all-pass eval scenarios for {instrument or topic}.

Each scenario:
  facts:      EntityFacts + DataFacts + as_of
  question:   what a privacy counsel would actually ask
  rubric:     8–20 atomic pass/fail criteria. Each criterion is independently checkable
              and names the specific atom ID, deadline, exemption, or enforcement fact
              that must appear.
  all_pass:   true only if every criterion passes
  trap:       what a naive model gets wrong here

Write 6–10 per instrument. At least 3 must be traps.

MANDATORY TRAP CATEGORIES — every one needs ≥3 scenarios in the suite overall:
  T1  entity-level vs data-level exemption
        e.g. HIPAA covered entity asks about a state consumer-health law: exempt for PHI,
        NOT exempt for the non-PHI wellness data its consumer app collects
  T2  extraterritorial reach by data-subject location, not entity location
        e.g. no NY office, one NY customer → SHIELD applies
  T3  compliance-deemed pathways
        e.g. GLBA Safeguards compliance and NY SHIELD reasonable safeguards
  T4  signal/knowledge triggers
        e.g. service not directed to minors receives a minor signal → CDPA still triggers
  T5  no comprehensive state law
        a NY question that must NOT be answered with a CCPA-style rights analysis
  T6  the backstop
        nothing sectoral applies → must return FTC §5 + state UDAP + notice commitments,
        never silence
  T7  pending law
        NYHIPA-style: must appear in pending_watch, must NOT appear in obligations
  T8  preemption
        FCRA express preemption; HIPAA as floor not ceiling
  T9  definitional divergence
        the same term meaning different things across two applicable instruments
  T10 stale-training-data trap
        a rule that was amended after most public commentary was written

Also produce, for each scenario, the CORRECT answer with citations, so the suite is
self-verifying. Where you are uncertain of the correct answer, mark the scenario
`needs_expert_review: true` rather than guessing.
```

---

## 6. MCP server + lifecycle workflows

```
TASK: Build /mcp and /workflows.

MCP: implement the nine tools in SCHEMA.md §5. TypeScript SDK, stdio transport for local
use, streamable HTTP for hosted. All tools readOnlyHint: true, openWorldHint: false.
Zod input schemas, defined outputSchema, structuredContent responses.

Tool descriptions must instruct the calling model on the invariants — specifically that it
must call privacy_cite before asserting any citation, and that anything in pending_watch
is not law. The description field is where model-agnosticism actually gets enforced.

WORKFLOWS — one directory each, indexed to lifecycle lifecycle domains. Build these four first:
  lifecycle III (Assessing Data)        → privacy impact assessment
                                      inputs: system description, data flows
                                      output: PIA with per-obligation findings, cited
  lifecycle IV  (Protecting)            → privacy notice gap analysis
                                      inputs: current notice, engine result
                                      output: redline + missing-disclosure list, cited
  lifecycle VI  (Responding — requests) → rights request handling
                                      inputs: request type, requester, entity facts
                                      output: obligation set, deadline, exemption analysis
  lifecycle VI  (Responding — incidents)→ multi-regime breach notification timeline
                                      inputs: incident facts, data types, jurisdictions
                                      output: every applicable regime, every deadline,
                                              every recipient, every content requirement

Each workflow is a template + a required-criteria checklist derived from the engine result.
The model drafts; the checklist is verified programmatically before the artifact is
returned. Never return an artifact that fails its own checklist — return it with the
failures marked.

Every workflow output ends with an enforcement section: who enforces, penalty exposure,
private right of action. This is non-optional and it is what makes the output read as
legal-domain-literate rather than generic.
```

---

## 7. Change-watch (the differentiating feature — build last, design early)

```
TASK: Build the change-watch pipeline.

For each instrument in meta/sources.yaml, on a schedule:
  1. Re-fetch the primary source. Compare sha256 against the stored raw.
  2. On change: diff, classify (technical amendment / substantive / effective-date /
     new exemption / enforcement-posture), and open a review item. Never auto-update an
     atom — legal change goes through human review.
  3. Separately poll the legislative/rulemaking trackers for instruments with
     status: proposed | enacted_pending. Status transitions are the highest-value event.

Then: given a customer's stored EntityFacts, compute the delta —
"these 6 obligations change for you, on this date, and here is what each requires now."

This is the feature nobody in the market has, and it is only possible because every atom
is versioned and every applicability decision is a pure function of facts and a date.
```
