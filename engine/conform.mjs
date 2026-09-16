// A CONFORMANCE WORKSHEET — the requirement list, beside the document, with the verdict left open.
//
// This is the daily work. A privacy office reviews the same handful of document types over and
// over: a Notice of Privacy Practices, a business-associate contract, a breach letter, an
// automated-hiring bias-audit summary. Each has a statutory element list. The volume is the
// problem, not the difficulty.
//
// THE LINE THIS TOOL WILL NOT CROSS. The requirement list is DATA: enumerated from the corpus,
// quoted verbatim, hash-anchored, and complete or explicitly incomplete. Whether a particular
// document SATISFIES a particular requirement is legal judgement. A tool that prints
// "COMPLIANT ✓" next to a row has made that judgement silently and handed the reader a false
// sense of having checked. So the verdict column ships EMPTY, and a person or a model fills it in
// with the governing words in front of them.
//
// A WORKED EXAMPLE OF WHY THE SIGNAL IS NOT A VERDICT, from this module's own first test run.
// 45 C.F.R. § 164.520(b)(1)(i) requires a notice to carry a specific header statement. A sample
// notice containing that statement WORD FOR WORD scored 1/7 on vocabulary overlap — because the
// requirement's distinctive terms are "contain", "header", "prominently", "displayed", which
// describe where the statement goes, while the document contains the statement itself. The signal
// ranked a fully satisfied requirement as the fourth most suspicious row on the sheet. Anything
// built on top of it as if it were a finding would be confidently wrong in the quiet direction.
//
// The optional keyword signal is a reading aid and is labelled as one everywhere it appears. It
// says which of a requirement's distinctive terms occur in the document — nothing more. A
// requirement can be satisfied in words that share no vocabulary with the statute, and a document
// can contain every term while satisfying nothing. The signal is there to order the reviewer's
// attention, not to substitute for it.
import { load } from './corpus.mjs';
import { unionRequirements, requirementsFor } from './requirements.mjs';

const STOP = new Set(('the a an and or of to in for on with that this those these is are be by as ' +
  'such any all not no if then than which who whom whose it its their his her from at into under ' +
  'upon shall must may will would could should other otherwise including include includes each ' +
  'section paragraph subdivision subsection pursuant accordance required requirement requirements ' +
  'entity covered person business individual information').split(/\s+/));

/** Distinctive terms of a requirement: content words a drafter would plausibly reuse. */
function terms(text) {
  const words = String(text ?? '').toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [];
  return [...new Set(words.filter(word => !STOP.has(word)))];
}

/**
 * Build the worksheet. Total on hostile input.
 *
 * `signal` is opt-in and never produces a verdict — only a ratio and the terms it did not find.
 */
export function conform(documentText, citations, corpus, options) {
  const kb = corpus ?? load();
  const list = (Array.isArray(citations) ? citations : [citations]).filter(Boolean);
  const empty = { rows: [], sources: [], not_held: [], unavailable: [], document_chars: 0,
                  signal_enabled: false, error: null };
  if (!list.length) return { ...empty, error: 'give at least one citation to check against' };

  const opts = { include_segmentation: true };
  const set = list.length === 1
    ? (() => {
        const one = requirementsFor(list[0], kb, opts);
        return one.found && !one.error
          ? { sources: [{ citation: one.citation, count: one.count }], unavailable: [],
              elements: one.elements.map(el => ({ ...el, demanded_by: [el.citation] })),
              not_held: [] }
          : { sources: [], unavailable: [{ citation: list[0], reason: one.error }],
              elements: [], not_held: [] };
      })()
    : unionRequirements(list, kb, opts);

  const doc = String(documentText ?? '');
  const haystack = doc.toLowerCase();
  const useSignal = options?.signal === true && doc.length > 0;

  const rows = (set.elements ?? []).map(element => {
    const row = {
      citation: element.citation, atom_id: element.atom_id ?? null,
      provenance: element.provenance ?? 'record',
      requirement: element.verbatim_span,
      sha256: element.sha256 ?? null,
      demanded_by: element.demanded_by ?? [element.citation],
      verdict: null,                    // DELIBERATELY EMPTY — a person or a model fills this
      note: null,
    };
    if (useSignal) {
      const want = terms(element.verbatim_span);
      const hit = want.filter(term => haystack.includes(term));
      row.keyword_signal = {
        matched: hit.length, total: want.length,
        ratio: want.length ? Number((hit.length / want.length).toFixed(2)) : null,
        absent_terms: want.filter(term => !haystack.includes(term)).slice(0, 8),
        caveat: 'Vocabulary overlap only. NOT a determination that the requirement is met or missed.',
      };
    }
    return row;
  });

  if (useSignal)
    rows.sort((lhs, rhs) => (lhs.keyword_signal?.ratio ?? 1) - (rhs.keyword_signal?.ratio ?? 1));

  return { rows, sources: set.sources ?? [], unavailable: set.unavailable ?? [],
           not_held: set.not_held ?? [], document_chars: doc.length,
           signal_enabled: useSignal, error: null };
}

/** Render the worksheet as markdown a reviewer can fill in and file. */
export function conformMarkdown(sheet, title) {
  // Total on null: a caller renders whatever conform() returned, and conform() returns an `empty`
  // sheet on a bad input. Rendering null must produce a worksheet that says nothing was assessed,
  // never a crash inside the renderer — the failure would be reported at the wrong layer.
  sheet = sheet ?? {};
  const L = [];
  L.push(`# Conformance worksheet — ${title ?? 'document review'}`);
  L.push('');
  L.push('Each row is a requirement enumerated from the corpus and quoted verbatim, with the');
  L.push('sha256 of the source bytes it was cut from. **The verdict column is empty on purpose.**');
  L.push('Whether this document satisfies a row is legal judgement; this worksheet supplies the');
  L.push('requirement and the words, not the conclusion.');
  L.push('');
  for (const src of sheet.sources ?? [])
    L.push(`- Checked against **${src.citation}** — ${src.count} element(s)`);
  if (sheet.document_chars) L.push(`- Document supplied: ${sheet.document_chars} characters`);
  L.push('');
  if (sheet.signal_enabled) {
    L.push('> A keyword signal is shown. It reports vocabulary overlap between the requirement and');
    L.push('> the document and **is not a determination**. Rows are ordered lowest-overlap first so');
    L.push('> the least-obviously-addressed requirements are read first.');
    L.push('');
  }
  L.push('| # | Requirement | Citation | Met? | Where / note |');
  L.push('|---|---|---|---|---|');
  let n = 0;
  for (const row of sheet.rows) {
    n += 1;
    const text = row.requirement.replace(/\|/g, '\\|').slice(0, 220);
    const sig = row.keyword_signal ? ` _(overlap ${row.keyword_signal.matched}/${row.keyword_signal.total})_` : '';
    const tier = row.provenance === 'segmentation' ? ' ⚠' : '';
    L.push(`| ${n} | ${text}${sig} | \`${row.citation}\`${tier} | | |`);
  }
  L.push('');
  if ((sheet.not_held ?? []).length) {
    L.push(`**⚠ This worksheet is a floor.** ${sheet.not_held.length} element(s) appear in the source`);
    L.push('and no record was written for them; they are included above only where complete mode');
    L.push('reached them. Verify against the primary source before treating the list as exhaustive.');
    L.push('');
  }
  L.push('⚠ marks a row quoted from the segmentation rather than from a gate-checked record. Both');
  L.push('are quotations from the same hash-anchored source bytes; only the first has been through');
  L.push('the verification apparatus.');
  return L.join('\n');
}
