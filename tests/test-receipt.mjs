#!/usr/bin/env node
// privacy_receipt + betweenDates + conform.
//
// The receipt's whole value is that it is stable for the right reasons and unstable for the right
// reasons. Most of these tests are about which changes MUST move a digest and which must NOT.
import { issueReceipt, verifyReceipt, corpusDigest } from '../engine/receipt.mjs';
import { betweenDates } from '../engine/exposure.mjs';
import { conform, conformMarkdown } from '../engine/conform.mjs';
import { load } from '../engine/corpus.mjs';

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fail++; };
const kb = load();
const E = { is_hipaa_covered_entity: true, owns_or_licenses_computerized_data: true };
const D = { is_phi: true, includes_ny_private_information: true };
const C = { as_of: '2026-09-15', state_layers: ['US-NY'] };

// ---------------------------------------------------------------- receipt: totality
for (const [label, args] of [['all null', [null, null, null, null]],
                             ['null corpus', [E, D, C, null]],
                             ['string facts', ['x', 'y', C, kb]],
                             ['number facts', [1, 2, C, kb]]]) {
  let threw = false, out = null;
  try { out = issueReceipt(...args); } catch { threw = true; }
  ok(`receipt total on ${label}`, !threw && !!out?.receipt_id, threw ? 'THREW' : '');
}

// ---------------------------------------------------------------- stable for the right reasons
{
  const one = issueReceipt(E, D, C, kb);
  const two = issueReceipt(E, D, C, kb);
  ok('same question, same corpus → same receipt id', one.receipt_id === two.receipt_id);
  ok('issued_at differs between the two but the id does not',
     one.receipt_id === two.receipt_id);
  ok('key ORDER in the facts does not move the digest',
     issueReceipt({ owns_or_licenses_computerized_data: true, is_hipaa_covered_entity: true },
                  D, C, kb).receipt_id === one.receipt_id);
  ok('state_layers ORDER does not move the digest',
     issueReceipt(E, D, { ...C, state_layers: ['US-NY'] }, kb).receipt_id === one.receipt_id);
}

// ---------------------------------------------------------------- unstable for the right reasons
{
  const base = issueReceipt(E, D, C, kb);
  ok('a different as_of moves the id',
     issueReceipt(E, D, { ...C, as_of: '2026-09-16' }, kb).receipt_id !== base.receipt_id);
  ok('a different fact moves the id',
     issueReceipt({ ...E, glba_financial_institution: true }, D, C, kb).receipt_id !== base.receipt_id);
  ok('dropping a state layer moves the id',
     issueReceipt(E, D, { ...C, state_layers: [] }, kb).receipt_id !== base.receipt_id);
}

// ---------------------------------------------------------------- verification names the cause
{
  const claimed = issueReceipt(E, D, C, kb);
  const same = verifyReceipt(claimed, E, D, C, kb);
  ok('verifying against the same inputs succeeds', same.verified === true);
  const diff = verifyReceipt(claimed, E, D, { ...C, as_of: '2027-01-01' }, kb);
  ok('a changed question fails verification', diff.verified === false);
  ok('...and names inputs_digest as what moved', diff.moved.includes('inputs_digest'));
  ok('...in language a non-engineer can act on', /DIFFERENT QUESTION/.test(diff.reason));
  ok('verifying against nothing is refused, not passed',
     verifyReceipt(null, E, D, C, kb).verified === false);
}

// ---------------------------------------------------------------- corpus digest semantics
{
  const fp = corpusDigest(kb);
  ok('the corpus digest covers every record', fp.records === (kb.all ?? []).length,
     `${fp.records} of ${(kb.all ?? []).length}`);
  ok('the corpus digest is stable across calls', corpusDigest(kb).digest === fp.digest);
}

