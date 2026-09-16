// A STANDING SET OF FACTS, AND WHAT CHANGED SINCE YOU LAST LOOKED.
//
// the acquisition policy"the feature nobody in the market has, and it is
// only possible because every atom is versioned and every applicability decision is a pure
// function of facts and a date". Everything it needs now exists: analyze() is that pure function,
// betweenDates() diffs one fact vector across two dates, and issueReceipt() fingerprints an
// answer against the corpus that produced it.
//
// What was missing is the boring part — somewhere to keep the facts. Without it every query is a
// one-off: you re-type the entity each time, you have nothing to diff against, and "has anything
// changed for us" is a question the tool cannot be asked at all. A profile turns a series of
// unrelated answers into a position that can be re-checked.
//
// THE COMPARISON IS AGAINST A STORED RECEIPT, not against a remembered answer. That matters
// because it separates three things a single "something changed" alert would collapse:
//
//   the corpus moved      records were added, removed or re-cut — the law this tool holds changed
//   the question moved    someone edited the profile's facts
//   the answer moved      with both stable, which means the engine changed and should not have
//
// Profiles are USER DATA, not repository declarations. They live outside corpus/ and meta/, are
// git-ignored by default, and nothing in the gate suite reads them: a customer's facts are not
// evidence about the law and must never end up in a provenance chain.
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as yaml from 'js-yaml';
import { load } from './corpus.mjs';
import { issueReceipt } from './receipt.mjs';
import { betweenDates } from './exposure.mjs';
import { analyze } from './applicability.mjs';
import { createHash } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '..');
export function profileDir() {
  return process.env.PRIVACY_KB_PROFILES || join(ROOT, 'profiles');
}
const pathFor = name => join(profileDir(), `${String(name).replace(/[^A-Za-z0-9._-]/g, '_')}.yaml`);
const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/** How many checks a profile keeps. Older entries are dropped and counted, never silently lost. */
const HISTORY_LIMIT = 200;

export function listProfiles() {
  const dir = profileDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.yaml'))
    .map(f => {
      try {
        const doc = yaml.load(readFileSync(join(dir, f), 'utf8')) ?? {};
        return { name: doc.name ?? f.replace(/\.yaml$/, ''),
                 description: norm(doc.description),
                 last_checked: doc.last_check?.checked_on ?? null,
                 obligations: doc.last_check?.obligations ?? null };
      } catch { return { name: f.replace(/\.yaml$/, ''), description: '(unreadable)', last_checked: null }; }
    })
    .sort((a, z) => a.name.localeCompare(z.name));
}

export function readProfile(name) {
  const file = pathFor(name);
  if (!existsSync(file)) return { found: false, name, error: `no profile named "${name}"` };
  try {
    const doc = yaml.load(readFileSync(file, 'utf8')) ?? {};
    return { found: true, file, ...doc };
  } catch (err) {
    return { found: false, name, error: `profile "${name}" is not readable: ${err.message}` };
  }
}

/** Write a profile. Facts only — never a result, which would go stale beside the facts. */
export function saveProfile(name, facts, meta) {
  const dir = profileDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existing = readProfile(name);
  const doc = {
    name: String(name),
    description: norm(meta?.description) || existing.description || null,
    created: existing.found ? (existing.created ?? null) : new Date().toISOString().slice(0, 10),
    updated: new Date().toISOString().slice(0, 10),
    state_layers: (facts?.state_layers ?? existing.state_layers ?? []).slice().sort(),
    facts: {
      entity: facts?.entity ?? {}, data: facts?.data ?? {},
      event: facts?.event ?? {}, practice: facts?.practice ?? {},
      purpose: facts?.purpose ?? {}, law: facts?.law ?? {},
    },
    // The last CHECK is kept, not the last answer. A stored answer beside stored facts invites
    // someone to read the answer without re-running it, which is how a compliance register goes
    // quietly stale.
    last_check: existing.last_check ?? null,
    // Editing the facts does NOT reset the register. The history is the record of what this
    // profile has been asked and when; discarding it on a fact edit would destroy exactly the
    // evidence that explains why the next answer differs.
    history: Array.isArray(existing.history) ? existing.history : [],
    history_dropped: existing.history_dropped ?? 0,
  };
  writeFileSync(pathFor(name), yaml.dump(doc, { lineWidth: 96, sortKeys: false }), 'utf8');
  return { saved: true, file: pathFor(name), name: doc.name };
}

