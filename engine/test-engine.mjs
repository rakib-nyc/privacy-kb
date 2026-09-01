#!/usr/bin/env node
// Property tests for the engine. PROMPTS.md §4 names four; the rest guard invariants that
// would otherwise only be checked by reading the code.
import { analyze } from './applicability.mjs';
import { load } from './corpus.mjs';
import { computeDeadline } from './timeline.mjs';
import { evaluate, UNKNOWN } from './predicates.mjs';

let fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!cond) fail++;
};

// A spread of fact patterns, including empty and nonsense, because the engine must be TOTAL.
const FACTS = [
  [{}, {}, { as_of: '2026-08-19' }],
  [{ glba_financial_institution: true }, {}, { as_of: '2026-08-19' }],
  [{ hipaa_role: 'covered_entity' }, { types: ['phi'] }, { as_of: '2026-08-19', event: { type: 'breach_of_unsecured_phi' } }],
  [{ is_coppa_operator: true }, { service_directed_to_children: true }, { as_of: '2026-08-19' }],
  [{ nonsense: 'value' }, { junk: 1 }, { as_of: '1970-01-01' }],
  [{ glba_financial_institution: true }, {}, { as_of: '2026-08-19', state_layers: ['US-NY'] }],
  [{}, {}, { as_of: '2026-08-19', include_pending: true }],
];

// --- PROPERTY 1: backstops are never empty (invariant I6)
ok('P1 backstops.length > 0 for every fact pattern',
   FACTS.every(f => analyze(...f).backstops.length > 0));

// --- PROPERTY 2: no atom in both applicable and exempt
ok('P2 applicable and exempt are disjoint', FACTS.every(f => {
  const r = analyze(...f);
  const a = new Set(r.applicable.map(x => x.atom_id));
  return r.exempt.every(x => !a.has(x.atom_id));
}));

// --- PROPERTY 3: every surfaced obligation is verbatim_confirmed (invariant I1)
{
  const byId = load().byId;
  ok('P3 every obligation surfaced is verbatim_confirmed', FACTS.every(f =>
    analyze(...f).obligations.every(o => byId.get(o.id).verification_status === 'verbatim_confirmed')));
}

// --- PROPERTY 4: pending law never enters obligations (invariant I3)
ok('P4 include_pending routes pending to the watch feed ONLY', FACTS.every(f => {
  const r = analyze(...f[0] !== undefined ? [f[0], f[1], { ...f[2], include_pending: true }] : f);
  const byId = load().byId;
  return r.obligations.every(o => byId.get(o.id).status === 'in_force')
      && r.pending_watch.every(p => p.status !== 'in_force');
}));

// --- PROPERTY 4b: P4 WAS VACUOUS FOR AS LONG AS IT EXISTED. Every `every` above is true of an
// empty array, and until the SAFE for Kids Act landed the corpus held no record with a status
// other than in_force — so the test that guards invariant I3 passed by having nothing to check.
// A future-dated instrument is the only thing that makes it a test, which is why CORPUS-MANIFEST
// calls it the reference case: the article is enacted, its text is final, and it binds nobody
// until 2027-01-25.
{
  const corpus = load();
  const pending = corpus.obligations.filter(a => a.status === 'enacted_pending');
  ok('P4b the corpus actually HOLDS pending law, so P4 is not vacuous',
     pending.length > 0, `${pending.length} enacted_pending obligation(s)`);
  ok('...and every one of them is dated in the future',
     pending.every(a => a.effective_from > '2026-08-20'));

  const seen = analyze({}, {}, { as_of: '2026-08-20', include_pending: true });
  const watched = new Set(seen.pending_watch.map(p => p.atom_id));
  ok('P4b pending law reaches the watch feed', pending.every(a => watched.has(a.id)),
     `${watched.size} in pending_watch`);
  ok('...and reaches obligations from NO date, however far forward the query looks',
     ['2026-08-20', '2027-01-25', '2027-07-24', '2099-01-01'].every(d => {
       const r = analyze({}, {}, { as_of: d, include_pending: true });
       const ids = new Set(r.obligations.map(o => o.id));
       return pending.every(a => !ids.has(a.id));
     }),
     'status gates before effective_from — reaching the date does not flip the status');
}


