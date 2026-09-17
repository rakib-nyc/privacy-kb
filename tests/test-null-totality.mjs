#!/usr/bin/env node
// EVERY OUTERMOST ENTRY POINT MUST BE TOTAL ON `null`, NOT ONLY ON `undefined`.
//
// A parameter default fires for undefined and not for null, and null is what an unresolved lookup
// upstream actually hands you. This has been found and fixed in computeDeadline,
// preemption.resolve(), all four workflows, buildMemo, normaliseFacts and the incident helpers,
// and says to assume the next new layer has it. It did: coverage.mjs had five, applicability.mjs's
// analyze() had one, conform.mjs and search.mjs one each.
//
// Rediscovering it module by module is the part that does not scale, so this enumerates every
// exported function in engine/ and calls it with nulls. A function is free to throw a MEANINGFUL
// error — that is an answer. What it may not do is dereference null and report the failure as a
// TypeError from three layers down, where the caller cannot tell a bad input from a broken engine.
//
// The second pass matters as much as the first. Probing with all-null arguments passed
// asOfVintageGaps, because `if (!asOf) return []` fired before the corpus read behind it; the
// false negative was in the probe, not the code. So a plausible first argument is supplied too.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(import.meta.dirname, '../engine');
let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!cond) fail += 1;
};

// What counts as a failure: a null dereference, a WeakMap refusing a non-object key, or the module
// falling over on its own — a ReferenceError or a call on a non-function. Anything else is a real
// answer, and a function is entitled to reject its input loudly.
//
// THE REFERENCE ERROR CASE IS HERE BECAUSE THIS TEST MISSED IT ONCE. Guarding factInventory with
// `corpus ?? load()` in a module that never imported load turned a null dereference into a
// ReferenceError, and a check looking only for the first pattern reported the fix as green. A
// test that recognises one shape of crash certifies every other shape as working.
const isCrash = message => /Cannot read properties of (null|undefined)|weak map key/.test(message)
  || /is not defined/.test(message)
  || /is not a function/.test(message);

const modules = readdirSync(DIR)
  .filter(f => f.endsWith('.mjs') && !f.startsWith('test-'))
  .sort();

const offenders = [];
let probed = 0;

for (const file of modules) {
  const mod = await import(resolve(DIR, file));
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== 'function') continue;
    const arities = new Set([fn.length, 1, 2, 3].filter(n => n >= 0 && n <= 4));
    for (const n of arities) {
      probed += 1;
      try { fn(...Array(n).fill(null)); }
      catch (err) {
        if (isCrash(String(err?.message))) offenders.push(`${file}:${name}(${n} nulls) — ${err.message}`);
      }
    }
  }
}
ok(`every engine export survives all-null arguments (${probed} call(s) over ${modules.length} module(s))`,
   offenders.length === 0, offenders.slice(0, 8).join(' | '));

// Second pass: a null corpus BEHIND a plausible first argument.
const behind = [
  ['coverage.mjs', 'asOfVintageGaps', ['2026-09-16', 'US', null]],
  ['coverage.mjs', 'coverageFor', ['US', null]],
  ['coverage.mjs', 'instrumentCoverage', ['us.fcra.preemption', null]],
  ['coverage.mjs', 'suppliesDuty', ['US', 'breach_notification', null]],
  ['coverage.mjs', 'crossReferenceGaps', [[], 'US', null]],
  ['coverage.mjs', 'elementCoverageFor', ['15 U.S.C. § 1681g', null]],
  ['requirements.mjs', 'requirementsFor', ['45 C.F.R. § 164.520(b)(1)', null]],
  ['brief.mjs', 'brief', ['us.fcra.1681t.general_savings', null]],
  ['search.mjs', 'search', ['breach', null]],
  ['conform.mjs', 'conform', ['text', ['45 C.F.R. § 164.520(b)(1)'], null]],
  ['conform.mjs', 'conformMarkdown', [null, 'title']],
];
const masked = [];
for (const [file, name, args] of behind) {
  const mod = await import(resolve(DIR, file));
  if (typeof mod[name] !== 'function') { masked.push(`${file}:${name} is no longer exported`); continue; }
  try { mod[name](...args); }
  catch (err) { if (isCrash(String(err?.message))) masked.push(`${file}:${name} — ${err.message}`); }
}
ok(`a null corpus behind a real first argument is handled (${behind.length} case(s))`,
   masked.length === 0, masked.slice(0, 6).join(' | '));


// ---------------------------------------------------------------- the harness checks itself
// A TEST FILE THAT IS NOT IN THE CHAIN READS AS COVERAGE AND IS NOT. tests/test-grounding.mjs sat
// on disk, passing when run by hand, and `npm test` never invoked it — so the citation auditor was
// unguarded through a repository restructure. This enumerates the directory rather than trusting
// the script, the same way the corpus checks its generated files instead of trusting a typed count.
{
  const root = resolve(import.meta.dirname, '..');
  const chain = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts?.test ?? '';
  const invoked = new Set([...chain.matchAll(/tests\/(test-[a-z0-9-]+\.mjs)/g)].map(m => m[1]));
  const present = readdirSync(resolve(root, 'tests'))
    .filter(name => /^test-[a-z0-9-]+\.mjs$/.test(name));
  const orphaned = present.filter(name => !invoked.has(name));
  ok(`every test file in tests/ is invoked by npm test (${present.length} file(s))`,
     orphaned.length === 0, orphaned.join(', '));
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
