// The deterministic solver. NO LLM ANYWHERE IN THIS PATH (invariant I8).
//
// Total: every input produces a result. Never throws, never returns empty, and every
// decision carries the atom id and the predicate that produced it — an applicability
// answer the engine cannot explain is not usable in a memo.
import { load, inForceOn, surfaceable } from './corpus.mjs';
import { evaluate, UNKNOWN } from './predicates.mjs';
import { applyExemptions } from './exemptions.mjs';
import { computeDeadline } from './timeline.mjs';
import { resolve as resolvePreemption } from './preemption.mjs';
import { backstops } from './backstops.mjs';
import { coverageFor, instrumentCoverage } from './coverage.mjs';

export function analyze(entity = {}, data = {}, context = {}) {
  const as_of = context.as_of;
  if (!as_of) {
    // Invariant I2: as_of is required and has NO default. Defaulting to today would make
    // the same query return different law on different days with no record of why.
    return { error: 'context.as_of is required. There is no "current law" — only law as of a date.',
             as_of: null, applicable: [], exempt: [], not_applicable: [], preemption_notes: [],
             backstops: [], obligations: [], deadlines: [], enforcement_summary: [],
             pending_watch: [], coverage_gaps: [], unverified_excluded: [], unknown_facts: [] };
  }
  const corpus = load();
  const facts = { entity, data, event: context.event ?? {}, purpose: context.purpose ?? {},
                  practice: context.practice ?? {},
                  // law was hardcoded to {} while two FCRA preemption atoms predicate on
                  // law.federal_instrument and law.state_requirement_subject. Their predicates
                  // are grammatical and evaluable, so gate 21 passed them; they simply could
                  // never be TRUE, because nothing ever filled the namespace. DEBT-009's shape
                  // once more — an atom written against a field the engine does not supply.
                  law: context.law ?? {} };

  const applicable = [], exempt = [], not_applicable = [], pending_watch = [],
        unverified_excluded = [], unknown_facts = [], obligations = [], deadlines = [];

  for (const a of corpus.obligations) {
    // Pending law NEVER enters obligations. It routes to the watch feed only (I3).
    if (a.status !== 'in_force') {
      if (context.include_pending && ['enacted_pending', 'proposed'].includes(a.status))
        pending_watch.push({ atom_id: a.id, status: a.status, citation: a.source.citation,
          effective_from: a.effective_from,
          note: 'PENDING — not law. Present in the watch feed only; it can never appear in obligations.' });
      else
        not_applicable.push({ instrument_id: a.source.instrument_id, atom_id: a.id,
          failed_predicate: `status is "${a.status}", not in_force` });
      continue;
    }
    if (!inForceOn(a, as_of)) {
      not_applicable.push({ instrument_id: a.source.instrument_id, atom_id: a.id,
        failed_predicate: `not in force on ${as_of} (effective_from ${a.effective_from ?? 'null'}, effective_to ${a.effective_to ?? 'null'})` });
      continue;
    }
    // Invariant I1: suppression is visible, never silent.
    if (!surfaceable(a)) {
      unverified_excluded.push({ atom_id: a.id, verification_status: a.verification_status,
        note: 'suppressed by invariant I1 — not verbatim_confirmed, so it may not be surfaced' });
      continue;
    }

    const r = evaluate(a.applies_if, facts);
    if (r.value === UNKNOWN) {
      // Carry the atom's own summary. "event.type is not among the supplied facts" is accurate
      // and useless: a reader seeing § 1681s-2(b) unresolved needs to know the duty is dormant
      // until a CRA dispute notice arrives, NOT that the furnisher is outside the statute. The
      // summary says which trigger is missing, in the statute's own terms.
      unknown_facts.push({ atom_id: a.id, citation: a.source.citation, needs: r.why,
        obligation: a.summary,
        note: 'Undetermined: a fact the predicate needs was not supplied. NOT treated as applicable, and not ' +
              'treated as inapplicable either — supply the fact to resolve it. The obligation above states ' +
              'the trigger; this is a dormant duty awaiting a fact, never a finding that none applies.' });
      continue;
    }
    if (r.value === false) {
      not_applicable.push({ instrument_id: a.source.instrument_id, atom_id: a.id, failed_predicate: r.why });
      continue;
    }

    const ex = applyExemptions(a, facts);
    if (ex.exempt) {
      // reach travels with the verdict. Without it a caller sees exempt=true and cannot tell
      // whether the entity is outside the instrument or merely relieved of this one duty —
      // which is the difference between "no compliance programme" and "every other duty still
      // applies". citation is carried here too, because an exempt result gets quoted as often
      // as an applicable one.
      exempt.push({ instrument_id: a.source.instrument_id, atom_id: a.id,
        citation: a.source.citation, exemption: ex.matched, level: ex.level, reach: ex.reach,
        reasoning: ex.reasoning.join(' ') });
      continue;   // never in both applicable and exempt
    }
    // DEC-007. A partially-extracted instrument still answers, WITH A STRUCTURAL CAVEAT. The
    // preemption answer is correct and useful; what is not acceptable is returning it silently
    // over a substantive void. Naming the absent duty categories here — not only in a reasoning
    // string — is the condition the decision was taken on.
    const icov = instrumentCoverage(a.source.instrument_id, corpus);
    applicable.push({ instrument_id: a.source.instrument_id, atom_id: a.id,
      citation: a.source.citation, decided_by: r.decided_by, why: r.why,
      instrument_completeness: icov.complete ? null : {
        declared: icov.declared,
        present: icov.present.map(x => x.id),
        absent: icov.absent.map(x => ({ id: x.id, citations: x.citation_prefix ?? [], supplies: x.supplies })),
        note: icov.summary },
      partial_carve_out: ex.residual_scope ? { level: ex.level, scope: ex.residual_scope,
        note: 'DATA/ACTIVITY-LEVEL carve-out only. The entity remains in scope for everything else under this instrument.' } : null });
    obligations.push(a);
    const dl = computeDeadline(a, context.event?.[a.deadline?.trigger_event] ?? context.event?.date ?? null);
    if (dl) deadlines.push(dl);
  }

  const preemption_notes = [];
  for (const a of obligations) {
    if (a.jurisdiction_level !== 'federal') continue;
    for (const j of context.state_layers ?? []) {
      const stateAtom = corpus.obligations.find(s => s.jurisdiction === j && s.related?.some(r => (r.id ?? r) === a.id));
      preemption_notes.push(resolvePreemption(a, stateAtom, as_of));
    }
    if (!(context.state_layers ?? []).length) preemption_notes.push(resolvePreemption(a, null, as_of));
  }

  const enforcement_summary = summariseEnforcement(obligations, corpus);
  const coverage_gaps = findGaps(obligations, context, corpus);

  return { as_of, applicable, exempt, not_applicable,
           preemption_notes, backstops: backstops(entity, context),
           obligations: obligations.map(o => ({ id: o.id, citation: o.source.citation,
             obligation_type: o.obligation_type, summary: o.summary,
             verbatim_span: o.verbatim_span,
             operative_context: (o.operative_context ?? []).map(x => ({ position: x.position, relation: x.relation, verbatim_span: x.verbatim_span })) })),
           deadlines, enforcement_summary, pending_watch, coverage_gaps, unverified_excluded, unknown_facts };
}

