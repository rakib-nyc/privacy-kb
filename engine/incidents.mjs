// INCIDENT CHARACTERISATIONS — the legal descriptions a single set of facts can satisfy at once.
//
// WHY THIS IS A SET AND NOT AN ENUM. A New York hospital loses a laptop holding patient records.
// On those facts the incident is, simultaneously:
//
//   * a "breach of unsecured protected health information"   45 C.F.R. § 164.402
//   * a "breach of the security of the system"               N.Y. GBL § 899-aa(1)(c)
//   * possibly a "breach of security" under the FTC Health Breach Notification Rule
//   * possibly a "notification event" if a GLBA-covered affiliate is in scope
//
// Four statutes, four definitions, four clocks, one laptop. Modelling that as values of a single
// `event.type` enum made them mutually exclusive: a caller got the HIPAA duties or the SHIELD
// duty and never both, and `breachNotificationTimeline` reported `complete: true` while omitting
// a New York clock that fell a MONTH EARLIER than everything it did show.
//
// WHY FAMILIES. Once characterisations are a set, the engine can report the ones a caller has
// NOT asserted — but reporting all 26 would bury the four that matter. A lawyer who says "this
// is a HIPAA breach" needs to be asked about the other SECURITY-INCIDENT characterisations of
// the same event. They do not need to be asked whether the laptop was also a telemarketing sales
// offer. Family membership is what separates "an alternative description of these facts" from
// "a different event entirely", and it is the difference between a prompt that gets read and a
// list that gets skipped.
//
// WHAT THE ENGINE WILL NOT DO. It will not decide these. Whether an incident is a breach of
// unsecured PHI is the output of the documented four-factor risk assessment § 164.402(2)
// requires; whether it is a breach of the security of the system is a different test under
// § 899-aa(1)(c), which turns on unauthorised acquisition and has its own indicia. Deriving
// either from the facts would be the engine performing the analysis it exists to support, and
// getting it wrong in the confident direction. It asks; the lawyer answers.

/** Families group ALTERNATIVE LEGAL DESCRIPTIONS OF ONE EVENT. Crossing a family boundary means
 *  a different event, not a different label for the same one. */
export const INCIDENT_FAMILIES = {
  security_incident: 'unauthorised access to, or acquisition of, data — described differently by '
    + 'each regime that reaches it, with a different definition and a different clock in each',
  data_subject_request: 'an individual asking to see, move, correct or restrict their own data',
  dispute: 'a consumer disputing the accuracy of information held about them',
  compelled_disclosure: 'a demand for records from a court, agency or other legal process',
  employment_act: 'an act by an employer toward an employee or applicant',
  disclosure: 'a voluntary disclosure of personal information to a third party',
  marketing: 'an outbound sales or marketing contact',
  disposal: 'the destruction or discarding of consumer information',
  financial_crime: 'a report made under anti-money-laundering obligations',
  consumer_protection: 'conduct alleged to be deceptive or unfair',
  minors: 'a determination about a user who may be a minor',
};

/** key -> { label, family, definition } — `definition` names the test that decides it, because
 *  the whole point is that these are DETERMINATIONS, not observations. */
