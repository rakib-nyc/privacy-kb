#!/usr/bin/env bash
# Acquire a NY law document from the Senate OpenLegislation API.
#   NYSENATE_API_KEY=... tools/fetch-ny.sh GBS 349
# Structured JSON, so NY becomes a low-risk-tier source rather than scraped HTML.
set -euo pipefail
LAW="$1"; LOC="${2:-}"
: "${NYSENATE_API_KEY:?set NYSENATE_API_KEY — free key at https://legislation.nysenate.gov/}"
CACHE="$(cd "$(dirname "$0")/.." && pwd)/.ny-cache"; mkdir -p "$CACHE"
URL="https://legislation.nysenate.gov/api/3/laws/${LAW}${LOC:+/$LOC}?full=true&key=${NYSENATE_API_KEY}"
OUT="$CACHE/${LAW}${LOC:+-$LOC}.json"
curl -sSL --max-time 120 -A "privacy-kb/0.1 (corpus fetch)" -o "$OUT" "$URL"
python3 - "$OUT" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
if not d.get('success'): sys.exit(f"API error: {d.get('message')} (code {d.get('errorCode')})")
print(f"ok: {sys.argv[1]}")
PY
