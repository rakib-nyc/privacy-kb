// THE DEFENSIBILITY RECORD — the artifact a lawyer can hand to someone.
//
// WHY THIS EXISTS. Everything upstream produces JSON from a terminal. Lawyers produce DOCUMENTS,
// and a analysis that lives only in a shell has not been delivered. But the reason to build it
// here rather than let a model write prose over the JSON is narrower and more important:
//
// AN ANALYSIS IS DEFENSIBLE ONLY IF ITS BOUNDARY IS. *United States v. Farris* held that citing
// real authorities "does not absolve" counsel — the failure there was not fabricated law, it was
// a lawyer who could not show what had been checked and what had not. So this artifact carries
// what the corpus does NOT know as prominently as what it does: coverage gaps, unasserted
// characterisations, facts never supplied, records suppressed as unverified. A memo that reports
// only its findings reads identically whether it examined everything or almost nothing.
//
// Every quoted provision travels with its source URL, the sha256 of the bytes it was cut from,
// the date those bytes were fetched, the vintage it is in force for, and WHAT KIND of date that
// vintage rests on. A reader who wants to disbelieve any sentence can re-verify it without
// trusting this tool at all. That is the property being sold.
import { load } from './corpus.mjs';
import { analyze } from './applicability.mjs';
import { triggerLabel } from './triggers.mjs';
import { incidentLabel } from './incidents.mjs';

const b = s => String(s ?? '');
const esc = s => b(s).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();

/** Wrap a long quotation to a readable width without breaking words. */
function wrap(text, width = 92, indent = '> ') {
  const words = b(text).replace(/\s+/g, ' ').trim().split(' ');
  const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) { lines.push(cur.trim()); cur = w; }
    else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.map(l => indent + l).join('\n');
}

/**
 * Build the record. Takes the SAME inputs as analyze() so the memo can never describe a
 * different question than the one that was answered — it runs the analysis itself rather than
 * being handed a result to narrate.
 */
