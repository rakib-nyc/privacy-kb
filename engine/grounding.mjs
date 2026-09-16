// AUDIT SOMEONE ELSE'S ANSWER: does the citation support the proposition it is attached to?
//
// THE PROBLEM THIS ADDRESSES IS MEASURED, NOT ASSUMED. Magesh et al., "Hallucination-Free?
// Assessing the Reliability of Leading AI Legal Research Tools" (Stanford RegLab / HAI, 2024)
// preregistered an evaluation of Lexis+ AI and Thomson Reuters's Ask Practical Law AI — both
// retrieval-augmented, both marketed as having eliminated hallucination — and found hallucination
// rates between 17% and 33%. Longitudinal work since finds the rate does not consistently fall
// across model generations, while documented hallucinated filings have grown from roughly 640 in
// late 2024 to more than 1,590 by mid-2026.
//
// Their taxonomy is the one used here, because it is the right one and because borrowing a
// published vocabulary beats inventing a private one:
//
//   CORRECTNESS   correct | incorrect | refusal
//   GROUNDEDNESS  grounded     key propositions make valid references to relevant documents
//                 MISGROUNDED  propositions ARE cited, but the source is misinterpreted or
//                              INAPPLICABLE
//                 ungrounded   propositions are not cited at all
//
// A response is a hallucination if it is incorrect OR misgrounded. The paper's own observation is
// the reason this module exists: misgrounded citations "are potentially more dangerous than
// fabricating a case outright, because they are subtler and more difficult to spot." A fabricated
// citation fails the first check anybody runs. A real citation attached to a proposition it does
// not support passes every check anybody runs, including a click-through.
//
// WHAT THIS MODULE WILL NOT DO, AND WHY THAT IS THE DESIGN.
//
// It never reports that a claim is CORRECT. Correctness is legal judgement and asserting it would
// be the same error engine/conform.mjs refuses when it leaves the verdict column empty. What it
// establishes is narrower and checkable: whether the citation resolves in this corpus, whether the
// provision was in force on the date the claim is made as of, whether it reaches the facts as
// given, and whether its stored text contains the terms the proposition turns on.
//
// It never reports that a citation is FABRICATED. This corpus holds federal law, New York State
// and New York City; a citation it cannot resolve may be perfectly real and simply outside what is
// held. Saying "fabricated" would assess absence against what happens to be here rather than
// against what should be — the defect this repository keeps finding one level at a time. The
// finding is CITATION_NOT_HELD, and it says which is which.
//
// The clean-audit status is therefore NO_PROBLEM_FOUND, never "verified". A check that found
// nothing and a claim that is right are different statements, and collapsing them would
// manufacture exactly the false confidence the module exists to detect.
import { load, surfaceable, inForceOn } from './corpus.mjs';
import { dateIsWeak } from './dates.mjs';
import { segmentationLeafFor } from './requirements.mjs';
import { evaluate, UNKNOWN } from './predicates.mjs';
import { isRealDate, badDateReason } from './dates.mjs';

const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const lower = text => norm(text).toLowerCase();

/** Severity drives ordering and the summary count. `advisory` never makes an audit fail. */
const SEVERITY = { high: 3, medium: 2, advisory: 1 };

// Words that carry no legal signal. Overlap computed over these produces a high score for any two
// pieces of English prose, which is how a "support" metric comes to certify an unrelated source.
const STOP = new Set(('a an and are as at be been but by for from has have if in into is it its of '
  + 'on or shall such that the their then there these this to under was were which who will with '
  + 'not no any all may must can does do each other than when where whether while any').split(' '));

const terms = text => new Set(lower(text).replace(/[^a-z0-9§\s.-]/g, ' ').split(/\s+/)
  .filter(word => word.length > 2 && !STOP.has(word)));

/**
 * Resolve a citation to something this corpus can quote.
 *
 * Three outcomes, kept apart on purpose: a verified record, a segmentation leaf (text from the
 * same hash-anchored source bytes that no record was written for), and nothing. The second is not
 * the first — engine/requirements.mjs makes the same distinction and never merges the labels.
 */
