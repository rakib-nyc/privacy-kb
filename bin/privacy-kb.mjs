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
import { buildMemo } from '../engine/memo.mjs';

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
  ${b('privacy-kb setup')}                     print the MCP client config to paste
  ${b('privacy-kb coverage')}                  what the corpus holds, and what it does not
  ${b('privacy-kb cite')} <record-id>          the verbatim text and where it came from
  ${b('privacy-kb find')} <query>              search every provision by citation, phrase or topic
  ${b('privacy-kb deadlines')} [flags]         which clocks have started, and which have not
  ${b('privacy-kb ask')} [flags]               which obligations apply
  ${b('privacy-kb triggers')}                  every event key that can start a clock
  ${b('privacy-kb facts')} [ns|search]        every fact key you can assert, and its values
  ${b('privacy-kb incidents')}                 how one incident can be several things at once
  ${b('privacy-kb breach')} [flags]            a multi-regime breach notification timeline
  ${b('privacy-kb memo')} [flags]              a citable, verifiable record of the whole analysis
  ${b('privacy-kb exposure')} [flags]          what changes if a fact changes — one decision away
  ${b('privacy-kb requirements')} <cite>…     every element a provision requires, and what is missing
  ${b('privacy-kb crosswalk')} [cite]          declared links between regimes, with both texts
  ${b('privacy-kb conform')} <doc> <cite>…     a fillable worksheet: the requirements beside your document
  ${b('privacy-kb translate')} <term>…         external vocabulary (Fideslang) into legal facts
  ${b('privacy-kb profile')} save|list|show|check  a standing fact set, and what moved since
  ${b('privacy-kb may-i')} <operation> [flags]  what prohibits, permits or conditions it
  ${b('privacy-kb brief')} <record-id>          everything known about one provision
  ${b('privacy-kb receipt')} [flags]           a reproducible digest of an answer, for an auditor
  ${b('privacy-kb between')} <d1> <d2> [flags] what changed for THESE facts between two dates
  ${b('privacy-kb ground')} <claims.json>     audit someone else's citations against this corpus

  ${b('Flags for ask/deadlines')}
    --hipaa            a HIPAA covered entity
    --ny-data          holds a New York resident's private information
    --ny-employer      has employees in New York
    --nyc-hiring       uses an automated hiring tool in New York City
    --minors           has users under 18
    --breach           a security breach has occurred (all characterisations)
    --as <kind>        narrow the breach to one characterisation — see incidents
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
  // A BREACH IS NOT ONE LEGAL THING. The same laptop is a breach of unsecured PHI under
  // 45 C.F.R. § 164.402 and a breach of the security of the system under N.Y. GBL § 899-aa(1)(c)
  // — different definitions, different clocks, both live. This flag used to assert ONE of them,
  // so `--hipaa --ny-data --breach` returned the New York duties and silently dropped every
  // HIPAA breach duty. Asserting the whole security-incident family is safe because the ENTITY
  // predicates do the real filtering: a hospital does not pick up the FTC Health Breach Rule
  // just because the characterisation was offered. Narrow with --as <characterisation>.
  if (has('--breach')) {
    const ai = args.indexOf('--as');
    event.type = ai >= 0 && args[ai + 1]
      ? [args[ai + 1]]
      : ['breach_of_unsecured_phi', 'breach_of_security_of_the_system',
         'breach_of_security', 'notification_event'];
  }
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

function translateCmd(args) {
  const terms = args.filter(a => !a.startsWith('--'));
  const vi = args.indexOf('--vocabulary');
  const vocabulary = vi >= 0 ? args[vi + 1] : 'fideslang';
  if (!terms.length) {
    console.log('\n  privacy-kb translate <term>… [--vocabulary fideslang] [fact flags]\n');
    console.log(dim('    privacy-kb translate user.health_and_medical user.biometric --hipaa\n'));
    process.exitCode = 1; return;
  }
  const { entity, data, context } = factsFrom(args);
  const r = call('privacy_translate', { terms, vocabulary,
    facts: { entity, data, practice: context.practice, event: context.event } });
  if (args.includes('--json')) return console.log(JSON.stringify(r, null, 2));
  if (r.error) { process.exitCode = 1; return console.log(`\n  ${r.error}\n`); }

  console.log(`\n${b('Translate')}  ${r.vocabulary}  —  ${terms.length} term(s)\n`);
  const asserted = Object.entries(r.assert).flatMap(([ns, bag]) =>
    Object.keys(bag).map(k => `${ns}.${k}`));
  if (asserted.length) {
    console.log(b('  Safe to assert'));
    for (const fact of asserted) console.log(`    ✓ ${fact}`);
    console.log('');
  }
  if (r.conditional.length) {
    console.log(b('  NOT asserted — each needs another fact established first'));
    for (const row of r.conditional) {
      console.log(`    ? ${row.term} → ${b(row.fact)}`);
      console.log(dim(`        needs: ${row.missing.join(', ')}`));
      if (row.why) console.log(dim(`        ${row.why.slice(0, 190)}`));
    }
    console.log('');
  }
  if (r.surface.length) {
    console.log(b('  Overlaps, does not match — for a person to resolve'));
    for (const row of r.surface) {
      console.log(`    ~ ${row.term}${row.fact ? ' ≈ ' + row.fact : dim('  (no fact key in this corpus)')}`);
      if (row.why) console.log(dim(`        ${row.why.slice(0, 190)}`));
    }
    console.log('');
  }
  if (r.unmapped.length) {
    console.log(b('  No declared mapping'));
    for (const term of r.unmapped) console.log(`    · ${term}`);
    console.log(dim('    Declared absence, not a silent drop. Add it to meta/vocabulary-map.yaml.\n'));
  }
  console.log(dim(`  ${r.note}`));
  console.log('\n' + DISCLAIMER + '\n');
}

