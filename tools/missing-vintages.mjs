#!/usr/bin/env node
// THE LEDGER OF PRIOR VINTAGES THE CORPUS DOES NOT HOLD.
//
// A record whose stored text is proved younger than the effective_from it claimed gets narrowed
// to the window its text actually covers. That trades a WRONG VINTAGE for a FALSE NEGATIVE: the
// engine now returns nothing for dates the missing prior text would have covered. The trade is
// worth making — a wrong vintage reads exactly like a right one, while silence at least shows up
// as a coverage gap — but it is still an error, and this file is the list of them.
//
// WHY THIS IS ITS OWN TOOL. The first version rebuilt the ledger from the CURRENT set of
// overclaiming records. That set is, by construction, the records not yet fixed — so correcting a
// record deleted the entry describing its gap, and the ledger emptied itself as the work got
// done. A register of known holes that shrinks when you patch the wall is worse than no register,
// because the count looks like progress.
//
// So entries ACCUMULATE. A gap is closed only when the prior vintage is actually added to the
// corpus and the two are chained, which is a claim about the corpus, not about this file.
//
//   node tools/missing-vintages.mjs            add any newly narrowed records to the ledger
//   node tools/missing-vintages.mjs --check    exit 1 if the ledger has drifted from the corpus

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);
const LEDGER = R('meta/missing-vintages.yaml');
const CHECK = process.argv.includes('--check');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.yaml') && p.includes('/atoms/')) out.push(p);
  }
  return out;
}

const byId = new Map();
for (const f of walk(R('corpus'))) {
  const rec = yaml.load(readFileSync(f, 'utf8'));
  if (rec?.id) byId.set(rec.id, rec);
}

const vintages = existsSync(R('meta/ecfr-vintages.yaml'))
  ? (yaml.load(readFileSync(R('meta/ecfr-vintages.yaml'), 'utf8'))?.findings ?? []) : [];

const prior = existsSync(LEDGER) ? (yaml.load(readFileSync(LEDGER, 'utf8')) ?? {}) : {};
const entries = new Map((prior.entries ?? []).map(e => [e.atom_id, e]));

// A record belongs in the ledger once its text has been proved younger than the corpus once
// claimed — whether or not it has since been narrowed. The test is the FINDING, not the current
// effective_from, because the current date is what the fix changed.
let added = 0, updated = 0;
for (const f of vintages) {
  if (f.verdict !== 'changed') continue;
  const rec = byId.get(f.atom_id);
  if (!rec) continue;
  const narrowed = rec.effective_from === f.span_first_seen;
  const overclaiming = rec.effective_from && rec.effective_from < f.span_first_seen;
  if (!narrowed && !overclaiming) continue;   // record already covered the right window

  const entry = {
    atom_id: f.atom_id,
    citation: f.citation,
    corpus_now_answers_from: rec.effective_from ?? null,
    missing_before: f.span_first_seen,
    last_seen_without_this_text: f.span_absent_at,
    evidence_window: f.window,
    status: overclaiming ? 'record still overclaims — narrow it' : 'open — prior vintage not held',
  };
  if (!entries.has(f.atom_id)) { entries.set(f.atom_id, entry); added++; }
  else {
    const was = JSON.stringify(entries.get(f.atom_id));
    entries.set(f.atom_id, { ...entries.get(f.atom_id), ...entry });
    if (JSON.stringify(entries.get(f.atom_id)) !== was) updated++;
  }
}

const list = [...entries.values()].sort((x, y) => x.citation.localeCompare(y.citation));
const doc = {
  generated: new Date().toISOString().slice(0, 10),
  what_this_is:
    'Provisions whose stored text was PROVED younger than the effective_from the record claimed. '
    + 'Each record has been narrowed to the window its text actually covers, so the corpus no '
    + 'longer answers an old question with new words. The cost is a false negative: for any date '
    + 'before corpus_now_answers_from the engine returns nothing for this provision, because the '
    + 'text that governed then is not held. Entries ACCUMULATE and are closed only by adding the '
    + 'prior vintage as its own record and chaining the two — never by fixing the date alone.',
  count: list.length,
  entries: list,
};

if (CHECK) {
  const current = existsSync(LEDGER) ? readFileSync(LEDGER, 'utf8') : '';
  const want = yaml.load(current) ?? {};
  const haveIds = new Set((want.entries ?? []).map(e => e.atom_id));
  const missing = list.filter(e => !haveIds.has(e.atom_id));
  if (missing.length) {
    console.log('meta/missing-vintages.yaml is missing entries for:');
    for (const m of missing) console.log(`  ${m.citation} (${m.atom_id})`);
    console.log('\nRun: node tools/missing-vintages.mjs');
    process.exit(1);
  }
  console.log(`meta/missing-vintages.yaml is current (${want.entries?.length ?? 0} entries)`);
  process.exit(0);
}

writeFileSync(LEDGER,
  '# Prior versions of provisions the corpus does NOT hold. Entries accumulate; see the tool.\n'
  + yaml.dump(doc, { lineWidth: 100, quotingType: '"' }));
console.log(`meta/missing-vintages.yaml: ${list.length} entries (${added} added, ${updated} updated)`);
