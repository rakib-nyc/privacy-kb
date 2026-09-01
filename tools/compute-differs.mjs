#!/usr/bin/env node
// COMPUTE differs_from FROM ELEMENTS. Never hand-write it.
//
// SCHEMA.md § 2 says differs_from is where a lot of the expert value lives. That is only true if
// the difference is checkable. A hand-written "differs from HIPAA because..." is an assertion
// nothing verifies, which is the DEBT-009 shape moved up one level: a field that reads as
// analysis and is really just prose.
//
// So each definition is decomposed into elements tagged with concepts from
// meta/definition-concepts.yaml, and the difference between two definitions is the set difference
// over their (kind, concept) pairs. Gate 26 recomputes and fails on disagreement, so the stored
// value can never drift from the elements that justify it.
//
//   node tools/compute-differs.mjs [--write]
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.yaml') && p.includes('/atoms/')) out.push(p);
  }
  return out;
}

export function key(el) { return `${el.kind}:${el.concept}`; }

/** The difference between two definition records, as sets of kind:concept pairs. */
export function diff(a, b) {
  const A = new Set((a.elements ?? []).map(key));
  const B = new Set((b.elements ?? []).map(key));
  const only_here  = [...A].filter(x => !B.has(x)).sort();
  const only_there = [...B].filter(x => !A.has(x)).sort();
  const shared     = [...A].filter(x =>  B.has(x)).sort();
  return { only_here, only_there, shared };
}

/** A sentence a reader can act on, generated from the computed sets — not typed by hand. */
export function narrate(a, b, c) {
  const nice = k => k.replace(/^(includes|excludes|requires):/, (_, m) => `${m} `).replace(/_/g, ' ');
  // LABEL BY CITATION WHEN THE DRAFTERS USED THE SAME WORDS. The narrator named each side by its
  // term_as_defined, which works while the collisions are "nonpublic personal information" vs
  // "protected health information" — different phrases for one concept. New York produced the
  // other kind: GBL § 899-ee(1) and GBL § 1500(4) both define "Covered user", one meaning a minor
  // and the other meaning nearly everybody, and the sentence came out as "Only Covered user: ...
  // Only Covered user: ...". The case where disambiguation matters MOST is the one where the label
  // stops disambiguating, so fall back to the citation, which is unique by construction.
  const collide = a.term_as_defined === b.term_as_defined;
  const la = collide ? `${a.term_as_defined} (${a.source.citation})` : a.term_as_defined;
  const lb = collide ? `${b.term_as_defined} (${b.source.citation})` : b.term_as_defined;
  const bits = [];
  bits.push(`"${a.term_as_defined}" (${a.source.citation}) vs "${b.term_as_defined}" (${b.source.citation}).`);
  if (c.only_here.length)
    bits.push(`Only ${la}: ${c.only_here.map(nice).join('; ')}.`);
  if (c.only_there.length)
    bits.push(`Only ${lb}: ${c.only_there.map(nice).join('; ')}.`);
  bits.push(c.shared.length ? `Shared: ${c.shared.map(nice).join('; ')}.`
                            : `NOTHING is shared between them — the same phrase names two disjoint concepts.`);
  return bits.join(' ');
}

// The CLI body runs only when invoked directly. validate.mjs imports diff() and narrate()
// for gate 26, and an unguarded top-level scan would print the whole report mid-validation.
if (process.argv[1] && process.argv[1].endsWith('compute-differs.mjs')) {
  const defs = walk(R('corpus'))
    .map(f => ({ f, r: yaml.load(readFileSync(f, 'utf8')) }))
    .filter(x => x.r?.record_type === 'definition');

  const byTerm = new Map();
  for (const d of defs) {
    if (!byTerm.has(d.r.term)) byTerm.set(d.r.term, []);
    byTerm.get(d.r.term).push(d);
  }

  let changed = 0;
  for (const [term, group] of byTerm) {
    console.log(`\n${term} — ${group.length} definition(s)`);
    for (const a of group) {
      const rows = group.filter(b => b.r.id !== a.r.id).map(b => {
        const computed = diff(a.r, b.r);
        return { id: b.r.id, difference: narrate(a.r, b.r, computed), computed };
      }).sort((x, y) => x.id.localeCompare(y.id));
      const before = JSON.stringify(a.r.differs_from ?? []);
      if (before !== JSON.stringify(rows)) {
        changed++;
        if (process.argv.includes('--write')) {
          a.r.differs_from = rows;
          writeFileSync(a.f, yaml.dump(a.r, { sortKeys: false, lineWidth: 100 }));
        }
      }
      for (const row of rows) console.log(`  ${a.r.id}\n    vs ${row.id}\n    ${row.difference}`);
    }
  }
  console.log(`\n${changed} record(s) ${process.argv.includes('--write') ? 'rewritten' : 'would change — rerun with --write'}`);
}