function resolveCitation(citation, kb) {
  const wanted = norm(citation);
  if (!wanted) return { resolution: 'no_citation_given' };

  const held = (kb.all ?? []).find(candidate => norm(candidate?.source?.citation) === wanted);
  if (held && !surfaceable(held))
    return { resolution: 'suppressed', record: held };
  if (held)
    return { resolution: 'record', record: held };

  const leaf = segmentationLeafFor(wanted, kb);
  if (leaf) return { resolution: 'segmentation', leaf };

  return { resolution: 'not_held' };
}

/** Citations this corpus holds that share the resolved citation's section, for a near-miss hint. */
function neighbours(citation, kb, limit = 4) {
  const base = norm(citation).replace(/(\([^)]*\))+\s*$/, '').trim();
  if (!base) return [];
  return [...new Set((kb.all ?? [])
    .filter(surfaceable)
    .map(candidate => norm(candidate?.source?.citation))
    .filter(text => text && text !== norm(citation) && text.startsWith(base)))].slice(0, limit);
}

/**
 * Audit one claim: a proposition and the citation offered in support of it.
 *
 * `facts` is optional. Supplied, it enables the INAPPLICABLE-AUTHORITY check, which is the
 * misgrounding case the Stanford typology names and the one a click-through does not catch: the
 * provision is real, the text is quoted correctly, and it does not reach the entity being advised.
 */
