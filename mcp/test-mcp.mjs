#!/usr/bin/env node
// MCP surface tests: the protocol handshake over real stdio, and the behaviour of each
// tool. privacy_cite gets the most attention — it is the anti-hallucination primitive, so
// its failure mode matters more than its success mode.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { TOOLS, call } from './server.mjs';
import { resolve } from 'node:path';

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fail++; };

// ---------------------------------------------------------------- tool surface
ok('nine tools, per SCHEMA.md §5', TOOLS.length === 9, `(${TOOLS.length})`);
ok('every tool declares an input schema', TOOLS.every(t => t.inputSchema?.type === 'object'));
ok('as_of is required wherever a query resolves law', 
   ['privacy_analyze','privacy_applicable','privacy_obligations'].every(n =>
     TOOLS.find(t => t.name === n).inputSchema.required?.includes('as_of')));
ok('tool descriptions instruct the caller to verify citations',
   TOOLS.filter(t => /privacy_(analyze|obligations|definition)/.test(t.name))
        .every(t => /privacy_cite/.test(t.description)));
ok('tool descriptions warn that pending law is not law',
   TOOLS.filter(t => /privacy_(analyze|applicable|diff)/.test(t.name))
        .every(t => /NOT LAW|not law/i.test(t.description)));

// ---------------------------------------------------------------- privacy_cite
{
  const good = call('privacy_cite', { atom_id: 'us.hipaa.breach.164_404.timeliness' });
  ok('cite returns verbatim text with provenance', good.verified && good.verbatim_span && good.source_url && good.raw_sha256);
  const bad = call('privacy_cite', { atom_id: 'us.hipaa.breach.164_404.invented' });
  ok('cite on an invented id FAILS rather than improvising', bad.verified === false && !!bad.error);
  ok('the failure says you do not have the citation', /do not have this citation/.test(bad.error));
  const ctx = call('privacy_cite', { atom_id: 'us.facta.disposal.682_3.examples_are_not_requirements' });
  ok('cite surfaces operative_context', ctx.operative_context.length > 0);
  ok('cite warns that the span alone may mislead', /substantively wrong/.test(ctx.context_warning ?? ''));
}

// ---------------------------------------------------------------- other tools
{
  const a = call('privacy_analyze', { entity: { glba_financial_institution: true },
    as_of: '2026-08-19', event: { type: 'notification_event', consumers_affected: 600, discovery_of_notification_event: '2026-08-01' } });
  ok('analyze returns obligations and never-empty backstops', a.obligations.length > 0 && a.backstops.length > 0);
  ok('analyze without as_of errors rather than defaulting', !!call('privacy_analyze', {}).error);
  const d = call('privacy_deadline', { atom_id: 'us.glba.safeguards.314_4.ftc_notification', trigger_date: '2026-08-01' });
  ok('deadline computes and carries the governing language', d.computed === '2026-08-31' && !!d.governing_language);
  const p = call('privacy_preemption', { federal_id: 'us.fcra.1681t.b1e_report_contents', as_of: '2026-08-19' });
  ok('express_partial preemption returns UNRESOLVED, not a guess', p.unresolved === true);
  const cov = call('privacy_coverage', { bok_coordinate: 'V.C' });
  ok('coverage says "not yet modelled" rather than "no obligation"', /NOT YET MODELLED/.test(cov.note ?? ''));
  const def = call('privacy_definition', { term: 'consumer report' });
  ok('a missing definition is reported as a coverage gap', /COVERAGE GAP/.test(def.note ?? ''));
  ok('an unknown tool name errors', !!call('privacy_nope', {}).error);
}

// ---------------------------------------------------------------- live protocol
const srv = spawn('node', [resolve(import.meta.dirname, 'server.mjs')], { stdio: ['pipe','pipe','inherit'] });
const lines = [];
srv.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => lines.push(JSON.parse(l))));
const rpc = (id, method, params) => srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
rpc(1, 'initialize', {});
rpc(2, 'tools/list', {});
rpc(3, 'tools/call', { name: 'privacy_cite', arguments: { atom_id: 'us.vppa.2710.b1.disclosure_prohibition' } });
rpc(4, 'tools/call', { name: 'privacy_cite', arguments: { atom_id: 'nope' } });
await new Promise(r => setTimeout(r, 1200));
srv.kill();

const byId = Object.fromEntries(lines.map(l => [l.id, l]));
ok('initialize handshake returns serverInfo', byId[1]?.result?.serverInfo?.name === 'privacy-kb');
ok('tools/list returns nine tools over the wire', byId[2]?.result?.tools?.length === 9);
ok('every tool is annotated readOnly and closed-world',
   byId[2]?.result?.tools?.every(t => t.annotations?.readOnlyHint === true && t.annotations?.openWorldHint === false));
ok('tools/call returns structuredContent', !!byId[3]?.result?.structuredContent?.verbatim_span);
ok('a failed cite is flagged isError over the wire', byId[4]?.result?.isError === true);


// EVERY NAMESPACE THE ENGINE FILLS MUST CROSS THE TOOL BOUNDARY. privacy_analyze forwarded
// entity, data and event and dropped practice, purpose and law, so 74 of 248 records carried a
// predicate that could never be true through the product surface — including the trigger for the
// earliest deadline in the worked example. Nothing noticed, because a dropped namespace looks
// exactly like facts the caller did not supply.
{
  const NS = ['entity', 'data', 'event', 'practice', 'purpose', 'law'];
  const src = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  for (const n of NS)
    ok(`privacy_analyze forwards the ${n} namespace`, new RegExp(`${n}:\\s*toolArgs\\.${n}|${n}:\\s*args\\.${n}|args\\.${n} \\?\\?`).test(src));

  // and prove it end to end on the case that was broken
  const r = call('privacy_analyze', {
    entity: { owns_or_licenses_computerized_data: true, is_hipaa_covered_entity: true, nexus: 'US' },
    data: { includes_ny_private_information: true },
    as_of: '2026-09-02', state_layers: ['US-NY'],
    event: { type: 'breach_of_security_of_the_system' },
    practice: { notified_hhs_secretary_of_breach: true },
  });
  const hit = r.obligations.some(o => o.id === 'ny.gbl.899_aa.9.hipaa_ag_notice');
  ok('a practice.* predicate can actually be satisfied through the tool surface', hit,
     hit ? '' : 'ny.gbl.899_aa.9.hipaa_ag_notice did not fire — practice is being dropped again');
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
