// ONE DATE CHECK, SHARED BY EVERYTHING THAT COMPARES OR ADVANCES A DATE.
//
// EVERY DATE COMPARISON IN THIS ENGINE IS A STRING COMPARISON. That is correct and fast for
// well-formed ISO dates and silently wrong for anything else: 'not-a-date' sorts above every
// date beginning with a digit, so a malformed value does not fail — it makes `effective_from >
// as_of` false for every record and reports the entire corpus as in force. A typo WIDENS the
// answer instead of failing it, which is the confident-wrong direction this system exists to
// refuse.
//
// The same shape appeared four separate times, each in a different entry point, each found only
// by fuzzing rather than by reading:
//
//   * analyze()             — guarded, and documented at length, because it was found there first.
//   * privacy_obligations   — checked that as_of was PRESENT, never that it was a date. A typo
//                             returned the whole instrument, including law not yet in force.
//   * privacy_diff          — 'not-a-date' as to_date reported 30 provisions coming into force
//                             where the true answer was 20, because everything sorted below it.
//   * computeDeadline       — accepted 2026-02-30, which JavaScript silently rolls to 2 March,
//                             and returned a deadline a month adrift with no error. In a clock
//                             engine that is the worst version of this bug.
//
// A regex is not enough on its own: '2026-02-30' and '2026-13-01' are well-SHAPED and impossible,
// and `new Date()` accepts both by rolling them over. The round-trip through UTC is what catches
// them.
//
// This lives in its own module rather than in corpus.mjs so that timeline.mjs — which is pure
// arithmetic and reads no files — can use it without pulling in the filesystem.

/** True only for a real calendar date written exactly as YYYY-MM-DD. */
export function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** The refusal message, written once so every entry point refuses for the same stated reason. */
export const badDateReason = (field, value) =>
  `${field} must be a real calendar date as YYYY-MM-DD. Received ${JSON.stringify(value)}. ` +
  `Date comparisons here are string comparisons, so a malformed value does not fail — it sorts ` +
  `above every real date and widens the answer instead of refusing it.`;

/**
 * The effective_from bases that CANNOT carry an as-of comparison.
 *
 * `api_snapshot` is the date the source API's payload was captured — an OpenLegislation activeDate
 * — and `undetermined` is not traceable to anything this repository holds. Neither says when the
 * law began, and 107 records in the answering corpus carry one.
 *
 * THIS LIVES IN THE ENGINE BECAUSE THE ENGINE IS WHAT COMPARES DATES. It was declared in
 * tools/date-basis.mjs, which prints "N of M cannot carry an as-of comparison" and then exits;
 * nothing in engine/ imported it, so every as-of comparison ran over those records as if their
 * dates meant what a date usually means. betweenDates reported N.Y. Gen. Bus. Law § 349 as a duty
 * GAINED between 2025 and 2026 because the corpus fetched it on 2026-04-03. Section 349 dates from
 * 1970. tools/date-basis.mjs now imports this list rather than declaring its own.
 */
export const WEAK_BASES = ['api_snapshot', 'undetermined'];

/** True when a record's effective_from is too weakly sourced to anchor an as-of comparison. */
export const dateIsWeak = record => WEAK_BASES.includes(record?.effective_from_basis);
