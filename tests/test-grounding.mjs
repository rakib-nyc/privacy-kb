#!/usr/bin/env node
// engine/grounding.mjs — auditing a claim against the citation offered for it.
//
// Most of these assertions are about what the module REFUSES to say. The failure mode of an audit
// tool is not missing a problem, it is manufacturing confidence: a row that reads "verified" when
// all that was established is that a citation resolves. So the tests pin the vocabulary as hard as
// they pin the detection.
import { ground, groundOne, groundText, citationsIn } from '../engine/grounding.mjs';
import { load, surfaceable } from '../engine/corpus.mjs';
import { createHash } from 'node:crypto';

let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!cond) fail += 1;
};
const kb = load();
const codes = row => row.findings.map(entry => entry.code);

// ---------------------------------------------------------------- a citation that resolves
{
  const row = groundOne({
    proposition: 'A covered entity must notify each affected individual without unreasonable delay.',
    citation: '45 C.F.R. § 164.404(b)', as_of: '2026-09-16' }, kb);
  ok('a held, in-force citation produces no high-severity finding', row.status === 'NO_PROBLEM_FOUND',
     codes(row).join(',') || 'no findings');
  ok('...and quotes what the source actually says', typeof row.quoted === 'string' && row.quoted.length > 40);
  ok('...and carries the source hash so the quotation can be checked',
     !!row.source?.raw_sha256, row.source?.raw_sha256?.slice(0, 12));
  ok('...and names the record it resolved to', typeof row.record_id === 'string' && row.record_id.length > 0);
}

// ---------------------------------------------------------------- the date checks
{
  // LL144's bias-audit duty commenced 2023-01-01. Cited two years early it is a real provision,
  // correctly quoted, attached to a date it did not govern.
  const row = groundOne({ proposition: 'Employers must run a bias audit.',
    citation: 'N.Y.C. Admin. Code § 20-871(a)', as_of: '2021-06-01' }, kb);
  ok('a provision cited before it was in force is caught', codes(row).includes('NOT_IN_FORCE_ON_DATE'));
  ok('...and that is high severity, not a note', row.status === 'PROBLEMS_FOUND');

  const fine = groundOne({ proposition: 'Employers must run a bias audit.',
    citation: 'N.Y.C. Admin. Code § 20-871(a)', as_of: '2024-06-01' }, kb);
  ok('...and the same citation inside its window is not flagged',
     !codes(fine).includes('NOT_IN_FORCE_ON_DATE'));

  const undated = groundOne({ proposition: 'Employers must run a bias audit.',
    citation: 'N.Y.C. Admin. Code § 20-871(a)' }, kb);
  ok('a claim with no as-of date says the temporal check did not run',
     codes(undated).includes('NO_AS_OF_SUPPLIED'));
  ok('...and a malformed as-of is refused rather than compared as a string',
     codes(groundOne({ citation: '45 C.F.R. § 164.404(b)', as_of: 'not-a-date' }, kb))
       .includes('AS_OF_NOT_A_DATE'));
}

// ---------------------------------------------------------------- the inapplicable authority
{
  // THE CASE THE WHOLE MODULE EXISTS FOR. Real provision, exact quotation, wrong population. A
  // reader who follows the citation sees text that says what the answer said it says.
  const row = groundOne({
    proposition: 'Your company must notify affected individuals within 60 days.',
    citation: '45 C.F.R. § 164.404(b)', as_of: '2026-09-16',
    facts: { entity: { is_hipaa_covered_entity: false, nexus: ['US'] }, data: { is_phi: false } },
  }, kb);
  ok('a provision that does not reach the facts is caught',
     codes(row).includes('DOES_NOT_REACH_THESE_FACTS'));
  const finding = row.findings.find(entry => entry.code === 'DOES_NOT_REACH_THESE_FACTS');
  ok('...and names the predicate that failed, so the finding can be checked',
     typeof finding?.detail?.failed_predicate === 'string' && finding.detail.failed_predicate.length > 8,
     finding?.detail?.failed_predicate);

  const reaches = groundOne({
    proposition: 'Your company must notify affected individuals within 60 days.',
    citation: '45 C.F.R. § 164.404(b)', as_of: '2026-09-16',
    facts: { entity: { is_hipaa_covered_entity: true, nexus: ['US'] }, data: { is_phi: true } },
  }, kb);
  ok('...and the same citation IS allowed where the facts do reach it',
     !codes(reaches).includes('DOES_NOT_REACH_THESE_FACTS'));

  // A missing fact must read as unknown, never resolve toward "does not apply" — that would report
  // a duty as inapplicable because the caller was silent about it.
  const thin = groundOne({ proposition: 'x', citation: '45 C.F.R. § 164.404(b)', as_of: '2026-09-16',
    facts: { entity: {}, data: {} } }, kb);
  ok('an unsupplied fact is UNKNOWN, not "does not apply"',
     !codes(thin).includes('DOES_NOT_REACH_THESE_FACTS'), codes(thin).join(','));
}