// ---------------------------------------------------------------- betweenDates
{
  const r = betweenDates(E, D, { state_layers: ['US-NY'] }, '2019-06-01', '2026-09-15', kb);
  ok('between: reports differences over time',
     r.commenced.length + r.indeterminate.length > 0,
     `${r.commenced.length} commenced, ${r.indeterminate.length} indeterminate`);

  // SHIELD § 899-bb took effect 21 March 2020 and that date is almost certainly right. The corpus
  // cannot SHOW that it is: the record's effective_from_basis is "undetermined", which
  // engine/dates.mjs defines as a date traceable to nothing this repository holds. So the honest
  // bucket is indeterminate, not commenced.
  //
  // This assertion used to require § 899-bb in `gained`, which is how the test came to encode the
  // defect as the expected behaviour: everything was `gained`, including N.Y. Gen. Bus. Law § 349,
  // on the books since 1970 and fetched in 2026.
  const shield = r.indeterminate.find(row => /899-bb/.test(row.citation ?? ''));
  ok('between: SHIELD safeguards are INDETERMINATE, not attributed to a commencement', !!shield,
     shield ? shield.effective_from_basis : 'not found in indeterminate');
  ok('between: ...and every indeterminate row says why it cannot be attributed',
     r.indeterminate.every(row => typeof row.why === 'string' && row.why.length > 40));
  ok('between: no row is BOTH attributed and unattributable',
     r.commenced.every(row => !r.indeterminate.some(x => x.atom_id === row.atom_id)));
  ok('between: names the window it could not be asked about', Array.isArray(r.unmeasurable));
  ok('between: carries the corpus-versus-law caveat', /WHAT THIS CORPUS HELD/.test(r.caveat ?? ''));
  ok('between: refuses without both dates', !!betweenDates(E, D, {}, '2019-06-01', null, kb).error);
  ok('between: total on junk', (() => {
    try { return !!betweenDates(null, null, null, 'x', 'y', kb); } catch { return false; } })());
  const same = betweenDates(E, D, { state_layers: ['US-NY'] }, '2026-09-15', '2026-09-15', kb);
  ok('between: identical dates produce no change',
     same.commenced.length === 0 && same.ceased.length === 0 && same.indeterminate.length === 0);
}

// ---------------------------------------------------------------- conform
{
  const doc = 'This notice describes how medical information about you may be used and disclosed.';
  const sheet = conform(doc, ['45 C.F.R. § 164.520(b)(1)'], kb, { signal: true });
  ok('conform: builds a row per requirement', sheet.rows.length > 0, `${sheet.rows.length}`);
  // THE LINE. A tool that fills this in has made a legal judgement silently.
  ok('conform: EVERY verdict is empty', sheet.rows.every(row => row.verdict === null));
  ok('conform: every row carries the requirement verbatim',
     sheet.rows.every(row => row.requirement.length > 0));
  ok('conform: every row carries a citation and a hash',
     sheet.rows.every(row => !!row.citation && !!row.sha256));
  ok('conform: every row declares its provenance tier',
     sheet.rows.every(row => ['record', 'segmentation'].includes(row.provenance)));
  ok('conform: the signal calls itself not a determination',
     sheet.rows.every(row => /NOT a determination/.test(row.keyword_signal?.caveat ?? '')));
  ok('conform: rows are ordered lowest overlap first',
     sheet.rows.every((row, i) => i === 0 ||
       (sheet.rows[i - 1].keyword_signal?.ratio ?? 0) <= (row.keyword_signal?.ratio ?? 0)));
  const nosig = conform(doc, ['45 C.F.R. § 164.520(b)(1)'], kb, {});
  ok('conform: no signal unless asked', nosig.signal_enabled === false &&
     nosig.rows.every(row => row.keyword_signal === undefined));
  ok('conform: refuses with no citation', !!conform(doc, [], kb, {}).error);
  ok('conform: total on a null document', (() => {
    try { return !!conform(null, ['45 C.F.R. § 164.520(b)(1)'], kb, {}); } catch { return false; } })());
  const md = conformMarkdown(sheet, 'test');
  ok('conform: markdown has an empty Met? column', /\| Met\? \|/.test(md) && /\| \| \|$/m.test(md));
  ok('conform: markdown says the verdict is deliberately empty', /empty on purpose/.test(md));
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
