// WHAT A PROVISION REQUIRES, ENUMERATED — AND WHAT THIS CORPUS CANNOT SEE OF IT.
//
// A statute that imposes a document requirement almost always LISTS the elements: 45 C.F.R.
// § 164.520(b) for a Notice of Privacy Practices, § 164.504(e)(2) for a business-associate
// contract, § 164.404(c) and N.Y. GBL § 899-aa(7) for a breach letter. Those elements are held
// here as individual records, each with its own verbatim words, citation, paragraph path and
// sha256 of the bytes it was cut from.
//
// That is the one job the 1,400 `provision` records are perfectly shaped for. They answer no
// applicability question by design — and a checklist is not an applicability question. It is an
// enumeration, and enumeration is exactly what a sampling system cannot hold still: three
// identical prompts to a search-grounded model produced three different obligation lists in this
// project's own benchmark. A checklist that is sometimes fourteen items and sometimes eleven is
// not a checklist.
//
// THE HALF THAT MATTERS MORE IS THE GAP REPORT.
//
// § 164.520(b)(1)(ii) has subparagraphs (A) through (E) in the Code. This corpus holds (C), (D)
// and (E). Presenting twelve elements as "the requirements" would be a checklist that is wrong in
// the quiet direction — the reader ticks every box and is still missing two, and nothing says so.
// That is this repository's oldest failure shape, and a conformance feature is the worst possible
// place to reproduce it.
//
// So sibling designators are checked for CONTIGUITY. Where a run skips, the missing designators
// are named. The enumeration is reported as bounded, always, and the gap list travels with it.
import { load, surfaceable } from './corpus.mjs';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';

const ROMAN = ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi','xii','xiii','xiv','xv',
               'xvi','xvii','xviii','xix','xx'];

/** Which designator sequence a set of siblings is drawn from, or null when it cannot be told. */
function sequenceKind(designators) {
  const all = designators.filter(Boolean).map(String);
  if (!all.length) return null;
  if (all.every(d => /^\d+$/.test(d))) return 'numeric';
  // Roman is tested BEFORE single-letter, because "i" and "v" are both. A run of length one is
  // genuinely ambiguous and gets no gap report rather than a guessed one — see
  // meta/extractor-assumptions.yaml roman-and-letter-designators-collide.
  if (all.length > 1 && all.every(d => ROMAN.includes(d.toLowerCase()))) return 'roman';
  if (all.every(d => /^[a-z]$/.test(d))) return 'lower';
  if (all.every(d => /^[A-Z]$/.test(d))) return 'upper';
  return null;
}

function ordinalOf(designator, kind) {
  const d = String(designator);
  if (kind === 'numeric') return parseInt(d, 10);
  if (kind === 'roman') return ROMAN.indexOf(d.toLowerCase()) + 1;
  if (kind === 'lower') return d.charCodeAt(0) - 96;
  if (kind === 'upper') return d.charCodeAt(0) - 64;
  return null;
}

function designatorAt(ordinal, kind) {
  if (kind === 'numeric') return String(ordinal);
  if (kind === 'roman') return ROMAN[ordinal - 1] ?? `?${ordinal}`;
  if (kind === 'lower') return String.fromCharCode(96 + ordinal);
  if (kind === 'upper') return String.fromCharCode(64 + ordinal);
  return `?${ordinal}`;
}

/**
 * Missing designators in a sibling run.
 *
 * THE HEAD AND THE TAIL ARE NOT SYMMETRIC, and treating them the same is what made the first
 * version of this under-report.
 *
 * A HOLE inside the run — (A),(B),(D) — is unambiguous. So is a run that does not START at the
 * first designator: legal enumerations begin at (A), (1) or (i), so a set that begins at (C) is
 * evidence that (A) and (B) exist and are not held. That is the § 164.520(b)(1)(ii) case exactly
 * — the corpus holds (C),(D),(E) and the Code has five — and an earlier version of this function
 * reported no gap there, which is the quiet direction.
 *
 * The TAIL genuinely cannot be known. If the corpus holds (A),(B),(C) and the Code has (D), an
 * absent (D) is indistinguishable from the list simply ending. Reporting one would manufacture a
 * gap that may not exist, so nothing is claimed past the highest designator held.
 */
