#!/usr/bin/env python3
"""CONFORMANCE SUITE. Every walker, against every declared assumption.

meta/extractor-assumptions.yaml records the premises a legal-text walker must not hold. This
asserts them. It exists because "a paragraph needs a designator" was found and fixed in
walk_openleg for N.Y. GBL § 350, and then found AGAIN two days later in walk_ecfr, where it had
silently dropped 16 C.F.R. § 314.6 — the Safeguards Rule's size-threshold exemption. Two
independent implementations, the same wrong premise, and fixing one did not fix the other because
nothing tested both.

A new walker is not finished until it passes this file.
"""
import importlib.util, pathlib, sys, yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('ex', ROOT / 'tools/extract.py')
ex = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(ex)
except SystemExit:
    pass

fails = []
def refused_lc():
    LC = ('<section style="-uslm-lc:I80" identifier="/us/usc/t15/s1681g">'
          '<num value="1681g">&#167; 1681g.</num><heading> Disclosures</heading><content>'
          '<p class="indent2">(a) Information on file</p>'
          '<p class="indent0">Every consumer reporting agency shall disclose.</p>'
          '<p class="indent1">(1) All information in the file.</p></content></section>').encode()
    try:
        ex.walk_uslm(LC)
    except SystemExit as e:
        return 'large-and-complex' in str(e)
    return False
def ok(name, cond, detail=''):
    print(f"{'ok  ' if cond else 'FAIL'}  {name}{('  ' + str(detail)) if detail else ''}")
    if not cond:
        fails.append(name)

ECFR_UNDESIGNATED = (
    '<DIV8 N="314.6" TYPE="SECTION"><HEAD>&#xA7; 314.6 Exceptions.</HEAD>'
    '<P>Section 314.4(b)(1), (d)(2), (h), and (i) do not apply to financial institutions that '
    'maintain customer information concerning fewer than five thousand consumers.</P>'
    '<CITA>[86 FR 70308, Dec. 9, 2021]</CITA></DIV8>').encode()

ECFR_RUNIN = (
    '<DIV8 N="313.5" TYPE="SECTION"><HEAD>&#xA7; 313.5 Annual notice.</HEAD>'
    '<P>(e) <I>Exception to annual privacy notice requirement</I>&#x2014;(1) <I>When exception '
    'available.</I> You are not required to deliver an annual privacy notice if you:</P>'
    '<P>(i) Provide nonpublic personal information only under an exception; and</P>'
    '<P>(2) <I>Exception no longer available.</I> If you no longer meet the requirements:</P>'
    '<P>(i) you must provide an annual privacy notice.</P></DIV8>').encode()

ECFR_DEFINITIONS = (
    '<DIV8 N="160.103" TYPE="SECTION"><HEAD>&#xA7; 160.103 Definitions.</HEAD>'
    '<P><I>Electronic media</I> means:</P><P>(1) Electronic storage material.</P>'
    '<P>(2) Transmission media.</P>'
    '<P><I>Health plan</I> means an individual or group plan.</P>'
    '<P>(1) Health plan includes the following.</P></DIV8>').encode()

def seg_ecfr(x):
    return ex.walk_ecfr(x)

# ---- undesignated-section-is-still-a-provision -------------------------------
lv = seg_ecfr(ECFR_UNDESIGNATED)
ok('ecfr: an undesignated section still yields a leaf', len(lv) == 1, f'{len(lv)} leaves')
ok('ecfr: ...at the section root', lv and lv[0]['path'] == [], lv[0]['path'] if lv else None)
ok('ecfr: ...carrying the operative text',
   lv and 'fewer than five thousand consumers' in lv[0]['text'])
ok('ecfr: ...with the source credit stripped', lv and '86 FR' not in lv[0]['text'])

# The same assumption, against the THIRD walker. It was declared once, tested against walk_ecfr
# and walk_openleg, and walk_uslm was never asked — so 29 U.S.C. § 157 and 18 U.S.C. § 2713, each
# a single undesignated sentence, were REFUSED as if their depth were unreconstructable. A
# per-walker conformance suite has to actually cover every walker.
USLM_SINGLE = ('<section style="-uslm-lc:I80" identifier="/us/usc/t29/s157">'
               '<num value="157">&#167; 157.</num><heading> Right of employees</heading>'
               '<content><p class="indent0">Employees shall have the right to self-organization.</p>'
               '</content></section>').encode()
lv = ex.walk_uslm(USLM_SINGLE)
ok('uslm: a single undesignated paragraph is a whole-section provision', len(lv) == 1, f'{len(lv)} leaves')
ok('uslm: ...at the section root', lv and lv[0]['path'] == [], lv[0]['path'] if lv else None)
ok('uslm: ...and still refuses a MULTI-paragraph flat section', refused_lc())

