#!/usr/bin/env node
// The command a person types. Everything here wraps the same engine the MCP server exposes —
// no second implementation, so the terminal and the assistant cannot drift apart.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { call } from '../mcp/server.mjs';
import { load } from '../engine/corpus.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const [cmd, ...rest] = process.argv.slice(2);
const today = () => new Date().toISOString().slice(0, 10);
const b = s => `\x1b[1m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;

const DISCLAIMER =
  dim('  Research prototype. Not legal advice, no warranty. Check every citation against the\n' +
      '  primary source before relying on it — each record carries its URL, date and hash.');

function usage() {
  console.log(`
${b('privacy-kb')} ${dim(VERSION)}  —  US federal + New York privacy law, as of a date

  ${b('privacy-kb doctor')}                    check the install is working
  ${b('privacy-kb setup')}                     print the Claude Desktop config to paste
  ${b('privacy-kb coverage')}                  what the corpus holds, and what it does not
  ${b('privacy-kb cite')} <record-id>          the verbatim text and where it came from
  ${b('privacy-kb deadlines')} --from <date>   every clock a breach starts, earliest first
  ${b('privacy-kb ask')} [flags]               which obligations apply

  ${b('Flags for ask/deadlines')}
    --hipaa            a HIPAA covered entity
    --ny-data          holds a New York resident's private information
    --ny-employer      has employees in New York
    --nyc-hiring       uses an automated hiring tool in New York City
    --minors           has users under 18
    --breach           a security breach has occurred
    --told-hhs         has notified the Secretary of HHS
    --as-of <date>     the date to answer as of (default: today)
    --json             machine-readable output

  ${b('Example')}
    privacy-kb ask --hipaa --ny-data --breach --told-hhs
