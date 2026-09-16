#!/usr/bin/env node
// privacy_translate: an engineering vocabulary into legal facts.
//
// One property matters more than all the others. A data category says what information IS; most
// legal facts turn on WHO HOLDS IT. If user.health_and_medical ever resolves to data.is_phi on
// its own, every downstream answer for a wellness app inherits the HIPAA Privacy Rule. These
// tests exist to make that regression loud.
import { translate, knownVocabularies } from '../engine/vocabulary.mjs';

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fail++; };

// ---------------------------------------------------------------- totality
for (const [label, args] of [['null terms', [null, undefined]], ['empty array', [[], {}]],
                             ['number', [7, {}]], ['object', [{}, {}]],
                             ['null options', [['user.financial'], null]]]) {
  let threw = false, out = null;
  try { out = translate(...args); } catch { threw = true; }
  ok(`total on ${label}`, !threw && !!out && Array.isArray(out.conditional), threw ? 'THREW' : '');
}
ok('an unknown vocabulary is refused',
   !!translate(['x'], { vocabulary: 'nope' }).error);
ok('fideslang is a known vocabulary', knownVocabularies().includes('fideslang'));

// ---------------------------------------------------------------- THE SAFETY PROPERTY
{
  const bare = translate(['user.health_and_medical'], { facts: {} });
  ok('health data alone asserts NOTHING', Object.keys(bare.assert).length === 0);
  ok('...and is returned as conditional', bare.conditional.length >= 2);
  ok('...naming the holder fact it needs',
     bare.conditional.some(row => row.missing.includes('entity.is_hipaa_covered_entity')));
  ok('...with the reason recorded',
     bare.conditional.every(row => (row.why ?? '').length > 20));

  const held = translate(['user.health_and_medical'],
    { facts: { entity: { is_hipaa_covered_entity: true } } });
  ok('with the holder fact, is_phi IS asserted', held.assert?.data?.is_phi === true);
  ok('...but the NY element still is not, lacking residency',
     held.assert?.data?.includes_ny_private_information === undefined);

  const both = translate(['user.health_and_medical'],
    { facts: { entity: { is_hipaa_covered_entity: true }, data: { subject_is_ny_resident: true } } });
  ok('with both facts, both are asserted',
     both.assert.data.is_phi === true && both.assert.data.includes_ny_private_information === true);
}

// ---------------------------------------------------------------- hierarchy inherits
{
  const child = translate(['user.health_and_medical.genetic'], { facts: {} });
  ok('a specific key matches its own entry', child.assert?.data?.is_genetic_information === true);
  const deep = translate(['user.government_id.drivers_license_number'],
    { facts: { data: { subject_is_ny_resident: true } } });
  ok('a deep key resolves', deep.assert?.data?.includes_ny_private_information === true);
  const parentFallback = translate(['user.financial.credit_card'],
    { facts: { entity: { glba_financial_institution: true } } });
  ok('an unlisted child falls back to its parent entry',
     parentFallback.assert?.data?.is_nonpublic_personal_information === true);
}

// ---------------------------------------------------------------- partial never asserts
{
  const bio = translate(['user.biometric'], { facts: { data: { subject_is_ny_resident: true } } });
  ok('a partial mapping never asserts, even with its stated fact held',
     Object.keys(bio.assert).length === 0 && bio.surface.length === 1);
  const kids = translate(['user.childrens'], { facts: {} });
  ok('ambiguous age lines are surfaced, not resolved', kids.surface.length === 1);
  const crime = translate(['user.criminal_history'], { facts: {} });
  ok('a category with no fact key is surfaced with a null fact',
     crime.surface.length === 1 && crime.surface[0].fact === null);
}

// ---------------------------------------------------------------- unmapped is declared
{
  const r = translate(['user.invented.nonsense'], { facts: {} });
  ok('an unmapped term is REPORTED, not dropped', r.unmapped.includes('user.invented.nonsense'));
  ok('...and asserts nothing', Object.keys(r.assert).length === 0);
}

// ---------------------------------------------------------------- determinism
ok('two runs are byte-identical',
   JSON.stringify(translate(['user.health_and_medical', 'user.biometric'], { facts: {} })) ===
   JSON.stringify(translate(['user.health_and_medical', 'user.biometric'], { facts: {} })));

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
