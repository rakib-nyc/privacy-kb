// Evaluate an atom's `applies_if` against EntityFacts / DataFacts / event facts.
//
// NO LLM IN THIS PATH (invariant I8). Predicates are a tiny, closed grammar evaluated by
// code, and anything outside the grammar is a REFUSAL rather than a guess — an
// unrecognised predicate must never quietly evaluate true, because that would silently
// widen an obligation to entities it does not reach.
//
//   grammar:
//     <expr>      := { all: [<term>...] } | { any: [<term>...] } | { not: <term> }
//     <term>      := <expr> | <string predicate>
//     <predicate> := <path> <op> <literal>
//     <op>        := == | != | >= | <= | > | < | in | not_in
//     <path>      := entity.<field> | data.<field> | event.<field> | purpose.<field> | law.<field>
//     also        := "any:[a, b]"   inline disjunction, for readability in YAML
//
// Every evaluation returns WHY, because an applicability decision the engine cannot
// explain is not usable in a memo.

// Namespaces a predicate may address. `practice` is the act or practice at issue, which
// UDAP analysis needs as a first-class subject: GBL § 349's media exemption attaches to
// the act of carrying someone else's advertisement, not to the broadcaster, and there is
// no way to express that over entity facts alone.
const NS = new Set(['entity', 'data', 'event', 'purpose', 'law', 'practice']);

export const UNKNOWN = Symbol('unknown');

function lookup(path, facts) {
  const [ns, ...rest] = path.split('.');
  if (!NS.has(ns)) return { err: `unknown namespace "${ns}"` };
  const root = facts[ns];
  if (root == null) return { value: UNKNOWN };
  let v = root;
  for (const k of rest) {
    if (v == null || typeof v !== 'object' || !(k in v)) return { value: UNKNOWN };
    v = v[k];
  }
  return { value: v };
}

const MALFORMED = Symbol('malformed-literal');

function literal(tok) {
  const t = tok.trim();
  if (/^'.*'$/.test(t) || /^".*"$/.test(t)) return t.slice(1, -1);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  // INSIDE A LIST a bare token is an enum value, not garbage: `entity.hipaa_role in
  // [covered_entity]` is how the corpus writes it and quoting is not required there. A plain
  // identifier is accepted; anything carrying syntax characters is still malformed, so the
  // distinction stays between "unquoted value" and "unparsed expression".
  if (/^\[.*\]$/.test(t))
    return t.slice(1, -1).split(',')
      .map(x => x.trim()).filter(Boolean)
      .map(x => (/^[A-Za-z0-9_.:-]+$/.test(x) && !/^-?\d+(\.\d+)?$/.test(x)) ? x : literal(x))
      .filter(x => x !== MALFORMED);
  // ANYTHING ELSE IS MALFORMED, NOT A BARE STRING. This used to `return t`, so a right-hand side
  // the grammar did not recognise became a string literal to compare against — and a predicate
  // like `entity.x == true || nonsense(` passed every one of the 42 gates while comparing
  // entity.x to the literal text "true || nonsense(". Grammatical, evaluable, satisfiable, and
  // dead: the obligation could never apply, and nothing said so. Gate 21 checks the engine does
  // not refuse; gate 28 that the namespace is filled; gate 29 that a witness exists. All three
  // are satisfied by a comparison against garbage.
  //
  // Zero predicates in the corpus rely on a bare right-hand side — checked before changing this —
  // so refusing is free, and refusing is what an unrecognised token deserves.
  return MALFORMED;
}

const OPS = {
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '>':  (a, b) => a > b,
  '<':  (a, b) => a < b,
  // MEMBERSHIP for a scalar left side, INTERSECTION for a multi-valued one. The facts model
  // makes data_types and sectors arrays, so "data.types in ['consumer_report']" is the natural
  // way to ask "is a consumer report among the data at issue" — and under plain membership it
  // was silently, permanently false, because ['consumer_report'] is not an element of
  // ['consumer_report']. Another predicate that looks right and can never be true; this one was
  // caught by running the atom rather than by a gate, which is why the property test below
  // exists.
  'in': (a, b) => Array.isArray(b) && (Array.isArray(a) ? a.some(x => b.includes(x)) : b.includes(a)),
  'not_in': (a, b) => Array.isArray(b) && !b.includes(a),
};

