// Deadline computation. Returns the computed date AND the governing language, because a
// date without its standard is misleading: "without unreasonable delay and in no case
// later than 60 days" is a promptness obligation with a ceiling, not a 60-day allowance.
import { canonicalTrigger, triggerLabel, triggerMeta } from './triggers.mjs';
import { isRealDate, badDateReason } from './dates.mjs';

const DAY = 86400000;

/** Advance a date by a schema duration. Shared so a conditional extension cannot drift from
 *  the base computation — business days in particular are easy to reimplement subtly wrong. */
function addDuration(from, { value, unit }) {
  if (!from) return null;
  let d = new Date(from);
  if (unit === 'calendar_days') return new Date(d.getTime() + value * DAY);
  if (unit === 'months') { d.setUTCMonth(d.getUTCMonth() + value); return d; }
  if (unit === 'years') { d.setUTCFullYear(d.getUTCFullYear() + value); return d; }
  if (unit === 'hours') return new Date(d.getTime() + value * 3600000);
  if (unit === 'business_days') {
    let n = value;
    while (n > 0) { d = new Date(d.getTime() + DAY); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n--; }
    return d;
  }
  return null;
}

/**
 * @param atom            the record whose clock to compute
 * @param triggerDateISO  the date the trigger occurred, or null if it has not been asserted
 * @param resolution      how that date was found — the {via, supplied_as} object from
 *                        engine/triggers.mjs#resolveTriggerDate. Carried into the result rather
 *                        than dropped, because "this clock started from a date you asserted as a
 *                        generic breach discovery" and "this clock started from a date you
 *                        asserted under § 899-aa's own standard" are different claims, and a memo
 *                        that cannot tell them apart is overstating what it was told.
 */
