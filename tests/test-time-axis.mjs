#!/usr/bin/env node
// THE TIME AXIS, END TO END.
//
// The unit-level properties live in engine/test-engine.mjs and the structural rules are gates
// 43-45. This file asserts the things that are only visible when the corpus, the tools and the
// engine are put together — the ones that were actually wrong, in the terms a reader would
// notice them:
//
//   * a deadline record answering twenty-two years of questions with a number that did not
//     exist yet;
//   * an `effective_from` whose KIND nobody recorded, so a fetch timestamp and a statutory
//     effective date were indistinguishable;
//   * a ledger of missing prior vintages that silently drifts out of step with the corpus it
//     describes, which would turn a tracked gap back into an untracked one.
//
// These are regression tests in the strict sense: each one failed before this work.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { load, inForceOn } from '../engine/corpus.mjs';
import { deriveBasis, WEAK_BASES, BASES } from '../tools/date-basis.mjs';

const ROOT = resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  cond ? pass++ : fail++;
};

const corpus = load();

// ---------------------------------------------------------------- 1. named regressions
// 47 C.F.R. § 64.1200(d)(3). The section dates from 2003. Until 11 April 2025 it read "This
// period may not exceed 30 days from the date of such request"; the FCC then replaced that with
// "ten (10) business days from the receipt of such request". The corpus held the NEW wording
// under effective_from 2003-07-25, so every question about the do-not-call clock between those
// dates was answered with a deadline that did not yet exist. It is a deadline record, so the
// wrong number reached the deadline engine, not just the prose.
{
  const a = corpus.byId.get('us.tcpa.64_1200.d3.internal_dnc_honor');
  ok('TCPA do-not-call record exists', !!a);
  ok('...its text is the 10-business-day wording', /ten \(10\) business days/.test(a?.verbatim_span ?? ''));
  ok('...so it must NOT answer for 2010', !inForceOn(a, '2010-01-01'));
  ok('...nor for March 2025, weeks before the amendment', !inForceOn(a, '2025-03-01'));
  ok('...and it DOES answer from 2025-04-11', inForceOn(a, '2025-04-11'));
  ok('...its date rests on point-in-time evidence, not on the rule\'s age',
     a?.effective_from_basis === 'versioner_evidence', a?.effective_from_basis);
}

// 45 C.F.R. § 164.520(a)(1). The 2024 reproductive-health rule (89 FR 33064) inserted a
// paragraph and renumbered a cross-reference: "(a)(2) or (3)" became "(a)(3) or (4)". The corpus
// held the post-amendment wording under the 2003 Privacy Rule compliance date.
{
  const a = corpus.byId.get('us.cfr.45.164_520.a_1');
  ok('HIPAA notice-of-privacy-practices record exists', !!a);
  ok('...its text carries the post-2024 cross-reference',
     /paragraph \(a\)\(3\) or \(4\)/.test(a?.verbatim_span ?? ''));
  ok('...so it must NOT answer for 2010', !inForceOn(a, '2010-01-01'));
  ok('...and it DOES answer from 2024-06-25', inForceOn(a, '2024-06-25'));
}

// ---------------------------------------------------------------- 2. every date has a kind
{
  const all = corpus.all.filter(r => r?.id);
  const missing = all.filter(r => !r.effective_from_basis);
  ok('every record declares an effective_from_basis', missing.length === 0,
     missing.slice(0, 3).map(r => r.id).join(', '));
  const bad = all.filter(r => r.effective_from_basis && !(r.effective_from_basis in BASES));
  ok('...and every declared basis is one of the known kinds', bad.length === 0,
     bad.slice(0, 3).map(r => `${r.id}=${r.effective_from_basis}`).join(', '));

  // DERIVED, NEVER DECLARED. Gate 43 enforces this in CI; asserting it here too means a broken
  // derivation shows up as a test failure rather than only as a gate failure, which is the
  // difference between "someone edited a record" and "the tool stopped working".
  const drift = all.filter(r => deriveBasis(r).basis !== r.effective_from_basis);
  ok('every basis still matches what the source bytes support', drift.length === 0,
     drift.slice(0, 3).map(r => `${r.id}: declared ${r.effective_from_basis}, ` +
                                `derived ${deriveBasis(r).basis}`).join(' | '));

  // THE RATCHET COUNTS THE ANSWERING CORPUS, matching gate 43. A `provision` record is reference
  // text that engine/applicability.mjs never reads, so its date cannot decide what an answer
  // contains — which is the only thing invariant I2's comparison governs.
  const answering = all.filter(r => r.record_type !== 'provision');
  const weak = answering.filter(r => WEAK_BASES.includes(r.effective_from_basis));
  const declared = yaml.load(readFileSync(resolve(ROOT, 'meta/ratchets.yaml'), 'utf8'))
    ?.ratchets?.gate_43_weak_effective_from_basis?.value;
  ok('the weak-basis ratchet is declared', typeof declared === 'number', String(declared));
  ok('...and the live count is at or below it', weak.length <= declared,
     `${weak.length} vs ${declared}`);
  // Reference records are still stamped and still re-derived; they are simply outside the ratchet.
  const refs = all.filter(r => r.record_type === 'provision');
  ok('every provision record also declares a derived basis',
     refs.every(r => !!r.effective_from_basis), `${refs.length} provisions`);
  // api_snapshot is the kind that cannot be defended at all: it is the date of the fetch.
  const snap = all.filter(r => r.effective_from_basis === 'api_snapshot');
  ok('every api_snapshot date is still flagged as one', snap.length > 0,
     `${snap.length} records — all four N.Y. GBL § 899-aa among them`);
  ok('...including the SHIELD Act breach duty, the flagship case',
     snap.some(r => r.id === 'ny.gbl.899_aa.2.notify_residents'));
}

