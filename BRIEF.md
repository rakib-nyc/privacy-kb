# PRIVACY-KB — Project Brief

You are building a **US federal privacy law agent** with an optional **New York state layer**.
This file is the standing brief. Read it before every work session.

---

## 1. What this is

Three artifacts, built in this order. Do not skip ahead.

| # | Artifact | What it is |
|---|----------|------------|
| 1 | **The Obligation Knowledge Base** | A versioned, citation-anchored, machine-readable model of US federal privacy law, structured against the legal-domain taxonomy. Plain files in git. No database. |
| 2 | **The Analysis Engine** | Deterministic code that answers *which law applies, as of what date, with what exemptions and what preemption posture*. No LLM in this path. |
| 3 | **The Agent Layer** | An MCP server over (1) and (2), plus workflow harnesses structured against the lifecycle lifecycle. Any model the user brings does the prose; the server supplies the truth. |

**The KB is the product. The agent is the demo.** If you find yourself building agent
features before the KB is complete and verified, stop.

---

## 2. The two classification axes, and what each is for

These are **orthogonal axes**, not two versions of the same thing.

**Legal domain = what the law *is*.** Five domains, the top-level partition of the obligation KB:

- **Domain I** — The U.S. Privacy Environment
- **Domain II** — Federal Privacy Laws
- **Domain III** — Government and Court Access to Private-sector Information
- **Domain IV** — Workplace Privacy
- **Domain V** — State Privacy Laws  ← *the New York layer plugs in here*

**Lifecycle = what you *do* about it.** Six stages, the workflow/deliverable catalogue:

- **Stage I** — Privacy Program: Developing a Framework
- **Stage II** — Privacy Program: Establishing Program Governance
- **Stage III** — Operational Life Cycle: Assessing Data
- **Stage IV** — Operational Life Cycle: Protecting Personal Data
- **Stage V** — Operational Life Cycle: Sustaining Program Performance
- **Stage VI** — Operational Life Cycle: Responding to Requests and Incidents

Every obligation record carries a `subject.domain` coordinate. Every workflow carries a
`subject.lifecycle` coordinate. The product matrix is **obligation × lifecycle stage**.

### Coordinates

`<DOMAIN>.<COMPETENCY>.<ORDINAL>` — for example `V.B.1`. The domain and competency levels are
fixed for a taxonomy version; the ordinal is ours. Versions and effective dates are recorded in
`meta/taxonomy-versions.yaml`, and any divergence between this file and the recorded taxonomy is
logged in `meta/taxonomy-drift.yaml`. **Two entries (D-04, D-05) are open owner decisions that
affect build order — read them before Phase 1.**

The taxonomy is used as a **coverage checklist**: every leaf either maps to records in the KB or
appears in `meta/out-of-scope.yaml` with a stated reason. That is the completeness argument for
the whole project, and `meta/coverage.yaml` is where it is kept honest — gate 34 ratchets the
count of leaves that are neither.


## 3. Non-negotiable invariants

These are correctness properties. Violating any of them is a bug, not a style choice.

**I1 — Verbatim or nothing.**
Every atom carries a `verbatim_span` copied character-for-character from the primary
source, plus a `source_url` you actually fetched. If you could not fetch the primary text,
the atom is `verification_status: unverified` and **must not be surfaced in any output**.
Never paraphrase a statute and call it a citation. Never reconstruct a citation from memory.

**I2 — Everything is time-indexed.**
Every atom has `effective_from` and `effective_to`. Every query resolves *as of a date*.
There is no "current law" — there is only law as of a timestamp.

**I3 — Status is not binary.**
`in_force | enacted_pending | proposed | vetoed | superseded | enjoined`.
Encoding a pending or vetoed bill as in force is the single most damaging error this system
can make, because training data is dense with alerts about bills that never became law.

**I4 — Exemptions are typed objects, never strings.**
`entity_level` vs `data_level` is the distinction that separates expert analysis from
novice analysis. Model it or the tool is worthless.

*The teaching example, verified against the text:* a hospital holding a patient's chart is a
covered entity for that record; the **same hospital** holding the **same nurse's** pre-employment
physical is not, because 45 C.F.R. § 160.103 excludes "employment records held by a covered
entity in its role as employer" from PHI. Same entity, same person, same clinical facts,
different capacity — and the entity never drops out of HIPAA. That is `data_level`.

*The counter-example, and read it before generalising:* under 16 C.F.R. § 318.1(a) the same
covered entity is outside the FTC Health Breach Notification Rule **entirely**, consumer wellness
app included. The rule "does not apply to HIPAA-covered entities, or to any other entity **to the
extent that** it engages in activities as a business associate" — the qualifier scopes the second
limb only, so the first is unqualified and `entity_level`.

**The lesson is to read the exclusion's grammar, not to pattern-match the situation.** An earlier
version of this file used the wellness-app case as the canonical `data_level` example. It is the
wrong answer for § 318.1(a), and a a verification pass caught it while extracting that rule — see
`meta/validation-events.yaml` VE-001.

