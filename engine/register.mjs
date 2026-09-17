// THE STANDING OBLIGATION REGISTER — what applies, and what you can show for it.
//
// Surveys of privacy functions in 2026 report the same two things: teams shrinking (a median of
// eight to five in a year, with technical roles hit hardest) against an expanding set of
// jurisdictions, and regulators who increasingly want to see "documentation that reflects real
// practices" rather than a policy binder. Those pull in opposite directions, and the artifact that
// resolves them is a register: every obligation that applies, what it requires, when its clock
// runs, and what evidence exists for it.
//
// THE COLUMN THAT MATTERS IS THE EMPTY ONE. A register listing 34 duties with nothing attached to
// any of them is a to-do list; a register listing 34 duties with 3 evidenced and 31 not is a
// finding. So evidence is bound explicitly, counted, and the unevidenced rows are reported as a
// number rather than left to be noticed — the same discipline the corpus applies to its own
// coverage gaps, turned on the user's compliance instead of on the law.
//
// It asserts nothing about whether the evidence is any good. Binding a file to an obligation
// records that someone said this document is the answer to that duty; whether it IS is a reading,
// and engine/conform.mjs is the tool for working through that one requirement at a time.
import { load } from './corpus.mjs';
import { analyze } from './applicability.mjs';
import { instrumentCoverage } from './coverage.mjs';
import { triggerLabel } from './triggers.mjs';
import { isRealDate, badDateReason } from './dates.mjs';
import { profileDir, readProfile } from './profiles.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * Evidence lives beside the profiles, not in the corpus.
 *
 * A customer's document is not evidence about the law and must never enter a provenance chain.
 * The corpus stays a statement about statutes; this file stays a statement about one organisation.
 */
export function evidencePath() {
  return join(profileDir(), 'evidence.yaml');
}

export function readEvidence() {
  const file = evidencePath();
  if (!existsSync(file)) return {};
  try { return yaml.load(readFileSync(file, 'utf8'))?.evidence ?? {}; }
  catch { return {}; }
}

/** Bind a document to an obligation. Returns what was written, never what it proves. */
export function bindEvidence(atomId, record) {
  const id = norm(atomId);
  if (!id) return { bound: false, error: 'give an obligation id to bind evidence to' };
  const dir = profileDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const held = readEvidence();
  held[id] = {
    document: norm(record?.document) || null,
    note: norm(record?.note) || null,
    owner: norm(record?.owner) || null,
    reviewed: norm(record?.reviewed) || new Date().toISOString().slice(0, 10),
  };
  writeFileSync(evidencePath(), yaml.dump({ version: 1, evidence: held },
    { lineWidth: 96, sortKeys: true }), 'utf8');
  return { bound: true, atom_id: id, file: evidencePath(), entry: held[id],
    note: 'Recorded that this document is offered for this obligation. Whether it SATISFIES the '
      + 'obligation is a reading this engine does not make — see conform.' };
}

export function unbindEvidence(atomId) {
  const id = norm(atomId);
  const held = readEvidence();
  if (!(id in held)) return { unbound: false, error: `no evidence bound to "${id}"` };
  delete held[id];
  writeFileSync(evidencePath(), yaml.dump({ version: 1, evidence: held },
    { lineWidth: 96, sortKeys: true }), 'utf8');
  return { unbound: true, atom_id: id };
}

/**
 * Build the register for a set of facts, as of a date.
 *
 * Total on null at the outermost surface: a null anywhere returns a shaped, empty result with the
 * reason rather than throwing out of a document generator.
 */