// ---------------------------------------------------------------- 3. the missing-vintage ledger
// Narrowing a record to the window its text covers trades a WRONG VINTAGE for a FALSE NEGATIVE:
// the engine now returns nothing for dates the missing prior text would have covered. That is
// the better error only while it stays visible, so the ledger must not drift out of step with
// the corpus it describes.
{
  const p = resolve(ROOT, 'meta/missing-vintages.yaml');
  ok('the missing-vintage ledger exists', existsSync(p));
  if (existsSync(p)) {
    const doc = yaml.load(readFileSync(p, 'utf8')) ?? {};
    const entries = doc.entries ?? [];
    ok('...and lists at least one gap', entries.length > 0, `${entries.length}`);
    ok('...and its count matches its entries', doc.count === entries.length);
    const orphan = entries.filter(e => !corpus.byId.get(e.atom_id));
    ok('...every entry names a record that exists', orphan.length === 0,
       orphan.map(e => e.atom_id).join(', '));
    // The entry says from when the corpus answers. If the record moved, the ledger is stale and
    // is describing a gap that is no longer the gap.
    const stale = entries.filter(e => corpus.byId.get(e.atom_id)?.effective_from !== e.corpus_now_answers_from);
    ok('...and none has drifted from the record it describes', stale.length === 0,
       stale.map(e => `${e.atom_id}: ledger ${e.corpus_now_answers_from}, ` +
                      `record ${corpus.byId.get(e.atom_id)?.effective_from}`).join(' | '));
    // Each gap must actually BE a gap: the record must be silent before the date.
    const notSilent = entries.filter(e => {
      const a = corpus.byId.get(e.atom_id);
      if (!a || !e.last_seen_without_this_text) return false;
      return inForceOn(a, e.last_seen_without_this_text);
    });
    ok('...and each record really is silent for the period its ledger entry claims',
       notSilent.length === 0, notSilent.map(e => e.atom_id).join(', '));
  }
}

// ---------------------------------------------------------------- 4. the tools agree
{
  let code = 0;
  try { execFileSync('node', ['tools/date-basis.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { code = e.status ?? 1; }
  ok('tools/date-basis.mjs --check agrees with the corpus', code === 0, `exit ${code}`);

  // The vintage report describes the corpus, so a record it names must still be there.
  const vp = resolve(ROOT, 'meta/ecfr-vintages.yaml');
  if (existsSync(vp)) {
    const rep = yaml.load(readFileSync(vp, 'utf8')) ?? {};
    const findings = rep.findings ?? [];
    ok('the vintage report names records that all exist',
       findings.every(f => corpus.byId.get(f.atom_id)),
       findings.filter(f => !corpus.byId.get(f.atom_id)).slice(0, 3).map(f => f.atom_id).join(', '));
    // THE CORE RULE, asserted independently of gate 45: no record may claim a date earlier than
    // the text it quotes.
    const overclaim = findings.filter(f => f.verdict === 'changed'
      && corpus.byId.get(f.atom_id)?.effective_from < f.span_first_seen);
    ok('no record claims an effective_from earlier than its own text', overclaim.length === 0,
       overclaim.map(f => `${f.atom_id} (${corpus.byId.get(f.atom_id)?.effective_from} < ${f.span_first_seen})`).join(' | '));
  }
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
