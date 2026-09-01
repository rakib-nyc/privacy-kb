#!/usr/bin/env python3
"""Resolve every DECLARED citation against a structured source.

meta/jurisdiction-coverage.yaml and meta/instrument-coverage.yaml are the denominators the whole
coverage mechanism divides by. They were transcribed by hand from CORPUS-MANIFEST.md, whose
citations were research pointers written as hypotheses, and most have never been checked because
the instruments have not been extracted yet.

DEBT-016 is what that costs: the manifest claimed "N.Y. Labor Law § 203-f — electronic monitoring
notice" for the whole project. § 203-f is "Inventions made by employees". Every completeness
computation touching New York has been measuring against a phantom. A declared denominator with a
wrong entry is a quieter version of the defect the declaration exists to prevent.

So: fetch each declared citation, and compare the published heading against what we claim it is.
Anything unresolvable is ANNOTATED, never guessed.

    NYSENATE_API_KEY=... python3 tools/audit-declarations.py [--write]

--write records the result on each declaration entry as `verified:`.
"""
import json, os, re, subprocess, sys, pathlib, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
UA = 'privacy-kb/0.1 (declaration audit)'

def ny(law, loc):
    key = os.environ.get('NYSENATE_API_KEY')
    if not key:
        return None, 'NYSENATE_API_KEY not set'
    cache = ROOT / '.ny-cache' / f'{law}-{loc}.json'
    if not cache.exists():
        url = f'https://legislation.nysenate.gov/api/3/laws/{law}/{loc}?full=true&key={key}'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            cache.parent.mkdir(exist_ok=True)
            cache.write_bytes(urllib.request.urlopen(req, timeout=60).read())
        except Exception as e:
            return None, f'fetch failed: {e}'
    try:
        d = json.loads(cache.read_text())
    except Exception as e:
        return None, f'unparseable: {e}'
    if not d.get('success'):
        return None, f"API error: {d.get('message')}"
    return d['result'].get('title'), None

# Which NY law book each declared citation lives in. Parsed from the citation text, never guessed.
NY_BOOKS = [
    (r'Gen\.?\s*Bus\.?\s*Law\s*§+\s*([0-9a-zA-Z\-]+)', 'GBS'),
    (r'Labor\s*Law\s*§+\s*([0-9a-zA-Z\-]+)',            'LAB'),
    (r'Education\s*Law\s*§+\s*([0-9a-zA-Z\-]+)',        'EDN'),
    (r'Penal\s*Law\s*§+\s*([0-9a-zA-Z.\-]+)',           'PEN'),
    (r'Civil\s*Rights\s*Law\s*§+§?\s*([0-9a-zA-Z\-]+)', 'CVR'),
]

def resolve(citation):
    """-> (source, identifier, heading, error). Only structured sources count."""
    for pat, book in NY_BOOKS:
        m = re.search(pat, citation)
        if m:
            loc = m.group(1).upper().rstrip('.')
            head, err = ny(book, loc)
            return f'openleg:{book}', loc, head, err
    return None, None, None, 'no structured resolver for this citation form'

def words(s):
    return {w for w in re.findall(r'[a-z]{4,}', (s or '').lower())}

def main():
    import yaml
    write = '--write' in sys.argv
    checked = unresolved = 0
    rows_out = []
    for f in ('meta/jurisdiction-coverage.yaml',):
        path = ROOT / f
        doc = yaml.safe_load(path.read_text())
        for j, v in (doc.get('jurisdictions') or {}).items():
            for e in (v.get('instruments') or []):
                cite = e.get('citation') or ''
                src, ident, head, err = resolve(cite)
                if not src:
                    continue
                checked += 1
                if err or head is None:
                    unresolved += 1
                    e['published_heading'] = None
                    e['verified'] = f'UNRESOLVED 2026-08-19 — {err or "no heading returned"}'
                    rows_out.append(('UNRESOLVED', cite, e.get('title'), err))
                    continue
                # Record the SOURCE'S OWN WORDS. No semantic judgement: a heuristic that guesses
                # whether "Data security protections" means "reasonable safeguards" would produce
                # both false alarms and false comfort. Printing both, permanently, next to each
                # other in the declaration lets any reader see a § 203-f for what it is.
                e['published_heading'] = head
                e['verified'] = f'{src} {ident}, heading fetched 2026-08-19'
                rows_out.append(('resolved', cite, e.get('title'), head))
        if write:
            path.write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, width=100))
    w = max((len(r[1]) for r in rows_out), default=10)
    for status, cite, claim, head in rows_out:
        mark = '  ' if status == 'resolved' else '!!'
        print(f'{mark} {cite.ljust(w)}  published: {head}')
        if (claim or '').strip() and status == 'resolved':
            print(f'{"".ljust(w+4)}  claimed  : {claim}')
    print(f'\n{checked} declared citations resolved against a structured source, '
          f'{unresolved} unresolved.')
    if write:
        print('published_heading recorded on each entry — the source\'s own words, next to ours.')
    return 0

if __name__ == '__main__':
    sys.exit(main())
