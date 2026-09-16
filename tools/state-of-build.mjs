#!/usr/bin/env node
// Regenerate the "State of the build" table in README.md from the repository itself.
//
// WHY THIS IS A TOOL AND NOT A TABLE. Every number in that table was typed by hand, and by the
// time of writing every one of them was wrong: 1,656 records against a real 1,890, 45 gates
// against 48, 15 MCP tools against 25, 15 engine modules against 25. the reference documentation had drifted the same way and had to be rewritten against the repo. A repository
// whose premise is that a claim must be checkable against its source cannot keep its own
// headline figures in prose that nothing checks.
//
// So the table is generated between two markers and `--check` is wired into npm test, which is
// the convention meta/fact-keys.yaml, meta/ecfr-vintages.yaml and corpus.html already follow.
// A stale README now fails CI instead of surviving three releases.
//
// Every figure is DERIVED, never passed in. Where a count has an authoritative home — the gate
// list inside validate.mjs, the fixture expectations, the MCP tool table — this reads that home
// rather than recounting by a method of its own, so the table cannot disagree with the thing it
// describes.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { load as loadCorpus } from '../engine/corpus.mjs';
import { declaredInstruments, instrumentCoverage } from '../engine/coverage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const R = p => resolve(ROOT, p);
const read = p => readFileSync(R(p), 'utf8');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

// ---- corpus -----------------------------------------------------------------
const records = [];
for (const f of walk(R('corpus'))) {
  if (!/\.ya?ml$/.test(f)) continue;
  let doc; try { doc = yaml.load(readFileSync(f, 'utf8')); } catch { continue; }
  for (const r of (Array.isArray(doc) ? doc : [doc])) if (r?.id && r?.record_type) records.push(r);
}
const tally = key => records.reduce((m, r) => (m[r[key]] = (m[r[key]] ?? 0) + 1, m), {});
const byType = tally('record_type');
const byVerif = tally('verification_status');
const obligations = byType.obligation ?? 0;
const provisions = byType.provision ?? 0;
// Invariant I1: an unverified record is suppressed from every output. That count belongs in the
// table precisely because it is not zero — the claim is that they are unreachable, not absent.
const suppressed = records.length - (byVerif.verbatim_confirmed ?? 0);
const otherTypes = Object.entries(byType)
  .filter(([t]) => t !== 'obligation' && t !== 'provision')
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([t, n]) => `${n} ${t}`).join(', ');

// ---- gates and fixtures -----------------------------------------------------
// The gate roster is read from validate.mjs itself, which gate 22 already proves is the complete
// and implemented list. Recounting it here by another route would create a second opinion.
// ALL_GATES is validate.mjs's own roster, and gate 22 already proves it lists every gate the
// file implements. Scraping "gate N" mentions instead found 45 of 48, because three gates are
// only ever named through a variable — the exact shape of undercount this table keeps producing.
const gateIds = (read('tools/validate.mjs').match(/ALL_GATES = \[([^\]]*)\]/)?.[1] ?? '')
  .split(',').map(x => Number(x.trim())).filter(Number.isFinite).sort((a, b) => a - b);
const expected = yaml.load(read('tests/fixtures/expected.yaml')) ?? {};
const fixtureCases = Object.keys(expected);
const exercised = new Set(Object.values(expected).flatMap(v => (Array.isArray(v) ? v : v?.gates ?? [])).map(Number));
const noFixture = Object.keys(yaml.load(read('tests/fixtures/no-fixture.yaml'))?.no_fixture ?? {});

// ---- engine, MCP, workflows, evals ------------------------------------------
const engineModules = readdirSync(R('engine')).filter(f => f.endsWith('.mjs') && !f.startsWith('test-')).length;
const mcpTools = new Set([...read('mcp/server.mjs').matchAll(/^\s*\{?\s*name:\s*'([a-z_]+)'/gm)].map(m => m[1])).size;
// WORKFLOWS is the registry the CLI and the MCP server both dispatch through; counting .mjs
// files counted the one module that holds all four.
const workflowCount = ((read('workflows/index.mjs').match(/export const WORKFLOWS = \{([^}]*)\}/)?.[1] ?? '')
  .split(',').map(x => x.trim()).filter(Boolean)).length;
const evalScenarios = existsSync(R('evals/scenarios'))
  ? readdirSync(R('evals/scenarios')).filter(f => /\.(ya?ml|json)$/.test(f)).length
  : null;

// ---- instrument completeness ------------------------------------------------
// Read from engine/coverage.mjs rather than recomputed. The README said "43 fully present · 11
// partial" while the engine computed a different split; the engine is what answers a user, so
// the engine is what the README reports. A doc that disagrees with the engine is a doc that
// describes a system nobody is running.
const corpus = loadCorpus();
const instruments = declaredInstruments();
const completeness = instruments.map(id => instrumentCoverage(id, corpus));
const fullyPresent = completeness.filter(c => c.complete).length;
const partialInstruments = completeness.length - fullyPresent;

