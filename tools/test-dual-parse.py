#!/usr/bin/env python3
"""Regression test for the dual-parse guard (CI gate 11's XML/HTML analogue).

Freezes the two historical serializer defects found on 15 U.S.C. § 1681c(f) and proves
the guard catches BOTH directions, plus the attribute damage that text comparison cannot
see. If any of these stops failing, the guard has been weakened.
"""
import re, sys, html as htmllib, pathlib
import xml.etree.ElementTree as ET
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import importlib.util
spec = importlib.util.spec_from_file_location('dp', pathlib.Path(__file__).resolve().parent / 'dual-parse.py')
dp = importlib.util.module_from_spec(spec); spec.loader.exec_module(dp)

FX = pathlib.Path(__file__).resolve().parent.parent / 'tests/fixtures/raw/uslm-1681c-f.xml'
RAW = FX.read_text(encoding='utf-8')
canon = dp.canon

# --- the two defects, preserved exactly as they behaved ---------------------
def buggy_regex_leaks_note(text, fmt):
    """No note removal at all — the editorial note lands inside the quotation."""
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    return canon(htmllib.unescape(re.sub(r'<[^>]+>', ' ', text)))

def buggy_tree_eats_tail(text, fmt):
    """ElementTree remove() without reattaching .tail — deletes the rest of the sentence."""
    text = re.sub(r'<!--.*?-->', '', text, flags=re.S)
    root = ET.fromstring(f'<dpwrap xmlns="http://xml.house.gov/schemas/uslm/1.0">{text}</dpwrap>')
    changed = True
    while changed:
        changed = False
        for parent in root.iter():
            for kid in list(parent):
                if dp.bare(kid.tag) in dp.DROP['uslm_xml']:
                    parent.remove(kid); changed = True; break      # <-- the bug
            if changed: break
    return canon(''.join(root.itertext()))

def drop_an_attribute(text):
    return text.replace(' identifier="/us/usc/t15/s1681c/f"', '', 1)

# --- assertions -------------------------------------------------------------
fails = []
def check(name, cond, detail=''):
    print(f"{'ok  ' if cond else 'FAIL'}  {name}{('  ' + detail) if detail else ''}")
    if not cond: fails.append(name)

good_a, good_b = dp.engine_a(RAW, 'uslm_xml'), dp.engine_b(RAW, 'uslm_xml')
check('baseline: the two correct engines agree', good_a == good_b,
      f'len={len(good_a)}')
check('baseline: neither engine leaks the editorial note',
      'Soinoriginal' not in good_a and 'Soinoriginal' not in good_b)
check('baseline: neither engine loses the obligation',
      'theagencyshallindicatethatfact' in good_a and 'theagencyshallindicatethatfact' in good_b)

leak = buggy_regex_leaks_note(RAW, 'uslm_xml')
check('DEFECT 1 caught: regex leaks the editorial note into the quotation',
      leak != good_b and 'Soinoriginal' in leak)

eaten = buggy_tree_eats_tail(RAW, 'uslm_xml')
check('DEFECT 2 caught: tree-walk .tail deletion loses the obligation',
      eaten != good_a and 'theagencyshallindicatethatfact' not in eaten)

# attribute damage: invisible to text, visible to the inventory
dmg = drop_an_attribute(RAW)
t_same = dp.engine_a(dmg, 'uslm_xml') == dp.engine_b(dmg, 'uslm_xml')
inv_diff = dp.inventory(dmg, 'uslm_xml') != dp.inventory(RAW, 'uslm_xml')
check('DEFECT 3 caught: dropped attribute is invisible to text comparison', t_same,
      '(text still agrees — this is why the inventory exists)')
check('DEFECT 3 caught: dropped attribute IS visible to the identifier inventory', inv_diff)

# --- DEFECT 4: JSON \uXXXX escapes. Engine A decoded only \n and \" and left \u00a7
# undecoded, so a span would have carried the literal characters "\u00a7" where the
# statute has a section sign. The live NY API sends UTF-8 directly so it never surfaced
# there; the guard caught it on a re-serialised document.
import json as _j
FX2 = pathlib.Path(__file__).resolve().parent.parent / 'tests/fixtures/raw/ny-gbs-349.json'
if FX2.exists():
    _doc = _j.loads(FX2.read_text())
    _esc = _j.dumps(_doc, ensure_ascii=True)          # forces \u00a7 for the section sign
    _a, _b = dp.engine_a(_esc, 'openleg_json'), dp.engine_b(_esc, 'openleg_json')
    check('DEFECT 4 caught: \\uXXXX escapes decode identically in both engines', _a == _b,
          f'(a={len(_a)} b={len(_b)})')
    check('DEFECT 4: no literal u00a7 survives into the text', 'u00a7' not in _a and 'u00a7' not in _b)
    check('DEFECT 4: the section sign is present as a character', '\u00a7' in _a)

# non-vacuity: the guard must not pass by comparing two empty strings
check('NON-VACUOUS: both engines produced substantive output',
      len(good_a) > 150 and len(good_b) > 150, f'a={len(good_a)} b={len(good_b)}')

print(f"\n{len(fails)} failure(s)")
sys.exit(1 if fails else 0)
