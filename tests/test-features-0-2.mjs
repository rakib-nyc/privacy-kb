#!/usr/bin/env node
// The five surfaces added after 0.1: premise, register, overlaps, interview, calendar.
//
// Most of these assertions are adversarial rather than confirmatory. Each of these tools produces
// something a person will act on — a date, a register row, a "you are exempt" — so the failure that
// matters is not a missing feature, it is a confident claim the corpus does not support. The
// vocabulary is pinned as hard as the behaviour.
import { premises, checkPremise, premisesIn, unresolvableAliases, PREMISE_KINDS } from '../engine/premise.mjs';
import { register, registerCsv, registerMarkdown, bindEvidence, unbindEvidence,
         readEvidence, evidencePath } from '../engine/register.mjs';
import { overlaps, overlapMarkdown } from '../engine/overlap.mjs';
import { interview, interviewMarkdown } from '../engine/interview.mjs';
import { calendar, calendarIcs } from '../engine/calendar.mjs';
import { load } from '../engine/corpus.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!cond) fail += 1;
};
const kb = load();
const AS_OF = '2026-09-17';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Facts that engage HIPAA and the SHIELD Act at once, with a dated breach.
const BREACH = {
  entity: { is_hipaa_covered_entity: true, nexus: ['US', 'US-NY'],
            owns_or_licenses_computerized_data: true },
  data: { is_phi: true, includes_ny_private_information: true },
  context: { as_of: AS_OF, state_layers: ['US-NY'],
    event: { type: ['breach_of_unsecured_phi', 'breach_of_security_of_the_system'],
             discovery_of_breach: '2026-09-08' } },
};

// ================================================================ premise
{
  ok('the alias table resolves entirely to instruments the corpus holds',
     unresolvableAliases(kb).length === 0,
     unresolvableAliases(kb).map(entry => entry.alias).slice(0, 4).join(','));

  // "HIPAA preempts state breach law" is the canonical false premise: 45 C.F.R. § 160.203 makes
  // HIPAA a FLOOR, so the more stringent state duty survives.
  const preempt = checkPremise({ kind: 'preempts', federal: 'HIPAA', state: '899-aa' }, kb);
  ok('a floor posture CONTRADICTS a preemption premise', preempt.status === 'CONTRADICTED',
     JSON.stringify(preempt.postures));
  ok('...and cites the posture it relied on',
     preempt.findings.some(entry => /floor/.test(entry.message)));

  // Pending law asserted as binding.
  const pending = checkPremise({ kind: 'in_force', instrument: 'SAFE for Kids Act', as_of: AS_OF }, kb);
  ok('enacted-but-pending law CONTRADICTS an "is now law" premise',
     pending.status === 'CONTRADICTED', pending.findings.map(entry => entry.code).join(','));
  ok('...and names the date it actually commences',
     pending.findings.some(entry => /2027-01-25/.test(entry.message + JSON.stringify(entry.detail ?? ''))));

  // Backstops never turn off.
  const nothing = checkPremise({ kind: 'no_law_applies',
    facts: { entity: { within_ftc_jurisdiction: true, in_or_affecting_commerce: true, nexus: ['US'] } },
    as_of: AS_OF }, kb);
  ok('"no law applies" is contradicted by a backstop', nothing.status === 'CONTRADICTED');

  // THE VOCABULARY. A premise checker that says "true" has overstepped exactly as far as a
  // citation auditor that says "verified".
  const everything = JSON.stringify(premises(
    [{ kind: 'preempts', federal: 'HIPAA', state: '899-aa' },
     { kind: 'in_force', instrument: 'SAFE for Kids Act', as_of: AS_OF }], kb));
  ok('no premise is ever reported TRUE',
     !/"status"\s*:\s*"TRUE"|\bpremise is true\b|\bconfirmed true\b/i.test(everything));
  ok('the caveat says CONSISTENT is not TRUE',
     /CONSISTENT IS NOT "TRUE"/.test(premises([{ kind: 'preempts', federal: 'HIPAA' }], kb).caveat ?? ''));

  // An exemption that reaches the facts but is not entity-level must not read as a general release.
  const carve = checkPremise({ kind: 'exempt', instrument: 'HIPAA',
    facts: { entity: { is_hipaa_covered_entity: true }, data: { is_employment_record: true } } }, kb);
  ok('an exemption premise never resolves to a bare "you are exempt"',
     ['CONSISTENT', 'PARTIAL', 'UNSUPPORTED', 'CANNOT_CHECK'].includes(carve.status)
     && (carve.status !== 'CONSISTENT' || carve.findings.some(entry => /ENTITY-LEVEL/.test(entry.message))),
     carve.status);

  // Prose: shapes matched, and silence about the rest said out loud.
  const found = premisesIn('HIPAA preempts New York law. No privacy law applies. '
    + 'Since the SHIELD Act is now law, we are fine.');
  ok('three distinct premise shapes are extracted from prose', found.length === 3,
     found.map(entry => entry.kind).join(','));
  ok('text with no typable premise is refused, and says silence is not an all-clear',
     /never that the text contains no false premise/.test(
       premises('We process personal data carefully.', kb).error ?? ''));
  ok('an untypable premise kind is reported, not guessed at',
     checkPremise({ kind: 'vibes' }, kb).findings.some(entry => entry.code === 'PREMISE_KIND_UNKNOWN'));
  ok('every checker kind is reachable', PREMISE_KINDS.length === 4, PREMISE_KINDS.join(','));
}

