#!/usr/bin/env node
// INVARIANT I1, ACROSS EVERY PUBLIC SURFACE.
//
// "A record that cannot be verified is verification_status: unverified and MUST NOT be surfaced
// in any output." The corpus holds four such records — three constitutional doctrines and one
// enforcement action whose span reads "PLACEHOLDER — no order text has been fetched."
//
// This has now failed twice. QA-03 found privacy_coverage returning suppressed ids. Red-teaming
// found privacy_brief returning the records whole, placeholder text and all. Both times the cause
// was identical: a NEW SURFACE read corpus.all and inherited the exposure, because filtering is
// opt-in and forgetting is silent.
//
// So the test is written against the SURFACES rather than against any one module. Every tool that
// can name a record is asked for each suppressed record by id and by citation, and must refuse.
// A tool added later that forgets to filter fails here rather than in production.
import { load } from '../engine/corpus.mjs';
import { call, TOOLS } from '../mcp/server.mjs';
import { brief } from '../engine/brief.mjs';
import { requirementsFor } from '../engine/requirements.mjs';
import { crosswalks } from '../engine/crosswalk.mjs';
import { mayI } from '../engine/permissions.mjs';
import { search } from '../engine/search.mjs';

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fail++; };

const kb = load();
const suppressed = (kb.all ?? []).filter(r => r.verification_status !== 'verbatim_confirmed');
ok('the corpus still holds suppressed records to test against', suppressed.length > 0,
   `${suppressed.length}`);

// NEEDLES COME FROM EVERY CONTENT-BEARING FIELD, NOT FROM verbatim_span ALONE.
//
// This list used to be verbatim_span only, and three of the four suppressed records hold an EMPTY
// verbatim_span — their substance is in doctrine_statement, source_authority and common_errors. So
// a test that certifies invariant I1 was searching for one fragment belonging to one record, and
// would have passed while a surface printed a suppressed doctrine statement in full. The denominator
// was what happened to be in the field the test thought of.
//
// The forbidden set is now derived by walking each suppressed record. Fields that EXIST to explain
// the suppression are excluded: open_questions and effective_from_evidence say "UNVERIFIED under
// invariant I1", and a surface quoting that is obeying the invariant, not breaking it.
const SAYS_WHY = new Set(['id', 'open_questions', 'effective_from_evidence', 'verification_status',
                          'not_yet_analysed', 'confidence', 'record_type']);
const forbidden = [];
const harvest = (value) => {
  if (typeof value === 'string') {
    const t = value.replace(/\s+/g, ' ').trim();
    if (t.length > 24) forbidden.push(t);
  } else if (Array.isArray(value)) value.forEach(harvest);
  else if (value && typeof value === 'object') Object.values(value).forEach(harvest);
};
for (const record of suppressed)
  for (const [field, value] of Object.entries(record)) if (!SAYS_WHY.has(field)) harvest(value);

// A leak probe that finds nothing because it is looking for nothing is the failure mode this
// whole file is about. Assert the needles exist before trusting a clean result.
ok('the forbidden set draws on more than one suppressed record',
   new Set(suppressed.filter(r => Object.entries(r).some(([f, v]) =>
     !SAYS_WHY.has(f) && JSON.stringify(v ?? '').length > 26)).map(r => r.id)).size >= suppressed.length,
   `${forbidden.length} fragment(s) from ${suppressed.length} record(s)`);

for (const record of suppressed) {
  ok(`brief refuses ${record.id}`, brief(record.id, kb).found === false);
  ok('brief refuses its citation too',
     brief(record.source?.citation ?? 'no-such-citation', kb).found === false);
  ok(`privacy_brief refuses ${record.id} over the wire`,
     call('privacy_brief', { atom_id: record.id }).found === false);
  ok(`privacy_cite refuses ${record.id}`,
     call('privacy_cite', { atom_id: record.id }).verified === false);
  ok(`requirements refuses ${record.source?.citation ?? record.id}`,
     requirementsFor(record.source?.citation ?? record.id, kb).found === false);
}

