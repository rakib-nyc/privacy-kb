#!/usr/bin/env node
// MCP server over the corpus and the engine. SCHEMA.md §5.
//
// Nine read-only tools. The corpus supplies the truth; whatever model is calling supplies
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
import { computeDeadline } from '../engine/timeline.mjs';
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
      entity: { type: 'object', description: 'EntityFacts: sectors, hipaa_role, glba_financial_institution, is_cra, employee_count, nexus, data_subject_jurisdictions, …' },
      data: { type: 'object', description: 'DataFacts: types, minors_involved, collected_via, sold_or_shared, cross_border, …' },
      as_of: { type: 'string', description: 'REQUIRED ISO date. There is no "current law" — only law as of a date.' },
      state_layers: { type: 'array', items: { type: 'string' }, description: "e.g. ['US-NY']" },
      include_pending: { type: 'boolean', description: 'Routes pending law to pending_watch ONLY. It never enters obligations.' },
      event: { type: 'object', description: 'Event facts, e.g. {type, consumers_affected, discovery_of_breach: "2026-08-01"}' } } } },

  { name: 'privacy_applicable',
    description: `Cheap variant of privacy_analyze: which instruments apply, and nothing else. ${PENDING_RULE}`,
    inputSchema: { type: 'object', required: ['as_of'], properties: {
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
    inputSchema: { type: 'object', properties: { bok_coordinate: { type: 'string' } } } },
];

const ANNOT = { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true };

function call(name, args = {}) {
  const corpus = load();
  switch (name) {
    case 'privacy_analyze':
      return analyze(args.entity ?? {}, args.data ?? {}, {
        as_of: args.as_of, state_layers: args.state_layers ?? [],
        include_pending: !!args.include_pending, event: args.event ?? {} });
    case 'privacy_applicable': {
      const r = analyze(args.entity ?? {}, args.data ?? {}, { as_of: args.as_of });
      return { as_of: r.as_of, applicable: r.applicable, unknown_facts: r.unknown_facts,
               coverage_gaps: r.coverage_gaps, error: r.error };
    }
    case 'privacy_obligations': {
      if (!args.as_of) return { error: 'as_of is required' };
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
      const d = computeDeadline(a, args.trigger_date);
      return d ?? { atom_id: a.id, error: 'this atom carries no deadline' };
    }
    case 'privacy_diff': {
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
      return resolvePreemption(f, args.state_id ? corpus.byId.get(args.state_id) : null, args.as_of ?? null);
    }
    case 'privacy_coverage': {
      const coord = args.bok_coordinate;
      const hits = corpus.all.filter(r => !coord || r.subject?.domain === coord || r.subject?.domain?.startsWith(coord + '.'));
      const byType = {};
      for (const h of hits) byType[h.record_type] = (byType[h.record_type] ?? 0) + 1;
      return { bok_coordinate: coord ?? '(all)', total: hits.length, by_record_type: byType,
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
    let msg; try { msg = JSON.parse(line); } catch { return; }
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
