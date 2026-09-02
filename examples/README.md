# A worked example

> **Experimental research project — not legal advice.** Everything below is machine-derived output
> from a research prototype. It carries no warranty, AI assistance was used in building the corpus
> it draws on, and **every citation must be checked against the primary source by a qualified
> human before it is relied on.** See the [main README](../README.md) and [`LICENSE`](../LICENSE).

Everything on this page is real output. Reproduce it with:

```bash
node examples/run-scenario.mjs        # writes examples/output.txt
```

## The company

**Meridian Health** — a telehealth startup. Delaware incorporated, offices in Austin. A HIPAA
covered entity. **No New York office and no New York employees.** It has New York patients, hires
in New York City using an automated screening tool, and has minors on its platform.

That last paragraph is the whole point: on a naive reading, a Texas company with no New York
presence has no New York exposure. It has a great deal.

![How a query is answered](pipeline.svg)

## Scenario 1 — a breach on 8 September 2026

Facts in: covered entity, owns computerised data including a New York resident's private
information, has notified the Secretary of HHS, `as_of: 2026-09-08`.

### The result that justifies the project

```
DEADLINES, earliest first
  2026-09-15  5 business_days    N.Y. Gen. Bus. Law § 899-aa(9)
             trigger: notification to the Secretary of Health and Human Services
             ⚠ business days = weekdays; holidays not excluded
  2026-09-22  10 business_days   6 RCNY § 5-304(b)
             trigger: use of an AEDT on a candidate for employment
             ⚠ business days = weekdays; holidays not excluded
  2026-09-22  10 business_days   N.Y.C. Admin. Code § 20-871(b)
             trigger: use of the tool to assess a candidate or employee residing in the city
```

![Breach notification deadlines](timeline.svg)

**The earliest deadline is one that doing the federal thing correctly created.**

§ 899-aa(9) gives a HIPAA covered entity **five business days from notifying the Secretary** to
notify the New York Attorney General. The clock does not start on discovery — it starts on the
federal notification. An entity that files with HHS promptly and then works through its 30-day
and 60-day obligations has, on day six, already missed the earliest one on the list.

Three further things the engine gets right here, each of which a naive answer gets wrong:

1. **There is no nexus threshold.** § 899-aa attaches to *holding a New York resident's private
   information*. No office, no employees, no revenue floor. One patient is enough.
2. **HIPAA does not preempt this.** 45 C.F.R. § 160.203 makes HIPAA a **floor**; more stringent
   state law survives. The engine resolves the posture rather than assuming displacement.
3. **The compliance-deemed pathway does not rescue it.** § 899-aa(2)(b) is typed
   `activity_level`, not `entity_level` — it removes notice to *affected persons* who were already
   notified federally, and expressly preserves notice to the Attorney General. The result carries
   a `partial_carve_out` saying the entity remains in scope for everything else.

### The backstops, which never switch off

```
15 U.S.C. § 45(a)(2)          FTC Act § 5 — unfair or deceptive acts in or affecting commerce
N.Y. Gen. Bus. Law § 349(a)   the New York UDAP statute
N.Y. Gen. Bus. Law § 350      false advertising
published_notice_commitments  the entity's own privacy notice is an operative constraint
```

Invariant I6: the system never answers "no law applies." Where no sectoral statute reaches a
practice, it says which constraints still do — including the company's own published promises,
which is the one most often forgotten.

## Scenario 2 — hiring in New York City with an automated tool

Nine obligations across two instruments, and they interlock: the Administrative Code creates the
duties (**§ 20-871**) and the City rules say what discharges them (**6 RCNY Subchapter T**).

The substantive requirement most often missed is `6 RCNY § 5-301(b)(3)`:

> The calculations must separately compute impact on sex categories, race/ethnicity categories,
> **and intersectional categories of sex, ethnicity and race.**

A tool can pass a sex audit and a race audit and still fail the intersection — that is precisely
what single-axis testing hides. Worth noting how close this came to being unanswerable: the
walker was treating bare roman numerals as prose, so `(i)`, `(ii)` and `(iii)` were absorbed into
their parent paragraph and this requirement **had no citable path at all** until it was found by
red-teaming.

## Scenario 3 — the law that is not law yet

```
IN FORCE today (2026-09-08)
  N.Y. Gen. Bus. Law § 899-ee(1), § 899-ff(1), § 899-ff(5)     Child Data Protection Act
  N.Y. Gen. Bus. Law § 899-bb(1), § 899-bb(2)                  SHIELD safeguards

PENDING — NOT LAW. Watch feed only.
  § 1501(1) · § 1501(3) · § 1501(5) · § 1502 · § 1504 · § 1506(1) · § 1508(1)
  status=enacted_pending    binds from 2027-01-25
```

The SAFE for Kids Act is **enacted, final, and binds nobody today.** It routes to a watch feed
that can never become an obligation *at any as-of date* — asking as of 2027-06-01 does not
promote it, because status is checked before dates are.

This matters because it is the single most damaging error the system could make. Training data is
dense with commentary about laws that were signed but are not yet operative, and about bills that
never passed at all. Answering "you must do X" about either is worse than refusing.

Note also the two `covered user`s. **New York defines that term twice** — GBL § 899-ee(1) means a
user the operator knows to be a minor; GBL § 1500(4) means very nearly everybody. Same two words,
same chapter of the same law, and the only element they share is *being in New York*. The corpus
holds both as definition records whose divergence is computed from their elements, not asserted.

## Scenario 4 — what it says it cannot tell you

```
Declared instruments that are NOT complete
  ny.safe_for_kids  missing: age_determination_methods (13 N.Y.C.R.R. § 700)
                    would supply: what "commercially reasonable and technically feasible"
                    ACTUALLY REQUIRES, and what verifiable parental consent looks like
  ny.safe_for_kids  missing: language_list (N.Y. Exec. Law § 202-a)

Records held but refused (invariant I1 — unverified, so never surfaced)
  us.doctrine.dormant_commerce_clause · us.doctrine.first_amendment.commercial_data
  us.doctrine.fourth_amendment.third_party · us.enforcement.ftc.public_commitment_pattern
```

This is the part most tools do not have. Coverage is **declared before it is measured**, so an
instrument knows what it is missing and says so in the result. The § 1501 answer above is
therefore honest but incomplete: the statute prohibits serving an addictive feed without
"commercially reasonable and technically feasible" age determination, and *what that phrase
requires is decided in a regulation this corpus does not hold.*

An answer that did not say so would be more confident and less true.

## What this example does not show

- **Whether the analysis is right.** Every span is verified against stored source bytes and every
  citation resolves to exactly one provision — but a correct quotation can still be read wrongly,
  and several such errors have been found in this corpus after shipping. See
  [`meta/validation-events.yaml`](../meta/validation-events.yaml).
- **Business-day precision.** The engine counts business days as **weekdays** and does not exclude
  public holidays, so a clock crossing one lands a day early. Every business-day result says so in
  `business_day_basis`. This example deliberately uses a trigger date of 8 September — a breach on
  the 2nd would have put the five-day clock across Labor Day and made the headline figure wrong by
  a day. Check any date that crosses a holiday against a real calendar.

- **Pending law does not promote itself.** The SAFE for Kids records stay `enacted_pending` at
  *every* as-of date, including dates after 25 January 2027 — status is a recorded field, not
  something derived from the calendar. That is deliberate: nothing silently becomes law. It also
  means **the corpus goes stale on that date unless a person updates it.** The refusal to guess
  cuts both ways.
- **Anything outside the manifest.** No state but New York, no GDPR, no case law.
