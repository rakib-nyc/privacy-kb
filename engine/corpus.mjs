// Load and index the corpus. The engine reads ONLY committed records — there is no other
// source of truth, and nothing is synthesised at query time.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as yaml from 'js-yaml';
import { isRealDate as _isRealDate } from './dates.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.yaml') && p.includes('/atoms/')) out.push(p);
  }
  return out;
}

let CACHE = null;
export function load() {
  if (CACHE) return CACHE;
  const all = walk(resolve(ROOT, 'corpus')).map(f => yaml.load(readFileSync(f, 'utf8'))).filter(r => r?.id);
  CACHE = {
    all,
    byId: new Map(all.map(r => [r.id, r])),
    obligations: all.filter(r => r.record_type === 'obligation'),
    authorities: all.filter(r => r.record_type === 'authority'),
    principles: all.filter(r => r.record_type === 'principle'),
    schemes: all.filter(r => r.record_type === 'certification_scheme'),
    taxonomies: all.filter(r => r.record_type === 'taxonomy'),
  };
  return CACHE;
}

/** Re-exported so existing importers keep working; the implementation lives in dates.mjs
 *  where timeline.mjs can reach it without pulling in the filesystem. */
export { isRealDate } from './dates.mjs';


/** Statuses under which a record WAS or IS law, so a date can decide whether it governs.
 *  `superseded` belongs here: a superseded vintage is not law today and IS law for any date
 *  inside its own window, which is the entire point of keeping it. Excluding it — as the old
 *  `status !== 'in_force'` test did — makes a version chain unreachable: the corpus could hold
 *  the February 2025 text of a provision and still answer a February 2025 question with
 *  nothing, because the record that governs is by definition no longer in force. */
export const EVER_LAW = new Set(['in_force', 'superseded']);

/** In force as of a date. Invariant I2: there is no "current law", only law as of a date.
 *
 *  THE WINDOW IS HALF-OPEN: [effective_from, effective_to). The old test used
 *  `effective_to < asOf`, which keeps a record in force ON its own end date — harmless while
 *  every effective_to in the corpus was null, and wrong the moment a chain exists, because
 *  vintage N's effective_to equals vintage N+1's effective_from and BOTH would answer for that
 *  day. Two versions of one provision in force simultaneously is not a near-miss; it is the
 *  corpus contradicting itself on the one day the amendment landed. */
export function inForceOn(a, asOf) {
  if (!EVER_LAW.has(a.status)) return false;
  if (a.effective_from && a.effective_from > asOf) return false;
  if (a.effective_to && a.effective_to <= asOf) return false;
  return true;
}

/** Invariant I1: an unverified atom must never be surfaced. */
export const surfaceable = a => a.verification_status === 'verbatim_confirmed';
