// FULL-TEXT SEARCH OVER THE CORPUS.
//
// 1,400 provision records were added as reference text the applicability engine deliberately does
// not read. That is the right boundary — a provision with no analysed predicate must never make
// the engine assert that a duty applies — but it leaves them reachable only by knowing a record
// id in advance, which nobody does. Held text that cannot be found is not coverage.
//
// So: search by citation, by the words of the provision, or by what it is about. Results say
// which KIND of record each hit is, because the distinction is the whole point. An `obligation`
// has been analysed and the engine will reason with it. A `provision` is verified text with a
// verified citation and nothing more, and a reader must be able to see that at a glance rather
// than infer it.
import { load } from './corpus.mjs';

const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ');
// § and C.F.R. punctuation vary by how a person types a citation; match on the digits and letters.
const citeKey = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * @param q      free text: a citation, a phrase from the provision, or a topic
 * @param opts   {limit, record_type, instrument_id, jurisdiction}
 */
export function search(q, opts = {}) {
  const corpus = load();
  const query = norm(q);
  if (!query) return { query: q ?? '', count: 0, results: [],
    note: 'Supply a citation, a phrase from the text, or a topic.' };
  const qKey = citeKey(q);
  const terms = query.split(' ').filter(t => t.length > 2);

  const scored = [];
  for (const rec of corpus.all) {
    if (opts.record_type && rec.record_type !== opts.record_type) continue;
    if (opts.instrument_id && rec.source?.instrument_id !== opts.instrument_id) continue;
    if (opts.jurisdiction && rec.jurisdiction_level !== opts.jurisdiction) continue;

    const citation = rec.source?.citation ?? '';
    const hay = norm(`${citation} ${rec.summary ?? ''} ${rec.verbatim_span ?? ''} ${rec.requirement_detail ?? ''}`);
    let score = 0;

    // A citation match is what someone typing "164.512" means, and it outranks everything.
    const cKey = citeKey(citation);
    if (qKey && cKey === qKey) score += 1000;
    else if (qKey.length >= 4 && cKey.includes(qKey)) score += 400;
    if (citeKey(rec.id).includes(qKey) && qKey.length >= 4) score += 200;

    // Whole-phrase hit in the quoted text beats scattered terms.
    if (query.length > 4 && hay.includes(query)) score += 120;
    for (const t of terms) if (hay.includes(t)) score += 10;
    // A hit in the provision's own words is worth more than one in the analysis around it.
    if (terms.length && norm(rec.verbatim_span).includes(query)) score += 40;

    if (score <= 0) continue;
    // An analysed record is more useful than raw text for the same query, all else equal.
    if (rec.record_type === 'obligation') score += 15;
    scored.push({ score, rec });
  }

  // NOTE THE PARAMETER NAMES: never `a`. tools/check-engine-schema.mjs reads `a.<field>` in
  // engine/ as a CORPUS RECORD field access, and reported this file as depending on record fields
  // named `score` and `rec`. Same note as engine/memo.mjs and engine/facts.mjs.
  scored.sort((lhs, rhs) => rhs.score - lhs.score
    || String(lhs.rec.source?.citation).localeCompare(String(rhs.rec.source?.citation)));

  const limit = Math.max(1, Math.min(Number(opts.limit ?? 20), 200));
  const results = scored.slice(0, limit).map(({ rec }) => ({
    atom_id: rec.id,
    citation: rec.source?.citation ?? null,
    record_type: rec.record_type,
    // The honest label. `analysed` means a predicate exists and the engine reasons with it;
    // `reference text` means the corpus can quote it and claims nothing more.
    kind: rec.record_type === 'obligation' ? 'analysed' : 'reference text',
    summary: rec.summary ?? null,
    obligation_type: rec.obligation_type ?? null,
    operative_verb: rec.operative_verb ?? null,
    effective_from: rec.effective_from ?? null,
    effective_from_basis: rec.effective_from_basis ?? null,
    instrument_id: rec.source?.instrument_id ?? null,
    source_url: rec.source?.url ?? null,
    verify: `privacy-kb cite ${rec.id}`,
  }));

  const byKind = {};
  for (const hit of scored) byKind[hit.rec.record_type] = (byKind[hit.rec.record_type] ?? 0) + 1;

  return {
    query: q, count: scored.length, showing: results.length, by_record_type: byKind, results,
    note: 'A result marked "reference text" is a verified quotation with a verified citation and '
        + 'nothing else: no applicability predicate has been written for it, and the engine will '
        + 'not reason with it. Use privacy_cite to read the full text with its hash.',
  };
}
