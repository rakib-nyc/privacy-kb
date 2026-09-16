#!/usr/bin/env node
// privacy_requirements: the checklist primitive.
//
// The property that matters is NOT "does it list elements". It is that the list knows its own
// incompleteness. A conformance checklist that silently omits two of five required items is worse
// than no checklist, because the reader ticks every box and is still exposed — which is this
// repository's oldest failure shape in the one place it would do the most damage.
import { requirementsFor, unionRequirements } from '../engine/requirements.mjs';
import { load } from '../engine/corpus.mjs';

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fail++; };
const kb = load();

// ---------------------------------------------------------------- totality
for (const [label, arg] of [['null', null], ['empty string', ''], ['number', 7],
                            ['array', []], ['object', {}]]) {
  let threw = false, out = null;
  try { out = requirementsFor(arg, kb); } catch { threw = true; }
  ok(`total on ${label}`, !threw && !!out && Array.isArray(out.elements), threw ? 'THREW' : '');
}
ok('total on a null corpus', (() => { try { return !!requirementsFor('x', null); } catch { return false; } })());

// ---------------------------------------------------------------- refusal, not improvisation
{
  const r = requirementsFor('45 C.F.R. § 999.999(z)', kb);
  ok('an unheld citation is REFUSED', r.found === false && !!r.error);
  ok('...and the refusal says the corpus does not hold it', /does not hold/.test(r.error));
  ok('...and returns no invented elements', r.elements.length === 0);
}

// ---------------------------------------------------------------- enumeration
{
  const r = requirementsFor('45 C.F.R. § 164.520(b)(1)', kb);
  ok('enumerates NPP content elements', r.found && r.count > 0, `${r.count} held`);
  ok('every element carries a citation', r.elements.every(e => !!e.citation));
  ok('every element carries verbatim words', r.elements.every(e => e.verbatim_span.length > 0));
  ok('every element carries a source hash', r.elements.every(e => !!e.sha256));
  ok('every element sits beneath the parent path',
     r.elements.every(e => e.path.length > 2 && e.path[0] === 'b' && e.path[1] === '1'));
}

// ---------------------------------------------------------------- THE POINT: it knows what it lacks
{
  const r = requirementsFor('45 C.F.R. § 164.520(b)(1)', kb);
  ok('the segmentation denominator is available', r.denominator.available === true);
  ok('the denominator EXCEEDS what is held — and says so',
     r.denominator.expected > r.count, `${r.count} held of ${r.denominator.expected}`);
  ok('names the unheld elements individually', r.denominator.missing.length > 0,
     `${r.denominator.missing.length} named`);
  ok('each unheld element carries a designation and a preview',
     r.denominator.missing.every(m => !!m.designation && m.preview.length > 0));
  // the mandatory NPP header statement is one of the missing ones — the single element whose
  // absence from a checklist would be most visible to a regulator
  ok('the missing list includes (b)(1)(i), the mandatory header statement',
     r.denominator.missing.some(m => m.designation === '(b)(1)(i)'));

  const baa = requirementsFor('45 C.F.R. § 164.504(e)(2)', kb);
  ok('BAA terms: holds far fewer than the source contains, and reports it',
     baa.denominator.available && baa.denominator.missing.length > baa.count,
     `${baa.count} held, ${baa.denominator.missing.length} not held`);
}

// ---------------------------------------------------------------- designator gap detection
{
  const r = requirementsFor('45 C.F.R. § 164.520(b)(1)', kb);
  // ANCHORED TO (b)(1), NOT TO A LEVEL THE CORPUS MAY LEGITIMATELY FILL. This asserted the head
  // gap under (b)(1)(ii) until a promotion cut (ii)(A)-(E) and the gap correctly moved — a true
  // test failing on a true improvement. (b)(1) is the stable anchor: the run starts at (ii)
  // because (b)(1)(i) is unheld, which the denominator assertion above independently pins, so
  // this case cannot quietly evaporate without that assertion failing first.
  const head = r.gaps.find(g => g.under === '(b)(1)');
  ok('detects a run that starts late as a HEAD gap', !!head && head.truncated_head === true);
  ok('...and names the missing designators', !!head && head.missing.includes('i'),
     head ? `missing ${head.missing.join(',')}` : 'no gap under (b)(1)');
  ok('does not report a level that exists only as structure',
     !r.gaps.some(g => g.under === '(b)(1)' && g.missing.includes('ii')));
}

