#!/usr/bin/env python3
"""Deterministic text rendering of a stored raw source, for CI gate 3.

A verbatim_span is checked against the SOURCE BYTES. When those bytes are a PDF
or an HTML page, they need rendering first — and that rendering has to be
reproducible, or gate 3 checks against something nobody can regenerate. This tool
is the only sanctioned renderer. The exact command it ran is recorded in the
atom's source.text_extraction_cmd so any reviewer can reproduce the haystack.

    python3 tools/render-text.py <raw_file> [--out <txt>] [--drop-re <regex> ...]

--drop-re deletes whole lines matching a regex. It exists for PDF page furniture
(running heads, page numbers, rule lines) that pdftotext interleaves into the
middle of a quoted provision. It is deliberately explicit rather than automatic:
whatever was stripped is visible in the recorded command, so a reviewer can see
that only page furniture went and no operative text did.

JSON -> NY OpenLegislation: extract result.text and unescape the LITERAL backslash-n
        sequences the API returns. Without the unescape every span carries "\\n" inside
        quoted statutory text; the escape is the transformation gate 11's analogue guards.
XML  -> structural walk, removing non-operative regions WITH THEIR TAILS REATTACHED.
        The tail matters: ElementTree stores inter-element text on the preceding
        sibling's .tail, so a bare remove() deletes the run of text after the element.
        In 15 U.S.C. s 1681c(f) that text was the obligation. tools/dual-parse.py is
        the standing guard on this function.
PDF  -> pdftotext -layout (poppler)
PDF  -> --column left:<x> | right:<x> reconstructs a single column from word
        bounding boxes. Legal PDFs are often two-column (APEC's Framework puts
        the principle left and the commentary right); -layout splices the two
        into one line, which would splice a quotation with commentary that is
        not part of it. Use --pages F-L to restrict the range.
HTML -> drop <script>/<style>, unescape entities, strip tags, collapse spaces

Nothing else is normalised. Quotation marks, dashes and casing survive, so a
reworded quote still fails gate 3.
"""
import sys, re, html, subprocess, hashlib, pathlib

Y_TOL = 2.0   # points; words within this vertical distance are the same visual line


XML_DROP = {'uslm': {'note', 'notes', 'sourceCredit'}, 'ecfr': {'AUTH', 'SOURCE', 'CITA'}}


def unescape_openleg(raw_text):
    """The one transformation openleg_json needs, isolated so it can be tested and reversed.

    The API returns literal two-character backslash-n sequences rather than newlines. Only
    that one escape appears in sampled text; anything else is returned untouched and
    reported, because a silently-handled unknown escape is how a quotation drifts."""
    return raw_text.replace('\\n', '\n')


def _json(src):
    import json as _json_mod
    d = _json_mod.loads(src.read_text(encoding='utf-8'))
    r = d.get('result', d)
    raw = r.get('text', '')
    txt = unescape_openleg(raw)
    other = sorted({m for m in re.findall(r'\\.', txt)})
    cmd = f'python3 tools/render-text.py {src}   # openleg_json: result.text, literal \\n unescaped'
    if other:
        cmd += f'   # WARNING unhandled escapes present: {other}'
    return txt.strip() + '\n', cmd


def _xml(src, flavour):
    import xml.etree.ElementTree as ET
    raw = re.sub(r'<!--.*?-->', '', src.read_text(encoding='utf-8'), flags=re.S)
    body = re.sub(r'^\s*<\?xml[^>]*\?>\s*', '', raw)
    ns = ' xmlns="http://xml.house.gov/schemas/uslm/1.0"' if flavour == 'uslm' else ''
    root = ET.fromstring(f'<rtwrap{ns}>{body}</rtwrap>')
    bare = lambda t: re.sub(r'^\{[^}]*\}', '', t)
    drop = XML_DROP[flavour]
    changed = True
    while changed:
        changed = False
        for parent in root.iter():
            for kid in list(parent):
                if bare(kid.tag) in drop or (flavour == 'uslm' and bare(kid.tag) == 'ref'
                                             and kid.get('class') == 'footnoteRef'):
                    kids = list(parent); i = kids.index(kid); tail = kid.tail or ''
                    parent.remove(kid)
                    if tail:                       # REATTACH — see module docstring
                        if i > 0: kids[i - 1].tail = (kids[i - 1].tail or '') + tail
                        else: parent.text = (parent.text or '') + tail
                    changed = True; break
            if changed: break
    out = []
    for el in root.iter():
        for chunk in (el.text, el.tail):
            if chunk and chunk.strip(): out.append(chunk.strip())
    text = '\n'.join(out)
    return text.strip() + '\n', f'python3 tools/render-text.py {src}   # xml:{flavour} structural, tails reattached'


