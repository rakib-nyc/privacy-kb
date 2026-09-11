import { isRealDate } from './dates.mjs';

// CONTROLLED VOCABULARY FOR DEADLINE TRIGGERS.
//
// WHAT THIS FIXES. `deadline.trigger_event` was free text. 35 records carried 30 distinct
// strings, and breach discovery alone was spelled four ways — "discovery of the breach",
// "discovery_of_breach", "discovery_of_breach_of_security", "discovery_of_notification_event".
// The engine resolved a trigger date by indexing the caller's event facts with that exact
// string (`context.event[a.deadline.trigger_event]`), so a caller had to guess the spelling of
// a phrase it could not see. mcp/server.mjs documented `{discovery_of_breach: "2026-08-01"}`
// while ny.gbl.899_aa.2.notify_residents stored "discovery of the breach"; a caller following
// the documented interface got `computed: null` and no explanation of why.
//
// The old code papered over that with `?? context.event?.date` — ONE date applied to every
// trigger in the corpus. That is the defect worth naming: it made `privacy-kb deadlines --from
// D` print a HIPAA access-request clock, a HIPAA amendment-request clock and a SHIELD Act
// breach clock all running from D, as though one incident were three unrelated events. A
// deadline engine that invents a trigger is worse than one that declines to compute, because
// the invented date looks exactly like a real one. The fallback is gone. Supply the trigger.
//
// FAMILIES EXIST BECAUSE ONE INCIDENT STARTS MANY CLOCKS. HIPAA's "discovery" (45 C.F.R.
// § 164.404(a)(2)), the FTC Health Breach Rule's "discovery of a breach of security"
// (16 C.F.R. § 318.3) and GLBA Safeguards' "discovery of a notification event" (16 C.F.R.
// § 314.4(j)) are three defined terms with three standards — they are NOT synonyms and must not
// be collapsed into one key. But they are usually satisfied by the same real-world moment, and
// requiring a lawyer to assert the same date four times under four names is how a clock gets
// missed. So each key declares a family, a caller may supply the family key once, and the
// result says the date arrived `via: "family"` rather than pretending it was asserted exactly.

/** The moment-kinds a single supplied date may legitimately fan out across. */
export const FAMILIES = {
  breach_discovery: 'the moment a security incident became known to the entity',
  rights_request: 'receipt of a data-subject request',
  opt_out: 'receipt of a request to stop contact',
  relationship: 'the formation or continuation of a customer relationship',
  disclosure: 'a disclosure of personal information to a third party',
  employment: 'an employment or hiring act',
  minors: 'an act relating to a user who may be a minor',
  legal_process: 'service of compulsory legal process',
  notice_cycle: 'a recurring notice obligation coming due',
  retention: 'the point at which data must be destroyed',
  breach_response: 'a step already taken in responding to a breach',
};

