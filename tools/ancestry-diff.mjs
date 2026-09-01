#!/usr/bin/env node
// Diff a record against the record it descends from, and flag differences that
// are too small to be real legal change.
//
//   node tools/ancestry-diff.mjs [--check]
//
// This is the detector that actually caught the baseline-offset bug, promoted
// from instinct to tooling. When one instrument adapts another, the drafters
// either changed the meaning or they did not. A "difference" that is only a
// comma, only whitespace, or only the style of an enumeration label is almost
// never a drafting decision — it is the extraction pipeline lying about one of
// the two texts. Real legal change adds, removes or qualifies obligations.
//
// --check exits non-zero if a flagged difference is not acknowledged, either in
// the record's source_defects (it is a defect in the source) or in differs_from
// (it is a known, deliberate, documented variation).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');
const CHECK = process.argv.includes('--check');
const norm = s => s.replace(/\s+/g, ' ').trim();

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.yaml') && p.includes('/atoms/')) out.push(p);
  }
  return out;
}

// Enumeration labels: a) (a) 1. i. (iv) A. — the tokens that carry no meaning of
// their own and whose POSITION is what the extractor gets wrong.
const LABEL = /^\(?([a-zA-Z]|[ivxlcIVXLC]+|\d+)[).:]?$/;
const isLabelish = s => norm(s).split(/\s+/).filter(Boolean).every(w => LABEL.test(w));
const PUNCT = /^[\s.,;:()\[\]"'’‘“”\-–—]*$/;

// Minimal diff over words.
function opcodes(a, b) {
  const A = a.split(' '), B = b.split(' ');
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  const push = (tag, ai, aj, bi, bj) => {
    if (ops.length && ops.at(-1).tag === tag) { ops.at(-1).a[1] = aj; ops.at(-1).b[1] = bj; }
    else ops.push({ tag, a: [ai, aj], b: [bi, bj] });
  };
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('equal', i, i + 1, j, j + 1); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('delete', i, i + 1, j, j); i++; }
    else { push('insert', i, i, j, j + 1); j++; }
  }
  if (i < n) push('delete', i, n, j, j);
  if (j < m) push('insert', i, i, j, m);
  const raw = ops.filter(o => o.tag !== 'equal').map(o => ({
    tag: o.tag, from: A.slice(...o.a).join(' '), to: B.slice(...o.b).join(' '),
    ai: o.a[0], bi: o.b[0],
  }));
  // Merge an adjacent delete+insert into a replace. Without this, "information"
  // -> "information," arrives as two ops and reads as substantive on both sides,
  // when it is a single added comma — exactly the class this tool exists to catch.
  const out = [];
  for (const d of raw) {
    const prev = out.at(-1);
    if (prev && ((prev.tag === 'delete' && d.tag === 'insert') || (prev.tag === 'insert' && d.tag === 'delete'))
        && Math.abs((d.ai ?? 0) - (prev.ai ?? 0)) <= 1) {
      out[out.length - 1] = { tag: 'replace',
        from: (prev.from + ' ' + d.from).trim(), to: (prev.to + ' ' + d.to).trim() };
    } else out.push(d);
  }
  return out;
}

function classify(d) {
  const f = d.from, t = d.to;
  if (norm(f) === norm(t)) return 'whitespace_only';
  if (PUNCT.test(f) && PUNCT.test(t)) return 'punctuation_only';
  // A change confined to, or occurring inside, an enumeration label. The brief
  // calls this one out by name: legal amendment does not usually consist of
  // editing the inside of "(a)".
  const hasLabel = s => norm(s).split(/\s+/).some(w => LABEL.test(w) || /^\d*\(?[a-zA-Z0-9]{1,4}\)$/.test(w));
  if (f && t && hasLabel(f) && hasLabel(t)) return 'inside_subparagraph_label';
  if ((f && isLabelish(f)) || (t && isLabelish(t))) return 'label_only';
  // strip labels from both sides; if what remains is identical, only labels moved
  const strip = s => norm(s).split(/\s+/).filter(w => !LABEL.test(w)).join(' ');
  if (strip(f) === strip(t) && strip(f) !== '') return 'label_position_only';
  if (f.replace(/[^\w]/g, '') === t.replace(/[^\w]/g, '')) return 'punctuation_only';
  return 'substantive';
}
const IMPLAUSIBLE = new Set(['whitespace_only', 'punctuation_only', 'label_only', 'label_position_only', 'inside_subparagraph_label']);

const recs = new Map();
for (const f of walk(resolve(ROOT, 'corpus'))) {
  const r = yaml.load(readFileSync(f, 'utf8'));
  if (r?.id) recs.set(r.id, r);
}

let flagged = 0, unack = 0, pairs = 0, identical = 0, substantive = 0;
for (const r of recs.values()) {
  if (!r.derived_from) continue;
  // Textual descent only. A scheme IMPLEMENTS a framework — it operationalises it
  // rather than restating its words — so diffing the two texts would report the
  // whole document as a difference and drown the signal this tool exists for.
  if (r.derived_from.relationship === 'implementation') continue;
  pairs++;
  const anc = recs.get(r.derived_from.record_id);
  if (!anc) { console.log(`MISSING ANCESTOR  ${r.id} -> ${r.derived_from.record_id}`); unack++; continue; }
  const a = norm(anc.verbatim_span), b = norm(r.verbatim_span);
  if (a === b) { identical++; continue; }
  const diffs = opcodes(a, b).map(d => ({ ...d, kind: classify(d) }));
  const bad = diffs.filter(d => IMPLAUSIBLE.has(d.kind));
  const known = (r.source_defects?.length ?? 0) > 0
    || (r.differs_from ?? []).some(x => x.id === anc.id);
  console.log(`\n${r.id}\n  ${r.derived_from.relationship} of ${anc.id}`);
  for (const d of diffs) {
    const mark = IMPLAUSIBLE.has(d.kind) ? 'FLAG' : '    ';
    console.log(`  ${mark} ${d.kind.padEnd(20)} ${d.tag}: ${JSON.stringify(d.from).slice(0, 46)} -> ${JSON.stringify(d.to).slice(0, 46)}`);
    if (IMPLAUSIBLE.has(d.kind)) flagged++; else substantive++;
  }
  if (bad.length && !known) {
    console.log(`  UNACKNOWLEDGED — a difference this small is more likely an extraction artefact than a drafting decision.`);
    unack++;
  }
}
console.log(`\npairs ${pairs} · identical ${identical} · substantive diffs ${substantive} · flagged ${flagged} · unacknowledged ${unack}`);
if (CHECK && unack) process.exit(1);
