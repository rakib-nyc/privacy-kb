#!/usr/bin/env node
// THE DECISION PROCEDURE for authority_tier.
//
// Every atom in the corpus runs through this. Ambiguity here becomes ~900 inconsistent
// judgement calls, so the procedure is executable, and where it cannot decide it REFUSES
// and names the input it needs. A procedure that guesses is worse than one that refuses:
// a refusal costs one human decision, a guess costs a wrong answer nobody looks at again.
//
//   import { classify } from './authority-tier.mjs'
//   node tools/authority-tier.mjs --self-test
//   node tools/authority-tier.mjs --validate-corpus
//
// TWO AXES, DELIBERATELY SEPARATE
//
//   authority_tier   — what KIND of instrument this is, and how much weight it carries
//                      against other instruments. A property of the INSTRUMENT.
//   sourcing_posture — how confident we are that the text quoted IS the enacted text.
//                      A property of the SOURCE we read it in.
//
// They are orthogonal. The same FCRA obligation read in the U.S. Code and in the Statutes
// at Large has one authority_tier and two sourcing postures. Collapsing them would make
// "which document did you read" masquerade as "how much does this bind".
//
// Status (in_force / enjoined / proposed) is a THIRD axis and also does not move the tier.
// A stayed legislative rule is still a legislative rule; it just does not currently operate.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);

const PL = existsSync(R('meta/positive-law-titles.yaml'))
  ? yaml.load(readFileSync(R('meta/positive-law-titles.yaml'), 'utf8')) : { titles: {} };

const refuse = (reason, needs) => ({ tier: null, refused: true, reason, needs });

// --------------------------------------------------------------------------- hosts
const HOST_ROLE = {
  'uscode.house.gov': 'us_code', 'www.govinfo.gov': 'govinfo', 'govinfo.gov': 'govinfo',
  'www.ecfr.gov': 'cfr', 'ecfr.gov': 'cfr',
  'www.federalregister.gov': 'federal_register',
  'www.supremecourt.gov': 'court', 'www.courtlistener.com': 'court',
  'www.nysenate.gov': 'state_legislature', 'nysenate.gov': 'state_legislature',
  'nyassembly.gov': 'state_legislature', 'assembly.state.ny.us': 'state_legislature',
  'govt.westlaw.com': 'state_regulation',
  'legalinstruments.oecd.org': 'international', 'www.oecd.org': 'international',
  'www.apec.org': 'international', 'www.globalcbpr.org': 'international',
  'www.ftc.gov': 'agency', 'www.hhs.gov': 'agency', 'aspe.hhs.gov': 'agency',
  'www.consumerfinance.gov': 'agency', 'www.fcc.gov': 'agency', 'www.sec.gov': 'agency',
  'www.dol.gov': 'agency', 'www.eeoc.gov': 'agency', 'www.dfs.ny.gov': 'agency',
  'ag.ny.gov': 'agency', 'www.nysed.gov': 'agency', 'www.justice.gov': 'agency',
  'www.dhs.gov': 'agency', 'www.nist.gov': 'agency', 'csrc.nist.gov': 'agency',
};

/**
 * @param {object} f  source characteristics available at extraction time
 *   host              publisher host of source.url
 *   document_type     us_code_section | session_law | cfr_section | federal_register_rule
 *                     | agency_publication | court_opinion | consent_decree
 *                     | industry_code | international_instrument | advisory_report
 *   issuing_body      free text, e.g. "Congress", "FTC", "OECD Council"
 *   notice_and_comment  true | false | 'unknown'   (5 U.S.C. § 553)
 *   us_code_title     integer, when the text is Code text
 *   enjoined          boolean, informational only — never moves the tier
 */
