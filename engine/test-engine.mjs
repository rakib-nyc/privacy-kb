#!/usr/bin/env node
// Property tests for the engine. PROMPTS.md §4 names four; the rest guard invariants that
// would otherwise only be checked by reading the code.
import { analyze } from './applicability.mjs';
import { load } from './corpus.mjs';
import { computeDeadline } from './timeline.mjs';
import { evaluate, UNKNOWN } from './predicates.mjs';
import { canonicalTrigger, resolveTriggerDate, triggerMeta, TRIGGERS, TRIGGER_KEYS, FAMILIES } from './triggers.mjs';
import { inForceOn, EVER_LAW } from './corpus.mjs';
import { isRealDate } from './dates.mjs';
import { provisionKey, byProvision, isVersionChain, chainProblems } from './provisions.mjs';
import { requiredCharacterisations, incidentAsserted, asSet } from './characterisation.mjs';
import { buildMemo } from './memo.mjs';
import { normaliseFacts } from './facts.mjs';
import { assertedFamilies } from './incidents.mjs';
import { INCIDENTS, INCIDENT_FAMILIES, incidentFamily, isAlternativeCharacterisation } from './incidents.mjs';

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


// ---------------------------------------------------------------- trigger vocabulary
// THE DEFECT: `deadline.trigger_event` was free text, the engine indexed caller facts with it
// verbatim, and a `?? context.event.date` fallback applied ONE date to every trigger in the
// corpus. `deadlines --hipaa --ny-data --from D` therefore printed a HIPAA access-request
// clock, an amendment-request clock and a SHIELD breach clock all running from D. These tests
// pin the three properties that stop it recurring: every corpus trigger is in the vocabulary,
// a date only starts the clock it was asserted for, and how it was resolved is reported.
{
  const corpus = load();
  const withDeadlines = corpus.obligations.filter(a => a.deadline?.trigger_event);
  const unknown = withDeadlines.filter(a => !canonicalTrigger(a.deadline.trigger_event));
  ok('every corpus trigger_event is in the controlled vocabulary', unknown.length === 0,
     unknown.map(a => `${a.id}: ${a.deadline.trigger_event}`).join('; '));
  const nonCanonical = withDeadlines.filter(a => a.deadline.trigger_event !== canonicalTrigger(a.deadline.trigger_event));
  ok('...and every record stores the CANONICAL key, not an alias', nonCanonical.length === 0,
     nonCanonical.map(a => a.id).join('; '));
  ok('every trigger declares a family that exists',
     TRIGGER_KEYS.every(k => Object.hasOwn(FAMILIES, TRIGGERS[k].family)));

  // Resolution routes, each reported rather than silently taken.
  const ev = { discovery_of_breach: '2026-08-01' };
  ok('an exactly-named trigger resolves as "exact"',
     resolveTriggerDate('discovery_of_breach', ev).via === 'exact');
  ok('a legacy prose spelling still resolves, and is marked an alias', (() => {
    const r = resolveTriggerDate('discovery_of_breach', { 'discovery of the breach': '2026-08-01' });
    return r.date === '2026-08-01' && r.via === 'alias';
  })());
  ok('a family key dates a member trigger, and says it was the family', (() => {
    const r = resolveTriggerDate('discovery_of_breach_of_security', { breach_discovery: '2026-08-01' });
    return r.date === '2026-08-01' && r.via === 'family' && r.supplied_as === 'breach_discovery';
  })());
  ok('a family key does NOT reach across families', (() => {
    const r = resolveTriggerDate('receipt_of_access_request', { breach_discovery: '2026-08-01' });
    return r.date === null && r.via === null;
  })());
  // THE FALLBACK IS GONE. This is the assertion that keeps it gone.
  ok('there is NO generic event.date fallback',
     resolveTriggerDate('discovery_of_breach', { date: '2026-08-01' }).date === null);
  ok('a malformed date does not start a clock',
     resolveTriggerDate('discovery_of_breach', { discovery_of_breach: 'August 1st' }).date === null);
  ok('an unrecognised trigger resolves to nothing rather than throwing',
     resolveTriggerDate('no_such_trigger', { no_such_trigger: '2026-08-01' }).date === null);

  // End to end: one date must not start an unrelated clock.
  const r = analyze({ is_hipaa_covered_entity: true, owns_or_licenses_computerized_data: true },
                    { is_phi: true, types: ['phi'], includes_ny_private_information: true },
                    { as_of: '2026-09-09', state_layers: ['US-NY'],
                      event: { type: 'breach_of_security_of_the_system', breach_discovery: '2026-08-01' } });
  const shield = r.deadlines.find(d => d.atom_id === 'ny.gbl.899_aa.2.notify_residents');
  const access = r.deadlines.find(d => d.atom_id === 'us.cfr.45.164_524.b_2_i');
  ok('a breach date starts the breach clock', shield?.computed === '2026-08-31', shield?.computed);
  ok('...and does NOT start an access-request clock', access && access.computed === null,
     JSON.stringify(access?.computed));
  ok('an unstarted clock says so explicitly', access?.clock_started === false);
  ok('...and names the key that would start it', /--?event|event\./.test(access?.note ?? '')
     && (access?.note ?? '').includes('receipt_of_access_request'), access?.note?.slice(0, 90));
  ok('...and is RETURNED rather than dropped from the answer',
     r.deadlines.length > r.deadlines.filter(d => d.computed).length);
  ok('a family-dated clock records the inference', shield?.trigger_via === 'family'
     && /family key/.test(shield?.trigger_inference_note ?? ''));

  // computeDeadline stays total under the new signature.
  ok('computeDeadline is total on a null resolution',
     computeDeadline({ id: 'x', deadline: { trigger_event: 'discovery_of_breach',
       duration: { value: 5, unit: 'calendar_days' }, computation: '' } }, null, null)?.computed === null);
}


