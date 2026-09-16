// TRANSLATING AN ENGINEERING VOCABULARY INTO LEGAL FACTS, WITHOUT ASSERTING WHAT IT CANNOT KNOW.
//
// A team that has annotated its stack in Fideslang knows which systems hold
// `user.health_and_medical` and which hold `user.financial`. What it does not know is which
// duties follow, and that is the gap this corpus is for. Bridging the two is the most direct form
// of "the authority layer underneath": the platform holds the facts, this holds the obligations.
//
// THE BRIDGE IS THE DANGEROUS PART, and the danger runs one way. A data category describes what
// information IS. Most legal facts turn on who holds it, why, and about whom:
//
//   user.health_and_medical  ->  data.is_phi          ONLY if a covered entity holds it
//   user.financial           ->  is_nonpublic_...     ONLY through a financial-institution
//                                                      relationship
//   user.childrens           ->  under 13? under 18?  three statutes, three lines
//
// A mapping that resolved the first of those unconditionally would hand an ordinary wellness app
// the entire HIPAA Privacy Rule, and every downstream answer would be confidently wrong. So this
// module never asserts a conditional mapping on its own. It returns three lists — facts it will
// assert, facts that need another fact first, and categories it can only surface — and the caller
// decides. Declared mappings live in meta/vocabulary-map.yaml with a reason on every entry.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';

const FILE = resolve(import.meta.dirname, '../meta/vocabulary-map.yaml');
let MAP = null;
function vocabularies() {
  if (MAP) return MAP;
  MAP = existsSync(FILE) ? (yaml.load(readFileSync(FILE, 'utf8'))?.vocabularies ?? {}) : {};
  return MAP;
}
export function knownVocabularies() { return Object.keys(vocabularies()); }

/** Hierarchical keys inherit: user.health_and_medical.genetic is also user.health_and_medical. */
function ancestry(key) {
  const parts = String(key ?? '').split('.').filter(Boolean);
  const out = [];
  for (let i = parts.length; i > 0; i -= 1) out.push(parts.slice(0, i).join('.'));
  return out;                                    // most specific first
}

/**
 * Translate external vocabulary terms into this corpus's facts.
 *
 * Returns `assert` (safe to set), `conditional` (needs another fact, with the fact named),
 * `surface` (overlaps but does not match — for a human) and `unmapped` (no entry at all, declared
 * rather than dropped). Total on hostile input.
 */
export function translate(terms, options) {
  const name = options?.vocabulary ?? 'fideslang';
  const vocab = vocabularies()[name];
  const shape = { vocabulary: name, assert: {}, conditional: [], surface: [], unmapped: [],
                  error: null };
  if (!vocab) return { ...shape, error: `no declared mapping for vocabulary "${name}". ` +
    `Known: ${knownVocabularies().join(', ') || 'none'}.` };

  const input = Array.isArray(terms) ? terms : (terms ? [terms] : []);
  const byKey = new Map();
  for (const group of ['data_categories', 'data_subjects'])
    for (const entry of vocab[group] ?? []) {
      if (!byKey.has(entry.key)) byKey.set(entry.key, []);
      byKey.get(entry.key).push({ ...entry, group });
    }

  const held = new Set(Object.keys(options?.facts ?? {}).flatMap(ns =>
    Object.entries(options.facts[ns] ?? {}).filter(([, v]) => v === true).map(([k]) => `${ns}.${k}`)));

  for (const raw of input) {
    const term = String(raw ?? '').trim();
    if (!term) continue;
    const matched = ancestry(term).map(candidate => byKey.get(candidate)).find(Boolean);
    if (!matched) { shape.unmapped.push(term); continue; }
    for (const entry of matched) {
      if (!entry.maps_to) { shape.surface.push({ term, fact: null, why: entry.note ?? null }); continue; }
      if (entry.confidence === 'direct') {
        const [ns, key] = entry.maps_to.split('.');
        shape.assert[ns] = { ...(shape.assert[ns] ?? {}), [key]: true };
      } else if (entry.confidence === 'conditional') {
        const missing = (entry.requires ?? []).filter(need => !held.has(need));
        if (!missing.length) {
          const [ns, key] = entry.maps_to.split('.');
          shape.assert[ns] = { ...(shape.assert[ns] ?? {}), [key]: true };
        } else {
          shape.conditional.push({ term, fact: entry.maps_to, requires: entry.requires ?? [],
                                   missing, why: entry.note ?? null });
        }
      } else {
        shape.surface.push({ term, fact: entry.maps_to, why: entry.note ?? null });
      }
    }
  }
  return { ...shape,
    note: 'Facts under `assert` are safe to set. Facts under `conditional` are NOT set: each ' +
      'needs the listed fact established first, because a data category describes what ' +
      'information is, while most legal facts turn on who holds it and why. `surface` entries ' +
      'overlap a fact key without matching it and are for a person to resolve.' };
}
