#!/usr/bin/env python3
"""Regenerate meta/positive-law-titles.yaml from USLM's own metadata.

Reads <meta><property role="is-positive-law"> from each title's USLM XML. That element
is the publisher asserting the fact, which is the only acceptable source for it: the
alternative is a hand-maintained list that silently goes stale when a title is codified.

    python3 tools/scan-positive-law.py 15 42 47 ...      # add titles
    python3 tools/scan-positive-law.py --check           # currency check only
"""
import sys, re, io, zipfile, urllib.request, pathlib, yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEST = ROOT / 'meta/positive-law-titles.yaml'
URL = "https://uscode.house.gov/download/releasepoints/us/pl/{rp}/xml_usc{tt}@{rp}.zip"


def probe(title, rp="119-1"):
    u = URL.format(tt=f"{int(title):02d}", rp=rp)
    req = urllib.request.Request(u, headers={'User-Agent': 'privacy-kb/0.1 (corpus fetch)'})
    with urllib.request.urlopen(req, timeout=300) as r:
        zf = zipfile.ZipFile(io.BytesIO(r.read()))
    head = zf.open(zf.namelist()[0]).read(9000).decode('utf-8', 'replace')
    return {'is_positive_law': re.search(r'<property role="is-positive-law">(\w+)</property>', head).group(1) == 'yes',
            'release': re.search(r'<docPublicationName>([^<]+)</docPublicationName>', head).group(1)}


if __name__ == '__main__':
    doc = yaml.safe_load(DEST.read_text())
    if '--check' in sys.argv:
        print(f"release point {doc['release_point']} · {len(doc['titles'])} titles recorded")
        print("Positive-law codification is rare; re-run this generator on a release-point bump.")
        sys.exit(0)
    for t in (a for a in sys.argv[1:] if a.isdigit()):
        r = probe(t)
        doc['titles'].setdefault(int(t), {}).update(r)
        print(f"title {t}: positive_law={r['is_positive_law']} ({r['release']})")
    DEST.write_text(DEST.read_text().split('titles:')[0] + yaml.safe_dump({'titles': doc['titles']}, sort_keys=False, width=98))
