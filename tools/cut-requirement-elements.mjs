#!/usr/bin/env node
// CUT THE ITEMS OF A DOCUMENT-REQUIREMENT LIST, WITH THE CHAPEAU THAT MAKES THEM OPERATIVE.
//
// tools/bulk-provisions.mjs refuses a leaf with no modal verb, and it is right to: "A brief
// description of what happened, including the date of the breach" is a fragment, and a corpus of
// fragments quoted as provisions would be worse than one that omits them.
//
// But a fragment under "The notification shall include:" is not a fragment of nothing. It is an
// item on a checklist, and the chapeau supplies the duty. Those items are exactly what a
// conformance review needs, and 477 of them across 81 requirement lists were unreachable as
// records — engine/requirements.mjs could only surface them from the segmentation, at a weaker
// provenance tier.
//
// WHAT IS CUT, and it is deliberately narrow. A chapeau qualifies only if it says a DOCUMENT must
// CONTAIN or INCLUDE what follows: shall/must within ninety characters of
// contain/include/set forth/state/specify, alongside a document noun. That excludes the limbs of
// a legal test — the CFPB abusive standard reads the same way structurally and its elements are
// not a checklist — which is the distinction volume-cutting would lose.
//
// Every record carries operative_verb_source: operative_context, because the modal is NOT in the
// quoted span. A reader must not quote one of these without its chapeau, and the field says so
// rather than leaving it to be inferred from whether operative_context happens to be populated.
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import * as yaml from 'js-yaml';
import { createHash } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);
const WRITE = process.argv.includes('--write');
const norm = t => String(t ?? '').replace(/\s+/g, ' ').trim();

const LISTY = /\b(shall|must)\b[^.]{0,90}\b(contain|include|set forth|state|provide the following|specify)\b/i;
const DOCWORD = /\b(notice|notification|contract|agreement|statement|disclosure|summary|report|record|policy|authorization|request)\b/i;

function walkFiles(dir, test, out = []) {
  let entries = []; try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e); let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walkFiles(p, test, out); else if (test(e)) out.push(p);
  }
  return out;
}

const records = walkFiles(R('corpus'), e => e.endsWith('.yaml'))
  .filter(f => f.includes('/atoms/'))
  .map(f => { try { return { file: f, rec: yaml.load(readFileSync(f, 'utf8')) }; } catch { return null; } })
  .filter(x => x?.rec?.id);
const heldCitations = new Set(records.map(x => norm(x.rec.source?.citation)));
const heldIds = new Set(records.map(x => x.rec.id));

const slug = (section, path) => [section, ...(path ?? [])]
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


const PLACEHOLDER = /\b(undefined|null|NaN)\b/;

/**
 * A requirement element is addressed by DESIGNATOR. A path segment that is a term instead —
 * "Electronic health information (EHI)", the key a walker uses for a defined term — means the leaf
 * sits in a definitions structure, and it cannot be cited: appending it produced
 * "45 C.F.R. § 171.102(Electronic health information (EHI))(1)", prose inside a designator run.
 */
const DESIGNATOR = /^[A-Za-z0-9ivxlIVXL]{1,6}$/;

/**
 * A definition is not a duty, and the definitional "shall not" is the trap. 45 C.F.R. § 171.102
 * defines EHI and ends "but EHI shall not include:", so the list beneath it read as a PROHIBITION
 * and was cut with operative_verb "must_not" — asserting that someone is forbidden from doing
 * something, where the source is saying only what a word covers. An exclusion from a definition
 * narrows scope; it forbids nobody.
 */
const DEFINITIONAL = /^\s*(means|has the meaning|shall mean|refers to)\b|\b(shall|does) not include\b/i;

/**
 * Build a citation from a sibling record's citation, THE LEAF'S OWN SECTION, and its path.
 *
 * The section argument is the whole point and was missing from the first version, which reused
 * the template's section and appended the leaf's designators to it. A leaf under 45 C.F.R.
 * § 164.512(i)(2)(v) — IRB waiver documentation — was written out as § 164.402(i)(2)(v), the
 * breach definition, because § 164.402 happened to be the template. Verbatim, uniquely pathed,
 * internally consistent and citing the wrong provision: gate 30 compares the path against the
 * citation's trailing designators, which agreed, and nothing compared the SECTION.
 *
 * tools/bulk-provisions.mjs has always taken the section here. This function was reimplemented
 * beside it rather than shared, and the reimplementation lost the argument.
 */