function holesIn(designators) {
  const kind = sequenceKind(designators);
  if (!kind) return { kind: null, missing: [], truncated_head: false };
  const ordinals = designators.map(d => ordinalOf(d, kind)).filter(n => Number.isFinite(n));
  if (!ordinals.length) return { kind, missing: [], truncated_head: false };
  const hi = Math.max(...ordinals);
  const have = new Set(ordinals);
  const missing = [];
  // From 1 rather than from min: a run starting above 1 is a gap at the head, not a short list.
  for (let n = 1; n <= hi; n++) if (!have.has(n)) missing.push(designatorAt(n, kind));
  const lo = Math.min(...ordinals);
  return { kind, missing, truncated_head: lo > 1 };
}

const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();

// SECTION IDENTITY ACROSS TWO ANCHOR FORMATS. The corpus writes paragraph_path.anchor either as
// a plain designator ("227", "164.520") or as a USLM identifier ("/us/usc/t15/s45/a/1"), and the
// segmentations carry a plain section. Comparing them raw makes every USLM-anchored provision
// fail to match its own leaves — which this module reported, correctly but uselessly, as "the
// denominator cannot be established". Reducing both sides to a section designator resolves it.
// Dashes are normalised because USLM writes 1320d–5 with an en dash where the file name writes
// 1320d-5. tools/validate.mjs carries the same reduction for gates 23, 38 and 39.
const DASHES = /[\u2010-\u2015\u2212]/g;
const sectionKey = value => {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(DASHES, '-').trim();
  if (text === 'undefined') return null;
  const uslm = text.match(/^\/us\/usc\/t[^/]+\/s([^/]+)/i);
  return (uslm ? uslm[1] : text).toLowerCase();
};

const ROOT = resolve(import.meta.dirname, '..');
let SEG_INDEX = null;

/** Every *.seg.json in the corpus, indexed by the raw_file it segments. */
function segIndex() {
  if (SEG_INDEX) return SEG_INDEX;
  SEG_INDEX = new Map();
  const walk = dir => {
    let entries = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const full = join(dir, name);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.seg.json')) continue;
      try {
        const doc = JSON.parse(readFileSync(full, 'utf8'));
        const key = basename(String(doc.raw_file ?? ''));
        if (key && !SEG_INDEX.has(key)) SEG_INDEX.set(key, doc);
      } catch { /* a malformed segmentation is not a reason to fail the query */ }
    }
  };
  walk(join(ROOT, 'corpus'));
  return SEG_INDEX;
}

/**
 * THE DENOMINATOR, READ FROM THE SOURCE RATHER THAN GUESSED FROM DESIGNATORS.
 *
 * Designator contiguity can spot a hole inside a run and a run that starts late. It cannot see a
 * list that was cut short: the corpus holds § 164.504(e)(2)(i)(A) and (B), the run is contiguous
 * from the first letter, and nothing about it hints that the segmentation holds SIXTEEN leaves
 * under (e)(2). Presenting two elements as "the business-associate contract terms" would be a
 * checklist missing most of its items with no sign that anything was missing.
 *
 * The segmentation is the honest denominator. It is the source cut into addressable provisions —
 * every leaf the walker found, whether or not a record was ever written for it — and it ships
 * beside the raw bytes it was cut from. Comparing records against it is the same inversion this
 * repository applies everywhere else: declare what should be there, then compare.
 */
function segmentationGap(parent, heldPaths) {
  const raw = basename(String(parent.source?.raw_file ?? ''));
  const doc = raw ? segIndex().get(raw) : null;
  if (!doc) return { available: false, expected: 0, missing: [] };
  const path = parent.paragraph_path?.path ?? [];
  const anchor = String(parent.paragraph_path?.anchor ?? '');

  // MATCH ON PATH, FILTER ON SECTION ONLY WHEN THE TWO ARE COMPARABLE.
  //
  // The corpus carries two anchor formats — plain section numbers like "227" and USLM
  // identifiers like "/us/usc/t15/s1681g" — and every USLM segmentation was written with
  // `section: undefined`, because the walker never set it. Comparing anchor to section across
  // that mismatch excluded every leaf and reported `expected: 0` with `available: true`, which
  // reads as "this list is complete". It is the false all-clear this feature exists to prevent,
  // produced by the feature itself.
  //
  // So: path prefix within the same raw file is the match. The section is used only as a
  // tie-break where both sides actually carry a comparable value, and where the filter removes
  // everything the result reports that it COULD NOT DETERMINE rather than that there is nothing.
  const byPath = (doc.leaves ?? []).filter(leaf => {
    const lp = leaf?.path;
    if (!Array.isArray(lp) || lp.length <= path.length) return false;
    return path.every((seg, i) => lp[i] === seg);
  });
  const wantSection = sectionKey(anchor);
  const comparable = wantSection !== null &&
    byPath.some(leaf => sectionKey(leaf.section ?? leaf.anchor) !== null);
  const under = comparable
    ? byPath.filter(leaf => sectionKey(leaf.section ?? leaf.anchor) === wantSection)
    : byPath;

  if (comparable && byPath.length && !under.length)
    return { available: false, expected: null, missing: [],
      why: `the segmentation of ${raw} holds ${byPath.length} leaf/leaves beneath this path, but ` +
           `none whose section matches the anchor "${anchor}". The denominator cannot be ` +
           `established, which is NOT the same as there being no further elements.` };

  const held = new Set(heldPaths.map(p => p.join('>')));
  const missing = under
    .filter(leaf => !held.has(leaf.path.join('>')))
    .map(leaf => ({ path: leaf.path, designation: `(${leaf.path.join(')(')})`,
                    preview: norm(leaf.text).slice(0, 120),
                    preview_full: norm(leaf.text) }));
  return { available: true, expected: under.length, missing };
}


