#!/usr/bin/env python3
"""RESOLVE EVERY CITATION IN A BRIEF BEFORE EXTRACTING ANYTHING.

A brief's citation is a HYPOTHESIS. Five times now an owner-authored instruction has named a
provision and said something about it that the provision does not say — see
meta/validation-events.yaml VE-001 through VE-005. Four of the five were this exact shape: a
claim about what a NAMED provision does.

Every machine-checkable layer in this repo is guarded. The instructions are not, and they have
been wrong five times. Gate 31 resolves the citations in meta/jurisdiction-coverage.yaml against
their sources; nothing resolved the citations inside a session brief. This does.

It makes NO semantic judgement — that heuristic was tried for gate 31 and produced false alarms
and false comfort in equal measure. It prints the source's own heading beside the sentence the
brief wrote around the citation, and lets a reader see a § 157 for what it is.

    python3 tools/check-brief.py brief.txt
    cat brief.txt | python3 tools/check-brief.py -
"""
import json, glob, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITE = re.compile(
    r'(?P<usc>(\d+)\s*U\.?S\.?C\.?\s*§+\s*([\w.–-]+))'
    r'|(?P<cfr>(\d+)\s*C\.?F\.?R\.?\s*(?:part\s*)?§*\s*([\w.–-]+))'
    r'|(?P<ny>N\.?Y\.?[^§]{0,40}§+\s*([\w.–-]+))', re.I)

def index():
    """Every section this corpus has already fetched, by citation-ish key -> heading."""
    idx = {}
    for f in glob.glob(str(ROOT / 'corpus/**/*.seg.json'), recursive=True):
        try: d = json.load(open(f))
        except Exception: continue
        label = (d.get('label') or '').strip()
        # THE SECTION heading, from the raw source — not the first leaf's, which for USLM is
        # often a SUBSECTION heading ("In general .—") and reads as though the section were
        # about that. A tool built to show what a provision is called must not show the wrong
        # name, or it produces exactly the false confidence it exists to prevent.
        head = ''
        rf = d.get('raw_file')
        if rf and pathlib.Path(rf).exists():
            try:
                txt = pathlib.Path(rf).read_text(encoding='utf-8', errors='ignore')[:400000]
                m = (re.search(r'<num[^>]*>.*?</num>\s*<heading>(.*?)</heading>', txt, re.S)
                     or re.search(r'<HEAD>(.*?)</HEAD>', txt, re.S))
                if m: head = re.sub(r'<[^>]+>', '', m.group(1)).strip()
            except Exception: pass
        if not head:
            for l in d.get('leaves', []):
                if l.get('heading'): head = l['heading']; break
        key = re.sub(r'\s+', '', label).lower()
        if key: idx[key] = (label, head, pathlib.Path(f).name)
    return idx

def norm_usc(t, s):  return f"{t}u.s.c.§{s}".lower().replace('–', '-')
def norm_cfr(t, s):  return f"{t}cfr{s}".lower().replace('–', '-')

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else '-'
    text = sys.stdin.read() if src == '-' else pathlib.Path(src).read_text()
    idx = index()
    # build lookup variants for what we have
    have = {}
    for key, (label, head, fn) in idx.items():
        have[key] = (label, head, fn)
        m = re.match(r'(\d+)u\.s\.c\.§(.+)', key)
        if m: have[norm_usc(m.group(1), m.group(2))] = (label, head, fn)
        m = re.match(r'(\d+)cfr(.+)', key)
        if m: have[norm_cfr(m.group(1), m.group(2))] = (label, head, fn)

    seen, rows = set(), []
    for m in CITE.finditer(text):
        raw = m.group(0).strip()
        if m.group('usc'):
            t, s = m.group(2), m.group(3)
            base = re.split(r'[(\[]', s)[0].rstrip('.')
            key = norm_usc(t, base)
        elif m.group('cfr'):
            t, s = m.group(5), m.group(6)
            base = re.split(r'[(\[]', s)[0].rstrip('.')
            key = norm_cfr(t, base.split('.')[0])
        else:
            key = None
        if raw in seen: continue
        seen.add(raw)
        # the sentence the brief wrote around it
        a = max(0, m.start() - 160); b = min(len(text), m.end() + 160)
        claim = re.sub(r'\s+', ' ', text[a:b]).strip()
        hit = have.get(key) if key else None
        rows.append((raw, hit, claim))

    unresolved = [r for r in rows if not r[1]]
    print(f'citations found: {len(rows)}   resolved against a fetched source: {len(rows)-len(unresolved)}\n')
    for raw, hit, claim in rows:
        if hit:
            label, head, fn = hit
            print(f'  {raw}')
            print(f'      published : {label} — {head[:100] or "(no heading in segmentation)"}')
            print(f'      brief says: ...{claim[:150]}...')
        else:
            print(f'!! {raw}  NOT IN THE CORPUS — fetch it and read the heading before writing an atom')
            print(f'      brief says: ...{claim[:150]}...')
        print()
    print('This tool does not judge whether the claim is right. It puts the source\'s own heading')
    print('next to the sentence the brief wrote, because five instruction errors got past every')
    print('other check in this repo and four of them were a claim about a NAMED provision.')
    return 1 if unresolved else 0

if __name__ == '__main__':
    sys.exit(main())
