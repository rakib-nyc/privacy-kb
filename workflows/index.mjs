// lifecycle-indexed deliverable workflows. the acquisition policy.
//
// Each workflow is a TEMPLATE plus a CHECKLIST derived from the engine result. The model
// drafts prose; the checklist is verified in code before the artifact is returned. An
// artifact that fails its own checklist is NEVER returned as if it passed — it is returned
// with the failures marked, because a compliance deliverable that looks finished and is not
// is worse than an obviously incomplete one.
//
// Every workflow output ends with an enforcement section: who enforces, penalty exposure,
// private right of action. That is what makes the output read as legal-domain-literate rather than
// generic, and it is non-optional.
import { analyze } from '../engine/applicability.mjs';
import { load } from '../engine/corpus.mjs';
import { suppliesDuty } from '../engine/coverage.mjs';
import { triggerFamily } from '../engine/triggers.mjs';
import { incidentLabel } from '../engine/incidents.mjs';

const enforcementSection = (result) => ({
  heading: 'Enforcement exposure',
  required: true,
  enforcers: result.enforcement_summary,
  private_right_of_action: result.enforcement_summary.some(e => e.private_right_of_action),
  note: result.enforcement_summary.some(e => e.private_right_of_action)
    ? 'A private right of action runs alongside regulatory enforcement here. That usually drives more real ' +
      'exposure than penalty size does.'
    : 'No private right of action among the applicable obligations. Consumers reach this conduct through ' +
      'state UDAP and the entity\'s own published notice — see backstops.',
  backstops: result.backstops,
});

function check(name, cond, detail) { return { criterion: name, passed: !!cond, detail: detail ?? null }; }

function finish(id, lifecycle, title, sections, checklist, result) {
  const failed = checklist.filter(c => !c.passed);
  return {
    workflow_id: id, lifecycle_stage: lifecycle, title,
    as_of: result.as_of,
    complete: failed.length === 0,
    sections,
    enforcement: enforcementSection(result),
    checklist,
    failed_criteria: failed,
    warning: failed.length
      ? `THIS ARTIFACT IS INCOMPLETE. ${failed.length} required criterion/criteria did not pass. It is ` +
        `returned with the failures marked rather than withheld, and it must not be presented as a finished ` +
        `deliverable until they are resolved.`
      : null,
    coverage_gaps: result.coverage_gaps,
    unknown_facts: result.unknown_facts,
    unverified_excluded: result.unverified_excluded,
  };
}

/** lifecycle III — Assessing Data. Privacy impact assessment. */
// TOTALITY AT THE OUTERMOST SURFACE. These four take a single options object and destructured
// it in the parameter list, which throws on null — a default covers undefined only. They are
// the layer a caller touches first, and a null argument is a caller mistake that should
// produce an INCOMPLETE artifact saying so, exactly as an empty one already does, rather than
// a stack trace. Same non-totality found in computeDeadline and preemption.resolve().
const arg = a => (a && typeof a === 'object' && !Array.isArray(a)) ? a : {};

export function privacyImpactAssessment(_input) {
  const { system_description, data_flows = [], entity = {}, data = {}, context = {} } = arg(_input);
  const r = analyze(entity, data, context);
  const sections = [
    { heading: 'System under assessment', body: system_description ?? null },
    { heading: 'Data flows', body: data_flows },
    { heading: 'Applicable obligations', body: r.obligations },
    { heading: 'Exemptions applied', body: r.exempt },
    { heading: 'Preemption posture', body: r.preemption_notes },
    { heading: 'Deadlines triggered', body: r.deadlines },
  ];
  const checklist = [
    check('a system description was supplied', !!system_description, 'A PIA over an undescribed system assesses nothing.'),
    check('at least one data flow was supplied', data_flows.length > 0),
    check('as_of was supplied', !!r.as_of),
    check('every obligation cited carries a verbatim span', r.obligations.every(o => !!o.verbatim_span)),
    check('every nested obligation carries its operative context',
      r.obligations.every(o => !o.operative_context || Array.isArray(o.operative_context))),
    check('backstops are present', r.backstops.length > 0),
    check('coverage gaps are surfaced rather than hidden', Array.isArray(r.coverage_gaps)),
    check('no undetermined facts remain', r.unknown_facts.length === 0,
      r.unknown_facts.length ? `${r.unknown_facts.length} predicate(s) could not be resolved from the supplied facts.` : null),
  ];
  return finish('wf.pia', 'III', 'Privacy impact assessment', sections, checklist, r);
}

