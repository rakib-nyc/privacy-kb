# CORPUS MANIFEST — the work queue

Process **one instrument at a time**, top to bottom. For each: extract → verify → commit.

Citations below are starting pointers for your own research. **Every one must be confirmed
against primary source before use.** Where a citation here is wrong or stale, fix the
manifest as part of that instrument's commit.

Status legend: `[ ]` not started · `[~]` extracted, unverified · `[x]` verified & committed

---

## PRIORITY 0 — Cross-cutting scaffolding

These are not instruments but they gate everything downstream.

- [x] **legal-domain taxonomy + question weighting** — v2.6.1, eff. 2025-09-01. 5 domains · 16 competencies · 69 performance indicators → `meta/coverage.yaml`. taxonomy and Blueprint are one PDF. Grouping verified against PDF table geometry (`npm run verify-taxonomy`).
- [x] **lifecycle taxonomy + question weighting** — v4.2.0, eff. 2025-09-01. 6 domains · 21 competencies · 64 performance indicators → `meta/workflows.yaml`. Grouping verified the same way.
- [~] **Fair Information Practice Principles** — 39 `principle` records in `corpus/principles/fipps/`. Done: 1973 HEW Code of Fair Information Practice (5); OECD/LEGAL/0188 as revised 2013-07-11 (8); APEC Privacy Framework 2015 (13, paragraph-level); Global CBPR Framework 2023 (13, paragraph-level). Cross-framework `differs_from` populated; 8 of 13 Global CBPR paragraphs are byte-identical to their APEC source, and the 5 differences are stated from a computed diff.
      **Ruled out of scope:** DHS Privacy Policy Guidance Memoranda 2008-01 and 2017-01 — federal agency internal policy, binding on DHS components and on no private-sector entity. No manifest item cites them. See `meta/out-of-scope.yaml`; re-entry trigger is a government-contractor flow-down question at Priority 4/5. Nothing was taken from a secondary source.
      **Note:** the taxonomy never names FIPPs, OECD or CBPR; only "APEC principles" (I.C.8). The claim that these are "the interpretive frame the whole taxonomy rests on" is this repo's position, not the taxonomy's — see `meta/taxonomy-drift.yaml` D-10.
- [x] **Sources of US law** — 2 `taxonomy` records + `tools/authority-tier.mjs`, an EXECUTABLE decision procedure that reproduces all 41 declared tiers non-circularly and REFUSES rather than guessing. Positive-law status generated from USLM's own metadata into `meta/positive-law-titles.yaml`. The four privacy torts are documented but NOT recorded as atoms — each needs state case law, reached at Priority 3+.
- [x] **Regulatory authority map** — 11 `authority` records: FTC (×2, the § 5 grant and the § 45(n) unfairness test), HHS OCR, CFPB, FCC, SEC, EEOC, DOL, ED, NAI, DAA. **Not done:** state Departments of Insurance and PCI SSC. State AG authority is anchored on 42 U.S.C. § 1320d-5(d) (HITECH) rather than on state statutes, which are blocked.

---

## PRIORITY 1 — legal-domain Domain II: Federal Privacy Laws

The core of the product by atom count.

> **Drift, unresolved.** The question weighting weights Domain II at 15–19 questions, behind
> Domain I (27–33) and Domain V (17–21). The "roughly 60%" figure below describes this
> repo's intended atom distribution, not taxonomy weighting, and the two are not aligned.
> See `meta/taxonomy-drift.yaml` D-05 — this is an open owner decision.
> Note also that the taxonomy's Domain II has competencies II.A–II.E only; the II.F block
> below is this manifest's own grouping and maps to II.A.3 and I.C.6–I.C.9 (D-04).

### II.A — Cross-sector FTC authority

- [ ] **FTC Act § 5** — 15 U.S.C. § 45. Unfairness (§ 45(n) three-part test) and deception (the *Cliffdale Associates* / Deception Policy Statement standard). This is invariant **I6**; model it carefully.
- [ ] **FTC consent decrees as authority** — build a `enforcement_action` atom type. Seed with the canonical privacy orders. Do not attempt exhaustive coverage; capture the *doctrinal rules* they establish (e.g. algorithmic disgorgement, retention limits, dark patterns).
- [ ] **FTC Health Breach Notification Rule** — 16 C.F.R. Part 318, as amended.
- [~] **COPPA** — 4 atoms from 16 C.F.R. § 312.3 (notice, verifiable parental consent, anti-conditioning, security). Rest of Part 312 NOT done. The 2025 amendment is flagged as unverified against the Federal Register notice.