export function groundOne(claim, corpus, options) {
  const kb = corpus ?? load();
  const proposition = norm(claim?.proposition);
  const citation = norm(claim?.citation);
  const asOf = claim?.as_of ?? options?.as_of ?? null;
  const facts = claim?.facts ?? options?.facts ?? null;

  const findings = [];
  const add = (code, severity, message, detail) =>
    findings.push({ code, severity, message, ...(detail ? { detail } : {}) });

  const out = {
    proposition: proposition || null,
    citation: citation || null,
    as_of: asOf,
    resolution: null,
    record_id: null,
    quoted: null,
    source: null,
    findings,
    support_signal: null,
    status: null,
  };

  if (!citation) {
    // UNGROUNDED, in the paper's sense: a proposition with no citation at all. It is not an error
    // this module can investigate, but reporting nothing would let an uncited assertion pass
    // silently through an audit whose whole purpose is to find that.
    add('NO_CITATION_OFFERED', 'high',
      'This proposition carries no citation, so there is nothing to check it against. In the '
      + 'Stanford typology that is an UNGROUNDED response: it makes no false assertion about a '
      + 'source, and it also supplies none of the authority a reader needs.');
    out.status = 'CANNOT_CHECK';
    return out;
  }

  if (asOf && !isRealDate(asOf)) {
    add('AS_OF_NOT_A_DATE', 'high', badDateReason('as_of', asOf));
    out.status = 'CANNOT_CHECK';
    return out;
  }

  const found = resolveCitation(citation, kb);
  out.resolution = found.resolution;

  if (found.resolution === 'not_held') {
    const near = neighbours(citation, kb);
    add('CITATION_NOT_HELD', 'medium',
      `This corpus does not hold "${citation}", so the claim cannot be checked here. That is a `
      + `statement about this corpus and NOT a finding that the citation is fabricated: coverage `
      + `is US federal law, New York State and New York City, and a real provision outside that `
      + `scope resolves to nothing for the same reason an invented one does.`,
      near.length ? { held_under_the_same_section: near } : undefined);
    out.status = 'CANNOT_CHECK';
    return out;
  }

  if (found.resolution === 'suppressed') {
    add('CITATION_SUPPRESSED', 'medium',
      `"${citation}" exists in this corpus but its verification_status is `
      + `${found.record?.verification_status ?? 'unset'}, so invariant I1 suppresses it from every `
      + `output and it cannot be quoted back at you. A limit of the corpus, not a finding about `
      + `the law.`);
    out.status = 'CANNOT_CHECK';
    return out;
  }

  // ---- the citation resolves; everything below is a check ON the claim --------------------
  const record = found.record ?? null;
  const quoted = norm(record ? record.verbatim_span : found.leaf?.text);
  out.record_id = record?.id ?? null;
  out.quoted = quoted || null;
  out.source = record
    ? { url: record.source?.url ?? null, raw_sha256: record.source?.raw_sha256 ?? null,
        segment_sha256: record.source?.segment_sha256 ?? null,
        fetched: record.source?.fetched ?? null, raw_file: record.source?.raw_file ?? null }
    : { raw_file: found.leaf?.raw_file ?? null, note: 'read from the segmentation, not from a record' };

  if (found.resolution === 'segmentation')
    add('HELD_ONLY_IN_SEGMENTATION', 'advisory',
      'The text quoted here comes from the segmentation of the source file rather than from a '
      + 'verified record. Same hash-anchored bytes, but it has not been through the record '
      + 'apparatus, so no applicability predicate and no dated vintage attach to it.');

  if (record) {
    // ---- temporal: was it law on the date the claim is made as of? -----------------------
    if (record.status === 'enacted_pending')
      add('PENDING_NOT_BINDING', 'high',
        `${citation} is enacted but not yet in force${record.effective_from ? ` (effective `
        + `${record.effective_from})` : ''}. Citing it for what is required TODAY asserts a duty `
        + `that binds nobody yet — one of the commonest confident errors in this area.`);

    if (record.status === 'superseded')
      add('SUPERSEDED', 'high',
        `${citation} is marked superseded in this corpus${record.superseded_by ? `, by `
        + `${record.superseded_by}` : ''}. Its text may be quoted accurately and still not be the `
        + `law being asked about.`);

    if (asOf) {
      if (!inForceOn(record, asOf))
        add('NOT_IN_FORCE_ON_DATE', 'high',
          `${citation} was not in force on ${asOf} in this corpus `
          + `(effective_from ${record.effective_from ?? 'unset'}`
          + `${record.effective_to ? `, effective_to ${record.effective_to}` : ''}). A correctly `
          + `quoted provision attached to a date it did not govern is the misgrounding case: the `
          + `source is real, the quotation is exact, and the authority is inapplicable.`);

      if (dateIsWeak(record))
        add('DATE_BASIS_WEAK', 'advisory',
          `The effective_from on ${citation} has basis "${record.effective_from_basis}", which `
          + `records when this text was captured rather than when it began. The as-of comparison `
          + `above is therefore weaker than it looks, in EITHER direction.`);
    } else {
      add('NO_AS_OF_SUPPLIED', 'advisory',
        'No as-of date was given, so no temporal check was run. There is no "current law" here; '
        + 'a claim is about a date whether or not the date is stated.');
    }

    // ---- applicability: does this provision reach the facts as given? --------------------
    // THE INAPPLICABLE-AUTHORITY CHECK. This is what a click-through cannot do. A reader who
    // follows the citation sees real text that says what the answer said it says, and has no way
    // to see that the provision does not reach the entity being advised.
    if (facts && record.record_type === 'obligation' && record.applies_if) {
      const verdict = evaluate(record.applies_if, facts);
      if (verdict?.value === false)
        add('DOES_NOT_REACH_THESE_FACTS', 'high',
          `${citation} does not apply to the facts supplied. The provision is real and the text `
          + `is quoted correctly; it reaches a different population. This is the inapplicable`
          + `-authority failure, and it survives every check that stops at "does the citation `
          + `exist".`,
          { failed_predicate: verdict.why ?? null });
      // Reported only when the caller actually asserted something. Testing a predicate against an
      // empty fact set returns UNKNOWN for every obligation in the corpus, which is true and
      // useless.
      else if (verdict?.value === UNKNOWN && Object.keys(facts?.entity ?? {}).length
               + Object.keys(facts?.data ?? {}).length > 0)
        add('APPLICABILITY_UNKNOWN', 'advisory',
          `Whether ${citation} reaches these facts could not be decided: a fact its predicate `
          + `needs was not supplied. Unknown is reported as unknown rather than resolved either `
          + `way.`, { unresolved: verdict.why ?? null });
    } else if (facts && record.record_type !== 'obligation') {
      add('NO_PREDICATE_TO_TEST', 'advisory',
        `${citation} is held as ${record.record_type} reference text with no applicability `
        + `predicate, so it cannot be tested against facts. It can be quoted; it cannot be said `
        + `to apply to anyone by this engine.`);
    }
  }

  // ---- support signal: EXPLICITLY NOT A VERDICT -----------------------------------------
  // engine/conform.mjs documents why a keyword signal can never decide this: a notice containing
  // 45 C.F.R. § 164.520(b)(1)(i)'s statement word for word scored 1/7, because the requirement
  // describes WHERE the statement goes rather than repeating it. The same limit applies here in
  // both directions — high overlap does not establish support, and low overlap does not refute it.
  if (proposition && quoted) {
    const claimed = terms(proposition), source = terms(quoted);
    const shared = [...claimed].filter(word => source.has(word));
    const overlap = claimed.size ? shared.length / claimed.size : 0;
    out.support_signal = {
      overlap: Number(overlap.toFixed(3)),
      shared_terms: shared.slice(0, 12),
      absent_terms: [...claimed].filter(word => !source.has(word)).slice(0, 12),
      note: 'A LEXICAL SIGNAL, NOT A DETERMINATION. Whether the quoted text supports the '
        + 'proposition is a reading, and this engine does not make it. Low overlap is a reason to '
        + 'read the quotation, not a finding that the claim is wrong.'
        + (options?.proposition_is_derived
            ? ' The proposition here was taken from the sentence the citation sits in, which is a '
              + 'guess about layout — treat this number as weaker still.' : ''),
    };
    // NOT EMITTED WHEN THE PROPOSITION WAS GUESSED FROM LAYOUT. groundText() takes the sentence a
    // citation sits in as the proposition, which is a guess about punctuation and not a reading of
    // the argument. Scoring overlap against a guess produced a finding on nearly every row — and a
    // finding that fires on everything is one people learn to skip, which costs the findings that
    // matter. The raw signal is still reported; the flag is not raised.
    if (overlap < 0.25 && claimed.size >= 4 && !options?.proposition_is_derived)
      add('SUPPORT_NOT_ESTABLISHED', 'advisory',
        `Few of the terms this proposition turns on appear in the cited text `
        + `(${shared.length} of ${claimed.size}). That is a prompt to read the quotation beside `
        + `the claim, not a finding that the claim is unsupported.`);
  }

  findings.sort((left, right) => (SEVERITY[right.severity] ?? 0) - (SEVERITY[left.severity] ?? 0));
  const high = findings.filter(entry => entry.severity === 'high').length;
  out.status = high ? 'PROBLEMS_FOUND' : 'NO_PROBLEM_FOUND';
  return out;
}

