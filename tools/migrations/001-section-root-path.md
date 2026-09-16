# Migration 001 — section-root paragraph_path

**Forced by:** DEBT-005. `operative_context` could not represent a section-level chapeau,
because `paragraph_path.path` had `minItems: 1` and a section root is `[]`.

**Change:** `minItems: 1` → `0` on `paragraph_path.path`, in all four record schemas.

**Records requiring transformation:** none. No existing record had a section-root context
entry — the one case (1 U.S.C. § 204(a)) was handled by span boundary selection because
chapeau and subsection were contiguous. The change is purely permissive.

**Gate 18 trigger:** also widened, from `depth > 1` to `depth >= 1 OR the source exposes a
section-level chapeau`. A depth-1 subsection governed by a section chapeau previously
escaped the context requirement entirely.

**Verification:** both spike corpora re-run, full gate suite green, 43 records revalidated.