export function register(entity, data, context, corpus) {
  const kb = corpus ?? load();
  entity = entity ?? {}; data = data ?? {}; context = context ?? {};
  const asOf = context.as_of ?? null;

  const empty = { as_of: asOf, rows: [], summary: null, coverage_gaps: [], error: null };
  if (!asOf) return { ...empty, error: 'an as-of date is required — there is no "current law"' };
  if (!isRealDate(asOf)) return { ...empty, error: badDateReason('as_of', asOf) };

  const result = analyze(entity, data, context);
  if (result.error) return { ...empty, error: result.error };

  const evidence = readEvidence();
  const byId = new Map((result.obligations ?? []).map(held => [held.id, held]));
  const deadlineFor = new Map((result.deadlines ?? []).map(row => [row.atom_id, row]));

  const rows = [];
  for (const entry of (result.applicable ?? [])) {
    const held = byId.get(entry.atom_id) ?? kb.byId?.get(entry.atom_id) ?? null;
    const clock = deadlineFor.get(entry.atom_id) ?? null;
    const bound = evidence[entry.atom_id] ?? null;
    rows.push({
      atom_id: entry.atom_id,
      citation: entry.citation ?? held?.source?.citation ?? null,
      instrument_id: entry.instrument_id ?? held?.source?.instrument_id ?? null,
      requirement: norm(held?.summary ?? held?.requirement_detail ?? '').slice(0, 300) || null,
      obligation_type: held?.obligation_type ?? null,
      // THE CLOCK COMES FROM result.deadlines, NOT FROM THE OBLIGATION. result.obligations is a
      // projection with no deadline field, so reading the trigger off it reported every duty in
      // the register as having no fixed period — including four HIPAA clocks and a SHIELD clock
      // that were running.
      trigger: clock?.trigger_event ?? null,
      trigger_label: clock?.trigger_label ?? (clock?.trigger_event ? triggerLabel(clock.trigger_event) : null),
      // A CLOCK THAT HAS NOT STARTED IS NOT A CLOCK WITH NO DEADLINE. The distinction is carried
      // through to the register, because a blank due-date column reads as "nothing to do".
      due: clock?.computed ?? null,
      governing_language: norm(clock?.governing_language).slice(0, 200) || null,
      clock_status: clock?.computed ? 'running' : (clock ? 'not_started' : 'no_fixed_period'),
      source_url: held?.source?.url ?? null,
      source_sha256: held?.source?.raw_sha256 ?? null,
      evidence: bound,
      evidenced: Boolean(bound),
    });
  }
  rows.sort((left, right) => String(left.citation ?? '').localeCompare(String(right.citation ?? '')));

  // Evidence bound to something that does not apply is worth surfacing: it is usually a fact that
  // moved, and it reads as coverage when it is not.
  const applicableIds = new Set(rows.map(row => row.atom_id));
  const orphaned = Object.keys(evidence).filter(id => !applicableIds.has(id));

  const evidenced = rows.filter(row => row.evidenced).length;
  const thin = [];
  for (const instrumentId of [...new Set(rows.map(row => row.instrument_id).filter(Boolean))]) {
    const cov = instrumentCoverage(instrumentId, kb);
    for (const entry of (cov.element_coverage?.thin ?? []))
      thin.push({ instrument_id: instrumentId, ...entry });
  }

  return {
    as_of: asOf,
    rows,
    summary: {
      obligations: rows.length,
      evidenced,
      // THE HEADLINE NUMBER IS THE GAP, not the coverage. A register exists to show what is not
      // there; leading with "3 evidenced" invites reading it as progress.
      unevidenced: rows.length - evidenced,
      clocks_running: rows.filter(row => row.clock_status === 'running').length,
      clocks_not_started: rows.filter(row => row.clock_status === 'not_started').length,
      no_fixed_period: rows.filter(row => row.clock_status === 'no_fixed_period').length,
      evidence_bound_to_inapplicable: orphaned.length,
    },
    orphaned_evidence: orphaned,
    element_shortfall: thin,
    coverage_gaps: result.coverage_gaps ?? [],
    error: null,
    caveat:
      'EVIDENCE HERE MEANS SOMEONE OFFERED A DOCUMENT, not that the document satisfies the duty. '
      + 'Whether it does is a reading, and this engine does not make readings — conform lays a '
      + "provision's elements beside a document for that. The register also shows only obligations "
      + 'this corpus HOLDS: coverage gaps and element shortfall are reported alongside it, because '
      + 'a register that is complete against a partial corpus is not complete.',
  };
}