### II.B — Healthcare / medical

- [ ] **HIPAA Privacy Rule** — 45 C.F.R. Part 160, Part 164 Subparts A and E. Largest single instrument. Sub-partition: covered entities, business associates, PHI definition, permitted uses/disclosures, minimum necessary, individual rights (access, amendment, accounting, restriction), NPP, authorizations, de-identification (Safe Harbor and Expert Determination).
- [ ] **HIPAA Security Rule** — 45 C.F.R. Part 164 Subpart C. Required vs addressable specifications must be a typed field. Check for pending/finalized amendments.
- [~] **HIPAA Breach Notification Rule** — 2 atoms (individual notice, timeliness). The four-factor risk assessment, HHS and media thresholds NOT done.
- [ ] **HITECH Act** — enforcement tiers, BA direct liability, penalty structure.
- [ ] **42 C.F.R. Part 2** — SUD treatment records. Verify current post-CARES-Act alignment.
- [ ] **21st Century Cures Act information blocking** — 45 C.F.R. Part 171. Tension with privacy restrictions is a real analytical trap.
- [ ] **Common Rule / research** — 45 C.F.R. Part 46, plus FDA 21 C.F.R. Parts 50, 56.

### II.C — Financial

- [ ] **GLBA Privacy Rule** — 16 C.F.R. Part 313 / Regulation P, 12 C.F.R. Part 1016. NPI definition, notice, opt-out, reuse limits.
- [~] **GLBA Safeguards Rule** — 5 atoms: Qualified Individual, written risk assessment, penetration testing/continuous monitoring, incident response plan, and the FTC notification duty (30 days from discovery, 500-consumer threshold). Not exhaustive.
- [~] **FCRA** — § 1681t preemption extracted (2 atoms: the general savings clause and the § 1681t(b)(1)(E) express carve-out with its 1996 grandfather). The reference implementation for **I5**. The rest of FCRA — consumer report, CRA, furnisher, permissible purposes, adverse action — is NOT done.
- [~] **FACTA** — Disposal Rule (16 C.F.R. Part 682) done, 3 atoms. Red Flags Rule and truncation NOT done.
- [ ] **Right to Financial Privacy Act** — 12 U.S.C. § 3401 et seq. (bridges to Domain III)
- [ ] **Bank Secrecy Act / AML** — as a privacy *constraint conflict*, not a privacy law.
- [ ] **Dodd-Frank / CFPB UDAAP** — 12 U.S.C. § 5531. Note the *abusive* prong — a third standard beyond FTC unfair/deceptive.
- [ ] **§ 1033 open banking rule** — verify current status; it has been in flux.
- [ ] **Mergers, acquisitions & divestitures** — taxonomy topic. Not one statute; build a `workflow_constraint` record covering FTC consent-decree carryover, notice-consistency limits on data transfer in bankruptcy/M&A, and the *Toysmart* line.

### II.D — Education

- [ ] **FERPA** — 20 U.S.C. § 1232g, 34 C.F.R. Part 99. Education record, directory information, school official exception.
- [ ] **PPRA** — 20 U.S.C. § 1232h.
- [ ] **NCLB / student data + edtech vendor practice** — pairs with NY Education Law § 2-d in the state layer.

### II.E — Telecommunications and marketing *(emphasis increased in the current question weighting)*

