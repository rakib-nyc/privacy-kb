#!/usr/bin/env python3
"""Build the baseline-offset fixture for CI gate 11, from SYNTHETIC text.

Reproduces the ACTUAL bug that shipped: tools/render-text.py bucketed words by
exact baseline y, so a subparagraph marker typeset a fraction of a point off the
line it labels was emitted AFTER that line's text, turning

    a) with the consent of the individual whose data is collected;

into

    with the consent of the individual a) whose data is collected;

Gate 3 passed, because the span matched the rendering; the rendering was wrong.
Only a SECOND, independent renderer disagreeing catches that, which is gate 11.

WHY THE TEXT IS INVENTED. The bug was found on a published international
framework, and the fixture used to be an extract of it. That document is no
longer redistributed with this repository, so the fixture would have been
orphaned along with it. Nothing about the defect is specific to the source: it
is a TYPESETTING geometry, a marker whose baseline sits 0.4pt off its line. So
the fixture now generates its own PDF with that geometry and its own words, and
owes nothing to anyone. The wrongness of the rendering is still the point --
do not "fix" it.
"""
import pathlib, subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
PDF = ROOT / 'tests/fixtures/raw/baseline-offset.pdf'
OUT = ROOT / 'tests/fixtures/raw/baseline-offset.txt'

# (text, x, y). The markers sit 0.4pt BELOW their line -- invisible to a reader,
# decisive to a renderer that buckets on exact y.
LINES = [
    ('Permitted Uses',                                  72, 720.0),
    ('22. Collected information should be used only',   72, 700.0),
    ('to fulfil the purpose of collection and other',   72, 686.0),
    ('compatible purposes except:',                     72, 672.0),
    ('with the consent of the individual whose',        90, 658.0),
    ('a)',                                              72, 657.6),
    ('information is collected;',                       90, 644.0),
    ('when necessary to supply a product the',          90, 630.0),
    ('b)',                                              72, 629.6),
    ('individual has requested; or',                    90, 616.0),
    ('by the authority of law and other legal',         90, 602.0),
    ('c)',                                              72, 601.6),
    ('instruments of legal effect.',                    90, 588.0),
]

def pdf_bytes():
    # PARENTHESES ARE STRING DELIMITERS in a content stream, so the ")" in "a)" closes the
    # literal early and the marker silently disappears -- which is how the first version of this
    # fixture rendered without any markers at all and looked, misleadingly, like a clean page.
    esc = lambda t: t.replace('\\', r'\\\\').replace('(', r'\(').replace(')', r'\)')
    content = 'BT /F1 10 Tf\n' + ''.join(
        f'1 0 0 1 {x} {y} Tm ({esc(t)}) Tj\n' for t, x, y in LINES) + 'ET\n'
    cb = content.encode('latin-1')
    objs = [
        b'<</Type/Catalog/Pages 2 0 R>>',
        b'<</Type/Pages/Kids[3 0 R]/Count 1>>',
        b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]'
        b'/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
        b'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
        b'<</Length ' + str(len(cb)).encode() + b'>>\nstream\n' + cb + b'endstream',
    ]
    out, offsets = bytearray(b'%PDF-1.4\n'), []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f'{i} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(out)
    out += f'xref\n0 {len(objs)+1}\n'.encode() + b'0000000000 65535 f \n'
    for off in offsets:
        out += f'{off:010d} 00000 n \n'.encode()
    out += (f'trailer\n<</Size {len(objs)+1}/Root 1 0 R>>\nstartxref\n'
            f'{xref}\n%%EOF\n').encode()
    return bytes(out)

PDF.parent.mkdir(parents=True, exist_ok=True)
PDF.write_bytes(pdf_bytes())

# A CONTROL PAGE with the markers ON their baselines. Same words, same layout, no defect --
# the shape the offset page is a corruption OF. Other fixture cases need a synthetic PDF that
# renders CLEANLY, so that the gate they are testing is the only one they trip.
CLEAN = ROOT / 'tests/fixtures/raw/baseline-clean.pdf'
_orig = list(LINES)
LINES[:] = [(t, x, (y + 0.4 if t in ('a)', 'b)', 'c)') else y)) for t, x, y in _orig]
CLEAN.write_bytes(pdf_bytes())
LINES[:] = _orig
subprocess.run(['python3', str(ROOT / 'tools/render-text.py'), str(CLEAN),
                '--out', str(CLEAN.with_suffix('.txt'))], check=True, capture_output=True)
print(f'{CLEAN.relative_to(ROOT)}  (control: markers on baseline)')

# A synthetic HTML source, for the fixture that needs a non-PDF format.
HTML = ROOT / 'tests/fixtures/raw/collapsed-source.html'
# Deliberately markup-heavy. The fixture it feeds proves gate 14 catches a rendering that
# COLLAPSED -- seven characters recovered from a real page -- and that only reads as a collapse
# if the source was substantial to begin with. A three-line HTML file makes 7 characters look
# like a reasonable yield.
_nav = ''.join(f'<li><a href="/s/{i}" class="nav-item" data-idx="{i}">Section {i}</a></li>'
               for i in range(1, 24))
HTML.write_text('<!doctype html><html><head><meta charset="utf-8">'
                '<title>Synthetic Guidance</title></head><body>'
                f'<nav><ul>{_nav}</ul></nav>'
                '<main><h1>Synthetic Guidance</h1>'
                '<p>An organisation should limit collection to what is needed.</p>'
                '<p>An organisation should say what it collects and why.</p>'
                '</main></body></html>\n')
subprocess.run(['python3', str(ROOT / 'tools/render-text.py'), str(HTML),
                '--out', str(HTML.with_suffix('.txt'))], check=True, capture_output=True)
print(f'{HTML.relative_to(ROOT)}')

# Render with the BUGGY exact-y bucketing that shipped: group words by their exact
# baseline, so the offset markers fall into buckets of their own, ordered after the
# line they belong to.
xml = subprocess.run(['pdftotext', '-bbox', str(PDF), '-'],
                     capture_output=True, check=True).stdout.decode('utf-8', 'replace')
import re, html
words = [(float(m.group(1)), float(m.group(2)), html.unescape(m.group(3)))
         for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)</word>', xml)]
buckets = {}
for x, y, w in words:
    buckets.setdefault(round(y, 2), []).append((x, w))
lines = [' '.join(w for _, w in sorted(v)) for _, v in sorted(buckets.items())]
OUT.write_text('\n'.join(lines) + '\n')
print(f'{PDF.relative_to(ROOT)}  {len(pdf_bytes())} bytes')
print(f'{OUT.relative_to(ROOT)}')
print('--- rendering (markers land AFTER their text, which is the bug) ---')
print('\n'.join(lines))
