// THE FACT VOCABULARY A CALLER MAY SPEAK — and the terms that mean different things to
// different statutes.
//
// THE DEFECT. 127 fact keys gated the corpus and a caller had no way to learn any of them. Two
// concepts were spelled two ways each, with no indication that either spelling existed:
//
//   "we are a HIPAA covered entity"    -> 10, 3 or 13 obligations, depending on whether you
//                                         guessed is_hipaa_covered_entity, hipaa_role, or both
//   "we are a financial institution"   -> 4 or 1 of the 5 GLBA Safeguards obligations; ONE RULE
//                                         was split across two keys and neither was complete
//
// Both are now single keys in the corpus. This module keeps the old spellings working, because
// an MCP client written against them must not silently start returning less.
//
// THE HARDER PROBLEM, WHICH IS LEGAL RATHER THAN TYPOGRAPHICAL. `is_financial_institution` was
// also gating three statutes that define the term differently:
//
//   GLBA  16 C.F.R. § 313.3(k)    broad    — reaches tax preparers, car dealers, appraisers
//   RFPA  12 U.S.C. § 3401(1)     narrow   — banks, card issuers, consumer finance institutions
//   BSA   31 U.S.C. § 5312(a)(2)  broadest — 26 enumerated categories, casinos among them
//
// A caller asserting one boolean was asserting all three populations at once. That is DEBT-022
// live on a high-traffic key: a correct-looking answer about the wrong population. The corpus
// now uses a definition-specific key per statute. A caller who still says "financial
// institution" in the ordinary sense gets all three — and is TOLD that is what happened, with
// the definitions, so they can narrow it. Expanding silently would be the same bug wearing a
// tidier name.

/** Old or informal spelling -> the key the corpus actually uses. */
export const FACT_ALIASES = {
  'entity.hipaa_role:covered_entity': 'entity.is_hipaa_covered_entity',
  'entity.hipaa_role:business_associate': 'entity.is_hipaa_business_associate',
  'entity.is_covered_entity': 'entity.is_hipaa_covered_entity',
  'entity.is_business_associate': 'entity.is_hipaa_business_associate',
  'entity.is_ce': 'entity.is_hipaa_covered_entity',
};

/**
 * Terms whose ORDINARY meaning spans several statutory definitions. Asserting one of these is
 * asserting every population under it, which is sometimes what the caller means and must never
 * be assumed.
 */
export const AMBIGUOUS_TERMS = {
  'entity.is_financial_institution': {
    expands_to: ['entity.glba_financial_institution',
                 'entity.rfpa_financial_institution',
                 'entity.bsa_financial_institution'],
    definitions: {
      'entity.glba_financial_institution':
        'GLBA, 16 C.F.R. § 313.3(k) — broad. Reaches tax preparers, car dealers and appraisers, '
        + 'not only banks.',
      'entity.rfpa_financial_institution':
        'Right to Financial Privacy Act, 12 U.S.C. § 3401(1) — narrow. Banks, card issuers and '
        + 'consumer finance institutions.',
      'entity.bsa_financial_institution':
        'Bank Secrecy Act, 31 U.S.C. § 5312(a)(2) — broadest. Twenty-six enumerated categories, '
        + 'casinos and money services businesses among them.',
    },
    caution:
      '"Financial institution" is not one population. An entity inside the GLBA definition may '
      + 'sit outside the RFPA one, and the BSA reaches businesses neither of the others does. '
      + 'This answer assumed ALL THREE. Assert the specific key to narrow it.',
  },
};

const NS = new Set(['entity', 'data', 'event', 'purpose', 'law', 'practice']);
const own = (o, k) => (typeof k === 'string' && Object.hasOwn(o, k)) ? o[k] : undefined;

/**
 * Expand aliases and ambiguous terms across a whole fact bundle, reporting every expansion.
 *
 * Returns `{ facts, warnings }`. Never mutates the input. An expansion that the caller cannot
 * see is indistinguishable from the engine guessing.
 */
export function normaliseFacts(bundle) {
  // Total on null: a default covers `undefined` only. See engine/memo.mjs for the same note.
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) bundle = {};
  const out = {};
  const warnings = [];
  for (const ns of NS) out[ns] = { ...(bundle[ns] ?? {}) };

  for (const ns of NS) {
    for (const [k, v] of Object.entries(bundle[ns] ?? {})) {
      const full = `${ns}.${k}`;

      // Value-carrying alias: entity.hipaa_role: 'covered_entity' -> entity.is_hipaa_covered_entity
      const valued = own(FACT_ALIASES, `${full}:${v}`);
      if (valued) {
        const [tns, tk] = valued.split('.');
        if (out[tns][tk] === undefined) out[tns][tk] = true;
        warnings.push({ kind: 'alias', supplied: full, supplied_value: v, resolved_to: valued,
          note: `"${full}: ${JSON.stringify(v)}" is an older spelling. Read as ${valued} = true.` });
        continue;
      }
      // Plain alias: entity.is_covered_entity -> entity.is_hipaa_covered_entity
      const plain = own(FACT_ALIASES, full);
      if (plain) {
        const [tns, tk] = plain.split('.');
        if (out[tns][tk] === undefined) out[tns][tk] = v;
        warnings.push({ kind: 'alias', supplied: full, resolved_to: plain,
          note: `"${full}" is an older spelling of ${plain}.` });
        continue;
      }
      // Ambiguous ordinary-language term covering several statutory definitions.
      const amb = own(AMBIGUOUS_TERMS, full);
      if (amb && v === true) {
        const filled = [];
        for (const t of amb.expands_to) {
          const [tns, tk] = t.split('.');
          if (out[tns][tk] === undefined) { out[tns][tk] = true; filled.push(t); }
        }
        warnings.push({ kind: 'ambiguous_term', supplied: full, expanded_to: filled,
          definitions: amb.definitions, note: amb.caution });
      }
    }
  }
  return { facts: out, warnings };
}

