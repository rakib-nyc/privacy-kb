#!/usr/bin/env node
// MCP server over the corpus and the engine. SCHEMA.md §5.
//
// Fourteen read-only tools. The corpus supplies the truth; whatever model is calling supplies
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
