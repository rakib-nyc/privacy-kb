#!/usr/bin/env python3
"""Acquisition + segmentation + scaffolding for one instrument.

PROMPTS.md §2 Phase A/B, mechanised. Fetches from the structured source, renders it,
walks the hierarchy, and emits a segmentation table plus atom scaffolds with the source
block, paragraph_path and operative_context already filled in FROM THE DOCUMENT STRUCTURE
rather than by hand.

    python3 tools/extract.py --ecfr 16 682 --out corpus/federal/...
    python3 tools/extract.py --uslm 15 1681c --out corpus/federal/...
    python3 tools/extract.py ... --segment            # table only, no scaffolds

Scaffolds are a STARTING POINT, never a finished atom: summary, requirement_detail,
applies_if, exemptions, preemption and enforcement are all left as TODO because none of
them can be read off the structure. The tool does the mechanical part so the judgement
part gets the attention.
"""
import sys, re, os, json, zipfile, io, hashlib, subprocess, pathlib, urllib.request
import xml.etree.ElementTree as ET
import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
U = '{http://xml.house.gov/schemas/uslm/1.0}'
bare = lambda t: re.sub(r'^\{[^}]*\}', '', t)
n = lambda s: re.sub(r'\s+', ' ', s or '').strip()
UA = {'User-Agent': 'privacy-kb/0.1 (corpus fetch; contact repo owner)'}
sha = lambda b: hashlib.sha256(b).hexdigest()

# 'level' is USLM's GENERIC container, used where the drafter's hierarchy does not map onto the
# named types. 18 U.S.C. § 2511 has 57 of them, and omitting it meant the section — the Wiretap
# Act's core prohibition — segmented to ONE leaf out of 12,946 characters. The zero-leaf guard did
# not fire, because one is not zero. See meta/extractor-assumptions.yaml.
USLM_LEVELS = ('subsection','paragraph','subparagraph','clause','subclause','item','level')


def get(url, timeout=300, tries=3):
    """curl, not urllib. urllib truncated large release-point zips in this environment
    in a way that surfaced only as BadZipFile; curl handles them reliably."""
    import tempfile
    for _ in range(tries):
        with tempfile.NamedTemporaryFile(delete=False) as tf:
            tmp = tf.name
        r = subprocess.run(['curl', '-sSL', '--max-time', str(timeout),
                            '-A', UA['User-Agent'], '-o', tmp, url], capture_output=True)
        blob = pathlib.Path(tmp).read_bytes()
        os.unlink(tmp)
        if r.returncode == 0 and blob:
            return blob
        if os.environ.get('EXTRACT_DEBUG'):
            print(f'  curl rc={r.returncode} bytes={len(blob)} stderr={r.stderr[:200]!r}', file=sys.stderr)
    raise SystemExit(f'could not fetch {url}')


# ------------------------------------------------------------------ acquisition
def fetch_ecfr(title, part, date):
    url = f"https://www.ecfr.gov/api/versioner/v1/full/{date}/title-{title}.xml?part={part}"
    return get(url), url


CACHE = ROOT / '.uslm-cache'


def uslm_title(title, rp="119-1"):
    """Whole-title USLM XML, cached on disk. A title is the distribution unit and a
    section is the extraction unit; without a cache, twenty sections from title 15 means
    twenty 5MB downloads."""
    CACHE.mkdir(exist_ok=True)
    # The path segment uses a SLASH (119/1) while the filename suffix uses a HYPHEN
    # (119-1). Getting that wrong returns an XML error page, not a 404 — which is why it
    # surfaced as BadZipFile and looked like a network problem for far too long.
    url = (f"https://uscode.house.gov/download/releasepoints/us/pl/{rp.replace('-', '/')}"
           f"/xml_usc{int(title):02d}@{rp}.zip")
    dest = CACHE / f'usc{int(title):02d}@{rp}.xml'
    if dest.exists() and dest.stat().st_size > 1000:
        return dest.read_text(encoding='utf-8'), url
    zp = CACHE / f'usc{int(title):02d}@{rp}.zip'
    if zp.exists():
        whole = zipfile.ZipFile(zp).open(f'usc{int(title):02d}.xml').read().decode('utf-8')
        dest.write_text(whole, encoding='utf-8')
        return whole, url
    raise SystemExit(
        f"title {title} is not in the cache. Acquisition is deliberately NOT done here — it goes\n"
        f"through the harness, so every fetch is allowlisted and logged. Run:\n\n"
        f"    tools/fetch-uslm-title.sh {int(title):02d}\n")


def fetch_uslm(title, section, rp="119-1"):
    whole, url = uslm_title(title, rp)
    pos = re.search(r'<property role="is-positive-law">(\w+)</property>', whole[:9000]).group(1) == 'yes'
    # USLM writes hyphenated section numbers with an EN DASH (s1320d–5, s1681s–2),
    # not a hyphen. Accept either, or every hyphenated section silently "does not exist".
    variants = {section, section.replace('-', '\u2013'), section.replace('\u2013', '-')}
    start = None
    for v in variants:
        m0 = re.search(rf'<section[^>]*identifier="/us/usc/t{title}/s{re.escape(v)}"[^>]*>', whole)
        if m0: start = m0.start(); break
    if start is None:
        raise SystemExit(f"section {section} not found in title {title} (tried {sorted(variants)})")
    # BALANCE, DO NOT NON-GREEDY MATCH. A section can CONTAIN a <section> element — quoted
    # content in 5 U.S.C. § 552a does — and `<section...>.*?</section>` then closes on the
    # NESTED tag, returning a fragment with unbalanced tags that ElementTree refuses with
    # "mismatched tag". That failure was silent for the whole Privacy Act: the section simply
    # could not be extracted, and the instrument sat unstarted with no reason recorded.
    depth, i = 0, start
    tag = re.compile(r'<section\b|</section>')
    while True:
        mm = tag.search(whole, i)
        if not mm:
            raise SystemExit(f"section {section} in title {title} has unbalanced <section> tags")
        depth += 1 if mm.group(0) == '<section' else -1
        i = mm.end()
        if depth == 0:
            break
    return whole[start:i].encode('utf-8'), url, pos


# ------------------------------------------------------------------ segmentation
DROP_USLM = {'note', 'notes', 'sourceCredit'}


def subtree_text(el):
    """Text of a subtree, chunked EXACTLY as tools/render-text.py chunks it.

    itertext() concatenates across element boundaries with no separator, so an inline
    <ref> makes "...title that information..." come out as "...titlethat information...".
    The renderer emits each text chunk on its own line, which collapses to a space. If the
    two disagree, gate 3 rejects every span this tool scaffolds — as it should."""
    parts = []
    if el.text and el.text.strip():
        parts.append(el.text.strip())
    for kid in el:
        parts.append(subtree_text(kid))
        if kid.tail and kid.tail.strip():
            parts.append(kid.tail.strip())
    return ' '.join(x for x in parts if x)


def _strip_apparatus(root):
    """Remove notes and source credits, REATTACHING TAILS.

    Without this, an inline footnote lands inside the operative text: 42 U.S.C.
    § 1320d-5(a)(1)(C)(i) renders as "...subsection (b)(3)(A),11 So in original. Probably
    should be...". A bare remove() would instead delete the rest of the sentence — see
    tools/dual-parse.py. Both failures are silent, so this is done once, here."""
    changed = True
    while changed:
        changed = False
        for parent in root.iter():
            for kid in list(parent):
                if bare(kid.tag) in DROP_USLM or (bare(kid.tag) == 'ref' and kid.get('class') == 'footnoteRef'):
                    kids = list(parent); i = kids.index(kid); tail = kid.tail or ''
                    parent.remove(kid)
                    if tail:
                        if i > 0: kids[i-1].tail = (kids[i-1].tail or '') + tail
                        else: parent.text = (parent.text or '') + tail
                    changed = True; break
            if changed: break
    return root