// key -> { label, family }. `label` is the human phrasing shown in output; the KEY is what a
// record stores and a caller supplies. Display prose and interface identity are different jobs
// and conflating them is what produced the four spellings.
export const TRIGGERS = {
  // --- breach_discovery. Four DIFFERENT statutory standards, one usual real-world moment.
  discovery_of_breach: {
    label: 'discovery of the breach', family: 'breach_discovery',
    standard: 'HIPAA and N.Y. GBL § 899-aa: the first day the breach is known, or by reasonable '
      + 'diligence would have been known. Not the day it occurred.' },
  discovery_of_breach_of_security: {
    label: 'discovery of the breach of security', family: 'breach_discovery',
    standard: 'FTC Health Breach Notification Rule, 16 C.F.R. § 318.3. "Breach of security" is '
      + 'the Rule\'s own defined term and is broader than a HIPAA breach.' },
  discovery_of_notification_event: {
    label: 'discovery of the notification event', family: 'breach_discovery',
    standard: 'GLBA Safeguards Rule, 16 C.F.R. § 314.4(j). "Notification event" is a defined '
      + 'term and is NOT the same as a breach; the 500-consumer threshold gates the duty.' },
  carrier_determination_of_cpni_breach: {
    label: 'reasonable determination by the carrier that a CPNI breach has occurred',
    family: 'breach_discovery',
    standard: '47 C.F.R. § 64.2011(b). The trigger is a REASONABLE DETERMINATION by the carrier, '
      + 'which is a different act from discovery and can fall later.' },

  // --- breach_response. Downstream of a breach, triggered by the entity's own prior step.
  notification_to_hhs_secretary: {
    label: 'notification to the Secretary of Health and Human Services', family: 'breach_response',
    standard: 'N.Y. GBL § 899-aa(9). The clock runs from NOTIFYING HHS, not from discovery — so '
      + 'it can start weeks after the breach clock and is routinely missed.' },

  // --- rights_request.
  receipt_of_access_request: {
    label: 'receipt of the access request', family: 'rights_request' },
  receipt_of_amendment_request: {
    label: 'receipt of the amendment request', family: 'rights_request' },
  receipt_of_privacy_act_amendment_request: {
    label: "receipt of an individual's request to amend a record", family: 'rights_request',
    standard: 'Privacy Act, 5 U.S.C. § 552a(d)(2)(A). Acknowledgment clock, distinct from the '
      + 'HIPAA amendment clock.' },
  receipt_of_accounting_request: {
    label: 'receipt of the request for an accounting of disclosures', family: 'rights_request',
    standard: '45 C.F.R. § 164.528(c)(1). Sixty calendar days from receipt, not thirty — the '
      + 'access clock at § 164.524 is the one that runs in thirty, and the two are routinely '
      + 'confused. One 30-day extension is available under § 164.528(c)(2) and must be earned '
      + 'with a written statement of the reason and the expected date.' },
  receipt_of_parental_inspection_request: {
    label: "the parent's request to inspect and review the student's education records",
    family: 'rights_request' },
  receipt_of_consumer_dispute: {
    label: 'receipt of the consumer dispute', family: 'rights_request' },
  determination_dispute_frivolous: {
    label: 'determination that the dispute is frivolous or irrelevant', family: 'rights_request',
    standard: 'FCRA § 1681i(a)(3)(B). Runs from the agency\'s own determination, not the dispute.' },

  // --- opt_out.
  receipt_of_opt_out_request: {
    label: "receipt of the recipient's request not to receive further commercial email",
    family: 'opt_out' },
  receipt_of_do_not_call_request: {
    label: 'receipt of a do-not-call request from a residential telephone subscriber',
    family: 'opt_out' },

  // --- relationship.
  establishment_of_customer_relationship: {
    label: 'establishment of the customer relationship', family: 'relationship' },
  continuation_of_customer_relationship: {
    label: 'continuation of the customer relationship', family: 'relationship' },
  entering_cable_service_agreement: {
    label: 'entering into an agreement to provide cable or other service', family: 'relationship' },

  // --- disclosure.
  disclosure_to_nonaffiliated_third_party: {
    label: 'disclosure of nonpublic personal information to a nonaffiliated third party',
    family: 'disclosure' },

  // --- employment.
  hiring_an_employee: { label: 'hiring an employee', family: 'employment' },
  use_of_aedt_on_candidate: {
    label: 'use of an AEDT on a candidate for employment', family: 'employment' },
  use_of_aedt_on_city_resident: {
    label: 'use of the tool to assess a candidate or employee residing in the city',
    family: 'employment' },
  most_recent_bias_audit: {
    label: 'the most recent bias audit of the AEDT', family: 'employment',
    standard: 'Runs BACKWARD from today: the audit must be no more than one year old, so this is '
      + 'a currency window rather than a duty clock.' },

  // --- minors.
  age_determination_attempt: {
    label: "an attempt to determine a covered user's age", family: 'minors' },
  parental_consent_attempt: {
    label: 'an attempt to obtain verifiable parental consent', family: 'minors' },
  covered_user_determination: {
    label: 'determining or being informed that a user is a covered user', family: 'minors' },

  // --- legal_process.
  service_of_search_warrant: {
    label: 'service of the search warrant by the Government authority', family: 'legal_process' },
  service_of_3405_notice: {
    label: 'service or mailing of the § 3405(2) notice on the customer', family: 'legal_process' },
  service_of_subpoena_on_customer: {
    label: 'service or mailing of the subpoena, summons, or formal written request on the customer',
    family: 'legal_process' },

  // --- notice_cycle / retention.
  school_year_start_or_policy_change: {
    label: 'the beginning of each school year, and any substantive change in the policies adopted '
      + 'under 20 U.S.C. § 1232h(c)(1)', family: 'notice_cycle' },
  information_no_longer_necessary: {
    label: 'the date the information is no longer necessary for the purpose for which it was collected',
    family: 'retention' },
};