export const INCIDENTS = {
  // --- security_incident. Four regimes, four definitions, one set of facts.
  breach_of_unsecured_phi: {
    label: 'a breach of unsecured protected health information',
    family: 'security_incident',
    definition: '45 C.F.R. § 164.402. Presumed a breach unless a documented four-factor risk '
      + 'assessment shows a low probability that the PHI was compromised. The presumption runs '
      + 'AGAINST the covered entity, so silence is not a finding of no breach.' },
  breach_of_security_of_the_system: {
    label: 'a breach of the security of the system',
    family: 'security_incident',
    definition: 'N.Y. GBL § 899-aa(1)(c). Unauthorised ACQUISITION, or acquisition without valid '
      + 'authorisation, of computerised data compromising security, confidentiality or integrity. '
      + 'Access alone may not be acquisition; the statute lists indicia.' },
  breach_of_security: {
    label: 'a breach of security under the Health Breach Notification Rule',
    family: 'security_incident',
    definition: '16 C.F.R. § 318.2. Acquisition without the individual\'s authorisation, and the '
      + 'Rule reaches vendors of personal health records that HIPAA does not.' },
  notification_event: {
    label: 'a notification event under the GLBA Safeguards Rule',
    family: 'security_incident',
    definition: '16 C.F.R. § 314.2. Acquisition of unencrypted customer information without '
      + 'authorisation. The FTC duty is gated at 500 consumers; the event itself is not.' },

  // --- data_subject_request.
  consumer_data_access_request: {
    label: 'a consumer request for access to their financial data', family: 'data_subject_request' },
  consumer_file_disclosure_request: {
    label: 'a consumer request for their file from a consumer reporting agency',
    family: 'data_subject_request' },
  individual_accounting_request: {
    label: 'a request for an accounting of disclosures', family: 'data_subject_request' },
  individual_restriction_request: {
    label: 'a request to restrict disclosure of PHI paid for out of pocket',
    family: 'data_subject_request' },
  foia_request_received: {
    label: 'a Freedom of Information Act request', family: 'data_subject_request' },

  // --- dispute.
  consumer_dispute_received: {
    label: 'a consumer dispute received by a consumer reporting agency', family: 'dispute' },
  cra_dispute_notice_received: {
    label: 'a dispute notice received by a furnisher from a CRA', family: 'dispute' },
  frivolous_dispute_determination: {
    label: 'a determination that a dispute is frivolous or irrelevant', family: 'dispute' },

  // --- compelled_disclosure.
  lawful_process_received: {
    label: 'lawful process for stored communications', family: 'compelled_disclosure' },
  legal_proceeding_disclosure: {
    label: 'a disclosure in a legal proceeding', family: 'compelled_disclosure' },
  third_party_record_request: {
    label: 'a third-party request for substance use disorder records', family: 'compelled_disclosure' },
  section_702_acquisition: {
    label: 'an acquisition under FISA § 702', family: 'compelled_disclosure' },

  // --- employment_act.
  employee_medical_inquiry: {
    label: 'a medical inquiry or examination of an employee or applicant', family: 'employment_act' },
  lie_detector_test_proposed: {
    label: 'a proposed lie detector test', family: 'employment_act' },
  adverse_action_taken: {
    label: 'an adverse action based on a consumer report', family: 'employment_act' },
  internal_misconduct_report: {
    label: 'an internal report of misconduct', family: 'employment_act' },

  // --- the rest, each alone in its family because nothing else describes the same facts.
  disclosure_of_pii: { label: 'a disclosure of personally identifiable information', family: 'disclosure' },
  telemarketing_sales_offer: { label: 'a telemarketing sales offer', family: 'marketing' },
  disposal_of_consumer_information: { label: 'disposal of consumer information', family: 'disposal' },
  suspicious_transaction_reported: { label: 'a suspicious transaction report', family: 'financial_crime' },
  deceptive_act_or_practice: { label: 'a deceptive or unfair act or practice', family: 'consumer_protection' },
  user_determined_to_be_covered_user: { label: 'a user determined to be a covered user', family: 'minors' },
};

const own = (o, k) => (typeof k === 'string' && Object.hasOwn(o, k)) ? o[k] : undefined;

export const incidentMeta = key => own(INCIDENTS, key) ?? null;
export const incidentLabel = key => incidentMeta(key)?.label ?? String(key ?? 'unspecified');
export const incidentFamily = key => incidentMeta(key)?.family ?? null;

/** The families the caller's asserted characterisations belong to. */
export function assertedFamilies(asserted) {
  // Total on anything: callers pass event.type straight through, and that is caller-shaped input
  // which may be a scalar, null, or nonsense. A default covers `undefined` only.
  const list = Array.isArray(asserted) ? asserted : (asserted == null ? [] : [asserted]);
  return [...new Set(list.map(incidentFamily).filter(Boolean))];
}

/**
 * Is an unasserted characterisation an ALTERNATIVE DESCRIPTION of what the caller already
 * asserted, or a different event? Only the first is worth putting in front of a lawyer as a
 * decision; the second is noise that trains a reader to skip the section.
 */
export function isAlternativeCharacterisation(missing, asserted) {
  const fams = new Set(assertedFamilies(asserted));
  return incidentFamily(missing) !== null && fams.has(incidentFamily(missing));
}

export const INCIDENT_KEYS = Object.keys(INCIDENTS);
export const INCIDENT_FAMILY_KEYS = Object.keys(INCIDENT_FAMILIES);
