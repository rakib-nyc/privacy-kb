#!/usr/bin/env node
// CI GATES (SCHEMA.md §6). A commit fails if any gate trips.
//
// Gate 3 is the important one: it is a mechanical check that makes fabricated
// quotation structurally impossible to commit. It compares verbatim_span against
// the stored raw bytes, so an atom can only claim words the source actually has.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import * as yaml from 'js-yaml';
import { evaluate as engineEvaluate, UNKNOWN as ENGINE_UNKNOWN } from '../engine/predicates.mjs';
import { diff as computeDiff, narrate as narrateDiff } from './compute-differs.mjs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);
const sha256 = b => createHash('sha256').update(b).digest('hex');
const TODAY = new Date().toISOString().slice(0, 10);

const failures = [];
// Probe a predicate against EMPTY facts. UNKNOWN is fine — it means a fact is missing.
// REFUSED is not: it means the expression can never be evaluated at all.
function evalExpr(expr) {
  try {
    const r = engineEvaluate(expr, { entity: {}, data: {}, event: {}, purpose: {}, practice: {}, law: {} });
    return { refused: r.refused ?? null };
  } catch (e) { return { refused: e.message }; }
}
// B-4: gate x format applicability, declared not inferred.
const GA = (() => {
  const f = R('meta/gate-applicability.yaml');
  if (!existsSync(f)) return null;
  return yaml.load(readFileSync(f, 'utf8'));
})();
const gateStatus = (gate, fmt) => {
  if (!GA) return 'APPLIES';
  if ((GA.format_independent ?? []).includes(Number(gate))) return 'APPLIES';
  const row = GA.gates?.[gate];
  if (!row) return 'APPLIES';
  if (typeof row.all === 'string') return row.all;
  const cell = row[fmt];
  return typeof cell === 'string' ? cell : (cell?.status ?? 'APPLIES');
};
// Every gate reports how much it actually examined. A gate that examined nothing
// is indistinguishable from a gate that passed, unless the count is printed.
const examined = {};
const bump = (g, n = 1) => { examined[g] = (examined[g] ?? 0) + n; };
const fail = (gate, atomId, msg) => failures.push({ gate, atomId, msg });
// A GATE THAT CANNOT SEE ITS INPUT IS INDISTINGUISHABLE FROM A GATE THAT PASSES. Gate 23 skipped
// every atom whose segmentation did not sit beside its raw file, and fourteen atoms were invisible
// to it for their entire existence. The moment the files arrived it found COPPA § 312.3's ["a"]
// resolving to six different provisions and two HIPAA breach paths resolving to nothing. Silence
// had read as approval.
//
// So a gate that declines to examine a record must SAY SO, with a reason, and gate 32 asserts the
// reasons are ones we have accepted in advance.
const skipped = [];
const skip = (gate, atomId, reason) => skipped.push({ gate, atomId, reason });
const notes = [];

// ---------------------------------------------------------------- collect atoms
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.yaml') && p.includes('/atoms/')) out.push(p);
  }
  return out;
}
const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const CORPUS = flag('--corpus') ?? 'corpus';
const QUIET = argv.includes('--quiet');
const atomFiles = walk(R(CORPUS));

// ------------------------------------------------------------- coverage index
const coverage = yaml.load(readFileSync(R('meta/coverage.yaml'), 'utf8'));
const VALID_COORDS = new Set();        // performance-indicator leaves
const VALID_COMPETENCIES = new Set();  // competency codes
for (const d of coverage.domains)
  for (const c of d.competencies) {
    VALID_COMPETENCIES.add(c.coordinate);
    for (const pi of c.performance_indicators) VALID_COORDS.add(pi.coordinate);
  }

// ------------------------------------------------------------------ gate 1
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
// One schema per record_type (SCHEMA.md §2). An unknown record_type is a gate-1
// failure rather than a silent skip, so a typo cannot smuggle a record past CI.
const SCHEMAS = {
  obligation: ajv.compile(JSON.parse(readFileSync(R('schemas/atom.schema.json'), 'utf8'))),
  principle:  ajv.compile(JSON.parse(readFileSync(R('schemas/principle.schema.json'), 'utf8'))),
  certification_scheme: ajv.compile(JSON.parse(readFileSync(R('schemas/certification-scheme.schema.json'), 'utf8'))),
  taxonomy: ajv.compile(JSON.parse(readFileSync(R('schemas/taxonomy.schema.json'), 'utf8'))),
  authority: ajv.compile(JSON.parse(readFileSync(R('schemas/authority.schema.json'), 'utf8'))),
  definition: ajv.compile(JSON.parse(readFileSync(R('schemas/definition.schema.json'), 'utf8'))),
  enforcement_action: ajv.compile(JSON.parse(readFileSync(R('schemas/enforcement-action.schema.json'), 'utf8'))),
  workflow_constraint: ajv.compile(JSON.parse(readFileSync(R('schemas/workflow-constraint.schema.json'), 'utf8'))),
  doctrine: ajv.compile(JSON.parse(readFileSync(R('schemas/doctrine.schema.json'), 'utf8'))),
};

// verbatim_span vs raw text: whitespace is normalised on BOTH sides, because PDF
// and HTML extraction inserts line breaks that are not part of the quoted words.
// Nothing else is normalised — quotation marks, dashes and casing must match, so
// a reworded "quote" still fails.
const norm = s => s.replace(/\s+/g, ' ').trim();

const atoms = [];
for (const f of atomFiles) {
  const rel = relative(ROOT, f);
  let a;
  try { a = yaml.load(readFileSync(f, 'utf8')); }
  catch (e) { fail(1, rel, `YAML parse error: ${e.message}`); continue; }
  atoms.push({ rel, a });

  const kind = a?.record_type ?? 'obligation';
  const validate = SCHEMAS[kind];
  if (!validate) { fail(1, a?.id ?? rel, `unknown record_type "${kind}"`); continue; }
  bump(1);
  if (!validate(a)) {
    for (const e of validate.errors.slice(0, 6))
      fail(1, a?.id ?? rel, `schema[${kind}]: ${e.instancePath || '/'} ${e.message}`);
    continue;
  }

  const src = a.source;

  // ---- risk_tier is derived from format. Asserting it independently would let a
  // multi-column PDF be quietly labelled low and skip gates 11 and 12.
  // nyc_xml is LOW for the same reason uslm_xml is: real element nesting, so depth is read from
  // the markup rather than reconstructed. It is a structured export from the publishing authority,
  // not a rendering of a document.
  const RISK = { uslm_xml: 'low', ecfr_xml: 'low', openleg_json: 'low', html: 'low', nyc_xml: 'low',
                 pdf_single_col: 'medium', pdf_multi_col: 'high', manual: 'high' };
  if (src.format && RISK[src.format] !== src.risk_tier)
    fail(1, a.id, `risk_tier "${src.risk_tier}" does not match format "${src.format}" (expected "${RISK[src.format]}")`);

  // ---- gate 2: verbatim_confirmed needs a resolvable raw file whose hash matches
  // A doctrine record has no fetched document — raw_file is null by schema, because Supreme
  // Court opinions have no structured source and the record quotes nothing. Every such record is
  // verification_status: unverified and suppressed by invariant I1, so the hash and substring
  // gates below have nothing to check and must not try.
  const rawPath = src.raw_file ? R(src.raw_file) : null;
  let rawBuf = null;
  if (a.verification_status === 'verbatim_confirmed') {
    if (!rawPath) {
      skip(2, a.id, 'record-has-no-raw-file');
    } else if (!existsSync(rawPath)) {
      fail(2, a.id, `raw_file missing: ${src.raw_file}`);
    } else {
      bump(2);
      rawBuf = readFileSync(rawPath);
      const h = sha256(rawBuf);
      if (h !== src.raw_sha256)
        fail(2, a.id, `raw_sha256 mismatch\n      recorded ${src.raw_sha256}\n      actual   ${h}`);
    }
    // MIGRATION 004. An exemption may quote a DIFFERENT document from the one the atom
    // obligates in — 45 C.F.R. 164.502(a) is obligated in part 164 and excepted in part 160.
    // A cross-instrument citation gets the same integrity guarantee as a same-instrument one,
    // or it is worth nothing: hash it exactly as the atom's own source is hashed.
    const refBearing = [
      ...(a.exemptions ?? []).map((x, i) => [`exemptions[${i}]`, x.source_ref]),
      // The interpreting document is hashed on the same terms. A guidance quotation whose source
      // could drift under it would be worse than no quotation, because it reads as verified.
      ...(a.interpreted_by ?? []).map((x, i) => [`interpreted_by[${i}]`, x.source_ref]),
    ];
    for (const [where, ref] of refBearing) {
      if (!ref) continue;
      const rp = R(ref.raw_file);
      if (!existsSync(rp)) { fail(2, a.id, `${where}.source_ref.raw_file missing: ${ref.raw_file}`); continue; }
      bump(2);
      const rh = sha256(readFileSync(rp));
      if (rh !== ref.raw_sha256)
        fail(2, a.id, `${where}.source_ref.raw_sha256 mismatch for ${ref.raw_file}` +
          `\n      recorded ${ref.raw_sha256}\n      actual   ${rh}`);
    }
  }

  // ---- gate 3: every verbatim span must be an exact substring of the source
  if (a.verification_status === 'verbatim_confirmed') {
    let hay = null, hayName = null;
    if (src.text_file) {
      const tp = R(src.text_file);
      if (!existsSync(tp)) fail(3, a.id, `text_file missing: ${src.text_file}`);
      else {
        const tb = readFileSync(tp);
        if (src.text_sha256 && sha256(tb) !== src.text_sha256)
          fail(2, a.id, `text_sha256 mismatch for ${src.text_file}`);
        hay = norm(tb.toString('utf8')); hayName = src.text_file;
      }
    } else if (rawBuf) {
      hay = norm(rawBuf.toString('utf8')); hayName = src.raw_file;
    }
    if (hay) {
      // NON-VACUITY: a haystack that collapsed to nothing would make every
      // substring check meaningless. Fail loudly rather than mysteriously.
      bump(14);
      // Same distinction as the dual-parse check below: a one-sentence statute yields a short
      // haystack legitimately. Judge by proportion to the raw source, not by an absolute floor.
      const rawSize = existsSync(rawPath) ? statSync(rawPath).size : 0;
      if (hay.length < 200 && !(rawSize > 0 && hay.length / rawSize > 0.02))
        fail(14, a.id, `gate 3 haystack is only ${hay.length} chars from ${rawSize} raw bytes ` +
          `(${hayName}) — the rendering collapsed; this check would be vacuous`);
      else bump(3);
      // APPARATUS POLICY: a span is never edited to remove apparatus. Where the
      // operative text is unavoidably interrupted, the removal is recorded in
      // span_interruptions and REBUILT here — insert every excluded_text back at its
      // offset and the result must appear in the source. The words themselves cannot
      // be changed without breaking reconstruction, so I1 survives the exception.
      const rebuild = (span, ints) => {
        if (!ints?.length) return span;
        let out = '', prev = 0;
        for (const it of [...ints].sort((x, y) => x.offset - y.offset)) {
          if (it.offset > span.length) return null;
          out += span.slice(prev, it.offset) + it.excluded_text;
          prev = it.offset;
        }
        return out + span.slice(prev);
      };
      // MIGRATION 004. Each exemption resolves against source_ref when it has one, and against
      // the atom's own source otherwise. The alternative — searching every raw file in the
      // corpus — was rejected: a span could then match an unrelated instrument by coincidence
      // and source_citation would go back to being unverified prose, which is the exact
      // property gate 3 exists to destroy. Naming the file makes the citation checkable.
      const refHay = new Map();
      const hayFor = ref => {
        if (!ref) return [hay, hayName];
        if (refHay.has(ref.raw_file)) return refHay.get(ref.raw_file);
        const rp = R(ref.raw_file);
        // Prefer the rendered text beside the raw file, exactly as the atom's own source does:
        // gate 3 compares against the renderer's output, never against markup.
        const tp = rp.replace(/\.[^.]+$/, '.txt');
        const pick = existsSync(tp) ? tp : rp;
        const pair = existsSync(pick) ? [norm(readFileSync(pick).toString('utf8')), pick] : [null, ref.raw_file];
        refHay.set(ref.raw_file, pair);
        return pair;
      };
      const spans = [['verbatim_span', a.verbatim_span, a.span_interruptions, null],
                     ...(a.exemptions ?? []).map((x, i) =>
                       [`exemptions[${i}].verbatim_span`, x.verbatim_span, null, x.source_ref ?? null]),
                     // Context is quoted law, not annotation. It gets the same check.
                     ...(a.operative_context ?? []).map((x, i) =>
                       [`operative_context[${i}].verbatim_span`, x.verbatim_span, null, null]),
                     // AN INTERPRETATION MUST QUOTE A DOCUMENT THE CORPUS HOLDS. interpreted_by was
                     // an unconstrained array and empty everywhere, so nothing checked what a
                     // guidance claim rested on. Invariant I7 keeps guidance out of the statutory
                     // citation; this keeps it from being unsourced prose in the next field along.
                     ...(a.interpreted_by ?? []).map((x, i) =>
                       [`interpreted_by[${i}].verbatim_span`, x.verbatim_span, null, x.source_ref ?? null])];
      for (const [where, span, ints, ref] of spans) {
        if (!span) continue;
        const [hayHere, hayHereName] = hayFor(ref);
        if (!hayHere) { fail(3, a.id, `${where}: source_ref points at ${ref.raw_file}, which cannot be read`); continue; }
        if (ref) bump(3);
        const rebuilt = rebuild(span, ints);
        if (rebuilt === null) {
          fail(3, a.id, `${where}: a span_interruption offset lies beyond the span`);
          continue;
        }
        if (!hayHere.includes(norm(rebuilt))) {
          const via = ints?.length ? ` (reconstructed through ${ints.length} span_interruption(s))` : '';
          fail(3, a.id, `${where} is not a substring of ${hayHereName}${via}\n      span: ${norm(rebuilt).slice(0, 90)}…`);
        }
      }
    }
  }

  // ---- gate 4: nothing in force from the future
  bump(4);
  if (a.status === 'in_force' && a.effective_from && a.effective_from > TODAY)
    fail(4, a.id, `status in_force but effective_from ${a.effective_from} > today ${TODAY}`);

  // ---- gate 5: state atoms must declare their federal relationship
  if (kind === 'obligation') bump(5);
  if (kind === 'obligation' && a.jurisdiction_level === 'state' && !a.federal_relationship)
    fail(5, a.id, 'state atom lacks federal_relationship');

  // ---- gate 6: taxonomy coordinate must exist in meta/coverage.yaml.
  // Obligations must land on a performance indicator. Non-obligation records may
  // sit at competency level, because an interpretive frame underpins the whole
  // competency and pinning it to one indicator would be invented precision.
  const coord = a.subject?.domain;
  bump(6);
  if (kind === 'obligation') {
    if (!VALID_COORDS.has(coord))
      fail(6, a.id, `subject.domain "${coord}" is not a performance indicator in meta/coverage.yaml`);
  } else if (!VALID_COORDS.has(coord) && !VALID_COMPETENCIES.has(coord)) {
    fail(6, a.id, `subject.domain "${coord}" is neither a competency nor a leaf in meta/coverage.yaml`);
  }

  // ---- gate 7: a notify obligation without a deadline is incomplete
  if (kind === 'obligation') bump(7);
  // A notice duty with NO STATUTORY CLOCK is a real thing — 15 U.S.C. § 1681m(a) requires notice
  // of adverse action and fixes no period — and inventing one to satisfy this gate would be
  // exactly the fabrication gate 3 exists to prevent, one field over. So the absence must be
  // DECLARED rather than tolerated: no_deadline_stated carries the reason and the citation
  // checked. Silence still fails.
  if (kind === 'obligation' && a.obligation_type === 'notify' && !a.deadline) {
    const why = (a.no_deadline_stated ?? '').trim();
    if (!why)
      fail(7, a.id, 'obligation_type notify without a deadline, and without a no_deadline_stated ' +
        'explanation. If the source fixes no period, say so and say where you looked.');
    else if (why.length < 40)
      fail(7, a.id, `no_deadline_stated is too thin to be a finding: "${why}"`);
  }

  // ---- gate 9: a principle is not an obligation. Guard the one confusion that
  // would let an aspiration be cited as a duty.
  bump(9);
  if (kind === 'certification_scheme') {
    // A scheme records adherence in scheme.adherence_mechanism AND at top level;
    // they must agree, because the top-level field is what queries read.
    if (a.scheme?.adherence_mechanism !== a.adherence_mechanism)
      fail(9, a.id, `adherence_mechanism disagrees: scheme says "${a.scheme?.adherence_mechanism}", record says "${a.adherence_mechanism}"`);
    if ('obligation_type' in a) fail(9, a.id, 'certification_scheme record carries obligation_type');
  }
  if (kind === 'principle') {
    // A framework addressed to states has no adherence mechanism. If a principle
    // record claims one, the certification scheme has been collapsed into the
    // framework document — the modelling error this type exists to prevent.
    if (a.adherence_mechanism && a.adherence_mechanism !== 'none')
      fail(9, a.id, `principle record claims adherence_mechanism "${a.adherence_mechanism}" — an organization cannot join a framework document; model the certification scheme separately`);
    if (a.framework?.binding === true && !a.framework?.authority_tier)
      fail(9, a.id, 'framework.binding true without an authority_tier');
    if ('obligation_type' in a) fail(9, a.id, 'principle record carries obligation_type');
  }
}

