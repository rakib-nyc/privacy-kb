#!/usr/bin/env node
// THE DELIVERABLE LAYER — the memo, the input vocabulary, and the workflows.
//
// These test the properties that make an artifact safe to hand to someone, which are not the
// same as the properties that make an analysis correct:
//
//   * every quotation must be re-verifiable WITHOUT trusting this tool — URL, hash, vintage
//   * the BOUNDARY must be stated as prominently as the findings. A memo that reports only what
//     it found reads identically whether it examined everything or almost nothing, and
//     *United States v. Farris* turned on counsel being unable to show what had been checked
//   * an artifact must never claim a completeness it does not have
//   * the input vocabulary must be discoverable, because 127 keys gated the corpus with no way
//     to learn any of them and "we are a HIPAA covered entity" returned 10, 3 or 13 obligations
//     depending on which spelling was guessed
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { buildMemo } from '../engine/memo.mjs';
import { normaliseFacts, factInventory, AMBIGUOUS_TERMS } from '../engine/facts.mjs';
import { load } from '../engine/corpus.mjs';
import { call, TOOLS } from '../mcp/server.mjs';
import { WORKFLOWS } from '../workflows/index.mjs';

const ROOT = resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  cond ? pass++ : fail++;
};
const cli = (...args) => {
  try { return execFileSync('node', [resolve(ROOT, 'bin/privacy-kb.mjs'), ...args],
    { cwd: ROOT, encoding: 'utf8' }).replace(/\x1b\[[0-9;]*m/g, ''); }
  catch (e) { return ((e.stdout ?? '') + (e.stderr ?? '')).replace(/\x1b\[[0-9;]*m/g, ''); }
};

const CE = { is_hipaa_covered_entity: true, owns_or_licenses_computerized_data: true,
             within_ftc_jurisdiction: true, in_or_affecting_commerce: true, nexus: 'US-NY' };
const PHI = { is_phi: true, types: ['phi'], includes_ny_private_information: true };
const BREACH = ['breach_of_unsecured_phi', 'breach_of_security_of_the_system'];
const CTX = { as_of: '2026-09-10', state_layers: ['US-NY'],
              event: { type: BREACH, breach_discovery: '2026-08-01' } };

// ---------------------------------------------------------------- 1. the memo
{
  const m = buildMemo(CE, PHI, CTX, { matter: 'Test matter' });
  const md = m.markdown;
  ok('the memo builds', !!md && !m.error);
  ok('...and states the as-of date in its title', /# Privacy obligations as of 2026-09-10/.test(md));
  ok('...and carries the matter reference', /Matter: Test matter/.test(md));

  // THE QUESTION. A record that does not show what it was asked cannot be checked.
  ok('every asserted fact is echoed back', md.includes('entity.is_hipaa_covered_entity')
     && md.includes('data.includes_ny_private_information') && md.includes('event.breach_discovery'));

  // THE FINDINGS, each independently verifiable.
  for (const hit of m.record.applicable) {
    ok(`${hit.citation} carries a source URL`, !!hit.source_url, hit.atom_id);
    ok(`${hit.citation} carries a source hash`, !!hit.sha256 && hit.sha256.length >= 32);
    ok(`${hit.citation} declares what KIND of date its vintage is`, !!hit.effective_from_basis);
  }
  ok('the verification table lists every applicable provision',
     m.record.applicable.every(hit => md.includes(hit.atom_id)));
  ok('...and tells the reader how to re-check without trusting this document',
     /privacy-kb cite/.test(md) && /If it fails, the citation does not exist/.test(md));

  // THE BOUNDARY. This is the half that makes it defensible.
  ok('the memo always states what it could not determine', /## 6\. What this analysis could not determine/.test(md));
  ok('...including the facts that were never supplied', /Facts never supplied/.test(md));
  ok('...grouped by the fact that would resolve them, not listed by citation',
     /\| Supply this fact \| Resolves \|/.test(md));
  ok('...and coverage gaps where the corpus is short', /Coverage\./.test(md));
  ok('a dual-standard deadline is flagged as an outer limit, not an allowance',
     /OUTER LIMIT, not an allowance/.test(md));
  ok('a family-dated clock is disclosed as an inference', /Dated by family key/.test(md));

  // The earliest clock must be the state one — the whole point of the event-model fix.
  const due = [...md.matchAll(/\| \*\*(\d{4}-\d{2}-\d{2})\*\* \| [^|]+ \| ([^|]+) \|/g)];
  ok('the deadline table is sorted earliest first',
     due.every((row, i) => i === 0 || due[i - 1][1] <= row[1]));
  ok('...and the earliest deadline is the New York clock', /899-aa\(2\)/.test(due[0]?.[2] ?? ''),
     `${due[0]?.[1]} ${due[0]?.[2]}`);

  // A memo whose analysis was refused must not render findings.
  const bad = buildMemo(CE, PHI, { ...CTX, as_of: '2026-02-30' });
  ok('an impossible as_of refuses rather than rendering a memo', !!bad.error);
  ok('...and the refusal does not smuggle out an applicable list',
     !(bad.record?.applicable ?? []).length);
}

// Section 5 must appear when a characterisation is left open — that is the silent-omission fix.
{
  const narrow = buildMemo(CE, PHI, { ...CTX, event: { type: 'breach_of_unsecured_phi', breach_discovery: '2026-08-01' } });
  ok('a narrowed characterisation surfaces as a decision not made',
     /## 5\. Decisions this analysis did not make/.test(narrow.markdown)
     && /899-aa\(2\)/.test(narrow.markdown.split('## 5.')[1].split('## 6.')[0]));
  ok('...naming the test that decides it, so the engine is not making the call',
     /decided by:/.test(narrow.markdown));
  ok('...and it is recorded in the JSON too', narrow.record.characterisation_required.length > 0);
}

// ---------------------------------------------------------------- 2. the vocabulary
{
  const inv = factInventory(load());
  ok('the fact inventory is derived from the corpus', inv.length > 100, `${inv.length} keys`);
  ok('...and every entry names its namespace and what it gates',
     inv.every(k => !!k.namespace && typeof k.gates_obligations === 'number'));
  ok('...and flags keys reachable ONLY through an exemption',
     inv.some(k => k.exemption_only));

  // The two synonym traps, which cost 7 and 4 obligations respectively.
  const hip = normaliseFacts({ entity: { hipaa_role: 'covered_entity' } });
  ok('the old HIPAA spelling still resolves', hip.facts.entity.is_hipaa_covered_entity === true);
  ok('...and the reading is disclosed', hip.warnings.some(w => w.kind === 'alias'));
  const fin = normaliseFacts({ entity: { is_financial_institution: true } });
  ok('an ambiguous term expands to every statutory population it covers',
     ['glba', 'rfpa', 'bsa'].every(p => fin.facts.entity[`${p}_financial_institution`] === true));
  ok('...and says so, with the definitions', fin.warnings.some(w => w.kind === 'ambiguous_term'
     && Object.keys(w.definitions ?? {}).length === 3));
  ok('...because those are three different populations',
     /not one population/.test(AMBIGUOUS_TERMS['entity.is_financial_institution'].caution));

  // One key must now return a whole rule. It used to take two, and nothing said so.
  const glba = call('privacy_analyze', { entity: { glba_financial_institution: true,
    has_information_systems: true, within_ftc_jurisdiction: true, in_or_affecting_commerce: true },
    data: { is_nonpublic_personal_information: true }, as_of: '2026-09-10' });
  ok('one GLBA key returns the whole Safeguards Rule',
     glba.applicable.filter(hit => /314\./.test(hit.citation)).length >= 5,
     `${glba.applicable.filter(hit => /314\./.test(hit.citation)).length} of 5`);
  ok('normaliseFacts never mutates its input', (() => {
    const src = { entity: { hipaa_role: 'covered_entity' } };
    normaliseFacts(src);
    return Object.keys(src.entity).length === 1;
  })());
}

// ---------------------------------------------------------------- 3. reachability
// Four workflows existed and were reachable from NOWHERE — not the CLI, not MCP. A deliverable
// nobody can invoke is not a feature.
{
  ok('every workflow is reachable over MCP', Object.keys(WORKFLOWS).every(name =>
    !call('privacy_workflow', { workflow: name, context: { as_of: '2026-09-10' } }).error));
  ok('an unknown workflow name errors and lists the real ones',
     /no workflow named/.test(call('privacy_workflow', { workflow: 'nope' }).error ?? ''));
  ok('the memo tool is exposed', TOOLS.some(t => t.name === 'privacy_memo'));
  ok('the facts tool is exposed', TOOLS.some(t => t.name === 'privacy_facts'));
  ok('the incidents tool is exposed', TOOLS.some(t => t.name === 'privacy_incidents'));

  // And the CLI surfaces a lawyer actually types.
  ok('privacy-kb breach produces a timeline', /Breach notification timeline/.test(
     cli('breach', '--hipaa', '--ny-data', '--breach', '--from', '2026-08-01')));
  ok('...with both regimes from a single --breach flag', (() => {
    const out = cli('breach', '--hipaa', '--ny-data', '--breach', '--from', '2026-08-01');
    return out.includes('899-aa(2)') && /164\.40[468]/.test(out);
  })());
  ok('...and narrowing with --as reports the duty it drops', (() => {
    const out = cli('breach', '--hipaa', '--ny-data', '--breach', '--as', 'breach_of_unsecured_phi',
                    '--from', '2026-08-01');
    return out.includes('Not yet characterised') && out.includes('899-aa(2)')
        && out.includes('THIS TIMELINE IS INCOMPLETE');
  })());
  ok('privacy-kb facts lists the input vocabulary', /fact keys/.test(cli('facts')));
  ok('...and searches it', cli('facts', 'hipaa').includes('is_hipaa_covered_entity'));
  ok('privacy-kb incidents explains one event, several descriptions',
     /security_incident/.test(cli('incidents')));
  ok('privacy-kb memo renders a document', /# Privacy obligations as of/.test(
     cli('memo', '--hipaa', '--ny-data', '--breach', '--from', '2026-08-01')));
}

console.log(`\n${fail} failure(s)`);
process.exit(fail ? 1 : 0);