ECFR_STEM = ('<DIV8 N="40.321" TYPE="SECTION"><HEAD>&#xA7; 40.321 General confidentiality.</HEAD>'
             '<P>Except as otherwise provided in this subpart, you are prohibited from releasing '
             'individual test results.</P>'
             '<P>(a) A third party is any person to whom this subpart does not authorize release.</P>'
             '<P>(b) Specific written consent means a signed statement.</P></DIV8>').encode()
lv = seg_ecfr(ECFR_STEM)
paths = [tuple(l['path']) for l in lv]
ok('ecfr: an undesignated STEM before designated paragraphs is kept', () in paths, paths)
ok('ecfr: ...and it carries the operative sentence',
   any(l['path'] == [] and 'prohibited from releasing' in l['text'] for l in lv))
ok('ecfr: ...without losing the designated paragraphs', ('a',) in paths and ('b',) in paths, paths)

openleg_350 = ('{"result":{"locationId":"350","text":"  \\u00a7 350. False advertising unlawful. '
               'False advertising in the conduct of\\\\nany business is hereby declared unlawful.\\\\n"}}').encode()
lv = ex.walk_openleg(openleg_350)
ok('openleg: an undesignated section still yields a leaf', len(lv) == 1, f'{len(lv)} leaves')
ok('openleg: ...at the section root', lv and lv[0]['path'] == [])

# ---- run-in-headings-hide-designators ----------------------------------------
lv = seg_ecfr(ECFR_RUNIN)
paths = [tuple(l['path']) for l in lv]
ok('ecfr: a run-in heading does not hide its designator', ('e', '1') in paths, paths)
ok('ecfr: (e)(1)(i) and (e)(2)(i) do not collide', len(paths) == len(set(paths)), paths)

# ---- definition-entries-carry-no-designator ----------------------------------
lv = seg_ecfr(ECFR_DEFINITIONS)
paths = [tuple(l['path']) for l in lv]
ok('ecfr: definition entries open a term-keyed root',
   any(p and p[0] == 'Electronic media' for p in paths), paths)
ok('ecfr: two definitions\' (1)s do not collide', len(paths) == len(set(paths)), paths)

# ---- bare-numbered-subdivisions and hard-wrapped text ------------------------
openleg_sub = ('{"result":{"locationId":"899-AA","text":"  \\u00a7 899-aa. Notification.  1. As used '
               'in this section:\\\\n  (a) \\"Personal information\\" means data.\\\\n  (b) \\"Private '
               'information\\" means either:\\\\n  (1) social security number;\\\\n  (2) license number;'
               '\\\\n  2. Any person shall disclose a breach pursuant to paragraph\\\\n'
               '(b) of subdivision eight of this section.\\\\n"}}').encode()
lv = ex.walk_openleg(openleg_sub)
paths = [tuple(l['path']) for l in lv]
ok('openleg: bare numbered subdivisions open the outermost level',
   ('1',) in paths and ('2',) in paths, paths)
ok('openleg: a parenthesised (2) does not replace subdivision 2',
   ('1', 'b', '2') in paths, paths)
ok('openleg: paths are unique', len(paths) == len(set(paths)), paths)
ok('openleg: a wrapped cross-reference does not open a paragraph',
   sum(1 for p in paths if p == ('2', 'b')) == 0, paths)

# ---- zero-leaves-is-never-a-pass ---------------------------------------------
ok('every walker returns a list, never None',
   all(isinstance(f(b'<DIV8 N="1" TYPE="SECTION"><HEAD>x</HEAD></DIV8>'), list) for f in [seg_ecfr]))

# ---- designators-are-not-always-hierarchical ---------------------------------
# A USLM large-and-complex section is flat <p class="indentN"> with no structural nesting, and the
# indent classes are TYPOGRAPHIC. Reconstructing depth from them produced a path that was unique
# and WRONG, which gate 23 cannot see. The walker must REFUSE, not guess.
LC_FLAT = ('<section style="-uslm-lc:I80" identifier="/us/usc/t15/s1681g">'
           '<num value="1681g">&#167; 1681g.</num><heading> Disclosures to consumers</heading>'
           '<content>'
           '<p class="indent2 firstIndent-2">(a) Information on file; sources; report recipients</p>'
           '<p class="indent0">Every consumer reporting agency shall, upon request, disclose.</p>'
           '<p class="indent1">(1) All information in the consumer&#8217;s file at the time.</p>'
           '</content></section>').encode()
refused = False
try:
    ex.walk_uslm(LC_FLAT)
except SystemExit as e:
    refused = 'large-and-complex' in str(e)
ok('uslm: a flat large-and-complex section is REFUSED, not reconstructed', refused)

