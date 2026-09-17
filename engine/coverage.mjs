// COVERAGE IS DECLARED, NEVER INFERRED FROM PRESENCE.
//
// The bug this file exists to prevent: `corpus.obligations.some(a => a.jurisdiction === j)`.
// It reads as "do we cover New York" and answers "is there at least one New York record".
// Three GBL § 349 UDAP atoms made it return true while GBL § 899-aa — the breach clock a
// practitioner asks for when they ask for the state layer — was absent. The gap vanished the
// moment a single atom of ANY kind landed, and the failure was silent and in the confident
// direction: not "we don't know", but nothing at all.
//
// So the expected instruments are declared in meta/jurisdiction-coverage.yaml, transcribed
// from CORPUS-MANIFEST.md, and coverage is a comparison against that declaration. A missing
// instrument is named, with the duty classes it would have supplied.
//
// Covering a jurisdiction is not covering a duty.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { requirementsFor } from './requirements.mjs';
import { load } from './corpus.mjs';

const FILE = resolve(import.meta.dirname, '../meta/jurisdiction-coverage.yaml');

/**
 * A PARAMETER DEFAULT COVERS `undefined` ONLY. Every exported function here reads corpus.obligations
 * or corpus.all, and a caller passing an explicit null — which is what an unresolved lookup upstream
 * hands you — got "Cannot read properties of null" rather than an answer. This has been found and
 * fixed in computeDeadline, preemption.resolve(), all four workflows, buildMemo and normaliseFacts;
 * coverage.mjs was the layer that had not been checked yet.
 *
 * `corpus ?? load()` is the same resolution engine/requirements.mjs and engine/conform.mjs already
 * use, so a null corpus means "read the real one" everywhere rather than in some modules only.
 */
const kbOf = corpus => corpus ?? load();

const IFILE = resolve(import.meta.dirname, '../meta/instrument-coverage.yaml');
let DECL = null;
function decl() {
  if (DECL) return DECL;
  DECL = existsSync(FILE) ? (yaml.load(readFileSync(FILE, 'utf8'))?.jurisdictions ?? {}) : {};
  return DECL;
}

export function declaredJurisdictions() { return Object.keys(decl()); }

let IDECL = null;
function idecl() {
  if (IDECL) return IDECL;
  IDECL = existsSync(IFILE) ? (yaml.load(readFileSync(IFILE, 'utf8'))?.instruments ?? {}) : {};
  return IDECL;
}
export function declaredInstruments() { return Object.keys(idecl()); }

/**
 * What an instrument holds, measured against the duty categories it is SUPPOSED to hold.
 *
 * jurisdiction-coverage closed this hole one level up and left this one open, and this one is
 * worse because it is architecturally invisible: every atom is correct, every gate passes, the
 * engine behaves as designed. FCRA is the case — the corpus holds 15 U.S.C. § 1681t and nothing
 * else, so a consumer-reporting-agency query returned confident preemption analysis over a
 * substantive void with nothing in the output signalling the void. "Has preemption atoms" and
 * "can answer questions about this instrument" are different claims.
 */
/**
 * How much of a PREFIXED SECTION the corpus actually holds, measured against its segmentation.
 *
 * A declared duty category is satisfied here when some held citation starts with its prefix, and
 * one record is enough. The corpus holds a single paragraph of 15 U.S.C. § 1681g, and the FCRA
 * consumer_disclosures category — prefix "15 U.S.C. § 1681g" — therefore reported as fully
 * present over a section it had barely touched. 45 C.F.R. § 164.512 is worse: 29 elements held
 * of the 161 its segmentation contains, reported as present.
 *
 * That is the same defect this module already warns about one level up. There the gap register
 * could not see a missing provision inside a held category; here it cannot see a missing ELEMENT
 * inside a held provision, and a caller who is told a category is complete stops looking.
 *
 * So the prefix is measured against the segmentation, which is the only denominator that is not
 * a count of what happens to be there. Where the segmentation cannot supply one, this returns
 * assessed:false and SAYS SO, rather than reporting a shortfall of zero — an unmeasured section
 * and a fully-held section must never read the same. DEBT-025.
 */
