#!/usr/bin/env node
// WHAT KIND OF DATE IS `effective_from`? Gate 43's evidence engine.
//
// THE DEFECT. `effective_from` was a bare ISO date with no statement of what it measured, and
// across 248 records it silently mixed at least three incompatible things:
//
//   * a date the instrument itself states  — 45 C.F.R. § 46: "the general compliance date for
//     the 2018 Requirements is January 21, 2019". This one is an effective date on the
//     instrument's own authority.
//   * a date read off the citation apparatus — the public-law date in a USC <sourceCredit>, or
//     the Federal Register citation in an eCFR <SOURCE> block. This is a PUBLICATION or
//     ENACTMENT date standing in for effectiveness. Usually close. Not the same thing, and 29
//     records already said so in their own open_questions ("That is the Federal Register
//     publication date…").
//   * the source API's snapshot date — OpenLegislation's `activeDate`, which is not a property
//     of the law at all but of the fetch. All four N.Y. GBL § 899-aa records carried
//     effective_from 2025-03-28 on this basis, so the engine reported that New York's breach-
//     notification duty — in force since 2019 — did not exist on 1 February 2025. A false
//     negative, produced by a date that was never an effective date.
//
// Invariant I2 says there is no current law, only law as of a date. A date whose KIND is
// unknown cannot support that: `effective_from > as_of` is a sound comparison only if the left
// side means what the invariant assumes. So the kind is recorded, and it is recorded with
// evidence rather than assertion.
//
// THE BASIS IS DERIVED, NEVER DECLARED. A record cannot promote its own date by editing YAML:
// this tool re-derives every basis from the bytes on disk and gate 43 fails on disagreement,
// the same way gate 3 refuses a verbatim_span that is not in the source. `--write` stamps what
// the evidence supports; `--check` asserts the stamps still match.
//
//   node tools/date-basis.mjs            report the distribution
//   node tools/date-basis.mjs --write    stamp basis + evidence into every record
//   node tools/date-basis.mjs --check    exit 1 if any stamp disagrees with the evidence
//   --corpus <dir>                       operate on a fixture tree instead of corpus/

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);

/** The four kinds. Ordered strongest to weakest; only the first is an effective date on the
 *  instrument's own authority. */
export const BASES = {
  versioner_evidence: 'The source\'s own point-in-time record shows this exact span first '
    + 'appearing on this date. The strongest basis available: it is evidence about THIS TEXT '
    + 'rather than about the instrument, so it cannot be right about the rule and wrong about '
    + 'the words.',
  stated_in_text: 'The instrument\'s own words state this date — an effective, compliance or '
    + 'applicability date read from the operative text.',
  citation_apparatus: 'Read from the citation apparatus (a USC source credit, an eCFR Federal '
    + 'Register SOURCE/CITA note). A publication or enactment date standing in for '
    + 'effectiveness. Usually close; not the same claim.',
  api_snapshot: 'The source API\'s snapshot date (e.g. OpenLegislation activeDate). NOT a '
    + 'property of the law. A date on this basis cannot support an as-of comparison.',
  undetermined: 'Not traceable to anything the repository holds. The date may be right; nothing '
    + 'here shows that it is.',
};

/**
 * The kinds that CANNOT carry an as-of comparison. Gate 43 ratchets this population down.
 * Declared in engine/dates.mjs, because the engine is what compares dates and a second copy here
 * is how the two drift apart. Re-exported so existing importers of this module keep working.
 */
export { WEAK_BASES } from '../engine/dates.mjs';
import { WEAK_BASES } from '../engine/dates.mjs';

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.yaml') && p.includes('/atoms/')) out.push(p);
  }
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
const ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June',
              'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

/** Every spelling a US legal source plausibly uses for one ISO date. */
export function dateVariants(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return [];
  const [y, m, d] = iso.split('-').map(Number);
  return [`${MONTHS[m - 1]} ${d}, ${y}`, `${ABBR[m - 1]} ${d}, ${y}`, `${m}/${d}/${y}`, iso];
}

