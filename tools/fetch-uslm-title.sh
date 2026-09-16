#!/usr/bin/env bash
# Acquire one USLM title release point into the cache.
#
# Acquisition lives here, not in extract.py, for two reasons. Provenance: every fetch
# should be allowlisted and logged, and the harness is what does that. And practically,
# a curl spawned from inside the Python process is proxied differently in this
# environment and silently returns an error page instead of the zip.
set -euo pipefail
T=$(printf "%02d" "$1"); RP="${2:-119-1}"
CACHE="$(cd "$(dirname "$0")/.." && pwd)/.uslm-cache"
mkdir -p "$CACHE"
URL="https://uscode.house.gov/download/releasepoints/us/pl/${RP//-//}/xml_usc${T}@${RP}.zip"
OUT="$CACHE/usc${T}@${RP}.zip"
[ -s "$OUT" ] && { echo "cached: $OUT"; exit 0; }
curl -sSL --max-time 600 -A "privacy-kb/0.1 (corpus fetch; contact repo owner)" -o "$OUT" "$URL"
if ! unzip -tq "$OUT" >/dev/null 2>&1; then echo "not a zip: $URL" >&2; rm -f "$OUT"; exit 1; fi
echo "fetched: $OUT  $(shasum -a 256 "$OUT" | cut -c1-16)…  $(wc -c <"$OUT") bytes"