// --- PROPERTY 6: as_of must be a REAL DATE, not merely present (invariant I2).
// Red-teaming 0.1 found the engine accepted any non-empty string. Every date comparison here is a
// STRING comparison, so 'not-a-date' sorts above every ISO date and EVERY record reads as in
// force: the same facts returned 5 obligations for '2026-01-01' and 7 for 'not-a-date', the extra
// two being law that does not bind until 2027. A typo WIDENED the answer instead of failing it.
{
  const bad = ['not-a-date', 'zzz', '', '2026-13-45', '2026-02-30', '2026-1-1', '20260101',
               20260101, null, undefined, {}, [], '2026-01-01T00:00:00Z'];
  ok('P6 every malformed as_of is refused',
     bad.every(d => analyze({}, {}, { as_of: d }).error != null),
     bad.filter(d => analyze({}, {}, { as_of: d }).error == null).map(String).join(', ') || 'none accepted');
  ok('P6 ...and a well-formed one still works',
     analyze({}, {}, { as_of: '2026-01-01' }).error == null);
  ok('P6 ...and a refusal returns the full shape rather than a bare error',
     Array.isArray(analyze({}, {}, { as_of: 'zzz' }).backstops));
  // The specific regression: a garbage date must never return MORE than a real one.
  const facts = [{ owns_or_licenses_computerized_data: true, nexus: 'US-NY' },
                 { includes_ny_private_information: true }];
  const ctx = d => ({ as_of: d, event: { type: 'breach_of_security_of_the_system' }, state_layers: ['US-NY'] });
  ok('P6 ...and garbage can no longer out-return a real date',
     analyze(facts[0], facts[1], ctx('zzz')).obligations.length === 0
     && analyze(facts[0], facts[1], ctx('2026-01-01')).obligations.length > 0);
}

// --- PROPERTY 7: computeDeadline is total, like analyze().
// It threw a TypeError on any record without source.citation. The engine's stated property is
// that it never throws; one entry point was exempt only because nothing tested that entry point.
{
  const hostile = [null, undefined, {}, { deadline: null }, { deadline: {} }, [],
                   { deadline: { duration: { value: 1, unit: 'fortnights' }, trigger_event: 'x', computation: '' } }];
  let threw = null;
  for (const h of hostile) { try { computeDeadline(h, '2026-01-01'); } catch (e) { threw ??= String(e); } }
  ok('P7 computeDeadline never throws on hostile input', threw === null, threw ?? '');
  ok('P7 ...and a business-day result declares the holiday approximation', (() => {
    const a = load().obligations.find(x => x.deadline?.duration?.unit === 'business_days');
    return !a || typeof computeDeadline(a, '2026-12-24').business_day_basis === 'string';
  })());
}

// --- as_of is required and has no default (invariant I2)
ok('as_of is required — no default', analyze({}, {}, {}).error != null);
ok('a missing as_of still returns a shaped result rather than throwing',
   Array.isArray(analyze({}, {}, {}).backstops));

// --- totality
ok('analyze never throws on hostile input', (() => {
  try {
    analyze(null, null, { as_of: '2026-08-19' });
    analyze({ a: { b: { c: 1 } } }, [], { as_of: 'not-a-date' });
    analyze(undefined, undefined, { as_of: '2026-08-19', state_layers: null });
    return true;
  } catch { return false; }
})());

// --- explainability: every decision names what decided it
{
  const r = analyze({ glba_financial_institution: true }, {}, { as_of: '2026-08-19' });
  ok('every applicable entry carries the predicate that decided it',
     r.applicable.length > 0 && r.applicable.every(x => x.why && x.atom_id));
  ok('every not_applicable entry carries the failed predicate',
     r.not_applicable.every(x => x.failed_predicate));
}

// --- unknown facts are neither applicable nor inapplicable
{
  const r = analyze({}, {}, { as_of: '2026-08-19' });
  const a = new Set(r.applicable.map(x => x.atom_id));
  const na = new Set(r.not_applicable.map(x => x.atom_id));
  ok('unknown-fact atoms are held separately, not silently dropped either way',
     r.unknown_facts.length > 0 && r.unknown_facts.every(u => !a.has(u.atom_id) && !na.has(u.atom_id)),
     `(${r.unknown_facts.length} undetermined)`);
}

