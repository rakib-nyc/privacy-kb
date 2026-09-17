// THE FEWEST QUESTIONS THAT WOULD SETTLE THE ANSWER.
//
// The corpus predicates on 193 fact keys. Handed that list, nobody knows which of them matter to
// them, so the practical failure is not a wrong answer — it is not knowing what to assert in the
// first place. `facts` lists the vocabulary and `exposure` sweeps what a changed fact would do;
// neither answers "what should I tell you next".
//
// This does. Given whatever facts are already known, it finds every predicate that currently
// evaluates to UNKNOWN, counts which unsupplied key blocks the most of them, and returns the
// questions in that order. Answer the first and the largest block of unresolved obligations
// resolves; answer nothing and the report still says how many obligations are sitting in UNKNOWN,
// which is the number a user most needs and never sees.
//
// GREEDY, AND HONEST ABOUT IT. Ordering by how many predicates a key blocks is a heuristic, not an
// optimal decision tree: keys interact, and answering one can make another irrelevant. Computing
// the true minimum set would require evaluating every ordering of every key, which is exponential
// and would still rest on a guess about which answer the user will give. So the order is
// recomputed after each answer rather than fixed in advance, and the report says it is a ranking
// rather than a minimum.
//
// IT NEVER GUESSES AN ANSWER. An unsupplied fact stays UNKNOWN. The whole point of asking is that
// assuming would resolve obligations in whichever direction the assumption happened to run.
import { load, surfaceable, inForceOn } from './corpus.mjs';
import { evaluate, UNKNOWN } from './predicates.mjs';
import { factInventory } from './facts.mjs';
import { isRealDate, badDateReason } from './dates.mjs';

const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();

// The fact inventory carries a key, its accepted values and which instruments it gates — but no
// prose. Asking "What is entity.is_hipaa_covered_entity?" puts the burden back on the reader, so
// the question is derived from the key's own shape. Acronyms are restored from a small explicit
// table: title-casing them produces "Hipaa" and "Phi", which reads as though nobody looked.
const ACRONYMS = {
  hipaa: 'HIPAA', phi: 'PHI', pii: 'PII', glba: 'GLBA', fcra: 'FCRA', ferpa: 'FERPA',
  coppa: 'COPPA', ecpa: 'ECPA', vppa: 'VPPA', cdpa: 'CDPA', aedt: 'AEDT', ssn: 'SSN',
  ny: 'New York', nyc: 'New York City', hhs: 'HHS', ftc: 'FTC', ehi: 'EHI', cra: 'CRA',
  us: 'US', ai: 'AI', pi: 'PI',
};
const humanWords = name => String(name).split('_')
  .map(word => ACRONYMS[word] ?? word).join(' ');

/**
 * "Is the data financial record?" is the shape a naive join produces. The article is added unless
 * the phrase is a single acronym, where it reads as a mass noun — "Is the data PHI?", not "a PHI".
 */
function article(phrase) {
  const words = String(phrase).trim().split(/\s+/);
  if (words.length === 1 && /^[A-Z]{2,}$/.test(words[0])) return phrase;
  if (/^(a|an|the)\b/i.test(phrase)) return phrase;
  return `${/^[aeiou]/i.test(phrase) ? 'an' : 'a'} ${phrase}`;
}

function askFor(key, accepted) {
  const [namespace, ...rest] = String(key).split('.');
  const name = rest.join('.');
  const subject = namespace === 'entity' ? 'the organisation'
    : namespace === 'data' ? 'the data'
    : namespace === 'event' ? 'the event'
    : namespace === 'practice' ? 'the practice'
    : namespace === 'purpose' ? 'the purpose'
    : 'the matter';
  const values = (accepted ?? []).map(String);
  const boolish = values.length > 0 && values.every(value => value === 'true' || value === 'false');

  if (/^is_|^are_/.test(name))
    return `Is ${subject} ${article(humanWords(name.replace(/^(is|are)_/, '')))}?`;
  if (/^has_|^have_/.test(name))
    return `Does ${subject} have ${humanWords(name.replace(/^(has|have)_/, ''))}?`;
  if (/^uses_|^collects_|^owns_|^provides_|^operates_|^processes_|^discloses_|^sells_/.test(name))
    return `Does ${subject} ${humanWords(name)}?`;
  // A boolean key with no verb prefix is almost always a noun phrase — glba_financial_institution,
  // government_authority — so it reads as "Is the organisation a GLBA financial institution?"
  if (boolish) return `Is ${subject} ${article(humanWords(name))}?`;
  return `What is ${subject}'s ${humanWords(name)}?`;
}