def walk_uslm(xml_bytes):
    body = re.sub(r'^\s*<\?xml[^>]*\?>\s*', '', xml_bytes.decode('utf-8'))
    root = _strip_apparatus(ET.fromstring(f'<w xmlns="http://xml.house.gov/schemas/uslm/1.0">{body}</w>'))
    out = []

    def rec(el, path, ctx):
        for ch in el:
            t = bare(ch.tag)
            if t == 'notes':
                continue
            if t not in USLM_LEVELS:
                continue
            num = ch.find(U + 'num')
            desig = n(num.get('value') if num is not None and num.get('value') else
                      (n(num.text) if num is not None else '')).strip('().')
            p2 = path + [desig] if desig else path
            chap = ch.find(U + 'chapeau')
            conts = ch.findall(U + 'continuation')
            cont = ch.find(U + 'content')
            head = ch.find(U + 'heading')
            my_ctx = list(ctx)
            if chap is not None:
                my_ctx.append(dict(position='precedes', text=n(subtree_text(chap)),
                                   path=path + ([desig] if desig else []), anchor=ch.get('identifier')))
            for c in conts:
                my_ctx.append(dict(position='follows', text=n(subtree_text(c)),
                                   path=path + ([desig] if desig else []), anchor=ch.get('identifier')))
            kids = [k for k in ch if bare(k.tag) in USLM_LEVELS]
            if cont is not None and not kids:
                out.append(dict(path=p2, anchor=ch.get('identifier'),
                                heading=n(subtree_text(head)) if head is not None else '',
                                text=n(subtree_text(cont)), context=ctx))
            rec(ch, p2, my_ctx)
    # section-level chapeau
    sec = root.find(U + 'section')
    base_ctx = []
    if sec is not None:
        sc = sec.find(U + 'chapeau')
        if sc is not None:
            base_ctx.append(dict(position='precedes', text=n(subtree_text(sc)),
                                 path=[], anchor=sec.get('identifier')))
        rec(sec, [], base_ctx)

    # LARGE-AND-COMPLEX SECTIONS ARE FLAT, AND THIS WALKER REFUSES THEM.
    # USLM marks some sections -uslm-lc and publishes the whole body as <p class="indentN"> inside
    # one <content>, with NO subsection or paragraph elements. 15 U.S.C. 1681g is one, and the
    # structural walker above returns zero leaves for it.
    #
    # It looks like indentN encodes depth. It does not: in 1681g the heading line "(a) Information
    # on file" carries indent2 while its own body carries indent0, because the classes are
    # TYPOGRAPHIC. Reconstructing from them put paragraph (1) at path ["1"] instead of ["a","1"] —
    # a path that is UNIQUE and WRONG, which gate 23 cannot catch and which would produce a
    # confident citation to the wrong provision. That is worse than having no extraction at all.
    #
    # So: refuse, loudly, and let meta/instrument-coverage.yaml keep reporting the category as
    # absent. See meta/debt.yaml DEBT-015.
    if not out and sec is not None:
        cont = sec.find(U + 'content')
        ps = [x for x in (cont if cont is not None else []) if bare(x.tag) == 'p']
        # ONE UNDESIGNATED PARAGRAPH IS A WHOLE-SECTION PROVISION, not a depth problem.
        # 29 U.S.C. § 157 (NLRA § 7) and 18 U.S.C. § 2713 are each a single sentence with no
        # designator anywhere. The refusal below exists for sections whose depth must be
        # reconstructed from typographic markup; a section with nothing to reconstruct is the
        # `undesignated-section-is-still-a-provision` case, which was implemented for walk_ecfr
        # and walk_openleg and never for walk_uslm. The assumption was declared, tested against
        # two walkers, and the third was never asked.
        if len(ps) == 1:
            whole = n(subtree_text(ps[0]))
            if whole:
                return [dict(path=[], anchor=sec.get('identifier'),
                             heading=n(subtree_text(sec.find(U + 'heading'))) if sec.find(U + 'heading') is not None else '',
                             text=whole, context=[], confidence='high')]
        if ps:
            # DEBT-015. Depth cannot be READ from these <p> elements — the indent classes are
            # typographic — but it CAN be reconstructed from the designators themselves, using the
            # same continuation-before-descent algorithm walk_ecfr uses and has been tested on.
            # The difference from the earlier attempt is honesty about what that produces:
            # derivation is 'reconstructed', not 'structural', so gate 16 applies its scrutiny,
            # gate 23 refuses any collision, and gate 30 checks each path against its own citation.
            # A wrong path is still possible; what is no longer possible is a wrong path wearing
            # the confidence of a structural one.
            texts = [n(subtree_text(x)) for x in ps]
            if os.environ.get('USLM_RECONSTRUCT_FLAT') == '1':
                body = ''.join(f'<P>{t}</P>' for t in texts if t)
                div = f'<DIV8 N="{sec.get("identifier","").split("/")[-1]}" TYPE="SECTION">' \
                      f'<HEAD>{n(subtree_text(sec.find(U + "heading"))) if sec.find(U + "heading") is not None else ""}</HEAD>' \
                      f'{body}</DIV8>'
                lv = walk_ecfr(div.encode('utf-8'))
                for l in lv:
                    l['anchor'] = sec.get('identifier')
                    l['derivation'] = 'reconstructed'
                    # The synthetic DIV8 wrapper gives every leaf a section label taken from the
                    # identifier, which then disagrees with the USLM anchor an atom cites. A
                    # single-section segmentation needs no section filter, so drop it rather than
                    # invent a label that has to be matched.
                    l['section'] = None
                return lv
            raise SystemExit(
                f"REFUSED: {sec.get('identifier')} is a USLM large-and-complex section — "
                f"{len(ps)} flat <p> elements with no structural nesting. Depth cannot be read from "
                f"the indent classes (they are typographic: the (a) heading is indent2, its body "
                f"indent0), and reconstructing from designators alone produced unique-but-WRONG "
                f"paths. A wrong path that is unique passes gate 23. See DEBT-015.")
    return out