- [ ] **TCPA** — 47 U.S.C. § 227 and 47 C.F.R. § 64.1200. Prior express consent vs prior express *written* consent; ATDS post-*Facebook v. Duguid*; revocation rules. Verify current FCC rule state — this area moves.
- [ ] **Telemarketing Sales Rule / National Do Not Call** — 16 C.F.R. Part 310.
- [ ] **CAN-SPAM** — 15 U.S.C. § 7701 et seq., 16 C.F.R. Part 316.
- [ ] **Junk Fax Prevention Act** — 47 U.S.C. § 227(b), EBR exception.
- [ ] **CPNI** — 47 U.S.C. § 222, 47 C.F.R. §§ 64.2001–64.2011.
- [ ] **Cable Communications Policy Act** — 47 U.S.C. § 551.
- [~] **VPPA** — 1 atom, § 2710(b)(1) disclosure prohibition, with the private-right-of-action and liquidated-damages exposure recorded. Definitions and exceptions NOT done.
- [ ] **DPPA** — 18 U.S.C. § 2721 et seq.

### II.F — Data brokers, transfers, and newer federal instruments

- [ ] **DOJ Bulk Sensitive Personal Data Rule** — 28 C.F.R. Part 202. Verify current compliance dates and covered-transaction definitions.
- [ ] **Protecting Americans' Data from Foreign Adversaries Act (PADFA)** — 2024.
- [ ] **EU-US Data Privacy Framework** — self-certification obligations, redress mechanism. Also SCCs and adequacy as the transfer alternatives. taxonomy cross-references this under Domain I; keep the atoms here and link.
- [ ] **Intersection between U.S. and non-U.S. law** — taxonomy topic I.C.l.3, expressly including GDPR and the Swiss FADP. Model as `interaction` records, not obligations.

---

## PRIORITY 2 — legal-domain Domain V.A: Federal vs. State Authority

Small but structurally critical. Build before the NY layer.

- [x] **Preemption doctrine** — `engine/preemption.mjs` resolves all five postures. `express_partial` returns UNRESOLVED rather than an answer, because carve-outs are per-subject and some are date-limited.
- [ ] **Instrument-by-instrument preemption posture** — one record per Priority-1 instrument. HIPAA floor, FCRA express-partial (§ 1681t), COPPA, CAN-SPAM, TCPA (savings clause), GLBA. This file is the single highest-leverage artifact in the repo.
- [ ] **Dormant Commerce Clause** constraints on state privacy law.
- [ ] **First Amendment** constraints — *Sorrell v. IMS Health*, and the age-assurance/AADC litigation line, which directly bears on the NY SAFE for Kids Act.

---

## PRIORITY 3 — New York state layer

Every NY atom must declare `federal_relationship: gap_fills | exceeds_floor | mirrors | independent`.

- [ ] **SHIELD Act** — N.Y. Gen. Bus. Law §§ 899-aa (breach notification) and 899-bb (reasonable safeguards). Model the extraterritorial reach precisely — it attaches to holding a NY resident's private information regardless of NY presence. Model the compliance-deemed pathways for GLBA/HIPAA-regulated entities.
- [ ] **Child Data Protection Act** — N.Y. Gen. Bus. Law §§ 899-ee et seq., effective June 20, 2025. Triggers: actual knowledge of a minor user, *or* service primarily directed to minors, *or* device signals the user is a minor. Processor contractual restrictions. Penalty up to $5,000/violation.
- [ ] **NY OAG CDPA Implementation Guidance** (May 19, 2025) — `authority_tier: agency_guidance`. Critically, it announces enforcement discretion pending final rules and weighting of good-faith compliance. Check whether final rules have since issued.
- [x] **SAFE for Kids Act** — the statute is **N.Y. Gen. Bus. Law art. 44-D, §§ 1500–1508**; the short title resolves against nothing. All nine sections segmented, seven obligation atoms, every one `enacted_pending` with `effective_from: 2027-01-25` — the corpus's first non-`in_force` record, which is what finally made the invariant **I2** property test non-vacuous (`engine/test-engine.mjs` P4b). Note **two** future dates, not one: § 1508(1) bars the Attorney General for a further 180 days past the effective date. The final regulations at 13 N.Y.C.R.R. §§ 700.1–700.11 supply what "commercially reasonable" means and remain **unreachable** — no structured source serves NYCRR; declared as a coverage gap on the instrument.
- [ ] **NYHIPA** — A.10357 / S.9269 (2026 session), following the December 19, 2025 veto of A.2141/S.929. **Verify current status before encoding — it was moving through mid-2026.** Revised version reportedly narrows the authorization look-back from twelve to nine months, permits a thirty-day extension for providing copies, and expands exemptions from four to twenty-one with AG authority to add more. Status must be exact. If unsigned, it is `proposed` and cannot appear in any obligation output — only in the change-watch feed.
- [ ] **N.Y. Gen. Bus. Law §§ 349 / 350** — deceptive acts and practices. This is the state UDAP backstop for invariant **I6** and the actual litigation vehicle for most NY privacy claims.
- [ ] **N.Y. Labor Law § 203-f** — electronic monitoring notice. Domain IV.
- [ ] **NYC Local Law 144** — automated employment decision tools, bias audit and notice. Domain IV. City-level; add a `jurisdiction_level` field.
- [ ] **N.Y. Education Law § 2-d** + 8 N.Y.C.R.R. Part 121 — student data, pairs with FERPA.
- [ ] **23 N.Y.C.R.R. Part 500** (NYDFS Cybersecurity) — as amended, phased. **Verify all phase-in dates independently.**
- [ ] **N.Y. Penal Law § 250.05** (eavesdropping) and NY's one-party-consent posture — relevant to session-replay and chat-interception claims. Verify how NY courts have actually treated these; do not assume the California CIPA pattern transfers.
- [ ] **N.Y. Civil Rights Law §§ 50–51** — right of publicity / use of likeness, including the digital replica provisions.

