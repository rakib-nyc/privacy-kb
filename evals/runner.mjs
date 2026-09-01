#!/usr/bin/env node
// Eval runner. Executes every scenario in evals/scenarios/*.yaml and writes
// evals/last-run.json for CI gate 8.
//
//   node evals/runner.mjs [--baseline]
//
// Two kinds of criterion, and the second is the one that matters.
//
// CORPUS criteria assert facts about records directly: a record exists, a field
// holds a value, a field contains a string. That is the floor, and it is enough
// to make "who enforces this, and what is the exposure" answerable.
//
// ENGINE criteria run engine/applicability.mjs over stated facts and assert on
// what comes back. These exist because of DEBT-009: for weeks the corpus said
// exemptions were typed, the engine implemented typed exemptions, the tests
// passed, and no exemption could fire, because nothing ever asserted that a
// record and the code agreed. A suite that only reads records reproduces that
// blind spot one layer up. An engine criterion names the atom, says where it
// must land -- applicable, exempt, not_applicable, absent -- and digs into the
// entry the engine actually returned.
//
// --baseline writes evals/baseline.json from this run.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as yaml from 'js-yaml';
import { analyze } from '../engine/applicability.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.yaml') && p.includes('/atoms/')) out.push(p);
  }
  return out;
}
const corpus = new Map();
for (const f of walk(R('corpus'))) {
  const r = yaml.load(readFileSync(f, 'utf8'));
  if (r?.id) corpus.set(r.id, r);
}

const dig = (o, path) => path.split('.').reduce((v, k) =>
  v == null ? v : (Array.isArray(v) && /^\d+$/.test(k) ? v[+k] : v[k]), o);

// 'deadlines' is a bucket too. The § 899-aa(9) trigger ordering — a state clock started BY
// federal compliance, falling due before the federal one — is the corpus's flagship result,
// and a scenario that could not assert on computed dates could not pin it.
const BUCKETS = ['applicable', 'exempt', 'not_applicable', 'pending_watch', 'deadlines'];

function check(c) {
  if (c.record_exists) return { ok: corpus.has(c.record_exists), got: corpus.has(c.record_exists) };
  let v;
  if (c.engine) {
    const r = analyze(c.engine.entity ?? {}, c.engine.data ?? {}, c.engine.context ?? {});
    if (r.error) return { ok: false, got: `engine refused: ${r.error}` };
    // An atom can legitimately be in two buckets at once — applicable AND deadlines. So when a
    // criterion names a bucket, look in THAT bucket, rather than reporting the first match in
    // scan order and calling a correct result a failure.
    const inBucket = b => (r[b] ?? []).some(x => x.atom_id === c.atom);
    if (c.in === 'absent') {
      const anywhere = BUCKETS.find(inBucket);
      return { ok: !anywhere, got: anywhere ?? 'absent' };
    }
    const where = c.in ? (inBucket(c.in) ? c.in : null) : BUCKETS.find(inBucket);
    if (c.in && where !== c.in)
      return { ok: false, got: `atom is not in "${c.in}" (found in: ${BUCKETS.filter(inBucket).join(', ') || 'nowhere'})` };
    const entry = (r[where] ?? []).find(x => x.atom_id === c.atom);
    if (!c.path) return { ok: true, got: where };
    v = dig(entry, c.path);
  } else {
    const rec = corpus.get(c.record);
    if (!rec) return { ok: false, got: `record "${c.record}" not in corpus` };
    v = dig(rec, c.path);
  }
  if ('equals' in c) return { ok: JSON.stringify(v) === JSON.stringify(c.equals), got: v };
  if ('contains' in c) {
    const hay = Array.isArray(v) ? v.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') : String(v);
    return { ok: hay.includes(c.contains), got: (hay ?? '').slice(0, 120) };
  }
  if ('one_of' in c) return { ok: c.one_of.includes(v), got: v };
  if ('non_empty' in c) return { ok: Array.isArray(v) ? v.length > 0 : !!v, got: v };
  return { ok: false, got: 'unrecognised criterion' };
}

const files = existsSync(R('evals/scenarios'))
  ? readdirSync(R('evals/scenarios')).filter(f => f.endsWith('.yaml')).sort() : [];
const results = [];
for (const f of files) {
  const s = yaml.load(readFileSync(R(`evals/scenarios/${f}`), 'utf8'));
  const crits = (s.rubric ?? []).map(c => ({ ...c, ...check(c) }));
  const passed = crits.filter(c => c.ok).length;
  results.push({ id: s.id, file: f, question: s.question, trap: s.trap ?? null,
    criteria: crits.length, passed, all_pass: crits.length > 0 && passed === crits.length,
    failures: crits.filter(c => !c.ok).map(c => ({ criterion: c.name ?? JSON.stringify(c).slice(0, 80), got: c.got })) });
}
const total = results.length;
const allPass = results.filter(r => r.all_pass).length;
const rate = total ? allPass / total : 1;
const out = { ran: new Date().toISOString().slice(0, 10), scenarios: total,
  all_pass: allPass, all_pass_rate: rate,
  criteria_total: results.reduce((n, r) => n + r.criteria, 0),
  results };
writeFileSync(R('evals/last-run.json'), JSON.stringify(out, null, 2) + '\n');
if (process.argv.includes('--baseline'))
  writeFileSync(R('evals/baseline.json'), JSON.stringify({ all_pass_rate: rate, scenarios: total }, null, 2) + '\n');

console.log(`scenarios ${total} · all-pass ${allPass} · rate ${(rate * 100).toFixed(0)}%`);
for (const r of results.filter(x => !x.all_pass))
  for (const f of r.failures) console.log(`  FAIL ${r.id}: ${f.criterion}\n       got: ${JSON.stringify(f.got).slice(0, 140)}`);
process.exit(results.some(r => !r.all_pass) ? 1 : 0);