def _column(src, spec, pages, min_h=None):
    """Reconstruct one column. min_h drops words below a glyph height, which is how
    footnotes and running furniture are separated from body text: in these
    documents body type sets ~11.7pt tall and footnotes ~9.5pt, so a threshold
    between them removes footnote text that would otherwise be spliced into the
    middle of a quoted provision."""
    side, x = spec.split(':'); x = float(x)
    args = ['pdftotext', '-bbox']
    if pages:
        f, l = pages.split('-'); args += ['-f', f, '-l', l]
    args += [str(src), '-']
    xml = subprocess.run(args, capture_output=True, check=True).stdout.decode('utf-8', 'replace')
    out = []
    for page in xml.split('<page ')[1:]:
        ws = [(float(a), float(b), float(d) - float(b), html.unescape(t)) for a, b, c, d, t in re.findall(
            r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', page)]
        if min_h is not None:
            ws = [w for w in ws if w[2] >= min_h]
        ws = [(a, b, t) for a, b, _h, t in ws]
        ws = [w for w in ws if (w[0] < x if side == 'left' else w[0] >= x)]
        # Cluster into visual lines with a tolerance. Exact-y bucketing is wrong:
        # subparagraph markers ("a)", "b)") are often typeset a fraction of a point
        # off the baseline of the text they label, which splits them into their own
        # line and emits them AFTER that text — silently producing "with the consent
        # of the individual a) whose ..." instead of "a) with the consent ...".
        # Gate 3 cannot catch that, because the corruption is in the rendering the
        # span is checked against. So it has to be right here.
        ws.sort(key=lambda w: (w[1], w[0]))
        lines, cur, cur_y = [], [], None
        for wx, wy, t in ws:
            if cur_y is None or wy - cur_y <= Y_TOL:
                cur.append((wx, t)); cur_y = cur_y if cur_y is not None else wy
            else:
                lines.append(cur); cur, cur_y = [(wx, t)], wy
        if cur: lines.append(cur)
        for ln in lines:
            out.append(' '.join(t for _, t in sorted(ln)))
        out.append('')
    cmd = (f'pdftotext -bbox {src} - | column {spec}'
           + (f' pages {pages}' if pages else '')
           + (f' min-height {min_h}' if min_h is not None else ''))
    return '\n'.join(out), cmd


def render(src: pathlib.Path, drops=None, column=None, pages=None, min_h=None) -> tuple[str, str]:
    ext = src.suffix.lower()
    if ext == '.json':
        text, cmd = _json(src)
        return _drop(text, drops, cmd)
    if ext == '.xml':
        head = src.read_text(encoding='utf-8')[:4000]
        flavour = 'uslm' if 'uslm' in head or 'usc/t' in head else 'ecfr'
        text, cmd = _xml(src, flavour)
        return _drop(text, drops, cmd)
    if ext == '.pdf' and column:
        text, cmd = _column(src, column, pages, min_h)
        return _drop(text, drops, cmd)
    if ext == '.pdf':
        cmd = f'pdftotext -layout {src} -'
        out = subprocess.run(['pdftotext', '-layout', str(src), '-'],
                             capture_output=True, check=True).stdout.decode('utf-8', 'replace')
        return _drop(out, drops, cmd)
    if ext in ('.html', '.htm'):
        cmd = f'python3 tools/render-text.py {src}   # html: strip script/style, unescape, strip tags, collapse spaces'
        raw = src.read_text(encoding='utf-8', errors='replace')
        t = re.sub(r'<(script|style)\b.*?</\1>', ' ', raw, flags=re.S | re.I)
        t = re.sub(r'<[^>]+>', ' ', t)
        t = html.unescape(t)
        t = re.sub(r'[ \t\r\f\v]+', ' ', t)
        t = re.sub(r' *\n *', '\n', t)
        t = re.sub(r'\n{3,}', '\n\n', t)
        return _drop(t.strip() + '\n', drops, cmd)
    # plain text passes through unchanged
    return _drop(src.read_text(encoding='utf-8', errors='replace'), drops, 'cat')


def _drop(text: str, drops, cmd: str):
    if not drops:
        return text, cmd
    pats = [re.compile(d) for d in drops]
    kept, removed = [], 0
    for line in text.split('\n'):
        if any(p.search(line) for p in pats):
            removed += 1
            continue
        kept.append(line)
    cmd += ''.join(f'  --drop-re {d!r}' for d in drops) + f'   # {removed} line(s) dropped'
    return '\n'.join(kept), cmd

if __name__ == '__main__':
    src = pathlib.Path(sys.argv[1])
    out = pathlib.Path(sys.argv[sys.argv.index('--out') + 1]) if '--out' in sys.argv \
          else src.with_suffix(src.suffix + '.txt')
    drops = [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == '--drop-re']
    opt = lambda n: sys.argv[sys.argv.index(n) + 1] if n in sys.argv else None
    mh = opt('--min-height')
    text, cmd = render(src, drops, opt('--column'), opt('--pages'), float(mh) if mh else None)
    out.write_text(text, encoding='utf-8')
    h = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f'{out}\n  sha256 {h}\n  cmd    {cmd}\n  chars  {len(text)}')