/** Every `namespace.key` mentioned in a predicate expression, however nested. */
function keysIn(expr, found = new Set()) {
  if (!expr) return found;
  if (typeof expr === 'string') {
    for (const hit of expr.matchAll(/\b([a-z_]+)\.([a-z_][a-z0-9_]*)/gi)) found.add(`${hit[1]}.${hit[2]}`);
    return found;
  }
  if (Array.isArray(expr)) { expr.forEach(entry => keysIn(entry, found)); return found; }
  if (typeof expr === 'object') { Object.values(expr).forEach(entry => keysIn(entry, found)); return found; }
  return found;
}

const readFact = (facts, key) => {
  const [namespace, name] = String(key).split('.');
  const bag = facts?.[namespace];
  return (bag && typeof bag === 'object') ? bag[name] : undefined;
};

const supplied = (facts, key) => readFact(facts, key) !== undefined;

/**
 * Rank the questions worth asking next.
 *
 * Total on null at the outermost surface.
 */
export function interview(facts, context, corpus, options) {
  const kb = corpus ?? load();
  facts = facts ?? {};
  context = context ?? {};
  const asOf = context.as_of ?? null;
  // Clamped. A negative limit made Array.slice count from the end, returning 119 questions and
  // reporting 129 "more" — a nonsense pair from a number nobody validated.
  const asked = Number.isInteger(options?.limit) ? options.limit : 8;
  const limit = Math.max(0, asked);

  const empty = { as_of: asOf, questions: [], summary: null, error: null };
  if (!asOf) return { ...empty, error: 'an as-of date is required — there is no "current law"' };
  if (!isRealDate(asOf)) return { ...empty, error: badDateReason('as_of', asOf) };

  const shaped = {
    entity: facts.entity ?? {}, data: facts.data ?? {}, event: facts.event ?? {},
    practice: facts.practice ?? {}, purpose: facts.purpose ?? {}, law: facts.law ?? {},
  };

  // Only obligations that could be live on this date. Ranking a question by a repealed duty would
  // send someone off to establish a fact about law that does not apply to any date they asked for.
  const live = (kb.obligations ?? [])
    .filter(record => surfaceable(record) && record.applies_if && inForceOn(record, asOf));

  let resolvedTrue = 0, resolvedFalse = 0;
  const blocking = new Map();          // fact key -> obligations it is blocking
  const unresolved = [];

  for (const record of live) {
    const verdict = evaluate(record.applies_if, shaped);
    if (verdict?.value === true) { resolvedTrue += 1; continue; }
    if (verdict?.value === false) { resolvedFalse += 1; continue; }

    unresolved.push(record.id);
    // Every key this predicate mentions that has NOT been supplied is a candidate question. A key
    // already answered cannot be what is blocking it.
    for (const key of keysIn(record.applies_if)) {
      if (supplied(shaped, key)) continue;
      if (!blocking.has(key)) blocking.set(key, []);
      blocking.get(key).push({ id: record.id, citation: record.source?.citation ?? null,
        instrument_id: record.source?.instrument_id ?? null });
    }
  }

  // The fact vocabulary supplies the human label and the values a key takes, so a question can be
  // asked in words rather than as a key name.
  const vocabulary = new Map();
  try {
    const inventory = factInventory(kb);
    const entries = Array.isArray(inventory) ? inventory : Object.values(inventory ?? {});
    for (const entry of entries) if (entry?.key) vocabulary.set(entry.key, entry);
  } catch { /* the ranking stands without labels */ }

  const questions = [...blocking.entries()]
    .map(([key, blocked]) => {
      const known = vocabulary.get(key) ?? null;
      const instruments = [...new Set(blocked.map(entry => entry.instrument_id).filter(Boolean))];
      return {
        fact_key: key,
        namespace: key.split('.')[0],
        question: askFor(key, known?.accepted_values),
        values: known?.accepted_values ?? null,
        aliases: known?.aliases ?? [],
        blocks: blocked.length,
        instruments,
        // Naming the obligations a question unblocks is what makes it worth answering: an
        // unexplained list of fact keys is the thing this exists to replace.
        would_resolve: blocked.slice(0, 5).map(entry => entry.citation ?? entry.id),
      };
    })
    .sort((left, right) => right.blocks - left.blocks
      || left.fact_key.localeCompare(right.fact_key));

  return {
    as_of: asOf,
    questions: questions.slice(0, limit),
    more_questions: Math.max(0, questions.length - limit),
    summary: {
      obligations_considered: live.length,
      resolved_applies: resolvedTrue,
      resolved_does_not_apply: resolvedFalse,
      // THE NUMBER NOBODY SEES OTHERWISE. An analysis reports what applies; it does not report how
      // much is sitting in UNKNOWN because a fact was never supplied, and those are not the same
      // as "does not apply".
      unresolved: unresolved.length,
      distinct_questions: questions.length,
      facts_supplied: ['entity', 'data', 'event', 'practice', 'purpose', 'law']
        .reduce((total, namespace) => total + Object.keys(shaped[namespace] ?? {}).length, 0),
    },
    error: null,
    caveat:
      'A RANKING, NOT A MINIMUM SET. Questions are ordered by how many unresolved predicates each '
      + 'unsupplied fact is currently blocking, which is greedy: keys interact, and answering one '
      + 'can make another irrelevant. Re-run after each answer rather than working down the list as '
      + 'though it were fixed. Nothing here is assumed — an unsupplied fact stays UNKNOWN, because '
      + 'assuming would resolve obligations in whichever direction the assumption happened to run.',
  };
}