/**
 * Resolve a citation straight to a segmentation leaf's text.
 *
 * A record is the preferred resolution and the caller should try that first. This is the fallback
 * for a provision the corpus holds only as source bytes — 45 C.F.R. § 164.308(a) and
 * N.Y. GBL § 899-bb(2)(b)(ii)(A) are both real, both quotable, and neither was cut into a record.
 * The text still comes from a file this repository holds and hashes, so a quotation from it is
 * checkable; it simply has not been through the gate apparatus, and every caller must say so.
 */
export function segmentationLeafFor(citation, corpus) {
  const kb = corpus ?? load();
  const wanted = norm(citation);
  const designators = [...wanted.matchAll(/\(([^)]+)\)/g)].map(hit => hit[1]);
  if (!designators.length) return null;
  const base = wanted.replace(/(\([^)]*\))+\s*$/, '').trim();

  // Any held record from the same section tells us the raw file and anchor to look in.
  const sibling = (kb.all ?? []).find(record => surfaceable(record) &&
    norm(record.source?.citation).startsWith(base + '(') && record.source?.raw_file);
  if (!sibling) return null;
  const raw = basename(String(sibling.source.raw_file));
  const doc = segIndex().get(raw);
  if (!doc) return null;
  const anchor = String(sibling.paragraph_path?.anchor ?? '');

  const leaf = (doc.leaves ?? []).find(candidate => {
    if (anchor && String(candidate.section ?? candidate.anchor ?? '') !== anchor) return false;
    const p = candidate?.path;
    return Array.isArray(p) && p.length === designators.length &&
           p.every((seg, i) => seg === designators[i]);
  });
  if (!leaf || !norm(leaf.text)) return null;
  return { citation: wanted, path: leaf.path, verbatim_span: norm(leaf.text),
           sha256: sibling.source?.raw_sha256 ?? null, source_url: sibling.source?.url ?? null,
           fetched: sibling.source?.fetched ?? null };
}

/**
 * Every element the corpus holds beneath a provision, with the gaps it can detect.
 * Total: an unknown citation returns a shaped refusal rather than throwing or improvising.
 */