// ---- gate 11: DUAL-RENDERER AGREEMENT (pdf_* sources).
// Gate 3 proves a span is faithful to the rendering. It cannot prove the rendering
// is faithful to the document — a baseline-offset bug in this repo's own column
// extractor once emitted "with the consent of the individual a) whose ..." and every
// gate passed. So every span from a PDF is checked against a SECOND rendering built
// by a different engine (pdfplumber/pdfminer) that shares no layout code with the
// first. Divergence blocks the commit.
const altCache = new Map();
function altRender(src) {
  const r = src.render ?? {};
  const key = JSON.stringify([src.raw_file, r]);
  if (altCache.has(key)) return altCache.get(key);
  // column, pages and drop_re transfer between engines: the first two are page
  // geometry and the third is a line-content regex. min_height deliberately does
  // NOT transfer — poppler reports a word's box height while pdfplumber reports
  // glyph height, so the same number means different things (CBPR body text is
  // 14.65 to poppler and 12.0 to pdfplumber). Passing it across would silently
  // erase the whole document and turn gate 11 into a gate that always passes.
  // Omitting it makes the alt rendering a superset — footnotes survive in it —
  // which is harmless for a substring check and keeps the comparison honest.
  const args = [R('tools/render-alt.py'), R(src.raw_file)];
  if (r.column) args.push('--column', r.column);
  if (r.pages) args.push('--pages', r.pages);
  for (const d of r.drop_re ?? []) args.push('--drop-re', d);
  let out;
  try { out = execFileSync('python3', args, { encoding: 'utf8', maxBuffer: 64 << 20 }); }
  catch (e) { out = null; console.error(`  gate 11: alt renderer failed for ${src.raw_file}: ${e.message}`); }
  altCache.set(key, out);
  return out;
}
// EXHAUSTIVE, not sampled. CBPR proved you cannot predict from a document's shape
// whether a renderer fault manifests in it: APEC sets its subparagraph markers on
// the same baseline as their text and hid the identical bug through an entire
// instrument. Every pdf_* span is checked.
// Structured sources (xml, html) go through tools/dual-parse.py: two engines, compared
// on serialized text AND an identifier inventory. Text comparison cannot see attributes,
// and identifier attributes are what paragraph_path rests on.
const dpCache = new Map();
function dualParse(src) {
  const key = src.raw_file;
  if (dpCache.has(key)) return dpCache.get(key);
  let out = null;
  try {
    out = JSON.parse(execFileSync('python3',
      [R('tools/dual-parse.py'), R(src.raw_file), '--format', src.format, '--json'],
      { encoding: 'utf8', maxBuffer: 256 << 20 }));
  } catch (e) { console.error(`  gate 11: dual-parse failed for ${src.raw_file}: ${e.message}`); }
  dpCache.set(key, out);
  return out;
}
const canon = t => t.replace(/\s+/g, '');
for (const { a } of atoms) {
  const fmt = a?.source?.format;
  // Every precondition below is a DECLINED EXAMINATION and is now recorded as one. Gate 23
  // proved that an unrecorded skip is indistinguishable from a pass: it reported a healthy
  // number for the entire life of fourteen atoms it had never looked at.
  if (!fmt) { skip(11, a?.id ?? '(unknown)', 'record-declares-no-source-format'); continue; }
  if (fmt.startsWith('pdf_')) continue;                 // handled by the alt-render pass below
  if (a.verification_status !== 'verbatim_confirmed') { skip(11, a.id, 'record-not-verbatim-confirmed'); continue; }
  if (gateStatus(11, fmt) === 'INAPPLICABLE-BY-DESIGN') { skip(11, a.id, `gate-inapplicable-for-${fmt}`); continue; }
  if (gateStatus(11, fmt) === 'UNGUARDED-GAP') { skip(11, a.id, `unguarded-gap-accepted-for-${fmt}`); continue; }
  const r = dualParse(a.source);
  if (!r) { fail(11, a.id, `dual-parse produced no result for ${a.source.raw_file}`); continue; }
  // NON-VACUITY first: two empty strings agree.
  bump(14);
  // "Short" and "collapsed" are different, and a flat threshold cannot tell them apart. N.Y. GBL
  // § 350 is one sentence — "False advertising in the conduct of any business ... is hereby
  // declared unlawful" — so a 152-character render is the WHOLE SECTION, not a failure. The test
  // is proportion: if both engines recovered a sensible share of the raw bytes, nothing collapsed.
  // A genuine collapse produces a render that is tiny RELATIVE TO ITS SOURCE.
  {
    const rawBytes = existsSync(R(a.source.raw_file)) ? statSync(R(a.source.raw_file)).size : 0;
    const shortest = Math.min(r.len_a, r.len_b);
    const proportionate = rawBytes > 0 && shortest / rawBytes > 0.02;
    if (shortest < 200 && !proportionate) {
      fail(14, a.id, `gate 11 dual-parse produced almost nothing (a=${r.len_a} b=${r.len_b}) from ` +
        `${rawBytes} raw bytes for ${a.source.raw_file} — the rendering collapsed and the ` +
        `comparison would be vacuous`);
      continue;
    }
    if (shortest < 200)
      notes.push(`${a.id}: dual-parse compared only ${shortest} chars, but that is ${Math.round(100 * shortest / rawBytes)}% ` +
        `of the ${rawBytes}-byte source — a genuinely short section, not a collapsed render`);
  }
  // NON-VACUITY for openleg_json: the unescape must be COMPLETE. A literal backslash-n
  // surviving into the rendering means the transformation silently did nothing.
  if (a.source.format === 'openleg_json') {
    const hayRaw = existsSync(R(a.source.text_file ?? '')) ? readFileSync(R(a.source.text_file), 'utf8') : '';
    if (/\\n/.test(hayRaw))
      fail(14, a.id, 'the openleg_json rendering still contains literal backslash-n — the unescape did not complete, so gate 3 is checking against an un-transformed string');
    if (/\\n/.test(a.verbatim_span))
      fail(15, a.id, 'verbatim_span contains a literal backslash-n escape — API encoding, not statutory text');
  }
  if (!r.text_agree) {
    const d = r.first_divergence ?? {};
    fail(11, a.id, `the two independent parses of ${a.source.raw_file} disagree on text.\n      One of them is wrong. Do not "fix" the span — find out which.\n      A: ${(d.a ?? '').slice(0, 80)}\n      B: ${(d.b ?? '').slice(0, 80)}`);
    continue;
  }
  if (!r.inventory_agree) {
    fail(11, a.id, `the two independent parses of ${a.source.raw_file} disagree on the identifier inventory — an attribute differs, which text comparison cannot see`);
    continue;
  }
  bump(11);
}
for (const { a } of atoms) {
  if (!a?.source?.format?.startsWith('pdf_')) continue;   // non-pdf handled by the pass above
  if (a.verification_status !== 'verbatim_confirmed') { skip(11, a.id, 'record-not-verbatim-confirmed'); continue; }
  const alt = altRender(a.source);
  if (alt === null) { fail(11, a.id, `second renderer could not process ${a.source.raw_file}`); continue; }
  const hay = norm(alt);

  // NON-VACUITY, before comparing anything. This is the min_height lesson: a
  // parameter that erased the alt rendering would leave gate 11 comparing spans
  // against an empty string. Observed primary/alt ratios across this corpus are
  // 0.88-0.97 and 418-3224 chars per page, so these bounds are generous.
  const prim = a.source.text_file && existsSync(R(a.source.text_file))
    ? norm(readFileSync(R(a.source.text_file), 'utf8')).length : null;
  bump(14);
  if (hay.length < 200) {
    fail(14, a.id, `gate 11 alt rendering is only ${hay.length} chars for ${a.source.raw_file} — it produced no usable text, so the comparison would be vacuous`);
    continue;
  }
  if (prim && Math.min(prim, hay.length) / Math.max(prim, hay.length) < 0.5) {
    fail(14, a.id, `gate 11 renderings disagree on size: primary ${prim} chars vs independent ${hay.length} (ratio ${(Math.min(prim,hay.length)/Math.max(prim,hay.length)).toFixed(2)}). One of them dropped content; comparing spans would be misleading.`);
    continue;
  }
  bump(11);
  const spans = [['verbatim_span', a.verbatim_span, a.span_interruptions],
                 ...(a.exemptions ?? []).map((x, i) => [`exemptions[${i}]`, x.verbatim_span, null]),
                 ...(a.source_defects ?? []).map((x, i) => [`source_defects[${i}].as_published`, x.as_published, null])];
  for (const [where, span, ints] of spans) {
    if (!span) continue;
    // Where apparatus interrupts the span, the two renderers will spell the
    // apparatus differently — poppler emits "certification 1 ." and pdfplumber
    // "certification1." for the same footnote marker. Neither is operative text, so
    // reconstructing with one renderer's form and searching the other's output is
    // meaningless. Instead require every OPERATIVE segment to appear in the
    // independent rendering, in order, at advancing positions. That proves the
    // operative words are all present and correctly sequenced without either
    // renderer having to agree on how apparatus is drawn.
    const segs = [];
    if (ints?.length) {
      let prev = 0;
      for (const it of [...ints].sort((x, y) => x.offset - y.offset)) {
        segs.push(span.slice(prev, it.offset)); prev = it.offset;
      }
      segs.push(span.slice(prev));
    } else segs.push(span);

    let at = 0, bad = null;
    for (const seg of segs.map(norm).filter(Boolean)) {
      const found = hay.indexOf(seg, at);
      if (found < 0) { bad = seg; break; }
      at = found + seg.length;
    }
    if (bad !== null)
      fail(11, a.id, `${where} does not appear in the independent rendering of ${a.source.raw_file}.\n      One of the two renderers is wrong. Do not "fix" the span — find out which.\n      segment: ${bad.slice(0, 90)}…`);
  }
}