def walk_ecfr(xml_bytes):
    """eCFR has no element nesting below the section: flat <P> siblings with textual
    designators. Depth must be RECONSTRUCTED, which is why paragraph_path.derivation
    exists and why confidence can be low.

    Two rules make the reconstruction work:

      CONTINUATION BEFORE DESCENT. An ambiguous designator continues an open level only
      if it is the literal successor of that level's last designator — (i) continues a
      letter run only after (h). Otherwise, if it is the FIRST element of a sequence
      (a, 1, i, A), it opens a NEW deeper level. Without this, (b)(1)(i) resolved (i) as
      letter-9, popped the (b) level, and produced the path ["i"] — an ancestor silently
      replaced by its own grandchild.

      COMPOUND DESIGNATORS. eCFR writes "(d)(1) Regularly test..." in a single <P>. Only
      stripping the first marker leaves "(1)" sitting inside the operative text and loses
      a level of depth.

      RUN-IN HEADINGS HIDE THE DESIGNATOR. eCFR italicises a paragraph's heading and runs
      it into the text: "<I>Exception to annual privacy notice requirement</I> —(1) When
      exception available." Anchoring the designator scan at ^ misses that (1) entirely,
      so (e)(1)(i) and (e)(2)(i) both came out as ["e","i"] — two different provisions on
      one path. A path that is not unique is not a citation. The scan therefore starts
      AFTER a leading italic run, which must be read from the ELEMENT, not the flattened
      string: once <I> is stripped to text there is nothing left to tell a heading from
      the sentence it introduces.

      HEADED PARAGRAPHS WITH NO DESIGNATOR ARE NOT CONTINUATIONS. A definition entry --
      "<I>Business associate</I> means:" -- carries no designator at all. Appending it to
      whatever level was open concatenated unrelated provisions, and left its (1),(2)
      children hanging on a stale stack: in 45 CFR 160.103 the single path ("1",) was
      shared by TWENTY distinct leaves, one per defined term. A paragraph that has its own
      heading is a new provision, so the heading opens a new root and the term becomes the
      path key -- which is how the CFR cites itself: "paragraphs (1)(i) or (1)(ii) of the
      definition of protected health information".
    """
    import html as H
    text = xml_bytes.decode('utf-8')
    out = []
    ORDERS = [('a', [chr(c) for c in range(97, 123)]),
              ('1', [str(i) for i in range(1, 60)]),
              ('i', ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi','xii','xiii','xiv',
                     'xv','xvi','xvii','xviii','xix','xx']),
              ('A', [chr(c) for c in range(65, 91)])]
    SEQ = dict(ORDERS)
    # NO ^ ANCHOR. .match(raw, pos) already anchors at pos, but a literal ^ still only
    # matches at the true string start, so every scan past the first designator would
    # silently fail and the run-in heading fix would look like it had done nothing.
    LEAD = re.compile(r'((?:\([A-Za-z0-9ivxlIVXL]{1,5}\)\s*)+)')

    for sec in re.finditer(r'<DIV8[^>]*N="([^"]+)"[^>]*>(.*?)</DIV8>', text, re.S):
        num, body = sec.group(1), sec.group(2)
        head = re.search(r'<HEAD>(.*?)</HEAD>', body, re.S)
        # A SECTION WITH NO DESIGNATED PARAGRAPHS IS STILL A PROVISION. 16 C.F.R. § 314.6 is one
        # sentence — "Section 314.4(b)(1), (d)(2), (h), and (i) do not apply to financial
        # institutions that maintain customer information concerning fewer than five thousand
        # consumers" — and it is the Safeguards Rule's size-threshold exemption. Requiring a
        # designator dropped it and § 314.5 silently: the part extracted, the gates passed, and two
        # sections simply were not there. Same defect the openleg walker had with GBL § 350.
        secn_before = len(out)
        stack = []                      # [(kind, designator, text)]
        for p in re.finditer(r'<P[^>]*>(.*?)</P>', body, re.S):
            # Chunk exactly as tools/render-text.py does. A regex tag-strip concatenates
            # across element boundaries, so "<I>Standard</I>—(1)" comes out "Standard—(1)"
            # while the renderer emits "Standard" and "—(1)" as separate chunks and
            # normalises to "Standard —(1)". Gate 3 rejects every span until they agree.
            try:
                el = ET.fromstring('<P>' + p.group(1) + '</P>')
                raw = n(subtree_text(el))
            except ET.ParseError:
                raw = n(H.unescape(re.sub(r'<[^>]+>', ' ', p.group(1))))
            # Designators and italic HEADINGS interleave, and only the element knows
            # which is which: "(2) <I>Examples</I>-(i) <I>Reasonably understandable.</I>
            # You make..." carries TWO levels, and flattening <I> away hides the second.
            # So scan raw left-to-right, consuming a designator group or a known italic
            # heading, until neither matches. raw itself is never rewritten -- gate 3
            # compares spans against the renderer's output, so the text must stay intact.
            italics = [n(subtree_text(c)) for c in el.findall('I')]
            italics = [i for i in italics if i]
            desigs, headings, pos = [], [], 0
            while True:
                while pos < len(raw) and raw[pos] in ' \t\u2014\u2013-.':
                    pos += 1
                m = LEAD.match(raw, pos)
                # Only a group in which EVERY token is a real designator counts. Scanning
                # past position 0 means the scan now meets ordinary parentheticals --
                # "(as defined in this section)" matches the shape of a designator and is
                # not one. Accepting it both mis-nested the paragraph and crashed on the
                # empty candidate list.
                if m:
                    found = re.findall(r'\(([A-Za-z0-9ivxlIVXL]{1,5})\)', m.group(1))
                    if found and all(any(d in seq for _, seq in ORDERS) for d in found):
                        desigs += found
                        pos = m.end(); continue
                hit = next((i for i in italics if raw.startswith(i, pos)), None)
                if hit:
                    headings.append(hit); pos += len(hit); continue
                break
            rest = raw[pos:].strip()

            if not desigs:
                if headings:
                    # Headed but undesignated: a definition entry. It opens a NEW root
                    # keyed by the term -- it is not a continuation of whatever level was
                    # open, and its (1),(2) children must not land on that stale stack.
                    stack = [('term', headings[0], '')]
                    out.append(dict(path=[headings[0]], anchor=None, section=num,
                                    confidence='medium', text=rest, context=[],
                                    heading=n(re.sub(r'<[^>]+>', '', head.group(1))) if head else ''))
                    continue
                if stack:
                    stack[-1] = (stack[-1][0], stack[-1][1], stack[-1][2] + ' ' + raw)
                elif rest:
                    # AN UNDESIGNATED STEM AT THE START OF A SECTION IS THE OPERATIVE SENTENCE,
                    # and it was being DROPPED. 49 C.F.R. § 40.321 opens "Except as otherwise
                    # provided in this subpart ... you are prohibited from releasing individual
                    # test results" and then defines terms at (a) and (b). With the stack empty
                    # there was nothing to append the stem to, so it went nowhere — the section's
                    # only prohibition, absent, while (a) and (b) extracted fine.
                    #
                    # Distinct from the whole-section-undesignated case, which only fires when a
                    # section has no designators ANYWHERE. Here the section has both.
                    out.append(dict(path=[], anchor=None, section=num, confidence='high',
                                    heading=n(re.sub(r'<[^>]+>', '', head.group(1))) if head else '',
                                    text=rest, context=[]))
                continue
            conf = 'high'
            # A term root spans only the definitions block. The next lettered paragraph is
            # its SIBLING, not its child: without this, everything after "Summary health
            # information means..." in 45 CFR 164.504 nested under that term and (e)(1)(i)
            # collided with the definition's own (1)(i).
            if stack and stack[0][0] == 'term' and desigs[0] in SEQ['a'] and desigs[0] not in SEQ['i']:
                stack = []
            for di, desig in enumerate(desigs):
                body_text = rest if di == len(desigs) - 1 else ''
                cands = [k for k, seq in ORDERS if desig in seq]
                kind = None
                if len(cands) == 1:
                    kind = cands[0]
                else:
                    # continuation of an open level?
                    for lvl in range(len(stack) - 1, -1, -1):
                        k, d, _ = stack[lvl]
                        if k not in SEQ:        # 'term' root: not a designator sequence
                            continue
                        sq = SEQ[k]
                        if d in sq and sq.index(d) + 1 < len(sq) and sq[sq.index(d) + 1] == desig:
                            kind = k; break
                    if kind is None:
                        # first element of a sequence -> open a new deeper level
                        firsts = [k for k in cands if SEQ[k][0] == desig]
                        if firsts:
                            kind = firsts[-1]           # deepest plausible new level
                        else:
                            kind = cands[0]; conf = 'low'
                if any(s[0] == kind for s in stack):
                    while stack and stack[-1][0] != kind:
                        stack.pop()
                    stack[-1] = (kind, desig, body_text)
                else:
                    stack.append((kind, desig, body_text))
            path = [s[1] for s in stack]
            ctx = [dict(position='precedes', text=s[2], path=[x[1] for x in stack[:i+1]], anchor=None)
                   for i, s in enumerate(stack[:-1]) if s[2].strip()]
            out.append(dict(path=path, anchor=None, section=num, confidence=conf,
                            heading=n(re.sub(r'<[^>]+>', '', head.group(1))) if head else '',
                            text=rest, context=ctx))
        if len(out) == secn_before:
            # No designated paragraph anywhere in the section: emit the section itself.
            whole = n(' '.join(
                n(H.unescape(re.sub(r'<[^>]+>', ' ', m.group(1))))
                for m in re.finditer(r'<P[^>]*>(.*?)</P>', body, re.S)))
            whole = re.sub(r'^\s*§\s*[\d.]+\s*[^.]*\.\s*', '', whole).strip()
            whole = re.sub(r'\[\d+ FR \d+.*?\]\s*$', '', whole).strip()
            if whole:
                out.append(dict(path=[], anchor=None, section=num, confidence='high',
                                heading=n(re.sub(r'<[^>]+>', '', head.group(1))) if head else '',
                                text=whole, context=[]))
    return out