// ---------------------------------------------------------------- the time axis
// THE STATE THESE GUARD. supersedes = 0, superseded_by = 0 and effective_to = 0 across all 248
// records; 238 distinct provisions, none at more than one vintage. Invariant I2 was therefore
// enforced at the query boundary over data that could only describe one moment. These tests pin
// the semantics a version chain needs BEFORE one exists, because the two ways to get it wrong —
// excluding superseded text from the window it governs, and letting two vintages both govern
// the day an amendment lands — are silent.
{
  const vintage = (id, from, to, status, extra = {}) => ({
    id, status, effective_from: from, effective_to: to,
    verification_status: 'verbatim_confirmed',
    source: { instrument_id: 'us.test', citation: 'test' },
    paragraph_path: { path: ['a'], anchor: 'T1' },
    supersedes: null, superseded_by: null, ...extra });

  // A superseded vintage IS the answer inside its own window. If it were not, holding the
  // February text and answering a February question with nothing is the best the corpus could do.
  const old = vintage('v1', '2019-10-23', '2024-12-27', 'superseded');
  const now = vintage('v2', '2024-12-27', null, 'in_force');
  ok('a superseded vintage governs inside its own window', inForceOn(old, '2020-06-01'));
  ok('...and not after it', !inForceOn(old, '2025-06-01'));
  ok('...and not before it', !inForceOn(old, '2019-01-01'));
  ok('the current vintage governs after the changeover', inForceOn(now, '2025-06-01'));
  ok('...and not before it', !inForceOn(now, '2024-12-26'));

  // THE HANDOVER DAY. Half-open [from, to): exactly one vintage governs the day the amendment
  // lands. The old `effective_to < asOf` test kept BOTH in force on that date.
  ok('exactly one vintage governs the changeover date itself',
     [old, now].filter(v => inForceOn(v, '2024-12-27')).length === 1);
  ok('...and it is the NEW one', inForceOn(now, '2024-12-27') && !inForceOn(old, '2024-12-27'));

  // Statuses that were never law stay out regardless of date.
  for (const st of ['proposed', 'vetoed', 'enjoined', 'enacted_pending'])
    ok(`status "${st}" never satisfies inForceOn`,
       !inForceOn(vintage('x', '2000-01-01', null, st), '2026-01-01'));
  ok('EVER_LAW is exactly in_force + superseded',
     EVER_LAW.has('in_force') && EVER_LAW.has('superseded') && EVER_LAW.size === 2);

  // Provision identity: vintages group, co-located duties are not mistaken for a chain.
  ok('two vintages of one provision share a provision key',
     provisionKey(old) === provisionKey(now));
  ok('an explicit provision_key overrides derivation, for renumbering',
     provisionKey({ ...old, provision_key: 'renamed' }) === 'renamed');
  ok('records differing only by path are different provisions',
     provisionKey(old) !== provisionKey({ ...old, paragraph_path: { path: ['b'], anchor: 'T1' } }));
  ok('differing dates over one provision read as a version chain', isVersionChain([old, now]));
  ok('SAME-date records over one provision do NOT — they are co-located duties, gate 41\'s question',
     !isVersionChain([old, { ...now, effective_from: old.effective_from }]));

  // A sound chain has no complaints; each way of breaking it is caught.
  const linked = [ { ...old, superseded_by: 'v2' }, { ...now, supersedes: 'v1' } ];
  ok('a correctly linked, adjacent chain reports no problems',
     chainProblems(linked).length === 0, JSON.stringify(chainProblems(linked)));
  ok('a GAP is caught', chainProblems([
     { ...old, effective_to: '2024-01-01', superseded_by: 'v2' }, { ...now, supersedes: 'v1' }])
     .some(p => p.startsWith('GAP')));
  ok('an OVERLAP is caught', chainProblems([
     { ...old, effective_to: '2025-06-01', superseded_by: 'v2' }, { ...now, supersedes: 'v1' }])
     .some(p => p.startsWith('OVERLAP')));
  ok('a missing forward link is caught',
     chainProblems([old, { ...now, supersedes: 'v1' }]).some(p => /superseded_by/.test(p)));
  ok('a missing back link is caught',
     chainProblems([{ ...old, superseded_by: 'v2' }, now]).some(p => /supersedes/.test(p)));
  ok('an unclosed earlier vintage is caught', chainProblems([
     { ...old, effective_to: null, superseded_by: 'v2' }, { ...now, supersedes: 'v1' }])
     .some(p => /never stops governing|effective_to: null/.test(p)));
  ok('two open-ended vintages are caught', chainProblems([
     { ...old, effective_to: null, status: 'in_force' }, now])
     .some(p => /two current texts|Exactly one version/.test(p)));

  // The live corpus still holds no chain. This is the measurement, asserted rather than assumed:
  // when it changes, it should change because someone added a vintage on purpose.
  const chains = [...byProvision(load().all)].filter(([, g]) => g.length > 1 && isVersionChain(g));
  ok('every version chain in the live corpus is sound',
     chains.every(([, g]) => chainProblems(g).length === 0),
     chains.map(([k, g]) => `${k}: ${chainProblems(g).join(' ')}`).filter(x => /: ./.test(x)).join(' | '));
}


