#!/usr/bin/env node
// CUT EVERY SUBSTANTIVELY COMPLETE PROVISION OF A SOURCE AS A `provision` RECORD.
//
// WHAT THIS IS FOR. The repository holds 13,912 segmented, hashed leaves and had cut 248 records
// from them. Roughly 4,350 of those leaves are operative provisions that could be quoted. Writing
// applicability analysis for 4,350 provisions is not work that can be done at volume without
// guessing, and a guessed predicate is worse than an absent one because it FIRES — it makes the
// engine assert that a duty applies to someone.
//
// So the two claims are separated. An `obligation` record says the engine knows who a provision
// binds and when. A `provision` record says only this: the repository holds the exact text, with
// a verified citation, a dated vintage and a hash anyone can check. That second claim scales
// mechanically, because every part of it is read off bytes already on disk.
//
// THE SAFETY PROPERTY, and it is structural rather than a convention: engine/applicability.mjs
// iterates corpus.obligations, which is filtered on record_type === 'obligation'. A provision
// record cannot enter an applicability answer however it is written. It is reachable through
// privacy_cite, privacy_search and the contents page, which is where a lookup belongs.
//
// WHAT IS REFUSED. A leaf is skipped unless it is a complete operative statement:
//   * shorter than 80 characters — a fragment, not a provision
//   * ending in a colon — a chapeau. "A covered entity may disclose protected health
//     information:" is verbatim and says nothing, and quoting it is the exact failure this
//     repository exists to prevent
//   * no modal verb — a heading, a cross-reference, or an enumeration item
//   * not provably present in the raw source, which would mean the segmentation has drifted
//
//   node tools/bulk-provisions.mjs --source 45-cfr-164 --like us.cfr.45.164_508.a_1 [--dry]
//   node tools/bulk-provisions.mjs --plan          what every source would yield

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);
const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = argv.includes('--dry');
const LIMIT = Number(flag('--limit') ?? Infinity);
// SOME PARTS ARE MOSTLY NOT ABOUT PRIVACY. 47 C.F.R. part 64 is the whole of Telecommunications
// and 49 C.F.R. part 40 is the whole DOT testing procedure; in each, the privacy material is a
// couple of subparts. Cutting the rest would bulk the corpus with provisions no privacy question
// reaches, and a corpus padded with irrelevant text is harder to trust, not easier.
const ONLY = (flag('--sections') ?? '').split(',').map(x => x.trim()).filter(Boolean);
const inScope = section => !ONLY.length || ONLY.some(pre => String(section).startsWith(pre));

const decodeEntities = s => String(s)
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const norm = s => decodeEntities(String(s ?? '')).replace(/\s+/g, ' ').trim();

function walkFiles(dir, test, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkFiles(p, test, out);
    else if (test(e, p)) out.push(p);
  }
  return out;
}
const segFiles = () => walkFiles(R('corpus'), e => e.endsWith('.seg.json'));
const allRecords = () => walkFiles(R('corpus'), (e, p) => e.endsWith('.yaml') && p.includes('/atoms/'))
  .map(f => ({ file: f, rec: yaml.load(readFileSync(f, 'utf8')) })).filter(x => x.rec?.id);

/** Is this leaf a complete operative provision, or apparatus? */
function classify(text) {
  const t = norm(text);
  if (t.length < 80) return { cut: false, why: 'fragment' };
  if (t.endsWith(':')) return { cut: false, why: 'chapeau' };
  if (/^\([a-z0-9ivx]+\)\s*$/i.test(t)) return { cut: false, why: 'enumerator' };
  const mustNot = /\b(shall not|may not|must not|no .{0,40}\bshall\b)/i.test(t);
  const must = /\b(shall|must|is required to|are required to)\b/i.test(t);
  const may = /\bmay\b/i.test(t);
  if (!must && !may && !mustNot) return { cut: false, why: 'no operative modal' };
  const verb = mustNot ? 'must_not' : (must && may ? 'mixed' : (must ? 'must' : 'may'));
  return { cut: true, verb };
}

/** A stable, readable id segment from a section and path. */
// EVERY SEGMENT IS SANITISED, not just the section. In 45 C.F.R. § 160.103 the paragraph "path"
// is a DEFINED TERM rather than a number — ["Compliance date"] — and joining those raw produced
// ids carrying spaces, which the id pattern rightly refuses.
const slug = (section, path) =>
  [section, ...(path ?? [])]
    .map(part => String(part).replace(/[^a-z0-9]+/gi, '_'))
    .join('_').replace(/__+/g, '_').replace(/^_|_$/g, '').toLowerCase();

/**
 * An id namespace built from an instrument_id. `instrument_id` is a citation token and may
 * hold characters the id pattern forbids: ny.education.2-d is the instrument, but every id
 * under it in this corpus reads ny.education.2d. Passing the instrument_id through raw wrote
 * 5 records that gate 1 rejected outright, so the namespace is sanitised per dot-segment.
 */