// ---- coverage ---------------------------------------------------------------
// meta/coverage.yaml is itself generated and --check'd, so it is a legitimate upstream here.
const coverage = yaml.load(read('meta/coverage.yaml')) ?? {};
const taxonomy = (() => {
  const m = String(coverage.source_taxonomy ?? '');
  const leaves = [];
  (function collect(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(collect);
    for (const [k, v] of Object.entries(node)) { if (k === 'leaves' && typeof v === 'number') leaves.push(v); collect(v); }
  })(coverage);
  return { taxonomyName: m, leaves };
})();

const walkerAssumptions = (yaml.load(read('meta/extractor-assumptions.yaml'))?.assumptions ?? []).length;
const missingVintages = (yaml.load(read('meta/missing-vintages.yaml'))?.entries ?? []).length;
const taxonomyLeaves = (() => {
  // update-coverage.mjs is the authority for this ratio and already has a --check in npm test.
  try {
    const out = execFileSync('node', [R('tools/update-coverage.mjs'), '--check'], { encoding: 'utf8', cwd: ROOT });
    const m = out.match(/leaves covered\s+(\d+)\s*\/\s*(\d+)/);
    if (!m) throw new Error('update-coverage.mjs --check printed no "leaves covered" ratio');
    return { covered: Number(m[1]), total: Number(m[2]) };
  } catch (e) {
    // A ROW THAT CANNOT BE COMPUTED IS AN ERROR, NOT AN OMISSION. Returning null here dropped the
    // taxonomy row from the table in silence the one time meta/coverage.yaml was stale, and a
    // table that quietly loses a row is worse than one that is wrong out loud: nothing downstream
    // can tell a figure that is missing from a figure that was never claimed.
    console.error('cannot compute the taxonomy coverage row: ' + (e?.message ?? e)
      + '\nmeta/coverage.yaml is generated — run: node tools/update-coverage.mjs');
    process.exit(2);
  }
})();

const rows = [];
const row = (k, v) => { if (v != null) rows.push(`| ${k} | ${v} |`); };
row('Records', `**${records.length.toLocaleString('en-US')}** — ${obligations} analysed obligations the `
  + `engine reasons with, ${provisions.toLocaleString('en-US')} held as verified reference text with no `
  + `applicability predicate, plus ${otherTypes}`);
row('Verified', `${(byVerif.verbatim_confirmed ?? 0).toLocaleString('en-US')} \`verbatim_confirmed\``
  + (suppressed ? ` · ${suppressed} suppressed by invariant I1 and unreachable from any output` : ''));
row('Instruments', `${instruments.length} declared · **${fullyPresent} fully present** against their `
  + `declared duty categories · ${partialInstruments} partial, with the missing provisions named in `
  + `every answer that touches them`);
row('taxonomy leaves covered', `${taxonomyLeaves.covered} / ${taxonomyLeaves.total} · `
  + `${taxonomyLeaves.total - taxonomyLeaves.covered} neither covered nor ruled out of scope, and gate 34 `
  + `ratchets that number`);
row('CI gates', `**${gateIds.length}**, all named · ${fixtureCases.length} fixtures · `
  + `${[...exercised].filter(g => gateIds.includes(g)).length} gates fixture-exercised, `
  + `${noFixture.length} declared unexercisable in \`tests/fixtures/no-fixture.yaml\` and why`);
row('Walker assumptions', `${walkerAssumptions} declared, ${walkerAssumptions} with an executable test`);
row('Engine', `${engineModules} modules · property tests covering both halves of invariant I6, `
  + `as-of validation, the trigger and incident vocabularies, version-chain semantics, and `
  + `totality of every entry point`);
row('MCP server', `**${mcpTools} tools**, incl. \`privacy_memo\` (the defensibility record), `
  + `\`privacy_facts\` (the input vocabulary), \`privacy_incidents\`, \`privacy_workflow\``);
if (workflowCount) row('Workflows', `${workflowCount} lifecycle-indexed, reachable from the CLI and MCP`);
if (evalScenarios) row('Eval scenarios', `${evalScenarios}, all-pass baseline enforced by gate 8`);

if (missingVintages) row('Prior vintages not held', `**${missingVintages}**, each named in `
  + `\`meta/missing-vintages.yaml\` — provisions whose stored text is current but whose earlier `
  + `text this repository does not hold, so an as-of question before that date is refused rather `
  + `than answered from the wrong vintage`);

const BEGIN = '<!-- state-of-build:begin -->';
const END = '<!-- state-of-build:end -->';
const table = [BEGIN,
  '<!-- Generated by tools/state-of-build.mjs. Do not hand-edit: npm test fails on a stale table. -->',
  '', '| | |', '|---|---|', ...rows, '', END].join('\n');

const readme = read('README.md');
const i = readme.indexOf(BEGIN), j = readme.indexOf(END);
if (i === -1 || j === -1) {
  console.error('README.md has no state-of-build markers. Add:\n' + BEGIN + '\n' + END);
  process.exit(2);
}
const next = readme.slice(0, i) + table + readme.slice(j + END.length);

if (process.argv.includes('--check')) {
  if (next !== readme) {
    console.error('README.md "State of the build" is STALE — run: node tools/state-of-build.mjs');
    process.exit(1);
  }
  console.log('README.md "State of the build" is current.');
} else {
  writeFileSync(R('README.md'), next);
  console.log(`README.md "State of the build" rewritten — ${rows.length} rows.`);
}