/**
 * Audit a set of claims. Total on null at the outermost surface.
 *
 * The summary counts what was CHECKED as well as what failed, because a run that could check
 * nothing and a run that found nothing wrong produce the same "0 problems" otherwise — the
 * vacuous-pass shape gate 14 exists to catch in the corpus, applied to an audit.
 */
export function ground(claims, corpus, options) {
  const kb = corpus ?? load();
  const list = (Array.isArray(claims) ? claims : [claims]).filter(Boolean);
  if (!list.length)
    return { checked: 0, results: [], summary: null, error: 'no claims given' };

  const results = list.map(entry => groundOne(entry, kb, options));
  const counted = code => results.filter(row => row.findings.some(f => f.code === code)).length;

  return {
    checked: results.length,
    results,
    summary: {
      claims: results.length,
      checkable: results.filter(row => row.status !== 'CANNOT_CHECK').length,
      not_checkable: results.filter(row => row.status === 'CANNOT_CHECK').length,
      with_problems: results.filter(row => row.status === 'PROBLEMS_FOUND').length,
      no_problem_found: results.filter(row => row.status === 'NO_PROBLEM_FOUND').length,
      not_held: counted('CITATION_NOT_HELD'),
      not_in_force: counted('NOT_IN_FORCE_ON_DATE'),
      pending: counted('PENDING_NOT_BINDING'),
      inapplicable: counted('DOES_NOT_REACH_THESE_FACTS'),
    },
    caveat:
      'NO_PROBLEM_FOUND IS NOT "CORRECT". This establishes that a citation resolves in this '
      + 'corpus, that the provision was in force on the date given, that it reaches the facts '
      + 'supplied, and what its stored text actually says. Whether the text supports the '
      + 'proposition is a reading, and this engine does not make readings. CANNOT_CHECK is a '
      + 'statement about this corpus, never a finding that a citation was invented.',
  };
}