function profileCmd(args) {
  const sub = args[0];
  const rest = args.slice(1);
  const name = rest.filter(a => !a.startsWith('--'))[0];

  if (sub === 'list' || !sub) {
    const rows = call('privacy_profile', { action: 'list' });
    if (!rows.profiles.length) {
      console.log('\n  No profiles yet.\n');
      console.log(dim('    privacy-kb profile save <name> --hipaa --ny-data\n'));
      return;
    }
    console.log(`\n${b('Profiles')}  ${dim(rows.dir)}\n`);
    for (const row of rows.profiles) {
      console.log(`  ${b(row.name.padEnd(20))} ${row.description ?? ''}`);
      console.log(dim(`    last checked ${row.last_checked ?? 'never'}${row.obligations != null ? ` · ${row.obligations} obligation(s)` : ''}`));
    }
    console.log('');
    return;
  }

  if (sub === 'save') {
    if (!name) { console.log('\n  privacy-kb profile save <name> [fact flags]\n'); process.exitCode = 1; return; }
    const { entity, data, context, bad_dates } = factsFrom(rest);
    if (refuseBadDates(bad_dates)) return;
    const descIdx = rest.indexOf('--description');
    const r = call('privacy_profile', { action: 'save', name,
      facts: { entity, data, event: context.event, practice: context.practice,
               purpose: context.purpose, law: context.law, state_layers: context.state_layers },
      description: descIdx >= 0 ? rest[descIdx + 1] : null });
    console.log(`\n  saved ${b(r.name)}  ${dim(r.file)}\n`);
    console.log(dim('  Facts only. No answer is stored beside them — a stored answer invites'));
    console.log(dim('  someone to read it without re-running it.\n'));
    return;
  }

  if (sub === 'show') {
    const r = call('privacy_profile', { action: 'show', name });
    if (!r.found) { console.log(`\n  ${r.error}\n`); process.exitCode = 1; return; }
    console.log(`\n${b(r.name)}  ${dim(r.description ?? '')}\n`);
    console.log(dim(`  created ${r.created ?? '?'} · updated ${r.updated ?? '?'}`));
    console.log(`  state layers: ${(r.state_layers ?? []).join(', ') || 'none'}`);
    for (const [ns, bag] of Object.entries(r.facts ?? {})) {
      const keys = Object.keys(bag ?? {});
      if (keys.length) console.log(`  ${ns}: ${keys.map(k => `${k}=${JSON.stringify(bag[k])}`).join(', ')}`);
    }
    if (r.last_check)
      console.log(dim(`\n  last checked ${r.last_check.checked_on} as of ${r.last_check.as_of} — receipt ${r.last_check.receipt_id}`));
    // THE REGISTER, NOT JUST THE LAST ROW. A profile that shows only its most recent check cannot
    // answer the question it exists for: when did this move, and what moved with it.
    const log = r.history ?? [];
    if (log.length > 1) {
      console.log(`\n${b('Register')}  ${log.length} check(s)`
        + (r.history_dropped ? dim(`  (${r.history_dropped} older dropped)`) : ''));
      for (const row of log.slice(-12)) {
        const why = !row.moved ? 'baseline'
          : Object.entries(row.moved).filter(([, v]) => v).map(([k]) => k).join('+') || 'nothing moved';
        console.log(`  ${row.checked_on}  as of ${row.as_of}  ${String(row.obligations).padStart(3)} obligation(s)  ${dim(why)}`);
      }
    }
    console.log('');
    return;
  }

  if (sub === 'check') {
    const asOfIdx = rest.indexOf('--as-of');
    const asOf = asOfIdx >= 0 ? rest[asOfIdx + 1] : new Date().toISOString().slice(0, 10);
    const r = call('privacy_profile', { action: 'check', name, as_of: asOf });
    if (!r.ok) { console.log(`\n  ${r.error}\n`); process.exitCode = 1; return; }
    console.log(`\n${b('Check')}  ${r.name}  as of ${r.now.as_of}\n`);
    if (r.first_check) {
      console.log(b('  Baseline recorded.'));
      console.log(`  ${r.now.obligations} obligation(s) · receipt ${dim(r.now.receipt_id)}`);
      console.log(dim(`\n  ${r.note}`));
    } else {
      console.log(dim(`  previous: ${r.previous.checked_on}, as of ${r.previous.as_of}, ${r.previous.obligations} obligation(s)`));
      if ((r.history ?? []).length > 2) {
        const trail = r.history.slice(-6).map(row => `${row.as_of}:${row.obligations}`).join('  →  ');
        console.log(dim(`  register (${r.history.length} check(s)): ${trail}`));
      }
      const flags = [];
      if (r.moved.corpus) flags.push(b('THE CORPUS MOVED'));
      if (r.moved.facts) flags.push(b('THE FACTS WERE EDITED'));
      if (r.moved.date) flags.push('the as-of date moved');
      if (r.moved.result) flags.push(b('THE ANSWER MOVED'));
      console.log(`  ${flags.length ? flags.join(' · ') : 'nothing moved'}`);
      if (r.delta) {
        if (r.delta.commenced.length) {
          console.log(b(`\n  Commenced — ${r.delta.commenced.length}`));
          for (const row of r.delta.commenced)
            console.log(`    + ${row.citation}  (effective ${row.effective_from})`);
        }
        if (r.delta.ceased.length) {
          console.log(b(`\n  Ceased to apply — ${r.delta.ceased.length}`));
          for (const row of r.delta.ceased) console.log(`    - ${row.citation}`);
        }
        // NEVER PRINTED ALONGSIDE THE DATED CHANGES. A difference the corpus cannot attribute to a
        // legal event is a different kind of statement from one it can, and putting them in one
        // list is what made § 349 read as newly applicable.
        if (r.delta.indeterminate.length) {
          console.log(dim(`\n  Differs, cause unattributable — ${r.delta.indeterminate.length}`));
          for (const row of r.delta.indeterminate)
            console.log(dim(`    ? ${row.citation}  ${row.direction}; effective_from is a `
              + `capture date (${row.effective_from_basis}), not a commencement`));
        }
        for (const row of r.delta.deadline_changes)
          console.log(`    ~ ${row.citation}  ${row.was} → ${row.now}`);
        if (r.delta.unmeasurable.length)
          console.log(dim(`\n  ${r.delta.unmeasurable.length} obligation(s) could not be asked about `
            + `this window — held text younger than the from-date.`));
      } else if (r.moved.facts) {
        console.log(dim('\n  No legal-change diff: the facts were edited, so any movement in the'));
        console.log(dim('  obligation set follows from the edit and not from the law.'));
      }
      console.log(dim(`\n  receipt ${r.now.receipt_id}`));
    }
    for (const gap of r.coverage_gaps.slice(0, 2)) console.log(dim(`\n  ${gap.slice(0, 200)}`));
    console.log('\n' + DISCLAIMER + '\n');
    return;
  }

  console.log(`\n  unknown: profile ${sub}. Use list, save, show or check.\n`);
  process.exitCode = 1;
}

function mayiCmd(args) {
  const words = args.filter(a => !a.startsWith('--') && !/^\d{4}-\d{2}-\d{2}$/.test(a));
  const { entity, data, context, bad_dates } = factsFrom(args);
  if (refuseBadDates(bad_dates)) return;
  const operation = words.join(' ');
  const r = call('privacy_may_i', { entity, data, ...context, operation });
  if (args.includes('--json')) return console.log(JSON.stringify(r, null, 2));
  if (r.error) { process.exitCode = 1; return console.log(`\n  ${r.error}\n`); }

  console.log(`\n${b('May I?')}  ${r.operation ? dim('"' + r.operation + '"') : ''}   as of ${r.as_of}\n`);
  if (r.default_deny) {
    console.log(b('  ⚠ DEFAULT PROHIBITION APPLIES'));
    console.log(dim(`    ${r.general_prohibitions.join(', ')} — silence is NOT permission here.\n`));
  }
  const block = (title, rows, marker) => {
    if (!rows.length) return;
    console.log(b(`  ${title} — ${rows.length}`));
    for (const row of rows) {
      console.log(`    ${marker} ${row.citation}`);
      console.log(`       ${row.summary.slice(0, 120)}`);
      for (const carve of row.exemptions.slice(0, 2))
        console.log(dim(`       carve-out [${carve.type}] ${carve.scope.slice(0, 96)}`));
    }
    console.log('');
  };
  block('Prohibits', r.prohibitions, '✗');
  block('Permits', r.permissions, '✓');
  block('Allows only on a condition', r.conditions, '~');
  console.log(dim(`  ${r.caveat}`));
  console.log(dim('\n  This is not a verdict. The operation was NOT matched against any provision —'));
  console.log(dim('  these are the records that apply to your FACTS. Read the words and decide.'));
  console.log('\n' + DISCLAIMER + '\n');
}

