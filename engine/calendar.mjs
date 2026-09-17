// COMPUTED DEADLINES AS CALENDAR ENTRIES.
//
// A deadline that lives only in a memo is a deadline somebody has to remember to re-read. The
// clocks are already computed; this puts them where the work actually gets scheduled.
//
// TWO THINGS MAKE THIS MORE THAN A FORMAT CONVERSION.
//
// A clock that has NOT started is not an event, and inventing a date for it would be the exact
// defect the trigger vocabulary exists to prevent — one event date applied to every trigger
// produces a calendar full of confident, unrelated deadlines. Unstarted clocks are reported in the
// result and deliberately not written to the feed, with the count said out loud so their absence
// is a finding rather than a silence.
//
// And every entry carries its governing language and its source hash in the description, because a
// calendar reminder that says only "HIPAA deadline" is how a date gets acted on without anybody
// re-reading what the provision actually requires.
//
// RFC 5545 requires CRLF line endings and folding at 75 octets. Both are done here rather than
// hoped for: a feed that imports in one client and silently drops entries in another is worse than
// one that fails outright.
import { load } from './corpus.mjs';
import { analyze } from './applicability.mjs';
import { isRealDate, badDateReason } from './dates.mjs';
import { createHash } from 'node:crypto';

const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/** RFC 5545 text escaping: backslash, semicolon, comma and newline are structural. */
const escapeText = text => String(text ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
  .replace(/\r?\n/g, '\\n');

/**
 * Fold to 75 octets per RFC 5545, counting BYTES rather than characters.
 *
 * Section citations carry §, which is two bytes in UTF-8. Folding on string length lets a line
 * through at 75 characters and 80-odd octets, and a strict parser rejects the file.
 */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never split a multi-byte character: back off to a boundary.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74;                                    // continuation lines carry a leading space
  }
  return parts.join('\r\n ');
}

const stamp = date => String(date ?? '').replace(/-/g, '');

/**
 * Build the calendar model for a set of facts.
 *
 * Total on null at the outermost surface.
 */
export function calendar(entity, data, context, corpus, options) {
  const kb = corpus ?? load();
  entity = entity ?? {}; data = data ?? {}; context = context ?? {};
  const asOf = context.as_of ?? null;

  const empty = { as_of: asOf, entries: [], not_started: [], summary: null, error: null };
  if (!asOf) return { ...empty, error: 'an as-of date is required — there is no "current law"' };
  if (!isRealDate(asOf)) return { ...empty, error: badDateReason('as_of', asOf) };

  const result = analyze(entity, data, context);
  if (result.error) return { ...empty, error: result.error };

  const entries = [], notStarted = [];
  for (const clock of (result.deadlines ?? [])) {
    const row = {
      atom_id: clock.atom_id,
      citation: clock.citation ?? null,
      due: clock.computed ?? null,
      trigger: clock.trigger_event ?? null,
      trigger_label: clock.trigger_label ?? null,
      trigger_date: clock.trigger_date ?? null,
      duration: clock.duration ?? null,
      governing_language: norm(clock.governing_language) || null,
      is_outer_limit: clock.is_outer_limit ?? null,
      also_requires_promptness: clock.also_requires_promptness ?? null,
      source_url: kb.byId?.get(clock.atom_id)?.source?.url ?? null,
      source_sha256: kb.byId?.get(clock.atom_id)?.source?.raw_sha256 ?? null,
    };
    if (row.due) entries.push(row);
    else notStarted.push({ ...row,
      why: clock.trigger_event
        ? `the clock hangs off "${clock.trigger_event}" and no date was supplied for that event`
        : 'this obligation carries no fixed period' });
  }
  entries.sort((left, right) => String(left.due).localeCompare(String(right.due))
    || String(left.citation ?? '').localeCompare(String(right.citation ?? '')));

  return {
    as_of: asOf,
    entries,
    not_started: notStarted,
    summary: {
      scheduled: entries.length,
      // NOT AN ERROR, AND NOT NOTHING. A clock with no trigger date is real work that cannot be
      // dated yet, and a calendar that silently omits it looks like a complete schedule.
      not_started: notStarted.length,
      earliest: entries[0]?.due ?? null,
      latest: entries.length ? entries[entries.length - 1].due : null,
      outer_limits_requiring_promptness:
        entries.filter(row => row.also_requires_promptness).length,
    },
    error: null,
    caveat:
      'ONLY CLOCKS THAT HAVE STARTED ARE WRITTEN TO THE FEED. An obligation whose trigger has no '
      + 'date is listed separately and deliberately given no calendar entry, because inventing one '
      + 'would put a confident date on an event that has not happened. Several periods are OUTER '
      + 'LIMITS that also require promptness — the date in the calendar is the last lawful day, not '
      + 'the target. Business days are counted as weekdays and public holidays are not excluded, so '
      + 'confirm any deadline that crosses one.',
  };
}

/**
 * Render as RFC 5545. `dtstamp` is an input so the same analysis produces the same bytes; left to
 * the wall clock, two exports of an unchanged schedule differ and cannot be diffed.
 */
export function calendarIcs(built, options) {
  built = built ?? {};
  if (built.error) return null;
  const dtstamp = norm(options?.dtstamp) || `${stamp(built.as_of)}T000000Z`;
  const name = norm(options?.name) || 'Privacy-KB deadlines';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Privacy-KB//deadline export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];

  for (const row of (built.entries ?? [])) {
    // A stable UID from the obligation and its due date, so re-importing an unchanged schedule
    // updates the same entries instead of duplicating them.
    const uid = createHash('sha256')
      .update(`${row.atom_id}|${row.due}|${row.trigger_date ?? ''}`, 'utf8')
      .digest('hex').slice(0, 32);
    const summary = `${row.citation ?? row.atom_id}`
      + (row.also_requires_promptness ? ' — outer limit, promptness also required' : '');
    const described = [
      row.governing_language ? `Governing language: ${row.governing_language}` : null,
      row.trigger_label ? `Trigger: ${row.trigger_label}`
        + (row.trigger_date ? ` on ${row.trigger_date}` : '') : null,
      row.duration ? `Period: ${row.duration}` : null,
      row.also_requires_promptness
        ? 'This is the LAST LAWFUL DAY, not the target: the provision also requires promptness.'
        : null,
      row.source_url ? `Source: ${row.source_url}` : null,
      row.source_sha256 ? `sha256: ${row.source_sha256}` : null,
      'Research prototype. Not legal advice. Verify against the primary source.',
    ].filter(Boolean).join('\n');

    lines.push('BEGIN:VEVENT',
      `UID:${uid}@privacy-kb`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${stamp(row.due)}`,
      `DTEND;VALUE=DATE:${stamp(row.due)}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(described)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