// ---------------------------------------------------------------- what it refuses to say
{
  const missing = groundOne({ proposition: 'California requires notice within 30 days.',
    citation: 'Cal. Civ. Code § 1798.82', as_of: '2026-09-16' }, kb);
  ok('a citation outside coverage is NOT_HELD', codes(missing).includes('CITATION_NOT_HELD'));
  ok('...and is never called fabricated or invented',
     !/fabricat|invent|does not exist|made up/i.test(
       missing.findings.map(entry => entry.message).join(' ').replace(/NOT a finding[^.]*\./i, '')),
     'absence from this corpus is not absence from law');
  ok('...and its status is CANNOT_CHECK, not a clean pass', missing.status === 'CANNOT_CHECK');

  const audit = ground([{ citation: '45 C.F.R. § 164.404(b)', proposition: 'x', as_of: '2026-09-16' }], kb);
  ok('no output anywhere claims a proposition is CORRECT',
     !/\bis correct\b|\bverified correct\b|"correct"/i.test(JSON.stringify(audit)));
  ok('the caveat says NO_PROBLEM_FOUND is not "correct"',
     /NO_PROBLEM_FOUND IS NOT "CORRECT"/.test(audit.caveat ?? ''));
  ok('the summary separates what was checkable from what was clean',
     typeof audit.summary.checkable === 'number' && typeof audit.summary.not_checkable === 'number');
}

// ---------------------------------------------------------------- invariant I1
{
  const suppressed = (kb.all ?? []).filter(record => !surfaceable(record));
  const withCitation = suppressed.filter(record => record.source?.citation);
  if (!withCitation.length) {
    console.log('note  no suppressed record carries a citation — the I1 branch is UNEXERCISED here.');
  } else {
    const row = groundOne({ proposition: 'x', citation: withCitation[0].source.citation }, kb);
    ok('a suppressed record is refused rather than quoted', row.status === 'CANNOT_CHECK'
       && codes(row).includes('CITATION_SUPPRESSED'));
    ok('...and its text is never returned', row.quoted === null);
  }
  // No suppressed text may reach the output by any route.
  const forbidden = suppressed.flatMap(record =>
    [record.verbatim_span, record.doctrine_statement, record.summary]
      .map(value => String(value ?? '').trim()).filter(text => text.length > 30));
  const everything = JSON.stringify(ground(
    suppressed.map(record => ({ proposition: 'x', citation: record.source?.citation ?? record.id })), kb));
  ok('no suppressed text appears anywhere in an audit',
     forbidden.every(span => !everything.includes(span.slice(0, 40))), `${forbidden.length} fragment(s)`);
}

// ---------------------------------------------------------------- the support signal
{
  const row = groundOne({ proposition: 'zebra quarterly aardvark telephone sandwich',
    citation: '45 C.F.R. § 164.404(b)', as_of: '2026-09-16' }, kb);
  ok('a proposition sharing no vocabulary with the source is flagged as a PROMPT to read',
     codes(row).includes('SUPPORT_NOT_ESTABLISHED'));
  ok('...but only as advisory, because overlap can never be a verdict',
     row.findings.find(entry => entry.code === 'SUPPORT_NOT_ESTABLISHED')?.severity === 'advisory');
  ok('...and it never changes the status on its own', row.status === 'NO_PROBLEM_FOUND');
  ok('the signal says in its own text that it is not a determination',
     /NOT A DETERMINATION/i.test(row.support_signal?.note ?? ''));
}