const idBase = instrumentId => String(instrumentId)
  .split('.')
  .map(part => part.replace(/[^a-z0-9_]+/gi, '').toLowerCase())
  .filter(Boolean)
  .join('.');


/** Citation for a leaf, built from the sibling's citation style. */
/**
 * A TERM-KEYED SEGMENT IS QUOTED, NOT PARENTHESISED AS A DESIGNATOR. Gate 30 already states the
 * convention — "a term-keyed root is not a designator and is not written parenthetically in a
 * citation; it is cited by name" — but this function wrote one anyway, and 12 records shipped
 * citing 45 C.F.R. § 160.103(Compliance date). No such provision is addressable: § 160.103 has no
 * paragraph (Compliance date), and a reader who follows the citation finds nothing where it
 * points. Quoting makes it read as the name it is: § 160.103 ("Compliance date").
 */
const citeSegment = seg => (/^[A-Za-z0-9ivxlIVXL]{1,6}$/.test(String(seg))
  ? `(${seg})` : ` ("${seg}")`);

function citationFor(templateCitation, section, path) {
  const suffix = (path ?? []).map(citeSegment).join('').replace(/^\s+/, ' ').trimEnd();
  // "45 C.F.R. § 164.508(a)(1)" -> prefix "45 C.F.R. § "
  const m = /^(.*?§\s*)/.exec(templateCitation ?? '');
  const prefix = m ? m[1] : '';
  return `${prefix}${section}${suffix}`;
}

// ---------------------------------------------------------------- --plan
if (argv.includes('--plan')) {
  const held = new Set(allRecords().map(x => x.rec.source?.citation));
  const rows = [];
  for (const f of segFiles()) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    let cut = 0, skip = {};
    for (const l of j.leaves ?? []) {
      const c = classify(l.text);
      if (c.cut) cut++; else skip[c.why] = (skip[c.why] ?? 0) + 1;
    }
    if (cut) rows.push([basename(f, '.seg.json'), j.label ?? '', cut, (j.leaves ?? []).length]);
  }
  rows.sort((x, y) => y[2] - x[2]);
  console.log('SEGMENTATION'.padEnd(26) + 'CUTTABLE   LEAVES');
  for (const r of rows) console.log(String(r[0]).padEnd(26) + String(r[2]).padStart(8) + String(r[3]).padStart(9));
  console.log(`\n${rows.reduce((n, r) => n + r[2], 0)} cuttable across ${rows.length} sources.`);
  process.exit(0);
}

// ---------------------------------------------------------------- cut
const sourceStem = flag('--source');
const likeId = flag('--like');
if (!sourceStem || !likeId) {
  console.log('usage: --source <seg-stem> --like <sibling atom id> [--limit N] [--dry]  |  --plan');
  process.exit(1);
}
const segPath = segFiles().find(f => basename(f, '.seg.json') === sourceStem);
if (!segPath) throw new Error(`no segmentation ${sourceStem}.seg.json`);
const seg = JSON.parse(readFileSync(segPath, 'utf8'));

const records = allRecords();
const template = records.find(x => x.rec.id === likeId);
if (!template) throw new Error(`--like record "${likeId}" not found`);
const T = template.rec;
const SRC = JSON.parse(JSON.stringify(T.source));
const outDir = dirname(template.file);

// Citations already held as OBLIGATIONS are not re-cut as provisions: the analysed record is
// strictly better and two records over one provision is gate 41's business.
const heldCitations = new Set(records.map(x => x.rec.source?.citation));

const rawRaw = readFileSync(R(SRC.raw_file), 'utf8');
let rawText;
if (/json/i.test(SRC.format ?? '') || SRC.raw_file.endsWith('.json')) {
  const collected = [];
  (function collect(node) {
    if (typeof node === 'string') collected.push(node);
    else if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === 'object') Object.values(node).forEach(collect);
  })(JSON.parse(rawRaw));
  rawText = collected.join(' ').replace(/\\[nrt]/g, ' ');
} else {
  rawText = rawRaw.replace(/<[^>]+>/g, ' ');
}
rawText = norm(rawText);

// A PATH THAT IS NOT UNIQUE IS NOT A CITATION. Gate 23 refuses one, and it is right to: a record
// citing § 164.514(e)(1) when two different texts sit at that path cites nothing in particular.
// Where it happens the cause is a WALKER defect rather than an ambiguous source — 45 C.F.R.
// § 164.514(e)(1) collides with an enumeration item reading "Discontinued disclosure of protected
// health information to the recipient; and", which is plainly a deeper subparagraph the
// segmentation assigned to the wrong path. Skipping is honest; picking one would manufacture a
// citation. The count is reported so the collisions stay visible as a finding about the walker.
const pathCount = new Map();
for (const l of seg.leaves ?? []) {
  const k = `${l.section}::${JSON.stringify((l.path ?? []).map(String))}`;
  pathCount.set(k, (pathCount.get(k) ?? 0) + 1);
}