function briefCmd(args) {
  const id = args.filter(a => !a.startsWith('--'))[0];
  if (!id) { console.log('\n  Usage:  privacy-kb brief <record-id or citation>\n'); process.exitCode = 1; return; }
  const r = call('privacy_brief', { atom_id: id });
  if (args.includes('--json')) return console.log(JSON.stringify(r, null, 2));
  if (!r.found) { process.exitCode = 1; return console.log(`\n  ${r.error}\n`); }

  console.log(`\n${b(r.quoted.citation)}   ${dim(r.provenance.atom_id)}\n`);
  console.log(`  ${r.quoted.verbatim_span.slice(0, 600)}${r.quoted.verbatim_span.length > 600 ? '…' : ''}\n`);
  for (const part of r.quoted.operative_context) {
    console.log(dim(`  context [${part.relation}] ${part.citation}`));
    console.log(dim(`    ${part.verbatim_span.slice(0, 200)}`));
  }
  console.log(`  ${b('In force')}   ${r.temporal.effective_from ?? '?'} → ${r.temporal.effective_to ?? 'present'}  (${r.temporal.status})`);
  console.log(dim(`               date basis: ${r.temporal.effective_from_basis ?? 'undeclared'}`));
  if (r.reach.deadline)
    console.log(`  ${b('Clock')}      ${JSON.stringify(r.reach.deadline.duration)} from ${r.reach.deadline.trigger_event}`);
  if (r.reach.preemption) {
    console.log(`  ${b('Preemption')} ${r.reach.preemption.posture}${r.reach.preemption.authority ? ' · ' + r.reach.preemption.authority : ''}`);
    if (r.reach.preemption.note) console.log(dim(`               ${r.reach.preemption.note.slice(0, 260)}`));
  }
  if (r.exposure) {
    console.log(`  ${b('Enforced by')} ${r.exposure.enforcers.join(', ') || 'unstated'}   private right of action: ${b(String(r.exposure.private_right_of_action))}`);
    if (r.exposure.penalty?.structure) console.log(dim(`               ${r.exposure.penalty.structure.slice(0, 220)}`));
    if (r.exposure.statute_of_limitations) console.log(dim(`               limitations: ${r.exposure.statute_of_limitations.slice(0, 180)}`));
  }
  if (r.reach.exemptions.length) {
    console.log(`\n  ${b('Carve-outs')} — typed, because entity-level and data-level are not the same thing`);
    for (const carve of r.reach.exemptions) {
      console.log(`    [${b(carve.type)}${carve.reach ? ' · reach ' + carve.reach : ''}] ${carve.source_citation ?? ''}`);
      console.log(`       ${carve.scope.slice(0, 230)}`);
      if (carve.burden_of_proof) console.log(dim(`       burden of proof: ${carve.burden_of_proof}`));
    }
  }
  if (r.analysis.common_errors.length) {
    console.log(`\n  ${b('Commonly got wrong')}`);
    for (const err of r.analysis.common_errors) console.log(`    · ${err}`);
  }
  if (r.analysis.open_questions.length) {
    console.log(`\n  ${b('Open questions')}`);
    for (const q of r.analysis.open_questions) console.log(`    ? ${q}`);
  }
  for (const g of r.guidance) console.log(dim(`\n  interpreted by ${g.id} [${g.authority_tier}] — ${g.note}`));
  console.log(dim(`\n  source ${r.provenance.source_url ?? 'n/a'}`));
  console.log(dim(`  fetched ${r.provenance.fetched ?? 'n/a'} · sha256 ${String(r.provenance.raw_sha256).slice(0, 32)}…`));
  console.log(dim(`\n  ${r.analysis.warning}`));
  console.log('\n' + DISCLAIMER + '\n');
}

function receiptCmd(args) {
  const { entity, data, context, bad_dates } = factsFrom(args);
  if (refuseBadDates(bad_dates)) return;
  const r = call('privacy_receipt', { entity, data, ...context });
  if (args.includes('--json')) return console.log(JSON.stringify(r, null, 2));
  if (r.error) { process.exitCode = 1; return console.log(`\n  ${r.error}\n`); }
  console.log(`\n${b('Receipt')}  ${b(r.receipt_id)}\n`);
  console.log(`  as of            ${r.as_of}`);
  console.log(`  inputs digest    ${dim(r.inputs_digest)}`);
  console.log(`  corpus digest    ${dim(r.corpus_digest)}  ${dim('(' + r.corpus_records + ' records)')}`);
  console.log(`  result digest    ${dim(r.result_digest)}`);
  console.log(`  issued           ${dim(r.issued_at)} ${dim('(metadata — not hashed)')}`);
  if (r.summary)
    console.log(`\n  ${r.summary.obligations} obligation(s) · ${r.summary.deadlines_started} clock(s) started · ` +
                `${r.summary.coverage_gaps} coverage gap(s) · ${r.summary.pending_watch} pending`);
  console.log(dim(`\n  ${r.what_this_proves}`));
  console.log(dim('  Re-run this exact command later and compare the receipt id.'));
  console.log('\n' + DISCLAIMER + '\n');
}

function betweenCmd(args) {
  const i = args.indexOf('--between');
  const from = args[i + 1], to = args[i + 2];
  const { entity, data, context, bad_dates } = factsFrom(args.filter((a, n) => n !== i && n !== i + 1 && n !== i + 2));
  if (refuseBadDates(bad_dates)) return;
  const r = call('privacy_between', { entity, data, ...context, from, to });
  if (args.includes('--json')) return console.log(JSON.stringify(r, null, 2));
  if (r.error) { process.exitCode = 1; return console.log(`\n  ${r.error}\n`); }
  console.log(`\n${b('What changed for these facts')}  ${r.from} → ${r.to}\n`);
  if (r.commenced.length) {
    console.log(b(`  Commenced — ${r.commenced.length}`));
    for (const row of r.commenced)
      console.log(`    + ${row.citation}  (effective ${row.effective_from}, ${row.effective_from_basis})`);
  }
  if (r.ceased.length) {
    console.log(b(`\n  Ceased to apply — ${r.ceased.length}`));
    for (const row of r.ceased) console.log(`    - ${row.citation}`);
  }
  if (r.deadline_changes.length) {
    console.log(b(`\n  Clocks that moved — ${r.deadline_changes.length}`));
    for (const row of r.deadline_changes) console.log(`    ~ ${row.citation}  ${row.was} → ${row.now}`);
  }
  // A SEPARATE HEADING, DELIBERATELY. These differ between the two dates and the corpus cannot say
  // why: their effective_from is the date the text was captured. Printed under "Gained" — which is
  // what this did — N.Y. Gen. Bus. Law § 349 read as a duty acquired in 2026. It dates from 1970.
  if (r.indeterminate.length) {
    console.log(dim(`\n  Differs, cause unattributable — ${r.indeterminate.length}`));
    for (const row of r.indeterminate)
      console.log(dim(`    ? ${row.citation}  ${row.direction}; effective_from ${row.effective_from} `
        + `is a capture date (${row.effective_from_basis}), not a commencement`));
  }
  if (!r.commenced.length && !r.ceased.length && !r.deadline_changes.length && !r.indeterminate.length)
    console.log('  Nothing changed for these facts between those dates.');
  console.log(dim(`\n  ${r.unchanged} obligation(s) applied on both dates.`));
  // The denominator, stated rather than implied: silence about a provision the corpus cannot reach
  // reads exactly like silence about a provision that did not change.
  if (r.unmeasurable.length)
    console.log(dim(`  ${r.unmeasurable.length} obligation(s) could not be asked about this window: `
      + `the only text held for them is younger than ${r.from}.`));
  console.log(dim(`  ${r.caveat}`));
  console.log('\n' + DISCLAIMER + '\n');
}

