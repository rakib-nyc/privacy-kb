// WHEN SEVERAL REGIMES REACH THE SAME EVENT, WHICH DUTY ACTUALLY BINDS?
//
// One laptop is a breach of unsecured PHI under 45 C.F.R. § 164.402 and a breach of the security
// of the system under N.Y. Gen. Bus. Law § 899-aa(1)(c). Both sets of duties run. Six obligations
// in this corpus hang off `discovery_of_breach` alone, carrying 30-day and 60-day periods, and the
// operational question is not "what does each one say" — the analysis already answers that — it is
// "which date do we actually have to hit, and what happens to the others."
//
// THE STRICTEST PERIOD BINDS, AND THAT IS NOT THE SAME AS THE OTHERS GOING AWAY. A 30-day duty
// beside a 60-day duty means the work lands at 30 days; it does not mean the 60-day obligation was
// satisfied, discharged, or preempted. Reporting only the earliest date is how a register loses
// five duties, so every overlapping duty is listed with the margin between it and the binding one.
//
// WHAT THIS WILL NOT DO. It will not compare periods across different units without saying so, and
// it will not rank two duties whose triggers merely sound alike. Grouping is by the CONTROLLED
// trigger key, never by label similarity: `discovery_of_breach` and
// `discovery_of_breach_of_security` are different keys because they are different legal events,
// and collapsing them would manufacture a conflict that does not exist.
import { load } from './corpus.mjs';
import { analyze } from './applicability.mjs';
import { triggerLabel } from './triggers.mjs';
import { isRealDate, badDateReason } from './dates.mjs';

const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();

// Units reduced to days so periods can be ordered. `business_days` is deliberately NOT converted:
// five business days is between seven and nine calendar days depending on where it starts, and a
// comparison that pretends otherwise is wrong in the direction that loses a deadline.
const DAYS = { calendar_days: 1, days: 1, months: 30, years: 365 };

/**
 * A duration on a computed deadline is a STRING — "60 calendar_days" — not {value, unit}. Reading
 * it as an object returned undefined for every period, so every group looked comparable-to-nothing
 * and the analysis reported no overlaps at all over a fact pattern with eight live clocks.
 */
function parseDuration(duration) {
  if (duration && typeof duration === 'object' && typeof duration.value === 'number')
    return { value: duration.value, unit: String(duration.unit ?? '') };
  const hit = /^\s*(\d+(?:\.\d+)?)\s+([a-z_]+)\s*$/i.exec(String(duration ?? ''));
  return hit ? { value: Number(hit[1]), unit: hit[2] } : null;
}

function comparable(duration) {
  const parsed = parseDuration(duration);
  if (!parsed) return null;
  if (parsed.unit === 'business_days') return null;
  const factor = DAYS[parsed.unit];
  return factor ? parsed.value * factor : null;
}

const describe = duration => {
  const parsed = parseDuration(duration);
  return parsed ? `${parsed.value} ${parsed.unit.replace(/_/g, ' ')}` : 'no fixed period';
};

/**
 * Group the obligations that apply by the trigger they hang off, and report which binds.
 *
 * Total on null at the outermost surface.
 */