// ---------------------------------------------------------------- a parent that is not a record
{
  const r = requirementsFor('45 C.F.R. § 164.404(c)', kb);
  ok('enumerates beneath a citation held only in the segmentation', r.found && r.count > 0);
  ok('...and flags that the parent is a segmentation node', r.parent_is_segmentation_node === true);
}

// ---------------------------------------------------------------- union across regimes
{
  const u = unionRequirements(['45 C.F.R. § 164.404(c)', 'N.Y. Gen. Bus. Law § 899-aa(7)'], kb);
  ok('union draws from both regimes', u.sources.length === 2);
  ok('federal elements are present', u.elements.some(e => /C\.F\.R/.test(e.citation)));
  // a provision with no sub-elements must still contribute, or the state layer vanishes
  ok('a provision with no sub-elements contributes itself',
     u.elements.some(e => /899-aa\(7\)/.test(e.citation)));
  ok('every element records which provisions demand it',
     u.elements.every(e => Array.isArray(e.demanded_by) && e.demanded_by.length > 0));
  ok('the union carries its own incompleteness', Array.isArray(u.not_held) && u.not_held.length > 0);
  ok('each not-held entry says which provision it belongs to',
     u.not_held.every(m => !!m.from));
  const bad = unionRequirements(['45 C.F.R. § 999.999'], kb);
  ok('an unheld citation lands in unavailable[], not silently dropped',
     bad.unavailable.length === 1 && bad.elements.length === 0);
}

// ---------------------------------------------------------------- complete mode
{
  const partial = requirementsFor('45 C.F.R. § 164.404(c)', kb);
  const full = requirementsFor('45 C.F.R. § 164.404(c)', kb, { include_segmentation: true });
  ok('complete mode returns more rows than record-only mode',
     full.count > partial.count, `${partial.count} -> ${full.count}`);
  ok('complete mode accounts for every element the source has',
     full.count === partial.denominator.expected,
     `${full.count} vs ${partial.denominator.expected} in the segmentation`);
  ok('every row declares its provenance',
     full.elements.every(e => e.provenance === 'record' || e.provenance === 'segmentation'));
  ok('record rows keep their atom id', full.elements.filter(e => e.provenance === 'record')
       .every(e => !!e.atom_id));
  ok('segmentation rows carry NO atom id and say so',
     full.elements.filter(e => e.provenance === 'segmentation').every(e => e.atom_id === null));
  ok('every row carries the source hash either way', full.elements.every(e => !!e.sha256));
  // the citation must be built from the SECTION base, not the parent citation, or it renders
  // as § 164.404(c)(c)(1) — a citation to nothing
  ok('segmentation citations are well formed, not doubled',
     full.elements.every(e => !/\(c\)\(c\)/.test(e.citation ?? '')));
  ok('rows are ordered by paragraph path',
     full.elements.map(e => (e.path ?? []).join('>')).join('|') ===
     [...full.elements].sort((a, z) => (a.path ?? []).join('>').localeCompare((z.path ?? []).join('>'), 'en', { numeric: true }))
       .map(e => (e.path ?? []).join('>')).join('|'));
  ok('the mandatory content elements (c)(1)(A)-(E) are all present',
     ['A','B','C','D','E'].every(letter =>
       full.elements.some(e => (e.citation ?? '').endsWith(`(c)(1)(${letter})`))));
}

// ---------------------------------------------------------------- determinism
{
  const one = JSON.stringify(requirementsFor('45 C.F.R. § 164.520(b)(1)', kb));
  const two = JSON.stringify(requirementsFor('45 C.F.R. § 164.520(b)(1)', kb));
  ok('two runs are byte-identical', one === two);
}

// ---------------------------------------------------------------- a bare section as parent
{
  // "15 U.S.C. § 1681g" carries no parenthesised designator, and the synthetic-parent path used
  // to require at least one, so every section-level citation was refused even where the corpus
  // held its children. The caller was told nothing was addressable there — which is how a gap
  // register comes to report no gap over a section holding 1 element of 129.
  const r = requirementsFor('15 U.S.C. § 1681g', kb);
  ok('a bare section resolves as a parent', r.found === true);
  ok('...from its OWN segmentation, not a neighbouring section',
     r.denominator?.available === true && r.denominator.expected === 129,
     `expected 129, got ${r.denominator?.expected}`);
  ok('...and reports far more elements than the corpus holds',
     r.denominator.expected > r.count, `${r.count} held of ${r.denominator.expected}`);
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
