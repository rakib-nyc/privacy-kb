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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