/** The register for a saved profile, so a standing fact set does not have to be retyped. */
export function registerForProfile(name, asOf, corpus) {
  const kb = corpus ?? load();
  const profile = readProfile(name);
  if (!profile.found) return { as_of: asOf ?? null, rows: [], summary: null, error: profile.error };
  const facts = profile.facts ?? {};
  return {
    profile: profile.name,
    ...register(facts.entity ?? {}, facts.data ?? {}, {
      as_of: asOf, state_layers: profile.state_layers ?? [],
      event: facts.event ?? {}, practice: facts.practice ?? {},
      purpose: facts.purpose ?? {}, law: facts.law ?? {},
    }, kb),
  };
}

/**
 * A CSV cell, neutralised against formula injection.
 *
 * A register is meant to be opened in a spreadsheet, and a cell beginning =, +, -, @, tab or CR is
 * evaluated as a formula by Excel and Sheets — `=cmd|calc` is the classic DDE payload. The values
 * here come from statutory text, so the risk is small today and structural tomorrow: the moment a
 * user-supplied note or document name reaches a cell, an exported register becomes an execution
 * vector. Prefixing an apostrophe is the standard mitigation and is stripped on display.
 */
const csvCell = value => {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** CSV, because a register is a thing people put in a spreadsheet and hand to an auditor. */
export function registerCsv(built) {
  built = built ?? {};
  const header = ['citation', 'instrument', 'requirement', 'trigger', 'clock', 'due',
                  'evidence_document', 'evidence_owner', 'evidence_reviewed', 'source_url',
                  'source_sha256', 'atom_id'];
  const lines = [header.join(',')];
  for (const row of (built.rows ?? [])) lines.push([
    row.citation, row.instrument_id, row.requirement, row.trigger_label ?? row.trigger,
    row.clock_status, row.due, row.evidence?.document, row.evidence?.owner,
    row.evidence?.reviewed, row.source_url, row.source_sha256, row.atom_id,
  ].map(csvCell).join(','));
  return lines.join('\n');
}

/** Markdown, for the version that goes in a document rather than a spreadsheet. */
export function registerMarkdown(built, title) {
  built = built ?? {};
  const lines = [];
  lines.push(`# Obligation register — ${title ?? built.profile ?? 'these facts'}`);
  lines.push('');
  if (built.error) { lines.push(`**Refused:** ${built.error}`); return lines.join('\n'); }

  const sum = built.summary ?? {};
  lines.push(`As of **${built.as_of}** · ${sum.obligations} obligation(s) · `
    + `**${sum.unevidenced} with no evidence bound** · ${sum.clocks_running} clock(s) running`);
  lines.push('');
  lines.push('> A blank evidence column is the point of this document. Evidence here means a');
  lines.push('> document was offered for an obligation, never that it satisfies one.');
  lines.push('');
  lines.push('| Citation | Requires | Clock | Due | Evidence |');
  lines.push('|---|---|---|---|---|');
  for (const row of (built.rows ?? [])) {
    const clock = row.clock_status === 'running' ? 'running'
      : row.clock_status === 'not_started' ? '**not started**' : 'no fixed period';
    lines.push(`| \`${row.citation ?? row.atom_id}\` | ${(row.requirement ?? '').slice(0, 120)} `
      + `| ${clock} | ${row.due ?? '—'} | ${row.evidence?.document ?? '**—**'} |`);
  }
  lines.push('');

  if (built.orphaned_evidence?.length) {
    lines.push(`## Evidence bound to obligations that do not apply — ${built.orphaned_evidence.length}`);
    lines.push('');
    lines.push('Usually a fact that moved. It reads as coverage and is not.');
    lines.push('');
    for (const id of built.orphaned_evidence) lines.push(`- \`${id}\``);
    lines.push('');
  }

  if (built.element_shortfall?.length) {
    lines.push('## What this corpus holds only partly');
    lines.push('');
    for (const entry of built.element_shortfall.slice(0, 12))
      lines.push(`- \`${entry.prefix}\` — ${entry.held} of ${entry.expected} elements beneath it`);
    lines.push('');
  }

  if (built.coverage_gaps?.length) {
    lines.push('## Coverage gaps reported with this answer');
    lines.push('');
    for (const line of built.coverage_gaps) lines.push(`- ${line}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(built.caveat ?? '');
  return lines.join('\n');
}
