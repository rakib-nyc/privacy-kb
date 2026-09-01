// Federal ↔ state preemption resolution. Invariant I5.
//
// The postures are not interchangeable and getting one wrong produces confidently
// incorrect advice, which is worse than refusing:
//   floor           both apply; the more stringent governs
//   ceiling         federal caps state
//   field           federal only
//   express_partial a carve-out MAP applies — per subject, and sometimes per date
//   none            no displacement
export function resolve(federalAtom, stateAtom, asOf) {
  const p = federalAtom.preemption ?? { posture: 'none' };
  const base = {
    federal_id: federalAtom.id, state_id: stateAtom?.id ?? null,
    posture: p.posture, authority: p.authority ?? null, as_of: asOf,
  };
  switch (p.posture) {
    case 'floor':
      return { ...base, outcome: 'both_apply',
        note: `Federal law is a floor. More stringent state law is not displaced and runs in parallel; ` +
              `where deadlines differ the shorter governs in practice. ${p.note ?? ''}`.trim() };
    case 'ceiling':
      return { ...base, outcome: 'federal_caps_state',
        note: `Federal law sets a ceiling; state law may not exceed it. ${p.note ?? ''}`.trim() };
    case 'field':
      return { ...base, outcome: 'federal_only',
        note: `Federal law occupies the field; state law is displaced. ${p.note ?? ''}`.trim() };
    case 'express_partial':
      return { ...base, outcome: 'depends_on_carveout_map',
        requires: 'subject-by-subject resolution against the express preemption provision, time-indexed',
        note: `Express and PARTIAL. Preemption reaches only the enumerated subjects, and some carve-outs ` +
              `are date-limited — the same state provision can be preempted or preserved depending on the ` +
              `as_of date. Resolve against the provision; do not generalise. ${p.note ?? ''}`.trim(),
        unresolved: true };
    case 'none':
    default:
      return { ...base, outcome: 'no_displacement',
        note: p.note ?? 'No preemption provision, or none applicable.' };
  }
}