// KEYED BY CORPUS, NOT ONLY BY CITATION. instrumentCoverage runs on every answer, so the read is
// memoised; but validate.mjs loads a one-record fixture corpus in the same process as the real
// one, and a cache keyed on the citation alone would hand a fixture the full corpus's denominator.
// A WeakMap on the corpus object keeps the two apart and lets either be collected.
const elementCache = new WeakMap();
export function elementCoverageFor(prefix, corpus) {
  const key = String(prefix);
  // A WeakMap REFUSES A NON-OBJECT KEY OUTRIGHT — elementCache.set(null, ...) throws "Invalid
  // value used as weak map key", so a null corpus crashed here before it could be resolved.
  const kb = kbOf(corpus);
  let perCorpus = elementCache.get(kb);
  if (!perCorpus) elementCache.set(kb, perCorpus = new Map());
  if (perCorpus.has(key)) return perCorpus.get(key);
  let out;
  try {
    const req = requirementsFor(key, kb);
    const denom = req?.denominator;
    // WHAT IS COUNTED IS THE ELEMENTS BENEATH THE PREFIX, NOT THE PREFIX ITSELF. Reporting
    // "holds 0 of 3" for 42 U.S.C. § 12112(d)(3)(B) — which the corpus holds as an obligation,
    // while its three exceptions at (i)-(iii) are unheld — reads as "nothing is here" and is the
    // mirror of the defect this exists to fix. The shortfall is real and worth saying; the
    // sentence has to say which quantity it is about, and whether the prefix itself is held.
    const itselfHeld = (kb.all ?? []).some(record =>
      String(record.source?.citation ?? '').replace(/\s+/g, ' ').trim() === key);
    out = (req?.found && denom?.available === true && Number.isFinite(denom.expected))
      ? { prefix: key, assessed: true, held: req.count ?? 0, expected: denom.expected,
          prefix_itself_held: itselfHeld,
          missing: (denom.missing ?? []).map(entry => entry.designation).filter(Boolean) }
      : { prefix: key, assessed: false, prefix_itself_held: itselfHeld,
          reason: req?.found
            ? 'the segmentation supplies no denominator for this citation'
            : 'no record or segmentation node is addressable at this citation' };
  } catch (err) {
    out = { prefix: key, assessed: false, reason: `denominator could not be read: ${err?.message ?? err}` };
  }
  perCorpus.set(key, out);
  return out;
}

