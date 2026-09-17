// CHECK THE ASSUMPTION INSIDE THE QUESTION, not just the answer to it.
//
// A false premise is the failure mode an answering system is worst at, because the premise is
// never the thing being answered. Asked "since HIPAA preempts state breach law, we only notify
// HHS — what's the deadline?", a system that answers the deadline has agreed to the preemption
// claim by not objecting. Magesh et al. (Stanford RegLab, 2024) made false-premise questions a
// dedicated category of their legal-AI benchmark for exactly this reason, and "sycophancy" — going
// along with a premise the user supplied — is a named cause in the RAG failure typology.
//
// The premises checkable here are the ones the corpus models as FIRST-CLASS OBJECTS rather than as
// prose, which is why this can be deterministic:
//
//   preempts        preemption posture is a field. 132 records carry posture "floor", which says
//                   in terms that more stringent state law survives. "X preempts Y" is then
//                   contradicted by the corpus, not by an opinion about it.
//   in_force        status and the effective window are fields. "Since the SAFE for Kids Act is
//                   law..." is checkable against 2027-01-25.
//   no_law_applies  invariant I6: backstops never turn off. "No privacy law reaches us" is
//                   contradicted whenever a backstop fires on the facts given.
//   exempt          exemptions are typed objects with their own predicates, so whether one
//                   actually reaches a set of facts is evaluated rather than assumed.
//
// WHAT IT WILL NOT DO. It never reports a premise TRUE. `consistent` means the corpus does not
// contradict it, which is a different and much weaker statement — the same distinction
// engine/grounding.mjs draws between NO_PROBLEM_FOUND and "verified". And it never guesses at a
// premise it cannot type: prose is matched against a small set of premise SHAPES by pattern, never
// interpreted, because interpreting the sentence would put a language model inside the check and
// make it exactly as fallible as the thing being checked.
import { load, surfaceable, inForceOn } from './corpus.mjs';
import { resolve as resolvePreemption } from './preemption.mjs';
import { backstops } from './backstops.mjs';
import { evaluate, UNKNOWN } from './predicates.mjs';
import { isRealDate, badDateReason } from './dates.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import * as yaml from 'js-yaml';

const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const lower = text => norm(text).toLowerCase();

/** Instrument titles, so prose naming "HIPAA" can be resolved to an instrument id. */
let NAMES = null;
function instrumentNames() {
  if (NAMES) return NAMES;
  NAMES = new Map();
  const file = resolvePath(import.meta.dirname, '../meta/instrument-coverage.yaml');
  if (existsSync(file)) {
    const declared = yaml.load(readFileSync(file, 'utf8'))?.instruments ?? {};
    for (const [id, entry] of Object.entries(declared)) {
      NAMES.set(lower(id), id);
      if (entry?.title) NAMES.set(lower(entry.title), id);
    }
  }
  // Short names a person actually types. Kept small and explicit: a fuzzy matcher here would
  // resolve "the Act" to whichever instrument sorted first, which is worse than not resolving.
  for (const [alias, id] of Object.entries({
    hipaa: 'us.cfr.45.164', 'hipaa privacy rule': 'us.cfr.45.164',
    'hipaa breach notification rule': 'us.hipaa.breach_notification_rule',
    glba: 'us.cfr.16.313', 'gramm-leach-bliley': 'us.cfr.16.313',
    fcra: 'us.fcra.preemption', coppa: 'us.coppa.rule',
    shield: 'ny.gbl.899_bb', 'shield act': 'ny.gbl.899_bb',
    '899-aa': 'ny.gbl.899_aa', 'ny breach': 'ny.gbl.899_aa',
    'safe for kids': 'ny.safe_for_kids', 'safe for kids act': 'ny.safe_for_kids',
    'the safe for kids act': 'ny.safe_for_kids',
    'local law 144': 'nyc.local_law_144', ll144: 'nyc.local_law_144',
    'nyc local law 144': 'nyc.local_law_144',
    'education law 2-d': 'ny.education.2-d', 'gbl 349': 'ny.gbl.349',
  })) if (!NAMES.has(alias)) NAMES.set(alias, id);
  return NAMES;
}

const resolveInstrument = name => instrumentNames().get(lower(name)) ?? null;

/**
 * Every alias that does not resolve to an instrument the corpus actually holds.
 *
 * A hand-written alias table is exactly the kind of thing that rots: "safe for kids" pointed at
 * ny.gbl.1500 where the corpus holds ny.safe_for_kids, so the single most valuable premise this
 * engine checks — pending law asserted as binding — came back CANNOT_CHECK. The test suite asserts
 * this returns empty, so a stale alias fails the build rather than degrading an answer.
 */