// ---------------------------------------------------------------- hostile input
// Found by fuzzing the new entry points rather than by reading them. Each of these was a real
// defect, and each is the same shape: a lookup that walks the prototype chain, or a date that
// is checked for presence rather than validity. Both turn caller-controlled input into an
// answer the engine cannot defend.
{
  // `ALIASES[q]` walked the prototype chain, so the event key "constructor" resolved to
  // Object.prototype.constructor — a truthy "canonical trigger" that is a function. It
  // satisfied the alias branch (returning a date for a trigger that does not exist) and made
  // computeDeadline throw on TRIGGERS[canon].family, breaking the engine's totality guarantee.
  // Only all-lowercase prototype names could reach it, because the lookup lowercases first.
  for (const k of ['constructor', '__proto__', 'valueof', 'tostring', 'hasownproperty'])
    ok(`prototype name "${k}" is not a trigger`, canonicalTrigger(k) === null,
       String(canonicalTrigger(k)).slice(0, 40));
  ok('...and does not resolve a date either',
     resolveTriggerDate('constructor', { constructor: '2026-01-01' }).date === null);
  ok('...and triggerMeta returns null rather than a prototype member',
     triggerMeta('constructor') === null);
  ok('computeDeadline stays TOTAL on a prototype-named trigger', (() => {
    try {
      return computeDeadline({ id: 'x', deadline: { trigger_event: 'constructor',
        duration: { value: 1, unit: 'calendar_days' }, computation: '' } }, null)?.computed === null;
    } catch { return false; }
  })());
  // An event object carrying a poisoned __proto__ must not leak a date either.
  ok('a poisoned event object resolves normally', (() => {
    const ev = JSON.parse('{"__proto__":{"discovery_of_breach":"1999-01-01"},"discovery_of_breach":"2026-01-01"}');
    return resolveTriggerDate('discovery_of_breach', ev).date === '2026-01-01';
  })());
  ok('...and an inherited-only key supplies nothing', (() => {
    const ev = Object.create({ discovery_of_breach: '1999-01-01' });
    return resolveTriggerDate('discovery_of_breach', ev).date === null;
  })());

  // Date validity, not date presence.
  for (const bad of ['not-a-date', '2026-13-01', '2026-02-30', '26-01-01', '2026-1-1', '', null, 5, {}])
    ok(`isRealDate rejects ${JSON.stringify(bad)}`, !isRealDate(bad));
  for (const good of ['2026-01-01', '2024-02-29', '1970-01-01'])
    ok(`isRealDate accepts ${good}`, isRealDate(good));
  ok('analyze refuses a well-shaped but impossible date',
     !!analyze({}, {}, { as_of: '2026-02-30' }).error);
}