// NOTE the variable naming: declaration entries are `cat`, never `a`. Gate 22 reads `a.x` as a
// record-field access, and a declaration field that happens to share the shape of a record read
// is exactly the ambiguity that check exists to refuse. Rename the variable, never the check.
export function instrumentCoverage(instrumentId, corpus) {
  const kb = kbOf(corpus);
  const d = idecl()[instrumentId];
  const cites = (kb.obligations ?? [])
    .filter(a => a.source?.instrument_id === instrumentId)
    .map(a => a.source?.citation).filter(Boolean);
  if (!d) {
    return { instrument_id: instrumentId, declared: false, complete: false,
      present: [], absent: [], obligations: cites.length,
      summary: `${instrumentId} has NO coverage declaration in meta/instrument-coverage.yaml, so ` +
        `whether the corpus can answer questions about it is UNKNOWN. The ${cites.length} ` +
        `obligation(s) present do not establish otherwise.` };
  }
  const cats = d.categories ?? [];
  // A CATEGORY IS PARTIAL WHEN ANY OF ITS DECLARED PROVISIONS IS ABSENT. This used to ask
  // whether ANY prefix was present, so a category listing several provisions reported "present"
  // on the strength of one of them.
  //
  // 45 C.F.R. § 164.512 is the case that matters. The HIPAA Privacy Rule's
  // permitted_uses_and_disclosures category declares § 164.506 and § 164.512; only § 164.506 is
  // held. Asked whether PHI may be disclosed to law enforcement, the engine returned § 164.502(a)
  // ("may not use or disclose ... except as permitted") and § 164.508(a)(1) (authorisation
  // required) and reported NO coverage gap — so the answer read as "you need an authorisation"
  // when § 164.512(f) permits the disclosure without one. A confident answer in the wrong
  // direction, over a hole the completeness check could not see.
  //
  // Seventeen declared provisions across the corpus sat behind this, including
  // N.Y. GBL § 899-aa(8) — the Attorney General, Department of State and State Police notice
  // that every SHIELD Act breach requires.
  const missingOf = cat => (cat.citation_prefix ?? [])
    .filter(pre => !cites.some(x => x.startsWith(pre)));
  const enriched = cats.map(cat => ({ ...cat, missing_provisions: missingOf(cat) }));
  const present = enriched.filter(cat => cat.missing_provisions.length === 0);
  const partial = enriched.filter(cat =>
    cat.missing_provisions.length > 0 && cat.missing_provisions.length < (cat.citation_prefix ?? []).length);
  const absent = enriched.filter(cat =>
    cat.missing_provisions.length === (cat.citation_prefix ?? []).length && (cat.citation_prefix ?? []).length > 0);
  const short = [...partial, ...absent];
  const gaps = short.flatMap(cat => cat.missing_provisions);

  // Element coverage is measured only for categories that PASSED the prefix test, because those
  // are the ones whose completeness is being asserted. A category already reported as partial or
  // absent carries its own caveat and needs no second one.
  const thin = [];
  const unassessed = [];
  for (const cat of present) {
    for (const pre of (cat.citation_prefix ?? [])) {
      const el = elementCoverageFor(pre, corpus);
      if (!el.assessed) { unassessed.push({ category: cat.id, ...el }); continue; }
      if (el.held < el.expected) thin.push({ category: cat.id, ...el });
    }
  }
  // THE PROSE NAMES THE WORST FEW; THE STRUCTURE CARRIES ALL OF THEM. Enumerating every missing
  // designator here produced a 1,500-character sentence on FCRA alone, and a caveat nobody reads
  // protects nobody. The full list is element_coverage.thin.
  const worst = [...thin].sort((x, y) => (x.held / x.expected) - (y.held / y.expected));
  const thinNote = thin.length
    ? ` PREFIX PRESENT IS NOT ELEMENT COMPLETE: ${thin.length} of the ${present.length} present ` +
      `categor${present.length === 1 ? 'y' : 'ies'} name a citation whose SUB-ELEMENTS are only ` +
      `partly held — ` +
      worst.slice(0, 3).map(entry => `${entry.prefix} holds ${entry.held} of the ${entry.expected} ` +
        `beneath it${entry.prefix_itself_held ? '' : ', and is not itself held'}`).join('; ') +
      (worst.length > 3 ? `, and ${worst.length - 3} more` : '') +
      `. A category counts as present on ONE matching citation, so the completeness reported above ` +
      `is a claim about prefixes, not about elements; see element_coverage.thin for each one.`
    : '';

  // `complete` MEANS WHAT A READER THINKS IT MEANS.
  //
  // It used to mean "every declared duty category matched a citation prefix", and one held record
  // satisfies a prefix — so FCRA reported complete while holding 1 of the 129 elements beneath
  // 15 U.S.C. 1681g. 41 instruments read complete on that definition; 4 do on this one. The weaker
  // claim is still worth having and is still reported, under a name that says what it is.
  //
  // An UNASSESSED prefix never counts against completeness. A part-level prefix like
  // "34 C.F.R. 99" has no single segmentation to measure against, and treating unmeasured as
  // incomplete would be the same error in the opposite direction.
  const categoriesPresent = short.length === 0;
  return { instrument_id: instrumentId, declared: true,
    complete: categoriesPresent && thin.length === 0,
    categories_present: categoriesPresent,
    completeness_basis: thin.length
      ? 'every declared category matched a citation prefix, but at least one holds fewer elements '
        + 'than its source contains'
      : 'every declared category matched a citation prefix, and no prefix measured short against '
        + 'its segmentation',
    title: d.title ?? instrumentId, present, partial, absent, missing_provisions: gaps,
    obligations: cites.length, element_coverage: { thin, unassessed },
    summary: (short.length === 0
      ? `${d.title ?? instrumentId}: all ${cats.length} declared duty categories are present.`
      : `${d.title ?? instrumentId} is PARTIALLY EXTRACTED — ${present.length} of ${cats.length} duty ` +
        `categories fully present. This analysis is correct as far as it goes and CANNOT reach: ` +
        short.map(cat => `${cat.id} (missing ${cat.missing_provisions.join(', ')})` +
          (cat.supplies ? ` — ${cat.supplies}` : '')).join('; ') +
        '. Treat those questions as unanswered rather than as answered in the negative.') + thinNote };
}

