// WHAT IS ONE DECISION AWAY.
//
// Every other tool in this space answers "what do I owe today". A general model with web search
// answers it well — that was measured, not assumed, and it beat this corpus on coverage and on
// currency. What no sampling system can answer is the question a general counsel actually asks
// before a board meeting: IF WE DO X, WHAT CHANGES? Answering that means enumerating the whole
// obligation set under hundreds of counterfactual fact vectors and diffing them. Prose cannot do
// it, and a model that returns a different list on each run cannot do it either — three identical
// prompts to a search-grounded model put a Texas notification duty in the operative table twice
// and dropped it entirely the third time.
//
// This can, because of three properties the rest of the engine already has:
//   I8  applicability is CODE, so a counterfactual is a function call rather than a new opinion
//   I2  every answer is as of a date, so the comparison is like-for-like
//       and determinism, so a diff between two runs means a difference in the LAW, not in the model
//
// The unit is a DECISION, not a fact. meta/fact-keys.yaml already lists every key and the memo
// already reports which unsupplied ones would resolve the most dormant duties. That framing says
// "you did not tell me enough". This one says "here is the price of the thing you are about to
// do", which is the same arithmetic pointed at the question someone is actually asking.
//
// THREE KINDS, because they are not the same kind of thing and collapsing them would be the
// entity/data exemption mistake in a new costume:
//   controllable  — a choice the business makes (open an office, start selling data, hire)
//   contingent    — an event that may befall it (a breach, a subpoena, a rights request)
//   threshold     — a number it is approaching (5,000 residents, 500 individuals, $25m)
import { analyze } from './applicability.mjs';
import { dateIsWeak } from './dates.mjs';
import { load } from './corpus.mjs';
import { evalPredicate, UNKNOWN } from './predicates.mjs';

const PRED = /^\s*([a-z_]+)\.([A-Za-z0-9_.]+)\s*(==|!=|>=|<=|>|<|in|not_in)\s*(.+?)\s*$/;

/** Every (namespace, key, operator, literal) an obligation predicates on. Total on junk. */
function predicateTerms(records) {
  const terms = [];
  const walk = node => {
    if (!node) return;
    if (typeof node === 'string') {
      const parsed = node.match(PRED);
      if (parsed) terms.push({ ns: parsed[1], key: parsed[2], op: parsed[3], literal: parsed[4] });
      return;
    }
    if (typeof node !== 'object') return;
    for (const junction of ['all', 'any', 'none'])
      if (Array.isArray(node[junction])) node[junction].forEach(walk);
  };
  for (const record of records ?? []) walk(record?.applies_if);
  return terms;
}