export function unresolvableAliases(corpus) {
  const kb = corpus ?? load();
  const held = new Set((kb.all ?? []).map(record => record.source?.instrument_id).filter(Boolean));
  return [...instrumentNames().entries()]
    .filter(([, id]) => !held.has(id))
    .map(([alias, id]) => ({ alias, instrument_id: id }));
}

/** Every surfaceable record belonging to an instrument. */
const recordsOf = (kb, instrumentId) => (kb.all ?? [])
  .filter(record => surfaceable(record) && record.source?.instrument_id === instrumentId);

// ---------------------------------------------------------------- the checkers

/**
 * "X preempts Y."
 *
 * A posture of `floor` says the opposite in terms — the federal instrument sets a minimum and more
 * stringent state law survives it. `none` says the statute does not speak to preemption at all,
 * which supports nothing. Only `ceiling` and `field` support the premise, and `express_partial`
 * supports it for the part expressly named and no further.
 */
function checkPreempts(premise, kb) {
  const federalId = premise.federal_instrument ?? resolveInstrument(premise.federal);
  const stateId = premise.state_instrument ?? resolveInstrument(premise.state);
  const out = { kind: 'preempts', federal: federalId, state: stateId, findings: [] };
  const add = (code, message, detail) => out.findings.push({ code, message, ...(detail ? { detail } : {}) });

  if (!federalId) {
    add('INSTRUMENT_NOT_RESOLVED',
      `"${premise.federal ?? '(unnamed)'}" does not resolve to an instrument this corpus declares, `
      + `so the preemption premise cannot be checked here.`);
    out.status = 'CANNOT_CHECK';
    return out;
  }

  const federalRecords = recordsOf(kb, federalId).filter(record => record.preemption?.posture);
  if (!federalRecords.length) {
    add('NO_PREEMPTION_POSTURE_HELD',
      `This corpus holds no preemption posture for ${federalId}. Absence here is a limit of the `
      + `corpus and NOT evidence that the instrument preempts nothing.`);
    out.status = 'CANNOT_CHECK';
    return out;
  }

  // PREEMPTION RUNS ONE WAY. A state instrument named in the federal slot was answered on its own
  // posture — "N.Y. Gen. Bus. Law § 899-aa preempts HIPAA" came back CONSISTENT on a "ceiling"
  // recorded about NEW YORK law, which inverts the Supremacy Clause and is a confidently wrong
  // answer to a question somebody asked backwards.
  const levels = [...new Set(federalRecords.map(record => record.jurisdiction_level))];
  if (levels.length && !levels.includes('federal')) {
    add('PREMISE_INVERTED',
      `${federalId} is ${levels.join('/')} law, not federal, so it cannot preempt federal law — `
      + `preemption runs from the federal instrument downward. If the premise was meant the other `
      + `way round, name the federal instrument first. The posture recorded on ${federalId} `
      + `describes what IT does to law below it and says nothing about the premise as written.`,
      { jurisdiction_level: levels, postures_recorded_on_it:
          [...new Set(federalRecords.map(record => record.preemption.posture))] });
    out.status = 'CONTRADICTED';
    return out;
  }

  const stateRecord = stateId ? recordsOf(kb, stateId)[0] ?? null : null;
  const postures = [...new Set(federalRecords.map(record => record.preemption.posture))];
  out.postures = postures;
  out.resolution = resolvePreemption(federalRecords[0], stateRecord, premise.as_of ?? null);

  const floor = postures.filter(posture => posture === 'floor' || posture === 'none');
  const supports = postures.filter(posture => posture === 'ceiling' || posture === 'field');
  const partial = postures.filter(posture => posture === 'express_partial');

  if (floor.length && !supports.length) {
    const witness = federalRecords.find(record => record.preemption.posture === floor[0]);
    add('PREMISE_CONTRADICTED',
      `${federalId} is recorded with preemption posture "${floor[0]}"`
      + (floor[0] === 'floor'
          ? ' — it sets a MINIMUM, and more stringent state law survives it. A plan that relies on '
            + 'the federal duty displacing the state one is relying on the opposite of what the '
            + 'statute does.'
          : ' — the statute does not speak to preemption, so nothing here supports displacement.'),
      { authority: witness?.preemption?.authority ?? null,
        note: witness?.preemption?.note ?? null,
        citation: witness?.source?.citation ?? null });
    out.status = 'CONTRADICTED';
    return out;
  }

  if (partial.length) {
    add('PREMISE_PARTIAL',
      `${federalId} is recorded as "express_partial": it preempts expressly and only so far as the `
      + `express terms reach. The premise holds for what is named and for nothing else, so it `
      + `cannot carry a general conclusion.`);
    out.status = 'PARTIAL';
    return out;
  }

  add('PREMISE_CONSISTENT',
    `${federalId} is recorded with posture ${postures.map(p => `"${p}"`).join(', ')}, which does `
    + `not contradict the premise. That is not the same as confirming it: the scope of a ceiling `
    + `or a field is a reading of the statute, and this engine does not make readings.`);
  out.status = 'CONSISTENT';
  return out;
}