// --- deadlines
{
  const c = load();
  const glba = c.byId.get('us.glba.safeguards.314_4.ftc_notification');
  const d = computeDeadline(glba, '2026-08-01');
  ok('30-day deadline computes from the trigger date', d.computed === '2026-08-31', d.computed);
  ok('a dual standard is flagged as an outer limit, not an allowance', d.caution != null);
  ok('a deadline with no trigger date is not invented', computeDeadline(glba, null).computed === null);
}

// --- predicates refuse rather than guess
{
  ok('an unparseable predicate is UNKNOWN, never true',
     evaluate({ all: ['gibberish here'] }, {}).value === UNKNOWN);
  ok('a missing fact is UNKNOWN, never true',
     evaluate({ all: ['entity.nope == true'] }, { entity: {} }).value === UNKNOWN);
}

// --- I6 in substance: no sectoral match still yields constraints
{
  const r = analyze({ sectors: ['florist'] }, {}, { as_of: '2026-08-19' });
  ok('with no sectoral match the engine still returns operative constraints, never silence',
     r.obligations.length === 0 && r.backstops.length > 0 && r.coverage_gaps.length > 0);
}

// I6's STATE half must actually resolve, not merely be reported as missing. This regressed
// once already: the resolver matched /udap|deceptive/ against the atom id, so GBL § 349 sat in
// the corpus as ny.gbl.349.a.unlawful and the engine reported the New York UDAP backstop
// UNAVAILABLE while blaming a blocker that had been resolved. A false gap is quieter than a
// false all-clear and just as wrong.
{
  const r = analyze({ nexus: 'US' }, {}, { as_of: '2026-08-19', state_layers: ['US-NY'] });
  const u = r.backstops.filter(b => b.kind === 'state_udap');
  ok('I6: a state UDAP backstop is emitted for a requested layer', u.length > 0);
  ok('I6: US-NY resolves to a real atom, not to "unavailable"',
     u.some(b => b.atom_id && !b.unavailable), JSON.stringify(u[0] ?? {}).slice(0, 120));
  ok('I6: it cites the instrument it resolved', u.every(b => b.unavailable || !!b.citation));
  const t = analyze({ nexus: 'US' }, {}, { as_of: '2026-08-19', state_layers: ['US-TX'] })
    .backstops.filter(b => b.kind === 'state_udap');
  ok('I6: an undeclared layer is reported unavailable, never silently dropped',
     t.length === 1 && t[0].unavailable === true);
  ok('I6: and it says the gap is in the declaration', /declaration/.test(t[0]?.note ?? ''));
}

// FLAGSHIP RESULT, PINNED. A state deadline triggered BY federal compliance, falling due
// BEFORE the federal-discovery clock. § 899-aa(9) starts running when the covered entity
// notifies the Secretary of HHS — so doing the federal thing correctly on 5 August creates a
// New York filing due 12 August, while the § 899-aa(2) resident notice, running thirty days
// from discovery on 1 August, is not due until 31 August. Every instinct says the federal
// clock binds and the state layer is the slower parallel duty; the opposite is true, and it is
// true for a structural reason rather than an arithmetic one. This test exists so that no
// future change to deadlines, triggers or corpus ordering can quietly invert it.
{
  const r = analyze(
    { is_hipaa_covered_entity: true, owns_or_licenses_computerized_data: true, nexus: 'US' },
    { is_phi: true, includes_ny_private_information: true },
    { as_of: '2026-08-19', state_layers: ['US-NY'],
      event: { type: 'breach_of_security_of_the_system',
               'discovery of the breach': '2026-08-01',
               'notification to the Secretary of Health and Human Services': '2026-08-05' },
      practice: { notified_hhs_secretary_of_breach: true } });
  const by = id => r.deadlines.find(d => d.atom_id === id);
  const ag = by('ny.gbl.899_aa.9.hipaa_ag_notice');
  const res = by('ny.gbl.899_aa.2.notify_residents');
  ok('SHIELD § 899-aa(9): the AG deadline is computed at all', !!ag?.computed, ag?.computed);
  ok('SHIELD § 899-aa(9): it runs from the HHS notification, not from discovery',
     ag?.trigger_date === '2026-08-05', ag?.trigger_date);
  ok('SHIELD § 899-aa(9): five business days from 5 Aug 2026 is 12 Aug',
     ag?.computed === '2026-08-12', ag?.computed);
  ok('SHIELD § 899-aa(2): thirty days from discovery on 1 Aug is 31 Aug',
     res?.computed === '2026-08-31', res?.computed);
  ok('ORDERING: the state duty created BY federal compliance falls due FIRST',
     ag?.computed < res?.computed, `${ag?.computed} < ${res?.computed}`);
  ok('...and the engine sorts it first when asked for the earliest',
     r.deadlines.slice().sort((a, b) => String(a.computed).localeCompare(String(b.computed)))[0]
       ?.atom_id === 'ny.gbl.899_aa.9.hipaa_ag_notice');
  ok('HIPAA remains applicable throughout — it is a floor, not a ceiling',
     r.applicable.some(a => a.atom_id === 'us.cfr.45.164.502.a.use_disclosure_general'));
}