// THE DATE IS NOT PART OF THE QUESTION, for this purpose.
//
// receipt's inputs_digest covers the as-of date, correctly — asking about a different date IS a
// different question. But a profile check almost always moves the date, so using inputs_digest
// alone to mean "someone edited the facts" marked every check as a changed question and
// suppressed the legal-change diff entirely. The facts get their own digest so the two causes
// stay separable: edited facts mean the delta is a consequence of the edit, a moved date alone
// means the delta is the law.
function factsDigest(profile) {
  const facts = profile.facts ?? {};
  const shaped = {
    entity: facts.entity ?? {}, data: facts.data ?? {}, event: facts.event ?? {},
    practice: facts.practice ?? {}, purpose: facts.purpose ?? {}, law: facts.law ?? {},
    state_layers: (profile.state_layers ?? []).slice().sort(),
  };
  const canonical = value => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort()
      .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  };
  return createHash('sha256').update(canonical(shaped), 'utf8').digest('hex');
}

function contextOf(profile, asOf) {
  return { as_of: asOf, state_layers: profile.state_layers ?? [],
           event: profile.facts?.event ?? {}, practice: profile.facts?.practice ?? {},
           purpose: profile.facts?.purpose ?? {}, law: profile.facts?.law ?? {} };
}

/**
 * Re-run a profile and report what moved since the last check.
 *
 * On the first check there is nothing to compare against, and the result says so rather than
 * reporting "no changes" — which would be indistinguishable from a real all-clear and is exactly
 * the false-reassurance shape this repository keeps finding.
 */
export function checkProfile(name, asOf, corpus, options) {
  const kb = corpus ?? load();
  const profile = readProfile(name);
  if (!profile.found) return { ok: false, error: profile.error };
  if (!asOf) return { ok: false, error: 'an as-of date is required — there is no "current law"' };

  const context = contextOf(profile, asOf);
  const entity = profile.facts?.entity ?? {};
  const data = profile.facts?.data ?? {};
  const result = analyze(entity, data, context);
  if (result.error) return { ok: false, error: result.error };
  const receipt = issueReceipt(entity, data, context, kb);

  const factsNow = factsDigest(profile);
  const previous = profile.last_check ?? null;
  const first = !previous;

  let moved = null, delta = null;
  if (!first) {
    moved = {
      corpus: previous.corpus_digest !== receipt.corpus_digest,
      facts: previous.facts_digest !== undefined && previous.facts_digest !== factsNow,
      date: previous.as_of !== asOf,
      result: previous.result_digest !== receipt.result_digest,
    };
    // Only diff the LAW across dates. If the facts changed, the obligation delta is a consequence
    // of the edit and attributing it to legal change would be wrong.
    if (moved.date && !moved.facts)
      delta = betweenDates(entity, data, context, previous.as_of, asOf, kb);
  }

  const checked = {
    checked_on: new Date().toISOString().slice(0, 10),
    as_of: asOf,
    receipt_id: receipt.receipt_id,
    inputs_digest: receipt.inputs_digest,
    facts_digest: factsNow,
    corpus_digest: receipt.corpus_digest,
    result_digest: receipt.result_digest,
    obligations: (result.obligations ?? []).length,
  };

  if (options?.record !== false) {
    const doc = { ...profile };
    delete doc.found; delete doc.file;
    doc.last_check = checked;
    // A REGISTER IS THE HISTORY, NOT THE LAST ROW. Only last_check was kept, so the second check
    // overwrote the first and the question a compliance register exists to answer — when did this
    // move, and what moved with it — could not be asked at all. Each check appends, and the entry
    // carries `moved` so the trajectory records WHY the answer changed rather than only that it
    // did. Trimmed to HISTORY_LIMIT so a daily check does not grow a file without bound; the
    // oldest entries go first and the count of dropped ones is kept, because a silently truncated
    // history reads exactly like a short one.
    const history = Array.isArray(profile.history) ? profile.history.slice() : [];
    history.push({ ...checked, moved: moved ?? null });
    doc.history_dropped = (profile.history_dropped ?? 0) + Math.max(0, history.length - HISTORY_LIMIT);
    doc.history = history.slice(-HISTORY_LIMIT);
    writeFileSync(pathFor(name), yaml.dump(doc, { lineWidth: 96, sortKeys: false }), 'utf8');
  }

  const history = Array.isArray(profile.history) ? profile.history : [];
  return {
    ok: true, name: profile.name, first_check: first,
    history: [...history, { ...checked, moved: moved ?? null }].slice(-HISTORY_LIMIT),
    history_dropped: profile.history_dropped ?? 0,
    previous: previous ? { as_of: previous.as_of, checked_on: previous.checked_on,
                           obligations: previous.obligations } : null,
    now: checked, moved, delta,
    obligations: (result.applicable ?? []).map(hit => ({ atom_id: hit.atom_id, citation: hit.citation })),
    coverage_gaps: result.coverage_gaps ?? [],
    note: first
      ? 'FIRST CHECK. There is nothing to compare against, so nothing is reported as unchanged. ' +
        'A baseline has been recorded; run this again to see movement.'
      : 'Compared against the receipt stored at the last check. `moved` separates a changed ' +
        'corpus from a changed question from a changed answer, because a single "something ' +
        'changed" would collapse three different problems.',
  };
}