/** "Since X is law…" — status and the effective window are fields, so this is arithmetic. */
function checkInForce(premise, kb) {
  const asOf = premise.as_of ?? null;
  const out = { kind: 'in_force', citation: premise.citation ?? null, as_of: asOf, findings: [] };
  const add = (code, message, detail) => out.findings.push({ code, message, ...(detail ? { detail } : {}) });

  if (asOf && !isRealDate(asOf)) {
    add('AS_OF_NOT_A_DATE', badDateReason('as_of', asOf));
    out.status = 'CANNOT_CHECK';
    return out;
  }

  const wanted = norm(premise.citation);
  const instrumentId = premise.instrument ? resolveInstrument(premise.instrument) : null;
  const candidates = wanted
    ? (kb.all ?? []).filter(record => surfaceable(record) && norm(record.source?.citation) === wanted)
    : (instrumentId ? recordsOf(kb, instrumentId) : []);

  if (!candidates.length) {
    add('NOT_HELD',
      `This corpus does not hold ${wanted || premise.instrument || '(nothing named)'}, so whether `
      + `it was law on ${asOf ?? 'the date in question'} cannot be checked here.`);
    out.status = 'CANNOT_CHECK';
    return out;
  }

  const pending = candidates.filter(record => record.status === 'enacted_pending');
  const superseded = candidates.filter(record => record.status === 'superseded');
  out.statuses = [...new Set(candidates.map(record => record.status))];

  if (pending.length === candidates.length) {
    const first = pending[0];
    add('PREMISE_CONTRADICTED',
      `Every record held for this is enacted_pending`
      + (first.effective_from ? `, effective ${first.effective_from}` : '')
      + `. It is law in the sense that it has been passed, and it binds nobody yet. Treating it as `
      + `a present duty is the commonest confident error in this area.`,
      { effective_from: first.effective_from ?? null, citation: first.source?.citation ?? null });
    out.status = 'CONTRADICTED';
    return out;
  }

  if (asOf) {
    const live = candidates.filter(record => inForceOn(record, asOf));
    if (!live.length) {
      add('PREMISE_CONTRADICTED',
        `Nothing held for this was in force on ${asOf}.`,
        { effective_from: candidates[0].effective_from ?? null,
          effective_to: candidates[0].effective_to ?? null });
      out.status = 'CONTRADICTED';
      return out;
    }
    out.in_force_count = live.length;
  }

  if (superseded.length)
    add('PARTLY_SUPERSEDED',
      `${superseded.length} of ${candidates.length} record(s) held for this are marked superseded.`);

  add('PREMISE_CONSISTENT',
    `${candidates.length} record(s) held, and the corpus does not contradict the premise`
    + (asOf ? ` as of ${asOf}` : ' — though no date was given, and a premise about law is always '
      + 'a premise about a date') + '.');
  out.status = 'CONSISTENT';
  return out;
}