let written = 0, skipped = 0, notInSource = 0, already = 0, ambiguous = 0, outOfScope = 0;
const reasons = {};

for (const leaf of seg.leaves ?? []) {
  if (written >= LIMIT) break;
  if (!inScope(leaf.section)) { outOfScope++; continue; }
  const c = classify(leaf.text);
  if (!c.cut) { skipped++; reasons[c.why] = (reasons[c.why] ?? 0) + 1; continue; }
  const span = norm(leaf.text);
  const pathK = `${leaf.section}::${JSON.stringify((leaf.path ?? []).map(String))}`;
  if ((pathCount.get(pathK) ?? 0) > 1) { ambiguous++; continue; }
  const citation = citationFor(T.source?.citation, leaf.section, leaf.path);
  if (heldCitations.has(citation)) { already++; continue; }

  // PROVED IN THE SOURCE BEFORE WRITING. If this fails the segmentation has drifted from the
  // bytes, which is a finding about the walker rather than about the record.
  if (!rawText.includes(span)) { notInSource++; continue; }

  const id = `${idBase(T.source.instrument_id)}.p.${slug(leaf.section, leaf.path)}`;
  const rec = {
    schema_version: 1,
    record_type: 'provision',
    verification_status: 'verbatim_confirmed',
    jurisdiction: T.jurisdiction,
    jurisdiction_level: T.jurisdiction_level,
    regulator: T.regulator ?? [],
    sector: T.sector ?? [],
    data_types: T.data_types ?? [],
    status: 'in_force',
    effective_from: T.effective_from,
    effective_to: null,
    supersedes: null,
    superseded_by: null,
    amendment_history: [],
    confidence: 'medium',
    id,
    source: { ...SRC, citation },
    verbatim_span: span,
    paragraph_path: {
      path: (leaf.path ?? []).map(String),
      anchor: String(leaf.section),
      derivation: 'structural',
      confidence: leaf.confidence ?? 'high',
      evidence: `read from ${basename(segPath)}, the segmentation of ${SRC.raw_file}`,
    },
    subject: T.subject,
    // GATE 18: a nested leaf quoted alone is verbatim and may be substantively wrong. The
    // segmentation already carries each leaf's governing chapeaux and continuations, so the
    // context travels with the record rather than being asserted absent. `relation: scopes` is
    // the honest default for a chapeau that governs what follows; anything narrower is a legal
    // characterisation this tool is not entitled to make, which is why nothing here is ever
    // labelled `excepts`.
    operative_context: (leaf.context ?? [])
      .filter(cx => norm(cx.text))
      .map(cx => ({
        position: cx.position === 'follows' ? 'follows' : 'precedes',
        relation: 'scopes',
        verbatim_span: norm(cx.text),
        path: (cx.path ?? []).map(String),
        citation: citationFor(T.source?.citation, leaf.section, cx.path),
      })),
    operative_verb: c.verb,
    // A finding aid, never an analysis. The first sentence of the provision's own words is used
    // deliberately: any compression written at volume would be an assertion nobody checked, and
    // this one cannot be wrong about what the provision says because it IS what it says.
    // The first sentence, unless that is too short to identify anything — a definition reading
    // "means the date by which..." splits badly, and a two-word summary is not a finding aid.
    summary: (() => {
      const first = (span.split(/(?<=\.)\s+/)[0] ?? '').trim();
      return (first.length >= 40 ? first : span).slice(0, 300);
    })(),
    context_not_required: (leaf.context ?? []).some(cx => norm(cx.text)) ? undefined
      : 'The segmentation records no governing chapeau or continuation for this leaf, so the span '
        + 'stands alone in its own source. It is quoted as the source presents it.',
    not_yet_analysed:
      'Held as reference text. No applicability predicate has been written for it, so the engine '
      + 'does not assert that it binds anyone — a provision record is never read by '
      + 'engine/applicability.mjs. Promoting it to an obligation means writing applies_if, '
      + 'obligation_type and requirement_detail, and passing the gates that check them.',
    open_questions: [],
  };

  const file = join(outDir, `${id.replace(/[.]/g, '-')}.yaml`);
  if (!DRY) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, yaml.dump(rec, { lineWidth: 100, quotingType: "'", noRefs: true }));
  }
  written++;
}

console.log(`${DRY ? 'would cut' : 'cut'} ${written} provision record(s) from ${basename(segPath)}`);
console.log(`  already held as a record : ${already}`);
console.log(`  not provable in source   : ${notInSource}`);
console.log(`  skipped as apparatus     : ${skipped}  ${JSON.stringify(reasons)}`);
console.log(`  path not unique (walker) : ${ambiguous}`);
if (ONLY.length) console.log(`  outside --sections filter: ${outOfScope}`);
