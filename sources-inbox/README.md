# sources-inbox

Owner-supplied documents that are **not yet in the corpus**. Nothing here is cited by any
record; a document leaves this directory by being ingested under `corpus/**/raw/` with a
`meta/sources.yaml` entry, at which point the copy here is deleted rather than duplicated.

Both files are New York State government publications. They are here because no
machine-readable source serves them — see `meta/blocked-sources.yaml`.

| File | Instrument | Why it is still here |
|---|---|---|
| `rf_fs_2amend23NYCRR500_text_20231101.pdf` | 23 NYCRR Part 500 (NYDFS Cybersecurity) | **Amendatory, not consolidated.** Headed "NEW MATTER UNDERSCORED, DELETED MATTER IN BRACKETS", with 118 bracketed deletions. `pdftotext` discards the underscoring, so added matter becomes indistinguishable from retained matter and only the deletions survive — reconstructing current text from it would be inference, which invariant I1 forbids. Usable for `amendment_history` and effective dates; not as the operative rule. |
| `safe_for_kids_act_rule_text.pdf` | 13 N.Y.C.R.R. Part 700 (SAFE for Kids regulations) | Marked **"UNOFFICIAL COPY"** on its own face. Ingestible at `risk_tier: high` with that self-declaration recorded verbatim in `structured_source_check.note`. It is the highest-value document here: §§ 1501(2) and 1501(4) delegate both compliance routes to it, so what "commercially reasonable and technically feasible" actually requires is decided in this document and nowhere else. |
