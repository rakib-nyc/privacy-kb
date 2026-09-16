#!/usr/bin/env node
// MCP server over the corpus and the engine. SCHEMA.md §5.
//
// Fifteen read-only tools. The corpus supplies the truth; whatever model is calling supplies
// the prose. That split is the whole point — the server never asks a model anything, and
// the model never computes applicability.
//
// TOOL DESCRIPTIONS ARE LOAD-BEARING. They are where model-agnosticism is actually
// enforced: they instruct the caller to verify every citation through privacy_cite before
// asserting it, and that anything in pending_watch is not law. A model that ignores those
// instructions will produce a citation privacy_cite would have refused.
//
// Implements the stdio JSON-RPC framing directly rather than depending on an SDK.
import { createInterface } from 'node:readline';
import { analyze } from '../engine/applicability.mjs';
import { load, inForceOn, surfaceable } from '../engine/corpus.mjs';
import { isRealDate, badDateReason } from '../engine/dates.mjs';
import { computeDeadline } from '../engine/timeline.mjs';
import { TRIGGERS, FAMILIES, TRIGGER_KEYS } from '../engine/triggers.mjs';
import { factInventory, NAMESPACES, AMBIGUOUS_TERMS } from '../engine/facts.mjs';
import { INCIDENTS, INCIDENT_FAMILIES, INCIDENT_KEYS } from '../engine/incidents.mjs';
import { WORKFLOWS } from '../workflows/index.mjs';
import { buildMemo } from '../engine/memo.mjs';
import { search } from '../engine/search.mjs';
import { exposure } from '../engine/exposure.mjs';
import { requirementsFor, unionRequirements } from '../engine/requirements.mjs';
import { crosswalks } from '../engine/crosswalk.mjs';
import { issueReceipt, verifyReceipt } from '../engine/receipt.mjs';
import { betweenDates } from '../engine/exposure.mjs';
import { ground, groundText, groundMarkdown } from '../engine/grounding.mjs';
import { conform, conformMarkdown } from '../engine/conform.mjs';
import { mayI } from '../engine/permissions.mjs';
import { brief } from '../engine/brief.mjs';
import { listProfiles, readProfile, saveProfile, checkProfile, profileDir } from '../engine/profiles.mjs';
import { translate, knownVocabularies } from '../engine/vocabulary.mjs';
import { resolve as resolvePreemption } from '../engine/preemption.mjs';

const VERSION = '0.1.0';
const CITE_RULE =
  'Before asserting ANY citation from this server, call privacy_cite with the atom id. It returns the ' +
  'verbatim text with its source URL and fetch date, or fails loudly. Never reconstruct a citation from ' +
  'memory or paraphrase a quoted provision.';
const PENDING_RULE =
  'Anything returned in pending_watch is NOT LAW. It is a bill or a rule that has not taken effect. Never ' +
  'state it as an obligation.';