export function requirementsFor(citation, corpus, options) {
  const kb = corpus ?? load();
  // COMPLETE MODE. A checklist that lists 12 of 30 requirements and names the other 18 in a
  // footnote is honest but not usable — the drafter still has to go and read the regulation.
  // Including the segmentation leaves makes it usable, and labelling each row's provenance keeps
  // it honest: a `record` row is verbatim_confirmed and gate-checked, a `segmentation` row is
  // text from the same hash-anchored source bytes that no record was ever written for. Both are
  // quotations from the same file; only one has been through the apparatus. Never merge the
  // labels, and never present the second as the first.
  const includeSeg = options?.include_segmentation === true;
  const wanted = norm(citation);
  if (!wanted) return { found: false, citation: null, elements: [], gaps: [],
                        error: 'no citation given' };

  // I1: a suppressed record may not be a parent, and may not be an element. See brief.mjs.
  let parent = (kb.all ?? []).find(record =>
    norm(record.source?.citation) === wanted && surfaceable(record));

  // THE PARENT NEED NOT BE A RECORD.
  //
  // 45 C.F.R. § 164.404(c) — what a breach letter must say — is not itself an obligation record;
  // the corpus holds its children. Refusing there would be refusing the exact question the
  // feature exists for, and on a technicality about which nodes happened to get cut. The
  // segmentation holds the node, hash-anchored to the same source bytes, so a synthetic parent is
  // built from a held DESCENDANT's source and the designators in the citation itself. Nothing is
  // invented: the raw file, the anchor and the segmentation all come from records this corpus
  // holds, and the path is read off the citation the caller typed.
  let synthetic = false;
  if (!parent) {
    const kin = (kb.all ?? []).filter(record => surfaceable(record) &&
      norm(record.source?.citation).startsWith(wanted + '(') && record.paragraph_path?.path);
    if (kin.length) {
      const designators = [...wanted.matchAll(/\(([^)]+)\)/g)].map(hit => hit[1]);
      const sample = kin[0];
      // A BARE SECTION IS A LEGITIMATE PARENT. "15 U.S.C. § 1681g" carries no parenthesised
      // designator, so requiring designators.length here refused every section-level citation
      // even where the corpus plainly held its children — § 1681g(a)(1) among them — and the
      // caller was told nothing was addressable there. The empty list is vacuously satisfied by
      // every child, which is the right reading: a section's path is the empty prefix of its
      // paragraphs. The kin test above is what does the work, and it is exact — a child must
      // literally cite "<wanted>(" — so nothing looser is being admitted by dropping the guard.
      if (designators.every((seg, i) => sample.paragraph_path.path[i] === seg)) {
        parent = { id: null, record_type: 'segmentation-node',
                   source: { ...sample.source, citation: wanted },
                   paragraph_path: { path: designators, anchor: sample.paragraph_path.anchor },
                   verbatim_span: null, effective_from: null };
        synthetic = true;
      }
    }
  }

  if (!parent)
    return { found: false, citation: wanted, elements: [], gaps: [],
      error: `This corpus does not hold "${wanted}", and no record beneath it either, so its ` +
             `elements cannot be located. Try \`privacy-kb find\` for the citation as this ` +
             `corpus spells it.` };

  const path = parent.paragraph_path?.path;
  const anchor = parent.paragraph_path?.anchor;
  const raw = parent.source?.raw_file;
  if (!Array.isArray(path))
    return { found: true, citation: wanted, parent: brief(parent), elements: [], gaps: [],
      error: `"${wanted}" carries no paragraph path, so its sub-elements cannot be located. ` +
             `Enumeration is unavailable for this record, which is not the same as the ` +
             `provision having no elements.` };

  const kin = (kb.all ?? []).filter(record =>
    surfaceable(record) &&
    record.source?.raw_file === raw &&
    record.paragraph_path?.anchor === anchor &&
    Array.isArray(record.paragraph_path?.path));

  const descendants = kin.filter(record => {
    const p = record.paragraph_path.path;
    return p.length > path.length && path.every((seg, i) => p[i] === seg);
  }).sort((lhs, rhs) =>
    norm(lhs.source?.citation).localeCompare(norm(rhs.source?.citation), 'en', { numeric: true }));

  // Gap detection runs per PARENT LEVEL, not over the whole set: siblings only make a sequence
  // against their own immediate parent.
  // A designator counts as PRESENT if it appears anywhere in a descendant's path, not only if a
  // record sits at that exact depth. The corpus stores leaves; intermediate levels like
  // § 164.520(b)(1)(ii) exist as structure without being records of their own. Counting only
  // depth+1 records reported (i) through (v) as missing from (b)(1) while holding several of
  // their children — a gap report that is itself a false gap, which would have been a poor way
  // to launch a feature whose whole selling point is not doing that.
  const levels = new Map();
  for (const record of descendants) {
    const p = record.paragraph_path.path;
    for (let depth = path.length; depth < p.length; depth++) {
      const key = p.slice(0, depth).join('>');
      if (!levels.has(key)) levels.set(key, new Set());
      levels.get(key).add(p[depth]);
    }
  }
  const gaps = [];
  for (const [key, seen] of levels) {
    const designators = [...seen];
    const { kind, missing, truncated_head } = holesIn(designators);
    if (missing.length) {
      const under = key ? key.split('>') : path;
      gaps.push({ under: `(${under.join(')(')})`, sequence: kind, missing,
                  held: designators.length, truncated_head });
    }
  }

  const denominator = segmentationGap(parent, descendants.map(r => r.paragraph_path.path));
  const held = descendants.map(record => ({ ...brief(record), provenance: 'record' }));
  // The designation is a full path from the SECTION root, so it appends to the section base and
  // not to the parent citation — otherwise § 164.404(c) plus designation (c)(1) renders as
  // "§ 164.404(c)(c)(1)", a citation to nothing.
  const sectionBase = wanted.replace(/(\([^)]*\))+\s*$/, '').trim();
  const fromSeg = includeSeg
    ? denominator.missing.map(miss => ({
        atom_id: null, citation: `${sectionBase}${miss.designation}`,
        path: miss.path, record_type: 'segmentation-leaf', verbatim_span: miss.preview_full ?? miss.preview,
        sha256: parent.source?.raw_sha256 ?? null, source_url: parent.source?.url ?? null,
        fetched: parent.source?.fetched ?? null, effective_from: null, provenance: 'segmentation' }))
    : [];
  const elements = [...held, ...fromSeg].sort((lhs, rhs) =>
    (lhs.path ?? []).join('>').localeCompare((rhs.path ?? []).join('>'), 'en', { numeric: true }));

  return { found: true, citation: wanted, parent: brief(parent), parent_is_segmentation_node: synthetic,
           elements, count: elements.length,
           held_as_records: held.length, from_segmentation: fromSeg.length,
           gaps, denominator, error: null };
}

