// LEGAL CHARACTERISATION OF AN INCIDENT — and why an unasserted one must never be silent.
//
// THE BUG THIS EXISTS TO CLOSE. `breachNotificationTimeline` returned `complete: true`, with no
// warning, for a New York hospital that lost PHI — and omitted N.Y. GBL § 899-aa(2). The omitted
// clock was a MONTH EARLIER than every HIPAA date it did show. A lawyer relying on that artifact
// misses the first deadline and holds a document asserting they were on time.
//
// The mechanism was `event.type` as a single scalar. HIPAA's atoms demanded
// `event.type == 'breach_of_unsecured_phi'`; SHIELD's demanded
// `'breach_of_security_of_the_system'`. One incident satisfied either, never both. That is now
// fixed — event.type is a SET and the predicates use `in` — but fixing the representation is not
// enough on its own, because a caller who characterises the incident ONE way still loses the
// other, silently, exactly as before.
//
// So the representation fix is paired with a reporting rule: an obligation excluded SOLELY
// because a characterisation was not asserted is not "not applicable". It is a DECISION THE
// LAWYER HAS NOT MADE YET, and it is surfaced as one.
//
// WHY THE ENGINE DOES NOT DECIDE THIS ITSELF. Whether an incident is a "breach of unsecured PHI"
// is not a lookup — 45 C.F.R. § 164.402 makes it the output of a four-factor risk assessment
// that the covered entity must perform and document. Whether it is a "breach of the security of
// the system" is a different test under N.Y. GBL § 899-aa(1)(c). Deriving either automatically
// would be the engine performing the legal analysis it exists to support, and would be wrong in
// the confident direction. Surfacing the question is the honest move; answering it is not the
// engine's to make.
//
// The general lesson this encodes: CORPUS COVERAGE IS NOT ANSWER COVERAGE. The old completeness
// check asked "does the corpus carry New York's notify duty" — it did, so the check passed —
// while the event model excluded that duty from the answer. A check on the corpus cannot see a
// hole in the answer.

/** Anything to an array, so a scalar and a one-element list behave identically. */
export const asSet = v => v == null ? [] : (Array.isArray(v) ? v.filter(x => x != null) : [v]);

/**
 * The incident characterisations an atom's predicate demands, pulled out of its
 * `event.type in [...]` terms. Returns [] for an atom that does not turn on characterisation.
 *
 * Walks the whole expression tree because a characterisation can sit inside any/all/not.
 */
export function requiredCharacterisations(expr, out = new Set()) {
  if (!expr) return [...out];
  if (typeof expr === 'string') {
    // event.type in ['a', "b"]  — quoted or bare, the grammar accepts both inside brackets.
    const m = /^\s*event\.type\s+in\s+\[(.*)\]\s*$/s.exec(expr);
    if (m) {
      for (const tok of m[1].split(',')) {
        const t = tok.trim().replace(/^['"]|['"]$/g, '');
        if (t) out.add(t);
      }
      return [...out];
    }
    // inline disjunction: any:[ ... , ... ]
    const anyM = /^\s*any:\s*\[(.*)\]\s*$/s.exec(expr);
    if (anyM) {
      let depth = 0, cur = '';
      for (const ch of anyM[1]) {
        if (ch === '[') depth++;
        if (ch === ']') depth--;
        if (ch === ',' && depth === 0) { requiredCharacterisations(cur, out); cur = ''; continue; }
        cur += ch;
      }
      if (cur.trim()) requiredCharacterisations(cur, out);
    }
    return [...out];
  }
  if (Array.isArray(expr)) { for (const e of expr) requiredCharacterisations(e, out); return [...out]; }
  if (typeof expr === 'object') {
    for (const k of ['all', 'any']) if (expr[k]) requiredCharacterisations(expr[k], out);
    if (expr.not) requiredCharacterisations(expr.not, out);
  }
  return [...out];
}

/**
 * Has the caller told us an incident happened at all?
 *
 * This gates the whole report. Without it, a caller asking a routine question with no incident
 * in view would be handed every breach duty in the corpus as an unmade decision — noise that
 * would train a reader to skip the section that matters.
 */
export function incidentAsserted(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.occurred === true) return true;
  return asSet(event.type).length > 0;
}

/**
 * Would this atom apply if the incident were ALSO characterised the way it requires?
 *
 * Re-runs the atom's own predicate with its characterisations added rather than inspecting the
 * expression, so the answer is decided by the same evaluator that decided the original — there
 * is no second implementation of the grammar to drift.
 *
 * @returns {null | {missing: string[], why: string}}
 */
export function characterisationGap(atom, facts, evaluate, TRUE_VALUE = true) {
  const need = requiredCharacterisations(atom?.applies_if);
  if (!need.length) return null;
  if (!incidentAsserted(facts.event)) return null;
  const asserted = asSet(facts.event.type);
  const missing = need.filter(c => !asserted.includes(c));
  if (!missing.length) return null;
  const probe = evaluate(atom.applies_if,
    { ...facts, event: { ...facts.event, type: [...asserted, ...need] } });
  if (probe.value !== TRUE_VALUE) return null;   // something ELSE also fails; not a pure gap
  return { missing, why: probe.why };
}
