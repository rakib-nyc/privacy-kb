#!/usr/bin/env node
// privacy_crosswalk: declared correspondences that carry both sides' words.
//
// The property under test is that nothing is INFERRED. A crosswalk is only as good as the reason
// someone wrote for it, and the commercial products in this category fail precisely by presenting
// an unauditable label as a mapping. Every assertion here must resolve to text a reader can check.
import { crosswalks, declaredCrosswalks } from '../engine/crosswalk.mjs';
import { segmentationLeafFor } from '../engine/requirements.mjs';
import { load } from '../engine/corpus.mjs';

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fail++; };
const kb = load();

// ---------------------------------------------------------------- totality
for (const [label, args] of [['null filter + null corpus', [null, null]],
                             ['number filter', [7, kb]], ['object filter', [{}, kb]],
                             ['array filter', [[], kb]]]) {
  let threw = false, out = null;
  try { out = crosswalks(...args); } catch { threw = true; }
  ok(`total on ${label}`, !threw && Array.isArray(out?.crosswalks), threw ? 'THREW' : '');
}

// ---------------------------------------------------------------- every link resolves
{
  const r = crosswalks(null, kb);
  ok('there are declared crosswalks', r.declared > 0, `${r.declared}`);
  ok('EVERY declared link resolves on both sides', r.unresolved === 0,
     r.unresolved ? `${r.unresolved} unresolved` : '');
  ok('both sides carry verbatim words',
     r.crosswalks.every(l => l.left.verbatim_span?.length > 0 && l.right.verbatim_span?.length > 0));
  ok('both sides carry a source hash',
     r.crosswalks.every(l => !!l.left.sha256 && !!l.right.sha256));
  ok('every link records HOW each side resolved',
     r.crosswalks.every(l => ['record','segmentation-leaf'].includes(l.left.via) &&
                             ['record','segmentation-leaf'].includes(l.right.via)));
}

// ---------------------------------------------------------------- the declaration is disciplined
{
  const links = declaredCrosswalks();
  ok('every link declares a basis',
     links.every(l => ['statutory','structural','analytical'].includes(l.basis)));
  ok('every link carries a written reason', links.every(l => String(l.note ?? '').trim().length > 40));
  ok('every link has a stable id', links.every(l => !!l.id) &&
     new Set(links.map(l => l.id)).size === links.length);
}

// ---------------------------------------------------------------- filtering
{
  const one = crosswalks('N.Y. Gen. Bus. Law § 899-bb(1)', kb);
  ok('filtering by citation narrows the set', one.count === 1 && one.declared > 1);
  ok('...and matches on either side',
     crosswalks('45 C.F.R. § 164.306(a)(1)', kb).count === 1);
  const none = crosswalks('45 C.F.R. § 999.999', kb);
  ok('an unlinked citation returns EMPTY, not a guess', none.count === 0);
}

// ---------------------------------------------------------------- leaf resolution
{
  const leaf = segmentationLeafFor('45 C.F.R. § 164.308(a)', kb);
  ok('a segmentation-only provision resolves to text', !!leaf && leaf.verbatim_span.length > 0);
  ok('...carrying the source hash', !!leaf?.sha256);
  ok('a nonsense citation resolves to null', segmentationLeafFor('45 C.F.R. § 999.999(z)', kb) === null);
}

// ---------------------------------------------------------------- determinism
{
  ok('two runs are byte-identical',
     JSON.stringify(crosswalks(null, kb)) === JSON.stringify(crosswalks(null, kb)));
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
