#!/usr/bin/env node
// Source-fetching harness (BRIEF.md Phase 0, step 4).
//
//   node tools/fetch-source.mjs <url> --out <path> [--instrument <id>] [--note "..."]
//   node tools/fetch-source.mjs --recheck [--instrument <id>]
//
// Fetches a primary source, stores it byte-for-byte under raw/, records the
// sha256, and logs the entry to meta/sources.yaml. Refuses non-authoritative
// hosts outright: an atom whose source block points at a law-firm alert is not a
// defect to be flagged later, it is a fetch that must never have succeeded.
//
// --recheck re-fetches everything already logged and reports hash drift without
// writing anything. That is the read half of the change-watch pipeline
// (PROMPTS.md §7); it never mutates an atom.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { classify } from './sources-policy.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const LEDGER = resolve(ROOT, 'meta/sources.yaml');
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

function loadLedger() {
  if (!existsSync(LEDGER)) return { sources: [] };
  return yaml.load(readFileSync(LEDGER, 'utf8')) ?? { sources: [] };
}

function saveLedger(l) {
  l.sources.sort((a, b) => (a.raw_file || '').localeCompare(b.raw_file || ''));
  writeFileSync(LEDGER, HEADER + yaml.dump(l, { lineWidth: 100, quotingType: '"' }));
}

const HEADER = `# SOURCE LEDGER
# Every primary source ever fetched, with the hash of exactly the bytes stored.
# Written only by tools/fetch-source.mjs. Do not hand-edit: the hashes here are
# what CI gate 2 checks atoms against.
#
# A source in this file is not an endorsement of currency. \`fetched\` is when we
# pulled it; use \`npm run fetch -- --recheck\` to detect upstream drift.

`;

async function grab(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'privacy-kb/0.1 (corpus fetch; contact repo owner)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, contentType: res.headers.get('content-type') ?? null, finalUrl: res.url };
}

async function fetchOne(url, out, instrument, note) {
  const cls = classify(url);
  if (!cls.ok) {
    console.error(`REFUSED: ${cls.host} is not an authoritative primary-source host.`);
    console.error('Secondary sources may be used to LOCATE a citation and never to supply text.');
    console.error('If this host really is authoritative, add it to tools/sources-policy.mjs');
    console.error('in its own commit, with a stated reason.');
    process.exit(2);
  }
  if (!out) { console.error('--out <path> is required'); process.exit(2); }

  const { buf, contentType, finalUrl } = await grab(url);
  const dest = resolve(ROOT, out);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);

  const hash = sha256(buf);
  const rel = relative(ROOT, dest);
  const ledger = loadLedger();
  const entry = {
    url,
    final_url: finalUrl !== url ? finalUrl : null,
    host_kind: cls.kind,
    instrument_id: instrument ?? null,
    raw_file: rel,
    raw_sha256: hash,
    bytes: buf.length,
    content_type: contentType,
    fetched: today(),
    note: note ?? null,
  };
  const i = ledger.sources.findIndex(s => s.raw_file === rel);
  if (i >= 0) {
    const prev = ledger.sources[i];
    if (prev.raw_sha256 !== hash) {
      entry.supersedes_sha256 = prev.raw_sha256;
      entry.previously_fetched = prev.fetched;
      console.log(`CHANGED  ${rel}\n  was ${prev.raw_sha256}\n  now ${hash}`);
    }
    ledger.sources[i] = entry;
  } else {
    ledger.sources.push(entry);
  }
  saveLedger(ledger);
  console.log(`stored   ${rel}  (${buf.length} bytes)\nsha256   ${hash}`);
}

async function recheck(filter) {
  const ledger = loadLedger();
  let drift = 0, failed = 0, checked = 0;
  for (const s of ledger.sources) {
    if (filter && s.instrument_id !== filter) continue;
    checked++;
    try {
      const { buf } = await grab(s.url);
      const now = sha256(buf);
      if (now !== s.raw_sha256) {
        drift++;
        console.log(`DRIFT    ${s.raw_file}\n  stored ${s.raw_sha256} (fetched ${s.fetched})\n  live   ${now}`);
      }
    } catch (e) {
      failed++;
      console.log(`UNREACHABLE ${s.url}\n  ${e.message}`);
    }
  }
  console.log(`\nchecked ${checked} · drifted ${drift} · unreachable ${failed}`);
  if (drift) console.log('\nDrift is a review item, never an auto-update. Open one per instrument.');
  process.exit(drift || failed ? 1 : 0);
}

const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

if (argv.includes('--recheck')) {
  await recheck(flag('--instrument'));
} else {
  const url = argv.find(a => a.startsWith('http'));
  if (!url) {
    console.error('usage: fetch-source.mjs <url> --out <path> [--instrument <id>] [--note "..."]');
    console.error('       fetch-source.mjs --recheck [--instrument <id>]');
    process.exit(2);
  }
  await fetchOne(url, flag('--out'), flag('--instrument'), flag('--note'));
}
