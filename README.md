# Privacy-KB

**A local engine for US federal and New York privacy law.** It answers as of a date, computes
what recall cannot, and produces artifacts you can verify, diff and re-run.

Every provision is quoted verbatim from primary source and carries the SHA-256 of the bytes it was
verified against. Nothing is synthesised at query time, and nothing leaves the machine it runs on.

[![gates](https://github.com/rakib-nyc/privacy-kb/actions/workflows/ci.yml/badge.svg)](https://github.com/rakib-nyc/privacy-kb/actions/workflows/ci.yml)
[![licence](https://img.shields.io/badge/licence-Apache%202.0-blue)](LICENSE)

> **Research prototype. Not legal advice. No warranty of any kind.** Every output must be checked
> by a qualified person against the primary source before it is relied on — each record carries its
> source URL, fetch date and content hash so that checking is possible. See
> [`LICENSE`](LICENSE) §§ 7–8, which govern.

---

## What it does

Four capabilities, each answering a question the others cannot.

| | | |
|---|---|---|
| **Answer** | Which obligations apply, as of a date, with exemptions typed and preemption resolved | `ask` `deadlines` `breach` `may-i` `cite` `brief` `find` `interview` |
| **Compute** | Things that cannot be recalled, only calculated | `exposure` `between` `requirements` `conform` `overlaps` |
| **Prove** | Artifacts that re-run identically and can be handed to someone else | `memo` `receipt` `profile` `register` `calendar` |
| **Audit** | Check the claims and citations in any answer — including ones this engine did not write | `ground` `premise` |

```bash
privacy-kb ask --hipaa --ny-data --breach --told-hhs
privacy-kb deadlines --hipaa --ny-data --breach --from 2026-09-08
privacy-kb exposure --hipaa                     # which facts would change the answer
privacy-kb between 2022-06-01 2023-06-01 --nyc-hiring
privacy-kb ground --text answer.txt --as-of 2026-09-16
```

---

## The four capabilities

### Answer — as of a date, or not at all

There is no "current law" here. Every query resolves against a date, exemptions are typed objects
rather than flags, and preemption is resolved rather than assumed.

```
$ privacy-kb deadlines --hipaa --ny-data --breach --from 2026-09-08

  Sep 15   GBL § 899-aa(9) · 5 business days to the NY Attorney General
           Triggered by notifying HHS — not by discovery.
  Oct  8   GBL § 899-aa(2) · notify New York residents, 30 days
  Nov  7   45 C.F.R. §§ 164.404(a), 164.406(a), 164.408(a) · four HIPAA clocks, 60 days
```

A clock starts only when its own trigger is dated. An obligation whose trigger has no date is
reported as **not started**, never given a borrowed one.

### Compute — what recall cannot do

**`exposure`** sweeps roughly 500 applicability evaluations across 126 fact keys to answer *which
facts would change this answer* — the counterfactual, enumerated rather than sampled.

**`between`** diffs two dates from stored vintages, and separates three things a single "changed"
would collapse: what **commenced**, what the corpus **cannot attribute** to a dated legal event,
and what it could not be asked about at all.

**`requirements`** enumerates every element a provision imposes against the segmentation of its own
source file, so the denominator is declared rather than implied.

**`conform`** lays every element of a provision beside your document as a worksheet. **The verdict
column is deliberately empty** — the worksheet supplies the requirement and the governing words,
not the conclusion.

### Prove — artifacts, not prose

**`receipt`** issues a digest a third party can verify, including you, later, without trusting you.
**`memo`** produces a citable record of a whole analysis, every provision with its URL, hash and
vintage. Same inputs give byte-identical output, across processes.

**`profile`** keeps a standing fact set and a register. Every check appends, recording whether the
**corpus** moved, the **facts** moved, the **date** moved, or the **answer** moved:

```
Register  3 check(s)
  2026-09-16  as of 2022-06-01    2 obligation(s)  baseline
  2026-09-16  as of 2023-06-01   11 obligation(s)  date+result
  2026-09-16  as of 2026-09-16   11 obligation(s)  date+result
```

*"This says something different than last quarter — did the law change, or did we?"* is answerable
because the four causes are recorded separately.

### More of each

**`interview`** answers the question that comes *before* an analysis: the corpus predicates on 193
fact keys and nobody knows which matter to them. It finds every predicate currently evaluating to
UNKNOWN, ranks the unsupplied facts by how many obligations each is blocking, and asks in words —
*"Is the organisation a GLBA financial institution?"* — with the values it takes. It also reports
how many obligations are sitting in UNKNOWN, which is **not** the same as "does not apply" and is
invisible in an ordinary analysis.

**`overlaps`** answers which duty actually binds when several regimes reach one event. Six
obligations hang off `discovery_of_breach` at 30 and 60 days:

```
$ privacy-kb overlaps --hipaa --ny-data --breach --from 2026-09-08

  discovery of the breach  30d spread
    BINDS N.Y. Gen. Bus. Law § 899-aa(2)   30 calendar days  due 2026-10-08
          45 C.F.R. § 164.404(a)(1)        60 calendar days +30d  due 2026-11-07
          …
    The shortest period binds the work. It does NOT discharge the others.
```

Business-day periods are reported but never ordered against calendar periods: the conversion
depends on the start date, and a wrong guess loses a deadline rather than gaining one.

**`register`** is the standing obligation register — every duty that applies, whether its clock is
running, and **what evidence exists for it**. The headline number is the empty column: a register
listing 28 duties with 1 evidenced and 27 not is a finding. Evidence bound to an obligation that no
longer applies is reported separately, because it reads as coverage and is not. Exports to CSV and
Markdown.

**`calendar`** writes the computed deadlines as an RFC 5545 feed, each entry carrying its governing
language, trigger and source hash. **Only clocks that have started are written.** An obligation
whose trigger has no date is listed separately with no entry, because inventing one would put a
confident date on an event that has not happened.

### Audit — check an answer this engine did not write

`ground` takes citations, or the raw prose of any answer, and reports per citation whether it
resolves, whether it was in force on the date given, whether it is enacted-but-pending or
superseded, and — with facts supplied — whether it **reaches the entity being advised**.

```
$ privacy-kb ground --text answer.txt --as-of 2026-09-16

  ✗ N.Y. Gen. Bus. Law § 1501(1)      PENDING_NOT_BINDING
        enacted but not in force until 2027-01-25; citing it for what is
        required today asserts a duty that binds nobody yet
  ✗ 45 C.F.R. § 164.404(b)            DOES_NOT_REACH_THESE_FACTS
        predicate: entity.is_hipaa_covered_entity (false) == true -> false
  ? Cal. Civ. Code § 1798.82          CITATION_NOT_HELD
        not held here — a statement about this corpus, NOT a finding that
        the citation is fabricated
```

The second finding is the one a click-through cannot produce: a provision that is real, quoted
correctly, and inapplicable to the entity being advised.

**`premise`** checks the assumption *inside* the question rather than the answer to it. Asked
*"since HIPAA preempts state breach law, we only notify HHS — what's the deadline?"*, answering the
deadline agrees with the preemption claim by not objecting. 45 C.F.R. § 160.203 records HIPAA as a
**floor**, so the premise is contradicted by the corpus rather than by an opinion about it. It
types four premise shapes — preemption, in-force, "no law applies", and exemption — and reports an
exemption's **type**, because an entity-level exemption removes the instrument while a data-level
one removes a slice and leaves you inside for everything else.

It never reports a premise *true*: `CONSISTENT` means the corpus does not contradict it. And a
premise of a shape it cannot type is not reported at all, so an empty result is never an
all-clear.

**Two things it never says.** It never reports a claim *correct* — whether quoted words support a
proposition is a reading, and this engine does not make readings; the clean status is
`NO_PROBLEM_FOUND`, never "verified". And it never reports a citation *fabricated* — coverage is
federal, New York State and New York City, so a real provision outside that scope resolves to
nothing for the same reason an invented one would.

---

## What it refuses to do

The refusals are enforced in code and exercised in CI, not left to convention.

- **It will not answer without a date.** A malformed date is refused too: date comparisons are
  string comparisons, so a typo would otherwise sort above every real date and silently report law
  that is not yet in force.
- **It will not treat enacted law as binding early.** A pending record routes to a watch feed and
  cannot become an obligation at *any* as-of date until a person promotes it.
- **It will not hide what it cannot reach.** Coverage gaps, element shortfall against a source's
  own segmentation, and date windows it cannot be asked about are returned *with* the answer.
- **It will not guess a preemption posture.** Where the statute does not speak to the question, the
  posture is reported as unresolved.
- **It will not quote what it could not verify.** A record that fails verification against its
  stored source is suppressed from every output, by the loader rather than by each caller.

---

## Worked example

**Meridian Health** — a telehealth startup, Delaware incorporated, offices in Austin. **No New York
office and no New York employees.** It has New York patients, hires in New York City with an
automated screening tool, and has minors on its platform.

![Breach notification deadlines — five business days to the New York Attorney General is the earliest, and notifying HHS is what started it](examples/timeline.svg)

**The earliest deadline is one that doing the federal thing correctly created.** N.Y. Gen. Bus. Law
§ 899-aa(9) gives a HIPAA covered entity five business days *from notifying the Secretary of HHS*
to notify the New York Attorney General. A company that files federally and then works through its
30-day and 60-day obligations has, by day six, already missed the first one.

Three things the analysis pins down rather than assumes:

- **There is no nexus threshold.** § 899-aa attaches to *holding a New York resident's private
  information*. No office, no employees, no revenue floor — one patient is enough.
- **HIPAA does not preempt it.** 45 C.F.R. § 160.203 makes HIPAA a floor, so more stringent state
  law survives.
- **The compliance-deemed pathway does not rescue it.** § 899-aa(2)(b) is typed `activity_level`,
  not `entity_level`: it removes notice to people already notified federally and expressly
  preserves notice to the Attorney General.

![How a query is answered — the applicability path is deterministic code](examples/pipeline.svg)

**[→ Full worked example](examples/README.md)** — four scenarios, every figure live engine output,
reproducible with `node examples/run-scenario.mjs`.

---

## Getting it running

**New to the terminal? [Follow INSTALL.md](INSTALL.md)** — about five minutes, no experience
assumed.

```bash
npm install
npm run doctor                 # check the install
npm run setup -- --write       # register it with an MCP client, then restart the client
```

It runs two ways. As a **command-line tool**, shown throughout this page. And as an
**[MCP](https://modelcontextprotocol.io) server** exposing 31 tools, so an assistant you already
use can call the engine instead of recalling the law — every quotation hash-anchored, every answer
reproducible, and the gaps computed rather than glossed.

---

## What is in it

<!-- state-of-build:begin -->
<!-- Generated by tools/state-of-build.mjs. Do not hand-edit: npm test fails on a stale table. -->

| | |
|---|---|
| Records | **1,838** — 227 analysed obligations the engine reasons with, 1,581 held as verified reference text with no applicability predicate, plus 9 authority, 5 definition, 5 principle, 5 workflow_constraint, 3 doctrine, 2 taxonomy, 1 enforcement_action |
| Verified | 1,834 `verbatim_confirmed` · 4 suppressed by invariant I1 and unreachable from any output |
| Instruments | 54 declared · **41 fully present** against their declared duty categories · 13 partial, with the missing provisions named in every answer that touches them |
| taxonomy leaves covered | 31 / 69 · 38 neither covered nor ruled out of scope, and gate 34 ratchets that number |
| CI gates | **50**, all named · 63 fixtures · 37 gates fixture-exercised, 13 declared unexercisable in `tests/fixtures/no-fixture.yaml` and why |
| Walker assumptions | 13 declared, 13 with an executable test |
| Engine | 31 modules · property tests covering both halves of invariant I6, as-of validation, the trigger and incident vocabularies, version-chain semantics, and totality of every entry point |
| MCP server | **31 tools**, incl. `privacy_memo` (the defensibility record), `privacy_facts` (the input vocabulary), `privacy_incidents`, `privacy_workflow` |
| Workflows | 4 lifecycle-indexed, reachable from the CLI and MCP |
| Eval scenarios | 30, all-pass baseline enforced by gate 8 |
| Prior vintages not held | **280**, each named in `meta/missing-vintages.yaml` — provisions whose stored text is current but whose earlier text this repository does not hold, so an as-of question before that date is refused rather than answered from the wrong vintage |

<!-- state-of-build:end -->

Coverage is **declared before it is measured**, instrument by instrument, so the corpus knows what
it is missing. Every figure above is generated from the repository; a hand-typed count drifts.

**New York is built, not bolted on.** SHIELD, the Child Data Protection Act and its OAG guidance,
the SAFE for Kids Act, GBL §§ 349/350, Education Law § 2-d, Civil Rights Law §§ 50/51 and § 52-c,
Penal Law §§ 250.00/250.05, and NYC Local Law 144 with its 6 RCNY implementing rules.

---

## Where it is weak

Published because a tool that hides these is less trustworthy than one that does not.

- **Narrow by design.** US federal, New York State, New York City. No other state, no GDPR beyond
  transfer-mechanism touchpoints, almost no case law.
- **Thin in places, and it says where.** It holds 1 of the 129 elements beneath 15 U.S.C. § 1681g.
  Element shortfall is computed per duty category and travels with the answer.
- **529 of 1,837 records carry a date that cannot anchor an as-of comparison** — the date records
  when the text was captured, not when the law began. `between` reports those differences as
  unattributable rather than as change.
- **Business days mean weekdays.** Public holidays are not excluded, so a clock crossing one lands
  a day early. Every affected result says so.
- **Pending law does not promote itself.** That is the point, and it also means the corpus needs
  maintaining: the SAFE for Kids Act commences 25 January 2027.

---

## How it is verified

The corpus is plain files in git — one record per file, no database — and **50 CI gates** run over
it on every change. They check that a quoted span appears in the stored source bytes, that a
paragraph path resolves to exactly one leaf and agrees with its own citation, that a version chain
has no gaps, that a date's basis is derived from the source rather than declared, and that no gate
can be listed without being implemented.

37 gates are exercised by fixtures built to trip them; the other 13 are declared unexercisable in
[`tests/fixtures/no-fixture.yaml`](tests/fixtures/no-fixture.yaml), with the reason, so a new gate
cannot quietly join the untested set.

`npm test` runs the whole apparatus: the gates, the fixture suite, the engine property tests, the
MCP wire contract, the evals, and the generated-file staleness checks.

---

## Documentation

| | |
|---|---|
| [`INSTALL.md`](INSTALL.md) | Installation for non-technical readers |
| [`DESIGN.md`](DESIGN.md) | The invariants and the architecture — read before changing anything |
| [`SCHEMA.md`](SCHEMA.md) | The record shape and the tool surface |
| [`PROVENANCE.md`](PROVENANCE.md) | Where every source came from and how it is verified |
| [`examples/README.md`](examples/README.md) | Four worked scenarios with live output |

---

## Licence

[Apache 2.0](LICENSE) for the original work. Quoted legal text is government edict and carries no
copyright. See [`NOTICE`](NOTICE) and [`PROVENANCE.md`](PROVENANCE.md).

**Muhammad Rakibul Islam** · [@rakib-nyc](https://github.com/rakib-nyc)