/** lifecycle IV — Protecting. Privacy notice gap analysis. */
export function noticeGapAnalysis(_input) {
  const { current_notice = '', entity = {}, data = {}, context = {} } = arg(_input);
  const r = analyze(entity, data, context);
  const disclosureAtoms = r.obligations.filter(o => ['disclose', 'notify'].includes(o.obligation_type));
  const missing = disclosureAtoms.filter(o => {
    const key = (o.summary ?? '').toLowerCase().split(/\s+/).filter(w => w.length > 6).slice(0, 3);
    return !key.some(k => current_notice.toLowerCase().includes(k));
  });
  const sections = [
    { heading: 'Disclosure obligations in force', body: disclosureAtoms },
    { heading: 'Apparently missing from the current notice', body: missing.map(m => ({
        atom_id: m.id, citation: m.citation, summary: m.summary,
        note: 'Flagged by keyword absence. This is a POINTER for review, not a finding — the check is lexical, not semantic.' })) },
    { heading: 'Published-notice commitments as an independent constraint',
      body: r.backstops.find(b => b.kind === 'published_notice_commitments') },
  ];
  const checklist = [
    check('a current notice was supplied', current_notice.length > 0),
    check('as_of was supplied', !!r.as_of),
    check('at least one disclosure obligation was assessed', disclosureAtoms.length > 0,
      disclosureAtoms.length ? null : 'No disclosure or notification obligation matched. Check the facts before concluding the notice is adequate.'),
    check('the gap list is marked as lexical rather than semantic', true),
    check('backstops are present', r.backstops.length > 0),
  ];
  return finish('wf.notice_gap', 'IV', 'Privacy notice gap analysis', sections, checklist, r);
}

/** lifecycle VI — Responding to requests. */
export function rightsRequestHandling(_input) {
  const { request_type, requester = {}, entity = {}, data = {}, context = {} } = arg(_input);
  const r = analyze(entity, data, context);
  const rights = r.obligations.filter(o => ['disclose', 'delete', 'obtain_consent'].includes(o.obligation_type));
  const sections = [
    { heading: 'Request', body: { request_type, requester } },
    { heading: 'Obligations engaged', body: rights },
    { heading: 'Deadlines', body: r.deadlines },
    { heading: 'Exemptions to assess', body: r.exempt },
  ];
  const checklist = [
    check('a request type was supplied', !!request_type),
    check('as_of was supplied', !!r.as_of),
    check('every deadline states its governing language, not just a date',
      r.deadlines.every(d => !!d.governing_language)),
    check('dual-standard deadlines are flagged as outer limits',
      r.deadlines.filter(d => d.also_requires_promptness).every(d => !!d.caution)),
    check('exemption types are stated, not merely listed',
      r.exempt.every(e => e.level != null)),
    check('backstops are present', r.backstops.length > 0),
  ];
  return finish('wf.rights_request', 'VI', 'Rights request handling', sections, checklist, r);
}