def walk_nycxml(xml_bytes, subchapter=None):
    """NYC Administrative Code / Rules XML export.

    A FOURTH walker, and the first one where depth is genuinely READ rather than reconstructed:
    <LEVEL style-name="Section"> nests, and a <RECORD> hangs inside it. That makes this the best
    structured source in the corpus after USLM, and better than eCFR, which has no nesting at all.

    Per meta/extractor-assumptions.yaml, a new walker inherits every premise the others learned:
    an undesignated paragraph is still a provision, zero leaves is never a pass, and a designator
    mid-sentence is a cross-reference. Depth coming from the markup means most of them cannot
    arise here — which is the point of reading structure instead of guessing it.
    """
    body = xml_bytes.decode('utf-8-sig', errors='ignore')
    root = ET.fromstring(body)
    out = []

    def text_of(el):
        return n(subtree_text(el))

    last = {'letter': None, 'sec': None}

    def rec(el, sec, path):
        for ch in el:
            t = bare(ch.tag)
            if t == 'LEVEL':
                style = (ch.get('style-name') or '')
                head = ch.find('.//HEADING')
                if style == 'Section' and head is not None:
                    m = re.match(r'^\s*§\s*([\w.-]+)', n(head.text or ''))
                    rec(ch, m.group(1) if m else sec, [])
                else:
                    rec(ch, sec, path)
            elif t == 'RECORD':
                for para in ch.findall('PARA'):
                    txt = text_of(para)
                    if not txt:
                        continue
                    # A section HEADING is repeated as its own PARA in this export. Skip the echo
                    # rather than emit the heading as a provision.
                    if re.match(r'^\s*§\s*[\w.-]+\s', txt) and len(txt) < 120:
                        continue
                    # APPARATUS. This export carries [ALP S-068] publisher markers and trailing
                    # session-law credits inside the operative <PARA>. Recorded as removal here
                    # rather than left in a span, per the apparatus policy.
                    txt = re.sub(r'\s*\[ALP\s+[^\]]*\]\s*', ' ', txt).strip()
                    if re.match(r'^\(L\.L\.', txt):
                        continue          # session-law credit line, not a provision
                    if not txt:
                        continue
                    # NYC uses "a." and "(1)" and "(i)" — three designator forms in one document.
                    # A bare "1." nests under the LETTER most recently opened in this section.
                    # The export lays RECORDs out flat, so the letter is not an ancestor in the
                    # markup even though it is one in the law — the same bare-numbered-subdivision
                    # problem the NY openleg walker had, arriving from the other direction.
                    num = re.match(r'^(\d{1,2})\.\s+', txt)
                    if num and last['sec'] == sec and last['letter']:
                        out.append(dict(path=[last['letter'], num.group(1)], anchor=sec,
                                        section=sec, confidence='high', heading='',
                                        text=txt[num.end():].strip(), context=[],
                                        derivation='structural'))
                        continue
                    m = (re.match(r'^\(([A-Za-z0-9ivxlIVXL]{1,5})\)\s*', txt)
                         or re.match(r'^([a-z])\.\s+', txt))
                    if m:
                        p2 = path + [m.group(1)]; rest = txt[m.end():].strip()
                        if re.fullmatch(r'[a-z]', m.group(1)):
                            last['letter'] = m.group(1); last['sec'] = sec
                    else:
                        # UNDESIGNATED DEFINITION ENTRY. § 20-870 keys its definitions by TERM,
                        # exactly as 45 C.F.R. § 160.103 does — the assumption register's
                        # definition-entries-carry-no-designator case, arriving in a new walker.
                        dm = re.match(r'^([A-Z][^.]{2,60})\.\s+The term', txt)
                        if dm:
                            p2 = [dm.group(1).strip()]; rest = txt
                        else:
                            p2 = path; rest = txt
                    out.append(dict(path=p2, anchor=sec, section=sec, confidence='high',
                                    heading='', text=rest, context=[], derivation='structural'))
    rec(root, None, [])
    if subchapter:
        lo, hi = subchapter
        out = [l for l in out if l['section'] and lo <= l['section'] <= hi]
    return out