// A WELL-SHAPED IMPOSSIBLE DATE IS THE ONE THAT GETS THROUGH. '2026-02-30' passes any regex and
// `new Date('2026-02-30T00:00:00Z')` is not NaN — JavaScript rolls it to 2 March. computeDeadline's
// NaN test therefore passed it and returned a deadline a MONTH ADRIFT with no error. In a clock
// engine that is the worst version of this bug, because the wrong date looks exactly like a right
// one. Found by fuzzing, not by reading.
{
  const atom = { id: 'x', source: { citation: 'c' },
    deadline: { trigger_event: 'discovery_of_breach',
                duration: { value: 30, unit: 'calendar_days' }, computation: '' } };
  ok('a real trigger date still computes', computeDeadline(atom, '2026-08-01').computed === '2026-08-31');
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31']) {
    const r = computeDeadline(atom, bad);
    ok(`computeDeadline REFUSES ${bad}`, r.computed === null && !!r.error, JSON.stringify(r.computed));
  }
  ok('...and the refusal says the clock did not start',
     computeDeadline(atom, '2026-02-30').clock_started === false);
  ok('2024-02-29 is real and still computes', computeDeadline(atom, '2024-02-29').computed === '2024-03-30');

  // The same date must not slip in through the trigger vocabulary either.
  ok('an impossible date does not start a clock via resolveTriggerDate',
     resolveTriggerDate('discovery_of_breach', { discovery_of_breach: '2026-02-30' }).date === null);
  ok('...nor through a family key',
     resolveTriggerDate('discovery_of_breach', { breach_discovery: '2026-13-01' }).date === null);
  ok('...while a real one still does',
     resolveTriggerDate('discovery_of_breach', { breach_discovery: '2024-02-29' }).date === '2024-02-29');
}


