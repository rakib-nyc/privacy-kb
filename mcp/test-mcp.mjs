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
ok('fourteen tools, per SCHEMA.md §5', TOOLS.length === 14, `(${TOOLS.length})`);
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
ok('tools/list returns fourteen tools over the wire', byId[2]?.result?.tools?.length === 14);
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


// THE TRIGGER VOCABULARY MUST BE DISCOVERABLE OVER THE TOOL SURFACE. The defect this replaced
// was an interface whose keys were invisible: the corpus knew the trigger names, the docstring
// guessed at one of them, and a caller following the documented shape got no computed date and
// no way to find out why.
{
  const t = call('privacy_triggers', {});
  ok('privacy_triggers returns the vocabulary', t.count > 0, `${t.count} keys`);
  ok('...grouped into families', (t.families ?? []).length > 0);
  ok('...and every family member is a real trigger key',
     t.families.every(f => f.members.every(m => t.triggers.some(x => x.key === m))));
  ok('...and every corpus trigger in use is listed',
     t.triggers.filter(x => x.used_by.length > 0).length > 0);
  ok('...naming which records use each one',
     t.triggers.find(x => x.key === 'discovery_of_breach')?.used_by.length >= 2);

  // The documented key must actually compute. This is the exact call an MCP client following
  // mcp/server.mjs's own docstring would make, and it used to return computed: null.
  const r = call('privacy_analyze', {
    entity: { is_hipaa_covered_entity: true, owns_or_licenses_computerized_data: true },
    data: { is_phi: true, types: ['phi'], includes_ny_private_information: true },
    as_of: '2026-09-09', state_layers: ['US-NY'],
    event: { type: 'breach_of_security_of_the_system', discovery_of_breach: '2026-08-01' },
  });
  const shield = r.deadlines.find(d => d.atom_id === 'ny.gbl.899_aa.2.notify_residents');
  ok('the DOCUMENTED event key computes a deadline', shield?.computed === '2026-08-31',
     String(shield?.computed));
  ok('...and reports it was asserted exactly, not inferred', shield?.trigger_via === 'exact');

  // A family key fans out, and says so.
  const fam = call('privacy_analyze', {
    entity: { is_hipaa_covered_entity: true, owns_or_licenses_computerized_data: true },
    data: { is_phi: true, types: ['phi'], includes_ny_private_information: true },
    as_of: '2026-09-09', state_layers: ['US-NY'],
    event: { type: 'breach_of_security_of_the_system', breach_discovery: '2026-08-01' },
  });
  const fs2 = fam.deadlines.find(d => d.atom_id === 'ny.gbl.899_aa.2.notify_residents');
  ok('a family key also computes', fs2?.computed === '2026-08-31');
  ok('...and is labelled an inference rather than an assertion', fs2?.trigger_via === 'family');

  // And a date under no recognised key starts nothing.
  const none = call('privacy_analyze', {
    entity: { is_hipaa_covered_entity: true, owns_or_licenses_computerized_data: true },
    data: { is_phi: true, types: ['phi'], includes_ny_private_information: true },
    as_of: '2026-09-09', state_layers: ['US-NY'],
    event: { type: 'breach_of_security_of_the_system', date: '2026-08-01' },
  });
  const ns = none.deadlines.find(d => d.atom_id === 'ny.gbl.899_aa.2.notify_residents');
  ok('a generic event.date starts NO clock', ns && ns.computed === null, String(ns?.computed));
  ok('...and the record is still returned, marked not started', ns?.clock_started === false);
}


// PRESENCE IS NOT VALIDITY. privacy_obligations checked only that as_of existed, and because
// every date comparison here is a string comparison, 'not-a-date' sorted above every real date
// and the tool returned the WHOLE instrument — including law not yet in force — for a typo.
{
  const good = call('privacy_obligations', { instrument_id: 'ny.gbl.899_aa', as_of: '2026-01-01' });
  ok('privacy_obligations answers for a real date', good.count > 0, `${good.count}`);
  for (const bad of ['not-a-date', '2026-13-01', '2026-02-30'])
    ok(`privacy_obligations REFUSES ${bad}`, !!call('privacy_obligations',
      { instrument_id: 'ny.gbl.899_aa', as_of: bad }).error);
  ok('...and a refusal does not smuggle obligations out with it',
     (call('privacy_obligations', { instrument_id: 'ny.gbl.899_aa', as_of: 'not-a-date' }).obligations ?? []).length === 0);
}


// EVERY TOOL THAT TAKES A DATE MUST REFUSE A BAD ONE. Four entry points had this defect and each
// was found separately; these assertions exist so a fifth cannot be added without noticing.
{
  ok('privacy_diff answers for real dates',
     (call('privacy_diff', { from_date: '2024-01-01', to_date: '2026-01-01' }).came_into_force ?? []).length > 0);
  // 'not-a-date' sorts ABOVE every real date, so this used to report 30 provisions coming into
  // force where the true answer was 20. The typo added ten rather than failing.
  for (const [f, t] of [['2024-01-01', 'not-a-date'], ['not-a-date', '2026-01-01'],
                        ['2026-02-30', '2026-01-01'], [undefined, undefined]])
    ok(`privacy_diff REFUSES ${JSON.stringify([f, t])}`,
       !!call('privacy_diff', { from_date: f, to_date: t }).error);
  ok('privacy_preemption refuses a malformed as_of it would otherwise echo into the answer',
     !!call('privacy_preemption', { federal_id: 'us.fcra.1681t.b1e_report_contents', as_of: 'not-a-date' }).error);
  ok('...but still answers when as_of is simply absent',
     !call('privacy_preemption', { federal_id: 'us.fcra.1681t.b1e_report_contents' }).error);
  ok('privacy_deadline refuses an impossible trigger date',
     call('privacy_deadline', { atom_id: 'ny.gbl.899_aa.2.notify_residents',
                                trigger_date: '2026-02-30' }).computed === null);
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
