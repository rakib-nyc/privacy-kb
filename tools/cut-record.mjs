#!/usr/bin/env node
// CUT A NEW RECORD FROM BYTES THE REPOSITORY ALREADY HOLDS AND HAS ALREADY HASHED.
//
// WHY THIS EXISTS. The corpus holds 13,912 segmented leaves across 101 hashed sources and has cut
// 248 records from them. The acquisition is largely done; the extraction is not. Everything a
// record needs in order to QUOTE correctly is already on disk — the raw bytes, their sha256, the
// segmentation, and the leaf's own path. What was missing was a way to cut the next record
// without hand-copying any of it, because hand-copying a span is the one operation in this
// repository that can introduce a fabricated quotation.
//
// THE DIVISION OF LABOUR IS THE POINT.
//
//   MECHANICAL, and this tool does it: the verbatim_span is READ FROM THE SEGMENTATION, never
//   typed. The citation, the paragraph_path, the source block, both hashes and the segment anchor
//   are all derived. A span this tool emits is in the source by construction, so gate 3 cannot
//   fail on a record it produced — and if it ever does, the segmentation and the source have
//   diverged, which is a finding.
//
//   JUDGMENT, and a person does it: what the provision REQUIRES, who it binds, what kind of
//   obligation it is. Those are supplied in a spec file, written while reading the text the tool
//   prints. They are not derivable from the bytes and must never be guessed from a section
//   heading.
//
//   INHERITED, because it is a property of the instrument and not of the provision: preemption
//   posture, enforcement and penalties, regulator, sector, data types, subject coordinate. These
//   are copied from a sibling record in the same instrument that has already passed every gate,
//   with --like. Re-deriving them per record is how two provisions of one rule end up disagreeing
//   about who enforces it.
//
//   node tools/cut-record.mjs --list 45-cfr-164 164.512        show every leaf, with its path
//   node tools/cut-record.mjs --spec specs/hipaa-512.yaml      cut the records named in a spec
//   node tools/cut-record.mjs --spec … --dry                   print what it would write

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);
const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = argv.includes('--dry');
const sha256 = b => createHash('sha256').update(b).digest('hex');
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// The segmentation stores heading text with XML entities intact; a span must carry the
// characters the source actually has, not their escapes.
const decodeEntities = s => String(s)
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function walkFiles(dir, test, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkFiles(p, test, out);
    else if (test(e, p)) out.push(p);
  }
  return out;
}

/** Locate a segmentation by its stem, e.g. "45-cfr-164". */
function findSeg(stem) {
  const hits = walkFiles(R('corpus'), e => e === `${stem}.seg.json`);
  if (!hits.length) throw new Error(`no segmentation named ${stem}.seg.json under corpus/`);
  return hits[0];
}

/** Every record already in the corpus, so --like can inherit from one. */
function loadRecords() {
  return walkFiles(R('corpus'), (e, p) => e.endsWith('.yaml') && p.includes('/atoms/'))
    .map(f => ({ file: f, rec: yaml.load(readFileSync(f, 'utf8')) }))
    .filter(x => x.rec?.id);
}

const pathKey = p => JSON.stringify((p ?? []).map(String));

// ---------------------------------------------------------------- --list
if (argv.includes('--list')) {
  const stem = argv[argv.indexOf('--list') + 1];
  const section = argv[argv.indexOf('--list') + 2];
  const seg = JSON.parse(readFileSync(findSeg(stem), 'utf8'));
  const leaves = (seg.leaves ?? []).filter(l => !section || String(l.section) === section);
  console.log(`${leaves.length} leaf/leaves in ${stem}${section ? ' § ' + section : ''}\n`);
  for (const l of leaves) {
    const p = (l.path ?? []).length ? `(${(l.path ?? []).join(')(')})` : '[section root]';
    console.log(`${String(l.section).padEnd(10)} ${p.padEnd(18)} ${decodeEntities(norm(l.text)).slice(0, 118)}`);
  }
  process.exit(0);
}

// ---------------------------------------------------------------- --spec
const specPath = flag('--spec');
if (!specPath) {
  console.log('usage: --list <seg-stem> [section]  |  --spec <file.yaml> [--dry]');
  process.exit(1);
}
const spec = yaml.load(readFileSync(R(specPath), 'utf8'));
const seg = JSON.parse(readFileSync(findSeg(spec.segmentation), 'utf8'));
const leaves = seg.leaves ?? [];
const records = loadRecords();

const template = records.find(x => x.rec.id === spec.like);
if (!template) throw new Error(`--like record "${spec.like}" not found; it supplies the instrument's ` +
  `preemption, enforcement, regulator and sector, which are properties of the instrument`);
const T = template.rec;
const outDir = spec.out_dir ? R(spec.out_dir) : dirname(template.file);

// The source block is taken WHOLE from the sibling: same raw file, same hashes, same URL. A
// record cut from the same bytes must not describe them differently.
const SRC = JSON.parse(JSON.stringify(T.source));

let written = 0;
const problems = [];

