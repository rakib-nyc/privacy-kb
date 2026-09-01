// Load and index the corpus. The engine reads ONLY committed records — there is no other
// source of truth, and nothing is synthesised at query time.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as yaml from 'js-yaml';

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

/** In force as of a date. Invariant I2: there is no "current law", only law as of a date. */
export function inForceOn(a, asOf) {
  if (a.status !== 'in_force') return false;
  if (a.effective_from && a.effective_from > asOf) return false;
  if (a.effective_to && a.effective_to < asOf) return false;
  return true;
}

/** Invariant I1: an unverified atom must never be surfaced. */
export const surfaceable = a => a.verification_status === 'verbatim_confirmed';