// ---------------------------------------------------------------- totality and determinism
{
  ok('total on null', (() => { try { return !!ground(null, null, null); } catch { return false; } })());
  ok('an empty claim list is refused rather than reported as a clean audit',
     ground([], kb).error === 'no claims given');
  ok('a proposition with NO citation is reported, not skipped',
     ground([{ proposition: 'You must appoint a data protection officer.' }], kb)
       .results[0].findings.some(entry => entry.code === 'NO_CITATION_OFFERED'));

  const claims = [{ proposition: 'x', citation: '45 C.F.R. § 164.404(b)', as_of: '2026-09-16' },
                  { proposition: 'y', citation: 'Cal. Civ. Code § 1798.82', as_of: '2026-09-16' }];
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const runs = [digest(ground(claims, kb)), digest(ground(claims, kb)), digest(ground(claims, kb))];
  ok('three audits of the same claims are byte-identical', new Set(runs).size === 1,
     runs[0].slice(0, 12));
}

// ---------------------------------------------------------------- auditing prose
{
  const prose = 'Under 45 C.F.R. § 164.404(b) you must notify individuals within 60 days. '
    + 'The SAFE for Kids Act at N.Y. Gen. Bus. Law § 1501(1) is law, so obtain consent today. '
    + 'California is covered by Cal. Civ. Code § 1798.82 and Texas by Tex. Bus. & Com. Code § 521.053.';

  const found = citationsIn(prose);
  ok('every citation in the prose is extracted, in-scope or not', found.length === 4, found.join(' | '));
  // THE OUT-OF-SCOPE ONES MATTER MOST HERE. A pattern list scoped to what the corpus could hold
  // drops every other authority in silence, and an audit reporting "2 citations checked" over a
  // paragraph citing four has measured itself rather than the text.
  ok('...including citations this corpus can never hold',
     found.some(cite => /Cal\. Civ\./.test(cite)) && found.some(cite => /Tex\./.test(cite)));
  ok('...and one authority is not counted twice at different boundaries',
     new Set(found.map(cite => cite.replace(/^[^§]*/, ''))).size === found.length, found.join(' | '));

  const audit = groundText(prose, kb, { as_of: '2026-09-16' });
  ok('auditing prose reports the pending provision as not binding today',
     audit.results.find(row => /1501/.test(row.citation))?.findings
       .some(entry => entry.code === 'PENDING_NOT_BINDING'));
  ok('...and reports what it extracted, so the count can be checked against the text',
     Array.isArray(audit.extracted) && audit.extracted.length === audit.checked);

  // The sentence a citation sits in is a guess about punctuation, not a reading of the argument.
  // Scoring overlap against a guess fired on nearly every row, and a finding that fires on
  // everything is one people learn to skip.
  ok('a proposition guessed from layout does not raise a support flag',
     audit.results.every(row => !row.findings.some(entry => entry.code === 'SUPPORT_NOT_ESTABLISHED')));
  ok('...but the raw signal is still reported, and says it is weaker',
     audit.results.some(row => /guess about layout/.test(row.support_signal?.note ?? '')));

  ok('text citing nothing is refused, and says why that matters',
     /UNGROUNDED/.test(groundText('There is no citation anywhere in this sentence.', kb).error ?? ''));
  ok('groundText is total on null', (() => {
     try { return !!groundText(null, null, null); } catch { return false; } })());
}

// ---------------------------------------------------------------- no facts, no predicate noise
{
  // Testing a predicate against an empty fact set returns UNKNOWN for every obligation in the
  // corpus — true, useless, and enough noise to bury the findings that matter.
  const quiet = groundText('Under 45 C.F.R. § 164.404(b) you must notify individuals.', kb,
    { as_of: '2026-09-16' });
  ok('no facts supplied means no applicability finding at all',
     quiet.results.every(row => !row.findings.some(entry => entry.code === 'APPLICABILITY_UNKNOWN')));
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