/** lifecycle VI — Responding to incidents. Multi-regime breach notification timeline. */
export function breachNotificationTimeline(_input) {
  const { incident = {}, entity = {}, data = {}, context = {} } = arg(_input);
  const ctx = { ...context, event: { ...(context.event ?? {}), ...incident } };
  const r = analyze(entity, data, ctx);
  const notifyAtoms = r.obligations.filter(o => o.obligation_type === 'notify');
  // ONLY THE CLOCKS THIS INCIDENT STARTS. r.deadlines carries every engaged obligation's clock,
  // so a HIPAA breach timeline was listing the § 164.524 access-request and § 164.526
  // amendment-request clocks — both with `computed: null`, because no one had made an access
  // request. Two uncomputable rows in a deliverable about a breach, which is how a reader learns
  // to stop reading the timeline. Trigger family is the right filter: breach_discovery starts
  // the clocks, breach_response holds the ones a notification itself starts (§ 899-aa(9)).
  const INCIDENT_FAMILIES = new Set(['breach_discovery', 'breach_response']);
  const timeline = r.deadlines
    .filter(d => INCIDENT_FAMILIES.has(d.trigger_family ?? triggerFamily(d.trigger_event)))
    .sort((a, b) => String(a.computed ?? '9999').localeCompare(String(b.computed ?? '9999')));
  // The decisions that are not made yet, and would add clocks if they were.
  const openCharacterisations = (r.characterisation_required ?? []).filter(c => c.alternative_description);
  const sections = [
    { heading: 'Incident facts', body: incident },
    { heading: 'Notification regimes engaged', body: notifyAtoms },
    { heading: 'Timeline, earliest deadline first', body: timeline },
    { heading: 'Characterisations not yet made — each would add a clock', body: openCharacterisations },
    { heading: 'Preemption — do state duties run in parallel?', body: r.preemption_notes },
  ];
  const c = load();
  const stateLayers = context.state_layers ?? [];
  const checklist = [
    check('as_of was supplied', !!r.as_of),
    // ASK THE ENGINE, DO NOT RE-DERIVE. This listed the trigger keys it knew about and went
    // stale the moment the controlled vocabulary added the `breach_discovery` FAMILY key: a
    // caller dating the incident correctly was told they had supplied no discovery date. A
    // checklist that reimplements what the engine already computed will drift from it.
    check('a discovery date was supplied', timeline.some(d => d.clock_started),
      'Every breach clock in the corpus runs from DISCOVERY, not from the breach. Supply '
      + 'event.breach_discovery, or a specific trigger key — see privacy_triggers.'),
    check('at least one notification regime was identified', notifyAtoms.length > 0),
    check('every deadline carries its governing language', timeline.every(d => !!d.governing_language)),
    // THE CHECK THAT WAS MISSING, AND THE REASON THIS FILE NEEDED REWRITING. The old completeness
    // test asked whether the CORPUS carried a jurisdiction's notify duty. It did — and the duty
    // was still absent from the ANSWER, because the incident had been characterised one way and
    // § 899-aa demands another. So the artifact reported `complete: true` while omitting a New
    // York clock that fell a month before every date it printed. Corpus coverage is not answer
    // coverage, and only a check on the answer can see the difference.
    check('no unmade characterisation is hiding a clock', openCharacterisations.length === 0,
      openCharacterisations.length
        ? 'THE TIMELINE IS INCOMPLETE. On these same facts, ' + openCharacterisations.length +
          ' further obligation(s) attach if the incident is also characterised as ' +
          [...new Set(openCharacterisations.flatMap(c => c.requires_characterisation))]
            .map(incidentLabel).join('; ') + '. ' +
          (openCharacterisations.some(c => c.deadline_if_engaged)
            ? 'At least one carries its own clock. '
            : '') +
          'That characterisation is a legal determination with its own test — assert it, or ' +
          'record why it does not hold. It must not be left unanswered in a deliverable.'
        : null),
    check('the earliest deadline is identified', timeline.length > 0 && !!timeline[0]?.computed),
    check('floor-preemption regimes are flagged as running in parallel',
      r.preemption_notes.filter(p => p.posture === 'floor').every(p => /parallel/.test(p.note ?? ''))),
    // The question is not "does this jurisdiction appear in the corpus" — it is "does the
    // corpus carry that jurisdiction's NOTIFICATION duty". New York broke the weaker version:
    // three GBL § 349 UDAP atoms landed and satisfied a presence test, so a breach timeline
    // would have declared itself complete while silently omitting GBL § 899-aa, whose clock is
    // the whole reason a practitioner asked for the state layer. Coverage of a jurisdiction is
    // not coverage of a duty.
    // Shares engine/coverage.mjs with the engine's own gap computation, so the two cannot
    // drift into disagreeing about what "covered" means.
    (() => {
      const short = stateLayers.map(j => [j, suppliesDuty(j, 'notify', c)]).filter(([, s]) => !s.have);
      return check('state notification regimes were assessed, or their absence is reported',
        short.length === 0,
        short.length
          ? 'The timeline is INCOMPLETE — state breach clocks are frequently shorter than federal ones ' +
            'and would govern in practice. ' + short.map(([, s]) => s.note).join(' ')
          : null);
    })(),
  ];
  return finish('wf.breach_timeline', 'VI', 'Multi-regime breach notification timeline', sections, checklist, r);
}

export const WORKFLOWS = { privacyImpactAssessment, noticeGapAnalysis, rightsRequestHandling, breachNotificationTimeline };