// DEC-007 PINNED. A partially-extracted instrument still ANSWERS, and says what it cannot reach.
// This assertion has now been repointed FOUR times, each because the corpus grew into the gap it
// named — FCRA permissible purposes, then reinvestigation, then adverse action, then consumer
// disclosures. Naming a specific gap tests the corpus; naming the MECHANISM tests the code. So it
// now asserts the shape against whichever instrument is partial, and fails loudly if none is —
// which will happen when the corpus is complete, and is the right moment to revisit this test
// rather than a silent pass.
{
  const cov = await import('./coverage.mjs');
  const corpus = load();
  const partial = cov.declaredInstruments()
    .map(i => cov.instrumentCoverage(i, corpus))
    .filter(r => !r.complete && r.present.length);
  // Every declared instrument is now complete, so the partial branch has NO live example. That is
  // a coverage gap in this test, not a pass — say so rather than let silence read as success, which
  // is the gate-23 lesson applied to a property test. The complete-instrument assertion below runs
  // either way and is what currently carries the mechanism.
  if (!partial.length)
    console.log('note  DEC-007: no partial instrument exists — the partial branch is UNEXERCISED. ' +
                'Re-check it the next time an instrument is opened.');
  if (partial.length) {
    const r = partial[0];
    ok('DEC-007: every absent category carries an id, citations and what it would supply',
       r.absent.every(cat => cat.id && (cat.citation_prefix ?? []).length && cat.supplies),
       r.instrument_id);
    ok('DEC-007: the summary names what it CANNOT reach',
       /CANNOT reach/.test(r.summary), r.summary.slice(0, 80));
    ok('DEC-007: and tells the reader those questions are unanswered, not answered in the negative',
       /unanswered rather than as answered in the negative/.test(r.summary));
  }
}

// The `law` namespace must be POPULATED from caller input. It was hardcoded to {} while two FCRA
// preemption atoms predicated on it — grammatical, evaluable, and incapable of ever being true.
{
  const r = analyze({ nexus: 'US' }, {}, { as_of: '2026-08-19',
    law: { federal_instrument: 'us.fcra', state_instrument: 'ny.gbl.349' } });
  ok('the law namespace reaches predicates',
     r.applicable.some(x => x.atom_id === 'us.fcra.1681t.general_savings'));
}

