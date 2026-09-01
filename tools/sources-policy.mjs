// Authoritative primary-source hosts (PROMPTS.md §2 A1).
// Law-firm alerts, study sites and vendor blogs are NEVER a source for text.
// They may be used to LOCATE a citation and must never appear in a `source` block.

export const ALLOWED = [
  // federal statutes
  { host: 'uscode.house.gov',        kind: 'statute',    note: 'US Code' },
  { host: 'www.govinfo.gov',         kind: 'statute',    note: 'GPO authenticated' },
  { host: 'govinfo.gov',             kind: 'statute',    note: 'GPO authenticated' },
  // federal regulations
  { host: 'www.ecfr.gov',            kind: 'regulation', note: 'current CFR' },
  { host: 'ecfr.gov',                kind: 'regulation', note: 'current CFR' },
  { host: 'www.federalregister.gov', kind: 'regulation', note: 'amendments + preambles' },
  // NY
  { host: 'www.nysenate.gov',        kind: 'statute',    note: 'NY consolidated laws' },
  { host: 'nysenate.gov',            kind: 'statute',    note: 'NY consolidated laws' },
  { host: 'nyassembly.gov',          kind: 'statute',    note: 'NY Assembly' },
  { host: 'assembly.state.ny.us',    kind: 'statute',    note: 'NY Assembly' },
  { host: 'govt.westlaw.com',        kind: 'regulation', note: 'NYCRR official publisher — verify per fetch' },
  // agencies (guidance + their own rule text)
  { host: 'www.ftc.gov',             kind: 'agency',     note: 'FTC' },
  { host: 'www.hhs.gov',             kind: 'agency',     note: 'HHS OCR' },
  { host: 'www.consumerfinance.gov', kind: 'agency',     note: 'CFPB' },
  { host: 'www.fcc.gov',             kind: 'agency',     note: 'FCC' },
  { host: 'www.sec.gov',             kind: 'agency',     note: 'SEC' },
  { host: 'www.dol.gov',             kind: 'agency',     note: 'DOL' },
  { host: 'www.eeoc.gov',            kind: 'agency',     note: 'EEOC' },
  { host: 'www.dfs.ny.gov',          kind: 'agency',     note: 'NYDFS' },
  { host: 'ag.ny.gov',               kind: 'agency',     note: 'NY OAG' },
  { host: 'www.nysed.gov',           kind: 'agency',     note: 'NYSED' },
  { host: 'www.justice.gov',         kind: 'agency',     note: 'DOJ' },
  // courts
  { host: 'www.supremecourt.gov',    kind: 'case_law',   note: 'SCOTUS slip opinions' },
  { host: 'www.courtlistener.com',   kind: 'case_law',   note: 'RECAP — verify against the docket PDF' },
  // international instruments — the issuing body's own publication only
  { host: 'legalinstruments.oecd.org', kind: 'international', note: 'OECD Compendium of Legal Instruments — authoritative text of Recommendations' },
  { host: 'www.oecd.org',              kind: 'international', note: 'OECD' },
  { host: 'www.apec.org',              kind: 'international', note: 'APEC Secretariat publications' },
  { host: 'www.globalcbpr.org',        kind: 'international', note: 'Global CBPR Forum — the issuing body' },
  // additional US agency hosts
  { host: 'aspe.hhs.gov',              kind: 'agency',     note: 'HHS ASPE — hosts the 1973 HEW Advisory Committee report' },
  { host: 'www.dhs.gov',               kind: 'agency',     note: 'DHS Privacy Office. NOTE: blocks automated fetch (HTTP 403) as of 2026-08-18' },
  { host: 'www.nist.gov',              kind: 'agency',     note: 'NIST' },
  { host: 'csrc.nist.gov',             kind: 'agency',     note: 'NIST CSRC publications' },

  // self-regulatory bodies — the issuing body's own publication of its own code
  { host: 'thenai.org',                    kind: 'self_regulatory', note: 'Network Advertising Initiative' },
  { host: 'www.thenai.org',                kind: 'self_regulatory', note: 'Network Advertising Initiative' },
  { host: 'digitaladvertisingalliance.org', kind: 'self_regulatory', note: 'Digital Advertising Alliance' },
  { host: 'www.aboutads.info',             kind: 'self_regulatory', note: 'DAA consumer-facing site' },
  { host: 'www.pcisecuritystandards.org',  kind: 'self_regulatory', note: 'PCI Security Standards Council' },
  // NY legislature (API path; the website blocks automated access — see meta/blocked-sources.yaml)
  { host: 'legislation.nysenate.gov',      kind: 'statute', note: 'NY Senate OpenLegislation API — needs a key' },

];

export function classify(url) {
  const host = new URL(url).hostname;
  const hit = ALLOWED.find(a => a.host === host);
  return hit ? { ok: true, ...hit } : { ok: false, host };
}
