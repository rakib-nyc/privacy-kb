# Provenance

Companion to `NOTICE`. The Apache 2.0 licence in `LICENSE` covers the original work in this
repository; this file accounts for the material it does not and cannot cover.

## Original work

Everything under `tools/`, `engine/`, `mcp/`, `workflows/`, `evals/`, `schemas/` and `tests/`,
and all analytical prose in the corpus records — `summary`, `requirement_detail`,
`common_errors`, `open_questions`, `preemption.note`, `enforcement` — together with the
commentary in `meta/`.

Licensed Apache 2.0, Copyright 2026 Muhammad Rakibul Islam.

## Quoted legal text

Every `verbatim_span` under `corpus/` is quoted from United States, New York State or New York
City law: the US Code, the Code of Federal Regulations, New York consolidated law, the New York
City Administrative Code, and the Rules of the City of New York, together with agency guidance
issued by those governments.

Edicts of government are not subject to copyright in the United States. The stored copies under
`corpus/**/raw/` are the fetched primary sources those quotations are verified against, kept so
that a reader can check a citation rather than take it on trust. Each is logged in
`meta/sources.yaml` with its URL, fetch date and SHA-256, and each atom carries the hash of the
exact source bytes and of the segmentation leaf it quotes.

## Owner-supplied documents

Some files under `corpus/**/raw/`, and everything in `sources-inbox/`, were supplied by the
repository owner rather than fetched by the harness, because no machine-readable source serves
them. They are US, New York State or New York City government publications and fall under the
section above.

Their `source.url` reads `urn:owner-supplied:…` rather than a fetch URL, so the difference
between "the harness fetched this and hashed it" and "a person put this here" is visible in the
data instead of being lost. `sources-inbox/` holds documents that are not yet ingested; its
README states what each one is and what is blocking it.

## Third-party reference documents

Some published frameworks that this project once referenced are **not redistributed here** and
are not present in the repository or its history. Where the project refers to any such document
it does so by citation only. Records that had been verified against them were removed along with
them, because a record cannot be `verbatim_confirmed` against a file this repository does not
hold — see `meta/decisions.yaml` DEC-008.
