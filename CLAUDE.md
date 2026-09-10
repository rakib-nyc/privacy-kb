# Working rules for this repository

## Authorship — absolute, no exceptions

**Claude is never a co-author. Not on a commit, not on a pull request, not in a file
header, not in a release note, not in documentation, not anywhere.**

This applies to every commit, present and future, including any default attribution a
tool or harness would otherwise add.

Concretely, the following must **never** appear in a commit message, a PR body, a tag
message, a code comment, a docs file, or any other artifact in this repository:

- `Co-Authored-By: Claude …` or any `Co-Authored-By:` trailer naming an AI system
- `Claude-Session: …` or any session link
- `Generated with Claude Code`, `🤖 Generated with …`, or any equivalent tool credit
- Any other line, badge or footer crediting an AI system as an author or contributor

If a tool supplies such a trailer by default, strip it before committing. Overriding that
default is expected here, not an exception to be raised.

The sole author of this work is:

> **Muhammad Rakibul Islam** · rakib.islam@rutgers.edu · GitHub [@rakib-nyc](https://github.com/rakib-nyc)

Commits are authored and committed as `Muhammad Rakibul Islam <imrakibul@gmail.com>`,
which is the address GitHub attributes to [@rakib-nyc](https://github.com/rakib-nyc). The
Rutgers address above is the scholarly contact and belongs in `NOTICE` and `CITATION.cff`,
not in commit metadata.

### Why this rule is written down rather than assumed

AI assistance was used in building parts of this corpus, and the repository says so
plainly — in `README.md`, in `PROVENANCE.md`, and on the website. That disclosure is about
**method**, and it belongs in the documentation where a reader evaluating the work will
find it.

Authorship is a different claim. It is about **responsibility** — who stands behind the
analysis, who answers for an error, who is accountable to a reader relying on a citation.
That is a person. Recording a tool as a co-author would misstate where responsibility
sits, and in a repository whose entire premise is that provenance must be checkable, an
inaccurate provenance claim about the work itself is the worst possible place to be
careless.

Disclose the method. Never dilute the authorship.

## Commit messages, PR bodies and tag messages

A commit message is a public record of **what changed to the code**. It is not a place for
working conversation, session narration, or reasoning that only makes sense to someone who
was in the room.

Write them plainly:

- A short subject line, under ~72 characters, saying what changed.
- A body of a few short paragraphs — what changed, and the technical reason it changed.
- Wrap at 72 columns. Reference files, symbols, counts and citations where they help.

**Never include:**

- Any mention of AI, of this file, of assistants, tools, sessions or prompts
- Narration of the process — "found by fuzzing rather than by reading", "checked in a
  browser at 1512px", "the general lesson of this release", "what I did next"
- Meta-commentary about the repository's own history — that it was deleted, republished,
  rewritten, or discussed
- Rhetorical framing, essays, headings shouted in capitals, or a persuasive voice
- Anything said in conversation that was not itself a change to the code

If a rationale is long enough to need an essay, it belongs in a code comment beside the
thing it explains, in `meta/decisions.yaml`, or in `meta/debt.yaml` — not in the commit
log. The same applies to pull request bodies, tag messages, and release notes.

## Conventions worth knowing before changing code

- **Never name an engine variable `a`, `o`, `c`, `rec`, `atom`, `ex`, `federalAtom` or
  `stateAtom` unless it really is a corpus record.** `tools/check-engine-schema.mjs` reads
  `<name>.<field>` in `engine/` and `mcp/` as a record field access and will report the
  file as depending on schema fields that do not exist. Rename the variable, never weaken
  the check.
- **A parameter default covers `undefined` only.** Every outermost entry point must be
  total on `null` too. This has been found and fixed in `computeDeadline`,
  `preemption.resolve()`, all four workflows, and again in `buildMemo`, `normaliseFacts`
  and the incident helpers. Assume the next new layer has it.
- **Generated files are checked, not trusted.** `meta/fact-keys.yaml`,
  `meta/ecfr-vintages.yaml` and `corpus.html` each have a `--check` mode wired into
  `npm test`. A hand-typed count in this repository once survived three releases past
  being true.
- **A basis, a date or a coverage claim is DERIVED from source bytes, never declared.**
  Gates 43 and 45 exist because a record must not be able to promote its own provenance by
  editing a field, any more than it may quote words its source does not contain.
- **Corpus coverage is not answer coverage.** A check that asks whether the corpus *holds*
  a duty cannot see that duty being excluded from an *answer*. Check the answer.

## Before committing

`npm test` must pass — 17 steps, including all 45 CI gates, the fixture suite, the evals
and the generated-file staleness checks. Do not commit around a failing gate.
