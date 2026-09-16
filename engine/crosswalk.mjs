// A CROSSWALK THAT CARRIES ITS OWN WORDS.
//
// "Map once, comply many" is a real product category — Vanta, Drata and Secureframe all sell it.
// What none of them provides is the line back to primary source: a HIPAA control in those tools
// is a human-authored label, and you cannot click it and read the Code of Federal Regulations
// text it rests on. The mapping is an assertion, and its correctness is unauditable by the person
// relying on it.
//
// This resolves a declared link into BOTH provisions' verbatim text, each with the sha256 of the
// bytes it was cut from and the date those bytes were fetched. The reader does not have to trust
// the mapping: they can read both sides and judge it, which is the only honest form a crosswalk
// can take.
//
// THE LINK IS DECLARED. meta/crosswalk.yaml holds it, a person wrote the reason, and the `basis`
// field says whether the correspondence is read off a statute that names the other instrument
// (`statutory`), off a shared enumerated structure (`structural`), or off someone's reading
// (`analytical`). Nothing here infers a link from similar wording. Two provisions about
// encryption are not thereby equivalent, and a tool that decided they were would be performing
// the analysis this project exists to support rather than to replace.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { load, surfaceable } from './corpus.mjs';
import { requirementsFor, segmentationLeafFor } from './requirements.mjs';

const FILE = resolve(import.meta.dirname, '../meta/crosswalk.yaml');
let DECL = null;
function decl() {
  if (DECL) return DECL;
  DECL = existsSync(FILE) ? (yaml.load(readFileSync(FILE, 'utf8'))?.crosswalks ?? []) : [];
  return DECL;
}
export function declaredCrosswalks() { return decl(); }

const norm = text => String(text ?? '').replace(/\s+/g, ' ').trim();

/** One endpoint, resolved to text the reader can check. Never invents; reports failure instead. */
function endpoint(citation, corpus) {
  const wanted = norm(citation);
  // I1: a crosswalk endpoint quotes a provision, so a suppressed record cannot serve as one.
  const record = (corpus.all ?? []).find(candidate =>
    norm(candidate.source?.citation) === wanted && surfaceable(candidate));
  if (record)
    return { citation: wanted, resolved: true, via: 'record', atom_id: record.id,
             verbatim_span: norm(record.verbatim_span),
             sha256: record.source?.raw_sha256 ?? record.source?.text_sha256 ?? null,
             source_url: record.source?.url ?? null, fetched: record.source?.fetched ?? null,
             effective_from: record.effective_from ?? null };
  // A node held only in the segmentation still has text and a hash, and refusing there would
  // reject a correspondence the statute itself draws on a technicality about which leaves
  // happened to be cut into records.
  const leaf = segmentationLeafFor(wanted, corpus);
  if (leaf)
    return { citation: wanted, resolved: true, via: 'segmentation-leaf', atom_id: null,
             verbatim_span: leaf.verbatim_span, sha256: leaf.sha256,
             source_url: leaf.source_url, fetched: leaf.fetched, effective_from: null };
  return { citation: wanted, resolved: false, via: null, atom_id: null, verbatim_span: null,
           sha256: null, source_url: null, fetched: null, effective_from: null };
}

/**
 * Resolve every declared crosswalk, or those touching a given citation.
 * Total: bad input returns a shaped empty result rather than throwing.
 */
export function crosswalks(filter, corpus) {
  const kb = corpus ?? load();
  const wanted = norm(filter);
  const rows = decl()
    .filter(link => !wanted || norm(link.left) === wanted || norm(link.right) === wanted)
    .map(link => {
      const left = endpoint(link.left, kb);
      const right = endpoint(link.right, kb);
      return { id: link.id, basis: link.basis, relation: link.relation, note: norm(link.note),
               left, right, resolved: left.resolved && right.resolved };
    });
  return { count: rows.length, declared: decl().length,
           unresolved: rows.filter(row => !row.resolved).length, crosswalks: rows };
}
