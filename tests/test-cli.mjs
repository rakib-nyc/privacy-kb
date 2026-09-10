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
/** Exit STATUS, which `run` deliberately swallows. The bug this whole file was written about was
 *  a command that printed a failure and exited 0, so the status needs asserting on its own. */
const status = (...args) => {
  try { execFileSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }); return 0; }
  catch (e) { return e.status ?? 1; }
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
  ok('deadlines declare the holiday approximation', o.includes('holidays NOT excluded'));
  ok('--from dates the one event the flags assert', o.includes('notification_to_hhs_secretary = 2026-09-08')); }

// TWO EVENTS, TWO DATES. Sorting can only be tested where more than one clock actually runs,
// and under the trigger vocabulary that requires asserting both moments — which is the point:
// the § 899-aa(2) discovery clock and the § 899-aa(9) HHS-notification clock are different
// clocks from different days, and the old CLI ran them both from one date.
{ const o = plain(run('deadlines', '--hipaa', '--ny-data', '--breach', '--told-hhs',
    '--event', 'breach_discovery=2026-08-01', '--event', 'notification_to_hhs_secretary=2026-09-08'));
  const d = [...o.matchAll(/(\d{4}-\d{2}-\d{2})\s+\d+\s+(?:business|calendar)/g)].map(m => m[1]);
  ok('two asserted events start two clocks', d.length === 2, `(${d.join(', ')})`);
  ok('deadlines are sorted earliest first', d.every((x, i) => i === 0 || d[i - 1] <= x));
  ok('a family-dated clock says so', o.includes('dated via the "breach_discovery" family key')); }

// THE REGRESSION THIS WHOLE CHANGE EXISTS TO PREVENT. `--from` with no event flag used to
// print a dated § 899-aa(2) breach clock for a user who never said a breach occurred.
{ const o = plain(run('deadlines', '--hipaa', '--ny-data', '--from', '2025-02-01'));
  ok('an undated trigger invents NO deadline', !/\d{4}-\d{2}-\d{2}\s+\d+\s+(?:business|calendar)/.test(o));
  ok('...and no breach clock appears without --breach', !o.includes('899-aa(2)'));
  ok('...and says no event dates were asserted', o.includes('no event dates asserted'));
  ok('unstarted clocks are REPORTED, not dropped', o.includes('Not started'));
  ok('...and each names the key that would start it',
     o.includes('--event receipt_of_access_request=<date>')); }

// ONE DATE CANNOT BE TWO MOMENTS.
{ const o = plain(run('deadlines', '--breach', '--told-hhs', '--from', '2026-08-01'));
  ok('--from refuses when two event flags make it ambiguous', o.includes('--from is ambiguous here'));
  ok('...and names both keys to use instead',
     o.includes('--event breach_discovery=<date>') && o.includes('--event notification_to_hhs_secretary=<date>'));
  ok('...and computes nothing while ambiguous', !/\d{4}-\d{2}-\d{2}\s+\d+\s+(?:business|calendar)/.test(o)); }

// THE VOCABULARY IS DISCOVERABLE. A caller that has to guess an event key is the original bug.
{ const o = plain(run('triggers'));
  ok('triggers lists the vocabulary', /\d+ trigger keys/.test(o));
  ok('triggers groups by family', o.includes('breach_discovery'));
  ok('triggers shows the key a record needs', o.includes('notification_to_hhs_secretary')); }


// THE CLI IS WHERE A TYPO ORIGINATES. `--from 2026-02-30` printed "asserted: breach_discovery =
// 2026-02-30" and then "no clock has started" — the engine correctly declined an impossible date
// and the CLI reported that decline as an answer, which reads as "this obligation does not apply".
{ const o = plain(run('deadlines', '--ny-data', '--breach', '--from', '2026-02-30'));
  ok('an impossible --from is refused, not absorbed', o.includes('That is not a date'));
  ok('...and names the offending flag and value', /--from\s+"2026-02-30"/.test(o));
  ok('...and computes nothing', !/\d{4}-\d{2}-\d{2}\s+\d+\s+(?:business|calendar)/.test(o)); }

{ const o = plain(run('deadlines', '--ny-data', '--breach', '--event', 'breach_discovery=nope'));
  ok('a malformed --event value is refused', o.includes('That is not a date')); }

{ const o = plain(run('ask', '--hipaa', '--as-of', '2026-13-01'));
  ok('ask refuses an impossible --as-of', /real calendar date|That is not a date/.test(o)); }

{ const o = plain(run('deadlines', '--ny-data', '--breach', '--from', '2024-02-29'));
  ok('a real leap day is accepted', o.includes('2024-02-29')); }


// A FAILURE MUST REACH THE EXIT CODE. `ask` printed the engine's refusal and exited 0 — the same
// hole the header of this file describes in `cite`, sitting one function away and never checked
// because every assertion here was about output. In --json mode it was worse: the error object
// was printed as though it were a result.
{
  ok('a valid ask exits 0', status('ask', '--hipaa') === 0);
  ok('a valid deadlines exits 0', status('deadlines', '--ny-data', '--breach', '--from', '2026-08-01') === 0);
  ok('ask with an impossible --as-of exits NONZERO', status('ask', '--as-of', '2026-13-01') === 1);
  ok('...and so does its --json form', status('ask', '--as-of', '2026-13-01', '--json') === 1);
  ok('ask with a missing --as-of value exits nonzero', status('ask', '--as-of') === 1);
  ok('cite with no record id exits nonzero', status('cite') === 1);
  ok('cite with an unknown id exits nonzero', status('cite', 'no.such.record') === 1);
  ok('an impossible --from exits nonzero', status('deadlines', '--ny-data', '--breach', '--from', '2026-02-30') === 1);
  ok('an ambiguous --from exits nonzero',
     status('deadlines', '--breach', '--told-hhs', '--from', '2026-08-01') === 1);
}

{ const o = plain(run('setup'));
  ok('setup prints a config path', /claude_desktop_config\.json/.test(o));
  ok('setup prints valid JSON with an absolute server path', /"args":\s*\[\s*"\/.*mcp\/server\.mjs"/s.test(o)); }

{ const o = plain(run());
  ok('bare invocation prints usage rather than crashing', o.includes('privacy-kb')); }

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