// ---- gate 12: VISUAL SPOT-CHECK COVERAGE, selected by FEATURE.
// Risk tier does not predict where renderer faults appear — two same-tier,
// same-shape documents behaved differently, and a medium-tier single-column one
// produced the footnote divergence. So this runs over EVERY pdf_* instrument and
// requires that each extraction-hostile feature actually present in that
// instrument's spans has been looked at by eye at least once. The floor of three
// is capped at the number of spans that exist, because an instrument with one
// span cannot be sampled three ways.
{
  const VC = R('meta/visual-checks.yaml');
  const log = existsSync(VC) ? (yaml.load(readFileSync(VC, 'utf8')) ?? {}) : {};
  const checks = log.checks ?? [];
  const FP = R('meta/source-features.yaml');
  const feat = existsSync(FP) ? (yaml.load(readFileSync(FP, 'utf8')) ?? {}) : {};
  const spanFeat = new Map((feat.spans ?? []).map(x => [x.record_id, x.features ?? []]));
  const spanHash = t => sha256(Buffer.from(norm(t), 'utf8')).slice(0, 16);
  const byId = new Map(atoms.map(x => [x.a?.id, x.a]));

  // Gate 12 examines PDF-sourced records only, because visual spot-checking exists to catch
  // column-order and baseline defects that only PDFs have. That scope is correct and it is also
  // a declined examination for every other record, so it is recorded rather than assumed —
  // otherwise "g12:12" is a number with no denominator, which is what hid gate 23's blindness.
  for (const { a } of atoms) {
    const f = a?.source?.format;
    if (!f) { skip(12, a?.id ?? '(unknown)', 'record-declares-no-source-format'); continue; }
    if (!f.startsWith('pdf_')) skip(12, a.id, `visual-check-not-applicable-to-${f}`);
  }
  const pdfRecs = atoms.map(x => x.a).filter(a => a?.source?.format?.startsWith('pdf_'));
  const instruments = new Map();
  for (const a of pdfRecs) {
    const i = a.source.instrument_id;
    if (!instruments.has(i)) instruments.set(i, { spans: [], features: new Set() });
    instruments.get(i).spans.push(a.id);
    for (const f of spanFeat.get(a.id) ?? []) instruments.get(i).features.add(f);
  }
  for (const [inst, info] of instruments) {
    const mine = checks.filter(c => c.instrument_id === inst);
    const floor = Math.min(3, info.spans.length);
    if (mine.length < floor)
      fail(12, inst, `${mine.length} visual spot-check(s) logged, floor is ${floor} (3, capped at ${info.spans.length} available span(s))`);
    const bad = mine.filter(c => c.result !== 'match');
    if (bad.length) fail(12, inst, `${bad.length} visual spot-check(s) did not match — see meta/visual-checks.yaml`);
    const covered = new Set(mine.flatMap(c => c.covers ?? []));
    for (const f of info.features)
      if (!covered.has(f))
        fail(12, inst, `feature "${f}" is present in this instrument's spans but no visual spot-check covers it. Sampling follows features, not tiers.`);
    bump(12, mine.length);
    for (const c of mine) {
      const rec = byId.get(c.record_id);
      if (!rec) { fail(12, inst, `visual check references unknown record "${c.record_id}"`); continue; }
      if (spanHash(rec.verbatim_span) !== c.span_sha256_16)
        fail(12, rec.id, `verbatim_span changed since its visual check (recorded ${c.span_sha256_16}, now ${spanHash(rec.verbatim_span)}) — re-check it`);
    }
  }
}

// ---- gate 15: no verbatim_span may CONTAIN apparatus.
// Apparatus is excluded by choosing span boundaries, or recorded in
// span_interruptions — never left sitting inside quoted operative text, and never
// silently deleted. These patterns are the unambiguous ones; ambiguous cases
// (a bare digit that might be a page number or might be operative) are left to
// the extractor and to gate 12's visual sampling.
// The feature inventory reads GLYPH HEIGHT out of the PDF, so it sees a footnote
// reference even when the renderer has flattened the superscript into ordinary
// digits — "participating APEC economies10." is indistinguishable from operative
// text by any regex, and that is exactly how one got into a span. Where the
// inventory reports a footnote_ref on a span, the span must account for it.
{
  const FP = R('meta/source-features.yaml');
  const feat = existsSync(FP) ? (yaml.load(readFileSync(FP, 'utf8')) ?? {}) : {};
  const byRec = new Map((feat.spans ?? []).map(s => [s.record_id, s.features ?? []]));
  for (const { a } of atoms) {
    if (!a?.id || !byRec.has(a.id)) continue;
    if (!byRec.get(a.id).includes('footnote_ref')) continue;
    const declared = (a.span_interruptions ?? []).some(i => i.kind === 'footnote_ref');
    if (!declared)
      fail(15, a.id, 'the feature inventory reports a footnote reference on or beside this span, but no span_interruption of kind footnote_ref is declared. Either the marker is inside the span (record it) or the span boundary should move.');
  }
}
const APPARATUS = [
  [/\f/, 'form feed (page break)'],
  [/Page\s+\d+\s+of\s+\d+/i, 'page-of-N running foot'],
  [/[\u00B9\u00B2\u00B3\u2070-\u209F]/, 'superscript/subscript glyph (footnote reference)'],
  [/\[\s*sic\s*\]/i, 'editorial bracket'],
  [/^\s*\d+\s*$/, 'bare page number'],
];
for (const { a } of atoms) {
  if (!a?.verbatim_span) continue;
  const targets = [['verbatim_span', a.verbatim_span],
                   ...(a.exemptions ?? []).map((x, i) => [`exemptions[${i}].verbatim_span`, x.verbatim_span]),
                   ...(a.source_defects ?? []).map((x, i) => [`source_defects[${i}].as_published`, x.as_published])];
  for (const [where, txt] of targets) {
    if (!txt) continue;
    for (const [re, label] of APPARATUS)
      if (re.test(txt))
        fail(15, a.id, `${where} contains apparatus: ${label}. Move the span boundary, or record it in span_interruptions — do not delete it.`);
  }
  bump(15);
}

// ---- B-4: the applicability declaration is itself asserted. An UNGUARDED-GAP without
// a written acceptance fails the build, and a gate that runs on a format declared
// INAPPLICABLE means the declaration and the code have drifted apart.
if (GA) {
  const fmtsHere = new Set(atoms.map(x => x.a?.source?.format).filter(Boolean));
  for (const [g, row] of Object.entries(GA.gates ?? {})) {
    for (const [fmt, cell] of Object.entries(row)) {
      if (fmt === 'name' || fmt === 'note' || fmt === 'all') continue;
      const st = typeof cell === 'string' ? cell : cell?.status;
      if (st !== 'UNGUARDED-GAP') continue;
      if (!cell?.accepted?.reason)
        fail(19, `gate ${g}/${fmt}`, 'declared UNGUARDED-GAP with no written acceptance');
      else if (fmtsHere.has(fmt))
        fail(19, `gate ${g}/${fmt}`, `UNGUARDED-GAP accepted on the basis that no ${fmt} source exists, but one is now committed. The acceptance is void: ${cell.accepted.expires_when}`);
    }
  }
  bump(19, Object.keys(GA.gates ?? {}).length);
  for (const f of fmtsHere)
    if (!(GA.formats ?? []).includes(f))
      fail(19, `format ${f}`, 'a source uses this format but meta/gate-applicability.yaml does not declare it');
}

// ---- gate 16: paragraph_path confidence. LOW REFUSES THE ATOM.
// Not a warning. The failure chains: wrong path -> wrong ancestor -> wrong
// operative_context -> an atom that quotes real law and attaches the wrong qualifier to
// it. That is worse than no atom, because every downstream check still passes. And
// warnings across ~900 atoms do not get read.
for (const { a } of atoms) {
  const fmt = a?.source?.format;
  if (!fmt || gateStatus(16, fmt) !== 'APPLIES') continue;
  bump(16);
  const pp = a.paragraph_path;
  if (!pp) { fail(16, a.id, `format ${fmt} carries an enacted paragraph hierarchy but no paragraph_path is recorded`); continue; }
  if (pp.confidence === 'low')
    fail(16, a.id, `paragraph_path.confidence is low (${pp.derivation}) — refused. ${pp.evidence}`);
  // USLM USUALLY has real element nesting, and where it does, a reconstructed path means someone
  // ignored structure that was right there. But the LARGE-AND-COMPLEX variant has none — the whole
  // body is flat <p> — so for those sections reconstruction is the only route and refusing it
  // means refusing the section. 15 U.S.C. § 1681g is one, and it sat unextractable for four
  // sessions partly because this gate's premise had quietly become untrue.
  //
  // The exception is narrow and has to be EARNED: the evidence must name the variant, so a
  // reconstructed USLM path can never be a silent choice.
  if (pp.derivation === 'reconstructed' && fmt === 'uslm_xml') {
    if (!/LARGE-AND-COMPLEX/i.test(pp.evidence ?? ''))
      fail(16, a.id, 'paragraph_path.derivation is "reconstructed" on uslm_xml, which normally has ' +
        'real element nesting — designator reconstruction is for eCFR, and on USLM the path is read ' +
        'from identifier attributes. The ONLY exception is a large-and-complex section whose body ' +
        'is flat <p>, and the evidence must say so in those words.');
  }
}

// ---- gate 17: an operative atom may not anchor inside a non-operative region.
// USLM <notes> reproduces PRIOR VERSIONS of the statute verbatim. An atom anchored there
// quotes repealed law as current, and every other gate passes it. 11 of 47 operative-level
// elements in 15 U.S.C. s 1681c sit in that region — not an edge case.
{
  const notesCache = new Map();
  const notesIds = src => {
    if (notesCache.has(src.raw_file)) return notesCache.get(src.raw_file);
    let ids = [];
    try {
      ids = JSON.parse(execFileSync('python3',
        [R('tools/dual-parse.py'), R(src.raw_file), '--format', src.format, '--notes-identifiers'],
        { encoding: 'utf8', maxBuffer: 64 << 20 }));
    } catch (e) { console.error(`  gate 17: could not read notes regions of ${src.raw_file}: ${e.message}`); ids = null; }
    notesCache.set(src.raw_file, ids);
    return ids;
  };
  for (const { a } of atoms) {
    const fmt = a?.source?.format;
    if (!fmt || gateStatus(17, fmt) !== 'APPLIES') continue;
    bump(17);
    const anchor = a.paragraph_path?.anchor;
    if (!anchor) continue;
    const ids = notesIds(a.source);
    if (ids === null) { fail(17, a.id, 'could not determine the non-operative regions of the source'); continue; }
    if (ids.includes(anchor))
      fail(17, a.id, `paragraph_path.anchor "${anchor}" sits inside a non-operative region of ${a.source.raw_file}. That content is quoted historical text, not current law.`);
  }
}

// ---- gate 18: nested text needs its context. THE C0b HOLE.
// Quoting a nested leaf alone is verbatim and can be substantively wrong: 16 C.F.R.
// s 682.3(b)(3) reads as a mandatory requirement, but its stem says the enumerated items
// are "illustrative only and are not exclusive or exhaustive". Gates 3, 11 and 15 all
// pass it. Format-neutral trigger: path depth > 1.
for (const { a } of atoms) {
  if (!a?.id) continue;
  // DEBT-005: depth > 1 was under-inclusive. A depth-1 subsection governed by a
  // SECTION-level chapeau escaped entirely — 1 U.S.C. § 204(a) is exactly that shape.
  // Any recorded path now triggers, because if a path was worth recording the text sits
  // inside a hierarchy and something above it may govern.
  const pp = a.paragraph_path;
  if (!pp) continue;
  const depth = pp.path?.length ?? 0;
  if (depth < 1) continue;
  bump(18);
  const ctx = a.operative_context ?? [];
  if (!ctx.length && !(a.context_not_required ?? '').trim())
    fail(18, a.id, `paragraph_path depth is ${depth} but no operative_context is recorded. A nested leaf quoted alone is verbatim and may be substantively wrong. Record the context, or state context_not_required with a reason.`);
  for (const [i, c] of ctx.entries())
    if (c.relation === 'other' && !(c.relation_note ?? '').trim())
      fail(18, a.id, `operative_context[${i}].relation is "other" without a relation_note`);
}