export function classify(f) {
  const role = f.host ? HOST_ROLE[f.host] : undefined;
  if (f.host && role === undefined)
    return refuse(`host "${f.host}" is not in the source allowlist`,
      ['add it to tools/sources-policy.mjs in its own commit, with a stated reason']);
  if (f.host && role === 'non_source')
    return refuse(`host "${f.host}" is scaffolding, not a source of law`,
      ['this document cannot carry an authority_tier']);

  const note = [];
  const posture = sourcingPosture(f, note);
  const done = (tier, why) => ({ tier, refused: false, sourcing_posture: posture,
                                 reasons: [...note, why],
                                 status_note: f.enjoined ? 'enjoined — status only; the tier is unchanged' : null });

  switch (f.document_type) {
    case 'court_opinion':
      return done('case_law', 'a court adjudicating a dispute');

    case 'consent_decree':
      // Binds one party by agreement. It is not a court's reasoned adjudication and it is
      // not a rule of general application, however much it drives industry behaviour.
      return done('enforcement_action',
        'an order or settlement binding named parties; any doctrinal rule it establishes is persuasive, not generally binding');

    case 'us_code_section':
    case 'session_law':
      if (role !== 'us_code' && role !== 'govinfo' && role !== 'state_legislature')
        return refuse(`document_type "${f.document_type}" from a ${role} host`,
          ['confirm the document really is enacted text and the host really publishes it']);
      return done('statute', 'text enacted by a legislature');

    case 'cfr_section':
    case 'federal_register_rule': {
      // THE HINGE. 5 U.S.C. § 553(b)(A) exempts "interpretative rules, general statements
      // of policy, or rules of agency organization, procedure, or practice" from
      // notice-and-comment. A rule that went through it is legislative and has the force
      // of law; one that did not, did not.
      if (f.notice_and_comment === true)
        return done('regulation', 'notice-and-comment rulemaking under 5 U.S.C. § 553 — a legislative rule with the force of law');
      if (f.notice_and_comment === false)
        return done('agency_guidance',
          'exempt from notice-and-comment under 5 U.S.C. § 553(b)(A) — an interpretative rule or general statement of policy, which does not carry the force of law');
      return refuse('notice_and_comment is unknown, and it is what separates a legislative rule from an interpretative rule or policy statement',
        ['the Federal Register preamble\'s statement of § 553 basis, or the agency\'s own characterisation in the promulgating document']);
    }

    case 'agency_publication':
      if (role !== 'agency')
        return refuse(`document_type agency_publication from a ${role} host`, ['confirm the issuing agency published it itself']);
      return done('agency_guidance',
        'published by an agency outside notice-and-comment rulemaking; it may drive enforcement in practice but carries no force of law');

    case 'industry_code':
      return done('self_regulatory_scheme',
        'a voluntary scheme; binding on participants only through their own commitment, and reachable by FTC Act § 5 when that commitment is public');

    case 'international_instrument':
      if (role !== 'international')
        return refuse('international_instrument from a non-international host', ['confirm the issuing body published it']);
      return done('international_instrument', 'adopted by an international body and addressed to states or member economies');

    case 'advisory_report':
      return done('advisory_report', 'a report recommending action; never enacted as such');

    default:
      return refuse(`document_type "${f.document_type ?? '(absent)'}" does not map to a tier`,
        ['classify the document, or extend this procedure in its own commit']);
  }
}

// ------------------------------------------------------------------ sourcing posture
function sourcingPosture(f, note) {
  if (f.us_code_title == null) return 'not_us_code';
  const row = PL.titles?.[f.us_code_title];
  if (!row) {
    note.push(`WARNING: US Code title ${f.us_code_title} is not in meta/positive-law-titles.yaml`);
    return 'unknown_refuses';
  }
  if (row.is_positive_law) {
    note.push(`title ${f.us_code_title} is positive law — 1 U.S.C. § 204(a): the Code text is "legal evidence" of the law`);
    return 'legal_evidence';
  }
  note.push(`title ${f.us_code_title} is NOT positive law — 1 U.S.C. § 204(a): the Code establishes the law "prima facie" only; the enacted text is in the Statutes at Large`);
  return 'prima_facie_evidence';
}

// --------------------------------------------------------------------------- CLI
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.yaml') && p.includes('/atoms/')) out.push(p);
  }
  return out;
}

/** Infer procedure inputs from a stored record.
 *
 * NON-CIRCULAR BY CONSTRUCTION: this must never read the declared authority_tier, or the
 * validation grades its own homework. Everything here comes from the source, the record
 * type, and the issuing body — the same things available at extraction time before any
 * tier has been assigned.
 */
export function inputsFromRecord(a) {
  const host = (() => { try { return new URL(a.source.url).hostname; } catch { return null; } })();
  const role = host ? HOST_ROLE[host] : undefined;
  const issuer = (a.framework?.issuer ?? a.scheme?.operator ?? '').toLowerCase();
  const dt =
      a.record_type === 'certification_scheme' ? 'industry_code'
    : role === 'international' ? 'international_instrument'
    // An advisory body RECOMMENDS; an agency ISSUES. The distinction is in who spoke,
    // which is on the record independently of what tier anyone assigned it.
    : (role === 'agency' && /advisory committee|commission on|task force/.test(issuer)) ? 'advisory_report'
    : role === 'agency' ? 'agency_publication'
    : null;
  const m = /\b(\d+)\s*U\.?S\.?C\.?/i.exec(a.source.citation ?? '');
  return { host, document_type: dt, issuing_body: a.framework?.issuer ?? a.scheme?.operator,
           notice_and_comment: 'unknown', us_code_title: m ? Number(m[1]) : null,
           enjoined: a.status === 'enjoined' };
}

