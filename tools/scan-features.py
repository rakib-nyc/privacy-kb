#!/usr/bin/env python3
"""Inventory the extraction-hostile features of every pdf_* source, and of every
span drawn from one. Writes meta/source-features.yaml.

Two jobs.

1. It drives gate 12 selection. Risk tier turned out not to predict where renderer
   faults appear: the APEC Framework and the Global CBPR Framework are the same
   shape and the same tier, and only one of them exposed the baseline-offset bug;
   a medium-tier single-column document then produced the footnote divergence.
   What predicts trouble is FEATURES — markers, footnote references, tables,
   column boundaries, hyphenation, non-ASCII glyphs — so sampling follows those.

2. It gives an advance read on which Priority 1 instruments will be
   extraction-hostile, before a session is committed to one.

    python3 tools/scan-features.py [--check]
"""
import re, sys, json, pathlib, warnings, collections
warnings.filterwarnings('ignore')
import yaml, pdfplumber

ROOT = pathlib.Path(__file__).resolve().parent.parent
norm = lambda s: re.sub(r'\s+', ' ', s).strip()

FEATURES = ['subparagraph_marker', 'footnote_ref', 'table',
            'multi_column', 'hyphenation', 'non_ascii']

MARKER_RE = re.compile(r'(?:^|\s)(?:\(?[a-zA-Z]\)|\(?[ivxlIVXL]+\)|[ivxlIVXL]+\.|\d+\))(?=\s)')
HYPHEN_RE = re.compile(r'[a-z]-\n[a-z]')


def page_columns(page, gap=25.0):
    """A page is multi-column if word left-edges are bimodal with a real gutter."""
    xs = sorted(w['x0'] for w in page.extract_words())
    if len(xs) < 40:
        return False
    gaps = [(xs[i + 1] - xs[i], xs[i]) for i in range(len(xs) - 1)]
    lo, hi = page.width * 0.25, page.width * 0.75
    return any(g >= gap and lo <= x <= hi for g, x in gaps)


def superscripts(page):
    """Footnote references: digits set materially smaller than the page's body type."""
    chars = [c for c in page.chars if c.get('height')]
    if not chars:
        return 0
    body = collections.Counter(round(c['height'], 1) for c in chars).most_common(1)[0][0]
    return sum(1 for c in chars if c['text'].isdigit() and c['height'] < body * 0.85)


def scan(pdf_path, pages=None):
    f = {k: 0 for k in FEATURES}
    with pdfplumber.open(pdf_path) as pdf:
        sel = pdf.pages
        if pages:
            a, b = (int(v) for v in pages.split('-'))
            sel = pdf.pages[a - 1:b]
        for p in sel:
            txt = p.extract_text() or ''
            f['subparagraph_marker'] += len(MARKER_RE.findall(txt))
            f['footnote_ref'] += superscripts(p)
            f['table'] += len(p.find_tables())
            f['multi_column'] += 1 if page_columns(p) else 0
            f['hyphenation'] += len(HYPHEN_RE.findall(txt))
            f['non_ascii'] += sum(1 for c in txt if ord(c) > 127)
    return f


# A footnote reference flattened into the text stream attaches DIRECTLY to the preceding
# word — "participating APEC economies10.", "its certification1." A looser pattern that
# allowed a space matched ordinary figures: "more than 3,500 members" registered as a
# footnote reference and forced a pointless span_interruption. Legal text is full of
# numbers, so the strict form is the only usable one.
FOOTNOTE_RE = re.compile(r'[a-z]\d{1,2}(?=[.,;:)]|\s|$)')


def span_features(span, rendering):
    """Features exhibited by THE SPAN ITSELF.

    Deliberately not "or nearby". An earlier version scanned a 150-character window around
    the span, which meant a footnote elsewhere on the page attached itself to an unrelated
    quotation and gate 15 demanded a span_interruption for apparatus that was not in the
    span. Proximity is not presence."""
    out = set()
    n = norm(span)
    if MARKER_RE.search(' ' + n):
        out.add('subparagraph_marker')
    if any(ord(c) > 127 for c in n):
        out.add('non_ascii')
    if FOOTNOTE_RE.search(n):
        out.add('footnote_ref')
    if HYPHEN_RE.search(span):
        out.add('hyphenation')
    return sorted(out)


def main():
    records, by_raw = [], {}
    for p in sorted(ROOT.glob('corpus/**/atoms/*.yaml')):
        r = yaml.safe_load(p.read_text())
        if not r.get('source', {}).get('format', '').startswith('pdf_'):
            continue
        records.append(r)
        by_raw.setdefault(r['source']['raw_file'], r['source'])

    out = {'purpose': ('Extraction-hostile features per pdf_* source and per span. Drives gate 12 '
                       'sampling, which selects by FEATURE rather than by risk tier — tier proved '
                       'not to predict where renderer faults appear.'),
           'generated': '2026-08-19', 'sources': [], 'spans': []}

    for raw, src in sorted(by_raw.items()):
        rn = src.get('render') or {}
        f = scan(ROOT / raw, rn.get('pages'))
        out['sources'].append({
            'raw_file': raw, 'instrument_id': src['instrument_id'],
            'format': src['format'], 'risk_tier': src['risk_tier'],
            'pages_in_scope': rn.get('pages') or 'all',
            'features': {k: {'present': f[k] > 0, 'count': f[k]} for k in FEATURES},
            'hostile_features': [k for k in FEATURES if f[k] > 0]})

    for r in records:
        tf = r['source'].get('text_file')
        rendering = norm((ROOT / tf).read_text()) if tf and (ROOT / tf).exists() else ''
        out['spans'].append({'record_id': r['id'],
                             'instrument_id': r['source']['instrument_id'],
                             'features': span_features(r['verbatim_span'], rendering)})

    dest = ROOT / 'meta/source-features.yaml'
    body = ("# SOURCE FEATURE INVENTORY\n# ========================\n"
            + yaml.safe_dump(out, sort_keys=False, allow_unicode=True, width=100))
    if '--check' in sys.argv:
        if not dest.exists() or dest.read_text() != body:
            print('meta/source-features.yaml is STALE — run: python3 tools/scan-features.py')
            sys.exit(1)
        print('source-features.yaml is current')
        return
    dest.write_text(body)
    for s in out['sources']:
        print(f"{pathlib.Path(s['raw_file']).name:46} {s['risk_tier']:7} {','.join(s['hostile_features']) or '(none)'}")
    cov = collections.Counter(f for s in out['spans'] for f in s['features'])
    print(f"\nspans scanned {len(out['spans'])} · feature occurrences {dict(cov)}")


main()