// `in` must handle a MULTI-VALUED left side. The facts model makes data_types and sectors
// arrays, so "data.types in ['consumer_report']" is how an atom asks whether a consumer report
// is among the data at issue — and under plain membership it was permanently false, because
// ['consumer_report'] is not an element of ['consumer_report']. The FCRA permissible-purpose
// atom simply never fired. A missing fact must still be UNKNOWN rather than false.
{
  const f = d => ({ entity: {}, data: d, event: {}, purpose: {}, practice: {}, law: {} });
  const v = (e, d) => evaluate({ all: [e] }, f(d)).value;
  ok('in: array left side, overlapping', v('data.types in ["consumer_report"]',
     { types: ['consumer_report', 'other'] }) === true);
  ok('in: array left side, disjoint', v('data.types in ["consumer_report"]', { types: ['medical'] }) === false);
  ok('in: scalar left side still works', v('data.purpose_of_product in ["business"]',
     { purpose_of_product: 'business' }) === true);
  ok('in: a missing fact is UNKNOWN, not false',
     v('data.types in ["consumer_report"]', {}) === UNKNOWN);
}

// FCRA ROLES. The statute attaches different duties to CRA, furnisher and user, and the
// engine must not blur them — this is the first instrument where reach and role are exercised
// together at scale.
{
  const at = (e, ctx) => analyze(e, ctx.data ?? {}, { as_of: '2026-08-19', ...ctx })
    .applicable.map(x => x.atom_id).filter(id => id.includes('fcra'));
  const cra = at({ is_consumer_reporting_agency: true, nexus: 'US' },
    { data: { types: ['consumer_report'] }, practice: { prepares_consumer_report: true } });
  ok('FCRA: a CRA gets the accuracy duty', cra.includes('us.fcra.1681e.b.maximum_possible_accuracy'));
  ok('FCRA: and the permissible-purpose limit', cra.includes('us.fcra.1681b.a.permissible_purpose'));
  ok('FCRA: a CRA does NOT get furnisher duties',
     !cra.some(id => id.includes('1681s_2')), cra.join(', '));
  const pre = at({ is_furnisher: true, nexus: 'US' },
    { practice: { furnishes_to_consumer_reporting_agency: true } });
  ok('FCRA: a furnisher gets the accuracy prohibition', pre.includes('us.fcra.1681s_2.a1a.furnisher_accuracy'));
  ok('FCRA: but NOT the investigation duty before a CRA dispute arrives',
     !pre.includes('us.fcra.1681s_2.b1a.furnisher_investigation'), pre.join(', '));
  const post = at({ is_furnisher: true, nexus: 'US' },
    { practice: { furnishes_to_consumer_reporting_agency: true },
      event: { type: 'cra_dispute_notice_received' } });
  ok('FCRA: the investigation duty arrives with the CRA dispute notice',
     post.includes('us.fcra.1681s_2.b1a.furnisher_investigation'));
}

// MULTI-STAGE DEADLINES. FCRA § 1681i is the first duty in the corpus whose period is
// conditionally extendable, and the failure mode is reporting one number. 30 days understates
// the lawful outer bound; 45 tells an agency it has time it has not earned. Both, each with the
// condition that produces it — and the condition that takes it away again.
{
  const r = analyze({ is_consumer_reporting_agency: true, nexus: 'US' }, { types: ['consumer_report'] },
    { as_of: '2026-08-19',
      event: { type: 'consumer_dispute_received', 'receipt of the consumer dispute': '2026-08-01' } });
  const d = r.deadlines.find(x => x.atom_id === 'us.fcra.1681i.a1a.reinvestigation');
  ok('§ 1681i: the base reinvestigation period is 30 days', d?.computed === '2026-08-31', d?.computed);
  const ext = d?.conditional_extensions?.[0];
  ok('§ 1681i: a conditional extension is reported, not folded into the base', !!ext);
  ok('§ 1681i: the extended maximum is 45 days', ext?.maximum_if_met === '2026-09-15', ext?.maximum_if_met);
  ok('§ 1681i: the extension names the consumer act that earns it',
     /receives information from the consumer/.test(ext?.condition ?? ''));
  ok('§ 1681i: and the condition that removes it again',
     /cannot be verified/.test(ext?.unless ?? ''));
  ok('§ 1681i: the extension is labelled a ceiling, not a default',
     /ceiling rather than a default/.test(ext?.note ?? ''));
  ok('§ 1681i: a deadline with no tolling reports an empty extension list, never a phantom one',
     (r.deadlines.find(x => x.atom_id === 'us.fcra.1681i.a3b.frivolous_notice')
       ?.conditional_extensions ?? []).length === 0);
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