/** "No privacy law applies to us." Invariant I6: the backstops never turn off. */
function checkNoLawApplies(premise, kb) {
  const out = { kind: 'no_law_applies', as_of: premise.as_of ?? null, findings: [] };
  const add = (code, message, detail) => out.findings.push({ code, message, ...(detail ? { detail } : {}) });
  const facts = premise.facts ?? {};

  if (premise.as_of && !isRealDate(premise.as_of)) {
    add('AS_OF_NOT_A_DATE', badDateReason('as_of', premise.as_of));
    out.status = 'CANNOT_CHECK';
    return out;
  }

  const reached = backstops(facts.entity ?? facts, { as_of: premise.as_of ?? null, ...facts });
  const live = (Array.isArray(reached) ? reached : reached?.applicable ?? [])
    .filter(Boolean);
  out.backstops = live.map(entry => entry.citation ?? entry.atom_id ?? entry.id ?? null).filter(Boolean);

  if (out.backstops.length) {
    add('PREMISE_CONTRADICTED',
      `A deceptive-practices backstop reaches these facts. "No law applies" is almost always wrong: `
      + `where no sectoral statute governs a practice, the general prohibitions still do.`,
      { backstops: out.backstops.slice(0, 6) });
    out.status = 'CONTRADICTED';
    return out;
  }

  add('NO_BACKSTOP_FIRED',
    `No backstop fired on the facts as given — but the facts supplied may simply be too thin to `
    + `engage one. This is not a finding that nothing applies.`);
  out.status = 'UNSUPPORTED';
  return out;
}

/** "We are exempt." Exemptions are typed objects with predicates, so this is evaluated. */
function checkExempt(premise, kb) {
  const instrumentId = premise.instrument_id ?? resolveInstrument(premise.instrument);
  const out = { kind: 'exempt', instrument: instrumentId, findings: [] };
  const add = (code, message, detail) => out.findings.push({ code, message, ...(detail ? { detail } : {}) });

  if (!instrumentId) {
    add('INSTRUMENT_NOT_RESOLVED',
      `"${premise.instrument ?? '(unnamed)'}" does not resolve to an instrument this corpus `
      + `declares, so the exemption premise cannot be checked here.`);
    out.status = 'CANNOT_CHECK';
    return out;
  }

  const facts = premise.facts ?? {};
  const held = recordsOf(kb, instrumentId).filter(record => (record.exemptions ?? []).length);
  const all = held.flatMap(record => (record.exemptions ?? []).map(entry => ({ entry, record })));
  if (!all.length) {
    add('NO_EXEMPTIONS_HELD',
      `This corpus holds no exemptions for ${instrumentId}. Absence is a limit of the corpus, not `
      + `evidence that none exists.`);
    out.status = 'CANNOT_CHECK';
    return out;
  }

  const matched = [], unknown = [];
  for (const { entry, record } of all) {
    if (!entry.applies_if) continue;
    const verdict = evaluate(entry.applies_if, facts);
    if (verdict?.value === true) matched.push({ id: entry.id, type: entry.type, reach: entry.reach ?? null,
      citation: record.source?.citation ?? null });
    else if (verdict?.value === UNKNOWN) unknown.push({ id: entry.id, why: verdict.why ?? null });
  }
  out.matched = matched;
  out.unresolved = unknown.slice(0, 6);

  if (!matched.length) {
    add('PREMISE_UNSUPPORTED',
      `No exemption held for ${instrumentId} reaches these facts`
      + (unknown.length ? `; ${unknown.length} could not be decided because a fact their predicate `
        + `needs was not supplied` : '') + '.',
      unknown.length ? { unresolved: out.unresolved } : undefined);
    out.status = unknown.length ? 'CANNOT_CHECK' : 'UNSUPPORTED';
    return out;
  }

  // THE TYPE IS THE POINT. An entity_level exemption removes the instrument; a data_level or
  // activity_level one removes a slice and leaves the entity inside for everything else. Reporting
  // "you are exempt" without the type is how a carve-out becomes a general release.
  const entityLevel = matched.filter(entry => entry.type === 'entity_level');
  if (entityLevel.length) {
    add('PREMISE_CONSISTENT',
      `An ENTITY-LEVEL exemption reaches these facts, which removes ${instrumentId} entirely.`,
      { matched: entityLevel });
    out.status = 'CONSISTENT';
    return out;
  }

  add('PREMISE_TOO_BROAD',
    `An exemption reaches these facts, but every one that does is ${[...new Set(matched.map(e => e.type))]
      .join(', ')} — it removes a slice and leaves the entity INSIDE ${instrumentId} for everything `
    + `else. A carve-out read as a general release is the error this distinction exists to prevent.`,
    { matched });
  out.status = 'PARTIAL';
  return out;
}

const CHECKERS = { preempts: checkPreempts, in_force: checkInForce,
                   no_law_applies: checkNoLawApplies, exempt: checkExempt };

export const PREMISE_KINDS = Object.keys(CHECKERS);

