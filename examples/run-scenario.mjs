#!/usr/bin/env node
// The worked example in examples/README.md, run against the live corpus.
// Regenerate with: node examples/run-scenario.mjs
import { analyze } from '../engine/applicability.mjs';
import { computeDeadline } from '../engine/timeline.mjs';
import { load } from '../engine/corpus.mjs';

const corpus = load();
const out = [];
const say = (...a) => { out.push(a.join(' ')); console.log(...a); };
const rule = t => say(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);

// ── THE COMPANY ───────────────────────────────────────────────────────────────
// Meridian Health, a telehealth startup. Delaware incorporated, offices in Austin.
// No New York office and no New York employees — but New York patients.
const ENTITY = {
  is_hipaa_covered_entity: true,
  owns_or_licenses_computerized_data: true,
  within_ftc_jurisdiction: true,
  in_or_affecting_commerce: true,
  is_employer: true,
  is_ny_employer: true,
  uses_automated_employment_decision_tool: true,
  nexus: 'US-NY-NYC',
};
const DATA = { is_phi: true, includes_ny_private_information: true, types: ['phi'] };
const AS_OF = '2026-09-02';

rule('SCENARIO 1 — A breach. Who must be told, and by when?');
const breach = analyze(ENTITY, DATA, {
  as_of: AS_OF,
  state_layers: ['US-NY'],
  event: { type: 'breach_of_security_of_the_system', discovered_on: '2026-09-02' },
  practice: { notified_hhs_secretary_of_breach: true },
});
say(`\nas_of ${breach.as_of} · ${breach.obligations.length} obligations engaged in total.`);
say(`Showing the BREACH-RELEVANT ones; the rest (HIPAA use/disclosure, Title VII, LL144) are`);
say(`engaged by the same entity facts and are correct — breadth is the point, not noise.\n`);
const BREACH = /899-aa|164\.40[0-9]|17932|899-bb/;
for (const o of breach.applicable.filter(x => BREACH.test(x.citation))) {
  const a = corpus.byId.get(o.atom_id);
  say(`  ${o.citation}`);
  say(`    ${a.summary.slice(0, 96)}`);
  if (o.partial_carve_out) say(`    CARVE-OUT (${o.partial_carve_out.level}) — entity stays in scope for everything else`);
}
say('\nDEADLINES, earliest first (the engine returns them unsorted; the workflow layer sorts):');
const computed = breach.deadlines
  .map(d => computeDeadline(corpus.byId.get(d.atom_id), '2026-09-02'))
  .filter(c => c?.computed)
  .sort((a, b) => a.computed.localeCompare(b.computed));
for (const c of computed) {
  say(`  ${c.computed}  ${c.duration.padEnd(18)} ${c.citation}`);
  say(`             trigger: ${c.trigger_event}`);
  if (c.caution) say(`             ⚠ ${c.caution.slice(0, 92)}`);
  if (c.business_day_basis) say(`             ⚠ business days = weekdays; holidays not excluded`);
}
say('\nBACKSTOPS (invariant I6 — these never switch off):');
for (const b of breach.backstops) say(`  ${b.citation ?? b.kind} — ${(b.why ?? b.note ?? '').slice(0, 84)}`);

rule('SCENARIO 2 — Hiring in NYC with an automated tool');
const hiring = analyze(ENTITY, { types: ['any'] }, { as_of: AS_OF, state_layers: ['US-NY'] });
for (const o of hiring.applicable.filter(x => x.instrument_id === 'nyc.local_law_144')) {
  const a = corpus.byId.get(o.atom_id);
  say(`  ${o.citation}\n    ${a.summary.slice(0, 100)}`);
}

rule('SCENARIO 3 — Minors on the platform, and a law that is NOT yet in force');
const minors = analyze(
  { ...ENTITY, is_ny_cdpa_operator: true, is_ny_addictive_platform_operator: true },
  { ...DATA, subject_is_cdpa_covered_user: true },
  { as_of: AS_OF, state_layers: ['US-NY'], include_pending: true,
    practice: { provides_addictive_feed: true, conduct_occurs_in_new_york: true } });
say(`\nIN FORCE today (${AS_OF}):`);
for (const o of minors.applicable.filter(x => x.instrument_id.includes('899')))
  say(`  ${o.citation}`);
say('\nPENDING — NOT LAW. Watch feed only:');
for (const p of minors.pending_watch)
  say(`  ${p.citation.padEnd(34)} status=${p.status}  binds from ${p.effective_from}`);
say(`\n  → ${minors.pending_watch[0]?.note ?? ''}`);

rule('SCENARIO 4 — What the corpus says it CANNOT tell you');
import { declaredInstruments, instrumentCoverage } from '../engine/coverage.mjs';
say('\nDeclared instruments that are NOT complete — the gap is stated, not silent:');
for (const i of declaredInstruments()) {
  const c = instrumentCoverage(i, corpus);
  if (c.complete) continue;
  for (const a of c.absent)
    say(`  ${i}\n    missing: ${a.id} (${(a.citation_prefix ?? []).join(', ')})\n    would supply: ${(a.supplies ?? '').slice(0, 120)}`);
}
say('\nRecords the corpus HOLDS but refuses to surface (invariant I1 — unverified):');
for (const r of corpus.all.filter(r => r.verification_status !== 'verbatim_confirmed'))
  say(`  ${r.id}  (${r.verification_status})`);
say('\nAnd the standing limit on all of it:');
say('  Every output above is machine-derived. Check each citation against the primary source');
say('  before relying on it — every record carries the URL, fetch date and hash to make that possible.');

import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./output.txt', import.meta.url), out.join('\n') + '\n');