export function overlaps(entity, data, context, corpus) {
  const kb = corpus ?? load();
  entity = entity ?? {}; data = data ?? {}; context = context ?? {};
  const asOf = context.as_of ?? null;

  const empty = { as_of: asOf, groups: [], summary: null, error: null };
  if (!asOf) return { ...empty, error: 'an as-of date is required — there is no "current law"' };
  if (!isRealDate(asOf)) return { ...empty, error: badDateReason('as_of', asOf) };

  const result = analyze(entity, data, context);
  if (result.error) return { ...empty, error: result.error };

  // READ THE COMPUTED DEADLINES, NOT THE OBLIGATION PROJECTION. result.obligations carries id,
  // citation, obligation_type, summary, verbatim_span and operative_context — and no deadline at
  // all. Grouping over it found a trigger on nothing.
  const byTrigger = new Map();
  for (const clock of (result.deadlines ?? [])) {
    const key = clock.trigger_event;
    if (!key) continue;
    if (!byTrigger.has(key)) byTrigger.set(key, []);
    byTrigger.get(key).push(clock);
  }

  const groups = [];
  for (const [key, records] of [...byTrigger.entries()].sort()) {
    if (records.length < 2) continue;                       // one duty is not an overlap

    const duties = records.map(clock => ({
      atom_id: clock.atom_id,
      citation: clock.citation ?? null,
      instrument_id: kb.byId?.get(clock.atom_id)?.source?.instrument_id ?? null,
      duration: clock.duration ?? null,
      period: describe(clock.duration),
      days: comparable(clock.duration),
      due: clock.computed ?? null,
      clock_started: clock.clock_started ?? null,
      governing_language: norm(clock.governing_language).slice(0, 200) || null,
      also_requires_promptness: clock.also_requires_promptness ?? null,
    })).sort((left, right) => (left.days ?? Infinity) - (right.days ?? Infinity));

    const ranked = duties.filter(duty => duty.days !== null);
    const unranked = duties.filter(duty => duty.days === null);
    const binding = ranked[0] ?? null;

    // A margin is only meaningful against a duty measured in the same kind of unit.
    for (const duty of duties)
      duty.margin_days = (binding && duty.days !== null) ? duty.days - binding.days : null;

    const distinct = [...new Set(ranked.map(duty => duty.days))];
    groups.push({
      trigger: key,
      trigger_label: triggerLabel(key) ?? key,
      duties,
      binding,
      spread_days: distinct.length > 1 ? Math.max(...distinct) - Math.min(...distinct) : 0,
      incomparable: unranked.map(duty => ({ atom_id: duty.atom_id, citation: duty.citation,
        period: duty.period,
        why: parseDuration(duty.duration)?.unit === 'business_days'
          ? 'measured in business days, which is between seven and nine calendar days depending on '
            + 'where it starts — not ordered against calendar periods here, because guessing the '
            + 'conversion loses deadlines in the dangerous direction'
          : 'no comparable period on the record' })),
      note: distinct.length > 1
        ? `The shortest period binds the work. It does NOT discharge the others: every duty here `
          + `still runs, and satisfying the ${binding.period} obligation does not satisfy a `
          + `separate notice owed to a different recipient.`
        : 'Every comparable duty on this trigger carries the same period.',
    });
  }

  const conflicted = groups.filter(group => group.spread_days > 0);
  return {
    as_of: asOf,
    groups,
    summary: {
      triggers_with_overlap: groups.length,
      triggers_with_differing_periods: conflicted.length,
      tightest_margin_days: conflicted.length
        ? Math.min(...conflicted.map(group => group.spread_days)) : null,
      duties_measured_in_business_days:
        groups.reduce((total, group) => total + group.incomparable.length, 0),
    },
    error: null,
    caveat:
      'THE SHORTEST PERIOD BINDS THE WORK; IT DOES NOT DISCHARGE THE OTHERS. Each overlapping duty '
      + 'is listed because meeting the earliest one satisfies that one and no other — a notice to a '
      + 'regulator is not a notice to an individual. Business-day periods are reported but never '
      + 'ordered against calendar periods, because the conversion depends on the start date and a '
      + 'wrong guess loses a deadline rather than gaining one. Grouping is by controlled trigger '
      + 'key, so two duties that merely sound related are never reported as a conflict.',
  };
}

/** Render an overlap analysis. */
export function overlapMarkdown(built, title) {
  built = built ?? {};
  const lines = [];
  lines.push(`# Overlapping duties — ${title ?? 'these facts'}`);
  lines.push('');
  if (built.error) { lines.push(`**Refused:** ${built.error}`); return lines.join('\n'); }

  const sum = built.summary ?? {};
  lines.push(`As of **${built.as_of}** · ${sum.triggers_with_overlap} trigger(s) carry more than `
    + `one duty · ${sum.triggers_with_differing_periods} where the periods differ`);
  lines.push('');

  if (!(built.groups ?? []).length) {
    lines.push('No trigger in this answer carries more than one obligation.');
    return lines.join('\n');
  }

  for (const group of (built.groups ?? [])) {
    lines.push(`## ${group.trigger_label}`);
    lines.push('');
    lines.push(`\`${group.trigger}\` · ${group.duties.length} duties`
      + (group.spread_days ? ` · ${group.spread_days} days between the shortest and the longest` : ''));
    lines.push('');
    lines.push('| | Citation | Period | Margin |');
    lines.push('|---|---|---|---|');
    for (const duty of group.duties) {
      const mark = duty.atom_id === group.binding?.atom_id ? '**binds**' : '';
      const margin = duty.margin_days === null ? '—'
        : duty.margin_days === 0 ? 'same' : `+${duty.margin_days}d`;
      lines.push(`| ${mark} | \`${duty.citation ?? duty.atom_id}\` | ${duty.period} | ${margin} |`);
    }
    lines.push('');
    lines.push(`> ${group.note}`);
    lines.push('');
    for (const entry of group.incomparable)
      lines.push(`- \`${entry.citation ?? entry.atom_id}\` (${entry.period}) — ${entry.why}`);
    if (group.incomparable.length) lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(built.caveat ?? '');
  return lines.join('\n');
}
