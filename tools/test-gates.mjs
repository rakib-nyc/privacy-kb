#!/usr/bin/env node
// Proves each CI gate actually fires. An untested gate is not a gate.
// Every fixture under tests/fixtures/cases/<name>/atoms/ is a single atom built
// to trip exactly the gates listed for it in tests/fixtures/expected.yaml.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');
const expected = yaml.load(readFileSync(resolve(ROOT, 'tests/fixtures/expected.yaml'), 'utf8'));

let pass = 0, fail = 0;
for (const [name, want] of Object.entries(expected)) {
  let out;
  try {
    out = execFileSync('node', ['tools/validate.mjs', '--corpus', `tests/fixtures/cases/${name}`, '--quiet'],
      { cwd: ROOT, encoding: 'utf8' });
  } catch (e) { out = e.stdout; }
  const got = [...new Set(JSON.parse(out).failures.map(f => f.gate))].sort((a, b) => a - b);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(26)} expected gates [${want}] got [${got}]`);
  ok ? pass++ : fail++;
}
// EVERY GATE IS EITHER EXERCISED OR DECLARED UNEXERCISABLE. 11 of 38 gates had no fixture while
// README.md claimed one per gate — a coverage gap that had to be measured to be seen. This makes
// the set closed: a new gate must come with a fixture or with a written reason it cannot have one.
{
  const declared = yaml.load(readFileSync(resolve(ROOT, 'tests/fixtures/no-fixture.yaml'), 'utf8'))?.no_fixture ?? {};
  const listed = (readFileSync(resolve(ROOT, 'tools/validate.mjs'), 'utf8')
    .match(/ALL_GATES = \[([^\]]*)\]/)?.[1] ?? '').split(',').map(x => Number(x.trim())).filter(Number.isFinite);
  const covered = new Set(Object.values(expected).flat().map(Number));
  const orphan = listed.filter(g => !covered.has(g) && !(g in declared));
  const stale  = Object.keys(declared).map(Number).filter(g => covered.has(g));
  console.log(`\ngate fixture coverage: ${listed.filter(g => covered.has(g)).length}/${listed.length} exercised, ` +
              `${Object.keys(declared).length} declared unexercisable`);
  if (orphan.length) { console.log(`FAIL  gates with neither a fixture nor a declared reason: ${orphan.join(', ')}`); fail++; }
  if (stale.length)  { console.log(`FAIL  gates declared unexercisable but now covered: ${stale.join(', ')}`); fail++; }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