/**
 * Audit claims someone else made. The input is a JSON file of
 * [{proposition, citation, as_of?, facts?}] — which is what you get by asking any assistant to
 * list the citations it relied on — or a single claim given inline.
 */
function groundCmd(args) {
  const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const file = args.filter(a => !a.startsWith('--'))[0];
  const inlineClaim = flag('--claim');
  const inlineCite = flag('--cite');
  const asOf = flag('--as-of');

  // --text AUDITS PROSE. Paste any assistant's answer and every authority it leaned on is checked
  // for resolution, force on the date, pending status and applicability. Extracting the CITATION
  // is lexical; extracting the PROPOSITION would need a model reading the argument, which is what
  // invariant I8 keeps out of this path.
  const textPath = flag('--text');
  if (textPath) {
    let prose = '';
    try { prose = readFileSync(textPath, 'utf8'); }
    catch { console.log(`\n  cannot read ${textPath}\n`); process.exitCode = 1; return; }
    const { entity, data, context } = factsFrom(args);
    // COMPARED AGAINST THE BASELINE, NOT COUNTED. factsFrom() always sets nexus,
    // within_ftc_jurisdiction and in_or_affecting_commerce, so "more than two keys" was true even
    // when the caller asserted nothing — and every row came back APPLICABILITY_UNKNOWN because a
    // predicate was tested against facts nobody supplied. A finding that fires when the user did
    // nothing is noise, and noise is what teaches people to skip the findings that matter.
    const baseline = factsFrom([]);
    const hasFacts = JSON.stringify([entity, data]) !== JSON.stringify([baseline.entity, baseline.data]);
    const r = call('privacy_ground', { text: prose, as_of: asOf ?? context.as_of ?? undefined,
      facts: hasFacts ? { entity, data, event: context.event, practice: context.practice,
                          purpose: context.purpose, law: context.law } : undefined });
    return renderGround(r, args, prose);
  }

  let claims = null;
  if (file) {
    try { claims = JSON.parse(readFileSync(file, 'utf8')); }
    catch (err) { console.log(`\n  cannot read ${file} as JSON: ${err.message}\n`); process.exitCode = 1; return; }
  } else if (inlineClaim || inlineCite) {
    claims = [{ proposition: inlineClaim, citation: inlineCite, as_of: asOf }];
  } else {
    console.log('\n  Usage:  privacy-kb ground --text <answer.txt> [--as-of <date>] [fact flags]');
    console.log('          privacy-kb ground <claims.json> [--as-of <date>] [--md] [--json]');
    console.log('          privacy-kb ground --claim "<proposition>" --cite "<citation>" [--as-of <date>]\n');
    console.log(dim('  --text audits PROSE: paste any assistant\'s answer and every citation in it is'));
    console.log(dim('  checked for resolution, force on the date, pending status and applicability.\n'));
    console.log(dim('  claims.json is [{ "proposition": "...", "citation": "...", "as_of": "...",'));
    console.log(dim('                   "facts": { "entity": {...}, "data": {...} } }, ...]\n'));
    console.log(dim('  Supplying facts enables the inapplicable-authority check: a provision that is'));
    console.log(dim('  real, quoted correctly, and does not reach the entity being advised.\n'));
    process.exitCode = 1; return;
  }

  const r = call('privacy_ground', { claims, as_of: asOf ?? undefined });
  return renderGround(r, args);
}

function renderGround(r, args, prose) {
  if (args.includes('--json')) return console.log(JSON.stringify(r, null, 2));
  if (r.error) { process.exitCode = 1; return console.log(`\n  ${r.error}\n`); }
  if (args.includes('--md')) return console.log(r.markdown);

  const sum = r.summary;
  console.log(`\n${b('Citation audit')}  —  ${sum.claims} claim(s)`
    + (r.extracted ? dim(`, extracted from ${prose ? prose.length : 0} characters of text`) : '') + '\n');
  for (const row of r.results) {
    const mark = row.status === 'PROBLEMS_FOUND' ? b('✗') : row.status === 'CANNOT_CHECK' ? dim('?') : '·';
    console.log(`  ${mark} ${row.citation ?? dim('(no citation offered)')}`);
    if (row.proposition) console.log(dim(`      claim: ${row.proposition.slice(0, 96)}`));
    for (const finding of row.findings) {
      const tag = finding.severity === 'high' ? b(finding.code) : dim(finding.code);
      console.log(`      ${tag}`);
      console.log(dim(`        ${finding.message.slice(0, 190)}`));
      if (finding.detail?.failed_predicate) console.log(dim(`        predicate: ${finding.detail.failed_predicate}`));
    }
    if (row.quoted) console.log(dim(`      source says: "${row.quoted.slice(0, 110)}…"`));
    console.log('');
  }
  console.log(`  ${sum.with_problems} with a high-severity finding · ${sum.not_checkable} this corpus cannot reach\n`);
  // THE CLEAN ROWS ARE THE DANGEROUS ONES TO MISREAD, so the caveat is not optional output.
  console.log(dim(`  ${r.caveat}`));
  console.log('\n' + DISCLAIMER + '\n');
}

