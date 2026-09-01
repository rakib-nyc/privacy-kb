// Deadline computation. Returns the computed date AND the governing language, because a
// date without its standard is misleading: "without unreasonable delay and in no case
// later than 60 days" is a promptness obligation with a ceiling, not a 60-day allowance.
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

export function computeDeadline(atom, triggerDateISO) {
  const d = atom.deadline;
  if (!d) return null;
  if (!triggerDateISO) {
    return { atom_id: atom.id, computed: null, trigger_event: d.trigger_event,
             governing_language: d.computation,
             note: `no date supplied for trigger "${d.trigger_event}" — deadline not computed` };
  }
  const start = new Date(triggerDateISO + 'T00:00:00Z');
  if (Number.isNaN(start.getTime()))
    return { atom_id: atom.id, computed: null, error: `unparseable trigger date ${triggerDateISO}` };

  let end = new Date(start);
  const { value, unit } = d.duration;
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
    atom_id: atom.id, citation: atom.source.citation,
    trigger_event: d.trigger_event, trigger_date: triggerDateISO,
    computed: end.toISOString().slice(0, 10),
    duration: `${value} ${unit}`,
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
