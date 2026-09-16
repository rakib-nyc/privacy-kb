#!/usr/bin/env node
// Workflow tests. The property that matters most: an artifact failing its own checklist is
// returned WITH THE FAILURES MARKED and never presented as finished.
import { load } from '../engine/corpus.mjs';
import { privacyImpactAssessment, noticeGapAnalysis, rightsRequestHandling, breachNotificationTimeline, WORKFLOWS } from './index.mjs';
let fail = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fail++; };

const AS_OF = { as_of: '2026-08-19' };
ok('four workflows, one per the acquisition policy', Object.keys(WORKFLOWS).length === 4);

// every workflow ends with an enforcement section — non-optional
for (const [name, fn] of Object.entries(WORKFLOWS)) {
  const r = fn({ context: AS_OF, entity: {}, data: {}, incident: {}, requester: {} });
  ok(`${name}: carries an enforcement section`, !!r.enforcement && r.enforcement.required === true);
  ok(`${name}: enforcement names backstops`, (r.enforcement.backstops ?? []).length > 0);
  ok(`${name}: declares completeness explicitly`, typeof r.complete === 'boolean');
  ok(`${name}: an incomplete artifact carries a warning`, r.complete || !!r.warning);
  ok(`${name}: failed criteria are listed, not hidden`, Array.isArray(r.failed_criteria));
}

// an empty-input artifact must NOT claim completeness
{
  const r = privacyImpactAssessment({ context: AS_OF });
  ok('PIA with no system description is incomplete', r.complete === false);
  ok('...and says which criterion failed', r.failed_criteria.some(c => /system description/.test(c.criterion)));
}

// The state-layer check must answer "is the required DUTY satisfied", not "does this
// jurisdiction have records". US-NY once had three GBL § 349 UDAP atoms and no breach clock,
// and the presence test called that covered. It now has GBL § 899-aa, so the check must PASS
// for US-NY and still fail for a layer that genuinely lacks a notification duty.
{
  const r = breachNotificationTimeline({
    incident: { type: 'breach_of_security_of_the_system', consumers_affected: 600,
                'discovery of the breach': '2026-08-01', discovery_of_notification_event: '2026-08-01' },
    entity: { glba_financial_institution: true, owns_or_licenses_computerized_data: true },
    data: { includes_ny_private_information: true },
    context: { ...AS_OF, state_layers: ['US-NY'] } });
  const c = r.failed_criteria.find(x => /state notification regimes/.test(x.criterion));
  ok('US-NY now SATISFIES the state notification check, because SHIELD landed', !c);
  const ny = r.sections.find(s => /Notification regimes/.test(s.heading)).body.map(a => a.id);
  ok('...and the SHIELD breach duty is among the regimes engaged',
     ny.includes('ny.gbl.899_aa.2.notify_residents'), ny.join(', '));
}
{
  const r = breachNotificationTimeline({
    incident: { type: 'notification_event', consumers_affected: 600, discovery_of_notification_event: '2026-08-01' },
    entity: { glba_financial_institution: true }, context: { ...AS_OF, state_layers: ['US-CA'] } });
  ok('a state layer with no notification duty still makes the timeline INCOMPLETE', r.complete === false);
  const c = r.failed_criteria.find(x => /state notification regimes/.test(x.criterion));
  ok('...and explains that state clocks are often shorter', /shorter/.test(c?.detail ?? ''));
  ok('...and names the jurisdiction that is missing one', /US-CA/.test(c?.detail ?? ''));
  ok('...and says the gap is in the manifest, not merely the corpus',
     /gap is in the manifest/.test(c?.detail ?? ''), c?.detail?.slice(0, 90));
  ok('federal deadlines are still computed', r.sections.find(s => /Timeline/.test(s.heading)).body.length > 0);
}

// a well-formed federal-only breach timeline should complete
{
  const r = breachNotificationTimeline({
    incident: { type: 'notification_event', consumers_affected: 600, discovery_of_notification_event: '2026-08-01' },
    entity: { glba_financial_institution: true }, context: AS_OF });
  ok('a federal-only breach timeline completes', r.complete === true, r.failed_criteria.map(f => f.criterion).join('; '));
  ok('the earliest deadline is first', r.sections.find(s => /Timeline/.test(s.heading)).body[0].computed === '2026-08-31');
}

// the notice gap check must not overclaim
{
  const r = noticeGapAnalysis({ current_notice: 'We value your privacy.', entity: { is_coppa_operator: true },
    data: { service_directed_to_children: true }, context: AS_OF });
  const gaps = r.sections.find(s => /missing/i.test(s.heading)).body;
  ok('notice gaps are labelled a pointer, not a finding',
     gaps.length === 0 || gaps.every(g => /POINTER for review/.test(g.note)));
}

