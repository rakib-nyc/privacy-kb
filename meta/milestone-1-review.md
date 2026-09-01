# Milestone 1 review — 2026-08-19

The target was the smallest corpus that answers most real US privacy questions with grounded
citations. It answers them. What follows is what it holds, what it does, and — at more length,
because it is the more useful half — what it still cannot do.

## What it holds

111 records. 54 obligations across 13 instruments, 55 typed exemptions, 3 definition records,
11 authorities, 39 principles, 2 certification schemes, 2 taxonomies. Nothing `unverified`.

Completeness is measured per instrument against declared duty categories, so what the corpus
cannot answer is computed rather than remembered:

| Instrument | Categories |
|---|---|
| FTC Act § 5 | **2/2** |
| HIPAA Privacy Rule | **6/6** |
| FACTA Disposal Rule | **1/1** |
| N.Y. GBL § 349 | **2/2** |
| N.Y. GBL § 350 | **1/1** |
| FCRA | 6/7 — § 1681g refused, DEBT-015 |
| GLBA Privacy Rule | 4/5 |
| N.Y. GBL § 899-aa | 3/4 |
| HIPAA Breach Notification | 3/4 |
| COPPA Rule | 2/4 |
| VPPA | 2/3 |
| N.Y. GBL § 899-bb | 1/2 |
| GLBA Safeguards Rule | 1/3 |

31 CI gates, 51 fixtures, 31 eval scenarios, 221 criteria, all passing. Every declared New York
citation now carries the heading the source actually publishes, next to the heading we claim.

## What it does end to end

One query — an out-of-state HIPAA covered entity, breached, holding a New York resident's data,
having notified HHS, publishing a privacy commitment — exercises all eight steps of the BRIEF.md
analysis order and returns:

```
APPLICABLE   15 U.S.C. § 45(a)(1) deception · § 45(a)(1) public commitment · § 45(n) unfairness
             45 C.F.R. § 164.502(a) · § 164.502(b) minimum necessary
             N.Y. Gen. Bus. Law § 899-aa(2) · § 899-aa(9)
DEADLINES    2026-08-12  § 899-aa(9)   five business days from the HHS notice
             2026-08-31  § 899-aa(2)   thirty days from discovery
BACKSTOPS    FTC Act § 5 · NY UDAP (GBL § 349) · published notice commitments
PREEMPTION   § 5 none/no_displacement · HIPAA floor/both_apply
GAPS         US-NY: 2 of 13 declared instruments present. MISSING 11: ...
```

The earlier deadline is a state duty **triggered by federal compliance**. A tool that treated
HIPAA as occupying the field would return the later date and miss the one that binds.

## The three findings worth carrying forward

**Silent absence is worse than a wrong record.** Gate 23's discovery was the largest correctness
finding by volume: 133 provisions in 45 C.F.R. 164 had been swallowed into their predecessors'
text, and in 45 C.F.R. 160.103 one `paragraph_path` was shared by twenty defined terms. Nothing in
the extraction reported an absence. A wrong atom is at least visible. The gate's shape is the
lesson — it does not demand perfect segmentation, which is impossible against a source that ships
CFR body text as flat `<P>` siblings with no depth attribute. It demands that no atom cite an
ambiguous path. Irreducible ambiguity is a fact about the source; citing into it is a choice.

**Any field the engine reads must be a field the schema requires.** DEBT-009: the schema forbade
`applies_if` on exemptions while `engine/exemptions.mjs` read it, so invariant I4 was inert while
three green signals sat on top of it. Gate 22 is the structural fix — it walks every record-field
read in `engine/` and `mcp/` against the schema. The property tests could not have caught it,
because they built objects the corpus can never contain.

**Coverage is declared, never inferred from presence.** Three GBL § 349 UDAP atoms satisfied a
"does US-NY have atoms" test while the SHIELD breach clock was missing — the gap vanished exactly
when the corpus grew. The same shape appeared in `findGaps`, and its inverse in `backstops.mjs`,
which matched `/udap|deceptive/` against atom ids and so reported the New York UDAP statute
unavailable while the corpus held it. Gate 25 now requires a jurisdiction to declare what it is
supposed to hold before any query can call it covered.

## What it cannot do, stated plainly

- **New York is 2 of 13 declared instruments.** No § 899-bb safeguards, no Child Data Protection
  Act, no Labor Law § 203-f, no Education Law § 2-d, no NYDFS Part 500. `coverage_gaps` names all
  eleven on every NY query, so the tool says so rather than implying a clean bill.
- **No other state.** Out of scope for v1, and the engine reports an undeclared layer as unknown
  rather than clear.
- **HIPAA is two atoms.** § 164.502(a) and (b). No individual rights, no authorisations, no
  business-associate contract terms, no Security Rule.
- **FCRA has preemption atoms but no duties.** §§ 1681b, 1681e, 1681i, 1681s-2 are absent, so the
  corpus can say FCRA displaces a state law without saying what FCRA itself requires.
- **GLBA Privacy is 16 C.F.R. 313 only.** Post-Dodd-Frank that Part reaches essentially only motor
  vehicle dealers; Regulation P (12 C.F.R. 1016) governs everyone else and is not in the corpus.
  The atoms say so in `common_errors`, but a bank question still gets a gap rather than an answer.
- **Nine reconstructed paragraph paths remain ambiguous** (DEBT-010) in sources not yet promoted.
  Gate 23 blocks any atom from citing them.
- **The coverage declaration is transcribed by hand** (DEBT-013) and nothing checks it against
  CORPUS-MANIFEST.md.
- **One open provenance question**: the bill behind the 2026-04-03 amendment to GBL § 349 is
  unidentified. It stays in `open_questions` until the print number is found, and must not be
  closed by inference.

## The five defect shapes this milestone actually produced

Ranked by how quiet they were, because that turned out to be the thing that mattered:

1. **A provision that was never emitted.** 16 C.F.R. § 314.6 — the Safeguards Rule's
   size-threshold exemption — silently absent because the eCFR walker required a designator.
   Nothing in the corpus can see a provision that was never extracted, so no gate could have
   caught it. Answered by `meta/extractor-assumptions.yaml` and a conformance suite every walker
   must pass, because the same premise had already been fixed once in a different walker.
2. **A gate with no input.** Gate 23 was blind to fourteen atoms for their entire existence, and
   reported a healthy-looking number throughout. Answered by gate 32's skip ledger.
3. **A fabricated explanation for a gap that did not exist.** The engine held GBL § 349 and
   reported the New York UDAP backstop unavailable, blaming a resolved API-key blocker.
4. **A denominator with a wrong entry.** Labor Law § 203-f claimed as electronic-monitoring
   notice for the whole project. Answered by gate 31 recording the source's own heading.
5. **A capability that could not fire.** DEBT-009 and its three successors — schema and engine
   disagreeing, engine reading undefined fields, engine predicating on unfilled namespaces,
   operator semantics disagreeing with fact shapes.

Every one produced green signals over something that did not work. The countermeasure in each
case was the same inversion: declare what should be there, then compare — never infer completeness
from what happens to be present.

## Debt

Closed: DEBT-001, 008, 009, 011, 012. Mitigated: DEBT-007, 010, 013. Open: 002–006.
