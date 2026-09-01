#!/usr/bin/env node
// BASELINE source.segment_sha256 FOR EVERY RECORD WHOSE PATH RESOLVES TO ONE LEAF.
//
// Gate 38 compares an atom against the segmentation leaf it quotes, so that a WALKER change --
// which moves the leaves without touching a byte of the source -- cannot age a record in silence.
// This writes the baseline. It deliberately does NOT re-read anything: the value records what the
// leaf looked like when the record last passed gates 3, 23 and 30, and nothing more.
//
//   node tools/anchor-segments.mjs [--write]
//
// Without --write it reports what would change, which is the form to run after a walker fix:
// every id it lists is a record whose quoted provision has been re-cut and needs reading.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);
const sha256 = b => createHash('sha256').update(b).digest('hex');
const norm = s => s.replace(/\s+/g, ' ').trim();
const WRITE = process.argv.includes('--write');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.yaml') && p.includes('/atoms/')) out.push(p);
  }
  return out;
}

let baselined = 0, changed = 0, skipped = 0;
const drift = [];
for (const f of walk(R('corpus'))) {
  const raw = readFileSync(f, 'utf8');
  let a; try { a = yaml.load(raw); } catch { continue; }
  const rf = a?.source?.raw_file, pp = a?.paragraph_path;
  if (!rf || !pp?.path) { skipped++; continue; }
  const base = rf.split('/').pop().replace(/\.[^.]+$/, '');
  const seg = R(rf.split('/').slice(0, -2).concat(`${base}.seg.json`).join('/'));
  if (!existsSync(seg)) { skipped++; continue; }
  let leaves; try { leaves = JSON.parse(readFileSync(seg, 'utf8')).leaves ?? []; } catch { skipped++; continue; }
  const want = JSON.stringify(pp.path);
  const inSection = l => pp.anchor == null || l.section == null || String(l.section) === String(pp.anchor);
  const hits = leaves.filter(l => JSON.stringify(l.path) === want && inSection(l));
  if (hits.length !== 1) { skipped++; continue; }
  const actual = sha256(Buffer.from(norm(String(hits[0].text)), 'utf8'));
  const stored = a.source.segment_sha256 ?? null;
  if (stored === actual) { baselined++; continue; }
  if (stored) { drift.push(a.id); changed++; } else baselined++;
  if (WRITE) {
    a.source.segment_sha256 = actual;
    writeFileSync(f, yaml.dump(a, { sortKeys: false, lineWidth: 100 }));
  }
}
if (drift.length) {
  console.log('RE-CUT since last anchored -- read each against its new leaf before re-baselining:');
  for (const id of drift) console.log('  ' + id);
}
console.log(`\n${baselined} anchored, ${changed} re-cut, ${skipped} carry no resolvable path` +
            (WRITE ? '' : '  (dry run -- rerun with --write)'));