// rights requests surface deadline standards, not bare dates
{
  const r = rightsRequestHandling({ request_type: 'access', entity: { hipaa_role: 'covered_entity' }, context: AS_OF });
  ok('every deadline carries governing language',
     r.checklist.find(c => /governing language/.test(c.criterion)).passed);
}


// TOTALITY AT THE OUTERMOST SURFACE. All four destructured their options object in the parameter
// list, so every one threw a TypeError on null — the layer a caller touches first was the only
// layer with no totality test. Same class as computeDeadline and preemption.resolve(); found by
// red-teaming, fixed, and pinned here so it cannot come back.
for (const [name, fn] of Object.entries({ privacyImpactAssessment, noticeGapAnalysis,
                                          rightsRequestHandling, breachNotificationTimeline })) {
  for (const [label, a] of [['null', null], ['undefined', undefined], ['array', []],
                            ['string', 'x'], ['number', 7]]) {
    let threw = null, out = null;
    try { out = fn(a); } catch (e) { threw = String(e); }
    ok(`${name} is total on ${label}`, threw === null, threw ?? '');
    ok(`${name} on ${label} reports INCOMPLETE rather than a confident artifact`,
       threw !== null || out?.complete === false);
  }
}



// THE REGRESSION THIS SUITE EXISTED TO CATCH AND DID NOT.
//
// A New York hospital loses PHI. Characterised only as a HIPAA breach, the artifact used to
// report `complete: true`, no warning, and omit N.Y. GBL 899-aa(2) -- whose 30-day clock fell a
// MONTH EARLIER than every HIPAA date it printed. The completeness check asked whether the
// CORPUS carried New York's notify duty (it did, so it passed) while the event model kept that
// duty out of the ANSWER. Corpus coverage is not answer coverage.
{
  const base = {
    entity: { is_hipaa_covered_entity: true, hipaa_role: 'covered_entity',
      owns_or_licenses_computerized_data: true, within_ftc_jurisdiction: true,
      in_or_affecting_commerce: true, nexus: 'US-NY' },
    data: { is_phi: true, types: ['phi'], includes_ny_private_information: true },
    context: { as_of: '2026-09-10', state_layers: ['US-NY'] },
  };
  const one = WORKFLOWS.breachNotificationTimeline(
    { ...base, incident: { type: 'breach_of_unsecured_phi', breach_discovery: '2026-08-01' } });
  ok('a singly-characterised breach is NOT reported complete', one.complete === false);
  ok('...and says an unmade characterisation is hiding a clock',
     one.failed_criteria.some(c => /characterisation/i.test(c.criterion)));
  ok('...and carries the incomplete warning', /INCOMPLETE/.test(one.warning ?? ''));
  ok('...and shows the open characterisations as their own section',
     (one.sections.find(s => /Characterisations not yet made/.test(s.heading))?.body ?? []).length > 0);

  const both = WORKFLOWS.breachNotificationTimeline({ ...base,
    incident: { type: ['breach_of_unsecured_phi', 'breach_of_security_of_the_system'],
                breach_discovery: '2026-08-01' } });
  ok('characterised under both regimes, the artifact IS complete', both.complete === true,
     JSON.stringify(both.failed_criteria.map(c => c.criterion)));
  const tl = both.sections.find(s => /Timeline/.test(s.heading)).body;
  ok('...and the New York clock is present', tl.some(d => /899-aa\(2\)/.test(d.citation ?? '')));
  ok('...as the EARLIEST deadline', /899-aa\(2\)/.test(tl[0]?.citation ?? ''),
     `${tl[0]?.computed} ${tl[0]?.citation}`);
  ok('...and every row in a breach timeline actually has a clock',
     tl.every(d => !!d.computed),
     'rights-request clocks with computed:null used to be listed in a breach deliverable');

  // The discovery-date check must ask the ENGINE, not re-derive trigger keys it will go stale on.
  ok('a family-key discovery date satisfies the discovery check',
     !both.failed_criteria.some(c => /discovery date/.test(c.criterion)));
  const undated = WORKFLOWS.breachNotificationTimeline({ ...base,
    incident: { type: ['breach_of_unsecured_phi', 'breach_of_security_of_the_system'] } });
  ok('...and an undated incident still fails it',
     undated.failed_criteria.some(c => /discovery date/.test(c.criterion)));
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);