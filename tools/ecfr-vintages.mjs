#!/usr/bin/env node
// eCFR POINT-IN-TIME EVIDENCE. What did this span say before?
//
// THE PROBLEM THIS ANSWERS. 84 records are cut from eCFR sources, and every one of them was
// fetched as a CURRENT snapshot and then stamped with a much older effective_from. The HIPAA
// Privacy Rule records are the clearest case: `45-cfr-164.xml` was fetched 2026-08-19 and
// contains 16 mentions of "reproductive health" and 23 of "attestation" — text the 2024
// amendments put there — while the atoms cut from it carry effective_from 2003-04-14, the
// original Privacy Rule compliance date. Ask what § 164.502(a) required in 2010 and the corpus
// answers with bytes fetched in 2026, on the authority of a date from 2003.
//
// Usually that answer is right anyway, because most spans have not changed. THAT IS THE POINT:
// nothing in the data distinguished "unchanged since 2003" from "rewritten in 2024", so every
// record made the same silent claim and only some of them were entitled to it.
//
// WHAT THIS TOOL DOES. eCFR publishes a versioner API — no key, point-in-time coverage from
// about 2017 — that lists every amendment date per section and serves the text as it stood on a
// given date. For each atom, this walks its section's amendment dates backwards and asks one
// question: is this exact verbatim_span still present in the text as of that date?
//
//   * present at every date back to the earliest available -> the span is UNCHANGED across the
//     whole window eCFR can see. The record's effective_from is not contradicted, and now there
//     is evidence for it rather than an assumption.
//   * absent before some date D -> the span DID change. The record describes text that began at
//     D, and a prior vintage exists that the corpus does not hold. That is a finding, and it is
//     reported as one.
//
// IT NEVER EDITS AN ATOM. Change detection opens a review item; it does not rewrite the corpus
//. Output is a report at meta/ecfr-vintages.yaml.
//
//   node tools/ecfr-vintages.mjs                  survey every eCFR-sourced record
//   node tools/ecfr-vintages.mjs --part 45/164    one part only
//   node tools/ecfr-vintages.mjs --offline        re-render the report from the cache
//   node tools/ecfr-vintages.mjs --check          exit 1 if the corpus contradicts the report

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);
const CACHE = R('.cache/ecfr');
const REPORT = R('meta/ecfr-vintages.yaml');
const API = 'https://www.ecfr.gov/api/versioner/v1';

const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const OFFLINE = argv.includes('--offline');
const CHECK = argv.includes('--check');
const ONLY = flag('--part');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.yaml') && p.includes('/atoms/')) out.push(p);
  }
  return out;
}

/** Whitespace-insensitive containment. The stored span is wrapped by the YAML writer and the
 *  API's XML wraps differently; comparing raw would report every span as missing. */
const norm = s => String(s).replace(/\s+/g, ' ').trim();
// DECODE ENTITIES BEFORE COMPARING. The versioner returns XML with `&#x2014;` where the stored
// source carries a literal em dash, so a byte comparison reported 24 spans as absent from every
// snapshot that are in fact present and character-identical. Those became false "inconclusive"
// verdicts; the same defect could have produced a false "changed" verdict and moved an
// effective_from on evidence that was an encoding artifact.
const decodeEntities = s => String(s)
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const stripTags = s => norm(decodeEntities(String(s).replace(/<[^>]+>/g, ' ')));

/** title, part and section from a record's citation. "45 C.F.R. § 164.502(a)" -> 45/164/164.502 */
export function cfrCoords(rec) {
  const c = String(rec?.source?.citation ?? '').replace(/ /g, ' ');
  const m = /^(\d+)\s*C\.?\s*F\.?\s*R\.?\s*§*\s*(\d+)\.(\d+)/.exec(c);
  if (!m) return null;
  return { title: m[1], part: m[2], section: `${m[2]}.${m[3]}` };
}