const TOOLS = [
  { name: 'privacy_analyze',
    description: `Full applicability analysis for an entity and its data, AS OF A DATE. Returns applicable ` +
      `instruments, exemptions with their type, preemption posture, computed deadlines, enforcement exposure, ` +
      `and backstops. The backstops are never empty: where no sectoral statute reaches the facts, FTC Act § 5, ` +
      `state UDAP and the entity's own published notice are the operative constraints — the answer is never ` +
      `"no law applies". ${CITE_RULE} ${PENDING_RULE}`,
    inputSchema: { type: 'object', required: ['as_of'], properties: {
      practice: { type: 'object', description: 'PracticeFacts: what the entity DOES — monitors_employee_communications, notified_hhs_secretary_of_breach, provides_addictive_feed, …' },
      purpose: { type: 'object', description: 'PurposeFacts: why data is used.' },
      law: { type: 'object', description: 'LawFacts: federal_instrument, state_requirement_subject — for preemption predicates.' },
      entity: { type: 'object', description: 'EntityFacts: sectors, hipaa_role, glba_financial_institution, is_cra, employee_count, nexus, data_subject_jurisdictions, …' },
      data: { type: 'object', description: 'DataFacts: types, minors_involved, collected_via, sold_or_shared, cross_border, …' },
      as_of: { type: 'string', description: 'REQUIRED ISO date. There is no "current law" — only law as of a date.' },
      state_layers: { type: 'array', items: { type: 'string' }, description: "e.g. ['US-NY']" },
      include_pending: { type: 'boolean', description: 'Routes pending law to pending_watch ONLY. It never enters obligations.' },
      event: { type: 'object', description: 'Event facts. Non-date facts (type, consumers_affected) plus '
        + 'TRIGGER DATES keyed by the controlled vocabulary — call privacy_triggers for the list. '
        + 'e.g. {type: "breach_of_security_of_the_system", consumers_affected: 900, discovery_of_breach: "2026-08-01"}. '
        + 'A family key dates every trigger in that family at once: {breach_discovery: "2026-08-01"} starts the '
        + 'HIPAA, SHIELD Act, Health Breach and GLBA Safeguards clocks together, and each result says it was '
        + 'dated by family. There is NO generic event.date — a date under an unrecognised key starts no clock.' } } } },

  { name: 'privacy_applicable',
    description: `Cheap variant of privacy_analyze: which instruments apply, and nothing else. ${PENDING_RULE}`,
    inputSchema: { type: 'object', required: ['as_of'], properties: {
      practice: { type: 'object', description: 'PracticeFacts: what the entity DOES — monitors_employee_communications, notified_hhs_secretary_of_breach, provides_addictive_feed, …' },
      purpose: { type: 'object', description: 'PurposeFacts: why data is used.' },
      law: { type: 'object', description: 'LawFacts: federal_instrument, state_requirement_subject — for preemption predicates.' },
      entity: { type: 'object' }, data: { type: 'object' }, as_of: { type: 'string' } } } },

  { name: 'privacy_obligations',
    description: `Obligation atoms for one instrument that are in force on a date. ${CITE_RULE}`,
    inputSchema: { type: 'object', required: ['instrument_id', 'as_of'], properties: {
      instrument_id: { type: 'string' }, as_of: { type: 'string' } } } },

  { name: 'privacy_cite',
    description: `THE ANTI-HALLUCINATION PRIMITIVE. Returns the verbatim span for an atom id with its source ` +
      `URL, fetch date and hash, plus any operative context the span depends on — or fails. Call this before ` +
      `asserting any citation. If it fails, you do not have the citation.`,
    inputSchema: { type: 'object', required: ['atom_id'], properties: { atom_id: { type: 'string' } } } },

  { name: 'privacy_definition',
    description: `Definition records for a term, with differs_from showing how the same term differs across ` +
      `instruments. "Personal information" means different things under FCRA, GLBA, HIPAA, COPPA and NY ` +
      `SHIELD; assuming one meaning across instruments is a common and consequential error. ${CITE_RULE}`,
    inputSchema: { type: 'object', required: ['term'], properties: {
      term: { type: 'string' }, instrument_id: { type: 'string' } } } },

  { name: 'privacy_deadline',
    description: `Compute a deadline from a trigger date. Returns the date AND the governing language, ` +
      `because a date without its standard misleads: "without unreasonable delay and in no case later than ` +
      `60 days" is a promptness obligation with a ceiling, not a 60-day allowance.`,
    inputSchema: { type: 'object', required: ['atom_id', 'trigger_date'], properties: {
      atom_id: { type: 'string' }, trigger_date: { type: 'string' } } } },

  { name: 'privacy_triggers',
    description: 'The controlled vocabulary of deadline triggers: every key that can start a clock, its ' +
      'human label, its family, and which records use it. Call this BEFORE guessing an event key — a date ' +
      'supplied under an unrecognised key starts no clock and there is no generic fallback. Family keys ' +
      'date every member trigger at once, which is how one incident starts many statutes\' clocks.',
    inputSchema: { type: 'object', properties: {} } },

  { name: 'privacy_facts',
    description: 'THE INPUT VOCABULARY. Every fact key the corpus predicates on, what values it takes, ' +
      'which instruments it gates, and which keys are reachable ONLY through an exemption. Call this ' +
      'before guessing a key: 127 keys gated the corpus with no way to discover them, and two concepts ' +
      'were spelled two ways each, so "we are a HIPAA covered entity" returned 10, 3 or 13 obligations ' +
      'depending on the spelling guessed. Also reports AMBIGUOUS TERMS whose ordinary meaning spans ' +
      'several statutory definitions — "financial institution" is three different populations.',
    inputSchema: { type: 'object', properties: {
      namespace: { type: 'string', description: 'entity | data | event | practice | purpose | law' },
      instrument_id: { type: 'string', description: 'only keys gating this instrument' },
      q: { type: 'string', description: 'substring match on the key name' } } } },

  { name: 'privacy_incidents',
    description: 'The controlled vocabulary of INCIDENT CHARACTERISATIONS, grouped into families. One set ' +
      'of facts can satisfy several at once — a lost laptop of patient records is a breach of unsecured ' +
      'PHI under 45 C.F.R. 164.402 AND a breach of the security of the system under N.Y. GBL 899-aa(1)(c), ' +
      'with different definitions and different clocks. event.type takes a LIST. Each entry names the test ' +
      'that decides it, because these are legal determinations the engine will not make for you.',
    inputSchema: { type: 'object', properties: {} } },

  { name: 'privacy_workflow',
    description: 'Run a lifecycle deliverable workflow and return the artifact WITH ITS CHECKLIST. An ' +
      'artifact that fails its own checklist is returned with the failures marked, never as though it ' +
      'passed. Names: privacyImpactAssessment, noticeGapAnalysis, rightsRequestHandling, ' +
      'breachNotificationTimeline.',
    inputSchema: { type: 'object', required: ['workflow'], properties: {
      workflow: { type: 'string' }, entity: { type: 'object' }, data: { type: 'object' },
      incident: { type: 'object' }, request: { type: 'object' }, notice: { type: 'object' },
      processing: { type: 'object' }, context: { type: 'object' } } } },

  { name: 'privacy_memo',
    description: 'THE DEFENSIBILITY RECORD. Runs the analysis and returns a citable document: the facts ' +
      'asserted, every applicable provision with its verbatim text, source URL, sha256, vintage and the ' +
      'KIND of date that vintage rests on, the deadline table, the characterisations not yet made, what ' +
      'the corpus could not determine, and a verification table. Ask for this when the answer has to be ' +
      'handed to someone. It reports what it does NOT know as prominently as what it does, which is the ' +
      'property that makes it defensible — citing real authorities does not absolve counsel who cannot ' +
      'show what was checked.',
    inputSchema: { type: 'object', required: ['as_of'], properties: {
      entity: { type: 'object' }, data: { type: 'object' }, event: { type: 'object' },
      practice: { type: 'object' }, purpose: { type: 'object' }, law: { type: 'object' },
      as_of: { type: 'string' }, state_layers: { type: 'array', items: { type: 'string' } },
      matter: { type: 'string', description: 'free-text matter reference, carried into the record' },
      format: { type: 'string', description: 'markdown (default) | json' } } } },

  { name: 'privacy_translate',
    description: `Translate an external engineering vocabulary — Ethyca's Fideslang data `
      + `categories and data subjects — into this corpus's fact keys. Returns FOUR lists and the `
      + `distinction between them is the whole point: \`assert\` is safe to set, \`conditional\` `
      + `is NOT set and names the fact needed first, \`surface\` overlaps without matching, and `
      + `\`unmapped\` is declared rather than dropped. A data category says what information IS; `
      + `most legal facts turn on WHO HOLDS IT — user.health_and_medical is not PHI unless a `
      + `covered entity holds it, and asserting otherwise would hand a wellness app the HIPAA `
      + `Privacy Rule. Never promote a conditional row yourself. ` + PENDING_RULE,
    inputSchema: { type: 'object',
      properties: { terms: { type: 'array', items: { type: 'string' } },
        term: { type: 'string' }, vocabulary: { type: 'string' }, facts: { type: 'object' } } } },
  { name: 'privacy_profile',
    description: `A STANDING FACT SET for one entity, and what moved since it was last checked. `
      + `action: list | show | save | check. \`check\` re-runs the analysis, compares against the `
      + `receipt stored at the last check, and separates THREE causes a single alert would `
      + `collapse: the corpus moved (records added, removed or re-cut), the facts were edited, or `
      + `the answer moved with both stable. A legal-change diff is computed only when the date `
      + `moved and the facts did not — if someone edited the facts, the obligation delta follows `
      + `from the edit and attributing it to legal change would be wrong. The first check records `
      + `a baseline and says so rather than reporting "no changes", which is indistinguishable `
      + `from a real all-clear. Every check APPENDS to \`history\`, the register of what this `
      + `profile has been asked and when, each entry carrying the \`moved\` attribution — so the `
      + `trajectory shows when an answer moved and what moved with it, not merely the latest row. `
      + `Editing the facts preserves the register. Profiles are USER DATA and are never evidence `
      + `about the law. `
      + PENDING_RULE,
    inputSchema: { type: 'object',
      properties: { action: { type: 'string' }, name: { type: 'string' },
        facts: { type: 'object' }, description: { type: 'string' },
        as_of: { type: 'string' }, record: { type: 'boolean' } },
      required: ['action'] } },
  { name: 'privacy_may_i',
    description: `MAY I? — the question obligations do not answer. Sorts the records that apply `
      + `to these facts into what PROHIBITS, what PERMITS and what allows only ON A CONDITION. `
      + `CRITICAL: where a general prohibition applies — 45 C.F.R. 164.502(a) is drafted "may not `
      + `use or disclose ... except as permitted" — silence is NOT permission, and the result `
      + `sets default_deny and says so. Never report an empty prohibitions list as a yes. The `
      + `operation string is echoed, NOT matched against any provision: these are the records `
      + `that apply to the FACTS. This returns no verdict and neither should you. ` + PENDING_RULE,
    inputSchema: { type: 'object',
      properties: { entity: { type: 'object' }, data: { type: 'object' }, event: { type: 'object' },
        practice: { type: 'object' }, purpose: { type: 'object' }, law: { type: 'object' },
        as_of: { type: 'string' }, state_layers: { type: 'array', items: { type: 'string' } },
        operation: { type: 'string' } },
      required: ['as_of'] } },
  { name: 'privacy_brief',
    description: `Everything this corpus knows about ONE provision, assembled: the verbatim span `
      + `and its operative context, the typed carve-outs with their burden of proof, the `
      + `preemption posture and why, who enforces it, whether there is a private right of action, `
      + `the penalty structure and limitations period, what people commonly get wrong about it, `
      + `and what is still unresolved. Use it when a citation alone is not enough to advise on. `
      + `The analysis block is the extractor's own prose and NO gate verifies it — the verbatim `
      + `span is hash-anchored, the sentences around it are not, and you must carry that `
      + `distinction. ` + PENDING_RULE,
    inputSchema: { type: 'object',
      properties: { atom_id: { type: 'string' }, citation: { type: 'string' } } } },
  { name: 'privacy_receipt',
    description: `THE DEFENSIBILITY PRIMITIVE. Issues a reproducible digest of an analysis: `
      + `inputs_digest (the facts and as-of date), corpus_digest (every record id paired with the `
      + `sha256 of the SOURCE BYTES it quotes) and result_digest. Re-run later and compare `
      + `receipt_id. Pass verify:<receipt> to check one and be told WHICH digest moved — a `
      + `different question, a changed corpus, or a changed answer. A matching receipt proves `
      + `REPRODUCIBILITY, not correctness, and you must not present it as proof the answer is `
      + `right. ` + PENDING_RULE,
    inputSchema: { type: 'object',
      properties: { entity: { type: 'object' }, data: { type: 'object' }, event: { type: 'object' },
        practice: { type: 'object' }, purpose: { type: 'object' }, law: { type: 'object' },
        as_of: { type: 'string' }, state_layers: { type: 'array', items: { type: 'string' } },
        verify: { type: 'object' } },
      required: ['as_of'] } },
  { name: 'privacy_between',
    description: `What changed for ONE ENTITY'S FACTS between two dates. This is privacy_diff run `
      + `through a fact pattern rather than across the whole corpus. A DIFFERENCE BETWEEN TWO `
      + `DATES IS NOT AUTOMATICALLY A CHANGE IN THE LAW, and the result separates the two: `
      + `\`commenced\`/\`ceased\` are differences attributable to a dated legal event; `
      + `\`indeterminate\` are differences the corpus CANNOT attribute, because the record's `
      + `effective_from is the date its text was captured rather than the date it began; `
      + `\`unmeasurable\` names obligations whose only held text is younger than the from-date, so `
      + `the window was never put to them. Never report an indeterminate row as a new or repealed `
      + `duty. \`deadline_changes\` covers clocks whose duration or trigger moved. It compares `
      + `WHAT THIS CORPUS HELD at two dates, which is not the same as what the law did; the `
      + `caveat is in the result and you must carry it. ` + PENDING_RULE,
    inputSchema: { type: 'object',
      properties: { entity: { type: 'object' }, data: { type: 'object' }, event: { type: 'object' },
        practice: { type: 'object' }, purpose: { type: 'object' }, law: { type: 'object' },
        state_layers: { type: 'array', items: { type: 'string' } },
        from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'] } },
  { name: 'privacy_ground',
    description: `AUDIT CLAIMS AND THE CITATIONS OFFERED FOR THEM — including claims this server `
      + `did not produce. Give it [{proposition, citation, as_of, facts}] and it reports, per `
      + `claim, whether the citation resolves in this corpus, whether the provision was in force `
      + `on that date, whether it is enacted-but-pending or superseded, and — when facts are `
      + `supplied — whether it REACHES those facts. That last check is the one a click-through `
      + `cannot do: a provision that is real, quoted correctly, and inapplicable to the entity `
      + `being advised. Magesh et al. (Stanford RegLab, 2024) call this MISGROUNDING and measured `
      + `it at 17-33% in Lexis+ AI and Ask Practical Law AI; they note it is more dangerous than `
      + `an invented citation because it is harder to spot. TWO THINGS THIS NEVER SAYS: it never `
      + `reports a claim as CORRECT, because whether the quoted words support the proposition is a `
      + `reading and this engine does not make readings; and it never reports a citation as `
      + `FABRICATED, because coverage is federal law, New York State and New York City and a real `
      + `provision outside that scope resolves to nothing for the same reason an invented one `
      + `does. The clean status is NO_PROBLEM_FOUND, never "verified" — carry that distinction `
      + `into whatever you write. ` + PENDING_RULE,
    inputSchema: { type: 'object',
      properties: {
        claims: { type: 'array', items: { type: 'object',
          properties: { proposition: { type: 'string' }, citation: { type: 'string' },
                        as_of: { type: 'string' }, facts: { type: 'object' } } },
          description: 'The claims to audit. Each needs a citation; a proposition and facts make the check stronger.' },
        text: { type: 'string',
          description: 'PROSE to audit instead of structured claims — paste an answer and every '
            + 'citation in it is extracted and checked. Extraction is lexical; the sentence a '
            + 'citation sits in is used as its proposition, which is a guess about layout.' },
        facts: { type: 'object',
          description: 'Entity and data facts. Supplying them enables the inapplicable-authority check.' },
        as_of: { type: 'string', description: 'Default as-of date for claims that do not carry one.' },
        title: { type: 'string' } } } },
  { name: 'privacy_conform',
    description: `A CONFORMANCE WORKSHEET: every requirement a provision imposes, quoted verbatim `
      + `with its hash, laid beside a document for review. THE VERDICT COLUMN IS EMPTY BY DESIGN. `
      + `Whether the document satisfies a row is legal judgement — you may fill the column in, but `
      + `you must show the governing words and say that you are the one deciding. An optional `
      + `keyword signal reports vocabulary overlap ONLY and is not a determination: a notice `
      + `containing a required statement word for word scored 1/7 on overlap in testing, because `
      + `the requirement describes where the statement goes rather than repeating it. ` + PENDING_RULE,
    inputSchema: { type: 'object',
      properties: { document: { type: 'string' },
        citations: { type: 'array', items: { type: 'string' } },
        citation: { type: 'string' }, signal: { type: 'boolean' }, title: { type: 'string' } },
      required: ['document'] } },
  { name: 'privacy_crosswalk',
    description: `Declared correspondences between regimes — a New York safeguards limb against `
      + `its federal counterpart, a deemed-compliance route, a notice substitution — each `
      + `resolved to BOTH provisions' verbatim text with the sha256 of the bytes each was cut `
      + `from. A crosswalk here is an assertion a person recorded with a reason, never inferred `
      + `from similar wording, and \`basis\` says which: statutory (the statute names the other `
      + `instrument), structural (a shared enumerated scheme), or analytical (a reading). Quote `
      + `both sides so the reader can judge the link rather than trust it. Absence of a link `
      + `means nobody has asserted one, NOT that no correspondence exists. ` + PENDING_RULE,
    inputSchema: { type: 'object', properties: { citation: { type: 'string' } } } },
  { name: 'privacy_requirements',
    description: `THE CHECKLIST PRIMITIVE. Enumerates every element a provision requires — the `
      + `content of a HIPAA Notice of Privacy Practices (45 C.F.R. 164.520(b)), the terms of a `
      + `business-associate contract (164.504(e)(2)), what a breach letter must say (164.404(c), `
      + `N.Y. GBL 899-aa(7)) — each with its verbatim words, citation, paragraph path and the `
      + `sha256 of the bytes it was cut from. Pass SEVERAL citations to get the UNION across `
      + `regimes, deduplicated, with each element carrying every citation that demands it. `
      + `CRITICAL: the result carries not_held[], the elements present in the source segmentation `
      + `for which this corpus has no record. The list is a FLOOR, never the complete set, and you `
      + `must say so. The list is data; whether a document satisfies a row is a judgement this `
      + `tool does not make and neither should you present it as one. ` + PENDING_RULE,
    inputSchema: { type: 'object',
      properties: { citation: { type: 'string' },
                    citations: { type: 'array', items: { type: 'string' } },
                    include_segmentation: { type: 'boolean' } } } },
  { name: 'privacy_exposure',
    description: `WHAT IS ONE DECISION AWAY. Given the same facts as privacy_analyze, re-runs the `
      + `whole analysis once per counterfactual and reports what CHANGES: obligations a business `
      + `decision would ADD (opening an office, selling data, becoming a financial institution), `
      + `obligations an EVENT would add (a breach, a subpoena, a rights request), numeric `
      + `THRESHOLDS with the distance still to run, and duties owed only because of something the `
      + `entity is currently doing. Every row is a re-computation, not an inference. A row is a `
      + `change in the law that applies, NOT advice about whether to do the thing. Absence of a `
      + `row means this corpus holds nothing turning on that fact, not that nothing does. `
      + PENDING_RULE,
    inputSchema: { type: 'object',
      properties: { entity: { type: 'object' }, data: { type: 'object' },
        event: { type: 'object' }, practice: { type: 'object' }, purpose: { type: 'object' },
        law: { type: 'object' }, as_of: { type: 'string' },
        state_layers: { type: 'array', items: { type: 'string' } } },
      required: ['as_of'] } },
  { name: 'privacy_search',
    description: 'Find a provision by citation, by a phrase from its text, or by topic, across the WHOLE ' +
      'corpus. Results are labelled by kind: "analysed" means an applicability predicate has been written ' +
      'and the engine reasons with the record; "reference text" means the corpus holds a verified quotation ' +
      'with a verified citation and claims nothing more — no predicate, and the engine will not assert that ' +
      'it binds anyone. Most of the corpus is reference text. Use this to locate a provision, then ' +
      'privacy_cite to read it with its source URL and hash.',
    inputSchema: { type: 'object', required: ['q'], properties: {
      q: { type: 'string', description: 'a citation like "164.512", a phrase, or a topic' },
      record_type: { type: 'string', description: 'obligation | provision | definition | …' },
      instrument_id: { type: 'string' },
      limit: { type: 'number' } } } },

  { name: 'privacy_diff',
    description: 'What changed between two dates: atoms that came into force, ceased, or are pending. ' + PENDING_RULE,
    inputSchema: { type: 'object', required: ['from_date', 'to_date'], properties: {
      from_date: { type: 'string' }, to_date: { type: 'string' }, filter: { type: 'string' } } } },

  { name: 'privacy_preemption',
    description: 'Preemption posture and resolution between a federal and a state instrument. express_partial ' +
      'returns UNRESOLVED rather than an answer, because carve-outs are per-subject and some are date-limited.',
    inputSchema: { type: 'object', required: ['federal_id'], properties: {
      federal_id: { type: 'string' }, state_id: { type: 'string' }, as_of: { type: 'string' } } } },

  { name: 'privacy_coverage',
    description: 'Corpus completeness at a taxonomy coordinate: which atoms exist, and what is missing. Use it to ' +
      'find out whether silence means "no obligation" or "not yet modelled" — they are different answers.',
    inputSchema: { type: 'object', properties: { domain_coordinate: { type: 'string' } } } },
];

const ANNOT = { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true };

// ONE PLACE that turns tool arguments into an engine context. A function rather than repeated
// inline, so a namespace cannot be added to the engine and forgotten in one handler out of three
// — which is exactly how practice, purpose and law went missing.
// NOTE the parameter name: `toolArgs`, never `a`. tools/check-engine-schema.mjs reads `a.law` as
// a RECORD field access and would report this as the engine depending on a field no record
// carries — the same ambiguity engine/coverage.mjs documents for gate 22. Rename the variable,
// never the check.
const ctx = toolArgs => ({
  as_of: toolArgs.as_of,
  state_layers: toolArgs.state_layers ?? [],
  include_pending: !!toolArgs.include_pending,
  event: toolArgs.event ?? {},
  practice: toolArgs.practice ?? {},
  purpose: toolArgs.purpose ?? {},
  law: toolArgs.law ?? {},
});

function call(name, args = {}) {
  const corpus = load();
  switch (name) {
    // EVERY NAMESPACE THE ENGINE FILLS MUST CROSS THIS BOUNDARY. This forwarded entity, data and
    // event and silently dropped practice, purpose and law, so 74 of 248 records carried at least
    // one predicate that could NEVER be true through the product surface — including
    // practice.notified_hhs_secretary_of_breach, the trigger for the earliest deadline in the
    // worked example. The engine populated the namespace; the layer above never passed it.
    case 'privacy_analyze':
      return analyze(args.entity ?? {}, args.data ?? {}, ctx(args));
    case 'privacy_applicable': {
      const r = analyze(args.entity ?? {}, args.data ?? {}, ctx(args));
      return { as_of: r.as_of, applicable: r.applicable, unknown_facts: r.unknown_facts,
               coverage_gaps: r.coverage_gaps, error: r.error };
    }
    case 'privacy_obligations': {
      if (!args.as_of) return { error: 'as_of is required' };
      // PRESENCE IS NOT VALIDITY. Date comparisons here are string comparisons, so as_of
      // 'not-a-date' sorted above every real date, inForceOn returned true for everything and
      // this tool answered with the entire instrument — including law not yet in force —
      // reporting a typo as a wider answer instead of an error. Same defect analyze() documents
      // fixing at its own entry point; this one was never given the check.
      if (!isRealDate(args.as_of)) return { error: badDateReason('as_of', args.as_of) };
      const atoms = corpus.obligations.filter(a => a.source.instrument_id === args.instrument_id
        && inForceOn(a, args.as_of) && surfaceable(a));
      return { instrument_id: args.instrument_id, as_of: args.as_of, count: atoms.length,
               obligations: atoms.map(a => ({ id: a.id, citation: a.source.citation,
                 obligation_type: a.obligation_type, summary: a.summary, deadline: a.deadline })) };
    }
    case 'privacy_cite': {
      const a = corpus.byId.get(args.atom_id);
      if (!a) return { error: `no record with id "${args.atom_id}". You do not have this citation.`, verified: false };
      if (!surfaceable(a)) return { error: `record "${a.id}" is ${a.verification_status}, not verbatim_confirmed. ` +
        `Invariant I1 forbids surfacing it.`, verified: false };
      return { verified: true, atom_id: a.id, citation: a.source.citation,
        verbatim_span: a.verbatim_span, source_url: a.source.url, fetched: a.source.fetched,
        raw_sha256: a.source.raw_sha256, format: a.source.format,
        span_interruptions: a.span_interruptions ?? [],
        operative_context: (a.operative_context ?? []).map(x => ({ position: x.position, relation: x.relation,
          citation: x.citation, verbatim_span: x.verbatim_span })),
        context_warning: (a.operative_context ?? []).length
          ? 'This span depends on the operative_context above. Quoting it alone may be verbatim and still substantively wrong.'
          : null,
        source_defects: a.source_defects ?? [] };
    }
    case 'privacy_definition': {
      const defs = corpus.all.filter(r => r.record_type === 'definition'
        && (r.term ?? '').toLowerCase() === String(args.term).toLowerCase()
        && (!args.instrument_id || r.source.instrument_id === args.instrument_id));
      return { term: args.term, count: defs.length,
        definitions: defs.map(d => ({ id: d.id, instrument_id: d.source.instrument_id,
          citation: d.source.citation, verbatim_span: d.verbatim_span, differs_from: d.differs_from ?? [] })),
        note: defs.length ? null
          : 'No definition record for this term is in the corpus. That is a COVERAGE GAP, not a finding that the term is undefined.' };
    }
    case 'privacy_deadline': {
      const a = corpus.byId.get(args.atom_id);
      if (!a) return { error: `no record with id "${args.atom_id}"` };
      // An explicit per-atom call IS a direct assertion about this atom's own trigger, so it is
      // recorded as such — that is what distinguishes it from a date inherited from a family key.
      const d = computeDeadline(a, args.trigger_date,
        args.trigger_date ? { via: 'explicit', supplied_as: null } : null);
      return d ?? { atom_id: a.id, error: 'this atom carries no deadline' };
    }
    // WITHOUT THIS, A CALLER STILL HAS TO GUESS. The whole defect being fixed here was an
    // interface whose keys were invisible: the corpus knew the trigger names, the docstring
    // guessed at one of them, and a caller had no way to enumerate the rest. Now it can ask.
    case 'privacy_triggers':
      return { count: TRIGGER_KEYS.length,
        families: Object.entries(FAMILIES).map(([key, meaning]) => ({ key, meaning,
          members: TRIGGER_KEYS.filter(t => TRIGGERS[t].family === key) })),
        triggers: TRIGGER_KEYS.map(key => ({ key, label: TRIGGERS[key].label,
          family: TRIGGERS[key].family, standard: TRIGGERS[key].standard ?? null,
          used_by: corpus.obligations
            .filter(a => a.deadline?.trigger_event === key)
            .map(a => ({ atom_id: a.id, citation: a.source.citation })) })),
        note: 'Supply any of these as event.<key> = "YYYY-MM-DD". A family key dates every member '
            + 'at once and each result reports trigger_via: "family". A date under a key not in '
            + 'this list starts no clock — there is no generic fallback.' };
    case 'privacy_facts': {
      let inv = factInventory(corpus);
      if (args.namespace) inv = inv.filter(k => k.namespace === args.namespace);
      if (args.instrument_id) inv = inv.filter(k => k.instruments.includes(args.instrument_id));
      if (args.q) inv = inv.filter(k => k.key.includes(String(args.q)));
      return { count: inv.length, namespaces: NAMESPACES, keys: inv,
        ambiguous_terms: AMBIGUOUS_TERMS,
        note: 'Supply these under the matching namespace, e.g. {entity: {is_hipaa_covered_entity: true}}. '
            + 'A key with exemption_only: true is reachable ONLY through an exemption predicate, so '
            + 'nothing else in the corpus demonstrates it — those carve-outs stay dormant unless you '
            + 'supply the key deliberately.' };
    }
    case 'privacy_incidents':
      return { count: INCIDENT_KEYS.length,
        families: Object.entries(INCIDENT_FAMILIES).map(([key, meaning]) => ({ key, meaning,
          members: INCIDENT_KEYS.filter(k => INCIDENTS[k].family === key) })),
        characterisations: INCIDENT_KEYS.map(key => ({ key, ...INCIDENTS[key],
          used_by: corpus.obligations
            .filter(a => JSON.stringify(a.applies_if ?? {}).includes(key))
            .map(a => ({ atom_id: a.id, citation: a.source.citation })) })),
        note: 'event.type accepts a LIST. Characterisations within one family are alternative legal '
            + 'descriptions of the SAME facts and are routinely all true at once; across families they '
            + 'are different events. Any you do not assert are reported back in '
            + 'characterisation_required rather than silently excluded.' };
    case 'privacy_workflow': {
      const fn = Object.hasOwn(WORKFLOWS, String(args.workflow)) ? WORKFLOWS[args.workflow] : null;
      if (!fn) return { error: `no workflow named "${args.workflow}". Available: ` +
        Object.keys(WORKFLOWS).join(', ') };
      return fn(args);
    }
    case 'privacy_memo': {
      const m = buildMemo(args.entity ?? {}, args.data ?? {}, ctx(args), { matter: args.matter ?? null });
      if (m.error) return { error: m.error };
      return args.format === 'json'
        ? { record: m.record }
        : { markdown: m.markdown, record: m.record };
    }
    case 'privacy_translate':
      return translate(args.terms ?? args.term, { vocabulary: args.vocabulary, facts: args.facts });
    case 'privacy_profile': {
      switch (args.action) {
        case 'list': return { dir: profileDir(), profiles: listProfiles() };
        case 'show': return readProfile(args.name);
        case 'save': return saveProfile(args.name, args.facts ?? {}, { description: args.description });
        case 'check': return checkProfile(args.name, args.as_of, load(), { record: args.record !== false });
        default: return { error: `unknown profile action "${args.action}". Use list, show, save or check.` };
      }
    }
    case 'privacy_may_i':
      return mayI(args.entity ?? {}, args.data ?? {}, ctx(args), args.operation ?? null, load());
    case 'privacy_brief':
      return brief(args.atom_id ?? args.citation ?? null, load());
    case 'privacy_receipt':
      return args.verify
        ? verifyReceipt(args.verify, args.entity ?? {}, args.data ?? {}, ctx(args), load())
        : issueReceipt(args.entity ?? {}, args.data ?? {}, ctx(args), load());
    case 'privacy_between':
      return betweenDates(args.entity ?? {}, args.data ?? {}, ctx(args), args.from, args.to, load());
    case 'privacy_ground': {
      const audit = args.text
        ? groundText(args.text, load(), { as_of: args.as_of, facts: args.facts })
        : ground(args.claims, load(), { as_of: args.as_of, facts: args.facts });
      if (audit.error) return { error: audit.error };
      return { ...audit, markdown: groundMarkdown(audit, args.title ?? null) };
    }
    case 'privacy_conform': {
      const sheet = conform(args.document, args.citations ?? args.citation, load(),
                            { signal: args.signal === true });
      if (sheet.error) return { error: sheet.error };
      return { ...sheet, markdown: conformMarkdown(sheet, args.title ?? null) };
    }
    case 'privacy_crosswalk':
      return crosswalks(args.citation ?? null, load());
    case 'privacy_requirements': {
      const list = Array.isArray(args.citations) ? args.citations
                 : (args.citation ? [args.citation] : []);
      if (!list.length) return { error: 'give citations: [..] or citation: "..."' };
      const opts = { include_segmentation: args.include_segmentation === true };
      if (list.length === 1) {
        const one = requirementsFor(list[0], load(), opts);
        return { ...one, sources: [{ citation: list[0], count: one.count }],
                 not_held: one.denominator?.missing ?? [] };
      }
      return unionRequirements(list, load(), opts);
    }
    case 'privacy_exposure': {
      const result = exposure(args.entity ?? {}, args.data ?? {}, ctx(args), load());
      if (result.error) return { error: result.error };
      return result;
    }
    case 'privacy_search':
      return search(args.q, args);
    case 'privacy_diff': {
      // BOTH ENDS, BEFORE EITHER IS COMPARED. This tool brackets the corpus with
      // `effective_from > from_date && effective_from <= to_date`, and a malformed to_date sorts
      // ABOVE every real date — so `to_date: 'not-a-date'` reported 30 provisions coming into
      // force where the true answer was 20. The typo did not fail; it quietly added ten.
      for (const [k, v] of [['from_date', args.from_date], ['to_date', args.to_date]])
        if (!isRealDate(v)) return { error: badDateReason(k, v) };
      const came = corpus.obligations.filter(a => a.effective_from && a.effective_from > args.from_date && a.effective_from <= args.to_date);
      const went = corpus.obligations.filter(a => a.effective_to && a.effective_to > args.from_date && a.effective_to <= args.to_date);
      const pend = corpus.obligations.filter(a => ['enacted_pending', 'proposed'].includes(a.status));
      return { from_date: args.from_date, to_date: args.to_date,
        came_into_force: came.map(a => ({ id: a.id, citation: a.source.citation, effective_from: a.effective_from })),
        ceased: went.map(a => ({ id: a.id, citation: a.source.citation, effective_to: a.effective_to })),
        pending_watch: pend.map(a => ({ id: a.id, status: a.status, effective_from: a.effective_from,
          note: 'NOT LAW. Watch feed only.' })) };
    }
    case 'privacy_preemption': {
      const f = corpus.byId.get(args.federal_id);
      if (!f) return { error: `no record with id "${args.federal_id}"` };
      // as_of is not compared here — it is ECHOED into the answer, which is worse in one narrow
      // way: a malformed date is reported back as the date the resolution was made as of, and
      // gets quoted. Optional, so absence is fine; present-and-malformed is not.
      if (args.as_of !== undefined && args.as_of !== null && !isRealDate(args.as_of))
        return { error: badDateReason('as_of', args.as_of) };
      return resolvePreemption(f, args.state_id ? corpus.byId.get(args.state_id) : null, args.as_of ?? null);
    }
    case 'privacy_coverage': {
      const coord = args.domain_coordinate ?? args.bok_coordinate;   // old name still accepted
      // INVARIANT I1 APPLIES TO COVERAGE TOO. This filtered corpus.all with no surfaceable()
      // check, so four records suppressed by I1 — three doctrines and an enforcement action that
      // quote nothing — were reported as coverage. No unverified TEXT escaped, because this tool
      // returns ids and counts; what escaped was the claim that the corpus covers them.
      const visible = corpus.all.filter(surfaceable);
      const hidden = corpus.all.length - visible.length;
      const hits = visible.filter(r => !coord || r.subject?.domain === coord || r.subject?.domain?.startsWith(coord + '.'));
      const byType = {};
      for (const h of hits) byType[h.record_type] = (byType[h.record_type] ?? 0) + 1;
      return { domain_coordinate: coord ?? '(all)', total: hits.length, by_record_type: byType,
        suppressed_by_i1: hidden,
        ids: hits.map(h => h.id),
        note: hits.length ? null
          : `Nothing in the corpus at ${coord}. Silence here means NOT YET MODELLED, not "no obligation exists".` };
    }
    default:
      return { error: `unknown tool "${name}"` };
  }
}

// ------------------------------------------------------------------ JSON-RPC over stdio
const send = m => process.stdout.write(JSON.stringify(m) + '\n');

export function serve() {
  createInterface({ input: process.stdin }).on('line', line => {
    // JSON-RPC 2.0 requires -32700 on unparseable input. Returning nothing left a client waiting
    // for a reply that was never coming, which is the worst of the three possible behaviours:
    // worse than an error, and worse than a crash, because it is indistinguishable from slowness.
    let msg;
    try { msg = JSON.parse(line); }
    catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  const { id, method, params } = msg;
  if (method === 'initialize')
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05',
      capabilities: { tools: {} }, serverInfo: { name: 'privacy-kb', version: VERSION } } });
  if (method === 'tools/list')
    return send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(t => ({ ...t, annotations: ANNOT })) } });
  if (method === 'tools/call') {
    const out = call(params?.name, params?.arguments ?? {});
    return send({ jsonrpc: '2.0', id, result: {
      content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
      structuredContent: out, isError: !!out?.error } });
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
  });
}

// Only listen when run as a server. Importing this module for tests must not hang.
if (process.argv[1] && process.argv[1].endsWith('server.mjs')) serve();

export { TOOLS, call };