export function buildMemo(entity, data, context, opts) {
  // TOTAL AT THE OUTERMOST SURFACE. A parameter default covers `undefined` ONLY, so destructuring
  // or reading a null argument throws — the same non-totality found in computeDeadline, in
  // preemption.resolve() and in all four workflows. This is the layer a caller touches first and
  // a null argument is a caller mistake that should produce a refusal saying so, never a stack
  // trace out of a document generator.
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  entity = obj(entity); data = obj(data); context = obj(context); opts = obj(opts);
  const r = analyze(entity, data, context);
  const corpus = load();
  const generated = opts.generated_at ?? new Date().toISOString();
  if (r.error) return { error: r.error, markdown: `# Analysis refused\n\n${r.error}\n`, result: r };

  const assertedFacts = [];
  for (const [ns, obj] of Object.entries({ entity, data, event: context.event ?? {},
                                           practice: context.practice ?? {},
                                           purpose: context.purpose ?? {}, law: context.law ?? {} }))
    for (const [k, v] of Object.entries(obj ?? {}))
      assertedFacts.push({ key: `${ns}.${k}`, value: v });

  const byInstrument = {};
  for (const hit of r.applicable) (byInstrument[hit.instrument_id] ??= []).push(hit);

  const started = r.deadlines.filter(d => d.computed)
    .sort((x, y) => x.computed.localeCompare(y.computed));
  const notStarted = r.deadlines.filter(d => !d.computed);
  const openChars = (r.characterisation_required ?? []).filter(x => x.alternative_description);

  // ---------------------------------------------------------------- markdown
  const L = [];
  L.push(`# Privacy obligations as of ${r.as_of}`);
  L.push('');
  L.push(`Generated ${generated} · corpus ${corpus.all.length} records · engine ${opts.version ?? 'privacy-kb'}`);
  if (opts.matter) L.push(`Matter: ${esc(opts.matter)}`);
  L.push('');
  L.push('> **This is a research prototype, not legal advice.** Every provision below carries its');
  L.push('> source URL and the sha256 of the bytes it was quoted from. Check them before relying');
  L.push('> on any sentence here. Sections 5 and 6 state what this analysis could NOT determine —');
  L.push('> read them before treating any part of it as complete.');
  L.push('');

  L.push('## 1. The question');
  L.push('');
  L.push(`Law as of **${r.as_of}**.` + (context.state_layers?.length
    ? ` State layers asserted: ${context.state_layers.join(', ')}.` : ' No state layer asserted.'));
  L.push('');
  L.push('| Fact asserted | Value |');
  L.push('|---|---|');
  for (const f of assertedFacts) L.push(`| \`${esc(f.key)}\` | ${esc(JSON.stringify(f.value))} |`);
  if (!assertedFacts.length) L.push('| _(none)_ | |');
  L.push('');
  for (const w of r.fact_warnings ?? []) {
    L.push(`> **Reading of \`${esc(w.supplied)}\`.** ${esc(w.note)}`);
    if (w.expanded_to?.length) L.push(`> Assumed: ${w.expanded_to.map(x => '`' + x + '`').join(', ')}.`);
    L.push('');
  }

  L.push('## 2. What applies');
  L.push('');
  if (!r.applicable.length) L.push('_No sectoral obligation matched these facts. See section 4 — the backstops are never empty._');
  // NOTE THE LOOP VARIABLES: never `o`, `c`, `a`, `rec` or `atom`. tools/check-engine-schema.mjs
  // reads those names as CORPUS RECORD accesses and reported this file as depending on record
  // fields named atom_id, citation and partial_carve_out — which are engine-OUTPUT fields, not
  // record fields. mcp/server.mjs and engine/facts.mjs carry the same note. Rename the variable,
  // never the check.
  for (const [inst, list] of Object.entries(byInstrument)) {
    L.push(`### ${inst}`);
    L.push('');
    for (const hit of list) {
      const src = corpus.byId.get(hit.atom_id);
      L.push(`**${esc(hit.citation)}**`);
      L.push('');
      if (src?.summary) { L.push(esc(src.summary)); L.push(''); }
      if (src?.verbatim_span) { L.push(wrap(src.verbatim_span)); L.push(''); }
      const prov = src?.source ?? {};
      L.push(`- source: ${b(prov.url) || 'n/a'}`);
      L.push(`- fetched ${b(prov.fetched) || 'n/a'} · sha256 \`${b(prov.raw_sha256 ?? prov.text_sha256).slice(0, 16)}…\``);
      L.push(`- in force ${b(src?.effective_from) || '?'} → ${b(src?.effective_to) || 'present'}`
           + ` · vintage basis: \`${b(src?.effective_from_basis) || 'undeclared'}\``);
      L.push(`- verify: \`privacy-kb cite ${hit.atom_id}\``);
      if (hit.partial_carve_out) L.push(`- **carve-out applies**: ${esc(hit.partial_carve_out.note)}`);
      L.push('');
    }
  }

  L.push('## 3. Deadlines');
  L.push('');
  if (started.length) {
    L.push('| Due | Clock | Provision | Runs from |');
    L.push('|---|---|---|---|');
    for (const d of started)
      L.push(`| **${b(d.computed)}** | ${esc(d.duration)} | ${esc(d.citation ?? d.atom_id)} | ${esc(d.trigger_label ?? d.trigger_event)} |`);
    L.push('');
    // ONE NOTE PER DISTINCT CAUTION, not one per row. Repeating the same sentence under five
    // deadlines trains a reader to skip the block where the one caution that differs is sitting.
    const fam = started.filter(d => d.trigger_via === 'family');
    if (fam.length) {
      const key = fam[0].trigger_supplied_as;
      L.push(`> **Dated by family key.** ${fam.length} clock(s) were dated from \`${esc(key)}\` rather than`);
      L.push(`> from an assertion about each statute's own trigger: ${fam.map(d => esc(d.citation)).join(', ')}.`);
      L.push(`> Each statute defines that moment for itself. Confirm they coincide before relying on the dates.`);
      L.push('');
    }
    const dual = started.filter(d => d.caution);
    if (dual.length) {
      L.push(`> **Dual standard.** ${dual.map(d => esc(d.citation)).join(', ')} — the computed date is an`);
      L.push('> OUTER LIMIT, not an allowance. Delay short of it can still breach the promptness obligation.');
      L.push('');
    }
    const bd = started.filter(d => d.business_day_basis);
    if (bd.length) {
      L.push(`> **Business days.** ${bd.map(d => esc(d.citation)).join(', ')} — weekdays only; public`);
      L.push('> holidays are NOT excluded, so these dates may fall EARLIER than the true deadline.');
      L.push('');
    }
  } else {
    L.push('_No clock has started on the facts asserted._');
    L.push('');
  }
  if (notStarted.length) {
    L.push('**Clocks not started** — these duties apply, but no date was supplied for their trigger:');
    L.push('');
    for (const d of notStarted)
      L.push(`- ${esc(d.citation ?? d.atom_id)} — supply \`event.${b(d.trigger_key) || '?'}\``);
    L.push('');
  }

  L.push('## 4. Enforcement exposure and backstops');
  L.push('');
  for (const e of r.enforcement_summary ?? [])
    L.push(`- **${esc(e.enforcer)}**${e.private_right_of_action ? ' · private right of action' : ' · no private right of action'}`);
  L.push('');
  L.push('These never switch off, whatever else applies:');
  L.push('');
  for (const x of r.backstops ?? []) L.push(`- ${esc(x.citation ?? x.kind)}`);
  L.push('');

  L.push('## 5. Decisions this analysis did not make');
  L.push('');
  if (openChars.length) {
    L.push('The incident was characterised one way. On the SAME facts, each of the following');
    L.push('duties attaches if it is also characterised as shown. These are legal determinations');
    L.push('with their own tests — the engine surfaces them rather than deciding them.');
    L.push('');
    for (const open of openChars) {
      L.push(`- **${esc(open.citation)}** — requires: ${open.requires_characterisation.map(x => `_${esc(incidentLabel(x))}_`).join(' or ')}`
        + (open.deadline_if_engaged ? ` · would start a ${b(open.deadline_if_engaged.duration?.value)} ${b(open.deadline_if_engaged.duration?.unit)} clock from ${esc(triggerLabel(open.deadline_if_engaged.trigger_event))}` : ''));
      for (const test of open.determined_by ?? []) L.push(`  - decided by: ${esc(test)}`);
    }
    L.push('');
  } else {
    L.push('_None outstanding._');
    L.push('');
  }

  L.push('## 6. What this analysis could not determine');
  L.push('');
  const gaps = r.coverage_gaps ?? [];
  if (gaps.length) {
    L.push('**Coverage.** The corpus does not hold everything a complete answer would need:');
    L.push('');
    for (const g of gaps) L.push(`- ${esc(typeof g === 'string' ? g : JSON.stringify(g))}`);
    L.push('');
  }
  const incomplete = r.applicable.filter(hit => hit.instrument_completeness);
  if (incomplete.length) {
    L.push('**Partially extracted instruments.** These answered, over a substantive void:');
    L.push('');
    for (const gap of incomplete)
      for (const miss of gap.instrument_completeness.absent ?? [])
        L.push(`- ${esc(gap.instrument_id)}: missing \`${esc(miss.id)}\``);
    L.push('');
  }
  if ((r.unverified_excluded ?? []).length) {
    L.push(`**Suppressed as unverified.** ${r.unverified_excluded.length} record(s) were withheld under invariant I1 because their text is not confirmed against a source. They are not in the answer above.`);
    L.push('');
  }
  const unknown = r.unknown_facts ?? [];
  if (unknown.length) {
    // GROUPED BY THE FACT THAT WOULD RESOLVE THEM, not listed by obligation. A list of 152
    // citations is unreadable and unactionable; "tell me whether you are a cable operator and
    // five of these resolve" is the question a lawyer can actually answer. Sorted by how much
    // each fact would settle, so the cheapest wins come first.
    const byFact = new Map();
    for (const u of unknown) {
      const k = (String(u.needs ?? '').match(/([a-z_]+\.[A-Za-z0-9_.]+)/) ?? [null, u.needs])[1];
      if (!byFact.has(k)) byFact.set(k, []);
      byFact.get(k).push(u.citation);
    }
    const ranked = [...byFact.entries()].sort((lhs, rhs) => rhs[1].length - lhs[1].length);
    L.push(`**Facts never supplied.** ${unknown.length} obligation(s) could not be resolved either`);
    L.push('way. Each is a dormant duty awaiting a fact, NOT a finding that it does not apply.');
    L.push(`Supplying these ${ranked.length} facts would settle them:`);
    L.push('');
    L.push('| Supply this fact | Resolves | Example provision |');
    L.push('|---|---|---|');
    for (const [k, cites] of ranked.slice(0, 20))
      L.push(`| \`${esc(k)}\` | ${cites.length} | ${esc(cites[0])} |`);
    if (ranked.length > 20) L.push(`| _…${ranked.length - 20} more_ | | |`);
    L.push('');
    L.push('`privacy-kb facts <search>` describes any of these keys.');
    L.push('');
  }

  L.push('## 7. Verification');
  L.push('');
  L.push('Every provision above can be re-checked without trusting this document:');
  L.push('');
  L.push('| Provision | Record id | sha256 of source bytes |');
  L.push('|---|---|---|');
  for (const hit of r.applicable) {
    const src = corpus.byId.get(hit.atom_id);
    L.push(`| ${esc(hit.citation)} | \`${esc(hit.atom_id)}\` | \`${b(src?.source?.raw_sha256 ?? src?.source?.text_sha256).slice(0, 32)}\` |`);
  }
  L.push('');
  L.push('`privacy-kb cite <record id>` returns the verbatim span with its URL and hash, or fails.');
  L.push('If it fails, the citation does not exist and nothing above should be relied on.');
  L.push('');

  return {
    markdown: L.join('\n'),
    result: r,
    record: {
      generated_at: generated,
      as_of: r.as_of,
      matter: opts.matter ?? null,
      facts_asserted: assertedFacts,
      fact_warnings: r.fact_warnings ?? [],
      applicable: r.applicable.map(hit => {
        const src = corpus.byId.get(hit.atom_id);
        return { atom_id: hit.atom_id, citation: hit.citation, instrument_id: hit.instrument_id,
                 source_url: src?.source?.url ?? null,
                 sha256: src?.source?.raw_sha256 ?? src?.source?.text_sha256 ?? null,
                 fetched: src?.source?.fetched ?? null,
                 effective_from: src?.effective_from ?? null,
                 effective_to: src?.effective_to ?? null,
                 effective_from_basis: src?.effective_from_basis ?? null };
      }),
      deadlines: r.deadlines,
      characterisation_required: r.characterisation_required ?? [],
      coverage_gaps: r.coverage_gaps ?? [],
      unknown_facts_count: (r.unknown_facts ?? []).length,
      unverified_excluded: r.unverified_excluded ?? [],
      corpus_records: corpus.all.length,
    },
  };
}
