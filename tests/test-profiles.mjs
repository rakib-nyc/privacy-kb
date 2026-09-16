#!/usr/bin/env node
// privacy_profile: a standing fact set and what moved since the last check.
//
// The property that matters is the SEPARATION of causes. "Something changed" is useless: a moved
// corpus, an edited fact set and a moved answer are three different problems with three different
// responses, and collapsing them is how a change register becomes noise nobody reads.
import { saveProfile, readProfile, listProfiles, checkProfile, profileDir } from '../engine/profiles.mjs';
import { load } from '../engine/corpus.mjs';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fail++; };

// Never touch a real profile directory.
const sandbox = mkdtempSync(join(tmpdir(), 'pkb-profiles-'));
process.env.PRIVACY_KB_PROFILES = sandbox;
const kb = load();
const FACTS = { entity: { is_hipaa_covered_entity: true, owns_or_licenses_computerized_data: true },
                data: { is_phi: true, includes_ny_private_information: true },
                state_layers: ['US-NY'] };

// ---------------------------------------------------------------- totality
for (const [label, fn] of [
  ['read of a missing profile', () => readProfile('nope')],
  ['read of null', () => readProfile(null)],
  ['check of a missing profile', () => checkProfile('nope', '2026-09-15', kb)],
  ['check with no date', () => checkProfile('nope', null, kb)],
  ['list on an empty dir', () => listProfiles()],
]) {
  let threw = false, out = null;
  try { out = fn(); } catch { threw = true; }
  ok(`total on ${label}`, !threw && out !== undefined, threw ? 'THREW' : '');
}
ok('a missing profile is refused, not invented', readProfile('nope').found === false);
ok('a check without a date is refused', checkProfile('x', null, kb).ok === false);

// ---------------------------------------------------------------- save and read back
{
  saveProfile('acme', FACTS, { description: 'test entity' });
  const back = readProfile('acme');
  ok('saves and reads back', back.found === true && back.name === 'acme');
  ok('keeps the description', back.description === 'test entity');
  ok('keeps every namespace', ['entity','data','event','practice','purpose','law']
     .every(ns => back.facts[ns] !== undefined));
  ok('keeps state layers', back.state_layers.includes('US-NY'));
  // A stored ANSWER beside stored facts invites reading it without re-running it.
  ok('stores NO answer beside the facts',
     back.obligations === undefined && back.applicable === undefined);
  ok('appears in the listing', listProfiles().some(row => row.name === 'acme'));
  ok('the sandbox is honoured, not a repo path', profileDir() === sandbox);
}

// ---------------------------------------------------------------- first check says so
{
  const first = checkProfile('acme', '2019-06-01', kb);
  ok('first check is flagged as a baseline', first.ok && first.first_check === true);
  ok('...and does NOT report "no changes"', /FIRST CHECK/.test(first.note) && first.moved === null);
  ok('...and records a receipt', !!first.now.receipt_id && !!first.now.corpus_digest);
}