// ---- gate 20: no operative atom may anchor to a REPEALED document.
// The OpenLegislation law tree flags repealed documents (12 of 1592 in General Business).
// Anchoring there quotes repealed law as current — the same failure as gate 17's <notes>
// case, but a different mechanism: a flag on a tree node rather than a containing region.
// Kept separate so that difference stays visible.
for (const { a } of atoms) {
  const fmt = a?.source?.format;
  if (fmt !== 'openleg_json') continue;
  bump(20);
  const rf = a.source.raw_file && R(a.source.raw_file);
  if (!rf || !existsSync(rf)) continue;
  let doc = null;
  try { doc = JSON.parse(readFileSync(rf, 'utf8')); } catch { /* gate 1/2 will catch it */ }
  const r = doc?.result ?? doc;
  // The repealed flag is NOT on the document response — it lives on the law tree, and the
  // per-document endpoint returns null for it. Checking only the stored document would
  // pass every repealed section. meta/ny-repealed.yaml is generated from the tree.
  const RP = R('meta/ny-repealed.yaml');
  const rep = existsSync(RP) ? (yaml.load(readFileSync(RP, 'utf8')) ?? {}) : { laws: {} };
  const lawRow = rep.laws?.[r?.lawId];
  if (!lawRow) {
    fail(20, a.id, `law ${r?.lawId} is not in meta/ny-repealed.yaml, so the repealed status of ` +
      `${r?.locationId} is unknown. Run tools/scan-ny-repealed.py ${r?.lawId} — guessing repeal status ` +
      `is guessing whether this is current law.`);
  } else {
    const hit = (lawRow.repealed ?? []).find(x => String(x.location_id) === String(r?.locationId));
    if (hit)
      fail(20, a.id, `${r.lawId} ${r.locationId} is REPEALED` +
        (hit.repealed_date ? ` as of ${hit.repealed_date}` : '') +
        '. An atom anchored here quotes repealed law as current.');
  }
  if (r?.repealed === true)
    fail(20, a.id, `the stored document carries repealed: true`);
  // Currency: the record must agree with the API's own activeDate.
  if (r?.activeDate && a.source.fetched && r.activeDate > a.source.fetched)
    fail(20, a.id, `source activeDate ${r.activeDate} is later than the recorded fetch date ${a.source.fetched}`);
}

// ---- gate 21: an exemption must carry a predicate the engine can actually EVALUATE.
// Migration 003 made applies_if required, so absence is now a gate-1 failure. What remains
// is the subtler case: a predicate that is present but unevaluable — an unknown namespace,
// or a shape outside the grammar. The engine REFUSES those rather than guessing, which
// means the exemption silently never fires. That is DEBT-009 in miniature, and it is
// exactly what three green signals hid the first time.
//
// SCOPE WIDENED. This probed only EXEMPTION predicates, so the same defect in a record's OWN
// applies_if was invisible: `entity.x == true || nonsense(` passed all 42 gates while comparing
// entity.x against the literal text "true || nonsense(". Grammatical, evaluable, satisfiable,
// and permanently false. The predicate parser now refuses an unrecognised right-hand side, and
// this asks the question of every predicate a record carries rather than only half of them.
for (const { a } of atoms) {
  const probes = [
    ...(a.applies_if ? [['applies_if', a.applies_if]] : []),
    ...(a.exemptions ?? []).map((ex, i) => [`exemptions[${i}] (${ex.id})`, ex.applies_if]),
  ];
  for (const [i, ex] of (a.exemptions ?? []).entries()) {
    bump(21);
    if (!ex.applies_if) fail(21, a.id, `exemptions[${i}] has no applies_if — it is inert`);
  }
  for (const [where, expr] of probes) {
    if (!expr) continue;
    bump(21);
    const probe = evalExpr(expr);
    if (probe.refused)
      fail(21, a.id, `${where} carries a predicate the engine REFUSES: ${probe.refused}. ` +
        `It would never fire, and nothing downstream would say so.`);
  }
}

// ---- gate 23: a paragraph_path must IDENTIFY a provision.
// eCFR publishes the body of a CFR part as flat <P> siblings with no depth attribute
// whatsoever, so paragraph_path is reconstructed from textual designators. That
// reconstruction was quietly producing paths that were not unique: in 45 CFR 160.103 the
// single path ("1") was shared by TWENTY distinct provisions, one per defined term,
// because an undesignated definition entry was appended to whatever level happened to be
// open. A citation that resolves to twenty different provisions is not a citation.
//
// The extractor now scans designators and italic run-in headings together and keys
// definition entries by their term, which took the repo from 124 colliding paths to 9.
// The residue is real ambiguity in the source -- "(i)" is both letter-9 and roman-1 --
// and it is not fixable by more parsing. So the gate does not demand that segmentation be
// perfect. It demands that no ATOM ever cite an ambiguous path: resolution must yield
// exactly one leaf. Zero means the citation points at nothing; more than one means it
// points at several, which is worse, because it looks precise.
for (const { a, file } of atoms) {
  const rf = a?.source?.raw_file;
  const pp = a?.paragraph_path;
  if (!rf) { skip(23, a?.id ?? '(unknown)', 'record-has-no-raw-file'); continue; }
  if (!pp?.path) { skip(23, a.id, 'record-carries-no-paragraph-path'); continue; }
  const base = rf.split('/').pop().replace(/\.[^.]+$/, '');
  const seg = R(rf.split('/').slice(0, -2).concat(`${base}.seg.json`).join('/'));
  if (!existsSync(seg)) { skip(23, a.id, 'no-segmentation-beside-source'); continue; }
  let leaves;
  try { leaves = JSON.parse(readFileSync(seg, 'utf8')).leaves ?? []; }
  catch { skip(23, a.id, 'segmentation-unreadable'); continue; }
  bump(23);
  const want = JSON.stringify(pp.path);
  const inSection = l => pp.anchor == null || l.section == null || String(l.section) === String(pp.anchor);
  let hits = leaves.filter(l => JSON.stringify(l.path) === want && inSection(l));
  if (!hits.length) {
    // A CHAPEAU is a provision too. The extractor emits only leaves, so an ancestor like
    // 15 U.S.C. § 1681a(d)(1) — which carries the entire operative definition of "consumer
    // report" while (A),(B),(C) merely list purposes — appears in the leaves' operative_context
    // and nowhere else. Refusing it would push the citation down to a subparagraph that does
    // not say what the record says. Uniqueness is still required: distinct texts at one path
    // is the same defect whether the path names a leaf or an ancestor.
    // A provision can have BOTH a chapeau and a continuation — USLM models them as separate
    // elements at the same path, one preceding the enumeration and one following it. Deduping by
    // text counted those two halves as two provisions and refused the citation: 47 U.S.C.
    // § 551(a)(1) has a chapeau and a continuation, one identifier, one provision. Group by
    // POSITION, so a path with a precedes and a follows resolves to one thing, while two
    // genuinely distinct chapeaux at one path still collide.
    const byPos = new Map();
    for (const l of leaves)
      for (const c of l.context ?? [])
        if (JSON.stringify(c.path) === want && inSection(l)) {
          const k = `${c.position ?? 'precedes'}|${c.anchor ?? ''}`;
          if (!byPos.has(k)) byPos.set(k, new Map());
          byPos.get(k).set(c.text, c);
        }
    // Within one position and anchor, differing texts ARE a collision; across positions they are
    // the two halves of one provision.
    const collided = [...byPos.values()].some(m => m.size > 1);
    hits = collided ? [...byPos.values()].flatMap(m => [...m.values()])
                    : [...byPos.values()].map(m => [...m.values()][0]).slice(0, 1);
  }
  if (hits.length === 0)
    fail(23, a.id, `paragraph_path ${want} resolves to NO leaf in ${base}.seg.json — it cites nothing`);
  else if (hits.length > 1)
    fail(23, a.id, `paragraph_path ${want} resolves to ${hits.length} DIFFERENT provisions in ` +
      `${base}.seg.json. A path that is not unique is not a citation. First two: ` +
      hits.slice(0, 2).map(h => JSON.stringify(String(h.text).slice(0, 60))).join(' | '));
}


// ---- gate 38: an atom must be anchored to the segmentation it was actually written against.
// THE DEFECT THIS EXISTS FOR IS AGEING, NOT AUTHORSHIP. Every other gate checks an atom against
// the SOURCE BYTES, which do not move. What moves is the WALKER: a segmentation is a reading of
// those bytes, and every walker fix re-cuts the leaves under every atom over that source. Nothing
// noticed.
//
// N.Y. Penal Law s 250.00 is the case. The walker welded subdivisions 1 and 2 into one leaf, and
// the atom written against it took the whole leaf as its span — so it cited s 250.00(1) while
// carrying the words of s 250.00(2) as well. Gate 3 passed, because the span really is a
// contiguous run of the source. Gate 23 passed, because ["1"] really did resolve to exactly one
// leaf. Gate 30 passed, because the path and the citation really did agree. The atom was verbatim,
// uniquely cited, self-consistent, and attributing one definition to another. It took a human
// re-read to find, prompted by a segmentation diff that nothing required anyone to look at.
//
// Three segmentations changed in the session that found it. Walker fixes are now routine, so the
// re-verification duty has to be mechanical.
//
// GRANULARITY IS THE LEAF, NOT THE FILE. Hashing the whole seg.json would invalidate every atom
// over a source whenever any leaf anywhere in it changed — the same session added four leaves to
// N.Y. Education Law s 2-d without touching the three atoms over it, and failing those would train
// people to re-baseline without reading. A NEW SIBLING leaf does not invalidate an atom's span;
// a re-cut of ITS OWN leaf does.
//
// BASELINING IS NOT A CLAIM OF HUMAN REVIEW. The stored value records what the leaf looked like
// when the record last passed gates 3, 23 and 30. It says nothing about anyone having read it.
// What it makes impossible is for that leaf to change afterwards in silence.
for (const { a } of atoms) {
  const rf = a?.source?.raw_file;
  const pp = a?.paragraph_path;
  if (!rf || !pp?.path) { skip(38, a?.id ?? '(unknown)', 'record-carries-no-paragraph-path'); continue; }
  const base = rf.split('/').pop().replace(/\.[^.]+$/, '');
  const seg = R(rf.split('/').slice(0, -2).concat(`${base}.seg.json`).join('/'));
  if (!existsSync(seg)) { skip(38, a.id, 'no-segmentation-beside-source'); continue; }
  let leaves;
  try { leaves = JSON.parse(readFileSync(seg, 'utf8')).leaves ?? []; }
  catch { skip(38, a.id, 'segmentation-unreadable'); continue; }
  const want = JSON.stringify(pp.path);
  const inSection = l => pp.anchor == null || l.section == null || String(l.section) === String(pp.anchor);
  const hits = leaves.filter(l => JSON.stringify(l.path) === want && inSection(l));
  if (hits.length !== 1) { skip(38, a.id, 'path-does-not-resolve-to-one-leaf'); continue; }
  const stored = a.source.segment_sha256 ?? null;
  if (!stored) { skip(38, a.id, 'segment-anchor-not-yet-baselined'); continue; }
  bump(38);
  const actual = sha256(Buffer.from(norm(String(hits[0].text)), 'utf8'));
  if (actual !== stored)
    fail(38, a.id, `the segmentation leaf at ${want} has been RE-CUT since this record was ` +
      `anchored to it (recorded ${stored.slice(0, 16)}, now ${actual.slice(0, 16)}). The source ` +
      `bytes are unchanged; the walker's reading of them is not. Re-read the record against the ` +
      `new leaf before re-baselining — this is exactly how ny.penal.250_00.wiretapping_definition ` +
      `came to cite one subdivision and quote two. Then run: node tools/anchor-segments.mjs --write`);
}