/** Every activeDate the fetched payload advertises, for the api_snapshot test. */
function apiSnapshotDates(src) {
  const key = src.raw_file ?? '';
  if (SNAPSHOT_CACHE.has(key)) return SNAPSHOT_CACHE.get(key);
  const out = new Set();
  const raw = src.raw_file && R(src.raw_file);
  if (raw) {
    const t = readCached(raw);
    if (t) for (const m of t.matchAll(/"activeDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"/g)) out.add(m[1]);
  }
  // The segmentation sits beside the raw file, one directory up, named after it.
  if (src.raw_file) {
    const stem = basename(src.raw_file).replace(/\.\w+$/, '');
    for (const cand of [R(join(dirname(src.raw_file), `${stem}.seg.json`)),
                        R(join(dirname(dirname(src.raw_file)), `${stem}.seg.json`))]) {
      const t = readCached(cand);
      if (!t) continue;
      for (const m of t.matchAll(/"active_date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/g)) out.add(m[1]);
    }
  }
  SNAPSHOT_CACHE.set(key, out);
  return out;
}

/** Is the date inside a citation-apparatus element rather than the operative text? */
function citationApparatusHit(rawText, variants) {
  for (const v of variants) {
    let i = -1;
    while ((i = rawText.indexOf(v, i + 1)) >= 0) {
      const before = rawText.slice(Math.max(0, i - 400), i);
      // The last element opened before the date is the one containing it.
      const tags = [...before.matchAll(/<([a-zA-Z][\w:-]*)[^>]*>/g)].map(m => m[1]);
      const last = tags[tags.length - 1];
      if (last && /^(date|CITA|PSPACE|ref)$/i.test(last)) return { hit: true, element: last, spelling: v };
      // eCFR wraps the FR citation in <SOURCE>…; the date lands in a child of it.
      if (/<SOURCE>(?:(?!<\/SOURCE>)[\s\S])*$/i.test(before)) return { hit: true, element: 'SOURCE', spelling: v };
    }
  }
  return { hit: false };
}

/**
 * Derive the basis for one record from the bytes on disk.
 * Order matters: api_snapshot is tested FIRST, because an OpenLegislation payload repeats its
 * activeDate inside the JSON body, so a text search would otherwise "find" it and report the
 * fetch date as though the statute had stated it.
 */
// FILE CACHE. deriveBasis reads a record's raw and rendered source to decide where its date came
// from. At 248 records that cost nothing; at 1,656 it is thousands of reads of multi-megabyte XML,
// and it made the gate suite — which runs validate once per fixture — take minutes. Sources are
// immutable within a run, so each is read once.
const FILE_CACHE = new Map();
function readCached(p) {
  if (!FILE_CACHE.has(p)) FILE_CACHE.set(p, existsSync(p) ? readFileSync(p, 'utf8') : null);
  return FILE_CACHE.get(p);
}
const SNAPSHOT_CACHE = new Map();

let VINTAGES = null;
/** The eCFR point-in-time findings, if tools/ecfr-vintages.mjs has produced them. Lazily read
 *  once: deriveBasis is called 248 times per validate run. */
function vintageFor(id) {
  if (VINTAGES === null) {
    const f = R('meta/ecfr-vintages.yaml');
    VINTAGES = new Map();
    if (existsSync(f)) {
      const rep = yaml.load(readFileSync(f, 'utf8')) ?? {};
      for (const x of rep.findings ?? []) VINTAGES.set(x.atom_id, x);
    }
  }
  return VINTAGES.get(id) ?? null;
}

/** Is the point-in-time report present? `versioner_evidence` can only be DERIVED when it is, so
 *  a gate re-deriving bases without it would report every such record as declaring a basis the
 *  bytes do not support — turning a missing artifact into eleven spurious record failures. */
export function vintagesAvailable() {
  vintageFor('');           // force the lazy load
  return VINTAGES.size > 0;
}

export function deriveBasis(rec) {
  const src = rec.source ?? {};
  const ef = rec.effective_from;
  if (!ef) return { basis: 'undetermined', evidence: 'no effective_from on this record' };
  const variants = dateVariants(ef);
  if (!variants.length)
    return { basis: 'undetermined', evidence: `effective_from ${JSON.stringify(ef)} is not an ISO date` };

  // POINT-IN-TIME EVIDENCE BEATS EVERYTHING ELSE, and is checked first for that reason. Every
  // other basis is evidence about the INSTRUMENT — when the rule was published, when it took
  // effect — and a span can be much younger than the rule that contains it. 47 C.F.R.
  // § 64.1200(d)(3) is the case: the section dates from 2003, and the words this corpus quotes
  // ("ten (10) business days") replaced "30 days" in April 2025. A basis drawn from the source's
  // own version history is about the words, so it cannot be right about the rule and wrong about
  // the text.
  const v = vintageFor(rec.id);
  if (v && v.verdict === 'changed' && v.span_first_seen === ef)
    return { basis: 'versioner_evidence',
             evidence: `this exact span is absent from ${src.citation ?? 'the source'} at `
                     + `${v.span_absent_at} and first appears at ${v.span_first_seen}, per the `
                     + `source's point-in-time record (window ${v.window}).` };

  if (apiSnapshotDates(src).has(ef))
    return { basis: 'api_snapshot',
             evidence: `equals the source payload's activeDate (${ef}). This is the date the API's `
                     + `snapshot was taken, not a date the law states.` };

  // The rendered text is the instrument's own words; the raw file also carries apparatus.
  const textPath = src.text_file && R(src.text_file);
  if (textPath) {
    const t = readCached(textPath);
    if (t) {
    const spelling = variants.find(v => t.includes(v));
    if (spelling)
      return { basis: 'stated_in_text',
               evidence: `"${spelling}" appears in the rendered text of ${src.text_file}` };
    }
  }

  const rawPath = src.raw_file && R(src.raw_file);
  const rawTxt = rawPath ? readCached(rawPath) : null;
  if (rawTxt) {
    const t = rawTxt;
    const ca = citationApparatusHit(t, variants);
    if (ca.hit)
      return { basis: 'citation_apparatus',
               evidence: `"${ca.spelling}" appears in a <${ca.element}> element of ${src.raw_file} — `
                       + `citation apparatus, not operative text` };
    if (variants.some(v => t.includes(v)))
      return { basis: 'citation_apparatus',
               evidence: `appears in ${src.raw_file} outside the operative text; the enclosing `
                       + `element could not be identified` };
  }

  return { basis: 'undetermined',
           evidence: src.raw_file
             ? `not found anywhere in ${src.raw_file}`
             : 'this record stores no raw source to check against' };
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const WRITE = argv.includes('--write');
  const CHECK = argv.includes('--check');
  const ci = argv.indexOf('--corpus');
  const files = walk(R(ci >= 0 ? argv[ci + 1] : 'corpus'));
  const dist = {}, disagree = [];

  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const rec = yaml.load(text);
    if (!rec?.id) continue;
    const { basis, evidence } = deriveBasis(rec);
    dist[basis] = (dist[basis] ?? 0) + 1;

    if (CHECK && rec.effective_from_basis !== basis)
      disagree.push({ id: rec.id, declared: rec.effective_from_basis ?? '(absent)', derived: basis, evidence });

    if (WRITE) {
      const lines = text.split('\n');
      const i = lines.findIndex(l => /^effective_to:/.test(l));
      if (i < 0) { console.log(`SKIP  ${rec.id} — no top-level effective_to: line to anchor to`); continue; }
      // Drop any existing stamp, then re-insert immediately after effective_to.
      let out = [];
      for (let j = 0; j < lines.length; j++) {
        if (/^effective_from_(basis|evidence):/.test(lines[j])) {
          while (j + 1 < lines.length && /^\s+\S/.test(lines[j + 1]) && !/^\S/.test(lines[j + 1])) j++;
          continue;
        }
        out.push(lines[j]);
      }
      const at = out.findIndex(l => /^effective_to:/.test(l));
      const stamp = yaml.dump({ effective_from_basis: basis, effective_from_evidence: evidence },
                              { lineWidth: 96, quotingType: '"' }).trimEnd().split('\n');
      out.splice(at + 1, 0, ...stamp);
      writeFileSync(f, out.join('\n'));
    }
  }

  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  const weak = WEAK_BASES.reduce((a, k) => a + (dist[k] ?? 0), 0);
  console.log(`\neffective_from basis across ${total} records\n`);
  for (const k of Object.keys(BASES)) console.log(`  ${String(dist[k] ?? 0).padStart(4)}  ${k}`);
  for (const k of Object.keys(dist)) if (!(k in BASES)) console.log(`  ${String(dist[k]).padStart(4)}  ${k}  <-- NOT IN BASES`);
  console.log(`\n  ${weak} of ${total} cannot carry an as-of comparison (${WEAK_BASES.join(' + ')}).`);

  if (CHECK && disagree.length) {
    console.log(`\n${disagree.length} record(s) declare a basis the evidence does not support:\n`);
    for (const d of disagree)
      console.log(`  ${d.id}\n    declared ${d.declared}, evidence supports ${d.derived}\n    ${d.evidence}`);
    console.log('\nA basis is DERIVED from the source bytes, never declared. Re-run --write.');
    process.exit(1);
  }
  if (WRITE) console.log('\nstamped.');
}
