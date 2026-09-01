#!/usr/bin/env python3
"""Two independent parses of one structured source, compared. CI gate 11's analogue.

STANDING GUARD, NOT A SPOT CHECK. This runs on every extraction from every structured
source, permanently, for the same reason the PDF dual-renderer does: gate 3 proves a span
is faithful to a rendering, and a rendering is a transformation, and a transformation can
be wrong in ways nothing downstream can see.

The failure is not hypothetical and not exotic. In 15 U.S.C. § 1681c(f) a <note> element
sits INSIDE an operative sentence. The two obvious serializers both get it wrong, in
opposite directions:

  regex tag-strip   -> "...a consumer who 1 1 So in original. Probably should be 'which'.
                        was furnished..."   editorial commentary leaked INTO the quotation
  naive ElementTree -> "...a consumer who 1"
                        .remove() takes the element's .tail with it, and the tail was the
                        rest of the obligation

`.tail` loss is a property of tree-walking serializers in general, not of footnotes in
particular: removing ANY element removes the text that followed it. Every structured
extraction is exposed to it.

Text comparison alone is insufficient. Attributes are not text, and identifier attributes
are what paragraph_path rests on — so the inventory is compared too.

    python3 tools/dual-parse.py <file> --format uslm_xml|ecfr_xml|html [--json]
"""
import sys, re, json, html as htmllib
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

# Non-operative regions, by format. Removing these is the transformation being guarded.
DROP = {
    'uslm_xml': {'note', 'notes', 'sourceCredit'},
    'ecfr_xml': {'AUTH', 'SOURCE', 'CITA'},
    'html': set(),
    'openleg_json': set(),
}
canon = lambda s: re.sub(r'\s+', '', s)
NS = re.compile(r'^\{[^}]*\}')
bare = lambda t: NS.sub('', t)


