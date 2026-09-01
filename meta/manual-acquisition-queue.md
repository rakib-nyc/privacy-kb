# Manual acquisition queue

Some publishers block automated fetch. That is a routine condition of this project, not a
failure state — agency sites, Cloudflare-fronted hosts and session-gated portals will all
refuse a script at some point across ~76 instruments.

**The invariant is provenance, not automation.** A document fetched by hand in a browser is
exactly as good as one fetched by `tools/fetch-source.mjs`, provided it goes through the
identical hash-and-log discipline on arrival. What is never acceptable is substituting a
secondary source because the primary was inconvenient.

## On arrival — do this, every time

```bash
# 1. Put the file where the queue entry says. Do not rename it.
# 2. Log it, hash it, and record the URL it came from:
node tools/fetch-source.mjs "<the original URL>" --out <path> --instrument <id> \
     --note "manually acquired; host blocks automated fetch"
#    If the host refuses even this, the file is already in place — run:
#    shasum -a 256 <path>   and add the entry to meta/sources.yaml by hand,
#    with acquired_by: manual and the date.
# 3. Render it and check the format:
python3 tools/render-text.py <path> --out <path>.txt
python3 tools/scan-features.py          # refresh the feature inventory
# 4. Set source.format, source.risk_tier and source.structured_source_check on the atoms.
# 5. npm test
```

A manually acquired source is subject to **every** gate. Nothing is relaxed because a
human moved the bytes.

## Queue

### 1. DHS Privacy Policy Guidance Memoranda 2008-01 and 2017-01

- **Status:** **NOT NEEDED.** Ruled out of scope for v1 on 2026-08-19 — see
  `meta/out-of-scope.yaml`. Retained here only so that the re-entry trigger has an
  acquisition path already written.
- **Why blocked:** `dhs.gov` returns HTTP 403 to automated requests.
- **What was tried:** four URLs (the publication page and three direct PDF paths), with
  the repo user-agent, with a full browser user-agent, and with browser
  `Accept` / `Accept-Language` / `Referer` headers. Host-level bot blocking, not a dead
  link — the documents are publicly listed and load in a browser.
- **If the re-entry trigger fires, a human should fetch:**
  - `https://www.dhs.gov/sites/default/files/publications/privacy-policy-guidance-memorandum-2008-01.pdf`
  - `https://www.dhs.gov/sites/default/files/publications/PPGM%202017-01%20Signed_0.pdf`
- **Drop them at:** `corpus/principles/fipps/raw/dhs-ppgm-2008-01-<YYYYMMDD>.pdf` and
  `…/dhs-ppgm-2017-01-<YYYYMMDD>.pdf`
- **Then:** run the arrival procedure above, and resolve `meta/taxonomy-drift.yaml` S-08 —
  whether 2017-01 amends or supersedes 2008-01 is still unknown, and no record may be
  marked `in_force` until it is answered.

### 2. New York consolidated statutes — **RESOLVED 2026-08-19**

- **Status:** **RESOLVED.** An OpenLegislation API key was supplied. `tools/fetch-ny.sh`
  returns structured JSON with real currency metadata. No manual acquisition needed.
- The website (`nysenate.gov`) remains Cloudflare-blocked and is **not used**. The API is
  both the unblocked path and the better one: it exposes `activeDate`, `publishedDates` and
  `repealed` flags that the website does not.
- The key lives in the environment as `NYSENATE_API_KEY` and is never written to disk —
  `.ny-cache/` holds only response bodies, and `tools/fetch-ny.sh` passes the key as a query
  parameter that does not appear in the stored JSON.

*(No other source is currently blocked.)*