// ---------------------------------------------------------------- prose shapes
//
// PATTERNS, NOT COMPREHENSION. Each shape is a sentence form whose premise this engine can type.
// Anything that does not match is reported as unmatched rather than guessed at, because a guessed
// premise checked confidently is worse than no check.
const SHAPES = [
  { kind: 'preempts',
    re: /\b([A-Z][\w.'-]*(?:\s+[A-Z&][\w.'-]*){0,5}|HIPAA|GLBA|FCRA|COPPA)\s+(?:pre-?empts?|supersedes?|overrides?|displaces?)\s+([A-Za-z][\w.'-]*(?:\s+[\w.'-]+){0,5})/g,
    build: hit => ({ kind: 'preempts', federal: hit[1], state: hit[2] }) },
  { kind: 'no_law_applies',
    re: /\bno\s+(?:privacy\s+)?(?:law|laws|statute|statutes|regulation|regulations)\s+(?:applies|apply|reaches|reach)\b/gi,
    build: () => ({ kind: 'no_law_applies' }) },
  { kind: 'in_force',
    re: /\bsince\s+(?:the\s+)?([\w.'§-]+(?:\s+[\w.'§-]+){0,6}?)\s+(?:is|are)\s+(?:now\s+)?(?:law|in\s+(?:force|effect))/gi,
    build: hit => ({ kind: 'in_force', instrument: hit[1] }) },
  { kind: 'exempt',
    re: /\bwe(?:'re|\s+are)\s+exempt\s+from\s+([\w.'-]+(?:\s+[\w.'-]+){0,4})/gi,
    build: hit => ({ kind: 'exempt', instrument: hit[1] }) },
];

/** Extract typed premises from prose. Returns what matched AND says nothing about the rest. */
export function premisesIn(text) {
  const prose = String(text ?? '');
  const found = [];
  for (const shape of SHAPES) {
    shape.re.lastIndex = 0;
    for (const hit of prose.matchAll(shape.re))
      found.push({ ...shape.build(hit), matched_text: norm(hit[0]), index: hit.index ?? 0 });
  }
  return found.sort((left, right) => left.index - right.index);
}

// ---------------------------------------------------------------- entry points

/** Check one typed premise. Total on null. */
export function checkPremise(premise, corpus, options) {
  const kb = corpus ?? load();
  const kind = norm(premise?.kind);
  if (!kind || !CHECKERS[kind])
    return { kind: kind || null, status: 'CANNOT_CHECK',
      findings: [{ code: 'PREMISE_KIND_UNKNOWN',
        message: `"${kind || '(none)'}" is not a premise this engine can type. It checks: `
          + `${PREMISE_KINDS.join(', ')}. A premise it cannot type is reported rather than guessed at.` }] };
  const merged = { ...premise, as_of: premise.as_of ?? options?.as_of ?? null,
                   facts: premise.facts ?? options?.facts ?? null };
  return { ...CHECKERS[kind](merged, kb), matched_text: premise.matched_text ?? null };
}

/** Check a set of premises, or the premises found in a block of prose. */
export function premises(input, corpus, options) {
  const kb = corpus ?? load();
  const fromProse = typeof input === 'string';
  const list = fromProse ? premisesIn(input)
    : (Array.isArray(input) ? input : [input]).filter(Boolean);

  if (!list.length)
    return { checked: 0, results: [], summary: null, extracted: fromProse ? [] : null,
      error: fromProse
        ? 'no premise of a shape this engine can type was found in that text. It types: '
          + PREMISE_KINDS.join(', ') + '. Silence here means no SHAPE matched, never that the text '
          + 'contains no false premise.'
        : 'no premise given' };

  const results = list.map(entry => checkPremise(entry, kb, options));
  const count = status => results.filter(row => row.status === status).length;

  return {
    checked: results.length,
    extracted: fromProse ? list.map(entry => entry.matched_text) : null,
    results,
    summary: {
      premises: results.length,
      contradicted: count('CONTRADICTED'),
      partial: count('PARTIAL'),
      unsupported: count('UNSUPPORTED'),
      consistent: count('CONSISTENT'),
      not_checkable: count('CANNOT_CHECK'),
    },
    caveat:
      'CONSISTENT IS NOT "TRUE". It means this corpus does not contradict the premise, which is a '
      + 'much weaker statement — the scope of a ceiling, or what an exemption reaches in a case the '
      + 'facts do not fully describe, is a reading, and this engine does not make readings. '
      + 'CANNOT_CHECK is a statement about this corpus. And a premise of a shape this engine cannot '
      + 'type is never reported at all, so an empty result is not an all-clear.',
  };
}