// EVERY SPELLING THE CORPUS OR A CALLER HAS EVER USED, mapped to its canonical key. Kept
// deliberately: normalising the corpus does not reach callers, and an MCP client written against
// the old docstring must keep working rather than silently stop computing. Legacy input resolves
// and the result says it arrived `via: "alias"`.
export const ALIASES = {
  'discovery of the breach': 'discovery_of_breach',
  'discovery of breach': 'discovery_of_breach',
  'breach_discovered': 'discovery_of_breach',
  'notification to the secretary of health and human services': 'notification_to_hhs_secretary',
  "reasonable determination by the carrier that a breach of customers' cpni has occurred":
    'carrier_determination_of_cpni_breach',
  'receipt of the access request': 'receipt_of_access_request',
  'receipt of the amendment request': 'receipt_of_amendment_request',
  "receipt of an individual's request to amend a record": 'receipt_of_privacy_act_amendment_request',
  "the parent's request to inspect and review the student's education records":
    'receipt_of_parental_inspection_request',
  'receipt of the consumer dispute': 'receipt_of_consumer_dispute',
  'receipt of the request for an accounting of disclosures': 'receipt_of_accounting_request',
  'receipt of an accounting request': 'receipt_of_accounting_request',
  'determination that the dispute is frivolous or irrelevant': 'determination_dispute_frivolous',
  "receipt of the recipient's request not to receive further commercial email":
    'receipt_of_opt_out_request',
  'receipt of a do-not-call request from a residential telephone subscriber':
    'receipt_of_do_not_call_request',
  'establishment of the customer relationship': 'establishment_of_customer_relationship',
  'continuation of the customer relationship': 'continuation_of_customer_relationship',
  'entering into an agreement to provide cable or other service': 'entering_cable_service_agreement',
  'disclosure of nonpublic personal information to a nonaffiliated third party':
    'disclosure_to_nonaffiliated_third_party',
  'hiring an employee': 'hiring_an_employee',
  'use of an aedt on a candidate for employment': 'use_of_aedt_on_candidate',
  'use of the tool to assess a candidate or employee residing in the city':
    'use_of_aedt_on_city_resident',
  'the most recent bias audit of the aedt': 'most_recent_bias_audit',
  "an attempt to determine a covered user's age": 'age_determination_attempt',
  'an attempt to obtain verifiable parental consent': 'parental_consent_attempt',
  'determining or being informed that a user is a covered user': 'covered_user_determination',
  'service of the search warrant by the government authority': 'service_of_search_warrant',
  'service or mailing of the § 3405(2) notice on the customer': 'service_of_3405_notice',
  'service or mailing of the subpoena, summons, or formal written request on the customer':
    'service_of_subpoena_on_customer',
  ['the beginning of each school year, and any substantive change in the policies adopted under '
    + '20 u.s.c. § 1232h(c)(1)']: 'school_year_start_or_policy_change',
  'the date the information is no longer necessary for the purpose for which it was collected':
    'information_no_longer_necessary',
};