function citationFor(templateCitation, section, path) {
  const suffix = (path ?? []).length ? `(${(path ?? []).join(')(')})` : '';
  const prefix = /^(.*?§\s*)/.exec(norm(templateCitation) ?? '')?.[1] ?? '';
  return `${prefix}${section}${suffix}`;
}

let cut = 0, already = 0, notInSource = 0, ambiguous = 0, badCitation = 0, noTemplate = 0;
let contextNotInSource = 0, definitional = 0, termKeyed = 0;
const perFile = new Map();

for (const segPath of walkFiles(R('corpus'), e => e.endsWith('.seg.json'))) {
  let doc; try { doc = JSON.parse(readFileSync(segPath, 'utf8')); } catch { continue; }
  const leaves = doc.leaves ?? [];
  const rawPath = R(String(doc.raw_file ?? ''));
  if (!existsSync(rawPath)) continue;
  // STRIP MARKUP BEFORE PROVING THE SPAN, as tools/bulk-provisions.mjs does. Comparing against
  // the raw XML fails for any span that crosses an element boundary — 92 perfectly good elements
  // were rejected that way on the first run — and gate 3 checks the rendering, not the tags.
  const rawRaw = readFileSync(rawPath, 'utf8');
  const rawText = norm(
    /json/i.test(String(doc.format ?? '')) || rawPath.endsWith('.json')
      ? (() => { const bits = [];
          (function collect(node) {
            if (typeof node === 'string') bits.push(node);
            else if (Array.isArray(node)) node.forEach(collect);
            else if (node && typeof node === 'object') Object.values(node).forEach(collect);
          })(JSON.parse(rawRaw));
          return bits.join(' ').replace(/\\[nrt]/g, ' '); })()
      : rawRaw.replace(/<[^>]+>/g, ' '));

  // A template record from the same source supplies jurisdiction, subject, regulator and the
  // source block. Without one there is nothing to inherit and nothing is invented.
  const template = records.find(x => R(String(x.rec.source?.raw_file ?? '')) === rawPath)?.rec;
  if (!template) { noTemplate += 1; continue; }

  const pathCount = new Map();
  for (const leaf of leaves) {
    const k = `${leaf.section}::${JSON.stringify((leaf.path ?? []).map(String))}`;
    pathCount.set(k, (pathCount.get(k) ?? 0) + 1);
  }

  for (const chapeau of leaves) {
    const head = norm(chapeau.text);
    if (!head.endsWith(':') || !LISTY.test(head) || !DOCWORD.test(head)) continue;
    if (DEFINITIONAL.test(head)) { definitional += 1; continue; }
    if (!(chapeau.path ?? []).every(seg => DESIGNATOR.test(String(seg)))) { termKeyed += 1; continue; }
    const kids = leaves.filter(l =>
      Array.isArray(l.path) && l.path.length > (chapeau.path ?? []).length &&
      (chapeau.path ?? []).every((s, i) => l.path[i] === s) &&
      String(l.section) === String(chapeau.section));
    if (kids.length < 2) continue;

    for (const leaf of kids) {
      const span = norm(leaf.text);
      if (span.length < 24 || span.endsWith(':')) continue;
      if (!(leaf.path ?? []).every(seg => DESIGNATOR.test(String(seg)))) { termKeyed += 1; continue; }
      const key = `${leaf.section}::${JSON.stringify((leaf.path ?? []).map(String))}`;
      if ((pathCount.get(key) ?? 0) > 1) { ambiguous += 1; continue; }
      const citation = citationFor(template.source?.citation, leaf.section, leaf.path);
      if (PLACEHOLDER.test(citation)) { badCitation += 1; continue; }
      if (heldCitations.has(citation)) { already += 1; continue; }
      if (!rawText.includes(span)) { notInSource += 1; continue; }

      const id = `${idBase(template.source.instrument_id)}.p.${slug(leaf.section, leaf.path)}`;
      if (heldIds.has(id)) { already += 1; continue; }

      // EVERY CONTEXT SPAN IS PROVED AGAINST THE RAW BYTES, not just the element's own span.
      // Segmentation leaf text is the walker's rendering and is not always the source verbatim:
      // under Educ. Law 2-d the raw reads "a. A parents bill of rights" and the leaf reads
      // "(a) A parents bill of rights", the designator having been normalised on the way in.
      // Gate 3 rejected five records written from such a leaf.
      //
      // An unprovable context entry is not dropped, because a context entry is recorded exactly
      // because it LIMITS the span it scopes; deleting one would quietly widen the element. If
      // any part of the chain is unprovable the whole record is skipped: without a chapeau that
      // the source demonstrably contains, there is no evidence this item is a requirement at all.
      const context = [
        { position: 'precedes', relation: 'scopes', verbatim_span: head,
          path: (chapeau.path ?? []).map(String),
          citation: citationFor(template.source?.citation, chapeau.section, chapeau.path) },
        ...(leaf.context ?? []).filter(cx => norm(cx.text) && norm(cx.text) !== head)
          .map(cx => ({ position: cx.position === 'follows' ? 'follows' : 'precedes',
                        relation: 'scopes', verbatim_span: norm(cx.text),
                        path: (cx.path ?? []).map(String),
                        citation: citationFor(template.source?.citation, leaf.section, cx.path) })),
      ];
      if (!context.every(cx => rawText.includes(cx.verbatim_span))) { contextNotInSource += 1; continue; }

      const mustNot = /\b(shall not|may not|must not)\b/i.test(head);
      const may = /\bmay\b/i.test(head) && !/\b(shall|must)\b/i.test(head);
      const verb = mustNot ? 'must_not' : (may ? 'may' : 'must');

      const rec = {
        schema_version: 1,
        record_type: 'provision',
        verification_status: 'verbatim_confirmed',
        jurisdiction: template.jurisdiction,
        jurisdiction_level: template.jurisdiction_level,
        regulator: template.regulator ?? [],
        sector: template.sector ?? [],
        data_types: template.data_types ?? [],
        status: 'in_force',
        effective_from: template.effective_from,
        effective_to: null,
        supersedes: null,
        superseded_by: null,
        amendment_history: [],
        confidence: 'medium',
        id,
        // SEGMENT HASH IS COMPUTED FOR THIS LEAF, never inherited. Spreading the template's
        // source block carried ITS segment_sha256 onto every new record, so each one claimed to
        // be anchored to a leaf it had never seen. Gate 38 caught it on the first write, which is
        // precisely the drift that gate exists for: the source bytes are unchanged and the
        // walker's reading of them is not.
        source: { ...template.source, citation,
                  segment_sha256: createHash('sha256').update(span, 'utf8').digest('hex') },
        verbatim_span: span,
        paragraph_path: {
          path: (leaf.path ?? []).map(String),
          anchor: String(leaf.section),
          derivation: 'structural',
          confidence: leaf.confidence ?? 'high',
          evidence: `read from ${basename(segPath)}, the segmentation of ${template.source.raw_file}`,
        },
        subject: template.subject,
        // THE CHAPEAU IS NOT OPTIONAL HERE. It is the only thing that makes this span a duty.
        operative_context: context,
        operative_verb: verb,
        operative_verb_source: 'operative_context',
        summary: span.slice(0, 300),
        not_yet_analysed:
          'Held as reference text, and it is an ITEM ON A LIST rather than a standalone provision: '
          + 'its own words carry no modal, and the duty is supplied by the chapeau recorded in '
          + 'operative_context. Do not quote it without that chapeau. No applicability predicate '
          + 'has been written, so the engine never asserts that it binds anyone.',
        open_questions: [],
      };

      const outDir = dirname(records.find(x =>
        R(String(x.rec.source?.raw_file ?? '')) === rawPath)?.file ?? '');
      if (!outDir) continue;
      const file = join(outDir, `${id.replace(/[.]/g, '-')}.yaml`);
      if (WRITE) {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(file, yaml.dump(rec, { lineWidth: 100, quotingType: "'", noRefs: true }));
      }
      heldCitations.add(citation); heldIds.add(id);
      cut += 1;
      perFile.set(basename(segPath), (perFile.get(basename(segPath)) ?? 0) + 1);
    }
  }
}

console.log(`${WRITE ? 'cut' : 'would cut'} ${cut} requirement element(s)`);
console.log(`  already held        : ${already}`);
console.log(`  context unprovable : ${contextNotInSource}`);
console.log(`  definitional       : ${definitional}`);
console.log(`  term-keyed path    : ${termKeyed}`);
console.log(`  path not unique     : ${ambiguous}`);
console.log(`  not provable in raw : ${notInSource}`);
console.log(`  placeholder citation: ${badCitation}`);
console.log(`  no template record  : ${noTemplate} source(s) skipped`);
for (const [f, n] of [...perFile.entries()].sort((a, z) => z[1] - a[1]).slice(0, 12))
  console.log(`    ${String(n).padStart(3)}  ${f}`);