/** What the corpus holds for a jurisdiction, measured against what it is supposed to hold. */
export function coverageFor(jurisdiction, corpus) {
  const kb = kbOf(corpus);
  const d = decl()[jurisdiction];
  const held = new Set((kb.obligations ?? [])
    .filter(a => a.jurisdiction === jurisdiction)
    .map(a => a.source?.instrument_id).filter(Boolean));

  if (!d) {
    // No declaration is NOT an all-clear. It means nobody has said what this jurisdiction
    // needs, so nothing can be reported as covered.
    return { jurisdiction, declared: false, expected: [], present: [], missing: [],
             atoms_present: held.size,
             summary: `${jurisdiction} has NO coverage declaration in meta/jurisdiction-coverage.yaml. ` +
               `Coverage is UNKNOWN, not complete` +
               (held.size ? `, and the ${held.size} instrument(s) present do not establish otherwise.` : '.') };
  }
  const expected = d.instruments ?? [];
  const present = expected.filter(i => held.has(i.id));
  const missing = expected.filter(i => !held.has(i.id));
  return { jurisdiction, declared: true, expected, present, missing, atoms_present: held.size,
    summary: missing.length === 0
      ? `${jurisdiction}: all ${expected.length} declared instruments are present.`
      : `${jurisdiction}: ${present.length} of ${expected.length} declared instruments present. ` +
        `MISSING ${missing.length}: ` + missing.map(m => `${m.citation} (${m.title}) — would supply ` +
          `${(m.supplies ?? []).join('/') || 'unclassified'}`).join('; ') + '.' };
}

/**
 * A HELD record that cites an UNHELD instrument.
 *
 * This is the coverage-by-presence defect one level in. meta/jurisdiction-coverage.yaml already
 * declares which instruments a jurisdiction should hold, and coverageFor names the missing ones.
 * What nothing checked is whether a record that DID answer points at one of them — and that is
 * the case where the absence changes the answer rather than merely shortening it.
 *
 * The case that produced this: N.Y. GBL 899-aa(8)(a) is held and verbatim-confirmed, and its own
 * text hands the Department of Financial Services notice to "23 NYCRR 500.17". Part 500 is
 * declared and not held. So `deadlines` printed "earliest first" over a list that could not
 * contain the earliest duty, and the ordering was wrong with nothing marking it. Every gate
 * passed: the span was verbatim, the path unique, the predicate satisfiable. The corpus held the
 * pointer to its own blind spot and could not follow it.
 *
 * The match is DECLARED, never inferred. An instrument says in `cited_as` how other instruments
 * refer to it, and this walks the spans looking for those exact strings. A regex over citation
 * shapes would find more and would also invent some; a declaration cannot produce a false
 * positive that nobody wrote down.
 */
export function crossReferenceGaps(records, jurisdiction, corpus) {
  const kb = kbOf(corpus);
  const cov = coverageFor(jurisdiction, kb);
  if (!cov.declared || !cov.missing.length) return [];
  const norm = t => String(t ?? '').replace(/\s+/g, ' ');
  const out = [];
  for (const missing of cov.missing) {
    const forms = missing.cited_as ?? [];
    if (!forms.length) continue;
    const citing = [];
    for (const held of records) {
      const span = norm(held.verbatim_span);
      if (forms.some(form => span.includes(form)))
        citing.push(held.source?.citation ?? held.id);
    }
    if (citing.length)
      out.push(`${[...new Set(citing)].sort().join(', ')} cite(s) ${missing.citation} ` +
        `(${missing.title}), which this corpus DOES NOT HOLD. The quoted provision hands part of ` +
        `its own operation to that instrument, so a duty under it may exist, may be earlier than ` +
        `anything listed here, and cannot be computed. Any "earliest" or "complete" claim over ` +
        `this answer is bounded by that. Treat it as unanswered rather than as answered in the negative.`);
  }
  return out;
}

const VFILE = resolve(import.meta.dirname, '../meta/missing-vintages.yaml');
let VINT = null;
function vintages() {
  if (VINT) return VINT;
  VINT = existsSync(VFILE) ? (yaml.load(readFileSync(VFILE, 'utf8'))?.entries ?? []) : [];
  return VINT;
}