/** Every namespace the engine fills, for the discovery tool. */
export const NAMESPACES = {
  entity: 'who the organisation IS — status, sector, role under a statute',
  data: 'what the DATA is — category, subject, whether a statutory definition reaches it',
  event: 'what HAPPENED — incident characterisations and the dates that start clocks',
  practice: 'what the organisation DOES — the act or practice at issue',
  purpose: 'WHY the data is used',
  law: 'facts about other LAW, for preemption predicates',
};

// ---------------------------------------------------------------- discovery
// DERIVED FROM THE CORPUS, NEVER HAND-MAINTAINED. The point of this vocabulary is that a caller
// can find out what to assert; a hand-written list would drift from the predicates it describes
// and the drift would be invisible, which is the failure it exists to fix.
const PRED = /((?:entity|data|event|practice|purpose|law)\.[A-Za-z0-9_.]+)\s+(==|!=|>=|<=|>|<|not_in|in)\s+(\[[^\]]*\]|'[^']*'|"[^"]*"|[^,}\]]+)/g;

/** Pull `path op literal` triples out of any applies_if / exemption expression tree. */
function scanExpr(expr, sink) {
  const s = JSON.stringify(expr ?? {});
  for (const m of s.matchAll(PRED)) {
    const val = m[3].trim().replace(/\\+/g, '').replace(/^["']|["']$/g, '');
    sink(m[1], m[2], val);
  }
}

/**
 * Every fact key the corpus predicates on, with what it gates and what values it takes.
 *
 * `used_by_obligation` vs `used_by_exemption` matters: red-teaming 0.1 found 64 keys that appear
 * ONLY inside an exemption, so nothing in the repository demonstrated they existed and in
 * practice the carve-out never fired. A key nobody can discover is a key nobody supplies.
 */
export function factInventory(corpus) {
  const keys = new Map();
  const touch = k => {
    if (!keys.has(k)) keys.set(k, { key: k, namespace: k.split('.')[0],
      operators: new Set(), values: new Set(), instruments: new Set(),
      used_by_obligation: 0, used_by_exemption: 0 });
    return keys.get(k);
  };
  for (const a of corpus.all ?? []) {
    const inst = a.source?.instrument_id ?? null;
    scanExpr(a.applies_if, (k, op, v) => {
      const e = touch(k); e.operators.add(op); if (v) e.values.add(v);
      if (inst) e.instruments.add(inst); e.used_by_obligation++;
    });
    for (const ex of a.exemptions ?? [])
      scanExpr(ex.applies_if, (k, op, v) => {
        const e = touch(k); e.operators.add(op); if (v) e.values.add(v);
        if (inst) e.instruments.add(inst); e.used_by_exemption++;
      });
  }
  return [...keys.values()].map(e => ({
    key: e.key, namespace: e.namespace,
    operators: [...e.operators],
    // A bracketed list is written as one token by the scanner; split it for readability.
    accepted_values: [...new Set([...e.values].flatMap(v =>
      /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map(x => x.trim().replace(/^["']|["']$/g, '')) : [v]
    ).filter(Boolean))],
    gates_obligations: e.used_by_obligation,
    gates_exemptions: e.used_by_exemption,
    instruments: [...e.instruments].sort(),
    // The condition red-teaming named: reachable only through an exemption, so undemonstrated.
    exemption_only: e.used_by_obligation === 0 && e.used_by_exemption > 0,
    ambiguous_term: Object.hasOwn(AMBIGUOUS_TERMS, e.key) ? AMBIGUOUS_TERMS[e.key] : null,
    aliases: Object.entries(FACT_ALIASES).filter(([, t]) => t === e.key).map(([a]) => a),
    // NOTE THE PARAMETER NAMES: never `a`. tools/check-engine-schema.mjs reads `a.<field>` in
    // engine code as a RECORD field access, so sorting inventory entries with (a, b) reported
    // this file as depending on record fields named `key` and `gates_obligations` that no record
    // carries. mcp/server.mjs carries the same note for the same reason. Rename the variable,
    // never the check.
  })).sort((lhs, rhs) => rhs.gates_obligations - lhs.gates_obligations
                      || lhs.key.localeCompare(rhs.key));
}