def walk_openleg(json_bytes):
    """NY OpenLegislation. Hierarchy below section level is RECONSTRUCTED from designators
    in a flat text field — the API exposes no structure there at all, which is weaker than
    eCFR (that at least has <P> boundaries). Reuses the same continuation-before-descent
    rule, because the (i) letter-vs-roman collision occurs here too."""
    import json as J
    d = J.loads(json_bytes.decode('utf-8'))
    r = d.get('result', d)
    text = (r.get('text') or '').replace('\\n', '\n')
    loc = r.get('locationId')
    ORDERS = [('a', [chr(c) for c in range(97, 123)]),
              ('1', [str(i) for i in range(1, 60)]),
              ('i', ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi','xii','xiii','xiv','xv']),
              ('A', [chr(c) for c in range(65, 91)])]
    SEQ = dict(ORDERS)
    # NY consolidated text opens "  § 349. <heading>. (a) <body>" — the FIRST designator
    # sits at the END of the heading line, not at a line start. Without stripping the
    # heading, (a) is absorbed into a non-designator chunk and every top-level subdivision
    # is lost: paths came out as ["1"] and ["2","c"] instead of ["a","1"] and ["c"].
    head_m = re.match(r'^\s*\*?\s*§\s*[^.]*\.\s*.*?(?=\([A-Za-z0-9]{1,5}\)|\b1\.\s)', text, re.S)
    section_heading = head_m.group(0).strip() if head_m else ''
    if head_m:
        # THE STRIPPER'S LOOKAHEAD CAN EAT ENACTED TEXT, AND DID. The regex runs to the first
        # parenthetical ANYWHERE, on the assumption that the first parenthetical is the section's
        # first paragraph. In 6 RCNY § 5-300 the first parenthetical is a mid-sentence
        # cross-reference — "...required to be reported by employers pursuant / to subsection (c)
        # of section 2000e-8 of title 42 of the United States Code" — so the lookahead consumed
        # 1,360 characters, THREE COMPLETE DEFINITIONS, and then promoted a citation to the U.S.
        # Code to be the section's opening paragraph. Mid-sentence references to the U.S. Code are
        # ordinary in state regulations, so this is not an exotic shape.
        #
        # THE TEST IS DIRECT, NOT A VOLUME PROXY. A recovery-ratio check would miss a section that
        # loses one definition out of ten and still scores well. A genuine heading is "§ <num>.
        # <heading>." and has NOTHING after its own terminating period. Deleted enacted text
        # always does. So: strip the number, strip the heading up to its first sentence
        # terminator, and refuse if substantive text remains.
        eaten = head_m.group(0)
        after_num = re.sub(r'^\s*\*?\s*§\s*[^.]*\.\s*', '', eaten, count=1)
        rest = re.sub(r'^[^.]*\.\s*', '', after_num, count=1)      # drop the heading proper
        # THE DISCRIMINATOR IS A SENTENCE TERMINATOR, NOT A LENGTH. Length was the first attempt
        # and it was the same volume proxy this guard exists to replace: it refused three
        # committed sources whose stripper consumed a legitimate CHAPEAU — "For purposes of this
        # article, the following terms shall have the following meanings:" — which is enacted
        # text but is one unterminated clause introducing the enumeration below it. Deleted
        # PROVISIONS are complete sentences and always carry a terminator with text after it;
        # a chapeau ends on the colon that hands off to the list. So test for a period followed
        # by more text, which is what distinguishes the two directly.
        lost = re.search(r'[.!?]\s+\S', rest)
        if lost and len(rest.strip()) > 40:
            raise SystemExit(
                f"REFUSED: the heading stripper consumed {len(eaten)} characters of {loc}, of which "
                f"{len(rest.strip())} sit AFTER the heading's own terminating period. That is "
                f"enacted text, not apparatus, and it would be deleted silently.\n"
                f"  first parenthetical found at: ...{eaten[-70:]!r}\n"
                f"  text that would be lost began: {rest.strip()[:90]!r}\n"
                f"This section's first parenthetical is probably a mid-sentence cross-reference "
                f"rather than its first paragraph. See meta/validation-events.yaml VE-007.")
        text = text[head_m.end():]
    # Trailing multi-version note, e.g. "* NB Effective February 17, 2026".
    # THIS RIDES ON EVERY LEAF, not just the ones the designator walker emits. The note is the
    # only in-document evidence that a section is not yet law, and the walker has three exits:
    # the section root, the bare-subdivision branch, and the parenthesised-designator branch.
    # Only the third carried it. On the SAFE for Kids Act that lost the effective date from
    # seven of nine sections — §§ 1502-1505 exit at the root and §§ 1506-1508 through the
    # subdivision branch, so the article whose whole point is a FUTURE effective_from would
    # have been segmented with nothing in it saying so. An atom claiming enacted_pending has
    # to be able to point at the words that make it pending.
    nb = re.search(r'^\s*\*\s*NB .*$', text, re.M)
    nb_note = nb.group(0).strip() if nb else None
    if nb:
        text = text[:nb.start()]

    # BARE ROMANS, THE SAME DEFECT ONE LEVEL DOWN. NY writes "a."; the NYC rules write "i.",
    # "ii.", "iii." — and the letter normaliser above cannot see them, because it matches a
    # SINGLE character and anchors to column 0-3. In 6 RCNY § 5-301(b)(3) the three roman
    # sub-items were absorbed into their parent paragraph, so the requirement to compute
    # INTERSECTIONAL impact ratios — sex x ethnicity x race, the substantive core of the bias
    # audit — had no citable path of its own. That is not a collision, so gate 23 never sees it:
    # nothing cites the leaf, because the leaf does not exist. Silent flattening, not a clash.
    #
    # Indentation is NOT a signal here and must not be used as one. In the DCWP rule the same
    # roman run appears at column 15 before a page break and column 6 after it, because the PDF
    # resets its left margin per page. Sequence is the only reliable evidence, which is what the
    # designator walker below already assumes.
    #
    # "i" is both a letter and a roman numeral. That ambiguity is NOT resolved here — rewriting
    # to "(i)" hands it to the ORDERS/SEQ logic below, which already decides whether (i) after
    # (h) continues a letter run or (i) after (1) opens a roman one. Requiring at least TWO in
    # succession keeps a stray sentence opening "i." from being promoted.
    return walk_designated_text(text, loc, section_heading, nb_note,
                                r.get('activeDate'), ORDERS, r.get('title') or '')



def walk_designated_text(text, loc, section_heading='', nb_note=None, active_date=None,
                         ORDERS=None, heading_title=''):
    """The designator walker, over ALREADY-RENDERED TEXT.

    Factored out of walk_openleg when the NYC rules arrived as a PDF. The shape it walks —
    (a) then (1) then i., hard-wrapped, designators in strict sequence, indentation unreliable —
    is a DRAFTING convention, not a FORMAT one, and it is the same in NY consolidated law and in
    Title 6 of the Rules of the City of New York. Writing a fifth walker for the PDF would have
    duplicated every rule in this one, including the four that were only discovered by being
    wrong: the wrapped cross-reference, the or/and joint, the bare designators, and the
    sibling-successor test. A copy would have been born missing all of them.
    """
    if ORDERS is None:
        ORDERS = [('a', [chr(c) for c in range(97, 123)]),
                  ('1', [str(i) for i in range(1, 60)]),
                  ('i', ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi','xii','xiii','xiv','xv']),
                  ('A', [chr(c) for c in range(65, 91)])]
    SEQ = dict(ORDERS)
    r = {'title': heading_title, 'activeDate': active_date}
    # NY numbers its SUBDIVISIONS bare — "  2. Any person or business which owns..." — and
    # only its paragraphs parenthetically. Recognising only "(x)" lost the subdivision level
    # entirely, so GBL § 899-aa came back with ("a") appearing three times and ("b") six: the
    # (a),(b) under subdivisions 2, 5, 6 and 8 all collapsed onto one path. Same defect class
    # as the eCFR run-in headings, different surface syntax.
    # NY ALSO LETTERS ITS PARAGRAPHS BARE. GBL writes "(a)"; EDUCATION LAW writes "a." — and the
    # walker knew only the parenthesised form, so in EDN § 2-d the ENTIRE LETTER LEVEL vanished.
    # Subdivision 2's paragraph (a) and paragraph (b) both carried numbered lists, and with the
    # letter gone both lists landed on 2.1, 2.2, 2.3 …: fourteen COLLIDING PATHS in one section,
    # each claiming to resolve to exactly one leaf while resolving to two. The chief privacy
    # officer's duties and the chief privacy officer's powers were addressed by the same citation.
    #
    # Rewriting to the parenthesised form keeps every downstream rule intact. Two conditions make
    # the rewrite safe against prose that merely begins with a letter and a period: the letters
    # must run in STRICT SUCCESSION from "a", and the first one is only taken inline (NY opens
    # paragraph (a) on the subdivision's own line) when a line-start successor is actually present
    # later in the same subdivision — a lone "a." is left alone.
    def normalize_bare_letters(txt):
        blocks, cur = [], []
        for l in txt.split('\n'):
            if re.match(r'^\s{0,3}\d{1,2}\.\s', l) and cur:
                blocks.append(cur); cur = [l]
            else:
                cur.append(l)
        if cur: blocks.append(cur)
        out = []
        for blk in blocks:
            starts = [(i, m.group(1)) for i, l in enumerate(blk)
                      for m in [re.match(r'^\s{0,3}([a-z])\.\s', l)] if m]
            want, taken, inline = 'a', [], False
            if starts and starts[0][1] == 'b' and blk:
                if re.search(r'(?<=[.:;]) a\.\s', blk[0]):
                    inline, want = True, 'b'
            for i, ch in starts:
                if ch != want: break
                taken.append(i); want = chr(ord(want) + 1)
            if taken or inline:
                if inline:
                    blk[0] = re.sub(r'(?<=[.:;]) a\.\s', ' (a) ', blk[0], count=1)
                for i in taken:
                    blk[i] = re.sub(r'^(\s{0,3})([a-z])\.\s', r'\1(\2) ', blk[i], count=1)
            out.extend(blk)
        return '\n'.join(out)

    ROMAN = ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi','xii']
    def normalize_bare_romans(txt):
        lines = txt.split('\n')
        starts = [(i, m.group(2)) for i, l in enumerate(lines)
                  for m in [re.match(r'^(\s*)([ivx]{1,5})\.\s', l)] if m]
        taken, want = [], 0
        for i, r in starts:
            if want < len(ROMAN) and r == ROMAN[want]:
                taken.append(i); want += 1
            elif r == 'i':
                taken.append(i); want = 1          # a new run restarts at i
            else:
                want = 0
        # A LONE "i." IS NOT A LIST. Promote only runs of two or more.
        runs, cur = [], []
        for i in taken:
            if cur and re.match(r'^\s*i\.\s', lines[i]): runs.append(cur); cur = []
            cur.append(i)
        if cur: runs.append(cur)
        for run in runs:
            if len(run) < 2: continue
            for i in run:
                lines[i] = re.sub(r'^(\s*)([ivx]{1,5})\.\s', r'\1(\2) ', lines[i], count=1)
        return '\n'.join(lines)

    text = normalize_bare_letters(text)
    text = normalize_bare_romans(text)

    lines = [l.rstrip() for l in text.split('\n')]
    SUBDIV = re.compile(r'^\s{0,3}(\d{1,2})\.\s')
    PARA = re.compile(r'^\s*\(([A-Za-z0-9ivxlIVXL]{1,5})\)')
    chunks, cur = [], []
    # The designator that opened the PREVIOUS chunk, for the successor test below.
    prev_desig = None
    for l in lines:
        # A DESIGNATOR MID-SENTENCE IS A CROSS-REFERENCE, NOT A PARAGRAPH. The source is hard-
        # wrapped, so "...pursuant to paragraph / (b) of subdivision eight" puts a "(b)" at
        # column 0 that opens nothing. A real paragraph only ever follows text that has ENDED:
        # a sentence stop, a colon introducing an enumeration, or a dash. If what we have so far
        # trails off mid-clause, this line continues it.
        opens = PARA.match(l) or SUBDIV.match(l)
        if opens and cur:
            sofar = ' '.join(cur).rstrip()
            # AN ENUMERATION JOINED BY "or"/"and" HAS ALSO ENDED. The terminal-punctuation test
            # is too strong for the commonest statutory list form there is: "(a) ...; or (b) ...".
            # GBL § 1501(1) ends its paragraph (a) with "covered minor; or", which terminates on
            # "r", so (b) was absorbed and TWO ALTERNATIVE DEFENCES became one leaf — the age-
            # determination route and the parental-consent route, welded together. A conjunction
            # sitting after a semicolon or comma is a list joint, not a wrapped clause; the
            # hard-wrapped cross-reference this rule exists to catch ("pursuant to paragraph /
            # (b) of subdivision eight") never has one.
            joint = re.search(r'[;,]\s+(?:or|and)$', sofar, re.I)
            # A COMMA ENDS A LIST ITEM IN SOME DRAFTING HOUSES AND ENDS NOTHING IN OTHERS. Every
            # rule above was tuned on NY consolidated law, which delimits enumerations with
            # semicolons. The NYC rules delimit them with COMMAS: 6 RCNY § 5-301(b)(3)(i) ends
            # "...vs female candidates)," so (ii) was absorbed into (i), while (iii) survived
            # only because (ii) happened to end "...candidates), and" and tripped the joint rule.
            # The result was a list of three that segmented as (i) and (iii) — not a collision,
            # and so invisible to gate 23.
            #
            # The reliable signal is not the punctuation, it is the SEQUENCE. A designator that
            # is the immediate successor of the one that opened the previous chunk is a sibling
            # in an open enumeration, whatever the preceding line trails off with. A stray
            # cross-reference is not: § 5-301(d) wraps onto a line beginning "(4) of subdivision
            # (c)", and (4) does not follow (d) in any sequence, so it stays absorbed — which is
            # the case the terminal-punctuation rule exists for and still handles.
            succ = False
            if prev_desig and (PARA.match(l) or SUBDIV.match(l)):
                m_in = PARA.match(l)
                desig_in = m_in.group(1) if m_in else SUBDIV.match(l).group(1)
                for _k, sq in ORDERS:
                    if prev_desig in sq and desig_in in sq:
                        if sq.index(desig_in) == sq.index(prev_desig) + 1:
                            succ = True
                    if succ: break
            if sofar and sofar[-1] not in '.:;\u2014\u2013-' and not joint and not succ:
                opens = False
        if opens:
            _m = PARA.match(l) or SUBDIV.match(l)
            prev_desig = _m.group(1)
            if cur: chunks.append(' '.join(cur))
            cur = [l.strip()]
        else:
            cur.append(l.strip())
    if cur: chunks.append(' '.join(cur))

    # A SECTION WITH NO SUBDIVISIONS IS STILL A PROVISION. GBL § 350 is one sentence and carries
    # no designator anywhere: "False advertising in the conduct of any business ... is hereby
    # declared unlawful." The designator walker found nothing and the zero-leaf guard refused it,
    # which was the guard working — but the right answer is one leaf at the section root, not a
    # failure. paragraph_path [] is unique by construction and cites the section itself.
    if not any(re.match(r'^\s*(\(|\d{1,2}\.\s)', c) for c in chunks):
        whole = n(' '.join(chunks)).strip()
        if whole:
            return [dict(path=[], anchor=loc, section=loc, confidence='high',
                         heading=section_heading, text=whole, context=[],
                         section_heading=section_heading, nb_note=nb_note,
                         active_date=r.get('activeDate'))]

    out, stack = [], []
    for raw in chunks:
        raw = n(raw)
        # A bare "N." subdivision opens the OUTERMOST level and clears everything below it;
        # a parenthesised run nests underneath in the usual way.
        sub = re.match(r'^(\d{1,2})\.\s+', raw)
        if sub:
            # 'subdiv' is deliberately NOT one of the ORDERS kinds. NY subdivisions are bare
            # numbers and its paragraphs can also be numbered, so sharing the numeric kind let
            # (2) inside subdivision 1(b) pop the stack and REPLACE subdivision 2 — the list of
            # private-information data elements overwrote the notification duty itself.
            stack = [('subdiv', sub.group(1), '')]
            rest_sub = raw[sub.end():].strip()
            m2 = re.match(r'^((?:\([A-Za-z0-9ivxlIVXL]{1,5}\)\s*)+)', rest_sub)
            if m2:
                for des in re.findall(r'\(([A-Za-z0-9ivxlIVXL]{1,5})\)', m2.group(1)):
                    kinds = [k for k, sq in ORDERS if des in sq]
                    stack.append((kinds[0] if kinds else 'a', des, ''))
                rest_sub = rest_sub[m2.end():].strip()
            stack[-1] = (stack[-1][0], stack[-1][1], rest_sub)
            path = [x[1] for x in stack]
            ctx = [dict(position='precedes', text=x[2], path=[y[1] for y in stack[:i+1]], anchor=loc)
                   for i, x in enumerate(stack[:-1]) if x[2].strip()]
            out.append(dict(path=path, anchor=loc, section=loc, confidence='high',
                            heading=section_heading, text=rest_sub, context=ctx,
                            section_heading=section_heading, nb_note=nb_note,
                            active_date=r.get('activeDate')))
            continue
        m = re.match(r'^((?:\([A-Za-z0-9ivxlIVXL]{1,5}\)\s*)+)', raw)
        if not m:
            if stack: stack[-1] = (stack[-1][0], stack[-1][1], stack[-1][2] + ' ' + raw)
            continue
        desigs = re.findall(r'\(([A-Za-z0-9ivxlIVXL]{1,5})\)', m.group(1))
        rest = raw[m.end():].strip()
        # A DESIGNATOR CANNOT FOLLOW ITSELF. The source is hard-wrapped plain text, so a
        # mid-sentence cross-reference can land at column 0 and look exactly like a new
        # paragraph: "...pursuant to paragraph / (b) of subdivision eight of this section:".
        # That produced a second ["2","b"] carrying half a sentence. If the only designator
        # repeats the one already open at its level, this is a continuation of the wrapped
        # line, not a sibling.
        if len(desigs) == 1 and stack and stack[-1][1] == desigs[0]:
            stack[-1] = (stack[-1][0], stack[-1][1], stack[-1][2] + ' ' + raw)
            continue
        conf = 'high'
        for di, desig in enumerate(desigs):
            body = rest if di == len(desigs) - 1 else ''
            cands = [k for k, sq in ORDERS if desig in sq]
            kind = None
            if len(cands) == 1:
                kind = cands[0]
            else:
                for lvl in range(len(stack) - 1, -1, -1):
                    k, dd, _ = stack[lvl]
                    if k not in SEQ: continue      # the subdivision root is not a designator run
                    sq = SEQ[k]
                    if dd in sq and sq.index(dd) + 1 < len(sq) and sq[sq.index(dd) + 1] == desig:
                        kind = k; break
                if kind is None:
                    firsts = [k for k in cands if SEQ[k][0] == desig]
                    kind = firsts[-1] if firsts else cands[0]
                    if not firsts: conf = 'low'
            if any(x[0] == kind for x in stack):
                while stack and stack[-1][0] != kind: stack.pop()
                stack[-1] = (kind, desig, body)
            else:
                stack.append((kind, desig, body))
        path = [x[1] for x in stack]
        ctx = [dict(position='precedes', text=x[2], path=[y[1] for y in stack[:i+1]], anchor=loc)
               for i, x in enumerate(stack[:-1]) if x[2].strip()]
        out.append(dict(path=path, anchor=loc, section=loc, confidence=conf,
                        heading=r.get('title') or '', text=rest, context=ctx,
                        section_heading=section_heading, nb_note=nb_note,
                        active_date=r.get('activeDate')))
    return out


def walk_pdf(text, section_re, label_fmt='{}'):
    """Sections out of a rendered legal PDF, then the shared designator walker over each.

    NOT a fifth walker. The only thing this adds over walk_designated_text is finding where each
    section starts and stripping the page furniture that pdftotext interleaves — and the furniture
    matters more than it sounds: a bare page number lands between two list items, and the margin
    RESETS at the page break, which is why nothing in the designator walker may key on indentation.
    """
    # Page numbers are unique per page, so a repeated-line check does not find them. They are bare
    # digits alone on a line; the DCWP rule has ten and one of them falls between (ii) and (iii).
    text = re.sub(r'^\s*\d{1,3}\s*$', '', text, flags=re.M)
    parts = re.split(section_re, text, flags=re.M)
    out = []
    for i in range(1, len(parts), 2):
        loc, body = parts[i], parts[i + 1]
        # Drop the section's own run-in heading: "5-301 Bias Audit." — up to the first period that
        # is followed by a capital or a designator. Anything longer is enacted text, per the
        # first-parenthetical-is-not-always-the-first-paragraph assumption.
        head = re.match(r'^[^.\n]{0,80}\.\s+', body)
        heading = (loc + ' ' + head.group(0).strip()) if head else loc
        if head:
            body = body[head.end():]
        leaves = walk_designated_text(body, loc, section_heading=heading, heading_title=heading)
        for lf in leaves:
            lf['section'] = loc
            lf['anchor'] = loc
        # A TERM-LED SECTION HAS NO ENACTED HIERARCHY AND MUST NOT BE GIVEN ONE. 6 RCNY § 5-300
        # defines ten terms by NAME — "Automated Employment Decision Tool.", "Bias Audit." — with
        # no (a)/(1) designators anywhere. Walked as a hierarchy it produces a tree hung off
        # whatever designator appears first, and the two independent roman runs nested inside two
        # different definitions both land at ["i"],["ii"],["iii"] — one path, two provisions.
        # Gate 23 would refuse any atom citing them, but by then the segmentation is committed and
        # reads as though the section were designated. Refuse here instead: such a section belongs
        # in DEFINITION records keyed by term_as_defined, carrying no paragraph_path at all.
        seen = {}
        for lf in leaves:
            k = tuple(lf['path'])
            seen.setdefault(k, []).append(lf)
        clash = {k: v for k, v in seen.items() if len(v) > 1}
        if clash:
            k, v = next(iter(clash.items()))
            raise SystemExit(
                f"REFUSED: § {loc} segmented to {len(clash)} COLLIDING path(s) — "
                f"{'.'.join(k) or '(root)'} resolves to {len(v)} different provisions. This is the "
                f"signature of a TERM-LED section walked as a designator hierarchy. If its "
                f"provisions are named rather than numbered, exclude it from --sections and model "
                f"it as definition records instead.\n"
                f"  first:  {v[0]['text'][:80]!r}\n  second: {v[1]['text'][:80]!r}")
        out.extend(leaves)
    return out

CLASSIFY = [
    (r'\bmeans\b|\bhas the (same )?meaning\b|\bis defined\b', 'DEFINITION'),
    (r'\bshall not\b|\bmay not\b|\bis prohibited\b|\bno .{0,40}\bmay\b', 'PROHIBITION'),
    (r'\bshall\b|\bmust\b|\bis required to\b', 'OBLIGATION'),
    (r'\bexcept\b|\bdoes not apply\b|\bis exempt\b|\bunless\b', 'EXEMPTION'),
    (r'\bapplies to\b|\bthis (part|section) applies\b|\bscope\b', 'SCOPE/APPLICABILITY'),
    (r'\bmay (obtain|request|require)\b|\bright to\b|\bentitled to\b', 'RIGHT'),
    (r'\bcivil penalt|\benforce|\bliable\b', 'ENFORCEMENT'),
    (r'\bpreempt|\bsupersede|\bnothing in this .{0,30}\bshall be construed\b', 'PREEMPTION'),
    (r'\beffective (date|on)\b', 'EFFECTIVE-DATE'),
    (r'\bmay (issue|prescribe|promulgate)\b.{0,40}\bregulations\b', 'RULEMAKING'),
]
def classify(t):
    for pat, lab in CLASSIFY:
        if re.search(pat, t, re.I):
            return lab
    return 'HOUSEKEEPING'


if __name__ == '__main__':
    A = sys.argv
    opt = lambda f, d=None: A[A.index(f)+1] if f in A else d
    if '--openleg' in A:
        i = A.index('--openleg'); law, locid = A[i+1], A[i+2]
        cache = ROOT / '.ny-cache' / f'{law}-{locid}.json'
        if not cache.exists():
            raise SystemExit(f"{cache} not in cache. Acquisition goes through the harness:\n"
                             f"    NYSENATE_API_KEY=... tools/fetch-ny.sh {law} {locid}\n")
        raw = cache.read_bytes(); url = f"https://legislation.nysenate.gov/api/3/laws/{law}/{locid}"
        fmt, pos = 'openleg_json', None
        leaves = walk_openleg(raw); label = f"NY {law} {locid}"
    elif '--pdf' in A:
        # OWNER-SUPPLIED PDF. No fetch URL exists, so --url records where the bytes came from and
        # meta/sources.yaml carries it as a file:// path, the same posture as the NYC XML export.
        i = A.index('--pdf'); src = pathlib.Path(A[i + 1])
        raw = src.read_bytes()
        url = opt('--url', f'file://{src.resolve()}')
        fmt, pos = opt('--format', 'pdf_single_col'), None
        # render-text.py WRITES the rendering and prints only a provenance summary, so read the
        # file it produced rather than its stdout. Going through it rather than calling pdftotext
        # here is the point: gate 3 checks spans against that exact rendering, so the walker and
        # the gate must see byte-identical text.
        import tempfile
        _tmp = pathlib.Path(tempfile.mkdtemp()) / 'render.txt'
        subprocess.run(['python3', str(ROOT / 'tools/render-text.py'), str(src),
                        '--out', str(_tmp)], check=True, capture_output=True)
        body = _tmp.read_text()
        secs = opt('--sections')
        if not secs:
            raise SystemExit('--pdf needs --sections <regex with ONE capturing group for the '
                             'section id>, e.g. --sections "^§ (5-30[1-4])"')
        start = opt('--from')
        if start and start in body: body = body[body.index(start):]
        leaves = walk_pdf(body, secs)
        label = opt('--label', src.stem)
        # THE VACUITY GUARD MEASURES AGAINST TEXT, AND A PDF'S BYTES ARE NOT TEXT.
        # 462,675 bytes of compressed PDF render to 31,643 characters, so comparing
        # recovered text to raw byte length reported 2% and refused a complete walk.
        # For every other format raw bytes are within a small factor of the text, which
        # is why the guard was written that way and why the assumption was invisible.
        measure_against = len(body)
    elif '--ecfr' in A:
        i = A.index('--ecfr'); title, part = A[i+1], A[i+2]
        date = opt('--date', '2026-08-17')
        raw, url = fetch_ecfr(title, part, date); fmt, pos = 'ecfr_xml', None
        leaves = walk_ecfr(raw); label = f"{title} CFR {part}"
    else:
        i = A.index('--uslm'); title, section = A[i+1], A[i+2]
        raw, url, pos = fetch_uslm(title, section); fmt = 'uslm_xml'
        leaves = walk_uslm(raw); label = f"{title} U.S.C. § {section}"

    outdir = pathlib.Path(opt('--out', 'spike/extract'))
    (outdir / 'raw').mkdir(parents=True, exist_ok=True)
    stem = re.sub(r'[^a-z0-9]+', '-', label.lower()).strip('-')
    ext = {'openleg_json': '.json', 'pdf_single_col': '.pdf', 'pdf_multi_col': '.pdf'}.get(fmt, '.xml')
    rawp = outdir / 'raw' / f'{stem}{ext}'
    rawp.write_bytes(raw)
    subprocess.run(['python3', str(ROOT/'tools/render-text.py'), str(rawp),
                    '--out', str(rawp.with_suffix('.txt'))], check=True, capture_output=True)

    print(f"# {label}   ({fmt}, {len(leaves)} leaves)"
          + (f"   positive_law={pos}" if pos is not None else ""))
    print(f"# raw {rawp}  sha256 {sha(raw)[:16]}…\n")
    print(f"| {'path':22} | {'class':20} | gist |")
    print(f"|{'-'*24}|{'-'*22}|------|")
    for lf in leaves:
        print(f"| {'.'.join(lf['path'])[:22]:22} | {classify(lf['text'])[:20]:20} | {lf['text'][:78]} |")

    # A WALKER THAT FINDS NOTHING MUST FAIL LOUDLY. 15 U.S.C. 1681g produced a valid, hashed,
    # dual-parse-agreeing segmentation containing ZERO leaves, and nothing said a word. An empty
    # segmentation is indistinguishable from a section with no provisions, which is the silent-
    # absence failure this repo exists to refuse.
    # PROPORTION, not zero. 18 U.S.C. § 2511 produced ONE leaf from 12,946 characters and the
    # zero-check waved it through, because one is not zero. A walk that recovers a tiny share of
    # its source is the same silent loss wearing a different number.
    recovered = sum(len(l.get('text', '')) for l in leaves)
    measure_against = locals().get('measure_against', len(raw))
    if leaves and measure_against > 4000 and recovered < 0.05 * measure_against:
        sys.exit(f"REFUSED: {label} segmented to {len(leaves)} leaf/leaves recovering only "
                 f"{recovered} chars from {measure_against} characters of source "
                 f"({100*recovered//measure_against}%). "
                 f"A walk that loses most of its source is the zero-leaf failure with a "
                 f"non-zero count. Check for an unhandled structural element.")
    if not leaves:
        sys.exit(f"REFUSED: {label} segmented to ZERO leaves. The source has "
                 f"{len(raw)} bytes, so this is a walker failure, not an empty section. "
                 f"Do not commit an empty segmentation — it reads as 'no provisions here'.")


    # LOG TO THE SOURCES LEDGER. BRIEF.md Phase 0 requires every fetch to be recorded in
    # meta/sources.yaml, and that stopped happening the moment extract.py replaced
    # fetch-source.mjs as the acquisition path: 13 entries against 78 stored raw files. Nothing
    # failed, because gate 2 hashes each atom's OWN raw_file — the ledger is a separate artifact
    # that quietly went stale. Found by a a verification pass, outside its own scope, which is the only
    # reason it was found at all.
    try:
        import yaml as _y
        led = ROOT / 'meta' / 'sources.yaml'
        doc = _y.safe_load(led.read_text()) if led.exists() else {}
        if not isinstance(doc, dict): doc = {'sources': doc}
        rows = doc.setdefault('sources', [])
        key = str(rawp.relative_to(ROOT)) if str(rawp).startswith(str(ROOT)) else str(rawp)
        rows = [r for r in rows if r.get('raw_file') != key]
        rows.append({'raw_file': key, 'url': url, 'fetched': __import__('datetime').date.today().isoformat(),
                     'sha256': hashlib.sha256(rawp.read_bytes()).hexdigest(),
                     'format': fmt, 'label': label})
        doc['sources'] = sorted(rows, key=lambda r: r.get('raw_file', ''))
        led.write_text(_y.safe_dump(doc, sort_keys=False, allow_unicode=True, width=100))
    except Exception as e:
        sys.exit(f"REFUSED: could not log to meta/sources.yaml ({e}). An unlogged fetch is an "
                 f"untraceable source.")

    json.dump(dict(label=label, url=url, format=fmt, positive_law=pos,
                   raw_file=str(rawp), raw_sha256=sha(raw), leaves=leaves),
              open(outdir / f'{stem}.seg.json', 'w'), indent=1)
    print(f"\n# segmentation -> {outdir}/{stem}.seg.json")