// ---- gate 39: a span must not belong to a DIFFERENT provision than the one it cites.
// THE HOLE THIS CLOSES WAS WIDE OPEN AND INVISIBLE. Gate 3 proves the span is somewhere in the
// source. Gate 23 proves the path resolves to exactly one leaf. Gate 30 proves the path and the
// citation agree. Gate 38 proves the leaf has not been re-cut since. Every one of those passed
// while an atom cited N.Y. Gen. Bus. Law s 1501(1) at path ["1"] and quoted the words of
// s 1501(5) — verbatim, uniquely cited, internally consistent, and attributing one subdivision's
// words to another. Penal Law s 250.00 reached the corpus with that defect and a human found it.
//
// THE CHECK IS NEGATIVE, NOT POSITIVE, AND THAT IS THE WHOLE DESIGN. The obvious version — "the
// span must be a substring of its own leaf" — was written first and produced eight false
// positives, every one of them teaching the same thing: A SEGMENTATION LEAF IS NOT RAW SOURCE.
// The walker strips run-in headings ("Scope. This rule applies..." is quoted whole by the atom
// and headless in the leaf), rewrites bare designators ("a." becomes "(a)"), and drops footnote
// markers. A span that legitimately quotes the heading plus its paragraph is contained in NO
// leaf, and demanding containment punishes the most complete quotations.
//
// So this asks the question that has only one honest answer: does the span sit wholly inside
// some OTHER leaf, and not inside the one it cites? That is mis-anchoring and nothing else is.
for (const { a } of atoms) {
  const rf = a?.source?.raw_file;
  const pp = a?.paragraph_path;
  if (a?.verification_status !== 'verbatim_confirmed') { skip(39, a?.id ?? '(unknown)', 'record-not-verbatim-confirmed'); continue; }
  if (!rf || !pp?.path) { skip(39, a?.id ?? '(unknown)', 'record-carries-no-paragraph-path'); continue; }
  const base = rf.split('/').pop().replace(/\.[^.]+$/, '');
  const seg = R(rf.split('/').slice(0, -2).concat(`${base}.seg.json`).join('/'));
  if (!existsSync(seg)) { skip(39, a.id, 'no-segmentation-beside-source'); continue; }
  let leaves;
  try { leaves = JSON.parse(readFileSync(seg, 'utf8')).leaves ?? []; }
  catch { skip(39, a.id, 'segmentation-unreadable'); continue; }
  const span = norm(a.verbatim_span ?? '');
  if (!span) { skip(39, a.id, 'record-has-no-span'); continue; }
  const want = JSON.stringify(pp.path);
  const inSection = l => pp.anchor == null || l.section == null || String(l.section) === String(pp.anchor);
  const scope = leaves.filter(inSection);
  if (!scope.some(l => JSON.stringify(l.path) === want)) { skip(39, a.id, 'path-does-not-resolve-to-one-leaf'); continue; }
  bump(39);
  // Which leaves could this span have come from? A leaf whose own text contains it.
  const holders = scope.filter(l => norm(String(l.text ?? '')).includes(span));
  if (!holders.length) continue;              // spans a heading or several leaves — gate 3's job
  if (holders.some(l => JSON.stringify(l.path) === want)) continue;   // cited correctly
  const got = holders.map(l => '.'.join ? (l.path || []).join('.') : String(l.path)).filter(Boolean);
  fail(39, a.id, `verbatim_span belongs to a DIFFERENT provision than the one cited. The span sits ` +
    `wholly inside ${holders.length === 1 ? 'leaf' : 'leaves'} [${got.join('] [') || '(root)'}], and ` +
    `not inside ${want}, which is what this record cites. Gates 3, 23, 30 and 38 all pass on this: ` +
    `they check the span against the whole document, the path against the segmentation, and the ` +
    `path against the citation — none of them checks the span against ITS OWN path.\n` +
    `      cites: ${a.source.citation}\n      span:  ${span.slice(0, 90)}…`);
}


// ---- gate 40: a span cut short of a qualifier states the opposite rule.
// THE MOST DANGEROUS SPAN IS A GENUINELY VERBATIM ONE. Gate 3 accepts any substring, and a
// substring can reverse a provision: stop quoting "It shall be unlawful ... to send notifications
// to a covered minor" one word before "unless the operator has obtained verifiable parental
// consent" and the record states a flat prohibition where the law states a conditional one.
// Nothing structural sees it — the words are real, in order, from the right provision.
//
// Proven against the shipped corpus during red-teaming: truncating ny.gbl.1502 at "unless"
// passed every gate except, by coincidence, gate 35 — and only because that atom's own prose
// happened to quote the removed clause. Remove the coincidence and it ships.
//
// So: if a span is a strict PREFIX of its own leaf, look at what comes next. A qualifier there
// is a limb the record dropped, and the record must either include it or say why not.
const QUALIFIER = /^(unless|except|provided that|provided,|but not|other than|subject to|if the|only if|and only|nothing in)\b/i;
for (const { a } of atoms) {
  const rf = a?.source?.raw_file, pp = a?.paragraph_path;
  if (a?.verification_status !== 'verbatim_confirmed') { skip(40, a?.id ?? '(unknown)', 'record-not-verbatim-confirmed'); continue; }
  if (!rf || !pp?.path) { skip(40, a?.id ?? '(unknown)', 'record-carries-no-paragraph-path'); continue; }
  const base = rf.split('/').pop().replace(/\.[^.]+$/, '');
  const seg = R(rf.split('/').slice(0, -2).concat(`${base}.seg.json`).join('/'));
  if (!existsSync(seg)) { skip(40, a.id, 'no-segmentation-beside-source'); continue; }
  let leaves;
  try { leaves = JSON.parse(readFileSync(seg, 'utf8')).leaves ?? []; }
  catch { skip(40, a.id, 'segmentation-unreadable'); continue; }
  const want = JSON.stringify(pp.path);
  const inSection = l => pp.anchor == null || l.section == null || String(l.section) === String(pp.anchor);
  const hit = leaves.filter(l => JSON.stringify(l.path) === want && inSection(l))[0];
  if (!hit) { skip(40, a.id, 'path-does-not-resolve-to-one-leaf'); continue; }
  const leaf = norm(String(hit.text ?? '')), span = norm(a.verbatim_span ?? '');
  // LOCATE the span rather than requiring it to be a PREFIX. The first version demanded
  // leaf.startsWith(span) and therefore missed every leaf carrying a run-in heading — including
  // GBL s 1502, the very record the truncation attack was demonstrated on, whose leaf opens
  // "* s 1502. Overnight notifications." before the operative sentence begins.
  const at = span ? leaf.indexOf(span) : -1;
  if (at < 0 || at + span.length >= leaf.length) { bump(40); continue; }
  bump(40);
  const rest = leaf.slice(at + span.length).trim();
  const m = rest.match(QUALIFIER);
  if (!m) continue;
  // An explicit, recorded truncation is a decision; a silent one is a defect.
  const declared = a.span_truncation_note || (a.open_questions ?? []).some(q => /truncat|omit|qualif/i.test(String(q)));
  if (!declared)
    fail(40, a.id, `verbatim_span stops immediately before a qualifying clause, so the record ` +
      `states the rule WITHOUT the limb that conditions it. The span is verbatim and gate 3 is ` +
      `satisfied; the meaning is not the provision's.\n      cites:   ${a.source.citation}\n` +
      `      dropped: "${rest.slice(0, 90)}…"\n      Include the limb, or record span_truncation_note ` +
      `saying why the record stops where it does.`);
}


// ---- gate 41: one provision, one record; and the ledger must match the disk.
// TWO DIFFERENT WAYS THE CORPUS CAN LIE ABOUT WHAT IT HOLDS, both found by red-teaming 0.1.
//
// (a) DUPLICATE PROVISION COVERAGE. us.usc.15.45.a1.deception and
// us.usc.15.45.a1.public_commitment_deception carry the same citation, the same paragraph_path
// and a BYTE-IDENTICAL span. The second predicate is a strict superset of the first, so whenever
// a public privacy commitment exists both fire and a reader is shown 15 U.S.C. s 45(a)(1) quoted
// twice as two separate duties. Nothing counted provisions.
//
// (b) A LEDGER THAT DOES NOT MATCH THE DISK, in both directions. Gate 33 checks that every raw
// file an atom CITES is logged. It never checks that a logged file exists (8 rows survived the
// documents they described) nor that a file on disk is logged (5 fetched sources were tracked
// nowhere). A ledger is a provenance claim; an unchecked one is decoration.
{
  const byProvision = new Map();
  for (const { a } of atoms) {
    if (a?.record_type !== 'obligation') continue;
    const pp = a.paragraph_path, rf = a.source?.raw_file;
    if (!pp?.path || !rf) continue;
    const k = `${rf}::${JSON.stringify(pp.path)}::${pp.anchor ?? ''}::${norm(a.verbatim_span ?? '')}`;
    if (!byProvision.has(k)) byProvision.set(k, []);
    byProvision.get(k).push(a.id);
  }
  for (const [, ids] of byProvision) {
    bump(41);
    if (ids.length > 1)
      fail(41, ids[0], `${ids.length} records quote the SAME provision with the same path and a ` +
        `byte-identical span: ${ids.join(', ')}. If both predicates can be true at once the reader ` +
        `is shown one provision twice as two duties. Merge them, or narrow one so they are ` +
        `mutually exclusive.`);
  }
  const led = existsSync(R('meta/sources.yaml'))
    ? (yaml.load(readFileSync(R('meta/sources.yaml'), 'utf8'))?.sources ?? []) : [];
  for (const row of led) {
    bump(41);
    if (row.raw_file && !existsSync(R(row.raw_file)))
      fail(41, 'meta/sources.yaml', `logs ${row.raw_file}, which is not on disk. A ledger row for ` +
        `a file the repository does not hold overstates its provenance — remove the row with the file.`);
  }
  const logged = new Set(led.map(r => r.raw_file));
  const onDisk = [];
  const walkRaw = dir => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walkRaw(full);
      else if (relative(ROOT, full).includes('/raw/') && !/\.(txt|seg\.json)$/.test(e))
        onDisk.push(relative(ROOT, full));
    }
  };
  walkRaw(R('corpus'));
  for (const f of onDisk) {
    bump(41);
    if (!logged.has(f))
      fail(41, 'meta/sources.yaml', `${f} is a stored source with no ledger row. Gate 33 only ` +
        `examines files an atom CITES, so a fetched-but-uncited source is untracked provenance.`);
  }
}


// ---- gate 22: no gate may be listed and unimplemented.
// FOUND BY RED-TEAMING 0.1, AND IT WAS GATE 22 ITSELF. Slot 22 sat in ALL_GATES, was declared
// format_independent, and had no bump() and no fail() anywhere. It printed `g22:0(examined)` on
// every run for its whole life and the advertised gate count included it.
//
// That is precisely the defect gate 32 exists to catch — a check that examines nothing looks
// exactly like a check that passes — occurring on gate 32's own list, one level above where gate
// 32 was looking. So this gate reads the source of the file it lives in and asserts that every
// number in ALL_GATES is actually reachable.
{
  const src = readFileSync(R('tools/validate.mjs'), 'utf8');
  // Read the list out of the SOURCE rather than the binding: ALL_GATES is declared far below this
  // point, and depending on declaration order would make the self-check a hostage to where it sits.
  const listed = (src.match(/ALL_GATES = \[([^\]]*)\]/)?.[1] ?? '')
    .split(',').map(x => Number(x.trim())).filter(Number.isFinite);
  for (const g of listed) {
    bump(22);
    const implemented = new RegExp(`(?:fail|bump|skip)\\(\\s*${g}\\s*[,)]`).test(src);
    if (!implemented)
      fail(22, `gate ${g}`, `is listed in ALL_GATES but has no fail(), bump() or skip() anywhere ` +
        `in validate.mjs. It reports as examined-nothing on every run, which reads identically to ` +
        `passing. Implement it or remove the number — an advertised gate that does not exist ` +
        `overstates the guarantee the corpus rests on.`);
  }
}

// ---- gate 42: a ratchet may not move without a recorded reason.
// Gates 8, 34 and 35 carry thresholds rather than rules, and every one lives somewhere editable:
// a key in meta/coverage.yaml, a literal in this file, a baseline.json that a flag regenerates.
// Each catches SILENT regression and none catches a deliberate relaxation — the easier mistake,
// because it looks like maintenance. meta/ratchets.yaml is the declaration; this asserts the live
// values still match it, so loosening one takes a diff carrying a reason, not a changed number.
{
  const rf = R('meta/ratchets.yaml');
  if (!existsSync(rf)) {
    bump(42);
    fail(42, 'meta/ratchets.yaml', 'is missing, so no threshold in this file is accountable to anything.');
  } else {
    const dec = yaml.load(readFileSync(rf, 'utf8'))?.ratchets ?? {};
    const live = {
      gate_34_unaccounted_taxonomy_leaves:
        yaml.load(readFileSync(R('meta/coverage.yaml'), 'utf8'))?.unaccounted_allowance,
      gate_35_unmatched_quoted_phrases:
        Number(readFileSync(R('tools/validate.mjs'), 'utf8').match(/const ALLOW = (\d+)/)?.[1]),
      gate_8_eval_scenarios: existsSync(R('evals/baseline.json'))
        ? JSON.parse(readFileSync(R('evals/baseline.json'), 'utf8')).scenarios : null,
    };
    for (const [name, actual] of Object.entries(live)) {
      bump(42);
      const want = dec[name]?.value;
      if (want === undefined)
        fail(42, name, `has a live threshold of ${actual} and no entry in meta/ratchets.yaml. ` +
          `An undeclared ratchet is a number nobody has to justify.`);
      else if (Number(want) !== Number(actual))
        fail(42, name, `is ${actual} in ${dec[name].source} but meta/ratchets.yaml declares ` +
          `${want}. Moving a ratchet means editing the declaration and saying why — that is the ` +
          `whole point of it being written down.`);
    }
  }
}