function conformCmd(args) {
  const files = args.filter(a => !a.startsWith('--'));
  const docPath = files[0];
  const citations = files.slice(1);
  if (!docPath || !citations.length) {
    console.log('\n  Usage:  privacy-kb conform <document-file> <citation>… [--signal] [--md]\n');
    console.log(dim('    privacy-kb conform notice.txt "45 C.F.R. § 164.520(b)(1)" --signal --md\n'));
    process.exitCode = 1; return;
  }
  let doc = '';
  try { doc = readFileSync(docPath, 'utf8'); }
  catch { console.log(`\n  cannot read ${docPath}\n`); process.exitCode = 1; return; }
  const r = call('privacy_conform', { document: doc, citations, signal: args.includes('--signal') });
  if (args.includes('--json')) return console.log(JSON.stringify(r, null, 2));
  if (r.error) { process.exitCode = 1; return console.log(`\n  ${r.error}\n`); }
  if (args.includes('--md')) return console.log(r.markdown);

  console.log(`\n${b('Conformance worksheet')}  —  ${r.rows.length} requirement(s), ${r.document_chars} chars of document\n`);
  if (r.signal_enabled) console.log(dim('  Ordered lowest vocabulary overlap first. Overlap is a READING AID, not a verdict.\n'));
  let n = 0;
  for (const row of r.rows) {
    n += 1;
    const sig = row.keyword_signal ? b(`[${row.keyword_signal.matched}/${row.keyword_signal.total}]`) : '';
    const tier = row.provenance === 'segmentation' ? dim(' ⚠seg') : '';
    console.log(`  ${String(n).padStart(3)}. ${sig} ${row.citation}${tier}`);
    console.log(`       ${row.requirement.slice(0, 140)}${row.requirement.length > 140 ? '…' : ''}`);
  }
  console.log(dim('\n  The verdict column is deliberately empty. Whether this document satisfies a'));
  console.log(dim('  row is legal judgement; this worksheet supplies the requirement and the words.'));
  console.log(dim('  Add --md for a fillable markdown worksheet you can file.'));
  console.log('\n' + DISCLAIMER + '\n');
}

function crosswalkCmd(args) {
  const filter = args.filter(a => !a.startsWith('--'))[0] ?? null;
  const r = call('privacy_crosswalk', { citation: filter });
  if (args.includes('--json')) return console.log(JSON.stringify(r, null, 2));
  if (!r.count) {
    console.log(`\n  No declared crosswalk${filter ? ` touching "${filter}"` : ''}.`);
    console.log(dim('  Crosswalks are DECLARED in meta/crosswalk.yaml, never inferred from'));
    console.log(dim('  similar wording. Absence means nobody has asserted a link, not that'));
    console.log(dim('  no correspondence exists.\n'));
    return;
  }
  console.log(`\n${b('Crosswalks')}  —  ${r.count} of ${r.declared} declared${r.unresolved ? `, ${r.unresolved} UNRESOLVED` : ''}\n`);
  for (const link of r.crosswalks) {
    console.log(`  ${b(link.id)}   ${dim(link.basis + ' · ' + link.relation)}`);
    for (const side of [link.left, link.right]) {
      if (!side.resolved) { console.log(`     ${b('UNRESOLVED')} ${side.citation}`); continue; }
      console.log(`     ${b(side.citation)}${side.via !== 'record' ? dim('  [segmentation — not a gate-checked record]') : ''}`);
      console.log(`        ${side.verbatim_span.slice(0, 140)}${side.verbatim_span.length > 140 ? '…' : ''}`);
      console.log(dim(`        sha256 ${String(side.sha256).slice(0, 16)}…  fetched ${side.fetched ?? 'n/a'}`));
    }
    console.log(dim(`     why: ${link.note.slice(0, 260)}${link.note.length > 260 ? '…' : ''}`));
    console.log('');
  }
  console.log(dim('  A crosswalk is an ASSERTION by a person, recorded with its reason. Both sides'));
  console.log(dim('  are quoted so you can judge it rather than trust it. `basis: statutory` means'));
  console.log(dim('  the statute names the other instrument; `structural` means both use the same'));
  console.log(dim('  enumerated scheme. Nothing here is inferred from similar wording.'));
  console.log('\n' + DISCLAIMER + '\n');
}

function requirementsCmd(args) {
  const citations = args.filter(a => !a.startsWith('--'));
  if (!citations.length) {
    console.log('\n  Give one or more citations, e.g.\n');
    console.log(dim('    privacy-kb requirements "45 C.F.R. § 164.520(b)(1)"'));
    console.log(dim('    privacy-kb requirements "45 C.F.R. § 164.404(c)" "N.Y. Gen. Bus. Law § 899-aa(7)"\n'));
    process.exitCode = 1; return;
  }
  const complete = args.includes('--complete');
  const r = call('privacy_requirements', { citations, include_segmentation: complete });
  if (args.includes('--json')) return console.log(JSON.stringify(r, null, 2));

  if (r.unavailable?.length) {
    for (const miss of r.unavailable) {
      console.log(`\n  ${b('NOT HELD')}  ${miss.citation}`);
      console.log(dim(`  ${miss.reason}`));
    }
    if (!r.elements?.length) { process.exitCode = 1; console.log(''); return; }
  }

  const heading = r.sources.length > 1
    ? `Required elements — union of ${r.sources.length} provisions`
    : `Required elements — ${r.sources[0]?.citation ?? ''}`;
  console.log(`\n${b(heading)}\n`);
  if (r.sources.length > 1) {
    for (const src of r.sources) console.log(dim(`  ${src.citation}  —  ${src.count} element(s)`));
    console.log(dim(`  ${r.shared} element(s) demanded by more than one of them\n`));
  }

  let n = 0;
  for (const element of r.elements) {
    n += 1;
    const tag = element.provenance === 'segmentation' ? dim(' [segmentation — not a gate-checked record]') : '';
    console.log(`  ${b(String(n).padStart(3) + '.')} ${element.citation}${tag}`);
    console.log(`       ${element.verbatim_span.slice(0, 150)}${element.verbatim_span.length > 150 ? '…' : ''}`);
    if (element.demanded_by?.length > 1)
      console.log(dim(`       also required by: ${element.demanded_by.filter(c => c !== element.citation).join(', ')}`));
    console.log(dim(`       ${element.atom_id ?? 'no record — segmentation leaf'}  ·  sha256 ${String(element.sha256).slice(0, 16)}…`));
  }

  // THE HALF THAT MAKES THE LIST HONEST.
  // INDETERMINATE COMPLETENESS IS CHECKED FIRST, and in complete mode especially.
  //
  // When the denominator cannot be established, complete mode adds NO segmentation rows — so the
  // sheet silently gets shorter rather than louder, which is the exact inversion of what the
  // reader needs. This branch ran last and was shadowed by the complete-mode note.
  if (r.denominator && r.denominator.available === false) {
    console.log(`\n${b('⚠ COMPLETENESS COULD NOT BE DETERMINED')}`);
    console.log(dim(`  ${r.denominator.why ?? 'the denominator could not be established.'}`));
    console.log(dim('  Treat the list above as a floor of unknown depth, not as complete.'));
    console.log(dim('  In --complete mode no segmentation rows were added for the same reason.'));
    console.log('\n' + DISCLAIMER + '\n');
    return;
  }

  const notHeld = complete ? [] : (r.not_held ?? []);
  if (notHeld.length) {
    console.log(`\n${b('⚠ THIS CHECKLIST IS INCOMPLETE — ' + notHeld.length + ' element(s) present in the source and NOT held here')}\n`);
    for (const miss of notHeld.slice(0, 20))
      console.log(`  ${b(miss.designation)}  ${dim(miss.preview.slice(0, 96))}`);
    if (notHeld.length > 20) console.log(dim(`  …and ${notHeld.length - 20} more`));
    console.log(dim('\n  Read from the stored segmentation of the same source bytes — these are'));
    console.log(dim('  provisions the walker found and no record was written for. Treat the list'));
    console.log(dim('  above as a floor, never as the complete set of requirements.'));
  } else if (complete) {
    console.log(dim(`\n  Complete mode: ${r.elements.filter(e => e.provenance === 'record').length} row(s) are`));
    console.log(dim(`  gate-checked records; ${r.elements.filter(e => e.provenance === 'segmentation').length} are segmentation leaves from the same`));
    console.log(dim('  hash-anchored source bytes that no record was written for. Both are quotations'));
    console.log(dim('  from the same file; only the first has been through the verification apparatus.'));
  } else if (r.sources.length) {
    console.log(dim('\n  No element under these provisions is missing from the corpus, measured'));
    console.log(dim('  against the stored segmentation of the same source bytes.'));
    console.log(dim('  Add --complete to include segmentation leaves as rows.'));
  }

  console.log(dim('\n  The LIST is data: each row is a verified quotation with a hash. Whether a'));
  console.log(dim('  document SATISFIES a row is a judgement this tool does not make.'));
  console.log('\n' + DISCLAIMER + '\n');
}