// ---------------------------------------------------------------- incident characterisation
// THE DEFECT: `event.type` was a single scalar and each regime's atom demanded its own literal,
// so ONE incident could satisfy HIPAA or the SHIELD Act but never both. A New York hospital that
// lost PHI got the federal clocks or the state clock, and `breachNotificationTimeline` reported
// `complete: true` while omitting a New York deadline that fell a MONTH EARLIER than anything it
// printed. Four statutes, four definitions, one laptop.
{
  const CE = { is_hipaa_covered_entity: true, hipaa_role: 'covered_entity',
    owns_or_licenses_computerized_data: true, within_ftc_jurisdiction: true,
    in_or_affecting_commerce: true, nexus: 'US-NY' };
  const D = { is_phi: true, types: ['phi'], includes_ny_private_information: true };
  const run = ev => analyze(CE, D, { as_of: '2026-09-10', state_layers: ['US-NY'], event: ev });
  const cites = r => r.applicable.map(o => o.citation);

  const both = run({ type: ['breach_of_unsecured_phi', 'breach_of_security_of_the_system'],
                     breach_discovery: '2026-08-01' });
  ok('one incident can be characterised under BOTH regimes at once',
     cites(both).some(c => /164\.404/.test(c)) && cites(both).some(c => /899-aa\(2\)/.test(c)));
  const started = both.deadlines.filter(d => d.computed).sort((a, b) => a.computed.localeCompare(b.computed));
  ok('...and the EARLIEST clock is the state one', /899-aa\(2\)/.test(started[0]?.citation ?? ''),
     `${started[0]?.computed} ${started[0]?.citation}`);
  ok('...which falls a month before the federal ones', started[0]?.computed === '2026-08-31');

  // A scalar must keep working — an MCP client written against the old shape cannot be broken.
  const scalar = run({ type: 'breach_of_unsecured_phi', breach_discovery: '2026-08-01' });
  ok('a scalar event.type still engages its own regime', cites(scalar).some(c => /164\.404/.test(c)));

  // ...but the regime it does NOT assert must be reported, never dropped.
  const gaps = scalar.characterisation_required ?? [];
  const ny = gaps.find(g => /899-aa\(2\)/.test(g.citation));
  ok('the unasserted regime is REPORTED, not silently dropped', !!ny);
  ok('...marked as an alternative description of the SAME facts', ny?.alternative_description === true);
  ok('...naming the characterisation that would engage it',
     (ny?.requires_characterisation ?? []).includes('breach_of_security_of_the_system'));
  ok('...and the clock it would start', ny?.deadline_if_engaged?.duration?.value === 30);
  ok('...and the test that decides it, so the engine is not making the call',
     (ny?.determined_by ?? []).some(x => /899-aa\(1\)\(c\)|acquisition/i.test(x)));
  ok('an unrelated event is NOT dressed up as the same incident',
     gaps.filter(g => /349\(h\)/.test(g.citation)).every(g => g.alternative_description === false));
  ok('alternatives sort ahead of unrelated events',
     gaps.findIndex(g => g.alternative_description) < gaps.findIndex(g => !g.alternative_description));

  // No incident asserted at all -> no prompting. Otherwise every routine query drowns.
  const none = analyze(CE, D, { as_of: '2026-09-10', state_layers: ['US-NY'], event: {} });
  ok('with no incident asserted, nothing is reported as an unmade characterisation',
     (none.characterisation_required ?? []).length === 0);

  // Vocabulary integrity: every characterisation the corpus demands must be described.
  const used = new Set();
  for (const a of load().obligations)
    for (const c of requiredCharacterisations(a.applies_if)) used.add(c);
  const undescribed = [...used].filter(c => !Object.hasOwn(INCIDENTS, c));
  ok('every characterisation the corpus demands is in the vocabulary', undescribed.length === 0,
     undescribed.join(', '));
  ok('...and every one declares a family that exists',
     [...used].every(c => Object.hasOwn(INCIDENT_FAMILIES, incidentFamily(c))));
  ok('the four security-incident regimes share a family',
     ['breach_of_unsecured_phi', 'breach_of_security_of_the_system', 'breach_of_security',
      'notification_event'].every(k => incidentFamily(k) === 'security_incident'));
  ok('...and a telemarketing offer is NOT one of them',
     !isAlternativeCharacterisation('telemarketing_sales_offer', ['breach_of_unsecured_phi']));

  // Helpers stay total on junk.
  for (const j of [null, undefined, 0, '', [], {}, 'x'])
    ok(`requiredCharacterisations is total on ${JSON.stringify(j)}`,
       Array.isArray(requiredCharacterisations(j)));
  ok('incidentAsserted is false for an empty event', !incidentAsserted({}));
  ok('incidentAsserted is true for event.occurred', incidentAsserted({ occurred: true }));
  ok('asSet normalises scalar and array alike',
     asSet('a').length === 1 && asSet(['a', 'b']).length === 2 && asSet(null).length === 0);
}