**I5 — Preemption is a first-class field.**
`floor | ceiling | field | express_partial | none`. HIPAA is a floor (more stringent state
law survives). FCRA has express preemption in defined areas. Get this wrong and you produce
confidently incorrect advice, which is worse than refusing.

**I6 — The backstops never turn off.**
FTC Act § 5 (unfair/deceptive) and the applicable state UDAP statute are always in the
result set. The system never returns "no law applies." It returns "no sectoral statute
reaches this; § 5, state UDAP, and the entity's own published notice are the operative
constraints."

**I7 — Guidance is not law.**
`authority_tier: statute | regulation | agency_guidance | enforcement_action | case_law`.
Agency guidance and consent decrees materially change advice but must be surfaced
separately and never blended into a statutory citation.

**I8 — No LLM in the applicability path.**
Thresholds, dates, deadlines, version resolution and exemption checks are code. The model
writes prose over a computed result. It never computes.

---

## 4. Repository layout

```
/meta
  taxonomy-versions.yaml          # legal-domain + lifecycle taxonomy version strings, fetch dates
  coverage.yaml              # taxonomy leaf → atom IDs, or out-of-scope reason
  sources.yaml               # every primary source URL + fetch date + hash
/corpus
  /federal
    /domain-2-private-sector
      ftc-act-5/
        instrument.yaml      # metadata for the instrument
        atoms/*.yaml         # one file per obligation atom
        raw/                 # fetched primary text, unmodified
      hipaa-privacy-rule/
      glba-safeguards-rule/
      ...
    /domain-3-government-access
    /domain-4-workplace
  /state
    /ny
      shield-act/
      cdpa/
      ...
/engine
  applicability.ts           # the deterministic solver
  preemption.ts
  timeline.ts                # deadline computation
  exemptions.ts
/mcp
  server.ts
/workflows                   # lifecycle-indexed deliverable templates
/evals
  scenarios/*.yaml           # all-pass rubrics
  runner.ts
```

One atom per file. Atoms are small. Git diffs on legal change are the whole point.

---

## 5. Build order

**Phase 0 — Foundations (do this first, completely)**
1. Fetch both taxonomy PDFs and the question weighting. Record versions.
2. Transcribe the taxonomy outlines into `meta/coverage.yaml` as an empty checklist.
3. Freeze the schema (see `SCHEMA.md`). Write the JSON Schema validator. Wire it to CI.
4. Build the source-fetching harness: given a URL, fetch, hash, store under `raw/`, log to
   `meta/sources.yaml`. Every atom must trace to a stored raw file.

**Phase 1 — Federal spine (the long haul)**
Work the manifest in `CORPUS-MANIFEST.md` **one instrument at a time**, in the listed order.
For each, run the extraction prompt, then the adversarial verification prompt, then commit.
Do not batch. Do not move to the next instrument until the current one passes verification.

**Phase 2 — Engine**
Only once ≥ 80% of the Domain II manifest is verified. Build the solver against real atoms,
not hypothetical ones.

**Phase 3 — New York layer**
Same process, `CORPUS-MANIFEST.md` § NY. Every NY atom must declare its federal
relationship: `gap_fills`, `exceeds_floor`, `mirrors`, `independent`.

**Phase 4 — MCP + workflows**
See `PROMPTS.md` § 4.

**Evals are written alongside, never after.** Target: 100+ scenarios before Phase 4.

---

## 6. The analysis order (this is the agent's plan, and it is deterministic through step 6)

```
1. Characterize the data      → PII / PHI / NPI / consumer report / minor / biometric / RHI
2. Characterize the entity    → sector, HIPAA CE-BA status, GLBA FI status, size, nexus
3. Federal sectoral regime    → which applies, at entity level or data level
4. Preemption resolution      → federal displaces, floors, or coexists
5. State overlay              → NY instruments, if the state layer is enabled
6. Exemption check            → typed, per instrument
7. Obligations + enforcement  → who enforces, penalty exposure, private right of action
8. Backstops                  → FTC § 5, state UDAP, published notice commitments — always
```

Steps 1–6 are the engine. Steps 7–8 are computed and then written up by the model.
**Every output must state who enforces and what the exposure is.** legal-domain-trained readers
expect it; generic tools omit it.

---

## 7. Failure modes to actively defend against

- Citing a statute section that does not exist, or exists but says something else.
- Treating NYHIPA (or any pending bill) as law.
- Answering "New York has a comprehensive privacy law" — it does not.
- Collapsing entity-level and data-level exemptions.
- Returning state analysis without the federal sectoral layer that defines it.
- Silence when no statute applies, instead of the § 5 / UDAP backstop.
- Losing the distinction between the statute and the agency guidance interpreting it.

Each of these gets at least three eval scenarios.

---

## 8. Scope discipline

**In scope for v1:** the federal corpus in `CORPUS-MANIFEST.md`, the NY layer, the engine,
the MCP server, four lifecycle workflows.

**Out of scope for v1:** other states, GDPR beyond the transfer-mechanism touchpoints,
consent management infrastructure, data discovery/scanning, DSAR fulfilment plumbing.
Those are commodity or enormous. We are the reasoning layer that sits above them.
