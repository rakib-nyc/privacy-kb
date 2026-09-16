// MAY I? — the question obligations do not answer.
//
// Every tool in this space answers "what must I do". A privacy office is asked the other question
// at least as often, usually by an engineer with a ticket open: MAY WE DO THIS. Disclose these
// records to a law-enforcement request. Use this data to train a model. Send this file to a
// vendor. That is not an obligation lookup — it is a question about permission, and the corpus
// holds the material for it: 84 records typed `prohibit` and 4 typed `permit`.
//
// THE ASYMMETRY THAT MAKES THIS DANGEROUS TO AUTOMATE.
//
// In most of life, silence means permission. In privacy law it frequently means the opposite.
// 45 C.F.R. § 164.502(a) says a covered entity "may not use or disclose protected health
// information, except as permitted or required by this subpart" — a DEFAULT PROHIBITION. Under
// that regime, "no rule forbids this" is not a green light; the absence of an affirmative
// permission is itself the answer, and it is no.
//
// So a tool that returns "nothing prohibits this operation" and leaves it there is not neutral.
// It is wrong in the most expensive direction, for the population most likely to rely on it. This
// module therefore reports three buckets and REFUSES to conclude from an empty one:
//
//   prohibitions   records that forbid, on these facts
//   permissions    records that affirmatively allow
//   conditions     records that allow only on a condition — consent, minimum necessary, contract
//
// and, when a general prohibition is among the applicable records, says in terms that silence is
// not permission here. It never returns a verdict. The verdict is a legal judgement about a
// specific operation against specific words, and those words are supplied so a person can make it.
import { analyze } from './applicability.mjs';
import { load, surfaceable } from './corpus.mjs';

const PROHIBIT = new Set(['prohibit']);
const PERMIT = new Set(['permit']);
const CONDITION = new Set(['obtain_consent', 'restrict_use', 'contract', 'disclose']);

const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * Sort the applicable obligations into permission postures. Total on hostile input.
 *
 * `operation` is free text and is NOT matched against anything — it is echoed so the output says
 * what question was asked. Guessing which provisions bear on "sharing with a vendor" from a
 * string would be exactly the kind of inference this project refuses everywhere else.
 */
export function mayI(entity, data, context, operation, corpus) {
  const kb = corpus ?? load();
  const result = analyze(entity ?? {}, data ?? {}, context ?? {});
  const shape = { operation: norm(operation) || null, as_of: result?.as_of ?? null,
                  prohibitions: [], permissions: [], conditions: [],
                  default_deny: false, error: result?.error ?? null, caveat: null };
  if (result?.error) return shape;

  // I1, belt and braces: analyze() already filters, but this map is the only thing standing
  // between a suppressed record and the output if that ever stops being true.
  const byId = new Map((kb.all ?? []).filter(record => record?.id && surfaceable(record))
    .map(record => [record.id, record]));
  const buckets = { prohibitions: [], permissions: [], conditions: [] };

  for (const hit of result.applicable ?? []) {
    const record = byId.get(hit.atom_id);
    if (!record) continue;
    const kind = record.obligation_type;
    const row = { atom_id: record.id, citation: record.source?.citation,
                  obligation_type: kind, summary: norm(record.summary),
                  verbatim_span: norm(record.verbatim_span),
                  sha256: record.source?.raw_sha256 ?? record.source?.text_sha256 ?? null,
                  exemptions: (record.exemptions ?? []).map(carve => ({
                    type: carve.type, scope: norm(carve.scope),
                    source_citation: carve.source_citation ?? null,
                    burden_of_proof: carve.burden_of_proof ?? null })),
                  common_errors: record.common_errors ?? [] };
    if (PROHIBIT.has(kind)) buckets.prohibitions.push(row);
    else if (PERMIT.has(kind)) buckets.permissions.push(row);
    else if (CONDITION.has(kind)) buckets.conditions.push(row);
  }

  // A GENERAL PROHIBITION FLIPS THE MEANING OF SILENCE. Detected from the text rather than from a
  // hardcoded citation list, because the pattern — forbid, then carve back — is how these regimes
  // are drafted generally, not a quirk of one rule.
  const generalDeny = buckets.prohibitions.filter(row =>
    /\bexcept as (permitted|provided|required)\b|\bunless (permitted|otherwise)\b/i.test(row.verbatim_span));
  const default_deny = generalDeny.length > 0;

  return { ...shape, ...buckets, default_deny,
    general_prohibitions: generalDeny.map(row => row.citation),
    caveat: default_deny
      ? 'A GENERAL PROHIBITION APPLIES on these facts: ' +
        generalDeny.map(row => row.citation).join(', ') + '. Under a regime drafted as ' +
        '"may not ... except as permitted", the absence of a rule forbidding your operation is ' +
        'NOT permission — you need an affirmative permission, and an operation no listed ' +
        'permission covers is prohibited. Do not read an empty prohibitions list as a yes.'
      : 'No general prohibition was found among the applicable records. That is NOT a finding ' +
        'that the operation is permitted: this corpus holds federal, New York State and New York ' +
        'City law only, the operation was not matched against any provision, and silence here ' +
        'means nothing was retrieved rather than that nothing applies.' };
}