${DISCLAIMER}
`);
}

function factsFrom(args) {
  const has = f => args.includes(f);
  const entity = {}, data = {}, practice = {}, event = {};
  if (has('--hipaa')) { entity.is_hipaa_covered_entity = true; data.is_phi = true; data.types = ['phi']; }
  if (has('--ny-data')) { entity.owns_or_licenses_computerized_data = true; data.includes_ny_private_information = true; }
  if (has('--ny-employer')) { entity.is_ny_employer = true; entity.is_employer = true; }
  if (has('--nyc-hiring')) { entity.uses_automated_employment_decision_tool = true; entity.nexus = 'US-NY-NYC'; }
  if (has('--minors')) { entity.is_ny_cdpa_operator = true; data.subject_is_cdpa_covered_user = true; data.types = [...(data.types ?? []), 'minor']; }
  if (has('--breach')) event.type = 'breach_of_security_of_the_system';
  if (has('--told-hhs')) practice.notified_hhs_secretary_of_breach = true;
  entity.within_ftc_jurisdiction = true;
  entity.in_or_affecting_commerce = true;
  entity.nexus ??= 'US-NY';
  const i = args.indexOf('--as-of');
  const as_of = i >= 0 ? args[i + 1] : today();
  return { entity, data, context: { as_of, event, practice, state_layers: ['US-NY'], include_pending: true } };
}

function ask(args) {
  const { entity, data, context } = factsFrom(args);
  const r = call('privacy_analyze', { entity, data, ...context });
  if (args.includes('--json')) return console.log(JSON.stringify(r, null, 2));
  if (r.error) return console.log(`\n  ${r.error}\n`);
  const corpus = load();
  console.log(`\n${b('Obligations in force as of ' + r.as_of)}  —  ${r.obligations.length} engaged\n`);
  const byInstrument = {};
  for (const o of r.applicable) (byInstrument[o.instrument_id] ??= []).push(o);
  for (const [inst, list] of Object.entries(byInstrument)) {
    console.log(`  ${b(inst)}`);
    for (const o of list) {
      console.log(`    ${o.citation}`);
      const a = corpus.byId.get(o.atom_id);
      if (a?.summary) console.log(dim(`      ${a.summary.slice(0, 92)}`));
      if (o.partial_carve_out) console.log(dim(`      carve-out: entity stays in scope for everything else`));
    }
  }
  if (r.pending_watch.length) {
    console.log(`\n${b('NOT LAW YET')} — enacted, not in force. Watch only.\n`);
    for (const p of r.pending_watch) console.log(`  ${p.citation.padEnd(32)} binds from ${p.effective_from}`);
  }
  console.log(`\n${b('These never switch off')}\n`);
  for (const x of r.backstops) console.log(`  ${x.citation ?? x.kind}`);
  const gaps = r.applicable.filter(o => o.instrument_completeness);
  if (gaps.length) {
    console.log(`\n${b('What this cannot tell you')}\n`);
    for (const g of gaps) for (const a of g.instrument_completeness.absent)
      console.log(`  ${g.instrument_id}: missing ${a.id} ${dim('(' + (a.citation_prefix ?? []).join(', ') + ')')}`);
  }
  console.log(`\n${DISCLAIMER}\n`);
}

function deadlines(args) {
  const i = args.indexOf('--from');
  const from = i >= 0 ? args[i + 1] : today();
  // privacy_deadline computes ONE record's clock. Which records are engaged is
  // privacy_analyze's question, so ask that first and compute each one it returns — the same
  // two-step a caller would do, rather than a third code path that could disagree with both.
  const { entity, data, context } = factsFrom([...args, '--breach']);
  const engaged = call('privacy_analyze', { entity, data, ...context });
  if (engaged.error) return console.log(`\n  ${engaged.error}\n`);
  const rows = engaged.deadlines
    .map(d => call('privacy_deadline', { atom_id: d.atom_id, trigger_date: from }))
    .filter(d => d && d.computed)
    .sort((a, c) => a.computed.localeCompare(c.computed));
  if (args.includes('--json')) return console.log(JSON.stringify(rows, null, 2));
  console.log(`\n${b('Clocks running from ' + from)}  —  earliest first\n`);
  for (const d of rows) {
    console.log(`  ${b(d.computed)}  ${String(d.duration).padEnd(18)} ${d.citation ?? d.atom_id}`);
    console.log(dim(`              from: ${d.trigger_event}`));
    if (d.business_day_basis) console.log(dim(`              business days = weekdays; public holidays NOT excluded`));
    if (d.caution) console.log(dim(`              ${d.caution.slice(0, 88)}`));
  }
  if (!rows.length) console.log('  (no deadlines engaged by those facts)');
  console.log(`\n${DISCLAIMER}\n`);
}

function doctor() {
  const checks = [];
  const major = Number(process.version.slice(1).split('.')[0]);
  checks.push(['Node.js ' + process.version, major >= 20, 'needs v20 or newer']);
  let corpus = null;
  try { corpus = load(); checks.push([`corpus loads — ${corpus.all.length} records`, true, '']); }
  catch (e) { checks.push(['corpus loads', false, String(e).slice(0, 60)]); }
  try { const r = call('privacy_coverage', {}); checks.push([`engine answers — ${r.total} records visible`, !r.error, r.error ?? '']); }
  catch (e) { checks.push(['engine answers', false, String(e).slice(0, 60)]); }
  const dated = call('privacy_analyze', { entity: {}, data: {}, as_of: today() });
  checks.push(['as-of dating works', !dated.error, dated.error ?? '']);
  const refused = call('privacy_analyze', { entity: {}, data: {}, as_of: 'not-a-date' });
  checks.push(['malformed dates are refused', !!refused.error, 'a bad date should NOT be accepted']);
  console.log('');
  let ok = true;
  for (const [name, pass, why] of checks) {
    console.log(`  ${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${pass ? '' : dim('  — ' + why)}`);
    ok &&= pass;
  }
  console.log(ok ? `\n  ${b('Ready.')} Try:  privacy-kb ask --hipaa --ny-data --breach --told-hhs\n`
                 : `\n  ${b('Not ready.')} Fix the ✗ lines above, then run doctor again.\n`);
  process.exit(ok ? 0 : 1);
}

function setup() {
  const server = join(ROOT, 'mcp', 'server.mjs');
  const cfgPath = platform() === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : platform() === 'win32'
      ? join(process.env.APPDATA ?? homedir(), 'Claude', 'claude_desktop_config.json')
      : join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
  const block = { mcpServers: { 'privacy-kb': { command: process.execPath, args: [server] } } };
  console.log(`\n${b('Claude Desktop setup')}\n`);
  console.log(`  Config file for this computer:\n    ${cfgPath}\n`);
  console.log(`  Paste this into it (merge with anything already there):\n`);
  console.log(JSON.stringify(block, null, 2).split('\n').map(l => '    ' + l).join('\n'));
  if (rest.includes('--write')) {
    let cur = {};
    if (existsSync(cfgPath)) { try { cur = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch {} }
    cur.mcpServers = { ...(cur.mcpServers ?? {}), ...block.mcpServers };
    mkdirSync(dirname(cfgPath), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify(cur, null, 2) + '\n');
    console.log(`\n  ${b('Written.')} Quit Claude Desktop completely and reopen it.\n`);
  } else {
    console.log(`\n  Or let this do it for you:  ${b('npm run setup -- --write')}`);
    console.log(`  Then quit Claude Desktop completely and reopen it.\n`);
  }
}

switch (cmd) {
  case 'doctor': doctor(); break;
  case 'setup': setup(); break;
  case 'ask': ask(rest); break;
  case 'deadlines': deadlines(rest); break;
  case 'cite': {
    // the tool's argument is atom_id. Passing record_id/id silently produced
    // 'no record with id "undefined"' while the process still exited 0 — which is how a broken
    // command survives a smoke test that only checks exit codes.
    if (!rest[0]) { console.log('\n  usage: privacy-kb cite <record-id>\n  e.g.   privacy-kb cite ny.gbl.899_aa.9.hipaa_ag_notice\n'); break; }
    const r = call('privacy_cite', { atom_id: rest[0] });
    if (r.error) { console.log(`\n  ${r.error}\n`); process.exitCode = 1; break; }
    console.log(`\n${b(r.citation ?? rest[0])}\n`);
    console.log(`  ${(r.verbatim_span ?? '').replace(/(.{88}\s)/g, '$1\n  ')}\n`);
    // keys are source_url / fetched / raw_sha256 — flat, not nested under source.
    // Guessing the shape printed "source: n/a", which quietly removes the one thing that makes
    // the instruction "check it against the source" possible to follow.
    const a = load().byId.get(rest[0]);
    console.log(dim(`  source:   ${r.source_url ?? 'n/a'}`));
    console.log(dim(`  fetched:  ${r.fetched ?? 'n/a'}`));
    console.log(dim(`  sha256:   ${String(r.raw_sha256 ?? '').slice(0, 32)}…`));
    console.log(dim(`  in force: ${a?.effective_from ?? '?'} → ${a?.effective_to ?? 'present'}  (status: ${a?.status ?? '?'})`));
    if (r.context_warning) console.log(dim(`  note:     ${r.context_warning.slice(0, 88)}`));
    console.log(`\n${DISCLAIMER}\n`);
    break;
  }
  case 'coverage': {
    const r = call('privacy_coverage', {});
    console.log(`\n  ${b(r.total + ' records')} visible · ${r.suppressed_by_i1} suppressed as unverified\n`);
    for (const [k, v] of Object.entries(r.by_record_type)) console.log(`    ${String(v).padStart(4)}  ${k}`);
    console.log(`\n${DISCLAIMER}\n`); break;
  }
  default: usage();
}