// ================================================================ register
{
  const dir = mkdtempSync(`${tmpdir()}/pkb-reg-`);
  const previous = process.env.PRIVACY_KB_PROFILES;
  process.env.PRIVACY_KB_PROFILES = dir;
  try {
    const built = register(BREACH.entity, BREACH.data, BREACH.context, kb);
    ok('the register lists an obligation per applicable duty', built.rows.length > 10,
       `${built.rows.length}`);

    // THE CLOCK COLUMN. result.obligations is a projection with no deadline on it; reading the
    // trigger from there reported every duty as having no fixed period, including five that were
    // running.
    ok('a running clock is distinguished from one that has not started',
       built.summary.clocks_running > 0 && built.summary.clocks_not_started > 0,
       `${built.summary.clocks_running} running, ${built.summary.clocks_not_started} not started`);
    ok('...and a running row carries the computed due date',
       built.rows.filter(row => row.clock_status === 'running').every(row => !!row.due));
    ok('...while a not-started row carries none',
       built.rows.filter(row => row.clock_status === 'not_started').every(row => !row.due));

    // The empty column is the point.
    ok('with nothing bound, every row is unevidenced',
       built.summary.unevidenced === built.rows.length && built.summary.evidenced === 0);

    const target = built.rows[0].atom_id;
    bindEvidence(target, { document: 'notice.pdf', owner: 'Privacy Office' });
    const after = register(BREACH.entity, BREACH.data, BREACH.context, kb);
    ok('binding a document is reflected in the register', after.summary.evidenced === 1);
    ok('...and the bound row carries the document',
       after.rows.find(row => row.atom_id === target)?.evidence?.document === 'notice.pdf');

    // Evidence on something that no longer applies reads as coverage and is not.
    bindEvidence('us.not.a.real.obligation', { document: 'stale.pdf' });
    const stale = register(BREACH.entity, BREACH.data, BREACH.context, kb);
    ok('evidence bound to an inapplicable obligation is reported separately',
       stale.summary.evidence_bound_to_inapplicable === 1
       && stale.orphaned_evidence.includes('us.not.a.real.obligation'));
    ok('...and is NOT counted as coverage', stale.summary.evidenced === 1);

    // VOCABULARY. Binding a file records an offer, never a satisfied duty.
    const wire = JSON.stringify(bindEvidence('x.y', { document: 'a.pdf' }));
    ok('binding never claims the obligation is satisfied',
       !/satisfies|complies|compliant|meets the requirement/i.test(wire.replace(/Whether it SATISFIES[^"]*/i, '')));
    ok('...and says explicitly that whether it satisfies is a reading',
       /whether it SATISFIES/i.test(wire));
    unbindEvidence('x.y'); unbindEvidence('us.not.a.real.obligation');

    // CSV has to survive a requirement containing a comma and a quote.
    const csv = registerCsv(register(BREACH.entity, BREACH.data, BREACH.context, kb));
    const header = csv.split('\n')[0].split(',').length;
    ok('every CSV row has the same column count as the header',
       csv.split('\n').slice(1).filter(Boolean).every(line => {
         let count = 1, inQuote = false;
         for (let i = 0; i < line.length; i += 1) {
           const ch = line[i];
           if (ch === '"') { if (inQuote && line[i + 1] === '"') i += 1; else inQuote = !inQuote; }
           else if (ch === ',' && !inQuote) count += 1;
         }
         return count === header;
       }), `${header} columns`);

    ok('the register refuses without a date',
       !!register(BREACH.entity, BREACH.data, {}, kb).error);
    ok('...and refuses a malformed one',
       !!register(BREACH.entity, BREACH.data, { as_of: 'not-a-date' }, kb).error);
    ok('coverage gaps travel with the register', Array.isArray(built.coverage_gaps));
    ok('markdown leads with the unevidenced count',
       /with no evidence bound/.test(registerMarkdown(built, 'x')));
  } finally {
    if (previous === undefined) delete process.env.PRIVACY_KB_PROFILES;
    else process.env.PRIVACY_KB_PROFILES = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

// ================================================================ overlaps
{
  const built = overlaps(BREACH.entity, BREACH.data, BREACH.context, kb);
  const group = built.groups.find(entry => entry.trigger === 'discovery_of_breach');
  ok('duties sharing a trigger are grouped', !!group, built.groups.map(g => g.trigger).join(','));
  ok('the shortest period is reported as binding',
     group?.binding?.days === 30, `${group?.binding?.period}`);
  ok('...and it is the SHIELD 30-day duty, not a HIPAA 60-day one',
     /899-aa/.test(group?.binding?.citation ?? ''), group?.binding?.citation);
  ok('every other duty is listed rather than collapsed away',
     (group?.duties?.length ?? 0) >= 5, `${group?.duties?.length} duties`);
  ok('...each with its margin to the binding one',
     group.duties.filter(duty => duty.days === 60).every(duty => duty.margin_days === 30));

  // THE CLAIM THAT WOULD BE WRONG. The shortest period binds the work; it discharges nothing.
  ok('it never says the longer duties are discharged or preempted',
     !/discharg(ed|es)\b(?!.*NOT)|preempt(ed|s) the other|no longer applies/i
       .test(JSON.stringify(built).replace(/It does NOT discharge the others[^"]*/g, '')));
  ok('...and says so in terms', /does NOT discharge the others/i.test(group?.note ?? ''));

  // A single duty on a trigger is not an overlap.
  ok('a trigger carrying one duty produces no group',
     built.groups.every(entry => entry.duties.length > 1));

  // Business days are never ordered against calendar days.
  ok('business-day periods are never given a comparable day count',
     built.groups.every(entry => entry.incomparable.every(row => /business days|no comparable/.test(row.why))));
  ok('the caveat warns against converting business days',
     /Business-day periods are reported but never ordered/.test(built.caveat ?? ''));

  ok('overlaps refuses without a date', !!overlaps(BREACH.entity, BREACH.data, {}, kb).error);
  ok('markdown renders without a crash on an empty analysis',
     typeof overlapMarkdown({ as_of: AS_OF, groups: [], summary: {} }, null) === 'string');
}

// ================================================================ interview
{
  const cold = interview({}, { as_of: AS_OF }, kb);
  ok('knowing nothing, every live obligation is unresolved',
     cold.summary.unresolved === cold.summary.obligations_considered
     && cold.summary.resolved_applies === 0, `${cold.summary.unresolved}`);
  ok('...and questions are ranked by how many obligations they block',
     cold.questions.every((entry, i) => i === 0 || cold.questions[i - 1].blocks >= entry.blocks));
  ok('...and are phrased as questions, not as key names',
     cold.questions.every(entry => /\?$/.test(entry.question) && !/^What is [a-z_]+\.[a-z_]+\?$/.test(entry.question)),
     cold.questions[0]?.question);

  const warm = interview({ entity: { is_hipaa_covered_entity: true }, data: { is_phi: true } },
    { as_of: AS_OF }, kb);
  ok('answering a question resolves obligations', warm.summary.resolved_applies > 0,
     `${warm.summary.resolved_applies} apply`);
  ok('...and an answered key drops out of the ranking',
     !warm.questions.some(entry => entry.fact_key === 'entity.is_hipaa_covered_entity'));
  ok('...and the ranking is recomputed, not merely filtered',
     warm.summary.unresolved < cold.summary.unresolved);

  // UNKNOWN IS NOT "DOES NOT APPLY". Reporting it as such is the whole hazard.
  ok('unresolved is counted separately from does-not-apply',
     typeof cold.summary.unresolved === 'number'
     && typeof cold.summary.resolved_does_not_apply === 'number'
     && cold.summary.unresolved !== cold.summary.resolved_does_not_apply);
  ok('nothing is assumed: no answer is invented for an unsupplied fact',
     cold.questions.every(entry => entry.values === null || Array.isArray(entry.values)));
  ok('the caveat says it is a ranking, not a minimum set',
     /A RANKING, NOT A MINIMUM SET/.test(cold.caveat ?? ''));
  ok('interview refuses without a date', !!interview({}, {}, kb).error);
  ok('markdown renders on an empty question set',
     typeof interviewMarkdown({ as_of: AS_OF, questions: [], summary: {} }, null) === 'string');
}

// ================================================================ calendar
{
  const built = calendar(BREACH.entity, BREACH.data, BREACH.context, kb);
  ok('started clocks become entries', built.summary.scheduled > 0, `${built.summary.scheduled}`);
  ok('...and every entry carries a due date', built.entries.every(row => !!row.due));

  // THE REFUSAL. A clock with no trigger date must never be given one.
  ok('clocks that have not started are listed and NOT scheduled',
     built.summary.not_started > 0 && built.not_started.every(row => !row.due),
     `${built.summary.not_started} not started`);
  ok('...each saying why it has no date',
     built.not_started.every(row => typeof row.why === 'string' && row.why.length > 20));

  const ics = calendarIcs(built, { dtstamp: '20260917T000000Z' });
  ok('the feed is RFC 5545 shaped', /^BEGIN:VCALENDAR\r\n/.test(ics) && /END:VCALENDAR\r\n$/.test(ics));
  ok('...with CRLF line endings throughout', !/[^\r]\n/.test(ics));
  ok('...and no line over 75 octets, counting bytes not characters',
     ics.split('\r\n').every(line => Buffer.byteLength(line, 'utf8') <= 75),
     `longest ${Math.max(...ics.split('\r\n').map(line => Buffer.byteLength(line, 'utf8')))}`);
  ok('...and exactly one VEVENT per scheduled entry',
     (ics.match(/BEGIN:VEVENT/g) ?? []).length === built.summary.scheduled);
  ok('no unstarted obligation appears in the feed',
     built.not_started.every(row => !ics.includes(row.atom_id)));

  // An outer limit is the last lawful day, not the target.
  ok('an outer-limit entry says promptness is also required',
     !built.entries.some(row => row.also_requires_promptness)
     || /promptness also required/.test(ics));
  // UNFOLD BEFORE SEARCHING. RFC 5545 folds at 75 octets by inserting CRLF-space, which splits a
  // 64-character hash across two lines — so a naive includes() reports a missing hash on a feed
  // that carries it correctly. Unfolding is what a conforming parser does first.
  const unfolded = ics.replace(/\r\n /g, '');
  const hashed = built.entries.filter(row => row.source_sha256);
  ok('every entry carries its source hash so the date can be checked',
     hashed.length > 0 && hashed.every(row => unfolded.includes(row.source_sha256)),
     `${hashed.length} of ${built.entries.length} entries carry a hash`);

  // A pinned dtstamp must give byte-identical output, or two exports cannot be diffed.
  const again = calendarIcs(calendar(BREACH.entity, BREACH.data, BREACH.context, kb),
    { dtstamp: '20260917T000000Z' });
  ok('a pinned dtstamp produces byte-identical feeds', digest(ics) === digest(again));
  ok('...and the UID is stable across runs, so re-import updates rather than duplicates',
     (ics.match(/UID:[0-9a-f]+@privacy-kb/g) ?? []).join() ===
     (again.match(/UID:[0-9a-f]+@privacy-kb/g) ?? []).join());

  ok('calendar refuses without a date', !!calendar(BREACH.entity, BREACH.data, {}, kb).error);
  ok('a refused calendar renders no feed', calendarIcs({ error: 'nope' }) === null);
}

// ================================================================ determinism across the set
{
  const run = () => digest([
    premises([{ kind: 'preempts', federal: 'HIPAA', state: '899-aa' }], kb),
    overlaps(BREACH.entity, BREACH.data, BREACH.context, kb),
    interview({ entity: { is_hipaa_covered_entity: true } }, { as_of: AS_OF }, kb),
    calendar(BREACH.entity, BREACH.data, BREACH.context, kb),
  ]);
  const runs = [run(), run(), run()];
  ok('three runs of the whole set are byte-identical', new Set(runs).size === 1,
     runs[0].slice(0, 12));
}


// ================================================================ red-team findings
{
  // PREEMPTION RUNS ONE WAY. Naming a state instrument in the federal slot was answered on its own
  // recorded posture — "899-aa preempts HIPAA" came back CONSISTENT on a ceiling recorded about
  // New York law, inverting the Supremacy Clause.
  const inverted = checkPremise({ kind: 'preempts', federal: '899-aa', state: 'HIPAA' }, kb);
  ok('a state instrument named as the preempting one is CONTRADICTED, not answered',
     inverted.status === 'CONTRADICTED'
     && inverted.findings.some(entry => entry.code === 'PREMISE_INVERTED'), inverted.status);
  ok('...and the federal direction still resolves normally',
     checkPremise({ kind: 'preempts', federal: 'HIPAA', state: '899-aa' }, kb).status === 'CONTRADICTED');

  // A negative limit made slice count from the end: 119 questions returned, 129 reported as "more".
  for (const limit of [0, -5, -1]) {
    const ranked = interview({}, { as_of: AS_OF }, kb, { limit });
    ok(`interview survives limit ${limit} without a nonsense pair`,
       ranked.questions.length === 0 && ranked.more_questions >= 0,
       `${ranked.questions.length} shown, ${ranked.more_questions} more`);
  }

  // A register is opened in a spreadsheet. A cell beginning =, +, - or @ is evaluated as a formula.
  const injected = registerCsv({ rows: [
    { citation: '=cmd|\' /C calc\'!A0', requirement: '+1+1', atom_id: '@SUM(1)', instrument_id: '-2' }] });
  const cells = injected.split('\n')[1];
  ok('CSV cells beginning with a formula character are neutralised',
     !/(^|,)[=+\-@]/.test(cells), cells.slice(0, 60));
  ok('...and ordinary cells are left alone',
     /45 C\.F\.R/.test(registerCsv(register(BREACH.entity, BREACH.data, BREACH.context, kb))));
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