// ---- gate 24: instrument-wide relief must apply instrument-wide.
// MIGRATION 005. An exemption whose reach is "instrument" says the entity is outside the
// instrument ALTOGETHER. If it sits on four of an instrument's five obligations, one of two
// things is true and both are bugs: either it is not really instrument-wide and its reach is
// mis-stated, or it was omitted from a sibling by transcription. The failure is silent and
// asymmetric — the atom that lost the exemption reports the entity as fully covered, which is
// the direction that produces confident wrong advice rather than a visible gap.
{
  const byInstrument = new Map();
  for (const { a } of atoms) {
    const inst = a?.source?.instrument_id;
    if (!inst || a.record_type !== 'obligation') continue;
    if (!byInstrument.has(inst)) byInstrument.set(inst, []);
    byInstrument.get(inst).push(a);
  }
  for (const [inst, group] of byInstrument) {
    if (group.length < 2) continue;
    const wide = new Set();
    for (const a of group)
      for (const ex of a.exemptions ?? [])
        if (ex.reach === 'instrument') wide.add(ex.id);
    for (const id of wide) {
      bump(24);
      const missing = group.filter(a => !(a.exemptions ?? []).some(e => e.id === id));
      if (missing.length)
        fail(24, missing[0].id, `exemption "${id}" declares reach=instrument for ${inst} but is absent ` +
          `from ${missing.length} of ${group.length} obligations in that instrument ` +
          `(${missing.map(m => m.id).join(', ')}). Either the reach is wrong or the exemption was dropped.`);
    }
  }
}

// ---- gate 25: a jurisdiction in the corpus must declare what it is SUPPOSED to hold.
// The structural fix for coverage-by-presence. Without a declaration, "does the corpus cover
// US-NY" can only be answered by counting records, and counting records is how three GBL § 349
// UDAP atoms once silenced the gap report for the entire New York layer while the SHIELD Act
// breach clock was missing. Adding atoms for a jurisdiction now REQUIRES saying what that
// jurisdiction needs, so the denominator exists before the numerator can look complete.
// Federal is exempt: its expected corpus is CORPUS-MANIFEST.md itself, tracked by meta/coverage.yaml.
{
  const DECL = (() => {
    const f = R('meta/jurisdiction-coverage.yaml');
    if (!existsSync(f)) return null;
    return yaml.load(readFileSync(f, 'utf8'))?.jurisdictions ?? {};
  })();
  const subnational = new Map();
  for (const { a } of atoms) {
    if (a?.jurisdiction_level === 'federal' || !a?.jurisdiction || a.record_type !== 'obligation') continue;
    if (!subnational.has(a.jurisdiction)) subnational.set(a.jurisdiction, a.id);
  }
  for (const [j, firstAtom] of subnational) {
    bump(25);
    if (!DECL) { fail(25, firstAtom, `meta/jurisdiction-coverage.yaml is missing, so coverage for ${j} cannot be measured`); continue; }
    const d = DECL[j];
    if (!d) fail(25, firstAtom, `jurisdiction ${j} has atoms but NO declaration in meta/jurisdiction-coverage.yaml. ` +
      `Coverage for it could only be judged by counting records, which is the bug this gate exists to prevent.`);
    else if (!(d.instruments ?? []).length)
      fail(25, firstAtom, `jurisdiction ${j} is declared but lists no expected instruments, so every query ` +
        `against it would report full coverage vacuously`);
  }
}

// ---- gate 26: a definition's differs_from must be COMPUTED, and still compute the same way.
// SCHEMA.md § 2 says differs_from is where a lot of the expert value lives. It only is if the
// difference is checkable. Hand-written prose about how two definitions differ is an assertion
// nothing verifies — the DEBT-009 shape moved up a level, a field that reads as analysis and is
// really just text. So the gate recomputes the set difference over each definition's tagged
// elements and fails if the stored value disagrees, which means differs_from cannot drift away
// from the elements justifying it and cannot be quietly improved by hand.
{
  const CONCEPTS = (() => {
    const f = R('meta/definition-concepts.yaml');
    if (!existsSync(f)) return null;
    const y = yaml.load(readFileSync(f, 'utf8'));
    return { concepts: new Set(Object.keys(y?.concepts ?? {})), kinds: new Set(Object.keys(y?.kinds ?? {})) };
  })();
  const defs = atoms.map(x => x.a).filter(a => a?.record_type === 'definition');
  const byId = new Map(defs.map(d => [d.id, d]));

  for (const d of defs) {
    // every element must use the DECLARED vocabulary — an ad-hoc concept would make two
    // definitions look different when only the wording of the tag differed
    for (const [i, el] of (d.elements ?? []).entries()) {
      bump(26);
      if (!CONCEPTS) { fail(26, d.id, 'meta/definition-concepts.yaml is missing; concepts cannot be checked'); break; }
      if (!CONCEPTS.concepts.has(el.concept))
        fail(26, d.id, `elements[${i}] uses concept "${el.concept}", which is not in meta/definition-concepts.yaml`);
      if (!CONCEPTS.kinds.has(el.kind))
        fail(26, d.id, `elements[${i}] uses kind "${el.kind}", which is not declared`);
    }
    // and the stored comparison must equal the one the elements produce, right now
    const peers = defs.filter(o => o.id !== d.id && o.term === d.term).sort((x, y) => x.id.localeCompare(y.id));
    bump(26);
    const stored = d.differs_from ?? [];
    if (stored.length !== peers.length)
      fail(26, d.id, `differs_from has ${stored.length} entr(ies) but ${peers.length} other definition(s) ` +
        `share the term "${d.term}". Run tools/compute-differs.mjs --write.`);
    for (const row of stored) {
      const peer = byId.get(row.id);
      if (!peer) { fail(26, d.id, `differs_from references unknown definition "${row.id}"`); continue; }
      if (peer.term !== d.term)
        fail(26, d.id, `differs_from compares against "${row.id}", whose term is "${peer.term}" and not ` +
          `"${d.term}". Definitions of different concepts are not comparable.`);
      const fresh = computeDiff(d, peer);
      if (JSON.stringify(fresh) !== JSON.stringify(row.computed))
        fail(26, d.id, `differs_from["${row.id}"].computed does not match the elements. ` +
          `stored only_here=[${row.computed?.only_here}] shared=[${row.computed?.shared}]; ` +
          `recomputed only_here=[${fresh.only_here}] shared=[${fresh.shared}]. ` +
          `Do not hand-edit — run tools/compute-differs.mjs --write.`);
      const want = narrateDiff(d, peer, fresh);
      if (row.difference !== want)
        fail(26, d.id, `differs_from["${row.id}"].difference was hand-edited; it must be the generated ` +
          `sentence, so that prose and computation cannot disagree.`);
    }
  }
}

// ---- gate 27: an instrument with obligations must declare what it is SUPPOSED to hold.
// Gate 25 does this per jurisdiction. This is the same inversion one level down, and the level
// where it is hardest to notice: an instrument holding only preemption atoms answers confidently
// and correctly about preemption while saying nothing about the substantive void behind it. Every
// atom is right, every other gate passes, and the corpus does not know that "has preemption
// atoms" and "can answer questions about this instrument" are different claims.
{
  const IDECL = (() => {
    const f = R('meta/instrument-coverage.yaml');
    if (!existsSync(f)) return null;
    return yaml.load(readFileSync(f, 'utf8'))?.instruments ?? {};
  })();
  const seen = new Map();
  for (const { a } of atoms)
    if (a?.record_type === 'obligation' && a.source?.instrument_id && !seen.has(a.source.instrument_id))
      seen.set(a.source.instrument_id, a.id);
  for (const [inst, first] of seen) {
    // Fixtures carry synthetic instrument ids and exist to trip ONE gate each. Declaring them
    // in meta/instrument-coverage.yaml would put test scaffolding in a file that describes the
    // real corpus, and leaving them in makes every fixture fail this gate as noise.
    if (/^test\.|\.test\./.test(inst)) continue;
    bump(27);
    if (!IDECL) { fail(27, first, 'meta/instrument-coverage.yaml is missing; instrument completeness cannot be measured'); continue; }
    const d = IDECL[inst];
    if (!d)
      fail(27, first, `instrument "${inst}" has obligations but NO declaration in ` +
        `meta/instrument-coverage.yaml, so a query touching it cannot report what it is unable to reach`);
    else if (!(d.categories ?? []).length)
      fail(27, first, `instrument "${inst}" is declared but lists no duty categories, so it would ` +
        `report as fully complete vacuously`);
  }
}