/**
 * YOU ASKED ABOUT A DATE EARLIER THAN THE TEXT THIS CORPUS HOLDS.
 *
 * Invariant I2 says a query resolves as of a date, and the engine honours it by filtering on
 * effective_from. What it did NOT do is say anything when the filter emptied an instrument out.
 * Asked what New York required of a breached health company on 2019-06-01, the engine returned
 * ZERO § 899-aa obligations and no comment — because every § 899-aa record it holds is dated
 * 2025-03-28. § 899-aa has existed since 2005. The honest answer is "a different text governed
 * then and this corpus does not hold it"; the answer given was silence.
 *
 * That is the false-gap failure this repository keeps re-finding: absence reported as though it
 * were coverage. meta/missing-vintages.yaml already describes the condition in terms — "the cost
 * is a false negative ... the text that governed then is not held" — and until now nothing in
 * engine/, bin/ or mcp/ read that file. A declaration nothing propagates into an answer is a
 * declaration that only protects the author.
 *
 * Two layers, because they fail differently:
 *   INSTRUMENT — a declared instrument is held, but every record of it postdates the as_of.
 *   PROVISION  — a specific record's text was PROVED younger than the date it used to claim, and
 *                meta/missing-vintages.yaml names the window.
 */
export function asOfVintageGaps(asOf, jurisdiction, corpus) {
  if (!asOf) return [];
  const out = [];
  const declared = decl()[jurisdiction]?.instruments ?? [];
  const records = kbOf(corpus).obligations ?? [];

  for (const instrument of declared) {
    const mine = records.filter(held => held.source?.instrument_id === instrument.id);
    if (!mine.length) continue;                       // absent entirely — coverageFor says so
    // Pending law is already routed to the watch feed by I3 and is not a vintage problem: its
    // date is in the FUTURE by design, not because an older text is missing.
    const inForce = mine.filter(held => held.status === 'in_force');
    if (!inForce.length) continue;
    const dates = inForce.map(held => held.effective_from).filter(Boolean).sort();
    const earliest = dates[0];
    if (!earliest || earliest <= asOf) continue;      // held text covers the date asked about
    // SAY ONLY WHAT THE CORPUS KNOWS. It knows when its own text begins. It does NOT know
    // whether the instrument existed earlier in another form — that is a fact about the world,
    // and asserting it would be this engine doing the thing it refuses everywhere else. The
    // first draft of this message said "the instrument existed before the text held here",
    // which is false for Local Law 144 and for the SAFE for Kids Act and was caught by reading
    // the output rather than by any gate.
    out.push(`${instrument.citation} is DECLARED and HELD, but every in-force record of it here ` +
      `begins ${earliest}, which is LATER than the ${asOf} you asked about. This corpus can say ` +
      `nothing about ${instrument.citation} on that date: either the instrument did not yet ` +
      `exist, or an earlier version governed and is not held. The empty result is a LIMIT OF ` +
      `THIS CORPUS, not a finding that nothing was required. Establish which before relying on it.`);
  }

  for (const entry of vintages()) {
    const from = entry.corpus_now_answers_from;
    if (!from || from <= asOf) continue;
    if (entry.status && entry.status !== 'open') continue;
    out.push(`${entry.citation}: this corpus answers only from ${from}. Its stored text was proved ` +
      `younger than ${entry.previously_claimed ?? 'the date the record once claimed'}, so the record ` +
      `was narrowed rather than left answering old questions with new words. For ${asOf} the ` +
      `governing text is not held. See meta/missing-vintages.yaml.`);
  }
  return out;
}

/** Does the corpus carry a given duty class for a jurisdiction? Presence of ANY atom is not enough. */
export function suppliesDuty(jurisdiction, duty, corpus) {
  const kb = kbOf(corpus);
  const have = (kb.obligations ?? [])
    .some(a => a.jurisdiction === jurisdiction && a.obligation_type === duty);
  const cov = coverageFor(jurisdiction, corpus);
  const wouldSupply = (cov.expected ?? []).filter(i => (i.supplies ?? []).includes(duty));
  const missing = wouldSupply.filter(i => !cov.present.some(p => p.id === i.id));
  return { have, missing, wouldSupply,
    note: have ? null
      : `${jurisdiction} carries no "${duty}" obligation. ` + (missing.length
        ? `The declared instruments that would supply it are absent: ` +
          missing.map(m => `${m.citation} (${m.title})`).join('; ') + '.'
        : `No declared instrument supplies it either — the gap is in the manifest, not just the corpus.`) };
}