const squash = s => String(s).replace(/\s+/g, ' ').trim().toLowerCase();

// EVERY LOOKUP IS OWN-PROPERTY ONLY. `ALIASES[q]` walks the prototype chain, so a caller
// supplying the event key "constructor" got Object.prototype.constructor back — a truthy
// "canonical trigger" that is a function. It then satisfied the alias branch of
// resolveTriggerDate (returning a date for a trigger that does not exist) and made
// computeDeadline throw on `TRIGGERS[canon].family`, breaking the engine's totality guarantee
// on an input a caller controls. Only all-lowercase prototype names could reach it, because
// squash() lowercases first — which is exactly the kind of narrow, input-shaped hole that
// survives a test suite.
const own = (obj, k) => (typeof k === 'string' && Object.hasOwn(obj, k)) ? obj[k] : undefined;

/** Any spelling -> canonical key, or null if the vocabulary does not contain it. */
export function canonicalTrigger(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  if (own(TRIGGERS, s) !== undefined) return s;
  const q = squash(s);
  if (own(TRIGGERS, q) !== undefined) return q;
  const a = own(ALIASES, q);
  return typeof a === 'string' && own(TRIGGERS, a) !== undefined ? a : null;
}

/** The vocabulary entry for any spelling, or null. The ONLY way TRIGGERS should be indexed. */
export function triggerMeta(key) {
  const c = canonicalTrigger(key);
  return c ? TRIGGERS[c] : null;
}

/** Human phrasing for output. Falls back to the raw value so an unknown key still prints. */
export function triggerLabel(key) {
  return triggerMeta(key)?.label ?? String(key ?? 'unspecified');
}

export const triggerFamily = key => triggerMeta(key)?.family ?? null;

/**
 * Find the date for a record's trigger in the caller's event facts.
 *
 * Resolution order, most specific first — and the winning route is REPORTED, never hidden.
 * There is deliberately no catch-all: a date supplied under no recognised key does not start
 * a clock. `via` is one of 'exact' | 'alias' | 'family', and `supplied_as` is the key the
 * caller actually used, so a memo can show that a SHIELD clock started from a date the lawyer
 * asserted as a generic breach discovery rather than under § 899-aa's own standard.
 */
export function resolveTriggerDate(triggerEvent, eventFacts = {}) {
  const key = canonicalTrigger(triggerEvent);
  const miss = { date: null, via: null, supplied_as: null, canonical: key };
  if (!key || !eventFacts || typeof eventFacts !== 'object') return miss;

  // isRealDate, not a regex: '2026-02-30' is well-SHAPED and impossible, and every date sink
  // downstream of here either rolls it over silently or compares it as a string.
  const isDate = isRealDate;
  const factAt = k => (Object.hasOwn(eventFacts, k) ? eventFacts[k] : undefined);

  if (isDate(factAt(key))) return { date: eventFacts[key], via: 'exact', supplied_as: key, canonical: key };

  // A caller using a legacy spelling of THIS trigger.
  for (const [supplied, value] of Object.entries(eventFacts)) {
    if (!isDate(value)) continue;
    if (canonicalTrigger(supplied) === key && supplied !== key)
      return { date: value, via: 'alias', supplied_as: supplied, canonical: key };
  }

  // One incident, many clocks: a family key fans out to every trigger in that family.
  const fam = TRIGGERS[key].family;
  if (fam && isDate(factAt(fam)))
    return { date: eventFacts[fam], via: 'family', supplied_as: fam, canonical: key };

  return miss;
}

/** Every key a caller may legitimately supply. Used by the CLI's help and by gate 45. */
export const TRIGGER_KEYS = Object.keys(TRIGGERS);
export const FAMILY_KEYS = Object.keys(FAMILIES);
