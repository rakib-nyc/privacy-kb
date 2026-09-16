#!/usr/bin/env python3
"""INDEPENDENT second renderer, for CI gate 11.

tools/render-text.py builds lines from poppler word boxes using clustering logic
this repo wrote. That logic was wrong once: it bucketed words by exact baseline y,
so subparagraph markers typeset a fraction of a point off their own text line were
emitted AFTER that text — "with the consent of the individual a) whose ...". Every
gate passed, because gate 3 checks a span against the rendering, and the rendering
was the thing that was broken.

The defence is a second path that shares no layout code with the first. This one
uses pdfplumber (pdfminer.six) and lets IT assemble lines, via crop + extract_text.
It is deliberately NOT a reimplementation of the clustering in render-text.py: two
configurations of the same algorithm would agree on the same mistake.

    python3 tools/render-alt.py <pdf> [--column left:295] [--pages 11-23]
                                      [--min-height 10.5] [--drop-re RE ...]

Same parameters as render-text.py, different engine. Divergence between the two on
any verbatim_span blocks the commit.
"""
import sys, re, warnings
warnings.filterwarnings('ignore')
import pdfplumber


def render(path, column=None, pages=None, min_height=None, drops=None):
    out = []
    with pdfplumber.open(path) as pdf:
        if pages:
            f, l = (int(v) for v in pages.split('-'))
            sel = pdf.pages[f - 1:l]
        else:
            sel = pdf.pages
        for page in sel:
            p = page
            if min_height is not None:
                p = p.filter(lambda o: o.get('object_type') != 'char'
                             or (o.get('height') or 0) >= min_height)
            if column:
                # Filter on the character's LEFT edge rather than cropping to a box.
                # crop() clips glyphs that straddle the boundary, truncating words
                # ("Privac", "sho"); selecting by x0 keeps whole words that begin in
                # the column, which is what "this column's text" means. Line assembly
                # below is still pdfplumber's own — that is what makes this a second
                # opinion rather than a second configuration.
                side, x = column.split(':'); x = float(x)
                p = p.filter(lambda o: o.get('object_type') != 'char' or (
                    (o['x0'] < x) if side == 'left' else (o['x0'] >= x)))
            # pdfplumber's own word/line assembly — the point of this file.
            out.append(p.extract_text() or '')
    text = '\n'.join(out)
    if drops:
        pats = [re.compile(d) for d in drops]
        text = '\n'.join(l for l in text.split('\n') if not any(q.search(l) for q in pats))
    return text


if __name__ == '__main__':
    a = sys.argv
    opt = lambda n: a[a.index(n) + 1] if n in a else None
    mh = opt('--min-height')
    txt = render(a[1], opt('--column'), opt('--pages'),
                 float(mh) if mh else None,
                 [a[i + 1] for i, v in enumerate(a) if v == '--drop-re'])
    sys.stdout.write(txt)