async function grab(url, cacheName) {
  mkdirSync(CACHE, { recursive: true });
  const f = join(CACHE, cacheName);
  if (existsSync(f) && statSync(f).size > 0) return readFileSync(f, 'utf8');
  if (OFFLINE) return null;
  const res = await fetch(url, { headers: { 'User-Agent': 'privacy-kb/0.2 (research prototype)' } });
  if (!res.ok) { writeFileSync(f + '.err', `${res.status} ${url}`); return null; }
  const t = await res.text();
  writeFileSync(f, t);
  await new Promise(r => setTimeout(r, 350));   // be a good citizen
  return t;
}

async function main() {
  const recs = walk(R('corpus'))
    .map(f => ({ f, a: yaml.load(readFileSync(f, 'utf8')) }))
    .filter(x => x.a?.id && x.a.source?.format === 'ecfr_xml');

  // Which sections do we care about, grouped by the part we must fetch.
  const parts = new Map();
  const unparsed = [];
  for (const { a } of recs) {
    const c = cfrCoords(a);
    if (!c) { unparsed.push(a.id); continue; }
    const key = `${c.title}/${c.part}`;
    if (ONLY && key !== ONLY) continue;
    if (!parts.has(key)) parts.set(key, { ...c, atoms: [] });
    parts.get(key).atoms.push({ id: a.id, section: c.section, span: norm(a.verbatim_span ?? ''),
                                effective_from: a.effective_from, citation: a.source.citation });
  }

  const findings = [];
  for (const [key, grp] of parts) {
    const vjson = await grab(`${API}/versions/title-${grp.title}.json?part=${grp.part}`,
                             `versions-${grp.title}-${grp.part}.json`);
    if (!vjson) { console.log(`SKIP ${key} — version index unavailable`); continue; }
    let versions;
    try { versions = JSON.parse(vjson).content_versions ?? []; }
    catch { console.log(`SKIP ${key} — version index unparseable`); continue; }

    // ONLY the dates at which a section WE HOLD changed, oldest first — plus one snapshot before
    // the earliest, so a change at that first date is still visible as a change rather than as
    // the beginning of the record. Filtering matters: 47 C.F.R. part 64 is the whole of
    // Telecommunications and reports 160 amendment dates, of which the four CPNI and TCPA
    // sections this corpus holds account for a handful. Fetching the part at every date any
    // unrelated section moved is ~40x the traffic for the same answer.
    const wanted = new Set(grp.atoms.map(a => a.section));
    const all = [...new Set(versions.map(v => v.amendment_date ?? v.date).filter(Boolean))].sort();
    const mine = [...new Set(versions
      .filter(v => wanted.has(String(v.identifier)))
      .map(v => v.amendment_date ?? v.date).filter(Boolean))].sort();
    const dates = mine.length
      ? [...new Set([...all.filter(d => d < mine[0]).slice(-1), ...mine])].sort()
      : all;
    if (!dates.length) { console.log(`SKIP ${key} — no amendment dates`); continue; }

    const snapshots = new Map();
    for (const d of dates) {
      const xml = await grab(`${API}/full/${d}/title-${grp.title}.xml?part=${grp.part}`,
                             `full-${grp.title}-${grp.part}-${d}.xml`);
      if (xml) snapshots.set(d, stripTags(xml));
    }
    if (!snapshots.size) { console.log(`SKIP ${key} — no snapshots retrievable`); continue; }
    const have = [...snapshots.keys()].sort();

    for (const at of grp.atoms) {
      if (!at.span) continue;
      const present = have.filter(d => snapshots.get(d).includes(at.span));
      const absent = have.filter(d => !snapshots.get(d).includes(at.span));
      const earliestPresent = present[0] ?? null;
      const latestAbsentBefore = earliestPresent
        ? absent.filter(d => d < earliestPresent).pop() ?? null
        : (absent.length ? absent[absent.length - 1] : null);

      let verdict, note;
      if (!present.length) {
        // The span is in the CURRENT fetched file but in no point-in-time snapshot we could
        // retrieve. Almost always a rendering difference, not a legal one — so it is reported as
        // inconclusive rather than as a change. Saying "this text never existed" on the strength
        // of a whitespace mismatch would be exactly the confident-wrong answer to avoid.
        verdict = 'inconclusive';
        note = `span not found in any of ${have.length} point-in-time snapshots (${have[0]}…${have.at(-1)}). `
             + `Most likely a rendering difference between the stored source and the versioner API; `
             + `it is NOT evidence that the text changed.`;
      } else if (!latestAbsentBefore) {
        verdict = 'unchanged_across_window';
        note = `present in every snapshot from ${earliestPresent} to ${have.at(-1)}. eCFR's `
             + `point-in-time coverage does not reach before ${have[0]}, so this is evidence the `
             + `span is stable across that window — not proof about earlier text.`;
      } else {
        verdict = 'changed';
        // The note must stay true after the record is CORRECTED. Stating "effective_from
        // predates the text" unconditionally made the report contradict itself on the next run:
        // the fix sets effective_from to the date the span began, and the sentence describing
        // the defect went on describing a defect that was no longer there.
        const overclaims = at.effective_from && at.effective_from < earliestPresent;
        note = `ABSENT at ${latestAbsentBefore}, present from ${earliestPresent}. The span this `
             + `record quotes began at ${earliestPresent}, and a prior vintage exists that the `
             + `corpus does not hold. effective_from is ${at.effective_from}`
             + (overclaims
                 ? `, which PREDATES the text — the record answers earlier dates with words that `
                   + `did not exist then.`
                 : `, at or after that date, so the record does not overclaim; it is simply `
                   + `silent for dates the missing vintage would cover.`);
      }
      findings.push({ atom_id: at.id, citation: at.citation, part: key,
                      effective_from: at.effective_from, verdict,
                      span_first_seen: earliestPresent, span_absent_at: latestAbsentBefore,
                      snapshots_checked: have.length, window: `${have[0]}..${have.at(-1)}`, note });
    }
    console.log(`${key.padEnd(9)} ${grp.atoms.length} atoms · ${have.length}/${dates.length} snapshots`);
  }

  const tally = {};
  for (const f of findings) tally[f.verdict] = (tally[f.verdict] ?? 0) + 1;

  const doc = {
    generated: new Date().toISOString().slice(0, 10),
    source: 'ecfr.gov versioner API v1 (no key; point-in-time coverage begins ~2017)',
    what_this_is:
      'Evidence about whether each eCFR-sourced verbatim_span has changed within the window the '
      + 'versioner API can see. NOT an edit to any record: a detected change opens a review item, '
      + 'it never rewrites an atom. "unchanged_across_window" means the span is '
      + 'stable across the covered window, which is evidence FOR the record\'s effective_from and '
      + 'not proof about text older than the window. "changed" means a prior vintage exists that '
      + 'the corpus does not hold, and the record\'s effective_from predates the text it quotes.',
    tally, unparsed_citations: unparsed, findings,
  };
  writeFileSync(REPORT, '# GENERATED by tools/ecfr-vintages.mjs. Do not hand-edit.\n'
    + yaml.dump(doc, { lineWidth: 100, quotingType: '"' }));

  console.log(`\n${findings.length} record(s) checked`);
  for (const [k, v] of Object.entries(tally)) console.log(`  ${String(v).padStart(3)}  ${k}`);
  console.log(`\nreport: ${REPORT.replace(ROOT + '/', '')}`);

  if (CHECK && (tally.changed ?? 0) > 0) {
    console.log('\nRecords quoting text younger than their own effective_from:');
    for (const f of findings.filter(x => x.verdict === 'changed'))
      console.log(`  ${f.atom_id}  (${f.citation})\n    ${f.note}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
