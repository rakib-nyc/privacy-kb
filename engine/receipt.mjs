// A RECEIPT: THE ANSWER, PROVED REPRODUCIBLE.
//
// Regulators have moved to audit-style oversight and say plainly that paper compliance is no
// longer sufficient. That changes what the deliverable is. The question stops being "what does
// the law require" — every tool answers that — and becomes "what did your system tell you on
// 15 September 2026, on what corpus, and can you show me it still says that."
//
// A search-grounded assistant cannot answer it at any level of model quality. The index has
// moved, the pages have changed, the model samples, and three identical prompts in this project's
// own benchmark produced three different obligation lists. That is not a defect in the model; it
// is what sampling from a moving corpus means.
//
// This can answer it, because the engine is a pure function of (facts, as_of, corpus). So the
// receipt is three digests and a comparison:
//
//   inputs_digest   canonical JSON of the facts and the as-of date
//   corpus_digest   every record id paired with the sha256 of the SOURCE BYTES it was cut from
//   result_digest   canonical JSON of the answer
//
// The second one is the load-bearing one and the reason this is not just a checksum. It is not a
// hash of the YAML files — reformatting a record would change that and mean nothing. It is a hash
// over the identity of every record and the bytes of the law each one quotes. Two corpora with
// the same digest quote the same law, whatever else was edited around it.
//
// WHAT A MATCHING RECEIPT PROVES: the same question, against the same law, still produces the
// same answer. WHAT IT DOES NOT PROVE: that the answer is correct. A receipt is reproducibility,
// not truth, and saying otherwise would be the worst possible claim to attach to a hash.
import { createHash } from 'node:crypto';
import { load } from './corpus.mjs';
import { analyze } from './applicability.mjs';

const ENGINE_CONTRACT = 1;   // bump when the SHAPE of a result changes, not when the corpus does

/** Deterministic JSON: object keys sorted at every depth, so key order cannot move a digest. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

const sha = text => createHash('sha256').update(String(text), 'utf8').digest('hex');

/**
 * A fingerprint of the law this corpus holds.
 *
 * id + the hash of the source bytes, sorted, hashed. Deliberately NOT a hash of the record files:
 * re-indenting a YAML file, fixing a typo in a summary or renaming a variable must not invalidate
 * a receipt, because none of those changes what the law says. Adding a record, removing one, or
 * re-cutting one against different source bytes must, because all three do.
 */
export function corpusDigest(corpus) {
  const kb = corpus ?? load();
  const rows = (kb.all ?? [])
    .filter(record => record?.id)
    .map(record => `${record.id}\t${record.source?.raw_sha256 ?? record.source?.text_sha256 ?? '-'}`)
    .sort();
  return { digest: sha(rows.join('\n')), records: rows.length };
}

/** Strip fields that vary between runs without the answer differing. */
function stableResult(result) {
  const { as_of, applicable, obligations, deadlines, exempt, not_applicable, backstops,
          pending_watch, coverage_gaps, preemption_notes, unverified_excluded } = result ?? {};
  return {
    as_of: as_of ?? null,
    applicable: (applicable ?? []).map(hit => hit.atom_id).filter(Boolean).sort(),
    obligations: (obligations ?? []).map(hit => hit.id).filter(Boolean).sort(),
    deadlines: (deadlines ?? []).map(row => `${row.atom_id}|${row.computed ?? 'not-started'}`).sort(),
    exempt: (exempt ?? []).map(row => row.instrument_id ?? row.atom_id).filter(Boolean).sort(),
    not_applicable: (not_applicable ?? []).map(row => row.atom_id).filter(Boolean).sort(),
    backstops: (backstops ?? []).map(row => row.atom_id ?? row.kind).filter(Boolean).sort(),
    pending_watch: (pending_watch ?? []).map(row => row.atom_id).filter(Boolean).sort(),
    preemption_notes: (preemption_notes ?? []).length,
    coverage_gaps: (coverage_gaps ?? []).slice().sort(),
    unverified_excluded: (unverified_excluded ?? []).slice().sort(),
  };
}

/**
 * Issue a receipt for an analysis. Total on hostile input.
 *
 * `issued_at` is metadata and is EXCLUDED from every digest — a receipt issued tomorrow for the
 * same question against the same corpus must carry the same receipt_id, or the whole thing
 * measures the clock instead of the answer.
 */
export function issueReceipt(entity, data, context, corpus) {
  const kb = corpus ?? load();
  const result = analyze(entity ?? {}, data ?? {}, context ?? {});
  const inputs = { entity: entity ?? {}, data: data ?? {},
                   as_of: context?.as_of ?? null,
                   state_layers: (context?.state_layers ?? []).slice().sort(),
                   event: context?.event ?? {}, practice: context?.practice ?? {},
                   purpose: context?.purpose ?? {}, law: context?.law ?? {},
                   include_pending: context?.include_pending ?? false };
  const corpusFp = corpusDigest(kb);
  const inputs_digest = sha(canonical(inputs));
  const result_digest = result?.error ? sha('ERROR:' + result.error) : sha(canonical(stableResult(result)));
  const receipt_id = sha([ENGINE_CONTRACT, inputs_digest, corpusFp.digest, result_digest].join('\n')).slice(0, 32);

  return {
    receipt_id, engine_contract: ENGINE_CONTRACT,
    issued_at: new Date().toISOString(),          // metadata only — never hashed
    as_of: context?.as_of ?? null,
    inputs_digest, corpus_digest: corpusFp.digest, corpus_records: corpusFp.records,
    result_digest,
    error: result?.error ?? null,
    summary: result?.error ? null : {
      obligations: (result.obligations ?? []).length,
      deadlines_started: (result.deadlines ?? []).filter(row => row.computed).length,
      coverage_gaps: (result.coverage_gaps ?? []).length,
      pending_watch: (result.pending_watch ?? []).length },
    what_this_proves: 'The same facts, the same as-of date and the same corpus produce this ' +
      'answer. Re-run and compare receipt_id. It does NOT prove the answer is correct.',
  };
}

/**
 * Re-run and compare. Reports WHICH digest moved, because the three mean different things:
 * inputs moved = a different question was asked; corpus moved = the law held changed;
 * result moved with both stable = the engine changed, which should never happen silently.
 */
export function verifyReceipt(claimed, entity, data, context, corpus) {
  const fresh = issueReceipt(entity, data, context, corpus);
  if (!claimed || typeof claimed !== 'object')
    return { verified: false, reason: 'no receipt supplied to verify against', fresh };
  const parts = ['inputs_digest', 'corpus_digest', 'result_digest', 'engine_contract'];
  const moved = parts.filter(part => claimed[part] !== undefined && claimed[part] !== fresh[part]);
  const verified = claimed.receipt_id === fresh.receipt_id && moved.length === 0;
  const explain = {
    inputs_digest: 'a DIFFERENT QUESTION was asked — the facts or the as-of date are not the same',
    corpus_digest: 'THE CORPUS CHANGED — records were added, removed, or re-cut against different source bytes',
    result_digest: 'THE ANSWER CHANGED',
    engine_contract: 'THE ENGINE CONTRACT CHANGED — the shape of a result is not what it was',
  };
  return { verified, moved, fresh,
           reason: verified ? 'identical' : moved.map(part => `${part}: ${explain[part]}`).join('; ')
             || 'receipt_id differs' };
}
