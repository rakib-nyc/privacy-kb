#!/usr/bin/env node
// THE FACT VOCABULARY THE ENGINE ACTUALLY SPEAKS.
//
// Red-teaming 0.1 found that 64 of 69 distinct fact keys appearing in EXEMPTION predicates appear
// in no atom predicate and no eval scenario. The machinery worked — a matched carve-out really
// does surface as partial_carve_out — but a caller had no way to learn those keys existed. They
// were in no example, no test and no document, so in practice the carve-out never fired.
//
// Gate 21 checks a predicate is evaluable, 28 that its namespace is filled, 29 that it is
// satisfiable. None of them asks the question a user asks: WHAT MAY I PASS IN?
//
//   node tools/fact-keys.mjs [--check]
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);
const CHECK = process.argv.includes('--check');
const OUT = R('meta/fact-keys.yaml');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.yaml')) out.push(p);
  }
  return out;
}
const NS = /\b((?:entity|data|event|purpose|practice|law)\.[a-z0-9_]+)/g;
const collect = (node, sink) => {
  if (typeof node === 'string') { for (const m of node.matchAll(NS)) sink(m[1]); return; }
  if (Array.isArray(node)) return node.forEach(n => collect(n, sink));
  if (node && typeof node === 'object') return Object.values(node).forEach(n => collect(n, sink));
};

const keys = new Map();
const note = (k, where) => {
  if (!keys.has(k)) keys.set(k, { used_by_obligation: 0, used_by_exemption: 0, used_by_eval: 0 });
  keys.get(k)[where]++;
};
for (const f of walk(R('corpus'))) {
  if (!f.includes('/atoms/')) continue;
  let a; try { a = yaml.load(readFileSync(f, 'utf8')); } catch { continue; }
  if (!a || typeof a !== 'object') continue;
  collect(a.applies_if, k => note(k, 'used_by_obligation'));
  for (const ex of a.exemptions ?? []) collect(ex.applies_if, k => note(k, 'used_by_exemption'));
}
for (const f of walk(R('evals/scenarios'))) {
  let s; try { s = yaml.load(readFileSync(f, 'utf8')); } catch { continue; }
  collect(s, k => note(k, 'used_by_eval'));
}

const byNs = {};
for (const [k, v] of [...keys].sort()) {
  const [ns, name] = [k.split('.')[0], k.slice(k.indexOf('.') + 1)];
  (byNs[ns] ??= {})[name] = {
    ...v,
    discoverable: v.used_by_obligation > 0 || v.used_by_eval > 0,
  };
}
const doc = {
  version: 1,
  generated_by: 'node tools/fact-keys.mjs',
  what_this_is:
    'Every fact key any record or scenario predicates on, by namespace. This is the input ' +
    'vocabulary of engine/applicability.mjs — what a caller may put in entity/data/event/' +
    'purpose/practice/law. A key with discoverable:false appears ONLY inside an exemption ' +
    'predicate, which means nothing else in the repository demonstrates it and a caller would ' +
    'have to read the corpus to find it. That is the condition this file exists to make visible.',
  totals: {
    keys: keys.size,
    exemption_only: [...keys.values()].filter(v => !v.used_by_obligation && !v.used_by_eval).length,
  },
  namespaces: byNs,
};
const next = yaml.dump(doc, { lineWidth: 100, sortKeys: false, noRefs: true });
if (CHECK) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== next) { console.error('meta/fact-keys.yaml is STALE — run: node tools/fact-keys.mjs'); process.exit(1); }
  console.log(`fact-keys.yaml is current  (${keys.size} keys, ${doc.totals.exemption_only} exemption-only)`);
} else {
  writeFileSync(OUT, next);
  console.log(`meta/fact-keys.yaml written  (${keys.size} keys, ${doc.totals.exemption_only} exemption-only)`);
}
