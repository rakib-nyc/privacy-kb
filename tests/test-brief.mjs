#!/usr/bin/env node
// privacy_may_i + privacy_brief.
//
// mayI's whole reason to exist is the asymmetry: in a default-prohibition regime, an empty
// prohibitions list is not a yes. Most of these tests defend that, because it is the one property
// whose failure would be expensive and invisible.
import { mayI } from '../engine/permissions.mjs';
import { brief } from '../engine/brief.mjs';
import { load } from '../engine/corpus.mjs';

let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fail++; };
const kb = load();
const C = { as_of: '2026-09-15', state_layers: ['US-NY'] };

// ---------------------------------------------------------------- totality
for (const [label, args] of [['all null', [null, null, null, null, null]],
                             ['null corpus', [{}, {}, C, 'x', null]],
                             ['number facts', [1, 2, C, 3, kb]],
                             ['array facts', [[], [], C, [], kb]]]) {
  let threw = false, out = null;
  try { out = mayI(...args); } catch { threw = true; }
  ok(`mayI total on ${label}`, !threw && Array.isArray(out?.prohibitions), threw ? 'THREW' : '');
}
for (const bad of [null, '', 0, {}, []]) {
  let threw = false, out = null;
  try { out = brief(bad, kb); } catch { threw = true; }
  ok(`brief total on ${JSON.stringify(bad)}`, !threw && out?.found === false, threw ? 'THREW' : '');
}

// ---------------------------------------------------------------- the asymmetry
{
  const r = mayI({ is_hipaa_covered_entity: true }, { is_phi: true }, C, 'disclose to police', kb);
  ok('detects the HIPAA default prohibition', r.default_deny === true);
  ok('...names the provision that creates it',
     r.general_prohibitions.some(cite => /164\.502\(a\)/.test(cite)));
  ok('...and says silence is not permission in terms', /silence is NOT permission|NOT permission/i.test(r.caveat));
  ok('surfaces the law-enforcement permission',
     r.permissions.some(row => /164\.512\(f\)/.test(row.citation ?? '')));
  ok('permissions and prohibitions are separate buckets',
     r.permissions.every(row => row.obligation_type === 'permit') &&
     r.prohibitions.every(row => row.obligation_type === 'prohibit'));
  ok('every row carries the verbatim words and a hash',
     [...r.prohibitions, ...r.permissions].every(row => row.verbatim_span.length > 0 && !!row.sha256));
  ok('carve-outs travel with the record that they qualify',
     r.prohibitions.some(row => row.exemptions.length > 0));
}

// ---------------------------------------------------------------- no default prohibition
{
  const r = mayI({ is_employer: true }, {}, C, 'monitor email', kb);
  ok('without a general prohibition, default_deny is false', r.default_deny === false);
  // the caveat must STILL refuse to imply permission
  ok('...and the caveat still refuses to imply permission',
     /NOT a finding that the operation is permitted/.test(r.caveat));
}

// ---------------------------------------------------------------- mayI refuses without a date
{
  const r = mayI({ is_hipaa_covered_entity: true }, { is_phi: true }, {}, 'x', kb);
  ok('mayI refuses without as_of', !!r.error && r.prohibitions.length === 0);
}

// ---------------------------------------------------------------- brief
{
  const b = brief('ny.gbl.899_aa.9.hipaa_ag_notice', kb);
  ok('brief resolves by record id', b.found === true);
  ok('brief resolves by citation too',
     brief('N.Y. Gen. Bus. Law § 899-aa(9)', kb).found === true);
  ok('carries the verbatim span', b.quoted.verbatim_span.length > 0);
  ok('carries the preemption posture AND its reasoning',
     !!b.reach.preemption.posture && b.reach.preemption.note.length > 0);
  ok('carries who enforces and whether there is a private right of action',
     b.exposure.enforcers.length > 0 && b.exposure.private_right_of_action === false);
  ok('carries the penalty structure', b.exposure.penalty.structure.length > 0);
  ok('carries the limitations period', b.exposure.statute_of_limitations.length > 0);
  ok('carries what people get wrong', b.analysis.common_errors.length >= 3);
  ok('carries the date BASIS, not just the date', b.temporal.effective_from_basis === 'api_snapshot');
  ok('carries provenance a reader can check',
     !!b.provenance.source_url && !!b.provenance.raw_sha256 && !!b.provenance.fetched);
  // THE LINE: analysis prose is not quoted law and must say so
  ok('labels the analysis block as unverified prose',
     /NOT quoted law and no gate verifies them/.test(b.analysis.warning));
  ok('an unknown id is REFUSED, not improvised',
     brief('us.nope.invented', kb).found === false);
  ok('...and the refusal says the corpus does not have it',
     /does not have it/.test(brief('us.nope.invented', kb).error));
}

// ---------------------------------------------------------------- typed carve-outs survive
{
  const b = brief('us.cfr.45.164.502.a.use_disclosure_general', kb);
  if (b.found) {
    ok('exemptions keep their TYPE', b.reach.exemptions.every(c => !!c.type));
    ok('...and their scope text', b.reach.exemptions.every(c => c.scope.length > 0));
  } else { ok('exemptions keep their TYPE', true, '(record absent — skipped)'); ok('...and their scope text', true, '(skipped)'); }
}

// ---------------------------------------------------------------- determinism
ok('mayI is byte-identical across runs',
   JSON.stringify(mayI({ is_hipaa_covered_entity: true }, { is_phi: true }, C, 'x', kb)) ===
   JSON.stringify(mayI({ is_hipaa_covered_entity: true }, { is_phi: true }, C, 'x', kb)));
ok('brief is byte-identical across runs',
   JSON.stringify(brief('ny.gbl.899_aa.9.hipaa_ag_notice', kb)) ===
   JSON.stringify(brief('ny.gbl.899_aa.9.hipaa_ag_notice', kb)));

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