// TOTALITY AT THE NEW OUTERMOST SURFACES. A parameter default covers `undefined` ONLY, so a null
// argument threw — the same non-totality already found in computeDeadline, preemption.resolve()
// and all four workflows, reappearing in each new layer as it was written. Found by fuzzing.
{
  const junk = [null, undefined, 0, 1, '', ' ', 'x', [], {}, NaN, true, false, [1, 2]];
  const totals = [
    ['buildMemo', v => buildMemo(v, v, v, v)],
    ['normaliseFacts', v => normaliseFacts(v)],
    ['assertedFamilies', v => assertedFamilies(v)],
    ['isAlternativeCharacterisation', v => isAlternativeCharacterisation(v, v)],
    ['incidentAsserted', v => incidentAsserted(v)],
    ['requiredCharacterisations', v => requiredCharacterisations(v)],
  ];
  for (const [name, fn] of totals)
    ok(`${name} is total on every junk argument`, junk.every(v => {
      try { fn(v); return true; } catch { return false; }
    }));
  ok('buildMemo on junk returns a refusal rather than a document',
     !!buildMemo(null, null, null, null).error);
  ok('...and refuses because as_of is missing, naming the invariant',
     /as of a date|as_of is required/i.test(buildMemo(null, null, null, null).error ?? ''));
  ok('a poisoned entity object does not pollute the prototype', (() => {
    normaliseFacts(JSON.parse('{"entity":{"__proto__":{"pwned":1},"hipaa_role":"covered_entity"}}'));
    return ({}).pwned === undefined;
  })());
  ok('an enormous event.type does not hang the memo', (() => {
    const t0 = Date.now();
    buildMemo({}, {}, { as_of: '2026-01-01', event: { type: Array(5000).fill('x') } });
    return Date.now() - t0 < 20000;
  })());
}


// A PRECONDITION IS NOT A DEADLINE. 16 C.F.R. 313.4(a)(2) requires notice BEFORE any disclosure
// and is modelled as zero elapsed time, so the computed due date equals the trigger date. The
// table row therefore read "due 1 August" for a duty that had to be discharged by then, and an
// entity delivering notice that day after the disclosure would have read the row as satisfied.
{
  const corpus = load();
  const pre = corpus.byId.get('us.cfr.16.313.4.a2.initial_notice_consumer');
  const d = computeDeadline(pre, '2026-08-01', { via: 'explicit' });
  ok('a zero-elapsed duty computes to the trigger date', d.computed === '2026-08-01');
  ok('...and is flagged as a precondition', d.is_precondition === true);
  ok('...with a caution saying due BY, not ON', /PRECONDITION/.test(d.caution ?? ''));

  const normal = corpus.byId.get('ny.gbl.899_aa.2.notify_residents');
  const nd = computeDeadline(normal, '2026-08-01', { via: 'explicit' });
  ok('a real 30-day clock is NOT flagged a precondition', nd.is_precondition === false);
  // The SHIELD clock reads "without unreasonable delay, provided that such notification shall be
  // made within thirty days" — a promptness duty with a hard ceiling. The ceiling test only
  // matched "no later than", so the one provision the documentation leads with was the one whose
  // dual nature never reached the reader.
  ok('...and keeps its own dual-standard caution', /outer limit/i.test(nd.caution ?? ''));
  ok('...because a ceiling phrased "shall be made within" is still a ceiling',
     nd.is_outer_limit === true);
  // Guard against the broadened pattern firing where there is no promptness duty.
  const flat = computeDeadline(corpus.byId.get('ny.gbl.899_aa.9.hipaa_ag_notice'), '2026-08-01',
    { via: 'explicit' });
  ok('a flat clock with no promptness duty carries no dual-standard caution',
     !/DUAL standard/.test(flat.caution ?? ''));
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
