#!/usr/bin/env node
// privacy_exposure: the counterfactual sweep.
//
// The properties worth pinning are not "does it return rows". They are: that it is TOTAL on
// hostile input like every other outermost entry point; that its baseline is the same answer
// analyze() gives, so the diff is against the real result and not a second opinion; that a row
// never asks for a fact the caller already supplied; and that two runs are identical, which is
// the whole reason this feature can exist at all.
import { exposure } from '../engine/exposure.mjs';
import { analyze } from '../engine/applicability.mjs';
import { load } from '../engine/corpus.mjs';

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fail++; };

const corpus = load();
const AS_OF = '2026-09-15';
const CE = { is_hipaa_covered_entity: true, owns_or_licenses_computerized_data: true };
const PHI = { is_phi: true, includes_ny_private_information: true };
const CTX = { as_of: AS_OF, state_layers: ['US-NY'] };

// ---------------------------------------------------------------- totality
for (const [label, args] of [
  ['null everything', [null, null, null, null]],
  ['null corpus', [CE, PHI, CTX, null]],
  ['array as facts', [[], [], CTX, corpus]],
  ['string as context', [CE, PHI, 'nope', corpus]],
  ['number as facts', [7, 7, CTX, corpus]],
]) {
  let threw = false, shape = null;
  try { shape = exposure(...args); } catch { threw = true; }
  ok(`total on ${label}`, !threw && !!shape && Array.isArray(shape.controllable),
     threw ? 'THREW' : '');
}

// ---------------------------------------------------------------- baseline agreement
{
  const r = exposure(CE, PHI, CTX, corpus);
  const direct = analyze(CE, PHI, CTX);
  ok('baseline equals analyze().applicable, not a second opinion',
     r.baseline_count === direct.applicable.length, `${r.baseline_count} vs ${direct.applicable.length}`);
  ok('a missing as_of yields an error shape rather than rows',
     exposure(CE, PHI, { state_layers: ['US-NY'] }, corpus).controllable.length === 0);
}

// ---------------------------------------------------------------- determinism
{
  const one = JSON.stringify(exposure(CE, PHI, CTX, corpus));
  const two = JSON.stringify(exposure(CE, PHI, CTX, corpus));
  ok('two runs are byte-identical', one === two);
}

// ---------------------------------------------------------------- it finds real decisions
{
  const r = exposure(CE, PHI, CTX, corpus);
  const glba = r.controllable.find(row => row.fact === 'entity.glba_financial_institution');
  ok('finds the GLBA financial-institution decision', !!glba && glba.adds.length > 0,
     glba ? `+${glba.adds.length}` : 'ABSENT');

  const breach = r.contingent.find(row => row.fact === 'event.type' &&
                                          row.value === 'breach_of_security_of_the_system');
  ok('finds the NY breach characterisation as a contingent event',
     !!breach && breach.adds.some(hit => /899-aa/.test(hit.citation ?? '')));

  ok('reports the 5,000-NY-resident threshold',
     r.thresholds.some(row => row.fact === 'event.ny_residents_notified' && row.bound === 5000));

  ok('reversals name a duty owed only because of a current fact',
     r.reversals.some(row => row.fact === 'entity.is_hipaa_covered_entity' && row.stops.length > 0));
}

// ---------------------------------------------------------------- multi-fact combinations
{
  const r = exposure(CE, PHI, CTX, corpus);
  const monitoring = r.combinations.filter(row => /52-c/.test(row.citation ?? ''));
  ok('finds § 52-c, which no single fact-flip can reach', monitoring.length > 0);
  ok('...and names BOTH facts it needs', monitoring.every(row =>
       row.needs.some(n => /is_ny_employer/.test(n)) &&
       row.needs.some(n => /monitors_employee_communications/.test(n))));

  // REGRESSION. evalPredicate returns { value, why }, and comparing that object to `true` is
  // always false — so the first version marked every conjunct unmet and told a HIPAA covered
  // entity that it needed to become one. Nothing in the gate suite could see it; only reading
  // the output could.
  ok('never asks for a fact the caller already supplied',
     r.combinations.every(row => !row.needs.some(n => /entity\.is_hipaa_covered_entity == true/.test(n))));
  ok('every combination needs at least two changes',
     r.combinations.every(row => row.needs.length >= 2));
  ok('no combination duplicates a single-flip row',
     r.combinations.every(row => !r.controllable.some(single =>
       row.needs.length === 1 && row.needs[0].startsWith(single.fact))));
}

// ---------------------------------------------------------------- supplying a fact moves it
{
  const before = exposure(CE, PHI, CTX, corpus);
  const after = exposure({ ...CE, glba_financial_institution: true }, PHI, CTX, corpus);
  ok('asserting a decision raises the baseline by what the row promised',
     after.baseline_count >
       before.baseline_count, `${before.baseline_count} -> ${after.baseline_count}`);
  ok('...and the row it promised is gone from the controllable list',
     !after.controllable.some(row => row.fact === 'entity.glba_financial_institution'));
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