export function computeDeadline(atom, triggerDateISO, resolution = null) {
  // TOTAL, LIKE analyze(). This threw a TypeError on any atom without source.citation, which is
  // fine for corpus records and wrong for a function the MCP layer calls with caller-shaped
  // input. The engine's stated property is that it never throws; one entry point was exempt from
  // it only because nothing had tested that entry point.
  if (!atom || typeof atom !== 'object')
    return { atom_id: null, computed: null, error: 'computeDeadline requires a record object' };
  const d = atom.deadline;
  if (!d) return null;
  if (!triggerDateISO) {
  // BUSINESS DAYS HERE MEAN WEEKDAYS. Public holidays are NOT excluded, so a clock crossing
  // Christmas or New Year lands EARLIER than the true statutory deadline. That direction is the
  // safe one, but an undeclared approximation in a deadline engine is still a wrong answer
  // wearing a precise face — so it is stated in the result rather than left in the code.

    // CLOCK NOT STARTED IS AN ANSWER, AND IT MUST NAME THE KEY THAT WOULD START IT. The old note
    // quoted the raw trigger string back at the caller, which was the one thing a caller could
    // not act on when the corpus spelled it "discovery of the breach" and the documented
    // interface said `discovery_of_breach`. It now names the canonical key and its family.
    const canon = canonicalTrigger(d.trigger_event);
    const fam = triggerMeta(d.trigger_event)?.family ?? null;
    return { atom_id: atom.id, citation: atom.source?.citation ?? null,
             computed: null, trigger_event: d.trigger_event,
             trigger_label: triggerLabel(d.trigger_event),
             trigger_key: canon, trigger_family: fam,
             governing_language: d.computation,
             clock_started: false,
             note: `CLOCK NOT STARTED — no date supplied for "${triggerLabel(d.trigger_event)}". `
                 + (canon
                     ? `Supply event.${canon} = "YYYY-MM-DD"`
                       + (fam ? `, or event.${fam} to date every ${fam} clock at once.` : '.')
                     : `This record's trigger is not in the controlled vocabulary, so no key can `
                       + `start it. That is a corpus defect, not a missing fact.`) };
  }
  // `new Date('2026-02-30T00:00:00Z')` is NOT NaN — JavaScript rolls it to 2 March. So the old
  // NaN test passed an impossible date straight through and this function returned a confident
  // deadline a month adrift, with no error and nothing to notice. In a clock engine that is the
  // worst form of this bug: the wrong date looks exactly like a right one.
  if (!isRealDate(triggerDateISO))
    return { atom_id: atom.id, citation: atom.source?.citation ?? null, computed: null,
             clock_started: false, error: badDateReason('trigger date', triggerDateISO) };
  const start = new Date(triggerDateISO + 'T00:00:00Z');

  let end = new Date(start);
  // A deadline block with no duration is malformed, not a zero-length clock. Destructuring it
  // threw, which the totality property test caught after the first fix only covered a missing
  // `source`. Partial fixes to a totality claim are how the claim stays false.
  if (!d.duration || typeof d.duration !== 'object')
    return { atom_id: atom.id ?? null, computed: null,
             error: 'deadline.duration is missing or not an object' };
  const { value, unit } = d.duration;
  if (typeof value !== 'number' || !Number.isFinite(value) || typeof unit !== 'string')
    return { atom_id: atom.id ?? null, computed: null,
             error: `deadline.duration must be {value:number, unit:string}; got ${JSON.stringify(d.duration)}` };
  if (unit === 'calendar_days') end = new Date(start.getTime() + value * DAY);
  else if (unit === 'hours') end = new Date(start.getTime() + value * 3600000);
  else if (unit === 'months') end.setUTCMonth(end.getUTCMonth() + value);
  else if (unit === 'years') end.setUTCFullYear(end.getUTCFullYear() + value);
  else if (unit === 'business_days') {
    let n = value;
    while (n > 0) { end = new Date(end.getTime() + DAY); const w = end.getUTCDay(); if (w !== 0 && w !== 6) n--; }
  } else return { atom_id: atom.id, computed: null, error: `unsupported unit ${unit}` };

  const ceilingOnly = /no case later than|no later than/i.test(d.computation);
  const promptness  = /without unreasonable delay|as soon as (possible|practicable)/i.test(d.computation);
  return {
    atom_id: atom.id, citation: atom.source?.citation ?? null,
    trigger_event: d.trigger_event, trigger_date: triggerDateISO,
    trigger_label: triggerLabel(d.trigger_event),
    trigger_key: canonicalTrigger(d.trigger_event),
    trigger_family: triggerMeta(d.trigger_event)?.family ?? null,
    clock_started: true,
    // HOW THE DATE WAS OBTAINED TRAVELS WITH THE DATE. 'exact' means the caller asserted this
    // trigger by name. 'family' means they asserted one moment (a breach discovery) and it was
    // applied to this statute's own differently-defined trigger — defensible, and the reader is
    // entitled to see that it happened rather than read a computed date as a direct assertion.
    trigger_via: resolution?.via ?? null,
    trigger_supplied_as: resolution?.supplied_as ?? null,
    trigger_inference_note: resolution?.via === 'family'
      ? `Dated from the "${resolution.supplied_as}" family key, not from an assertion about this `
        + `statute's own trigger. Confirm the two moments coincide before relying on the date.`
      : null,
    computed: end.toISOString().slice(0, 10),
    duration: `${value} ${unit}`,
    // THE APPROXIMATION IS STATED IN THE RESULT, NOT LEFT IN THE CODE. Business days here are
    // WEEKDAYS: public holidays are not excluded, so a clock crossing Christmas or New Year lands
    // EARLIER than the true statutory deadline. Earlier is the safe direction, but a deadline
    // engine returning a bare date implies a precision it does not have, and a caller cannot see
    // a comment. Only set where it bites.
    business_day_basis: unit === 'business_days'
      ? 'Weekdays only. Public holidays are NOT excluded, so this date may fall EARLIER than the '
        + 'true deadline. Treat it as conservative, and confirm against the applicable holiday '
        + 'calendar before relying on the last available day.'
      : null,
    governing_language: d.computation,
    is_outer_limit: ceilingOnly,
    also_requires_promptness: promptness,
    caution: promptness && ceilingOnly
      ? 'This is a DUAL standard. The computed date is an outer limit, not an allowance — delay short of it can still breach the promptness obligation.'
      : null,
    tolling: d.tolling ?? [],
    // A CONDITIONAL EXTENSION is not tolling and must not be shown as one date. FCRA
    // § 1681i(a)(1)(B) lets the 30 days become 45 IF the consumer supplies relevant information
    // inside the first 30 — and § 1681i(a)(1)(C) switches the extension off again once the item
    // is found inaccurate or unverifiable. Reporting only 30 understates the lawful outer bound;
    // reporting only 45 tells an agency it has time it has not earned. Both dates, each with the
    // condition that produces it.
    conditional_extensions: (d.tolling ?? [])
      .filter(t => t && t.extends_by)
      .map(t => {
        const ext = addDuration(end, t.extends_by);
        return { condition: t.condition ?? null, unless: t.unless ?? null,
                 authority: t.authority ?? null,
                 extends_by: `${t.extends_by.value} ${t.extends_by.unit}`,
                 maximum_if_met: ext ? ext.toISOString().slice(0, 10) : null,
                 note: 'AVAILABLE ONLY IF the condition holds. The base deadline governs unless and ' +
                       'until it does, and this is a ceiling rather than a default.' };
      }),
  };
}