# ---------------------------------------------------------------- engine A: regex
def engine_a(text, fmt):
    # nyc_xml, engine A: regex tag-strip. Deliberately NOT an XML parse, so it shares no code path
    # with engine B — two implementations agreeing is only evidence when they are independent.
    if fmt == 'nyc_xml':
        import html as _h
        body = re.sub(r'<[^>]+>', ' ', text.lstrip('\ufeff'))
        body = _h.unescape(body)          # the export uses &#167; &quot; &amp; and more
        return re.sub(r'\s+', ' ', body).strip()
    if fmt == 'openleg_json':
        # Engine A: pull result.text by REGEX over the raw bytes and decode the JSON string
        # escapes by hand. Deliberately does not use a JSON parser — it shares no code with
        # engine B, which is the whole point of having two engines.
        #
        # It must implement the FULL JSON string grammar, not just the escapes that happen
        # to appear today. An earlier version handled only \n and \" and left \u00a7
        # undecoded, so a span would have carried the literal characters "\u00a7" where the
        # statute has a section sign. The live API sends UTF-8 directly, so it never
        # surfaced there — the guard caught it on a re-serialised document.
        m = re.search(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"', text, re.S)
        if not m:
            return ''
        raw = m.group(1)
        out, i = [], 0
        SIMPLE = {'n': '\n', 't': '\t', 'r': '\r', 'b': '\b', 'f': '\f',
                  '"': '"', '/': '/', '\\': '\\'}
        while i < len(raw):
            ch = raw[i]
            if ch != '\\':
                out.append(ch); i += 1; continue
            nxt = raw[i + 1] if i + 1 < len(raw) else ''
            if nxt == 'u' and i + 5 < len(raw) + 1:
                try:
                    out.append(chr(int(raw[i + 2:i + 6], 16))); i += 6; continue
                except ValueError:
                    pass
            if nxt in SIMPLE:
                out.append(SIMPLE[nxt]); i += 2; continue
            out.append(ch); i += 1
        s = ''.join(out)
        # The API's own payload then contains LITERAL backslash-n as document content.
        s = s.replace('\\n', '\n')
        return canon(s)
    drop = DROP[fmt]
    # ElementTree discards comments silently; the regex engine must too, or the two
    # disagree on every file carrying one and the guard cries wolf.
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    if fmt == 'html':
        s = re.sub(r'<(script|style)\b.*?</\1>', ' ', text, flags=re.S | re.I)
    else:
        s = text
        # innermost-first, so a <notes> wrapper cannot swallow to the first </note>
        for _ in range(6):
            before = s
            for t in drop:
                s = re.sub(rf'<{t}\b(?![^>]*/>)[^>]*>(?:(?!<{t}\b).)*?</{t}>', '', s, flags=re.S)
            if s == before:
                break
        if fmt == 'uslm_xml':
            s = re.sub(r'<ref\b[^>]*class="footnoteRef"[^>]*>.*?</ref>', '', s, flags=re.S)
    return canon(htmllib.unescape(re.sub(r'<[^>]+>', ' ', s)))


# ---------------------------------------------------------------- engine B: tree walk
def _engine_b_openleg(text):
    """Engine B: a real JSON parser, then the documented unescape. Shares no code with A."""
    d = json.loads(text)
    r = d.get('result', d)
    return canon(r.get('text', '').replace('\\n', '\n'))


def _drop_preserving_tail(parent, kid):
    """Remove an element WITHOUT taking the text that follows it.

    ElementTree stores inter-element text on the preceding sibling's .tail, so a bare
    parent.remove(kid) silently deletes the run of text after the element. That is how
    an obligation went missing in § 1681c(f)."""
    kids = list(parent)
    i = kids.index(kid)
    tail = kid.tail or ''
    parent.remove(kid)
    if not tail:
        return
    if i > 0:
        prev = kids[i - 1]
        prev.tail = (prev.tail or '') + tail
    else:
        parent.text = (parent.text or '') + tail


def engine_b(text, fmt):
    # nyc_xml, engine B: an actual XML parse walking itertext(). Different failure modes from a
    # regex strip — this one breaks on malformed markup where the regex would silently sail past.
    if fmt == 'nyc_xml':
        import xml.etree.ElementTree as _ET
        # The export is UTF-8 with a BOM. Reading it as text leaves \ufeff at position 0, which
        # ElementTree rejects at column 1 — a failure that looks like malformed markup and is not.
        raw = text if isinstance(text, str) else text.decode('utf-8-sig', errors='ignore')
        root = _ET.fromstring(raw.lstrip('\ufeff'))
        return re.sub(r'\s+', ' ', ' '.join(root.itertext())).strip()
    if fmt == 'openleg_json':
        return _engine_b_openleg(text)
    if fmt == 'html':
        class P(HTMLParser):
            def __init__(s):
                super().__init__(convert_charrefs=True); s.out = []; s.skip = 0
            def handle_starttag(s, t, a):
                if t in ('script', 'style'): s.skip += 1
            def handle_endtag(s, t):
                if t in ('script', 'style') and s.skip: s.skip -= 1
            def handle_data(s, d):
                if not s.skip: s.out.append(d)
        p = P(); p.feed(text)
        return canon(''.join(p.out))

    body = re.sub(r'^\s*<\?xml[^>]*\?>\s*', '', text)   # a declaration cannot be wrapped
    root = ET.fromstring(f'<dpwrap xmlns="http://xml.house.gov/schemas/uslm/1.0">{body}</dpwrap>'
                         if fmt == 'uslm_xml' else f'<dpwrap>{body}</dpwrap>')
    drop = DROP[fmt]
    changed = True
    while changed:
        changed = False
        for parent in root.iter():
            for kid in list(parent):
                if bare(kid.tag) in drop or (
                        fmt == 'uslm_xml' and bare(kid.tag) == 'ref'
                        and kid.get('class') == 'footnoteRef'):
                    _drop_preserving_tail(parent, kid); changed = True; break
            if changed:
                break
    return canon(''.join(root.itertext()))


# ---------------------------------------------------------------- attribute inventory
def inventory(text, fmt):
    """What text comparison cannot see. identifier/id attributes carry paragraph_path."""
    if fmt == 'openleg_json':
        d = json.loads(text); r = d.get('result', d)
        # Identity and currency fields. A changed activeDate or a flipped repealed flag is
        # invisible to a text comparison and changes what the document IS.
        return sorted(f'{k}={r.get(k)}' for k in
                      ('lawId', 'locationId', 'docType', 'activeDate', 'repealed', 'title'))
    if fmt == 'html':
        return []
    return sorted(re.findall(r'\b(?:identifier|N|id)="([^"]+)"', text))


NOTE_REGIONS = {'uslm_xml': ('notes', 'note'), 'ecfr_xml': ('AUTH', 'SOURCE', 'CITA'),
                'html': (), 'openleg_json': ()}


def notes_identifiers(path, fmt):
    """Identifiers that live INSIDE a non-operative region.

    An atom anchored here quotes repealed or historical law as current: USLM <notes>
    reproduces prior versions of the statute verbatim. 11 of 47 operative-level elements
    in 15 U.S.C. s 1681c sit in that region. This is a hard rule, not a heuristic."""
    if fmt == 'html':
        return []
    text = re.sub(r'<!--.*?-->', '', open(path, encoding='utf-8').read(), flags=re.S)
    out = []
    for tag in NOTE_REGIONS[fmt]:
        for m in re.finditer(rf'<{tag}\b[^>]*>.*?</{tag}>', text, re.S):
            out += re.findall(r'\b(?:identifier|N|id)="([^"]+)"', m.group(0))
    return sorted(set(out))


def compare(path, fmt):
    text = open(path, encoding='utf-8').read()
    a, b = engine_a(text, fmt), engine_b(text, fmt)
    ia = ib = inventory(text, fmt)
    return dict(file=path, format=fmt, len_a=len(a), len_b=len(b),
                text_agree=(a == b), inventory_agree=(ia == ib),
                inventory_size=len(ia), agree=(a == b and ia == ib),
                first_divergence=_first_div(a, b))


def _first_div(a, b):
    if a == b:
        return None
    n = min(len(a), len(b))
    i = next((k for k in range(n) if a[k] != b[k]), n)
    return {'at': i, 'a': a[i:i + 90], 'b': b[i:i + 90]}


if __name__ == '__main__':
    f = sys.argv[1]
    fmt = sys.argv[sys.argv.index('--format') + 1]
    if '--notes-identifiers' in sys.argv:
        print(json.dumps(notes_identifiers(f, fmt))); sys.exit(0)
    r = compare(f, fmt)
    if '--json' in sys.argv:
        print(json.dumps(r))
    else:
        print(f"{'AGREE' if r['agree'] else 'DISAGREE'}  text={r['text_agree']} "
              f"inventory={r['inventory_agree']} ({r['inventory_size']} ids) "
              f"lenA={r['len_a']} lenB={r['len_b']}")
        if r['first_divergence']:
            d = r['first_divergence']
            print(f"  at {d['at']}\n    A: {d['a']}\n    B: {d['b']}")