// ---- gate 28: an atom may only predicate on a namespace the engine actually FILLS.
// engine/applicability.mjs hardcoded `law: {}` while two FCRA preemption atoms predicated on
// law.federal_instrument. The expressions were grammatical and evaluable, so gate 21 passed
// them — they simply could never be TRUE, because nothing ever populated the namespace. Gate 21
// catches a predicate the engine REFUSES; this catches one the engine accepts and can never
// satisfy, which is quieter and therefore worse.
{
  const src = readFileSync(R('engine/applicability.mjs'), 'utf8');
  const factsBlock = src.slice(src.indexOf('const facts ='), src.indexOf('const facts =') + 900);
  const ALL_NS = ['entity', 'data', 'event', 'purpose', 'practice', 'law'];
  // Keys appear two ways: shorthand (`entity, data,`) and explicit (`law: context.law ?? {}`).
  // Matching only the explicit form reported the shorthand ones as never populated.
  const filled = new Set(ALL_NS.filter(ns =>
    new RegExp(`(?:^|[{,\\s])${ns}\\s*(?::|,|\\})`, 'm').test(factsBlock)));
  // Collect EVERY namespace-looking prefix, not only the six known ones, so this catches both
  // failure directions at once: a namespace the engine refuses outright, and a known namespace
  // it accepts and never fills. Quoted literals are stripped first — "law.federal_instrument ==
  // 'us.fcra'" would otherwise report a namespace called `us`.
  const NS = /(?:^|[\s(!])([a-z_][a-z0-9_]*)\./g;
  const collect = (expr, out = new Set()) => {
    if (typeof expr === 'string') {
      const bare = expr.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
      for (const m of bare.matchAll(NS)) out.add(m[1]);
      return out;
    }
    if (Array.isArray(expr)) { for (const e of expr) collect(e, out); return out; }
    if (expr && typeof expr === 'object') { for (const v of Object.values(expr)) collect(v, out); return out; }
    return out;
  };
  for (const { a } of atoms) {
    if (!a?.applies_if) continue;
    const used = [...collect(a.applies_if), ...(a.exemptions ?? []).flatMap(e => [...collect(e.applies_if)])];
    for (const ns of new Set(used)) {
      bump(28);
      if (!filled.has(ns))
        fail(28, a.id, `predicates on the "${ns}" namespace, which engine/applicability.mjs never ` +
          `populates from caller input. Either it is not a namespace the engine knows at all, or it ` +
          `is one it accepts and never fills — and in the second case the expression is valid, ` +
          `evaluable, and can never be true. Filled: ${[...filled].join(', ')}.`);
    }
  }
}

// ---- gate 29: no predicate may be UNSATISFIABLE. Every atom must be reachable.
// The fourth instance of cross-session drift arrived by a door the other three gates do not
// watch. `in` did plain membership, so "data.types in ['consumer_report']" was permanently false
// — ['consumer_report'] is not an element of ['consumer_report'] — and the FCRA permissible-
// purpose atom could never fire. Grammatical, namespace-clean, dead. It was found by RUNNING the
// atom, which is not a thing that happens reliably.
//
// The class generalises past `in`: the predicate language's SEMANTICS versus the facts model's
// SHAPES. Any operator whose behaviour depends on whether an operand is scalar or array has the
// same exposure, and the next one will not be `in`.
//
// Satisfiability is undecidable in general and trivial for this grammar. So: build a witness
// from the predicate itself and require the engine to return TRUE on it. An atom no constructible
// input can trigger is dead, and dead atoms are exactly what all four instances produced.
//
// Where an operand's SHAPE is ambiguous — `in` over a field that could be scalar or array — both
// witnesses are tried, and satisfaction depending on which one is chosen is reported. That is
// the `in` bug stated as a general property rather than as a special case.
{
  const lit = t => {
    const x = String(t).trim();
    if (/^'.*'$/.test(x) || /^".*"$/.test(x)) return x.slice(1, -1);
    if (x === 'true') return true;
    if (x === 'false') return false;
    if (x === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(x)) return Number(x);
    if (/^\[.*\]$/.test(x)) return x.slice(1, -1).split(',').map(lit).filter(v => v !== '');
    return x;
  };
  const set = (f, path, v) => {
    const [ns, ...rest] = path.split('.');
    if (!rest.length || !f[ns]) return;
    f[ns][rest.join('.')] = v;
  };
  // Build facts satisfying an expression. arrayForIn picks which witness shape to use.
  const witness = (expr, f, arrayForIn) => {
    if (typeof expr === 'string') {
      const m = expr.match(/^\s*([a-z_][\w.]*)\s*(==|!=|>=|<=|>|<|not_in|in)\s*(.+?)\s*$/);
      if (!m) return false;
      const [, lhs, op, rhsRaw] = m;
      const rhs = lit(rhsRaw);
      if (op === '==') set(f, lhs, rhs);
      else if (op === '!=') set(f, lhs, rhs === null ? '__x__' : (typeof rhs === 'boolean' ? !rhs : (rhs === '__x__' ? '__y__' : '__x__')));
      else if (op === 'in') {
        if (!Array.isArray(rhs) || !rhs.length) return false;
        set(f, lhs, arrayForIn ? [rhs[0]] : rhs[0]);
      } else if (op === 'not_in') set(f, lhs, '__not_in_witness__');
      else if (op === '>=' || op === '>') set(f, lhs, Number(rhs) + (op === '>' ? 1 : 0));
      else if (op === '<=' || op === '<') set(f, lhs, Number(rhs) - (op === '<' ? 1 : 0));
      return true;
    }
    if (expr && typeof expr === 'object') {
      if (Array.isArray(expr.all)) return expr.all.every(e => witness(e, f, arrayForIn));
      if (Array.isArray(expr.any)) return expr.any.length ? witness(expr.any[0], f, arrayForIn) : false;
      if (Array.isArray(expr)) return expr.every(e => witness(e, f, arrayForIn));
      const vals = Object.values(expr);
      return vals.length ? vals.every(v => witness(v, f, arrayForIn)) : false;
    }
    return false;
  };
  const trial = (expr, arrayForIn) => {
    const f = { entity: {}, data: {}, event: {}, purpose: {}, practice: {}, law: {} };
    if (!witness(expr, f, arrayForIn)) return null;      // could not construct — not a verdict
    try { return engineEvaluate(expr, f).value === true; } catch { return false; }
  };
  const check = (id, label, expr) => {
    if (!expr) return;
    bump(29);
    const scalar = trial(expr, false), arr = trial(expr, true);
    if (scalar === null && arr === null) return;         // unconstructible shapes are gate 28's job
    if (scalar !== true && arr !== true)
      fail(29, id, `${label} is UNSATISFIABLE — no witness this checker can construct makes it true, ` +
        `so the record can never apply to any query. That is what all four cross-session drift ` +
        `defects produced.`);
    else if (scalar !== arr)
      fail(29, id, `${label} is SHAPE-SENSITIVE: it is satisfied by a ${scalar === true ? 'scalar' : 'single-element array'} ` +
        `fact and NOT by the other. Whether it can ever fire depends on a fact shape the corpus ` +
        `does not declare, which is exactly how "data.types in [...]" stayed permanently false.`);
  };
  for (const { a } of atoms) {
    if (a?.record_type !== 'obligation') continue;
    check(a.id, 'applies_if', a.applies_if);
    for (const [i, ex] of (a.exemptions ?? []).entries())
      check(a.id, `exemptions[${i}] (${ex.id}) applies_if`, ex.applies_if);
  }
}

// ---- gate 30: a reconstructed path must AGREE WITH ITS OWN CITATION.
// The acknowledged blind spot. Gate 23 checks that a paragraph_path identifies A provision. It
// cannot check that it identifies THE RIGHT one, and a unique-but-wrong path is the single defect
// shape this repo otherwise has no answer for. It nearly shipped: reconstructing 15 U.S.C. 1681g
// from USLM indent classes recovered 131 leaves and put paragraph (1) at ["1"] instead of
// ["a","1"] — unique, clean, and citing the wrong provision.
//
// This is a PARTIAL guard, not a solution. Where a path is reconstructed rather than read from
// the source, the human-written citation is an independent witness: if the record says
// "15 U.S.C. § 1681g(a)(1)" the path had better be ["a","1"]. Two artifacts written from
// different directions have to agree, which is the same shape as gates 22, 26 and 29.
//
// It would have caught the 1681g case. It will not catch a path that is wrong in the same way
// the citation is wrong, and nothing here does.
for (const { a } of atoms) {
  const pp = a?.paragraph_path;
  if (!pp?.path?.length || pp.derivation !== 'reconstructed') continue;
  // A term-keyed root ("Protected health information") is not a designator and is not written
  // parenthetically in a citation; it is cited by name. Skip those segments.
  const desigs = pp.path.filter(x => /^[A-Za-z0-9ivxlIVXL]{1,5}$/.test(String(x)));
  if (!desigs.length) continue;
  bump(30);
  const want = desigs.map(d => `(${d})`).join('');
  const cite = String(a.source?.citation ?? '').replace(/\s+/g, '');
  // Compare against the citation's TRAILING designator run, not a substring anywhere in it.
  // "(a)" is a substring of "§ 313.10(a)(1)", so a path truncated to ["a"] would slip through an
  // includes() test — which is precisely the shape of the 1681g defect, a path shorter and
  // shallower than the provision it claims.
  const tail = (cite.match(/(\([A-Za-z0-9ivxlIVXL]{1,5}\))+$/) ?? [''])[0];
  if (tail !== want)
    fail(30, a.id, `paragraph_path ${JSON.stringify(pp.path)} reconstructs to "${want}" but its own ` +
      `citation "${a.source?.citation}" ends in "${tail || '(no designator)'}". One of the two is ` +
      `wrong, and a path that is unique but wrong is the one defect gate 23 cannot see.`);
}

// ---- gate 31: a DECLARED citation must have been resolved against the source.
// The denominator has to be verified, not asserted. meta/jurisdiction-coverage.yaml is what every
// coverage computation divides by, and its citations came from CORPUS-MANIFEST.md, where they
// were research pointers written as hypotheses. DEBT-016 is what an unverified one costs: the
// manifest claimed "N.Y. Labor Law § 203-f — electronic monitoring notice" for the whole project,
// § 203-f is "Inventions made by employees", and every New York completeness number has been
// measured against a phantom.
//
// So each declared instrument must carry published_heading — the SOURCE'S OWN WORDS, fetched by
// tools/audit-declarations.py. The gate does not judge whether the heading matches the claim; a
// heuristic guessing whether "Data security protections" means "reasonable safeguards" would
// produce false alarms and false comfort in equal measure. It requires the two to sit next to
// each other permanently, so a § 203-f is visible to anyone who looks.
{
  const f = R('meta/jurisdiction-coverage.yaml');
  if (existsSync(f)) {
    const doc = yaml.load(readFileSync(f, 'utf8'));
    for (const [j, v] of Object.entries(doc?.jurisdictions ?? {})) {
      for (const e of v.instruments ?? []) {
        bump(31);
        if (!('published_heading' in e))
          fail(31, `${j}:${e.id}`, `declared instrument "${e.citation}" has never been resolved against ` +
            `a structured source. Run tools/audit-declarations.py --write. An unverified denominator ` +
            `is how § 203-f went unnoticed for the whole project.`);
        else if (e.published_heading === null && !/UNRESOLVED/.test(e.verified ?? ''))
          fail(31, `${j}:${e.id}`, `"${e.citation}" has a null published_heading without an UNRESOLVED note`);
      }
    }
  }
}

// ---- gate 32: every declined examination must have a DECLARED reason.
// The denominator problem applied to the gates themselves. A gate reports what it examined; until
// now nothing reported what it DECLINED to examine, so a gate silently scoped out of part of the
// corpus looked exactly like a gate that passed over all of it.
{
  // Prefixes, because a reason may carry the format it applies to. Every skip a gate performs
  // must match one of these; an unlisted reason fails, so a new precondition cannot be added
  // without deciding, in this file, whether it is acceptable.
  const ACCEPTED = [
    'record-carries-no-paragraph-path',   // principles and authorities have no paragraph to cite
    'record-has-no-raw-file',             // scaffolding records that cite nothing
    'record-not-verbatim-confirmed',      // invariant I1 suppresses these from output anyway
    'gate-inapplicable-for-',             // declared in meta/gate-applicability.yaml
    'unguarded-gap-accepted-for-',        // declared, with an accepted block, in the same file
    'visual-check-not-applicable-to-',    // gate 12 is for PDF-sourced records by design
    // GATE 38 ONLY. A path that does not resolve to exactly one leaf is gate 23's failure to
    // report, not gate 38's -- anchoring to an ambiguous leaf would be meaningless, and letting
    // both gates fail on one defect makes the real one harder to see.
    'path-does-not-resolve-to-one-leaf',
    // The baseline ratchet. A record with no stored anchor cannot have DRIFTED from one, so it
    // is skipped rather than failed -- but the count is printed on every run, so the number of
    // unanchored records is visible and can only be allowed to fall.
    'segment-anchor-not-yet-baselined',
  ];
  const INVESTIGATE = [
    'no-segmentation-beside-source',      // the gate-23 blindness: fixable by promoting the seg
    'segmentation-unreadable',
    'record-declares-no-source-format',   // a record with no format is unexaminable by several gates
  ];
  const matches = (list, r) => list.some(p => p.endsWith('-') ? r.startsWith(p) : r === p);
  const byReason = new Map();
  for (const sk of skipped) {
    // Fixtures are single-atom corpora that exist to trip ONE gate each; none carries a
    // segmentation beside its raw file, and demanding one would make every fixture fail this
    // gate as noise. Same scoping as gate 27.
    if (/^[a-z]{2}\.(test|fixture)\./.test(sk.atomId ?? '')) continue;
    const k = `${sk.gate}:${sk.reason}`;
    if (!byReason.has(k)) byReason.set(k, []);
    byReason.get(k).push(sk.atomId);
  }
  for (const [k, ids] of byReason) {
    const [gate, reason] = [k.split(':')[0], k.slice(k.indexOf(':') + 1)];
    bump(32);
    if (matches(ACCEPTED, reason)) {
      notes.push(`gate ${gate} declined ${ids.length} record(s): ${reason} (accepted)`);
    } else if (matches(INVESTIGATE, reason)) {
      fail(32, ids[0], `gate ${gate} DECLINED TO EXAMINE ${ids.length} record(s) because ` +
        `"${reason}". That is not a pass — it is the gate having no input. ${ids.slice(0, 3).join(', ')}` +
        `${ids.length > 3 ? ` and ${ids.length - 3} more` : ''}. Put the segmentation beside its raw ` +
        `file, or the gate is silently scoped out of part of the corpus.`);
    } else {
      fail(32, ids[0], `gate ${gate} declined ${ids.length} record(s) for an UNDECLARED reason ` +
        `"${reason}". Every declined examination must be one we accepted in advance.`);
    }
  }
}

// ---- gate 33: every source an atom cites must appear in the sources ledger.
// BRIEF.md Phase 0 item 4: every fetch is logged to meta/sources.yaml with its URL, date and
// hash, and every atom traces to a stored raw file. The ledger silently stopped being written
// when tools/extract.py replaced tools/fetch-source.mjs as the acquisition path — 13 entries
// against 78 stored raw files — and NOTHING FAILED, because gate 2 hashes each atom's own
// raw_file rather than checking this list. Two artifacts, no assertion between them, which is the
// same seam as gates 22 and 28.
//
// Found by a a verification pass that noticed it while doing unrelated work and reported it as out of scope.
// That is worth recording: the defect had survived every gate, every review and every session.
{
  const led = R('meta/sources.yaml');
  const logged = new Set();
  if (existsSync(led)) {
    const doc = yaml.load(readFileSync(led, 'utf8'));
    for (const row of (doc?.sources ?? [])) if (row?.raw_file) logged.add(row.raw_file);
  }
  for (const { a } of atoms) {
    const rf = a?.source?.raw_file;
    if (!rf) continue;
    // Fixtures cite synthetic raw files under tests/fixtures/ that were never fetched from a
    // publisher and have no URL to log. Same scoping as gates 27 and 32.
    if (rf.startsWith('tests/fixtures/')) continue;
    bump(33);
    if (!logged.has(rf))
      fail(33, a.id, `cites ${rf}, which is not in meta/sources.yaml. Every fetch must be logged ` +
        `with its URL and hash — a source that is on disk but not in the ledger is untraceable to ` +
        `where it came from.`);
    // EVERY source_ref, not just an exemption's. Adding interpreted_by created an untraceable
    // source on its first use: the guidance PDF was hashed by gate 2 and its span verified by
    // gate 3, and it was still absent from the ledger, because this loop knew only one field.
    // A gate enumerating specific fields ages the moment a field is added.
    const cited = [
      ...(a.exemptions ?? []).map((x, i) => [`exemptions[${i}]`, x.source_ref?.raw_file]),
      ...(a.interpreted_by ?? []).map((x, i) => [`interpreted_by[${i}]`, x.source_ref?.raw_file]),
    ];
    for (const [where, xr] of cited) {
      if (!xr) continue;
      bump(33);
      if (!logged.has(xr))
        fail(33, a.id, `${where} cites ${xr}, which is not in meta/sources.yaml`);
    }
  }
}

// ---- gate 34: the completeness argument must be true, or its shortfall declared.
// BRIEF.md § 2: "every leaf section either maps to atoms in the KB or appears in
// meta/out-of-scope.yaml with a stated reason. This is the completeness argument for the whole
// project." Nothing asserted it, and it was not true: 49 of 69 performance indicators were
// neither covered nor declared out of scope, with out-of-scope.yaml holding zero coordinates.
//
// Failing outright would just be red forever, so this is a RATCHET. The shortfall is declared in
// meta/coverage.yaml as unaccounted_allowance and may only go DOWN. A leaf can leave the
// unaccounted set by being covered or by being ruled out of scope with a reason — never by
// nobody noticing.
{
  const cov = R('meta/coverage.yaml');
  if (existsSync(cov)) {
    const doc = yaml.load(readFileSync(cov, 'utf8')) ?? {};
    const oosDoc = existsSync(R('meta/out-of-scope.yaml'))
      ? yaml.load(readFileSync(R('meta/out-of-scope.yaml'), 'utf8')) ?? {} : {};
    const oos = new Set();
    for (const x of (oosDoc.out_of_scope ?? oosDoc.items ?? []))
      for (const k of ['taxonomy', 'coordinate', 'leaf', 'id']) if (x?.[k]) oos.add(String(x[k]));
    let unaccounted = 0;
    const walk = n => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === 'object') {
        for (const pi of (n.performance_indicators ?? n.pis ?? [])) {
          const c = pi.coordinate ?? pi.id;
          const has = (pi.atom_ids ?? pi.atoms ?? []).length > 0;
          if (!has && !oos.has(c) && !pi.out_of_scope) unaccounted++;
        }
        Object.values(n).forEach(walk);
      }
    };
    walk(doc);
    const allow = doc.unaccounted_allowance;
    bump(34);
    if (allow == null)
      fail(34, 'meta/coverage.yaml', `${unaccounted} taxonomy performance indicator(s) are neither ` +
        `covered nor declared out of scope, and no unaccounted_allowance is declared. BRIEF.md § 2 ` +
        `calls this the completeness argument for the whole project.`);
    else if (unaccounted > allow)
      fail(34, 'meta/coverage.yaml', `unaccounted taxonomy leaves rose from ${allow} to ${unaccounted}. ` +
        `The allowance is a ratchet: a leaf leaves the unaccounted set by being covered or ruled ` +
        `out of scope, never by nobody noticing.`);
    else if (unaccounted < allow)
      notes.push(`gate 34: unaccounted taxonomy leaves down to ${unaccounted} from an allowance of ` +
        `${allow} — tighten meta/coverage.yaml unaccounted_allowance`);
  }
}

