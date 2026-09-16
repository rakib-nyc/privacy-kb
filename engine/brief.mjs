// EVERYTHING KNOWN ABOUT ONE PROVISION, IN ONE PLACE.
//
// The complaint practitioners make about compliance tooling is not that it is wrong. It is that
// "they don't give you any context", which "forces users into checkbox compliance rather than
// meaningful risk management". A row in a control matrix tells you a duty exists. It does not
// tell you who enforces it, what the exposure is, whether there is a private right of action,
// which carve-out nearly applies, what the three mistakes are that people make with it, or what
// about it is still unresolved.
//
// This corpus has all of that and has been hiding it. Across 226 obligation records:
//   226 carry common_errors        226 carry a preemption posture with a note
//   226 carry enforcement detail    81 carry operative_context
//    78 carry open_questions        54 carry typed exemptions
//
// None of it reaches an answer today. `ask` prints a citation and a truncated summary; `cite`
// prints the span and the hash. The analytical layer — the part that took the most work and
// carries the most value — is readable only by opening the YAML.
//
// A brief is that layer, assembled. It makes no new claim: every field is already in the record,
// and the fields that are the extractor's own analysis rather than quoted law are labelled as
// such, because `requirement_detail` and `common_errors` are checked by no gate and
// meta/validation-events.yaml records five occasions when the prose around a correct quotation
// was wrong.
import { load, surfaceable } from './corpus.mjs';

const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const list = value => (Array.isArray(value) ? value : []).map(norm).filter(Boolean);

/** Assemble the full practitioner view of one record. Total; an unknown id is refused. */
export function brief(atomId, corpus) {
  const kb = corpus ?? load();
  const wanted = norm(atomId);
  if (!wanted) return { found: false, error: 'give a record id' };

  const record = (kb.all ?? []).find(candidate =>
    candidate?.id === wanted || norm(candidate?.source?.citation) === wanted);

  // INVARIANT I1. A record that could not be verified against a stored source is suppressed from
  // EVERY output, and a brief is an output. Found by red-teaming this module: it returned all
  // four unverified records, one of whose spans reads "PLACEHOLDER — no order text has been
  // fetched". The same shape as QA-03, which was privacy_coverage surfacing suppressed ids — a
  // new surface inherits the exposure unless it filters, and reading corpus.all is how it
  // happens every time.
  if (record && !surfaceable(record))
    return { found: false, id: wanted,
      error: `"${wanted}" exists in this corpus but is verification_status: ` +
             `${record.verification_status ?? 'unset'}, so invariant I1 suppresses it from every ` +
             `output. It could not be verified against a stored source. This is a limit of the ` +
             `corpus, not a finding about the law.` };

  if (!record)
    return { found: false, id: wanted,
      error: `No record with id or citation "${wanted}". This corpus does not have it — which is ` +
             `information, not an obstacle to route around. Try \`privacy-kb find\`.` };

  const quoted = {
    citation: record.source?.citation ?? null,
    verbatim_span: norm(record.verbatim_span),
    operative_context: (record.operative_context ?? []).map(part => ({
      relation: part.relation ?? null, citation: part.citation ?? null,
      verbatim_span: norm(part.verbatim_span) })),
  };

  const provenance = {
    atom_id: record.id, record_type: record.record_type,
    verification_status: record.verification_status ?? null,
    source_url: record.source?.url ?? null, fetched: record.source?.fetched ?? null,
    raw_sha256: record.source?.raw_sha256 ?? record.source?.text_sha256 ?? null,
    format: record.source?.format ?? null, risk_tier: record.source?.risk_tier ?? null,
    paragraph_path: record.paragraph_path?.path ?? null,
    path_derivation: record.paragraph_path?.derivation ?? null,
    path_confidence: record.paragraph_path?.confidence ?? null,
  };

  const temporal = {
    status: record.status ?? null,
    effective_from: record.effective_from ?? null, effective_to: record.effective_to ?? null,
    // WHAT KIND of date this is, because only some kinds can carry an as-of comparison.
    effective_from_basis: record.effective_from_basis ?? null,
    effective_from_evidence: norm(record.effective_from_evidence),
    amendment_history: (record.amendment_history ?? []).map(row => ({
      date: row.date ?? null, note: norm(row.note) })),
  };

  const reach = {
    applies_if: record.applies_if ?? null,
    applies_to_role: record.applies_to_role ?? null,
    obligation_type: record.obligation_type ?? null,
    deadline: record.deadline
      ? { trigger_event: record.deadline.trigger_event ?? null,
          duration: record.deadline.duration ?? null,
          computation: norm(record.deadline.computation) }
      : null,
    // TYPED, because entity-level and data-level are not the same thing and collapsing them is
    // the headline failure mode this corpus exists to model correctly.
    exemptions: (record.exemptions ?? []).map(carve => ({
      id: carve.id ?? null, type: carve.type ?? null, reach: carve.reach ?? null,
      scope: norm(carve.scope), source_citation: carve.source_citation ?? null,
      burden_of_proof: carve.burden_of_proof ?? null,
      verbatim_span: norm(carve.verbatim_span) })),
    preemption: record.preemption
      ? { posture: record.preemption.posture ?? null,
          authority: record.preemption.authority ?? null,
          note: norm(record.preemption.note) }
      : null,
    federal_relationship: record.federal_relationship ?? null,
  };

  const exposure = record.enforcement ? {
    enforcers: list(record.enforcement.enforcers),
    private_right_of_action: record.enforcement.private_right_of_action ?? null,
    penalty: record.enforcement.penalty
      ? { structure: norm(record.enforcement.penalty.structure),
          range: record.enforcement.penalty.range ?? null,
          note: norm(record.enforcement.penalty.note) }
      : null,
    statute_of_limitations: norm(record.enforcement.statute_of_limitations),
  } : null;

  // THE SOFTEST SURFACE IN THE SCHEMA, labelled as such. Gate 3 verifies the quotation; nothing
  // verifies the sentences written around it, and that is where every instruction error in
  // meta/validation-events.yaml landed.
  const analysis = {
    summary: norm(record.summary),
    requirement_detail: norm(record.requirement_detail),
    common_errors: list(record.common_errors),
    open_questions: list(record.open_questions),
    confidence: record.confidence ?? null,
    warning: 'summary, requirement_detail, common_errors and open_questions are the extractor\'s ' +
      'own analysis. They are NOT quoted law and no gate verifies them. The verbatim span above ' +
      'is verified against hash-anchored source bytes; the prose around it is not.',
  };

  const guidance = (record.interpreted_by ?? []).map(row => ({
    id: row.id ?? null, authority_tier: row.authority_tier ?? null,
    note: 'Guidance is not law (invariant I7). It may change advice; it never becomes the statute.' }));

  return { found: true, quoted, provenance, temporal, reach, exposure, analysis, guidance,
           related: (record.related ?? []).map(row => (typeof row === 'string' ? row : row?.id))
             .filter(Boolean),
           subject: record.subject ?? null, error: null };
}