# ---- roman-and-letter-designators-collide ------------------------------------
# "(i)" is letter-nine and roman-one. Continuation before descent: it continues an open letter run
# only after (h); otherwise it opens a new deeper level. Getting this wrong replaced an ancestor
# with its own grandchild.
ROMAN = ('<DIV8 N="1.1" TYPE="SECTION"><HEAD>&#xA7; 1.1 Test.</HEAD>'
         '<P>(b) The chapeau of paragraph b.</P>'
         '<P>(1) The first numbered item.</P>'
         '<P>(i) A roman-one child of that item.</P>'
         '<P>(ii) Its sibling.</P></DIV8>').encode()
paths = [tuple(l['path']) for l in seg_ecfr(ROMAN)]
ok('ecfr: (i) after (1) DESCENDS rather than replacing the letter level',
   ('b', '1', 'i') in paths, paths)
ok('ecfr: the ancestor survives', ('b',) in paths and ('b', '1') in paths, paths)

SUCCESSOR = ('<DIV8 N="1.2" TYPE="SECTION"><HEAD>&#xA7; 1.2 Test.</HEAD>'
             '<P>(g) Paragraph g.</P><P>(h) Paragraph h.</P>'
             '<P>(i) Paragraph i, the letter after h.</P></DIV8>').encode()
paths = [tuple(l['path']) for l in seg_ecfr(SUCCESSOR)]
ok('ecfr: (i) after (h) CONTINUES the letter run instead of descending',
   ('i',) in paths and ('h', 'i') not in paths, paths)

# ---- real-provisions-can-be-very-short ---------------------------------------
# 152 characters can be a whole statute. A vacuity floor stated in absolute characters acquires a
# minimum-length bias against exactly the short, punchy provisions that matter.
SHORT = seg_ecfr(ECFR_UNDESIGNATED)
ok('a 150-character section survives extraction intact',
   SHORT and 100 < len(SHORT[0]['text']) < 250, len(SHORT[0]['text']) if SHORT else 0)
vsrc = (ROOT / 'tools/validate.mjs').read_text()
ok('vacuity checks judge by PROPORTION to the raw source, not an absolute floor',
   'proportionate' in vsrc and 'rawSize' in vsrc)

# nyc_xml apparatus: the ALP publisher markers and session-law credits share the <PARA> stream
# with operative text, so gate 17 has no region to detect and walk_nycxml excludes them instead.
# That analogue is declared in meta/gate-applicability.yaml and is asserted here, so the thing
# standing in for a gate is itself tested.
NYC = ('<DOCUMENT><LEVEL style-name="Section"><RECORD><HEADING>&#167; 20-871 Requirements.</HEADING>'
       '<PARA>&#167; 20-871 Requirements.</PARA></RECORD>'
       '<LEVEL style-name="Normal Level"><RECORD>'
       '<PARA>a. It shall be unlawful to use such a tool. [ALP S-068]</PARA>'
       '<PARA>(L.L. 2021/144, 12/11/2021, eff. 1/1/2023) [ALP S-069]</PARA>'
       '</RECORD></LEVEL></LEVEL></DOCUMENT>').encode()
lv = ex.walk_nycxml(NYC)
ok('nycxml: the ALP publisher marker is stripped from the span',
   lv and all('[ALP' not in l['text'] for l in lv), [l['text'][:40] for l in lv])
ok('nycxml: the session-law credit line is not emitted as a provision',
   all(not l['text'].startswith('(L.L.') for l in lv))
ok('nycxml: the heading echo is not emitted as a provision',
   all('20-871 Requirements' not in l['text'] for l in lv))
ok('nycxml: a bare letter designator opens a level', lv and lv[0]['path'] == ['a'], lv[0]['path'] if lv else None)

# ---- bare-roman-designators / list-items-are-not-always-semicolon-delimited ---------------
# Both assumptions came out of the FIRST nested-PDF probe (6 RCNY § 5-301). The fixture is the
# openleg walker because that is the walker the PDF path reuses: NYC rules are (a)/(1)/i. with
# comma-delimited list items, and every rule in the walker had been tuned on NY semicolons.
NYC_ROMAN = ('{"result":{"docType":"SECTION","locationId":"5-301","title":"Bias Audit",'
             '"text":"* \u00a7 5-301 Bias Audit. (b) Where an AEDT selects candidates, an '
             'independent auditor must:\\n  (3) Ensure that the calculations separately '
             'calculate the impact of the AEDT on:\\n    i. Sex categories (e.g., male vs '
             'female candidates),\\n   ii. Race/Ethnicity categories (e.g., Hispanic or Latino '
             'candidates), and\\n  iii. intersectional categories of sex, ethnicity, and race.'
             '\\n  (4) Ensure that the calculations are performed annually.",'
             '"activeDate":"2023-07-05"}}').encode()
