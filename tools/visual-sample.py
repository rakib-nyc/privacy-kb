#!/usr/bin/env python3
"""Rasterise the page a span lives on, for CI gate 12.

Every other check reads a transformation of the document: poppler's text layer,
pdfminer's text layer, a regex over either. They can agree and still all be wrong
about the same thing, because they all start from the same content stream. This
one renders the page as an image so the passage can be read back the way a person
reading the document would see it. It is the only check that inspects the document
rather than a transformation of it, and it is sampled rather than exhaustive
because it needs a human or model in the loop.

    python3 tools/visual-sample.py <record_id> [--dpi 200] [--out DIR]

Locates the record, finds the page its verbatim_span starts on, renders it, and
prints the span so the two can be compared side by side.
"""
import sys, re, subprocess, pathlib, yaml, warnings
warnings.filterwarnings('ignore')

ROOT = pathlib.Path(__file__).resolve().parent.parent
norm = lambda s: re.sub(r'\s+', ' ', s).strip()


def find_record(rid):
    for p in ROOT.rglob('corpus/**/atoms/*.yaml'):
        r = yaml.safe_load(p.read_text())
        if r.get('id') == rid:
            return r
    raise SystemExit(f'no record with id {rid}')


def locate_page(pdf, span, pages):
    """First PDF page whose text contains the opening of the span."""
    lo, hi = (int(v) for v in pages.split('-')) if pages else (1, 10_000)
    words = norm(span).split()
    # Short head: in a two-column PDF the -layout text splices commentary between
    # the column's words, so only the first few survive as a contiguous run.
    for n in (4, 3, 2):
        head = ' '.join(words[:n]).lower()
        for pg in range(lo, hi + 1):
            out = subprocess.run(['pdftotext', '-f', str(pg), '-l', str(pg), '-layout', str(pdf), '-'],
                                 capture_output=True)
            if out.returncode:
                break
            if head in norm(out.stdout.decode('utf-8', 'replace')).lower():
                return pg
    return None


if __name__ == '__main__':
    rid = sys.argv[1]
    opt = lambda n, d=None: sys.argv[sys.argv.index(n) + 1] if n in sys.argv else d
    dpi = opt('--dpi', '200')
    outdir = pathlib.Path(opt('--out', '/tmp/visual-checks')); outdir.mkdir(parents=True, exist_ok=True)

    r = find_record(rid)
    src = r['source']
    pdf = ROOT / src['raw_file']
    pages = (src.get('render') or {}).get('pages')
    pg = locate_page(pdf, r['verbatim_span'], pages)
    if pg is None:
        raise SystemExit(f'could not locate the span on any page of {pdf.name}')
    stem = outdir / rid.replace('.', '-')
    subprocess.run(['pdftoppm', '-r', dpi, '-f', str(pg), '-l', str(pg), '-png',
                    str(pdf), str(stem)], check=True)
    png = next(iter(sorted(outdir.glob(stem.name + '*.png'))))
    print(f'record   {rid}')
    print(f'source   {src["raw_file"]}  (format {src["format"]}, risk_tier {src["risk_tier"]})')
    print(f'page     {pg}')
    print(f'image    {png}')
    print(f'span     {norm(r["verbatim_span"])}')