function brief(record) {
  return { atom_id: record.id, citation: record.source?.citation,
           path: record.paragraph_path?.path, record_type: record.record_type,
           verbatim_span: norm(record.verbatim_span),
           sha256: record.source?.raw_sha256 ?? record.source?.text_sha256 ?? null,
           source_url: record.source?.url ?? null, fetched: record.source?.fetched ?? null,
           effective_from: record.effective_from ?? null };
}

/**
 * ONE DOCUMENT, SEVERAL REGIMES.
 *
 * A breach letter to a New York patient must satisfy 45 C.F.R. § 164.404(c) and N.Y. GBL
 * § 899-aa(7) at the same time. The requirement is the UNION of both element sets, and an
 * element demanded by both should appear once, carrying both citations — otherwise the drafter
 * either writes the same thing twice or, worse, satisfies one regime and reads the list as done.
 *
 * Elements are merged on their normalised verbatim text. That is deliberately literal: two
 * provisions that say the same thing in different words stay separate, because deciding they are
 * "the same requirement" is a legal judgement and this function does not make those. It reports
 * what each regime demands, in its own words, deduplicated only where the words are identical.
 */
export function unionRequirements(citations, corpus, options) {
  const kb = corpus ?? load();
  const list = Array.isArray(citations) ? citations : [citations];
  const sources = [], merged = new Map(), gaps = [], unavailable = [];

  for (const citation of list) {
    const set = requirementsFor(citation, kb, options);
    if (!set.found || set.error) { unavailable.push({ citation, reason: set.error }); continue; }
    sources.push({ citation: set.citation, count: set.count || (set.parent?.verbatim_span ? 1 : 0),
                   whole_provision: set.count === 0 && !!set.parent?.verbatim_span });
    for (const gap of set.gaps) gaps.push({ ...gap, from: set.citation });
    // A PROVISION WITH NO SUB-ELEMENTS IS ITSELF THE REQUIREMENT.
    //
    // N.Y. GBL § 899-aa(7) states the breach-notice content in one subdivision; OpenLegislation
    // does not segment below that level, so it has no children. Contributing nothing to the union
    // would have made a federal+New York checklist carry no New York requirement at all — the
    // regime with the shorter clock silently absent from the merged list.
    const contributions = set.elements.length ? set.elements
      : (set.parent?.verbatim_span ? [set.parent] : []);
    for (const element of contributions) {
      const key = element.verbatim_span;
      if (!merged.has(key)) merged.set(key, { ...element, demanded_by: [] });
      merged.get(key).demanded_by.push(element.citation);
    }
  }

  const elements = [...merged.values()];
  const shared = elements.filter(element => element.demanded_by.length > 1).length;
  // The union's incompleteness is the SUM of its parts' incompleteness, and it has to travel with
  // the list. A merged checklist that looks longer than either source reads as more complete than
  // either source, which is the opposite of the truth when both were partial.
  const notHeld = [];
  for (const citation of list) {
    const set = requirementsFor(citation, kb);
    if (set?.denominator?.available)
      for (const miss of set.denominator.missing) notHeld.push({ ...miss, from: set.citation });
  }
  return { sources, unavailable, elements, count: elements.length, shared, gaps,
           not_held: notHeld };
}