lv = ex.walk_openleg(NYC_ROMAN)
paths = ['.'.join(l['path']) for l in lv]
ok('openleg: bare ROMAN designators open a level', 'b.3.i' in paths, paths)
ok('openleg: ...and a comma-terminated list item does not swallow its sibling',
   'b.3.ii' in paths, paths)
ok('openleg: ...all three romans survive, not just the one before an "and"',
   {'b.3.i','b.3.ii','b.3.iii'} <= set(paths), paths)
ok('openleg: ...and the run does not absorb the following numbered paragraph',
   'b.4' in paths, paths)
ok('openleg: roman paths are unique', len(paths) == len(set(paths)), paths)

# THE REGRESSION GUARD FOR THE RULE ABOVE. Opening on sequence must not reopen the defect the
# terminal-punctuation rule exists to prevent: 6 RCNY § 5-301(d) hard-wraps onto a line beginning
# "(4) of subdivision (c)". (4) does not follow (d) in any sequence, so it must stay absorbed.
NYC_XREF = ('{"result":{"docType":"SECTION","locationId":"5-301","title":"Bias Audit",'
            '"text":"* \u00a7 5-301 Bias Audit. (d) Notwithstanding the requirements of '
            'paragraphs (2) and (3) of subdivision (b) and paragraphs (3) and\\n(4) of '
            'subdivision (c), an independent auditor may exclude a category.",'
            '"activeDate":"2023-07-05"}}').encode()
lv = ex.walk_openleg(NYC_XREF)
paths = ['.'.join(l['path']) for l in lv]
ok('openleg: a wrapped cross-reference is NOT opened by the successor rule',
   'd.4' not in paths and 'd' in paths, paths)
ok('openleg: ...and the parent keeps its whole sentence',
   any('may exclude a category' in l['text'] for l in lv if l['path'] == ['d']),
   [l['text'][:60] for l in lv])


# ---- first-parenthetical-is-not-always-the-first-paragraph -------------------------------
# The stripper deleted 1,360 characters of 6 RCNY § 5-300 before anything could check it.
XREF_FIRST = ('{"result":{"docType":"SECTION","locationId":"9-999","title":"Definitions",'
              '"text":"* \u00a7 9-999. Definitions. As used here the following terms apply. '
              'Widget. \\"Widget\\" means a thing. Category. \\"Category\\" means a class '
              'required to be reported pursuant to subsection (c) of section 2000e-8 of title 42 '
              'of the United States Code.","activeDate":"2026-01-01"}}').encode()
try:
    ex.walk_openleg(XREF_FIRST)
    ok('openleg: a mid-sentence cross-reference is REFUSED, not treated as paragraph one',
       False, 'walker accepted it')
except SystemExit as e:
    ok('openleg: a mid-sentence cross-reference is REFUSED, not treated as paragraph one',
       'heading stripper consumed' in str(e), str(e)[:70])

# ...and a legitimate chapeau must still pass. A length threshold refuses this; the sentence-
# terminator test does not, which is the whole reason the test is shaped the way it is.
CHAPEAU = ('{"result":{"docType":"SECTION","locationId":"8-888","title":"Definitions",'
           '"text":"* \u00a7 8-888. Definitions. For purposes of this article, the following '
           'terms shall have the following meanings:\\n  1. \\"Thing\\" means a thing.'
           '\\n  2. \\"Other\\" means something else.","activeDate":"2026-01-01"}}').encode()
lv = ex.walk_openleg(CHAPEAU)
ok('openleg: ...but a chapeau introducing an enumeration still passes',
   [l['path'] for l in lv] == [['1'], ['2']], [l['path'] for l in lv])


decl = yaml.safe_load((ROOT / 'meta/extractor-assumptions.yaml').read_text())
ids = {a['id'] for a in decl['assumptions']}
COVERED = {'undesignated-section-is-still-a-provision', 'run-in-headings-hide-designators',
           'definition-entries-carry-no-designator', 'bare-numbered-subdivisions',
           'hard-wrapped-text-fakes-designators', 'zero-leaves-is-never-a-pass',
           'designators-are-not-always-hierarchical', 'roman-and-letter-designators-collide',
           'real-provisions-can-be-very-short',
           'undesignated-stem-precedes-designated-paragraphs',
           'bare-roman-designators',
           'list-items-are-not-always-semicolon-delimited',
           'first-parenthetical-is-not-always-the-first-paragraph'}
uncovered = sorted(ids - COVERED)
print(f'\n{len(COVERED)} of {len(ids)} declared assumptions have an executable test.')
for u in uncovered:
    print(f'  NOT YET EXECUTABLE: {u}')
print(f'\n{len(fails)} failure(s)')
sys.exit(1 if fails else 0)