function exposureCmd(args) {
  const { entity, data, context, bad_dates } = factsFrom(args);
  if (refuseBadDates(bad_dates)) return;
  const r = call('privacy_exposure', { entity, data, ...context });
  if (r.error) { process.exitCode = 1; return console.log(`\n  ${r.error}\n`); }
  if (args.includes('--json')) return console.log(JSON.stringify(r, null, 2));

  const N = n => String(n).padStart(3);
  console.log(`\n${b('Exposure as of ' + r.as_of)}  —  ${r.baseline_count} obligation(s) apply on the facts given\n`);
  console.log(dim('  What follows is what CHANGES if a fact changes. Each row was computed by'));
  console.log(dim('  re-running the whole analysis with that one fact altered, not by inference.\n'));

  if (r.controllable.length) {
    console.log(b('If you do this'));
    for (const row of r.controllable.slice(0, 12)) {
      console.log(`  ${b('+' + N(row.adds.length))}  ${row.fact} = ${JSON.stringify(row.value)}`);
      for (const hit of row.adds.slice(0, 3)) console.log(dim(`        ${hit.citation}`));
      if (row.adds.length > 3) console.log(dim(`        …and ${row.adds.length - 3} more`));
      if (row.removes.length) console.log(dim(`        (and ${row.removes.length} would fall away)`));
    }
    console.log('');
  }

  if (r.contingent.length) {
    console.log(b('If this happens to you'));
    for (const row of r.contingent.slice(0, 8)) {
      console.log(`  ${b('+' + N(row.adds.length))}  ${row.fact} = ${JSON.stringify(row.value)}`);
      for (const hit of row.adds.slice(0, 3)) console.log(dim(`        ${hit.citation}`));
      if (row.adds.length > 3) console.log(dim(`        …and ${row.adds.length - 3} more`));
    }
    console.log('');
  }

  if (r.combinations?.length) {
    // Grouped by the COMBINATION, because the combination is the decision. Reporting 163 rows
    // one obligation at a time would bury the fact that two of them unlock nine duties together.
    const byCombo = new Map();
    for (const row of r.combinations) {
      const key = row.needs.join(' AND ');
      if (!byCombo.has(key)) byCombo.set(key, []);
      byCombo.get(key).push(row.citation);
    }
    const ranked = [...byCombo.entries()].sort((lhs, rhs) => rhs[1].length - lhs[1].length);
    console.log(b('Only if SEVERAL things change together'));
    for (const [combo, cites] of ranked.slice(0, 8)) {
      console.log(`  ${b('+' + N(cites.length))}  ${combo}`);
      for (const cite of cites.slice(0, 2)) console.log(dim(`        ${cite}`));
      if (cites.length > 2) console.log(dim(`        …and ${cites.length - 2} more`));
    }
    if (ranked.length > 8) console.log(dim(`  …and ${ranked.length - 8} further combinations`));
    console.log('');
  }

  if (r.thresholds.length) {
    console.log(b('Numbers that switch a duty on'));
    for (const row of r.thresholds) {
      const where = row.current === null
        ? dim('you have not told me the current number')
        : (row.distance === 0 ? b('ALREADY CROSSED') : `${row.current} now — ${b(String(row.distance))} to go`);
      console.log(`  ${row.fact} ${row.operator} ${row.bound}   ${where}`);
    }
    console.log('');
  }

  if (r.reversals.length) {
    console.log(b('Duties you owe only because of something you are doing'));
    for (const row of r.reversals.slice(0, 8)) {
      console.log(`  ${b('-' + N(row.stops.length))}  ${row.fact}`);
      for (const hit of row.stops.slice(0, 2)) console.log(dim(`        ${hit.citation}`));
      if (row.stops.length > 2) console.log(dim(`        …and ${row.stops.length - 2} more`));
    }
    console.log('');
  }

  console.log(dim('  A row is a CHANGE IN THE LAW THAT APPLIES, not advice about whether to do it.'));
  console.log(dim('  Absence of a row means this corpus holds nothing that turns on that fact —'));
  console.log(dim('  not that nothing does. Run `privacy-kb coverage` for what is held.'));
  console.log('\n' + DISCLAIMER + '\n');
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
  // A PERMISSION IS NOT A DUTY. 45 C.F.R. § 164.512 lets a covered entity disclose without an
  // authorisation and compels nothing; printing it under "obligations in force" tells a reader
  // they must do what the rule merely allows. They are counted and headed separately.
  const isPermit = o => corpus.byId.get(o.atom_id)?.obligation_type === 'permit';
  const duties = r.applicable.filter(o => !isPermit(o));
  const permits = r.applicable.filter(isPermit);
  const show = (list, heading) => {
    if (!list.length) return;
    console.log(`\n${b(heading)}\n`);
    const byInstrument = {};
    for (const o of list) (byInstrument[o.instrument_id] ??= []).push(o);
    for (const [inst, items] of Object.entries(byInstrument)) {
      console.log(`  ${b(inst)}`);
      for (const o of items) {
        console.log(`    ${o.citation}`);
        const a = corpus.byId.get(o.atom_id);
        if (a?.summary) console.log(dim(`      ${a.summary.slice(0, 92)}`));
        if (o.partial_carve_out) console.log(dim(`      carve-out: entity stays in scope for everything else`));
      }
    }
  };
  show(duties, `Obligations in force as of ${r.as_of}  —  ${duties.length} engaged`);
  show(permits, `Permissions — things you MAY do, not must  —  ${permits.length}`);
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

  // "EARLIEST FIRST" IS A CLAIM ABOUT THE WHOLE FIELD, AND IT IS ONLY AS GOOD AS THE CORPUS.
  // Where a record that answered points at an instrument the corpus does not hold, an unheld
  // duty can sit ahead of everything printed below and the ordering is silently wrong. That is
  // not hypothetical: N.Y. GBL 899-aa(8)(a) hands the DFS notice to 23 NYCRR 500.17, and a
  // 72-hour clock there beats the five-business-day 899-aa(9) clock this tool calls earliest.
  const bounded = (engaged.coverage_gaps ?? []).filter(g => /DOES NOT HOLD/.test(g));
  for (const line of bounded) console.log(`  ${b('⚠ ordering is bounded')} ${dim(line)}\n`);

  for (const d of started) {
    console.log(`  ${b(d.computed)}  ${String(d.duration).padEnd(18)} ${d.citation ?? d.atom_id}`);
    console.log(dim(`              from: ${d.trigger_label ?? d.trigger_event}`));
    if (d.trigger_via === 'family')
      console.log(dim(`              dated via the "${d.trigger_supplied_as}" family key, not this statute's own trigger`));
    if (d.is_precondition) console.log(dim(`              PRECONDITION — due BY this date, not on it`));
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
  console.log(`\n${b('MCP client setup')}\n`);
  console.log(`  Config file for this computer:\n    ${cfgPath}\n`);
  console.log(`  Paste this into it (merge with anything already there):\n`);
  console.log(JSON.stringify(block, null, 2).split('\n').map(l => '    ' + l).join('\n'));
  if (rest.includes('--write')) {
    let cur = {};
    if (existsSync(cfgPath)) { try { cur = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch {} }
    cur.mcpServers = { ...(cur.mcpServers ?? {}), ...block.mcpServers };
    mkdirSync(dirname(cfgPath), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify(cur, null, 2) + '\n');
    console.log(`\n  ${b('Written.')} Quit the MCP client completely and reopen it.\n`);
  } else {
    console.log(`\n  Or let this do it for you:  ${b('npm run setup -- --write')}`);
    console.log(`  Then quit the MCP client completely and reopen it.\n`);
  }
}

// ---------------------------------------------------------------- unknown flags are REFUSED
//
// An unrecognised flag used to be ignored in silence, and the command answered anyway. Typing
//
//   privacy-kb between 2022-06-01 2023-06-01 --entity.nexus US-NY-NYC
//
// produced a confident answer about a DIFFERENT entity: factsFrom() has a fixed flag vocabulary,
// the dotted flags matched nothing, and `entity.nexus ??= 'US-NY'` supplied a default. The user
// asked one question and the tool answered another without saying so, which is the failure this
// repository exists to refuse — and it is worse at the CLI than in the corpus, because there is no
// citation to check against.
//
// THE KNOWN SET IS READ FROM THIS FILE, not hand-maintained beside it. A hand-typed list is how
// the two drift apart, and a validator that lags the code rejects flags that work.
const KNOWN_FLAGS = new Set(
  [...readFileSync(new URL(import.meta.url), 'utf8').matchAll(/'(--[a-z0-9-]+)'/g)].map(m => m[1]));

function refuseUnknownFlags(argv) {
  // `--event k=v` and `--as-of 2026-01-01` take values; a value is not a flag, and only tokens
  // that LOOK like flags are checked. A bare "--" ends flag parsing by convention.
  const stop = argv.indexOf('--');
  const scanned = stop === -1 ? argv : argv.slice(0, stop);
  const unknown = scanned.filter(token => /^--[^=]/.test(token) && !KNOWN_FLAGS.has(token.split('=')[0]));
  if (!unknown.length) return false;
  console.log(`
  ${b('Unrecognised flag')}: ${unknown.join(', ')}\n`);
  console.log('  This was previously ignored, and the command answered for whatever facts the');
  console.log('  remaining flags implied — a confident answer to a question you did not ask.\n');
  console.log(`  Flags this build accepts:\n`);
  const all = [...KNOWN_FLAGS].sort();
  for (let i = 0; i < all.length; i += 6)
    console.log('    ' + all.slice(i, i + 6).map(f => f.padEnd(14)).join('').trimEnd());
  console.log(dim('\n  Facts are asserted with the named flags above, not with dotted paths.'));
  console.log(dim('  Run `privacy-kb facts` for every fact key, or `privacy-kb` for the command list.\n'));
  process.exitCode = 2;
  return true;
}

if (refuseUnknownFlags(rest)) process.exit(process.exitCode);

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
  case 'memo': {
    // THE WORK PRODUCT. Everything else here prints to a terminal; a lawyer hands people
    // documents. What makes this one worth handing over is not the prose — it is that sections
    // 5 and 6 state what the analysis could NOT determine, and section 7 lets a reader
    // re-verify every quotation without trusting the tool at all.
    const { entity, data, context, bad_dates, from_ambiguous } = factsFrom(rest);
    if (refuseBadDates(bad_dates)) break;
    if (from_ambiguous) { console.log(`\n  --from is ambiguous with ${from_ambiguous.join(' and ')}; use --event.\n`); process.exitCode = 1; break; }
    const mi = rest.indexOf('--matter');
    const m = buildMemo(entity, data, context,
      { matter: mi >= 0 ? rest[mi + 1] : null, version: VERSION });
    if (m.error) { console.log(`\n  ${m.error}\n`); process.exitCode = 1; break; }
    if (rest.includes('--json')) { console.log(JSON.stringify(m.record, null, 2)); break; }
    const oi = rest.indexOf('--out');
    if (oi >= 0 && rest[oi + 1]) {
      writeFileSync(rest[oi + 1], m.markdown);
      console.log(`\n  ${b('Written')} ${rest[oi + 1]}  ${dim(m.markdown.split('\n').length + ' lines')}\n`);
    } else {
      console.log(m.markdown);
    }
    break;
  }
  case 'find': {
    // 1,400 provision records are reference text the engine deliberately does not reason with.
    // Without a way to find them they are held and unreachable, which is not coverage.
    // Skip flag VALUES as well as flags: `find foo --limit 4` was searching for "foo 4".
    const VALUED = new Set(['--limit']);
    const q = rest.filter((x, i) => !x.startsWith('--') && !VALUED.has(rest[i - 1])).join(' ');
    if (!q) { console.log('\n  usage: privacy-kb find <citation | phrase | topic>\n'); process.exitCode = 1; break; }
    const li = rest.indexOf('--limit');
    const r = call('privacy_search', { q, limit: li >= 0 ? Number(rest[li + 1]) : 15 });
    if (rest.includes('--json')) { console.log(JSON.stringify(r, null, 2)); break; }
    console.log(`\n  ${b(r.count + ' match' + (r.count === 1 ? '' : 'es'))} for ${JSON.stringify(q)}` +
      dim(`   showing ${r.showing}`));
    console.log(dim(`  ${Object.entries(r.by_record_type).map(([k, v]) => v + ' ' + k).join(' · ')}\n`));
    for (const hit of r.results) {
      const tag = hit.kind === 'analysed' ? b('[analysed]') : dim('[reference]');
      console.log(`  ${tag} ${hit.citation ?? hit.atom_id}`);
      if (hit.summary) console.log(dim(`      ${String(hit.summary).slice(0, 104)}`));
      console.log(dim(`      ${hit.atom_id}   in force ${hit.effective_from ?? '?'}`));
    }
    console.log(dim('\n  [reference] means a verified quotation with a verified citation and no'));
    console.log(dim('  applicability analysis — the engine will not reason with it.'));
    console.log(`\n${DISCLAIMER}\n`);
    break;
  }
  case 'facts': {
    // THE INPUT VOCABULARY, WHICH USED TO BE UNDISCOVERABLE. 127 keys gated the corpus and
    // nothing told a caller any of them existed, so "we are a HIPAA covered entity" returned
    // 10, 3 or 13 obligations depending on which spelling was guessed.
    const arg0 = rest[0];
    const NSL = ['entity', 'data', 'event', 'practice', 'purpose', 'law'];
    const q = NSL.includes(arg0) ? { namespace: arg0 } : (arg0 ? { q: arg0 } : {});
    const r = call('privacy_facts', q);
    console.log(`\n  ${b(r.count + ' fact keys')}${arg0 ? dim('  matching "' + arg0 + '"') : ''}\n`);
    if (!arg0) {
      for (const [ns, meaning] of Object.entries(r.namespaces)) console.log(`  ${b(ns.padEnd(9))} ${dim(meaning)}`);
      console.log(`\n  ${dim('privacy-kb facts <namespace>   or   privacy-kb facts <search>')}\n`);
    }
    for (const k of r.keys.slice(0, arg0 ? 60 : 14)) {
      const vals = k.accepted_values.length ? ' = ' + k.accepted_values.slice(0, 4).join(' | ') : '';
      console.log(`  ${k.key}${dim(vals)}`);
      console.log(dim(`      gates ${k.gates_obligations} obligation(s)`
        + (k.gates_exemptions ? `, ${k.gates_exemptions} exemption(s)` : '')
        + (k.exemption_only ? '  — EXEMPTION-ONLY: nothing else demonstrates this key' : '')
        + (k.instruments.length ? `  · ${k.instruments.slice(0, 3).join(', ')}` : '')));
      if (k.aliases.length) console.log(dim(`      also accepted: ${k.aliases.join(', ')}`));
      if (k.ambiguous_term) console.log(dim(`      AMBIGUOUS: ${k.ambiguous_term.caution.slice(0, 96)}`));
    }
    if (!arg0 && r.count > 14) console.log(dim(`\n  …and ${r.count - 14} more. Narrow with a namespace or a search term.`));
    console.log(`\n${DISCLAIMER}\n`);
    break;
  }
  case 'incidents': {
    const r = call('privacy_incidents', {});
    console.log(`\n  ${b(r.count + ' incident characterisations')} · ${r.families.length} families\n`);
    console.log(dim('  One set of facts can satisfy several at once. A lost laptop of patient records is'));
    console.log(dim('  a breach of unsecured PHI AND a breach of the security of the system — different'));
    console.log(dim('  statutes, different definitions, different clocks. event.type takes a LIST.\n'));
    for (const f of r.families) {
      console.log(`  ${b(f.key)}  ${dim('— ' + f.meaning.slice(0, 84))}`);
      for (const mkey of f.members) {
        const c = r.characterisations.find(x => x.key === mkey);
        console.log(`      ${mkey.padEnd(38)} ${dim(String(c.used_by.length) + ' record(s)')}`);
        if (c.definition) console.log(dim(`        decided by: ${c.definition.slice(0, 88)}`));
      }
      console.log('');
    }
    console.log(`${DISCLAIMER}\n`);
    break;
  }
  case 'breach': {
    // THE WORKFLOW A LAWYER ACTUALLY REACHES FOR, and until now it was reachable from nowhere.
    const { entity, data, context, bad_dates, from_ambiguous } = factsFrom(rest);
    if (refuseBadDates(bad_dates)) break;
    if (from_ambiguous) { console.log(`\n  --from is ambiguous with ${from_ambiguous.join(' and ')}; use --event.\n`); process.exitCode = 1; break; }
    // A breach is BOTH characterisations unless the caller narrows it. Asserting one and
    // silently losing the other is the defect this command exists to make impossible.
    const r = call('privacy_workflow', { workflow: 'breachNotificationTimeline',
      entity, data, incident: context.event, context });
    if (rest.includes('--json')) { console.log(JSON.stringify(r, null, 2)); break; }
    console.log(`\n${b('Breach notification timeline')}  ${dim('as of ' + (r.as_of ?? '?'))}\n`);
    const tl = r.sections.find(x => /Timeline/.test(x.heading))?.body ?? [];
    if (!tl.length) console.log('  (no clock has started — supply --breach --from <date>)');
    for (const d of tl)
      console.log(`  ${b(d.computed ?? 'not started')}  ${String(d.duration ?? '').padEnd(18)} ${d.citation ?? d.atom_id}`);
    // A DUTY WITH NO CLOCK IS STILL A DUTY. N.Y. GBL § 899-aa(8)(a) — the Attorney General,
    // Department of State and State Police notice — sets no period; the statute times it only by
    // forbidding it to delay the resident notice. Printing only the timeline left the single most
    // commonly missed obligation in a New York breach off the page entirely.
    const regimes = r.sections.find(x => /Notification regimes/.test(x.heading))?.body ?? [];
    const dated = new Set(tl.map(d => d.atom_id));
    const undated = regimes.filter(o => !dated.has(o.id ?? o.atom_id));
    if (undated.length) {
      console.log(`\n${b('Also required, with no fixed period')}\n`);
      for (const o of undated) {
        console.log(`  ${o.citation ?? o.id}`);
        if (o.summary) console.log(dim(`      ${String(o.summary).slice(0, 96)}`));
      }
    }
    const open = r.sections.find(x => /Characterisations not yet made/.test(x.heading))?.body ?? [];
    if (open.length) {
      console.log(`\n${b('Not yet characterised')} — each of these would add a duty\n`);
      for (const c of open) console.log(`  ${c.citation}\n${dim('      needs: ' + c.requires_characterisation.join(', '))}`);
    }
    if (!r.complete) {
      console.log(`\n${b('THIS TIMELINE IS INCOMPLETE')}\n`);
      for (const c of r.failed_criteria) console.log(`  ✗ ${c.criterion}${c.detail ? dim('\n      ' + c.detail.slice(0, 150)) : ''}`);
      process.exitCode = 1;
    } else {
      console.log(`\n  ${b('Checklist passed')} — ${r.checklist.length} criteria`);
    }
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
  case 'translate': translateCmd(rest); break;
  case 'profile': profileCmd(rest); break;
  case 'may-i': mayiCmd(rest); break;
  case 'brief': briefCmd(rest); break;
  case 'receipt': receiptCmd(rest); break;
  case 'between': betweenCmd(rest); break;
  case 'ground': groundCmd(rest); break;
  case 'conform': conformCmd(rest); break;
  case 'crosswalk': crosswalkCmd(rest); break;
  case 'requirements': requirementsCmd(rest); break;
  case 'exposure': exposureCmd(rest); break;
  case 'coverage': {
    const r = call('privacy_coverage', {});
    console.log(`\n  ${b(r.total + ' records')} visible · ${r.suppressed_by_i1} suppressed as unverified\n`);
    for (const [k, v] of Object.entries(r.by_record_type)) console.log(`    ${String(v).padStart(4)}  ${k}`);
    console.log(`\n${DISCLAIMER}\n`); break;
  }
  default: usage();
}
