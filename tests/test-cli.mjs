#!/usr/bin/env node
// THE CLI IS THE INSTALL PATH, SO IT NEEDS TESTS. `privacy-kb cite` shipped passing a
// record_id/id argument to a tool whose parameter is atom_id: it printed
// 'no record with id "undefined"' and STILL EXITED 0, so a smoke test that only checked exit
// codes reported it green. Assert on the OUTPUT, not the status.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CLI = resolve(ROOT, 'bin/privacy-kb.mjs');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  cond ? pass++ : fail++;
};
const run = (...args) => {
  try { return execFileSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8' }); }
  catch (e) { return (e.stdout ?? '') + (e.stderr ?? ''); }
};
const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '');

{ const o = plain(run('doctor'));
  ok('doctor reports every check', (o.match(/[✓✗]/g) ?? []).length >= 5, o.slice(0, 60));
  ok('doctor passes on a good install', !o.includes('✗')); }

{ const o = plain(run('cite', 'ny.gbl.899_aa.9.hipaa_ag_notice'));
  ok('cite returns the citation', o.includes('N.Y. Gen. Bus. Law § 899-aa(9)'));
  ok('cite returns the verbatim text', o.includes('five business days'));
  ok('cite returns a source URL to check against', /source:\s+https?:\/\//.test(o), o.match(/source:.*/)?.[0] ?? '');
  ok('cite returns the fetch date and hash', /fetched:\s+\d{4}-\d{2}-\d{2}/.test(o) && /sha256:\s+[0-9a-f]{8}/.test(o));
  ok('cite does NOT report an undefined record', !o.includes('undefined')); }

{ const o = plain(run('cite', 'no.such.record'));
  ok('cite on a bad id says so plainly', o.includes('no record with id'), o.trim().slice(0, 70)); }

{ const o = plain(run('ask', '--hipaa', '--ny-data', '--breach', '--told-hhs'));
  ok('ask returns obligations', /Obligations in force as of \d{4}-\d{2}-\d{2}/.test(o));
  ok('ask surfaces the § 899-aa(9) duty', o.includes('899-aa(9)'));
  ok('ask always shows the backstops', o.includes('These never switch off'));
  ok('ask carries the disclaimer', o.includes('Not legal advice')); }

{ const o = plain(run('deadlines', '--hipaa', '--ny-data', '--told-hhs', '--from', '2026-09-08'));
  ok('deadlines computes the five-business-day clock', o.includes('2026-09-15'), o.slice(0, 80));
  ok('deadlines are sorted earliest first', (() => {
    const d = [...o.matchAll(/(\d{4}-\d{2}-\d{2})\s+\d+\s+(?:business|calendar)/g)].map(m => m[1]);
    return d.length > 1 && d.every((x, i) => i === 0 || d[i - 1] <= x);
  })());
  ok('deadlines declare the holiday approximation', o.includes('holidays NOT excluded')); }

{ const o = plain(run('setup'));
  ok('setup prints a config path', /claude_desktop_config\.json/.test(o));
  ok('setup prints valid JSON with an absolute server path', /"args":\s*\[\s*"\/.*mcp\/server\.mjs"/s.test(o)); }

{ const o = plain(run());
  ok('bare invocation prints usage rather than crashing', o.includes('privacy-kb')); }

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
