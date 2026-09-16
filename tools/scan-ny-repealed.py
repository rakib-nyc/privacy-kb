#!/usr/bin/env python3
"""Generate meta/ny-repealed.yaml from the OpenLegislation LAW TREE.

The `repealed` flag is exposed on tree nodes, NOT on the individual document response:
fetching GBS/899-CCC directly returns repealed: null even though the tree marks it
repealed as of 2026-06-19. A gate that checked only the stored document would therefore
pass every repealed section — vacuous in exactly the way gate 14 exists to catch.

    NYSENATE_API_KEY=... python3 tools/scan-ny-repealed.py GBS [PBH ...]
    python3 tools/scan-ny-repealed.py --check
"""
import sys, os, json, subprocess, pathlib, yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEST = ROOT / 'meta/ny-repealed.yaml'
KEY = os.environ.get('NYSENATE_API_KEY')


def tree(law):
    url = f"https://legislation.nysenate.gov/api/3/laws/{law}?full=true&key={KEY}"
    out = subprocess.run(['curl', '-sSL', '--max-time', '300',
                          '-A', 'privacy-kb/0.1 (corpus fetch)', url],
                         capture_output=True, check=True).stdout
    d = json.loads(out)
    if not d.get('success'):
        raise SystemExit(f"API error for {law}: {d.get('message')}")
    return d['result']


def collect(node, law, acc, total):
    total[0] += 1
    if node.get('repealed'):
        acc.append(dict(law_id=law, location_id=node.get('locationId'),
                        doc_type=node.get('docType'),
                        repealed_date=node.get('repealedDate'),
                        title=(node.get('title') or '')[:90]))
    for k in (node.get('documents') or {}).get('items', []) or []:
        collect(k, law, acc, total)


if __name__ == '__main__':
    doc = yaml.safe_load(DEST.read_text()) if DEST.exists() else {'laws': {}}
    if '--check' in sys.argv:
        n = sum(len(v['repealed']) for v in (doc.get('laws') or {}).values())
        print(f"{len(doc.get('laws') or {})} law(s), {n} repealed document(s) recorded")
        sys.exit(0)
    if not KEY:
        raise SystemExit('set NYSENATE_API_KEY')
    doc.setdefault('laws', {})
    for law in (a for a in sys.argv[1:] if not a.startswith('--')):
        acc, total = [], [0]
        collect(tree(law)['documents'], law, acc, total)
        doc['laws'][law] = dict(scanned='2026-08-19', documents_seen=total[0], repealed=acc)
        print(f"{law}: {len(acc)} repealed of {total[0]}")
    DEST.write_text(
        "# NY REPEALED DOCUMENTS\n# =====================\n"
        "# Generated from the OpenLegislation LAW TREE, which is the only place the\n"
        "# `repealed` flag appears — the per-document endpoint returns null for it.\n"
        "# Gate 20 checks every openleg_json atom's anchor against this table.\n\n"
        + yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, width=100))
