// COVERAGE IS DECLARED, NEVER INFERRED FROM PRESENCE.
//
// The bug this file exists to prevent: `corpus.obligations.some(a => a.jurisdiction === j)`.
// It reads as "do we cover New York" and answers "is there at least one New York record".
// Three GBL § 349 UDAP atoms made it return true while GBL § 899-aa — the breach clock a
// practitioner asks for when they ask for the state layer — was absent. The gap vanished the
// moment a single atom of ANY kind landed, and the failure was silent and in the confident
// direction: not "we don't know", but nothing at all.
//
// So the expected instruments are declared in meta/jurisdiction-coverage.yaml, transcribed
// from CORPUS-MANIFEST.md, and coverage is a comparison against that declaration. A missing
// instrument is named, with the duty classes it would have supplied.
//
// Covering a jurisdiction is not covering a duty.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';

const FILE = resolve(import.meta.dirname, '../meta/jurisdiction-coverage.yaml');
const IFILE = resolve(import.meta.dirname, '../meta/instrument-coverage.yaml');
let DECL = null;
function decl() {
  if (DECL) return DECL;
  DECL = existsSync(FILE) ? (yaml.load(readFileSync(FILE, 'utf8'))?.jurisdictions ?? {}) : {};
  return DECL;
}

export function declaredJurisdictions() { return Object.keys(decl()); }

let IDECL = null;
function idecl() {
  if (IDECL) return IDECL;
  IDECL = existsSync(IFILE) ? (yaml.load(readFileSync(IFILE, 'utf8'))?.instruments ?? {}) : {};
  return IDECL;
}
export function declaredInstruments() { return Object.keys(idecl()); }

/**
 * What an instrument holds, measured against the duty categories it is SUPPOSED to hold.
 *
 * jurisdiction-coverage closed this hole one level up and left this one open, and this one is
 * worse because it is architecturally invisible: every atom is correct, every gate passes, the
 * engine behaves as designed. FCRA is the case — the corpus holds 15 U.S.C. § 1681t and nothing
 * else, so a consumer-reporting-agency query returned confident preemption analysis over a
 * substantive void with nothing in the output signalling the void. "Has preemption atoms" and
 * "can answer questions about this instrument" are different claims.
 */
// NOTE the variable naming: declaration entries are `cat`, never `a`. Gate 22 reads `a.x` as a
// record-field access, and a declaration field that happens to share the shape of a record read
// is exactly the ambiguity that check exists to refuse. Rename the variable, never the check.
export function instrumentCoverage(instrumentId, corpus) {
  const d = idecl()[instrumentId];
  const cites = (corpus.obligations ?? [])
    .filter(a => a.source?.instrument_id === instrumentId)
    .map(a => a.source?.citation).filter(Boolean);
  if (!d) {
    return { instrument_id: instrumentId, declared: false, complete: false,
      present: [], absent: [], obligations: cites.length,
      summary: `${instrumentId} has NO coverage declaration in meta/instrument-coverage.yaml, so ` +
        `whether the corpus can answer questions about it is UNKNOWN. The ${cites.length} ` +
        `obligation(s) present do not establish otherwise.` };
  }
  const cats = d.categories ?? [];
  const hit = cat => (cat.citation_prefix ?? []).some(pre => cites.some(x => x.startsWith(pre)));
  const present = cats.filter(hit), absent = cats.filter(cat => !hit(cat));
  return { instrument_id: instrumentId, declared: true, complete: absent.length === 0,
    title: d.title ?? instrumentId, present, absent, obligations: cites.length,
    summary: absent.length === 0
      ? `${d.title ?? instrumentId}: all ${cats.length} declared duty categories are present.`
      : `${d.title ?? instrumentId} is PARTIALLY EXTRACTED — ${present.length} of ${cats.length} duty ` +
        `categories present. This analysis is correct as far as it goes and CANNOT reach: ` +
        absent.map(cat => `${cat.id} (${(cat.citation_prefix ?? []).join(', ')}) — ${cat.supplies}`).join('; ') +
        '. Treat those questions as unanswered rather than as answered in the negative.' };
}

/** What the corpus holds for a jurisdiction, measured against what it is supposed to hold. */
export function coverageFor(jurisdiction, corpus) {
  const d = decl()[jurisdiction];
  const held = new Set((corpus.obligations ?? [])
    .filter(a => a.jurisdiction === jurisdiction)
    .map(a => a.source?.instrument_id).filter(Boolean));

  if (!d) {
    // No declaration is NOT an all-clear. It means nobody has said what this jurisdiction
    // needs, so nothing can be reported as covered.
    return { jurisdiction, declared: false, expected: [], present: [], missing: [],
             atoms_present: held.size,
             summary: `${jurisdiction} has NO coverage declaration in meta/jurisdiction-coverage.yaml. ` +
               `Coverage is UNKNOWN, not complete` +
               (held.size ? `, and the ${held.size} instrument(s) present do not establish otherwise.` : '.') };
  }
  const expected = d.instruments ?? [];
  const present = expected.filter(i => held.has(i.id));
  const missing = expected.filter(i => !held.has(i.id));
  return { jurisdiction, declared: true, expected, present, missing, atoms_present: held.size,
    summary: missing.length === 0
      ? `${jurisdiction}: all ${expected.length} declared instruments are present.`
      : `${jurisdiction}: ${present.length} of ${expected.length} declared instruments present. ` +
        `MISSING ${missing.length}: ` + missing.map(m => `${m.citation} (${m.title}) — would supply ` +
          `${(m.supplies ?? []).join('/') || 'unclassified'}`).join('; ') + '.' };
}

/** Does the corpus carry a given duty class for a jurisdiction? Presence of ANY atom is not enough. */
export function suppliesDuty(jurisdiction, duty, corpus) {
  const have = (corpus.obligations ?? [])
    .some(a => a.jurisdiction === jurisdiction && a.obligation_type === duty);
  const cov = coverageFor(jurisdiction, corpus);
  const wouldSupply = (cov.expected ?? []).filter(i => (i.supplies ?? []).includes(duty));
  const missing = wouldSupply.filter(i => !cov.present.some(p => p.id === i.id));
  return { have, missing, wouldSupply,
    note: have ? null
      : `${jurisdiction} carries no "${duty}" obligation. ` + (missing.length
        ? `The declared instruments that would supply it are absent: ` +
          missing.map(m => `${m.citation} (${m.title})`).join('; ') + '.'
        : `No declared instrument supplies it either — the gap is in the manifest, not just the corpus.`) };
}