{
  const r = call('privacy_analyze', {
    entity: { is_hipaa_covered_entity: true }, data: { is_phi: true },
    as_of: '2026-09-15', state_layers: ['US-NY'] });
  const ids = new Set([...(r.applicable ?? []).map(h => h.atom_id),
                       ...(r.obligations ?? []).map(h => h.id)]);
  ok('analyze surfaces no suppressed record', suppressed.every(record => !ids.has(record.id)));
  ok('...and reports the suppression rather than hiding it', Array.isArray(r.unverified_excluded));
}

{
  const r = mayI({ is_hipaa_covered_entity: true }, { is_phi: true },
    { as_of: '2026-09-15', state_layers: ['US-NY'] }, 'anything', kb);
  const seen = [...r.prohibitions, ...r.permissions, ...r.conditions].map(row => row.atom_id);
  ok('may-i surfaces no suppressed record', suppressed.every(record => !seen.includes(record.id)));
}

{
  const r = crosswalks(null, kb);
  const quoted = r.crosswalks.flatMap(link => [link.left.atom_id, link.right.atom_id]).filter(Boolean);
  ok('crosswalk quotes no suppressed record',
     suppressed.every(record => !quoted.includes(record.id)));
}

{
  // Every needle, not the first two — and the first two used to be empty strings.
  let searched = 0, leaked = 0;
  for (const needle of forbidden) {
    const hits = search(needle.slice(0, 40), {});
    const ids = (hits.results ?? hits.hits ?? []).map(h => h.atom_id ?? h.id);
    searched += 1;
    if (suppressed.some(record => ids.includes(record.id))) leaked += 1;
  }
  ok('search returns no suppressed record for any of its own text', leaked === 0,
     `${searched} fragment(s) searched`);
}

{
  const outputs = [
    JSON.stringify(call('privacy_analyze', { entity: { is_hipaa_covered_entity: true },
      data: { is_phi: true }, as_of: '2026-09-15', state_layers: ['US-NY'] })),
    JSON.stringify(call('privacy_coverage', { bok_coordinate: 'V.A' })),
    JSON.stringify(call('privacy_crosswalk', {})),
    JSON.stringify(call('privacy_may_i', { entity: { is_hipaa_covered_entity: true },
      data: { is_phi: true }, as_of: '2026-09-15' })),
  ].join('\n');
  ok('no suppressed text appears in any sampled tool output',
     forbidden.every(span => !outputs.includes(span.slice(0, 48))),
     `${forbidden.length} fragment(s) checked`);
}

// EVERY READ-ONLY TOOL, NOT A SAMPLE OF FOUR. "Sampled" is how a surface gets added without being
// covered: privacy_brief, privacy_requirements and privacy_search each reached suppressed text at
// some point, and each was found by hand rather than here. Tools are called with a plausible
// argument set; one that rejects the arguments has still demonstrated it printed nothing.
{
  const args = {
    entity: { is_hipaa_covered_entity: true, is_consumer_reporting_agency: true, nexus: 'US' },
    data: { is_phi: true }, as_of: '2026-09-15', state_layers: ['US-NY'],
    atom_id: suppressed[0]?.id, citation: suppressed[0]?.source?.citation,
    q: 'commercial', query: 'commercial', bok_coordinate: 'V.A', jurisdiction: 'US',
    terms: ['user.health_and_medical'], document: 'text', citations: [],
  };
  const offenders = [];
  let called = 0;
  for (const tool of TOOLS) {
    let out;
    try { out = JSON.stringify(call(tool.name, args)); } catch { continue; }
    called += 1;
    const hit = forbidden.find(span => out.includes(span.slice(0, 48)));
    if (hit) offenders.push(`${tool.name} -> ${JSON.stringify(hit.slice(0, 50))}`);
  }
  ok(`no suppressed text appears in ANY tool's output (${called} of ${TOOLS.length} tools answered)`,
     offenders.length === 0, offenders.slice(0, 4).join(' | '));
}

// Annotations are merged onto the wire response rather than onto the TOOLS objects, so this is
// asserted in mcp/test-mcp.mjs against tools/list. Checking TOOLS here reported a defect that was
// my own test's, not the product's — recorded because a false positive in a safety test is its
// own kind of expensive.
ok('every tool declares an input schema', TOOLS.every(t => t.inputSchema?.type === 'object'));

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