/** The first literal inside `in ['x','y']`, which is the cheapest assignment that satisfies it. */
function firstListMember(literal) {
  const inner = String(literal ?? '').match(/\[\s*(.*?)\s*\]/);
  if (!inner) return null;
  const first = inner[1].split(',')[0]?.trim();
  if (!first) return null;
  return first.replace(/^['"]|['"]$/g, '');
}

function numericLiteral(literal) {
  const n = Number(String(literal ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

// `applicable` is the list keyed by atom_id; `obligations` keys on `id` and carries the prose.
// Diffing the wrong one silently collapses every entry to a single undefined, which is how the
// first draft of this module reported a baseline of 1 against a real answer of 17.
const idsOf = result => new Set((result?.applicable ?? []).map(hit => hit.atom_id).filter(Boolean));

function describe(result, ids) {
  const seen = new Map();
  for (const hit of result?.applicable ?? [])
    if (hit.atom_id && ids.has(hit.atom_id) && !seen.has(hit.atom_id))
      seen.set(hit.atom_id, { atom_id: hit.atom_id, citation: hit.citation,
                              instrument_id: hit.instrument_id });
  return [...seen.values()];
}

/**
 * WHAT CHANGED FOR US, BETWEEN TWO DATES.
 *
 * `privacy_diff` already reports what came into force across the corpus between two dates. That
 * is a newsletter. This is the same comparison run through ONE ENTITY'S FACTS, which is the
 * question a privacy office actually has: not "what changed in New York" but "which of MY
 * obligations changed, and what does each require now".
 *
 * It needs exactly the two properties this engine has and a search-grounded assistant cannot
 * have: a corpus indexed by effective date, and determinism — a diff between two sampled answers
 * measures the sampler, not the law.
 *
 * A difference between two dates is NOT automatically a change in the law, and the result says
 * which it is. `commenced`/`ceased` are differences attributable to a dated legal event.
 * `indeterminate` are differences the corpus cannot attribute, because the record's effective_from
 * has a basis of api_snapshot or undetermined — the date the text was captured, not the date it
 * began. `unmeasurable` names obligations whose only held text is younger than the from-date, so
 * the window was never put to them; `meta/missing-vintages.yaml` records those. This compares
 * WHAT THIS CORPUS HELD at two dates, which
 * is not the same as what the law did, and the result says so.
 */
export function betweenDates(entity, data, context, from, to, corpus) {
  const kb = corpus ?? load();
  const base = { ...(context ?? {}) };
  const shape = { from: from ?? null, to: to ?? null, commenced: [], ceased: [], indeterminate: [],
                  deadline_changes: [], unmeasurable: [], unchanged: 0, error: null, caveat: null };
  if (!from || !to) return { ...shape, error: 'both from and to dates are required' };

  const before = analyze(entity ?? {}, data ?? {}, { ...base, as_of: from });
  const after = analyze(entity ?? {}, data ?? {}, { ...base, as_of: to });
  if (before?.error) return { ...shape, error: `from: ${before.error}` };
  if (after?.error) return { ...shape, error: `to: ${after.error}` };

  const index = result => {
    const map = new Map();
    for (const hit of result.applicable ?? []) if (hit.atom_id) map.set(hit.atom_id, hit);
    return map;
  };
  const wasThen = index(before), isNow = index(after);

  // A DIFFERENCE BETWEEN TWO DATES IS NOT AUTOMATICALLY A CHANGE IN THE LAW.
  //
  // An obligation appears in `to` and not in `from` for two quite different reasons: it commenced
  // in between, or its effective_from is a FETCH ARTIFACT that happens to fall in between. 529
  // records carry a basis of api_snapshot or undetermined, which engine/dates.mjs declares cannot
  // anchor an as-of comparison at all.
  //
  // This function used to merge both into `gained` and add a caveat saying dates alone could not
  // separate them. They can: the record's own effective_from_basis separates them. Left merged, it
  // reported N.Y. Gen. Bus. Law § 349 — on the books since 1970 — as a duty acquired between 2025
  // and 2026, because the corpus fetched § 349 on 2026-04-03. Two duties appearing out of thin air
  // is the kind of answer someone acts on.
  const classify = (ids, source) => {
    const commenced = [], indeterminate = [];
    for (const id of ids) {
      const hit = source.get(id);
      const record = kb.byId?.get(id) ?? null;
      const row = { ...describeOne(hit), effective_from: record?.effective_from ?? null,
                    effective_from_basis: record?.effective_from_basis ?? null };
      if (dateIsWeak(record)) {
        indeterminate.push({ ...row,
          why: `effective_from ${record?.effective_from ?? '(none)'} has basis ` +
               `"${record?.effective_from_basis ?? 'none'}", which records when this text was ` +
               `captured rather than when it began. The difference across this window may be an ` +
               `artefact of when the corpus acquired it, and this corpus cannot tell you which.` });
      } else {
        commenced.push(row);
      }
    }
    return { commenced, indeterminate };
  };

  const gainedIds = [...isNow.keys()].filter(id => !wasThen.has(id));
  const lostIds = [...wasThen.keys()].filter(id => !isNow.has(id));
  const g = classify(gainedIds, isNow);
  const l = classify(lostIds, wasThen);

  // A clock whose DURATION or TRIGGER moved is a change even where the obligation did not.
  const clockOf = result => {
    const map = new Map();
    for (const row of result.deadlines ?? [])
      map.set(row.atom_id, `${row.duration ?? '?'}|${row.trigger_event ?? '?'}`);
    return map;
  };
  const clockThen = clockOf(before), clockNow = clockOf(after);
  const deadline_changes = [];
  for (const [id, now] of clockNow) {
    const then = clockThen.get(id);
    if (then && then !== now)
      deadline_changes.push({ atom_id: id, citation: isNow.get(id)?.citation ?? null,
                              was: then, now });
  }

  // WHAT THIS WINDOW CANNOT BE ASKED ABOUT AT ALL — the denominator, declared rather than implied.
  // A provision whose only held text is younger than `from` cannot answer what it required at
  // `from`; it is not that nothing changed, it is that the question was never put. Silence here
  // reads identically to "no change", which is the failure this repository keeps finding.
  const unmeasurable = [];
  for (const record of (kb.obligations ?? [])) {
    const ef = record?.effective_from;
    if (!ef || !(ef > from)) continue;
    if (wasThen.has(record.id) || isNow.has(record.id)) continue;
    unmeasurable.push({ atom_id: record.id, citation: record.source?.citation ?? null,
                        held_text_effective_from: ef,
                        effective_from_basis: record.effective_from_basis ?? null });
  }

  return { ...shape, commenced: g.commenced, ceased: l.commenced,
    indeterminate: [...g.indeterminate.map(r => ({ ...r, direction: 'appeared' })),
                    ...l.indeterminate.map(r => ({ ...r, direction: 'disappeared' }))],
    deadline_changes, unmeasurable,
    unchanged: [...isNow.keys()].filter(id => wasThen.has(id)).length,
    caveat: 'This compares WHAT THIS CORPUS HELD at two dates, which is not the same as what the ' +
      'law did. commenced/ceased are differences this corpus can attribute to a dated legal event. ' +
      'indeterminate are differences it CANNOT: the record\'s effective_from records when the text ' +
      'was captured, not when it began. unmeasurable names obligations whose only held text is ' +
      'younger than the from-date, so the window was never put to them. See ' +
      'meta/missing-vintages.yaml.' };
}

function describeOne(hit) {
  return { atom_id: hit?.atom_id ?? null, citation: hit?.citation ?? null,
           instrument_id: hit?.instrument_id ?? null };
}

/**
 * Counterfactual sensitivity over the whole obligation set.
 *
 * Total: a null anywhere returns a shaped, empty result rather than throwing, because this is an
 * outermost entry point and a parameter default covers `undefined` only.
 */
export function exposure(entity, data, context, corpus) {
  const base = analyze(entity ?? {}, data ?? {}, context ?? {});
  const empty = { as_of: base?.as_of ?? null, baseline_count: 0, error: base?.error ?? null,
                  controllable: [], contingent: [], thresholds: [], reversals: [], combinations: [] };
  if (base?.error) return empty;

  const baseIds = idsOf(base);
  const terms = predicateTerms(corpus?.obligations);
  const ctx = context ?? {};
  const supplied = { entity: entity ?? {}, data: data ?? {}, event: ctx.event ?? {},
                     practice: ctx.practice ?? {}, purpose: ctx.purpose ?? {}, law: ctx.law ?? {} };

  // One re-run per candidate assignment. At ~1.3 ms an analyze() this is a few hundred
  // milliseconds for the whole corpus, which is why the sweep is exhaustive rather than sampled.
  const run = (ns, key, value) => {
    const next = { entity: { ...supplied.entity }, data: { ...supplied.data },
                   event: { ...supplied.event }, practice: { ...supplied.practice },
                   purpose: { ...supplied.purpose }, law: { ...supplied.law } };
    if (!next[ns]) return null;
    const current = next[ns][key];
    // SET-VALUED FACTS ARE ADDED TO, NOT REPLACED. event.type is a set by design — one laptop is
    // a breach of unsecured PHI AND a breach of the security of the system — and entity.nexus and
    // data.types are lists too. Overwriting them would model "we started operating in New York"
    // as "we stopped operating everywhere else", which silently deletes duties instead of adding
    // one and would make every such row understate its own impact.
    if (Array.isArray(current)) {
      if (current.includes(value)) return null;
      next[ns] = { ...next[ns], [key]: [...current, value] };
    } else if (current === undefined && (ns === 'event' && key === 'type')) {
      next[ns] = { ...next[ns], [key]: [value] };
    } else {
      if (current === value) return null;
      next[ns] = { ...next[ns], [key]: value };
    }
    return analyze(next.entity, next.data,
      { ...ctx, event: next.event, practice: next.practice, purpose: next.purpose, law: next.law });
  };

  const controllable = [], contingent = [], thresholds = [], reversals = [];
  const tried = new Set();

  for (const term of terms) {
    let value = null;
    if (term.op === '==' && term.literal === 'true') value = true;
    else if (term.op === 'in') value = firstListMember(term.literal);
    else if (term.op === '>=' || term.op === '>') {
      const bound = numericLiteral(term.literal);
      const now = supplied[term.ns]?.[term.key];
      if (bound !== null) {
        const gate = `${term.ns}.${term.key}`;
        if (!thresholds.some(row => row.fact === gate && row.bound === bound))
          thresholds.push({ fact: gate, operator: term.op, bound,
            current: typeof now === 'number' ? now : null,
            distance: typeof now === 'number' ? Math.max(0, bound - now + (term.op === '>' ? 1 : 0)) : null });
      }
      continue;
    } else continue;
    if (value === null) continue;

    const signature = `${term.ns}.${term.key}=${String(value)}`;
    if (tried.has(signature)) continue;
    tried.add(signature);

    const after = run(term.ns, term.key, value);
    if (!after || after.error) continue;
    const afterIds = idsOf(after);
    const added = new Set([...afterIds].filter(id => !baseIds.has(id)));
    const dropped = new Set([...baseIds].filter(id => !afterIds.has(id)));
    if (!added.size && !dropped.size) continue;

    const row = { fact: `${term.ns}.${term.key}`, value,
                  adds: describe(after, added), removes: describe(base, dropped),
                  net: added.size - dropped.size };
    if (term.ns === 'event') contingent.push(row);
    else controllable.push(row);
  }

  // The other direction: a duty you owe ONLY because of something you are currently doing.
  // Stopping it is a decision too, and it is the one a business is most likely to want priced.
  for (const [ns, bag] of Object.entries(supplied)) {
    if (ns === 'event' || ns === 'law') continue;
    for (const [key, value] of Object.entries(bag ?? {})) {
      if (value !== true) continue;
      const after = run(ns, key, false);
      if (!after || after.error) continue;
      const dropped = new Set([...baseIds].filter(id => !idsOf(after).has(id)));
      if (dropped.size) reversals.push({ fact: `${ns}.${key}`, stops: describe(base, dropped) });
    }
  }

  // OBLIGATIONS THAT NEED MORE THAN ONE CHANGE, and the exact combination.
  //
  // A single-fact sweep cannot see a duty gated by two facts, and silently omitting it would be
  // the same false-gap failure this repository keeps finding: the row's absence would read as
  // "nothing turns on this" when the truth is "nothing turns on this ALONE". N.Y. Civil Rights
  // Law § 52-c is the case — it needs entity.is_ny_employer AND
  // practice.monitors_employee_communications, so neither flip alone moves it and it vanished
  // from the first version of this output entirely.
  //
  // Brute-forcing pairs would cost 126^2 re-runs to find what the predicate states outright. A
  // conjunctive applies_if already NAMES its requirements, so the missing ones are read off it
  // rather than searched for. Non-conjunctive shapes (any/none) are skipped rather than guessed:
  // a disjunction has no single "missing combination" and inventing one would overstate.
  const factsNow = { entity: supplied.entity, data: supplied.data, event: supplied.event,
                     purpose: supplied.purpose, practice: supplied.practice, law: supplied.law };
  const combinations = [];
  for (const record of corpus?.obligations ?? []) {
    if (!record?.id || baseIds.has(record.id)) continue;
    if (record.status !== 'in_force') continue;
    const conjuncts = record.applies_if?.all;
    if (!Array.isArray(conjuncts) || !conjuncts.length) continue;
    if (!conjuncts.every(part => typeof part === 'string')) continue;
    // evalPredicate returns { value, why }, NOT a bare boolean. Comparing the object to `true`
    // is always false, which silently marked EVERY conjunct unmet — including ones the facts
    // plainly satisfied, so the first version of this list told a HIPAA covered entity it needed
    // to become a HIPAA covered entity. Read .value.
    const unmet = conjuncts.filter(part => evalPredicate(part, factsNow)?.value !== true);
    if (unmet.length < 2) continue;
    combinations.push({ atom_id: record.id, citation: record.source?.citation,
      instrument_id: record.source?.instrument_id, needs: unmet });
  }
  combinations.sort((lhs, rhs) => lhs.needs.length - rhs.needs.length);

  const byImpact = (lhs, rhs) => rhs.adds.length - lhs.adds.length;
  controllable.sort(byImpact);
  contingent.sort(byImpact);
  reversals.sort((lhs, rhs) => rhs.stops.length - lhs.stops.length);
  thresholds.sort((lhs, rhs) => (lhs.distance ?? Infinity) - (rhs.distance ?? Infinity));

  return { as_of: base.as_of, baseline_count: baseIds.size, error: null,
           controllable, contingent, thresholds, reversals, combinations };
}
