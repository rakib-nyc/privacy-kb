// Invariant I6: the backstops never turn off.
//
// The system never returns "no law applies". It returns "no sectoral statute reaches this;
// § 5, state UDAP, and the entity's own published notice are the operative constraints."
// A privacy tool that goes silent when no sectoral statute matches is worse than useless,
// because silence reads as permission.
import { coverageFor } from './coverage.mjs';
import { load } from './corpus.mjs';

export function backstops(entityFacts, context) {
  const corpus = load();
  const out = [];

  const ftc = corpus.byId.get('us.authority.ftc');
  const unfair = corpus.byId.get('us.authority.ftc.unfairness_test');
  if (ftc) {
    const carveouts = ftc.authority.excluded_from_reach ?? [];
    out.push({
      kind: 'ftc_act_section_5', authority_id: ftc.id, citation: ftc.source.citation,
      always_applies: true,
      // Point at the PROHIBITION, not only at the authority that enforces it. The corpus now
      // holds § 45(a)(1) and § 45(n) as obligation atoms; a backstop that cited only the
      // authority record would send a reader to the regulator's powers rather than to the words
      // that make the conduct unlawful.
      atom_ids: corpus.obligations.filter(a => a.source?.instrument_id === 'us.usc.15.45')
        .map(a => ({ id: a.id, citation: a.source.citation, obligation: a.summary })),
      note: 'FTC Act § 5 reaches unfair or deceptive acts or practices in or affecting commerce. It is never ' +
            'switched off by the absence of a sectoral statute — it is what fills that space.',
      unfairness_test: unfair ? { authority_id: unfair.id, citation: unfair.source.citation,
        note: 'Unfairness is a three-part statutory test under § 45(n), not an open standard.' } : null,
      carve_out_warning: carveouts.length
        ? `§ 45(a)(2) carve-outs are entity-level and decisive: ${carveouts.slice(0, 4).join('; ')}. ` +
          `If the entity falls inside one, § 5 does NOT reach it and the sectoral regulator does.`
        : null,
    });
  }

  // State UDAP — required by I6, and resolved from the COVERAGE DECLARATION rather than by
  // pattern-matching atom ids. The previous version tested /udap|deceptive/ against a.id, which
  // matched nothing once GBL § 349 actually landed: its atoms are ny.gbl.349.a.unlawful and
  // siblings, containing neither word. So the corpus HELD the New York UDAP statute while this
  // function reported it unavailable and blamed a blocker that had been resolved. Identity
  // inferred from an incidental string is the same defect as coverage inferred from presence,
  // failing in the opposite direction: a false gap rather than a false all-clear.
  for (const j of context.state_layers ?? []) {
    const cov = coverageFor(j, corpus);
    const declared = (cov.expected ?? []).filter(i => (i.supplies ?? []).includes('udap'));
    const held = declared
      .map(i => ({ i, atoms: corpus.obligations.filter(a => a.source?.instrument_id === i.id) }))
      .filter(x => x.atoms.length);
    if (held.length) {
      for (const { i, atoms } of held)
        out.push({ kind: 'state_udap', jurisdiction: j, atom_id: atoms[0].id,
          citation: atoms[0].source.citation, instrument_id: i.id, always_applies: true,
          note: `${i.citation} — ${i.title}. Required by invariant I6 and present in the corpus ` +
                `(${atoms.length} atom(s)).` });
    } else {
      out.push({ kind: 'state_udap', jurisdiction: j, atom_id: null, always_applies: true,
        unavailable: true,
        note: declared.length
          ? `The ${j} UDAP statute is required by invariant I6 and is NOT in the corpus. Declared as ` +
            declared.map(d => `${d.citation} (${d.title})`).join('; ') +
            `. This backstop is INCOMPLETE and the gap is reported rather than hidden.`
          : `${j} declares NO instrument supplying UDAP in meta/jurisdiction-coverage.yaml, so invariant ` +
            `I6's state half cannot be satisfied for it. The gap is in the declaration, not just the corpus.` });
    }
  }

  out.push({
    kind: 'published_notice_commitments', always_applies: true, atom_id: null,
    note: "The entity's own published privacy notice is an operative constraint independent of any statute: a " +
          'material departure from it is a misrepresentation reachable under § 5 and under state UDAP. This is ' +
          'the constraint most often missed when no sectoral statute applies.',
  });
  return out;
}
