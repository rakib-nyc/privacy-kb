#!/usr/bin/env node
// Recomputes meta/coverage.yaml's atom lists from what is actually in corpus/.
//
// Coverage is the project's completeness argument, so it must be derived, never
// asserted. Hand-maintaining it would let the claim drift from the corpus, which
// is the one failure this file exists to prevent.
//
//   node tools/update-coverage.mjs [--check]
//
// --check writes nothing and exits non-zero if the file is stale (for CI).

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');
const CHECK = process.argv.includes('--check');
const COV = resolve(ROOT, 'meta/coverage.yaml');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.yaml') && p.includes('/atoms/')) out.push(p);
  }
  return out;
}

const byCoord = new Map();
for (const f of walk(resolve(ROOT, 'corpus'))) {
  const a = yaml.load(readFileSync(f, 'utf8'));
  if (!a?.subject?.domain || !a.id) continue;
  if (!byCoord.has(a.subject.domain)) byCoord.set(a.subject.domain, []);
  byCoord.get(a.subject.domain).push(a.id);
}
for (const v of byCoord.values()) v.sort();

const original = readFileSync(COV, 'utf8');
const cov = yaml.load(original);
let touched = 0;

for (const d of cov.domains) {
  for (const c of d.competencies) {
    // Competency-level records: non-obligation records may sit here.
    const cids = byCoord.get(c.coordinate) ?? [];
    if (cids.length || 'atoms' in c) {
      c.atoms = cids;
      c.status = cids.length ? 'in_progress' : (c.status ?? 'not_started');
      touched++;
    }
    for (const pi of c.performance_indicators) {
      const ids = byCoord.get(pi.coordinate) ?? [];
      pi.atoms = ids;
      if (ids.length && pi.status === 'not_started') pi.status = 'in_progress';
      if (!ids.length && pi.status === 'in_progress') pi.status = 'not_started';
    }
  }
}

// Preserve the file's header comment block; yaml.dump would drop it.
const header = original.slice(0, original.indexOf('\nsource_taxonomy:') + 1);
const body = yaml.dump({ source_taxonomy: cov.source_taxonomy, domains: cov.domains }, { lineWidth: 200, quotingType: '"', noRefs: true });
const next = header + body;

const total = [...byCoord.values()].reduce((n, v) => n + v.length, 0);
const leaves = cov.domains.flatMap(d => d.competencies.flatMap(c => c.performance_indicators));
const covered = leaves.filter(l => l.atoms?.length).length;
console.log(`records mapped   ${total}`);
console.log(`coordinates used ${byCoord.size}  ${[...byCoord.keys()].sort().join(', ')}`);
console.log(`leaves covered   ${covered}/${leaves.length}`);

if (CHECK) {
  if (next !== original) { console.error('\nmeta/coverage.yaml is STALE — run: node tools/update-coverage.mjs'); process.exit(1); }
  console.log('coverage.yaml is current');
} else if (next !== original) {
  writeFileSync(COV, next);
  console.log('\nmeta/coverage.yaml updated');
} else {
  console.log('\nmeta/coverage.yaml already current');
}