---

## PRIORITY 4 — legal-domain Domain IV: Workplace Privacy

Underserved by the entire GRC market. Strong candidate for the first commercial wedge.

- [ ] **FCRA in employment** — background checks, standalone disclosure, pre-adverse and adverse action sequence.
- [ ] **ECPA in the workplace** — Wiretap Act, Stored Communications Act, consent and business-use exceptions.
- [ ] **ADA** — medical inquiries and confidentiality of medical records.
- [ ] **GINA** — genetic information.
- [ ] **Title VII / EEOC** — including AI-in-hiring guidance.
- [ ] **NLRA § 7** — monitoring and social media policy constraints.
- [ ] **EPPA** — polygraph.
- [ ] **Drug and alcohol testing** — federal (DOT) plus the state-law overlay pointer.
- [ ] **SOX whistleblower** — confidentiality of reporting channels.
- [ ] **BYOD / remote monitoring** — no single statute; a `workflow_constraint` record.

---

## PRIORITY 5 — legal-domain Domain III: Government and Court Access

Lower volume, needed for completeness and for the subpoena-response workflow.

- [ ] **ECPA** — Wiretap Act (18 U.S.C. § 2510 et seq.), SCA (§ 2701 et seq.), Pen Register (§ 3121 et seq.). Process-required-by-data-type matrix is the useful artifact.
- [ ] **CALEA**
- [ ] **CLOUD Act** — 18 U.S.C. § 2713, executive agreements.
- [ ] **FISA § 702**, EO 12333, USA FREEDOM Act, national security letters
- [ ] **Fourth Amendment** — third-party doctrine and *Carpenter*
- [ ] **Privacy Act of 1974** and **FOIA** exemptions
- [ ] **Civil discovery** — subpoena response, protective orders, e-discovery proportionality

---

## PRIORITY 6 — legal-domain Domain V.B: other state law (post-v1 pointer only)

Do **not** build these in v1. Create stub records so the schema proves it scales:

- 20 state comprehensive laws · all-50 breach notification · biometric (IL BIPA, TX CUBI, WA)
- consumer health (WA MHMD, NV, CT) · state AI (Colorado) · **NAIC AIS Governance Guidelines**
- state UDAP statutes · data broker registration regimes

---

## Estimated atom counts (for sequencing, not commitment)

| Block | Instruments | Est. atoms |
|-------|-------------|-----------|
| Priority 0 | 5 | ~80 |
| Priority 1 (Domain II) | 38 | ~900 |
| Priority 2 (preemption) | 4 | ~60 |
| Priority 3 (New York) | 12 | ~260 |
| Priority 4 (workplace) | 10 | ~180 |
| Priority 5 (gov access) | 7 | ~140 |
| **Total v1** | **76** | **~1,620** |

At one instrument per work session, this is a ~76-session project. That is the honest number.
