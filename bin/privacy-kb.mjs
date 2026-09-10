#!/usr/bin/env node
// The command a person types. Everything here wraps the same engine the MCP server exposes —
// no second implementation, so the terminal and the assistant cannot drift apart.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, platform } from 'node:os';
import { call } from '../mcp/server.mjs';
import { load } from '../engine/corpus.mjs';
import { isRealDate } from '../engine/dates.mjs';

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
  ${b('privacy-kb deadlines')} [flags]         which clocks have started, and which have not
  ${b('privacy-kb ask')} [flags]               which obligations apply
  ${b('privacy-kb triggers')}                  every event key that can start a clock

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

  ${b('Dating the clocks')}
    --from <date>      dates the one event your flags assert (--breach or --told-hhs)
    --event <k>=<date> any trigger by name, repeatable — see ${b('privacy-kb triggers')}

  ${dim('A clock starts only when its own trigger is dated. An obligation whose trigger has')}
  ${dim('no date is reported as NOT STARTED, never given a borrowed date.')}

  ${b('Example')}
    privacy-kb ask --hipaa --ny-data --breach --told-hhs
    privacy-kb deadlines --hipaa --ny-data --breach --from 2026-08-01
${DISCLAIMER}
`);
}

// An event flag asserts that a moment occurred; this says WHICH trigger key that moment dates,
// so `--from` has exactly one meaning per flag rather than a guess.
const EVENT_FLAGS = {
  '--breach': 'breach_discovery',
  '--told-hhs': 'notification_to_hhs_secretary',
};

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

  // EVENT DATES. `--event key=YYYY-MM-DD`, repeatable, keyed by the controlled vocabulary in
  // engine/triggers.mjs. `--from` is shorthand for the event the flags already assert: with
  // --breach it dates the breach_discovery FAMILY, so one assertion starts every breach clock
  // (HIPAA, SHIELD, HBNR, GLBA Safeguards) and each result says it was dated by family rather
  // than by that statute's own trigger. Without --breach, --from asserts nothing — because
  // there is no event to attach it to, and attaching it to all of them is precisely the bug
  // this replaced.
  // A DATE THE USER TYPED IS WHERE A TYPO ACTUALLY ORIGINATES, so it is refused here rather
  // than absorbed. `--from 2026-02-30` used to print "asserted: breach_discovery = 2026-02-30"
  // and then "no clock has started", which reads as "this obligation does not apply" — the
  // engine correctly declined an impossible date and the CLI reported that as an answer.
  const bad_dates = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--event') continue;
    const raw = String(args[i + 1] ?? '');
    const eq = raw.indexOf('=');
    const k = eq >= 0 ? raw.slice(0, eq) : raw;
    const v = eq >= 0 ? raw.slice(eq + 1) : '';
    if (!k || !v) { bad_dates.push([`--event ${raw}`, 'expected key=YYYY-MM-DD']); continue; }
    if (!isRealDate(v)) { bad_dates.push([`--event ${k}`, v]); continue; }
    event[k] = v;
  }
  const fi = args.indexOf('--from');
  const from = fi >= 0 ? args[fi + 1] : null;
  if (from !== null && !isRealDate(from)) bad_dates.push(['--from', from]);

  // WHICH EVENT DOES `--from` DATE? Each event flag asserts a different moment, so the answer
  // is only unambiguous when exactly one such flag is present. --breach dates the breach
  // discovery family; --told-hhs dates the HHS notification, which is a LATER and separate act
  // — § 899-aa(9)'s five-day AG clock runs from it, not from discovery, and that gap is the
  // trap two eval scenarios exist to catch. Given both flags and one date, the honest move is
  // to refuse: silently picking either one would answer a question the user did not ask.
  const present = Object.keys(EVENT_FLAGS).filter(has);
  let from_ambiguous = null;
  if (from && isRealDate(from)) {
    if (present.length === 1) event[EVENT_FLAGS[present[0]]] ??= from;
    else if (present.length > 1) from_ambiguous = present;
  }

  const i = args.indexOf('--as-of');
  const as_of = i >= 0 ? args[i + 1] : today();
  return { entity, data, from_ambiguous, bad_dates,
           context: { as_of, event, practice, state_layers: ['US-NY'], include_pending: true } };
}

/** Print the refusal and return true if any date the user typed is not a real calendar date. */
function refuseBadDates(bad) {
  if (!bad?.length) return false;
  console.log(`\n  ${b('That is not a date.')}\n`);
  for (const [flag, value] of bad) console.log(`    ${flag} ${dim(JSON.stringify(value))}`);
  console.log(`\n  Dates are YYYY-MM-DD and must be real: 2026-02-30 and 2026-13-01 are neither.`);
  console.log(`  Every date comparison here is a string comparison, so a malformed value does not`);
  console.log(`  fail on its own — it sorts above every real date and widens the answer.\n`);
  process.exitCode = 1;
  return true;
}

function ask(args) {
  const { entity, data, context, bad_dates } = factsFrom(args);
  if (refuseBadDates(bad_dates)) return;
  const r = call('privacy_analyze', { entity, data, ...context });
  // AN ERROR MUST REACH THE EXIT CODE, in JSON mode too. This printed the refusal and exited 0,
  // which is precisely the failure tests/test-cli.mjs was written about: `cite` once reported
  // 'no record with id "undefined"' and still exited 0, so a smoke test that checked only the
  // status called a broken command green. The same hole was sitting one function away.
  if (r.error) process.exitCode = 1;
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
  // THIS USED TO FORCE-INJECT `--breach` AND THEN DATE EVERY ENGAGED CLOCK FROM `--from`.
  // Two wrongs compounding: it asserted a breach the user had not, then applied that one date
  // to triggers that had nothing to do with a breach, so `deadlines --hipaa --ny-data --from D`
  // printed a § 899-aa(2) breach clock for a user who never said a breach occurred, alongside
  // HIPAA access- and amendment-request clocks all starting the same day. Now the flags mean
  // what they say, dates are resolved per trigger, and a clock with no asserted trigger is
  // REPORTED AS NOT STARTED rather than filtered out of the answer.
  const { entity, data, context, from_ambiguous, bad_dates } = factsFrom(args);
  if (refuseBadDates(bad_dates)) return;
  if (from_ambiguous) {
    console.log(`\n  ${b('--from is ambiguous here.')} You asserted ${from_ambiguous.join(' and ')}, which are`);
    console.log(`  DIFFERENT moments — a breach discovery and an HHS notification do not happen on`);
    console.log(`  the same day, and § 899-aa(9)'s clock runs from the second, not the first.\n`);
    console.log(`  Date them separately:`);
    for (const f of from_ambiguous) console.log(`    --event ${EVENT_FLAGS[f]}=<date>   ${dim('(for ' + f + ')')}`);
    console.log('');
    process.exitCode = 1;
    return;
  }
  const engaged = call('privacy_analyze', { entity, data, ...context });
  if (engaged.error) return console.log(`\n  ${engaged.error}\n`);
  const all = engaged.deadlines ?? [];
  const started = all.filter(d => d.computed).sort((a, c) => a.computed.localeCompare(c.computed));
  const waiting = all.filter(d => !d.computed)
    .sort((a, c) => String(a.citation ?? a.atom_id).localeCompare(String(c.citation ?? c.atom_id)));
  if (args.includes('--json')) return console.log(JSON.stringify(all, null, 2));

  const asserted = Object.entries(context.event).filter(([, v]) => /^\d{4}-\d{2}-\d{2}$/.test(v));
  console.log(`\n${b('Clocks as of ' + context.as_of)}  —  earliest first\n`);
  if (asserted.length)
    for (const [k, v] of asserted) console.log(dim(`  asserted: ${k} = ${v}`));
  else
    console.log(dim('  no event dates asserted — nothing can start a clock'));
  console.log('');

  for (const d of started) {
    console.log(`  ${b(d.computed)}  ${String(d.duration).padEnd(18)} ${d.citation ?? d.atom_id}`);
    console.log(dim(`              from: ${d.trigger_label ?? d.trigger_event}`));
    if (d.trigger_via === 'family')
      console.log(dim(`              dated via the "${d.trigger_supplied_as}" family key, not this statute's own trigger`));
    if (d.business_day_basis) console.log(dim(`              business days = weekdays; public holidays NOT excluded`));
    if (d.caution) console.log(dim(`              ${d.caution.slice(0, 88)}`));
  }
  if (!started.length) console.log('  (no clock has started)');

  // THE UNSTARTED CLOCKS ARE THE POINT. An obligation that applies but whose trigger has not
  // been asserted is a duty waiting on a fact — silently dropping it, as this command did, is
  // how a lawyer reads "three deadlines" and never learns there were seven.
  if (waiting.length) {
    console.log(`\n${b('Not started')} — these apply, but no date was given for their trigger\n`);
    for (const d of waiting) {
      console.log(`  ${d.citation ?? d.atom_id}`);
      console.log(dim(`      needs: --event ${d.trigger_key ?? '?'}=<date>`
        + (d.trigger_family ? `   (or --event ${d.trigger_family}=<date>)` : '')));
    }
  }
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
    if (!rest[0]) {
      console.log('\n  usage: privacy-kb cite <record-id>\n  e.g.   privacy-kb cite ny.gbl.899_aa.9.hipaa_ag_notice\n');
      process.exitCode = 1; break;   // a missing required argument is a failure, not a hint
    }
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
  case 'triggers': {
    const r = call('privacy_triggers', {});
    console.log(`\n  ${b(r.count + ' trigger keys')} · ${r.families.length} families\n`);
    for (const f of r.families) {
      console.log(`  ${b(f.key)}  ${dim('— ' + f.meaning)}`);
      for (const m of f.members) {
        const t = r.triggers.find(x => x.key === m);
        console.log(`      ${String(m).padEnd(42)} ${dim(String(t.used_by.length) + ' record' + (t.used_by.length === 1 ? '' : 's'))}`);
        console.log(dim(`        ${t.label.slice(0, 84)}`));
      }
      console.log('');
    }
    console.log(dim('  Supply any key as --event <key>=<date>. A FAMILY key dates every member at'));
    console.log(dim('  once — one breach discovery starts the HIPAA, SHIELD, HBNR and GLBA clocks.'));
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