/** Render the ranking. */
export function interviewMarkdown(built, title) {
  built = built ?? {};
  const lines = [];
  lines.push(`# What to establish next — ${title ?? 'these facts'}`);
  lines.push('');
  if (built.error) { lines.push(`**Refused:** ${built.error}`); return lines.join('\n'); }

  const sum = built.summary ?? {};
  lines.push(`As of **${built.as_of}** · ${sum.facts_supplied} fact(s) supplied · `
    + `**${sum.unresolved} obligation(s) unresolved** of ${sum.obligations_considered} considered `
    + `(${sum.resolved_applies} apply, ${sum.resolved_does_not_apply} do not)`);
  lines.push('');

  if (!(built.questions ?? []).length) {
    lines.push('Every obligation in force on this date resolved on the facts given. Nothing is');
    lines.push('sitting in UNKNOWN for want of a fact.');
    return lines.join('\n');
  }

  lines.push('| Blocks | Ask | Answer with | Fact key |');
  lines.push('|---:|---|---|---|');
  for (const entry of (built.questions ?? []))
    lines.push(`| ${entry.blocks} | ${entry.question} `
      + `| ${(entry.values ?? []).slice(0, 4).join(', ') || 'a value'} `
      + `| \`${entry.fact_key}\` |`);
  lines.push('');
  if (built.more_questions)
    lines.push(`…and ${built.more_questions} further question(s) blocking fewer obligations each.`);
  lines.push('');

  for (const entry of (built.questions ?? []).slice(0, 3)) {
    lines.push(`### \`${entry.fact_key}\``);
    lines.push('');
    lines.push(`Answering this resolves ${entry.blocks} obligation(s), including:`);
    lines.push('');
    for (const citation of entry.would_resolve) lines.push(`- ${citation}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(built.caveat ?? '');
  return lines.join('\n');
}