// ---- gate 35: a phrase QUOTED in the analysis must appear in the law it cites.
// The largest unguarded surface in the system. verbatim_span is verified, paragraph_path is
// verified, predicates are verified — requirement_detail, the field a reader actually reads, is
// checked by nothing. Both recorded errors in meta/validation-events.yaml landed there: an
// invented statutory requirement ("contemporaneous", which appears nowhere in 18 U.S.C. §§ 2510
// or 2511) and a misread qualifier scope.
//
// This is a PARTIAL mechanism, deliberately narrow. It does not read the prose; it checks that
// anything the analysis puts in DOUBLE QUOTES — i.e. holds out as the source's own words —
// actually appears in the span, its operative_context, or the atom's own rendered source. It
// converts one known failure mode from a practice into a mechanism and leaves the other
// (misreading which limb a qualifier scopes) to adversarial review, which is what caught it.
const g35misses = [];
for (const { a } of atoms) {
  const detail = [a?.requirement_detail, ...(a?.common_errors ?? [])].filter(Boolean).join(' ');
  if (!detail) continue;
  const hay = norm([a.verbatim_span, ...(a.operative_context ?? []).map(c => c.verbatim_span),
                    ...(a.exemptions ?? []).map(e => e.verbatim_span)].filter(Boolean).join(' '));
  // Only quoted runs that look like quoted STATUTE: 2+ words, lower-case start, no citation
  // markers. A quoted defined term or a phrase naming a doctrine is not a claim about this text.
  for (const m of detail.matchAll(/[“"]([a-z][^"”]{8,90})[”"]/g)) {
    const q = norm(m[1]).replace(/[.,;:]+$/, '');
    // Four words, not two. A scare-quote ("not regulated", "no binding obligation") is a
    // rhetorical device, not a claim about the source's wording; a quoted statutory phrase is
    // almost always longer. At two words the gate flagged 39 spots and most were rhetorical,
    // which is how a check trains people to ignore it.
    if (q.split(/\s+/).length < 4) continue;
    if (/§|U\.S\.C|C\.F\.R|\bv\.\s/.test(q)) continue;
    if (/\.\.\.|…/.test(q)) continue;   // an elided quote cannot match literally, and eliding is honest
    bump(35);
    if (!hay.includes(q)) g35misses.push(`${a.id}: "${q}"`);
  }
}

{
  // RATCHET, like gate 34. 25 quoted phrases in the corpus do not match the text they cite, and
  // fixing them is real work rather than a rename — some are paraphrases wearing quotation marks,
  // which is exactly the defect. Failing outright would sit red and get ignored; the allowance may
  // only go DOWN, so the prose layer can only get more honest.
  const ALLOW = 24;   // ratcheted down 2026-08-20 as the health-tension trio landed clean
  bump(35);
  if (g35misses.length > ALLOW)
    fail(35, 'requirement_detail', `${g35misses.length} quoted phrase(s) do not appear in the text ` +
      `they cite, up from an allowance of ${ALLOW}. Quoting something the source does not say is ` +
      `the one error class no other gate reaches. First: ${g35misses.slice(0, 3).join(' | ')}`);
  else if (g35misses.length < ALLOW)
    notes.push(`gate 35: unmatched quoted phrases down to ${g35misses.length} from ${ALLOW} — tighten the allowance`);
}

// ---- gates 36 and 37: composed records may not invent what they compose.
// MIGRATION 006. A workflow_constraint has no verbatim_span of its own — it assembles constraints
// from records that already exist. A doctrine constrains instruments. Both are only as trustworthy
// as those references, so both are resolved: without this, a workflow could assert a duty nothing
// backs, and a doctrine could claim reach over an instrument the corpus has never seen.
{
  const known = new Set(atoms.map(x => x.a?.id).filter(Boolean));
  const instruments = new Set(atoms.map(x => x.a?.source?.instrument_id).filter(Boolean));
  for (const { a } of atoms) {
    if (a?.record_type === 'workflow_constraint') {
      for (const [i, c] of (a.constraints ?? []).entries()) {
        bump(36);
        if (!known.has(c.from_record))
          fail(36, a.id, `constraints[${i}] derives from "${c.from_record}", which is not a record ` +
            `in this corpus. A workflow composes verified obligations; it may not invent one.`);
      }
    }
    if (a?.record_type === 'doctrine') {
      bump(37);
      if ('obligation_type' in a)
        fail(37, a.id, 'a doctrine record carries obligation_type. A doctrine is not a duty, and ' +
          'letting it wear one would put constitutional case law in an obligations list.');
      for (const inst of (a.constrains ?? [])) {
        bump(37);
        if (!instruments.has(inst))
          fail(37, a.id, `constrains "${inst}", which no record in this corpus belongs to — the ` +
            `doctrine claims reach over something that is not here.`);
      }
    }
  }
}

// ---- gate 13: a record that is not anchored to a taxonomy leaf must say why.
// Otherwise the taxonomy-as-coverage-checklist discipline erodes one reasonable
// exception at a time.
for (const { a } of atoms) {
  if (!a?.id) continue;
  const c = a.subject?.domain;
  const leaf = c && VALID_COORDS.has(c);
  bump(13);
  if (!leaf && !(a.scope_justification ?? '').trim())
    fail(13, a.id, `subject.domain "${c ?? '(absent)'}" is not a performance indicator and no scope_justification is given`);
}

// ---- gate 10: referential integrity. Every cross-reference must resolve to a
// record that exists. differs_from and related are the fields where a plausible
// but non-existent sibling ID is easiest to invent, so they are checked like any
// other citation rather than treated as prose.
{
  const known = new Set(atoms.map(x => x.a?.id).filter(Boolean));
  for (const { a } of atoms) {
    if (!a?.id) continue;
    const refs = [
      ...(a.differs_from ?? []).map(d => [d.id, 'differs_from']),
      ...(a.derived_obligations ?? []).map(d => [d, 'derived_obligations']),
      ...(a.related ?? []).map(r => [typeof r === 'string' ? r : r?.id, 'related']),
      // interpreted_by IS NO LONGER A LIST OF RECORD IDS. It was typed as an unconstrained array
      // and was empty everywhere, so this line was checking a convention nothing had ever used.
      // The field now carries the interpretation INLINE with its own verbatim_span and source_ref,
      // verified by gates 2 and 3 -- because the alternative required inventing a record type for
      // agency guidance (it is not an enforcement_action, not a doctrine, and principle is under
      // the DEBT-001 moratorium), and because invariant I7 wants the quotation at the point of use
      // rather than one indirection away from it. A string entry is still resolved as an id, so a
      // future enforcement_action record can be referenced the old way.
      ...(a.interpreted_by ?? []).map(r => [typeof r === 'string' ? r : null, 'interpreted_by']),
    ].filter(([id]) => id);
    bump(10, refs.length);
    for (const [id, where] of refs) {
      if (id === a.id) fail(10, a.id, `${where} references itself`);
      else if (!known.has(id)) fail(10, a.id, `${where} references unknown record "${id}"`);
    }
  }
}

// ---- invariant I1: unverified atoms must never be surfaced. Enforced in the
// engine, asserted here so the corpus reports its own suppression honestly.
const unverified = atoms.filter(x => x.a?.verification_status !== 'verbatim_confirmed');

// ---- gate 8: eval all-pass rate must not regress
// Gate 8 EXECUTES the runner rather than reading a file someone may have left
// stale. A stubbed gate is a gate that will still be stubbed at 900 atoms.
{
  let ran = false;
  try { execFileSync('node', [R('evals/runner.mjs')], { encoding: 'utf8' }); ran = true; }
  catch (e) {
    ran = e.status !== undefined;                   // non-zero = scenarios failed, still ran
    if (!ran) fail(8, '-', `eval runner did not execute: ${e.message}`);
  }
  const cur = existsSync(R('evals/last-run.json'))
    ? JSON.parse(readFileSync(R('evals/last-run.json'), 'utf8')) : null;
  if (ran && !cur) fail(8, '-', 'eval runner ran but wrote no evals/last-run.json');
  if (cur) {
    bump(8, cur.scenarios);
    const BASELINE = R('evals/baseline.json');
    if (!existsSync(BASELINE)) notes.push('gate 8: no baseline yet — run `node evals/runner.mjs --baseline` to set one.');
    else {
      const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
      if (cur.all_pass_rate < base.all_pass_rate)
        fail(8, '-', `eval all-pass regressed ${base.all_pass_rate} -> ${cur.all_pass_rate}`);
      if (cur.scenarios < base.scenarios)
        fail(8, '-', `scenario count fell ${base.scenarios} -> ${cur.scenarios} — scenarios were deleted rather than fixed`);
      if (cur.scenarios === 0) notes.push('gate 8: ran, 0 scenarios, no regression. Vacuous until Part C3 lands scenarios.');
    }
  }
}

// ------------------------------------------------------------------- report
if (QUIET) {
  console.log(JSON.stringify({ atoms: atoms.length, failures: failures.map(f => ({ gate: f.gate, id: f.atomId })) }));
  process.exit(failures.length ? 1 : 0);
}
const byKind = {};
for (const x of atoms) byKind[x.a?.record_type ?? 'obligation'] = (byKind[x.a?.record_type ?? 'obligation'] ?? 0) + 1;
console.log(`records found        ${atoms.length}  ${JSON.stringify(byKind)}`);
console.log(`taxonomy leaves indexed   ${VALID_COORDS.size}`);
console.log(`verbatim_confirmed   ${atoms.length - unverified.length}`);
console.log(`suppressed by I1     ${unverified.length}`);
for (const n of notes) console.log(`note: ${n}`);
// B-4: a zero must be attributable to a declaration, never inferred from absence.
const fmtsPresent = [...new Set(atoms.map(x => x.a?.source?.format).filter(Boolean))];
const ALL_GATES = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42];
const cov = ALL_GATES.map(g => {
  const n = examined[g];
  if (n) return `g${g}:${n}`;
  const scoped = GA?.record_type_scoped?.[g];
  if (scoped && !atoms.some(x => scoped.includes(x.a?.record_type ?? 'obligation')))
    return `g${g}:n/a(no ${scoped.join('/')} records)`;
  const st = fmtsPresent.map(f => gateStatus(g, f));
  const live = st.filter(x => x === 'APPLIES' || x === 'ANALOGUE-REQUIRED');
  if (!fmtsPresent.length) return `g${g}:0(no-sources)`;
  if (!live.length) return `g${g}:n/a(declared)`;
  return `g${g}:0(examined)`;
}).join(' ');
console.log(`examined             ${cov}`);

if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S)\n`);
  for (const f of failures.sort((a, b) => a.gate - b.gate))
    console.log(`  gate ${f.gate}  ${f.atomId}\n      ${f.msg}`);
  process.exit(1);
}
console.log('\nall gates pass');
