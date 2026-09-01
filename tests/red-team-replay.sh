set -u
cd /Users/rakib/Documents/Privacy-KB
Q="$CLAUDE_JOB_DIR/tmp/qa"
res() { printf "  %-8s %-52s %s\n" "$1" "$2" "$3"; }

# QA-01 span cites another provision
cp "$Q/orig-1501-1.yaml" /tmp/o1.yaml
cp /tmp/attack1.yaml corpus/state/ny/safe-for-kids/atoms/ny-gbl-1501-1-addictive_feed_prohibition.yaml
node tools/anchor-segments.mjs --write >/dev/null 2>&1
n=$(node tools/validate.mjs 2>&1 | grep -c "gate 39")
cp /tmp/o1.yaml corpus/state/ny/safe-for-kids/atoms/ny-gbl-1501-1-addictive_feed_prohibition.yaml
node tools/anchor-segments.mjs --write >/dev/null 2>&1
[ "$n" -gt 0 ] && res CAUGHT "QA-01 span cites a different provision" "gate 39" || res "MISSED" "QA-01" "-"

# QA-02 truncation before a qualifier
cp /tmp/attack2.yaml corpus/state/ny/safe-for-kids/atoms/ny-gbl-1502-overnight_notifications.yaml
n=$(node tools/validate.mjs 2>&1 | grep -c "gate 40")
cp "$Q/orig-1502.yaml" corpus/state/ny/safe-for-kids/atoms/ny-gbl-1502-overnight_notifications.yaml
[ "$n" -gt 0 ] && res CAUGHT "QA-02 truncation before a qualifier" "gate 40" || res "MISSED" "QA-02" "-"

# QA-05 malformed as_of
cat > "${TMPDIR:-/tmp}/qa05.mjs" <<JS
import { analyze } from '$PWD/engine/applicability.mjs';
const bad = ['not-a-date', 'zzz', '2026-13-45', 20260101, '2026-1-1', null, ''];
const allRefused = bad.every(d => analyze({}, {}, { as_of: d }).error != null);
const goodWorks  = analyze({}, {}, { as_of: '2026-01-01' }).error == null;
process.stdout.write(allRefused && goodWorks ? '1' : '0');
JS
n=$(node "${TMPDIR:-/tmp}/qa05.mjs")
[ "$n" = "1" ] && res CAUGHT "QA-05 malformed as_of refused" "engine" || res "MISSED" "QA-05" "-"

# QA-03 I1 leak via privacy_coverage
n=$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"privacy_coverage","arguments":{}}}' \
 | node mcp/server.mjs 2>/dev/null | python3 -c "
import sys,json; r=json.loads(sys.stdin.readline())['result']['structuredContent']
print(0 if any(i.startswith('us.doctrine') for i in r['ids']) else 1)")
[ "$n" = "1" ] && res CAUGHT "QA-03 I1 suppression on coverage" "mcp" || res "MISSED" "QA-03" "-"

# QA-15 JSON-RPC parse error
n=$(printf 'GARBAGE\n' | node mcp/server.mjs 2>/dev/null | grep -c '"code":-32700')
[ "$n" -gt 0 ] && res CAUGHT "QA-15 malformed JSON-RPC answered" "mcp" || res "MISSED" "QA-15" "-"

# QA-16 phantom gate
sed -i '' 's/,41,42\];/,41,42,99];/' tools/validate.mjs
n=$(node tools/validate.mjs 2>&1 | grep -c "gate 22")
sed -i '' 's/,41,42,99\];/,41,42];/' tools/validate.mjs
[ "$n" -gt 0 ] && res CAUGHT "QA-16 phantom gate in ALL_GATES" "gate 22" || res "MISSED" "QA-16" "-"

# QA-06 undeclared ratchet relaxation
sed -i '' 's/^unaccounted_allowance: 38$/unaccounted_allowance: 45/' meta/coverage.yaml
n=$(node tools/validate.mjs 2>&1 | grep -c "gate 42")
sed -i '' 's/^unaccounted_allowance: 45$/unaccounted_allowance: 38/' meta/coverage.yaml
[ "$n" -gt 0 ] && res CAUGHT "QA-06 undeclared ratchet move" "gate 42" || res "MISSED" "QA-06" "-"

# QA-07 garbage related[]
cp corpus/state/ny/safe-for-kids/atoms/ny-gbl-1504-nondiscrimination.yaml /tmp/o4.yaml
python3 -c "
import yaml,pathlib
p='corpus/state/ny/safe-for-kids/atoms/ny-gbl-1504-nondiscrimination.yaml'
a=yaml.safe_load(open(p)); a['related']=[{'garbage':1}]
pathlib.Path(p).write_text(yaml.safe_dump(a,sort_keys=False,allow_unicode=True,width=100))"
n=$(node tools/validate.mjs 2>&1 | grep -c "gate 1 ")
cp /tmp/o4.yaml corpus/state/ny/safe-for-kids/atoms/ny-gbl-1504-nondiscrimination.yaml
[ "$n" -gt 0 ] && res CAUGHT "QA-07 garbage cross-reference" "gate 1" || res "MISSED" "QA-07" "-"
