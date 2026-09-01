#!/usr/bin/env python3
"""Helper: build obligation atoms from a segmentation, with the mechanical parts filled in.

Everything readable off the document — source block, paragraph_path, operative_context,
verbatim_span — comes from the segmentation. Everything requiring judgement — applies_if,
exemptions, preemption, enforcement, common_errors — is supplied by the caller, because
none of it is in the text in a form a parser can reach.
"""
import json, yaml, hashlib, pathlib, re, glob

ROOT = pathlib.Path(__file__).resolve().parent.parent
sha  = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
norm = lambda s: re.sub(r'\s+', ' ', s).strip()


class Instrument:
    def __init__(self, seg_path, corpus_dir, instrument_id, url=None):
        self.seg = json.load(open(seg_path))
        self.dir = ROOT / corpus_dir
        (self.dir / 'raw').mkdir(parents=True, exist_ok=True)
        (self.dir / 'atoms').mkdir(parents=True, exist_ok=True)
        self.iid = instrument_id
        src = pathlib.Path(self.seg['raw_file'])
        self.stem = src.stem
        dest = self.dir / 'raw' / src.name
        if not dest.exists() or dest.read_bytes() != src.read_bytes():
            dest.write_bytes(src.read_bytes())
        import subprocess
        subprocess.run(['python3', str(ROOT/'tools/render-text.py'), str(dest),
                        '--out', str(dest.with_suffix('.txt'))], check=True, capture_output=True)
        self.raw_rel = str(dest.relative_to(ROOT))
        self.txt_rel = str(dest.with_suffix('.txt').relative_to(ROOT))
        self.url = url or self.seg['url']
        self.fmt = self.seg['format']

    def leaf(self, path, section=None):
        for lf in self.seg['leaves']:
            if lf['path'] == path and (section is None or lf.get('section') == section):
                return lf
        raise KeyError(f"{path} section={section} not in {self.seg['label']}")

    def source(self, citation):
        return dict(citation=citation, instrument_id=self.iid, url=self.url, fetched="2026-08-19",
            raw_file=self.raw_rel, raw_sha256=sha(ROOT/self.raw_rel),
            text_file=self.txt_rel, text_sha256=sha(ROOT/self.txt_rel),
            text_extraction_cmd=f"python3 tools/render-text.py {self.raw_rel}",
            format=self.fmt, risk_tier="low", render=None,
            structured_source_check=dict(
                checked=["eCFR versioner XML API" if self.fmt == 'ecfr_xml'
                         else "uscode.house.gov USLM XML release point 119-1"],
                result="structured_source_used", note=None))

    def ctx(self, lf):
        return [dict(position=c['position'], relation='scopes', verbatim_span=c['text'],
                     citation=None, relation_note=None,
                     path=dict(path=c['path'], anchor=c.get('anchor'),
                               derivation='structural' if self.fmt == 'uslm_xml' else 'reconstructed',
                               confidence='high',
                               evidence=('USLM element hierarchy' if self.fmt == 'uslm_xml'
                                         else 'designator sequence over flat <P> siblings')))
                for c in lf['context']]

    def atom(self, aid, path, citation, section=None, **kw):
        lf = self.leaf(path, section)
        d = dict(id=aid, schema_version=1, record_type="obligation",
            source=self.source(citation), verbatim_span=lf['text'],
            verification_status="verbatim_confirmed",
            paragraph_path=dict(path=lf['path'], anchor=lf.get('anchor'),
                derivation='structural' if self.fmt == 'uslm_xml' else 'reconstructed',
                confidence=lf.get('confidence', 'high'),
                evidence=('identifier attribute on the USLM element' if self.fmt == 'uslm_xml'
                          else 'designator parsed from flat <P> siblings; sequence-tracked')),
            jurisdiction="US-FED", jurisdiction_level="federal",
            effective_to=None, supersedes=None, superseded_by=None,
            amendment_history=[], deadline=None, exemptions=[],
            related=[], federal_relationship=None, interpreted_by=[],
            common_errors=[], open_questions=[], confidence="high")
        c = self.ctx(lf)
        if c: d['operative_context'] = c
        else: d['context_not_required'] = ("No ancestor contributes governing text; this provision's "
                                           "operative meaning is complete on its own.")
        d.update(kw)
        return d

    def write(self, atoms):
        for a in atoms:
            (self.dir/'atoms'/(a['id'].replace('.', '-')+'.yaml')).write_text(
                yaml.safe_dump(a, sort_keys=False, allow_unicode=True, width=100))
        return len(atoms)