/** Render an audit as a worksheet. The judgement column is the reader's, as in conform. */
export function groundMarkdown(audit, title) {
  audit = audit ?? {};
  const lines = [];
  lines.push(`# Citation audit — ${title ?? 'claims under review'}`);
  lines.push('');
  if (audit.error) { lines.push(`**Refused:** ${audit.error}`); return lines.join('\n'); }

  const sum = audit.summary ?? {};
  lines.push(`${sum.claims} claim(s) · ${sum.checkable} checkable here · `
    + `${sum.with_problems} with a high-severity finding · ${sum.not_checkable} this corpus cannot reach`);
  lines.push('');
  lines.push('> **A clean row is not a correct claim.** It means the citation resolves, the');
  lines.push('> provision was in force on the date given, and it reaches the facts supplied.');
  lines.push('> Whether the quoted words support the proposition is your reading to make.');
  lines.push('');

  for (const row of audit.results ?? []) {
    lines.push(`## ${row.citation ?? '(no citation)'}`);
    lines.push('');
    if (row.proposition) lines.push(`**Claim.** ${row.proposition}`);
    lines.push('');
    lines.push(`**Status.** \`${row.status}\``
      + (row.record_id ? ` · record \`${row.record_id}\`` : '')
      + (row.source?.raw_sha256 ? ` · source sha256 \`${row.source.raw_sha256.slice(0, 16)}…\`` : ''));
    lines.push('');
    if (row.quoted) {
      lines.push('**What the source actually says.**');
      lines.push('');
      lines.push('> ' + row.quoted.slice(0, 900).replace(/\n/g, '\n> '));
      lines.push('');
    }
    if (row.findings?.length) {
      lines.push('**Findings.**');
      lines.push('');
      for (const finding of row.findings)
        lines.push(`- \`${finding.code}\` (${finding.severity}) — ${finding.message}`);
      lines.push('');
    }
    if (row.support_signal) {
      lines.push(`**Term overlap.** ${row.support_signal.overlap} — `
        + `${row.support_signal.note}`);
      lines.push('');
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(audit.caveat ?? '');
  return lines.join('\n');
}

/**
 * Pull every legal citation out of a block of prose.
 *
 * THIS IS A REGEX, DELIBERATELY, AND IT DOES NOT READ THE TEXT. Extracting the PROPOSITION a
 * citation supports would require understanding the prose, which would put a language model inside
 * the audit path — the thing invariant I8 exists to keep out, and it would make the auditor
 * exactly as fallible as the thing being audited. Extracting the citation is lexical, so it is
 * done here; deciding what the citation was offered for is left to the reader, who has the
 * paragraph in front of them.
 *
 * What that buys: paste any assistant's answer and every authority it leaned on gets checked for
 * resolution, force on the date, pending status and applicability to your facts, with no
 * structured input at all. The proposition-level check remains available for callers who supply
 * one.
 */
const CITATION_PATTERNS = [
  // 45 C.F.R. § 164.404(b) · 16 CFR 312.3(a) — with or without periods and spaces
  /\b\d{1,2}\s*C\.?\s?F\.?\s?R\.?\s*(?:§+\s*)?\d[\d.]*(?:\([^)\s]{1,6}\))*/gi,
  // 15 U.S.C. § 1681g(a)(1)
  /\b\d{1,2}\s*U\.?\s?S\.?\s?C\.?\s*(?:§+\s*)?\d[\d\w-]*(?:\([^)\s]{1,6}\))*/gi,
  // N.Y. Gen. Bus. Law § 899-aa(2)(a) · N.Y.C. Admin. Code § 20-871(a) · N.Y. Educ. Law § 2-d
  /\bN\.?\s?Y\.?(?:C\.?)?[^§\n]{0,40}§+\s*[\d][\w.-]*(?:\([^)\s]{1,6}\))*/gi,
  // 6 RCNY § 5-301(b)
  /\b\d+\s*RCNY\s*§*\s*[\d][\w.-]*(?:\([^)\s]{1,6}\))*/gi,
  // ANYTHING ELSE SHAPED LIKE A CITATION — "Cal. Civ. Code § 1798.82", "Tex. Bus. & Com. Code
  // § 521.053". These cannot be held here and will all come back CITATION_NOT_HELD, which is
  // exactly why they must be extracted: a pattern list scoped to what the corpus COULD hold drops
  // every out-of-scope authority in silence, and an audit that reports "3 citations checked" over
  // a paragraph containing four has measured itself rather than the text.
  /\b(?:[A-Z][A-Za-z.]{1,12}\s+|&\s+){1,6}(?:Code|Law|Stat\.?|Ann\.?|Reg(?:s)?\.?)\s*§+\s*[\d][\w.-]*(?:\([^)\s]{1,6}\))*/g,
];

