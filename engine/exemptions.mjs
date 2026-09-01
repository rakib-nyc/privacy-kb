// Typed exemptions. Invariant I4.
//
// The distinction that matters is entity_level vs data_level, and it is the single most
// common expert/novice divider in US privacy law. entity_level removes the instrument
// entirely. data_level removes ONLY the matching data and MUST leave the entity in scope
// for everything else — a HIPAA covered entity is exempt for PHI and NOT exempt for the
// wellness data its consumer app collects.
import { evaluate, UNKNOWN } from './predicates.mjs';

export function applyExemptions(atom, facts) {
  const out = { exempt: false, level: null, reach: null, matched: [], residual_scope: null, reasoning: [] };
  for (const ex of atom.exemptions ?? []) {
    const r = ex.applies_if ? evaluate(ex.applies_if, facts) : { value: UNKNOWN, why: 'exemption has no predicate' };
    if (r.value !== true) {
      out.reasoning.push(`${ex.id}: not applied — ${r.why}`);
      continue;
    }
    out.matched.push({ id: ex.id, type: ex.type, reach: ex.reach ?? null, scope: ex.scope, why: r.why });
    if (ex.type === 'entity_level' || ex.type === 'size_threshold') {
      out.exempt = true; out.level = ex.type;
      // MIGRATION 005. reach is not decoration — it is the difference between two pieces of
      // advice a lawyer acts on differently. An entity outside the instrument has no compliance
      // programme to build. An entity relieved of one duty still has every other notice, opt out
      // and restriction, and a reader told "does not reach this entity" would stop looking.
      // So the SENTENCE changes with the field, not just the field.
      out.reach = ex.reach ?? out.reach ?? null;
      if (ex.reach === 'obligation') {
        out.reasoning.push(
          `${ex.id} (${ex.type}, reach=obligation): this entity does not owe THIS obligation. It ` +
          `REMAINS FULLY COVERED by the rest of the instrument — every other notice, opt out and ` +
          `restriction still applies. Do not read this as relief from the instrument.`);
      } else if (ex.reach === 'instrument') {
        out.reasoning.push(
          `${ex.id} (${ex.type}, reach=instrument): the instrument does not reach this entity at ` +
          `all. Note that this is not necessarily relief from the underlying LAW — an exclusion ` +
          `can allocate the entity to a different regulator's rule. See the exemption's scope.`);
      } else {
        // An entity-level exemption without reach is unevaluable in the way that matters: the
        // verdict is right and the explanation cannot be written. Say so rather than guessing.
        out.reasoning.push(
          `${ex.id} (${ex.type}): exempt, but the exemption declares no reach, so the engine ` +
          `CANNOT say whether the entity is outside the instrument or merely relieved of this ` +
          `duty. Treat the scope of this relief as unresolved.`);
      }
    } else if (ex.type === 'data_level' || ex.type === 'activity_level') {
      // NOT exempt from the instrument. Only this data or activity leaves scope.
      out.level = out.level ?? ex.type;
      out.residual_scope = (out.residual_scope ?? []).concat([ex.scope]);
      out.reasoning.push(
        `${ex.id} (${ex.type}): ${ex.scope} is carved out, but the entity REMAINS IN SCOPE for all other ` +
        `data and activities under this instrument. Collapsing this into an entity-level exemption is the ` +
        `headline failure mode this field exists to prevent.`);
    } else if (ex.type === 'temporal') {
      out.exempt = true; out.level = 'temporal';
      out.reasoning.push(`${ex.id} (temporal): relief applies as of the queried date.`);
    }
  }
  return out;
}
