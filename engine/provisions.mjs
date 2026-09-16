// PROVISION IDENTITY — what makes two records two VERSIONS of one thing rather than two things.
//
// THE STATE THIS FIXES. Across 248 records, `supersedes` and `superseded_by` were null 248
// times and `effective_to` was null 248 times. Grouping records by (instrument, paragraph path,
// citation) yields 238 distinct provisions, and NOT ONE of them exists at two vintages. The
// schema has carried the version fields since v1 and nothing has ever filled them, so invariant
// I2 — "there is no current law, only law as of a date" — was enforced at the query boundary
// over data that could only ever describe one moment. Ask for the law on any past date and the
// engine can only answer with today's text, or with nothing.
//
// The version fields cannot simply be populated by hand, because two records sharing a
// provision are AMBIGUOUS on their face:
//
//   * two VINTAGES of one provision — the text before and after an amendment. These must form a
//     chain: adjacent, non-overlapping, each pointing at the next.
//   * two CO-LOCATED records over one provision — 15 U.S.C. § 45(a)(1) supports both a deception
//     duty and a public-commitment duty; N.Y. GBL § 899-ee(1) yields an obligation record and a
//     definition record. These are different things quoted from the same words, not versions.
//
// The discriminator is the DATE. Co-located records share an effective_from because they are
// the same words at the same moment; vintages differ precisely because the words changed. So
// gate 44 applies chain rules only to a provision whose records disagree about when they began,
// and leaves same-date duplicates to gate 41, whose question they actually are.

/**
 * The key under which every vintage of one provision must agree.
 *
 * DERIVED, with an explicit override. Deriving costs no migration and cannot drift from the
 * paragraph path it is built out of. The override exists for the case derivation cannot see:
 * a renumbering, where the same provision moves from § 164.502(a)(5) to § 164.502(b)(1) and two
 * records that ARE a chain would otherwise be keyed apart. Setting it is a claim that two texts
 * are the same provision, so it belongs in a record where a human signs for it.
 */
export function provisionKey(rec) {
  if (typeof rec?.provision_key === 'string' && rec.provision_key.trim()) return rec.provision_key.trim();
  const s = rec?.source ?? {};
  const inst = s.instrument_id ?? null;
  const anchor = rec?.paragraph_path?.anchor ?? null;
  const path = Array.isArray(rec?.paragraph_path?.path) && rec.paragraph_path.path.length
    ? rec.paragraph_path.path.join('.') : null;
  const parts = [inst, anchor, path].filter(Boolean);
  // A record with no instrument and no path has no structural identity to key on; fall back to
  // the citation so it groups with itself and nothing else, rather than colliding with every
  // other structureless record under a shared "unknown".
  return parts.length ? parts.join('#') : `citation:${s.citation ?? rec?.id ?? 'unknown'}`;
}

/** Group records by provision. Returns Map<provisionKey, record[]>. */
export function byProvision(records) {
  const m = new Map();
  for (const r of records) {
    if (!r?.id) continue;
    const k = provisionKey(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

/**
 * A provision's records are a VERSION CHAIN claim only when they disagree about effective_from.
 * Same-date records over one provision are co-located duties, which is gate 41's question.
 */
export function isVersionChain(records) {
  records = records ?? [];
  return new Set(records.map(r => r.effective_from ?? null)).size > 1;
}

/**
 * Check one provision's records as a version chain. Returns a list of problem strings; empty
 * means the chain is sound. Pure — no I/O — so both gate 44 and the engine tests can call it.
 *
 * The rules, and why each one is a real failure rather than tidiness:
 *
 *  - ORDERED AND DATED. A vintage with no effective_from cannot be placed in time, so no query
 *    can decide whether it governs.
 *  - ADJACENT. Vintage N's effective_to must equal vintage N+1's effective_from. A GAP means a
 *    date exists on which the corpus holds text for this provision and answers with none — the
 *    false negative that made N.Y. GBL § 899-aa vanish from a February 2025 query. An OVERLAP
 *    means two texts both claim to govern one day, and the corpus contradicts itself.
 *  - LINKED BOTH WAYS. supersedes/superseded_by must name the neighbouring record. A chain that
 *    is correct by date but unlinked cannot be walked, so no change-watch can report what
 *    changed between two vintages.
 *  - CLOSED, EXCEPT AT THE END. Every vintage but the last must be status `superseded` with a
 *    non-null effective_to. A `superseded` record left open-ended is in force forever.
 *  - ONE OPEN END. Exactly one vintage carries effective_to: null. Two open ends is two current
 *    versions of one provision.
 */
export function chainProblems(records) {
  records = records ?? [];
  const out = [];
  const undated = records.filter(r => !r.effective_from);
  if (undated.length)
    out.push(`${undated.map(r => r.id).join(', ')} carr${undated.length === 1 ? 'ies' : 'y'} no `
      + `effective_from, so ${undated.length === 1 ? 'it' : 'they'} cannot be placed in the chain.`);

  const dated = records.filter(r => r.effective_from)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  if (dated.length < 2) return out;

  const open = dated.filter(r => !r.effective_to);
  if (open.length > 1)
    out.push(`${open.length} vintages have effective_to: null (${open.map(r => r.id).join(', ')}). `
      + `Exactly one version of a provision may be open-ended; more than one means the corpus `
      + `holds two current texts for the same words.`);

  for (let i = 0; i < dated.length - 1; i++) {
    const cur = dated[i], next = dated[i + 1];
    if (!cur.effective_to)
      out.push(`${cur.id} is superseded by ${next.id} on ${next.effective_from} but has `
        + `effective_to: null, so it never stops governing.`);
    else if (cur.effective_to !== next.effective_from)
      out.push(cur.effective_to < next.effective_from
        ? `GAP: ${cur.id} ends ${cur.effective_to} and ${next.id} begins ${next.effective_from}. `
          + `Between those dates this provision has no text, so a query in the gap returns nothing `
          + `for a provision the corpus actually holds.`
        : `OVERLAP: ${cur.id} runs to ${cur.effective_to} and ${next.id} begins `
          + `${next.effective_from}. Both claim the days between.`);
    if (cur.status !== 'superseded')
      out.push(`${cur.id} is followed by ${next.id} but its status is "${cur.status}", not `
        + `"superseded".`);
    if ((cur.superseded_by ?? null) !== next.id)
      out.push(`${cur.id}.superseded_by is ${JSON.stringify(cur.superseded_by ?? null)}; the next `
        + `vintage by date is ${next.id}.`);
    if ((next.supersedes ?? null) !== cur.id)
      out.push(`${next.id}.supersedes is ${JSON.stringify(next.supersedes ?? null)}; the previous `
        + `vintage by date is ${cur.id}.`);
  }
  return out;
}