export function citationsIn(text) {
  const prose = String(text ?? '');
  const seen = new Map();
  for (const pattern of CITATION_PATTERNS)
    for (const hit of prose.matchAll(pattern)) {
      const raw = norm(hit[0]).replace(/[),.;:]+$/, m => (m.includes(')') ? m : ''));
      if (raw.length < 6) continue;
      if (!seen.has(lower(raw))) seen.set(lower(raw), { citation: raw, index: hit.index ?? 0 });
    }
  // A LONGER MATCH WINS. Several patterns can hit the same citation at different boundaries —
  // "N.Y. Gen. Bus. Law § 899-aa(2)(a)" and "Bus. Law § 899-aa(2)(a)" are one authority, and
  // auditing both would double-count the text's citations and report two NOT_HELD rows for one.
  const all = [...seen.values()].sort((left, right) => left.index - right.index);
  const kept = all.filter(entry => !all.some(other =>
    other !== entry && lower(other.citation).includes(lower(entry.citation))));
  return kept.map(entry => entry.citation);
}

/**
 * Audit every citation in a block of prose.
 *
 * `sentence` gives each claim the sentence its citation sits in, as the proposition. That is a
 * heuristic about LAYOUT, not a reading of the argument, and the support signal it feeds is
 * already labelled as no determination — so a wrong sentence boundary costs an advisory line,
 * never a finding.
 */
export function groundText(text, corpus, options) {
  const kb = corpus ?? load();
  const prose = String(text ?? '');
  const found = citationsIn(prose);
  if (!found.length)
    return { checked: 0, results: [], summary: null, extracted: [],
      error: 'no citation was found in this text. Nothing here can be checked against the corpus, '
        + 'which is itself worth knowing: an answer that cites nothing is UNGROUNDED in the '
        + 'Stanford sense, whatever else it is.' };

  const sentenceFor = citation => {
    const at = prose.toLowerCase().indexOf(lower(citation));
    if (at < 0) return null;
    const start = Math.max(0, prose.lastIndexOf('.', at - 1) + 1);
    const dot = prose.indexOf('.', at + citation.length);
    return norm(prose.slice(start, dot === -1 ? prose.length : dot + 1)) || null;
  };

  const derived = options?.use_sentences !== false;
  const audit = ground(found.map(citation => ({
    citation,
    proposition: derived ? sentenceFor(citation) : null,
    as_of: options?.as_of ?? null,
    facts: options?.facts ?? null,
  })), kb, { ...options, proposition_is_derived: derived });

  return { ...audit, extracted: found };
}