/** @returns {{value: boolean|typeof UNKNOWN, why: string, refused?: string}} */
export function evalPredicate(src, facts) {
  const s = String(src).trim();

  // inline disjunction: "any:[x == 1, y == 2]"
  const anyM = /^any:\s*\[(.*)\]$/s.exec(s);
  if (anyM) {
    const parts = splitTop(anyM[1]);
    const rs = parts.map(p => evalPredicate(p, facts));
    if (rs.some(r => r.value === true))
      return { value: true, why: `any of [${parts.length}] held: ${rs.find(r => r.value === true).why}` };
    if (rs.some(r => r.value === UNKNOWN))
      return { value: UNKNOWN, why: `no branch held and at least one fact is unknown` };
    return { value: false, why: `no branch of any:[...] held` };
  }

  const m = /^([a-z_]+\.[A-Za-z0-9_.]+)\s+(==|!=|>=|<=|>|<|not_in|in)\s+(.+)$/s.exec(s);
  if (!m) return { value: UNKNOWN, refused: `predicate not in the grammar: ${s}`,
                   why: `REFUSED — unparseable predicate, treated as unknown rather than true` };
  const [, path, op, rhsRaw] = m;
  // SHAPE BEFORE FACTS. A malformed right-hand side is malformed whatever the caller supplied,
  // and checking it after the lookup meant an UNKNOWN left-hand side returned first — so a probe
  // against EMPTY facts, which is exactly how gate 21 tests a predicate, never reached the RHS at
  // all. The check existed and the gate could not see it.
  const rhs = literal(rhsRaw);
  if (rhs === MALFORMED)
    return { value: UNKNOWN,
             refused: `right-hand side is not a literal the grammar recognises: ${JSON.stringify(rhsRaw)}`,
             why: `REFUSED — "${rhsRaw}" is not true/false/null, a number, a quoted string or a ` +
                  `bracketed list. Comparing against it as text would make this predicate ` +
                  `permanently false while every structural check passed.` };
  const { value: lhs, err } = lookup(path, facts);
  if (err) return { value: UNKNOWN, refused: err, why: `REFUSED — ${err}` };
  if (lhs === UNKNOWN) return { value: UNKNOWN, why: `${path} is not among the supplied facts` };
  const out = OPS[op](lhs, rhs);
  return { value: out, why: `${path} (${JSON.stringify(lhs)}) ${op} ${JSON.stringify(rhs)} -> ${out}` };
}

function splitTop(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

/** Evaluate a whole applies_if expression. Total: never throws. */
export function evaluate(expr, facts) {
  if (expr == null) return { value: UNKNOWN, why: 'no applies_if expression', decided_by: null };
  if (typeof expr === 'string') {
    const r = evalPredicate(expr, facts);
    return { value: r.value, why: r.why, decided_by: expr, refused: r.refused };
  }
  if (Array.isArray(expr)) return evaluate({ all: expr }, facts);

  if (expr.all) {
    const rs = expr.all.map(t => evaluate(t, facts));
    const failed = rs.find(r => r.value === false);
    if (failed) return { value: false, why: failed.why, decided_by: failed.decided_by };
    const unk = rs.find(r => r.value === UNKNOWN);
    if (unk) return { value: UNKNOWN, why: unk.why, decided_by: unk.decided_by, refused: unk.refused };
    return { value: true, why: `all ${rs.length} conditions held`, decided_by: expr.all };
  }
  if (expr.any) {
    const rs = expr.any.map(t => evaluate(t, facts));
    const held = rs.find(r => r.value === true);
    if (held) return { value: true, why: held.why, decided_by: held.decided_by };
    if (rs.some(r => r.value === UNKNOWN))
      return { value: UNKNOWN, why: 'no branch held and a fact is unknown', decided_by: null };
    return { value: false, why: 'no branch of any held', decided_by: expr.any };
  }
  if (expr.not) {
    const r = evaluate(expr.not, facts);
    if (r.value === UNKNOWN) return r;
    return { value: !r.value, why: `not(${r.why})`, decided_by: r.decided_by };
  }
  return { value: UNKNOWN, refused: `unrecognised expression shape: ${Object.keys(expr).join(',')}`,
           why: 'REFUSED — unrecognised applies_if shape' };
}
