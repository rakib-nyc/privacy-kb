#!/usr/bin/env python3
"""Append a completed visual spot-check to meta/visual-checks.yaml (gate 12).

    python3 tools/log-visual-check.py <record_id> <page> <covers,comma,sep> "<note>"

The span hash is computed here, not typed, so a logged check always refers to the exact
span that was read. Editing the span moves the hash and gate 12 demands a fresh check.
"""
import sys, re, yaml, hashlib, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
rid, page, covers, note = sys.argv[1], int(sys.argv[2]), sys.argv[3].split(','), sys.argv[4]
rec = None
for p in ROOT.rglob('corpus/**/atoms/*.yaml'):
    r = yaml.safe_load(p.read_text())
    if r.get('id') == rid: rec = r; break
if not rec: sys.exit(f'no record {rid}')
h = hashlib.sha256(re.sub(r'\s+',' ',rec['verbatim_span']).strip().encode()).hexdigest()[:16]
vc = ROOT/'meta/visual-checks.yaml'
doc = yaml.safe_load(vc.read_text())
doc['checks'] = [c for c in doc['checks'] if c['record_id'] != rid]
doc['checks'].append(dict(record_id=rid, instrument_id=rec['source']['instrument_id'],
    raw_file=rec['source']['raw_file'], page=page, dpi=200, covers=covers,
    # DATE THE CHECK, NOT THE TOOL. This was hardcoded, so every check ever logged claimed
    # 2026-08-19 whatever day it ran — and gate 12's whole purpose is to say WHEN a human or
    # model last looked at the page. A stale date makes an old check look fresh.
    checked=__import__('datetime').date.today().isoformat(),
    checked_by='visual read of rendered page',
    result='match', span_sha256_16=h, note=note))
head = vc.read_text().split('purpose:')[0]
vc.write_text(head + yaml.safe_dump({k: doc[k] for k in doc}, sort_keys=False, allow_unicode=True, width=98))
print(f'logged {rid} p{page} {covers}')