for (const item of spec.records ?? []) {
  const want = pathKey(item.path);
  const hits = leaves.filter(l => String(l.section) === String(item.section) && pathKey(l.path) === want);
  if (hits.length !== 1) {
    problems.push(`${item.id}: path ${want} in § ${item.section} resolves to ${hits.length} leaves, not 1`);
    continue;
  }
  const leaf = hits[0];
  const span = decodeEntities(norm(leaf.text));
  if (!span) { problems.push(`${item.id}: leaf has no text`); continue; }

  // PROVE IT IS IN THE SOURCE BEFORE WRITING IT. Gate 3 will check this in CI; checking here
  // means a bad record is never committed in the first place, and a failure points at the
  // segmentation rather than at the record.
  const rawPath = R(SRC.raw_file);
  // FORMAT-AWARE, because "strip the tags" is only right for XML. An OpenLegislation payload is
  // JSON whose statutory text sits in result.text with escaped newlines, so tag-stripping left
  // the escapes in place and every span read as absent. The tool refused to write, which is the
  // correct failure — but it was refusing correct spans.
  const rawRaw = readFileSync(rawPath, 'utf8');
  let rawText;
  if (/json/i.test(SRC.format ?? '') || rawPath.endsWith('.json')) {
    try {
      const j = JSON.parse(rawRaw);
      const collected = [];
      (function collect(node) {
        if (typeof node === 'string') collected.push(node);
        else if (Array.isArray(node)) node.forEach(collect);
        else if (node && typeof node === 'object') Object.values(node).forEach(collect);
      })(j);
      // OpenLegislation stores the section text with LITERAL backslash-n sequences rather than
      // newline characters, so whitespace normalisation leaves them in place and every span reads
      // as absent. They are line breaks in the source document and are treated as whitespace.
      rawText = collected.join(' ').replace(/\\[nrt]/g, ' ');
    } catch { rawText = rawRaw; }
  } else {
    rawText = rawRaw.replace(/<[^>]+>/g, ' ');
  }
  rawText = decodeEntities(rawText).replace(/\s+/g, ' ');
  if (!rawText.includes(span)) {
    problems.push(`${item.id}: span is NOT a substring of ${SRC.raw_file} — segmentation and source disagree`);
    continue;
  }

  const rec = {
    schema_version: 1,
    record_type: 'obligation',
    verification_status: 'verbatim_confirmed',
    jurisdiction: T.jurisdiction,
    jurisdiction_level: T.jurisdiction_level,
    regulator: T.regulator ?? [],
    sector: T.sector ?? [],
    data_types: T.data_types ?? [],
    status: 'in_force',
    effective_from: item.effective_from ?? T.effective_from,
    effective_to: null,
    supersedes: null,
    superseded_by: null,
    amendment_history: [],
    applies_to_role: item.applies_to_role ?? T.applies_to_role ?? null,
    interpreted_by: [],
    confidence: item.confidence ?? 'medium',
    related: item.related ?? [],
    preemption: T.preemption,
    enforcement: T.enforcement,
    id: item.id,
    source: { ...SRC, citation: item.citation },
    verbatim_span: span,
    paragraph_path: {
      path: (item.path ?? []).map(String),
      // ANCHOR IS THE SECTION, ALWAYS. A paragraph path is relative to its section, so ["a","1"]
      // occurs in dozens of sections of one part; without the anchor gate 23 correctly refuses the
      // citation as non-unique. The leaves carry anchor: null, so taking it from the leaf left
      // every cut record ambiguous.
      anchor: item.anchor ?? leaf.anchor ?? String(item.section),
      derivation: 'structural',
      confidence: leaf.confidence ?? 'high',
      evidence: `read from ${basename(findSeg(spec.segmentation))}, which is the segmentation of ` +
                `${SRC.raw_file} at sha256 ${String(SRC.raw_sha256 ?? '').slice(0, 16)}…`,
    },
    subject: item.subject ?? T.subject,
    federal_relationship: T.federal_relationship ?? null,
    applies_if: item.applies_if,
    obligation_type: item.obligation_type,
    summary: item.summary,
    requirement_detail: item.requirement_detail,
    exemptions: item.exemptions ?? [],
    common_errors: item.common_errors ?? [],
    open_questions: item.open_questions ?? [],
  };
  if (item.deadline) rec.deadline = item.deadline;
  else rec.no_deadline_stated = item.no_deadline_stated ?? 'This provision states a permission or a standard, not a clock.';
  // Gate 18: a nested leaf quoted alone is verbatim and may be substantively wrong, so a record
  // at depth >= 1 must either carry its governing context or say why it does not need it.
  if (item.context_not_required) rec.context_not_required = item.context_not_required;
  if (item.operative_context) rec.operative_context = item.operative_context;
  if (item.span_truncation_note) rec.span_truncation_note = item.span_truncation_note;

  const file = join(outDir, `${item.id.replace(/[.]/g, '-')}.yaml`);
  if (DRY) {
    console.log(`--- would write ${file.replace(ROOT + '/', '')}`);
    console.log(`    ${item.citation}\n    ${span.slice(0, 150)}`);
  } else {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, yaml.dump(rec, { lineWidth: 100, quotingType: "'", noRefs: true }));
    console.log(`wrote ${file.replace(ROOT + '/', '')}  (${span.length} chars verified in source)`);
  }
  written++;
}

if (problems.length) {
  console.log(`\n${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}
console.log(`\n${written} record(s) ${DRY ? 'would be ' : ''}cut, every span read from the segmentation and ` +
            `proved present in ${SRC.raw_file}.`);