const declaredTier = a => a.framework?.authority_tier ?? a.scheme?.authority_tier ?? null;

if (process.argv.includes('--validate-corpus')) {
  const rows = [];
  for (const f of walk(R('corpus'))) {
    const a = yaml.load(readFileSync(f, 'utf8'));
    if (!a?.id) continue;
    const want = declaredTier(a);
    if (!want) continue;
    const got = classify(inputsFromRecord(a));
    rows.push({ id: a.id, want, got: got.tier, refused: got.refused,
                posture: got.sourcing_posture, match: got.tier === want });
  }
  const bad = rows.filter(r => !r.match);
  const byTier = {};
  for (const r of rows) byTier[r.want] = (byTier[r.want] ?? 0) + 1;
  console.log(`records with a declared authority_tier: ${rows.length}  ${JSON.stringify(byTier)}`);
  console.log(`reproduced by the procedure:            ${rows.length - bad.length}/${rows.length}`);
  for (const r of bad) console.log(`  MISMATCH ${r.id}\n    declared=${r.want}  procedure=${r.got ?? 'REFUSED'}`);
  process.exit(bad.length ? 1 : 0);
}

if (process.argv.includes('--self-test')) {
  const T = [
    ['statute, non-positive-law title',
      { host: 'uscode.house.gov', document_type: 'us_code_section', us_code_title: 15 }, 'statute', 'prima_facie_evidence'],
    ['statute, positive-law title',
      { host: 'uscode.house.gov', document_type: 'us_code_section', us_code_title: 18 }, 'statute', 'legal_evidence'],
    ['legislative rule',
      { host: 'www.ecfr.gov', document_type: 'cfr_section', notice_and_comment: true }, 'regulation', 'not_us_code'],
    ['interpretive rule / policy statement',
      { host: 'www.federalregister.gov', document_type: 'federal_register_rule', notice_and_comment: false }, 'agency_guidance', 'not_us_code'],
    ['agency FAQ that drives enforcement in practice',
      { host: 'www.ftc.gov', document_type: 'agency_publication' }, 'agency_guidance', 'not_us_code'],
    ['consent decree with a doctrinal rule',
      { host: 'www.ftc.gov', document_type: 'consent_decree' }, 'enforcement_action', 'not_us_code'],
    ['rule promulgated but enjoined',
      { host: 'www.ecfr.gov', document_type: 'cfr_section', notice_and_comment: true, enjoined: true }, 'regulation', 'not_us_code'],
    ['self-regulatory code, § 5 pathway only',
      { host: 'www.apec.org', document_type: 'industry_code' }, 'self_regulatory_scheme', 'not_us_code'],
    ['non-binding international framework',
      { host: 'legalinstruments.oecd.org', document_type: 'international_instrument' }, 'international_instrument', 'not_us_code'],
    ['state statute',
      { host: 'nysenate.gov', document_type: 'session_law' }, 'statute', 'not_us_code'],
    ['state common law',
      { host: 'www.courtlistener.com', document_type: 'court_opinion' }, 'case_law', 'not_us_code'],
    ['advisory report',
      { host: 'aspe.hhs.gov', document_type: 'advisory_report' }, 'advisory_report', 'not_us_code'],
  ];
  const REF = [
    ['CFR rule with unknown § 553 basis', { host: 'www.ecfr.gov', document_type: 'cfr_section', notice_and_comment: 'unknown' }],
    ['unknown host', { host: 'example.com', document_type: 'us_code_section' }],
    ['unmapped document type', { host: 'www.ftc.gov', document_type: 'press_release' }],
    ['scaffolding host', { host: 'the source taxonomy', document_type: 'advisory_report' }],
  ];
  let bad = 0;
  for (const [name, inp, tier, posture] of T) {
    const r = classify(inp);
    const ok = r.tier === tier && r.sourcing_posture === posture;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(46)} -> ${r.tier ?? 'REFUSED'} / ${r.sourcing_posture ?? '-'}`);
  }
  for (const [name, inp] of REF) {
    const r = classify(inp);
    if (!r.refused) bad++;
    console.log(`${r.refused ? 'ok  ' : 'FAIL'}  REFUSES: ${name.padEnd(37)} -> ${r.refused ? r.needs[0].slice(0, 60) : 'DID NOT REFUSE'}`);
  }
  console.log(`\n${bad} failure(s)`);
  process.exit(bad ? 1 : 0);
}