// ---------------------------------------------------------------- the separation of causes
{
  const moved = checkProfile('acme', '2026-09-15', kb);
  ok('second check compares against the stored receipt', moved.first_check === false);
  ok('a moved DATE is reported as a moved date', moved.moved.date === true);
  ok('...and not as edited facts', moved.moved.facts === false);
  ok('...and the corpus is correctly reported unchanged', moved.moved.corpus === false);
  ok('the answer moved, and is reported as moved', moved.moved.result === true);
  ok('a legal-change delta IS computed when only the date moved', !!moved.delta);
  ok('...and names what differs', 
     moved.delta.commenced.length + moved.delta.indeterminate.length > 0,
     `${moved.delta.commenced.length} commenced, ${moved.delta.indeterminate.length} indeterminate`);
  // § 899-bb's effective_from carries basis "undetermined", so the corpus cannot attribute the
  // difference to a commencement even though 21 March 2020 is very likely the right date. It
  // belongs in indeterminate; asserting it in `gained` is what kept the old behaviour in place.
  ok('...with SHIELD safeguards reported as unattributable rather than as newly commenced',
     moved.delta.indeterminate.some(row => /899-bb/.test(row.citation ?? '')));

  // re-check at the same date: nothing should move at all
  const quiet = checkProfile('acme', '2026-09-15', kb);
  ok('re-checking at the same date moves nothing',
     quiet.moved.corpus === false && quiet.moved.facts === false &&
     quiet.moved.date === false && quiet.moved.result === false);

  // edit the facts, hold the date: the delta must be SUPPRESSED
  saveProfile('acme', { ...FACTS, entity: { ...FACTS.entity, is_ny_employer: true } }, {});
  const edited = checkProfile('acme', '2026-09-15', kb);
  ok('editing the facts is reported as edited facts', edited.moved.facts === true);
  ok('...and the legal-change delta is SUPPRESSED, not attributed to the law',
     edited.delta === null);
}

// ---------------------------------------------------------------- record: false leaves no trace
{
  saveProfile('readonly', FACTS, {});
  checkProfile('readonly', '2026-09-15', kb, { record: false });
  ok('check with record:false does not write a baseline',
     readProfile('readonly').last_check === null);
}

// ---------------------------------------------------------------- determinism
{
  saveProfile('det', FACTS, {});
  checkProfile('det', '2026-09-15', kb);
  const one = checkProfile('det', '2026-09-15', kb, { record: false });
  const two = checkProfile('det', '2026-09-15', kb, { record: false });
  ok('two checks produce the same receipt', one.now.receipt_id === two.now.receipt_id);
}

rmSync(sandbox, { recursive: true, force: true });
// ---------------------------------------------------------------- the register
// A compliance register IS the history. Only last_check was kept, so the second check overwrote
// the first and "when did this move, and what moved with it" could not be asked at all.
{
  saveProfile('reg', { entity: { uses_automated_employment_decision_tool: true, nexus: 'US-NY-NYC' },
                       data: {}, state_layers: ['US-NY'] }, { description: 'register test' });
  const dates = ['2022-06-01', '2023-06-01', '2026-09-15'];
  const runs = dates.map(d => checkProfile('reg', d, kb));

  ok('every check appends to the register', runs[2].history.length === 3,
     `${runs[2].history.length}`);
  ok('...and the register survives a re-read', (readProfile('reg').history ?? []).length === 3);
  ok('the baseline entry records no movement', runs[2].history[0].moved === null);
  ok('...and every later entry records WHY the answer moved',
     runs[2].history.slice(1).every(row => row.moved && typeof row.moved.date === 'boolean'));
  ok('the register shows the trajectory, not just the last row',
     runs[2].history.map(row => row.as_of).join(',') === dates.join(','));

  // LL144's bias-audit duties commenced 2023-01-01 with basis stated_in_text, so this window has a
  // real commencement and the test is not merely asserting that something was bucketed.
  ok('a window containing a dated commencement reports it as commenced',
     runs[1].delta && runs[1].delta.commenced.some(row => /20-871/.test(row.citation ?? '')),
     runs[1].delta ? `${runs[1].delta.commenced.length} commenced` : 'no delta');

  // Editing the facts must not destroy the register: it is the evidence explaining why the next
  // answer differs.
  saveProfile('reg', { entity: { uses_automated_employment_decision_tool: true, nexus: 'US-NY-NYC',
                                 is_hipaa_covered_entity: true }, data: { is_phi: true },
                       state_layers: ['US-NY'] }, {});
  ok('editing the facts preserves the register', (readProfile('reg').history ?? []).length === 3);
  const edited = checkProfile('reg', '2026-09-15', kb);
  ok('...and the check after an edit is attributed to the edit, not to the law',
     edited.moved.facts === true && edited.delta === null);
  ok('...and still appends', edited.history.length === 4);
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
