#!/usr/bin/env node
// GATE 22 — engine/schema correspondence.
//
// DEBT-009's general form, and the more valuable gate of the two. The engine read
// `ex.applies_if`; the schema forbade it. Three green signals sat on top of a capability
// that could not fire, because nothing asserted that a field the ENGINE READS is a field
// the SCHEMA GUARANTEES.
//
// Engine and schema were built in separate sessions. That seam is where this leaks, and it
// will leak again. This walks every record-field access in engine/ and mcp/ and fails on
// any read the schema does not define.
//
//   node tools/check-engine-schema.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);

// Variables in engine/mcp code that hold a RECORD (or a part of one), and what shape each is.
const RECORD_VARS = {
  a: 'record', atom: 'record', rec: 'record', o: 'record', federalAtom: 'record', stateAtom: 'record',
  ex: 'exemption', c: 'context_entry',
};

function schemaFields() {
  const out = { record: new Set(), exemption: new Set(), context_entry: new Set() };
  for (const f of readdirSync(R('schemas')).filter(x => x.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(R(`schemas/${f}`), 'utf8'));
    for (const k of Object.keys(d.properties ?? {})) out.record.add(k);
    const ex = d.properties?.exemptions?.items?.properties;
    for (const k of Object.keys(ex ?? {})) out.exemption.add(k);
    const ctx = d.$defs?.operative_context_entry?.properties;
    for (const k of Object.keys(ctx ?? {})) out.context_entry.add(k);
  }
  // Fields the engine legitimately synthesises or reads off its own structures, not off a record.
  for (const k of ['id']) out.exemption.add(k);
  return out;
}

// Reads that are not record fields: locals, JS builtins, engine-internal shapes.
const IGNORE = new Set([
  'length','map','filter','find','some','every','push','slice','join','sort','includes','entries',
  'value','why','decided_by','refused','concat','flatMap','reduce','has','get','set','add','keys',
  'toISOString','getTime','setUTCMonth','setUTCFullYear','getUTCDay','replace','split','test','exec',
  'startsWith','endsWith','indexOf','trim','toLowerCase','name','message','status','statusText',
  'matched','residual_scope','reasoning','exempt','level','computed','all','any','not','items','result',
]);

const files = [];
for (const dir of ['engine', 'mcp']) {
  if (!existsSync(R(dir))) continue;
  for (const f of readdirSync(R(dir)).filter(x => x.endsWith('.mjs') && !x.startsWith('test-')))
    files.push(join(dir, f));
}

const S = schemaFields();
const problems = [], seen = new Map();
for (const f of files) {
  // Strip comments and string literals before scanning. A comment that MENTIONS a field —
  // "its atoms are ny.gbl.349.a.unlawful and siblings" — is not the engine reading that field,
  // and flagging it teaches the reflex of rewording explanations to appease a checker. The gate
  // has to look at code, so make it look at code.
  const src = readFileSync(R(f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')        // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')      // line comments, leaving http:// alone
    // Template literals keep their ${...} expressions: `${ex.type}` IS a read, and dropping the
    // whole literal would trade a false positive for a false negative, which is the worse trade.
    // Only the literal TEXT between the interpolations goes.
    .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g,
             lit => ' ' + [...lit.matchAll(/\$\{([^}]*)\}/g)].map(m => m[1]).join(' ; ') + ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/g)) {
    const [, v, field] = m;
    const kind = RECORD_VARS[v];
    if (!kind || IGNORE.has(field)) continue;
    const key = `${kind}.${field}`;
    if (!seen.has(key)) seen.set(key, f);
    if (!S[kind].has(field)) problems.push({ file: f, var: v, kind, field });
  }
}

const byKey = new Map();
for (const p of problems) byKey.set(`${p.kind}.${p.field}`, p);
console.log(`record-field reads checked : ${seen.size}`);
console.log(`schema properties available: record ${S.record.size}, exemption ${S.exemption.size}, context ${S.context_entry.size}`);
if (byKey.size) {
  console.log(`\n${byKey.size} ENGINE READ(S) THE SCHEMA DOES NOT DEFINE:\n`);
  for (const [k, p] of byKey)
    console.log(`  ${k}\n      read in ${p.file} as ${p.var}.${p.field}\n` +
      `      The engine depends on a field no record is guaranteed to carry. Either add it to the\n` +
      `      schema, or stop reading it — a silent undefined is how DEBT-009 happened.`);
  process.exit(1);
}
console.log('\nevery record field the engine reads is defined by the schema');