function summariseEnforcement(obligations, corpus) {
  const by = new Map();
  for (const a of obligations) {
    for (const e of a.enforcement?.enforcers ?? []) {
      if (!by.has(e)) {
        const auth = corpus.authorities.find(x => x.authority.id.endsWith(e) || x.authority.short_name?.toLowerCase() === e);
        by.set(e, { enforcer: e, authority_id: auth?.id ?? null,
          private_right_of_action: false, atoms: [], penalty_notes: new Set() });
      }
      const row = by.get(e);
      row.atoms.push(a.id);
      if (a.enforcement?.private_right_of_action) row.private_right_of_action = true;
      if (a.enforcement?.penalty?.note) row.penalty_notes.add(a.enforcement.penalty.note);
    }
  }
  return [...by.values()].map(r => ({ ...r, penalty_notes: [...r.penalty_notes] }));
}

function findGaps(obligations, context, corpus) {
  const gaps = [];
  const touched = new Set(obligations.map(o => o.subject?.domain).filter(Boolean));
  // Coverage is DECLARED, never inferred from presence. The previous test asked whether any
  // atom carried this jurisdiction, which three GBL § 349 UDAP atoms satisfied while the
  // SHIELD Act breach clock was absent — the gap disappeared exactly when the corpus grew.
  for (const j of context.state_layers ?? []) {
    const cov = coverageFor(j, corpus);
    if (!cov.declared || cov.missing.length) gaps.push(cov.summary);
  }
  // An instrument that ANSWERED is exactly the one whose incompleteness is easiest to miss —
  // the reader has a citation in hand and no reason to suspect a void behind it.
  for (const inst of [...new Set(obligations.map(o => o.source?.instrument_id).filter(Boolean))].sort()) {
    const ic = instrumentCoverage(inst, corpus);
    if (!ic.complete) gaps.push(ic.summary);
  }
  if (!obligations.length)
    gaps.push('No sectoral obligation matched these facts. That is a real answer, not a failure: see backstops.');
  for (const t of touched) if (!t) gaps.push('an obligation carries no taxonomy coordinate');
  return gaps;
}
