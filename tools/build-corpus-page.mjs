#!/usr/bin/env node
// GENERATE corpus.html — every instrument and provision the corpus holds.
//
// GENERATED, NEVER HAND-WRITTEN. A page listing what the corpus contains is a claim about the
// corpus, and a hand-maintained one drifts the moment a record lands. The site already carried a
// hand-typed "42 CI gates" that survived three gates past being true. This reads the corpus and
// meta/ at build time, so the page cannot say the repository holds something it does not.
//
// TWO ORGANISING AXES, because two different readers arrive:
//   BY JURISDICTION — a lawyer asking "what do you have on New York".
//   BY DOMAIN       — the five IAPP CIPP/US body-of-knowledge domains, which is the framework a
//                     privacy professional already has in their head.
//
// The page also carries what is ABSENT: instruments declared with duty categories the corpus
// does not supply, records suppressed as unverified, and the single-state coverage caveat. A
// contents page that lists only what is present reads identically whether the corpus is complete
// or a tenth complete.
//
//   node tools/build-corpus-page.mjs [--out corpus.html] [--check]
//
// --check exits 1 if the committed page differs from what the corpus would produce now. The
// site carried a hand-typed "42 CI gates" through three releases that added gates; a generated
// page only stays true if something asserts it was regenerated.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as yaml from 'js-yaml';

const ROOT = resolve(import.meta.dirname, '..');
const R = p => resolve(ROOT, p);
const argv = process.argv.slice(2);
const OUT = R(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'corpus.html');
const CHECK = argv.includes('--check');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.yaml') && p.includes('/atoms/')) out.push(p);
  }
  return out;
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- read
const records = walk(R('corpus')).map(f => yaml.load(readFileSync(f, 'utf8'))).filter(r => r?.id);
const instMeta = yaml.load(readFileSync(R('meta/instrument-coverage.yaml'), 'utf8'))?.instruments ?? {};
const domains = yaml.load(readFileSync(R('meta/coverage.yaml'), 'utf8'))?.domains ?? [];
const pkg = JSON.parse(readFileSync(R('package.json'), 'utf8'));
const domainTitle = Object.fromEntries(domains.map(d => [d.domain, d.title]));

const JUR = {
  'US-FED': { label: 'Federal', blurb: 'United States Code and Code of Federal Regulations.' },
  'US-NY': { label: 'New York State', blurb: 'General Business Law, Civil Rights Law, Education Law, Penal Law.' },
  'US-NY-NYC': { label: 'New York City', blurb: 'Administrative Code and Rules of the City of New York.' },
};
// KEYED ON jurisdiction_level, NOT jurisdiction. The `jurisdiction` field carries TWO values for
// the same concept — 'US' on 165 records and 'US-FED' on 41 — so mapping on it put 124 federal
// instruments in an "other" bucket that was never rendered. jurisdiction_level is single-valued
// (federal / state / local) across all 248 records.
const jurOf = rec => rec.jurisdiction_level === 'local' ? 'US-NY-NYC'
  : rec.jurisdiction_level === 'state' ? (rec.jurisdiction ?? 'US-NY')
  : 'US-FED';

// group records by instrument
const byInstrument = new Map();
for (const rec of records) {
  const key = rec.source?.instrument_id ?? '(no instrument)';
  if (!byInstrument.has(key)) byInstrument.set(key, []);
  byInstrument.get(key).push(rec);
}

// natural sort on a citation so § 164.5 precedes § 164.20
const citeKey = c => String(c ?? '').replace(/\d+/g, n => n.padStart(6, '0'));

const instruments = [...byInstrument.entries()].map(([id, recs]) => {
  const declared = instMeta[id] ?? null;
  const withCite = recs.filter(rec => rec.source?.citation);
  const src = recs.find(rec => rec.source?.url)?.source ?? {};
  // A category counts as present only when EVERY declared provision is held. Asking whether ANY
  // prefix matched reported a category as covered on the strength of one of several provisions —
  // which is how 45 C.F.R. 164.512 and N.Y. GBL 899-aa(8) sat missing behind a green bar.
  const cats = (declared?.categories ?? []).map(cat => {
    const prefixes = cat.citation_prefix ?? [];
    const missing = prefixes.filter(pre =>
      !recs.some(rec => String(rec.source?.citation ?? '').startsWith(pre)));
    return { id: cat.id, supplies: cat.supplies ?? null, present: missing.length === 0, missing };
  });
  return {
    id,
    title: declared?.title ?? id,
    note: declared?.note ?? null,
    jurisdiction: jurOf(recs[0]),
    domain: (recs[0].subject?.domain ?? '').split('.')[0] || '?',
    url: src.url ?? null,
    format: src.format ?? null,
    fetched: src.fetched ?? null,
    categories: cats,
    complete: cats.length ? cats.every(c => c.present) : null,
    provisions: withCite.map(rec => ({
      id: rec.id,
      citation: rec.source.citation,
      summary: rec.summary ?? null,
      record_type: rec.record_type,
      effective_from: rec.effective_from ?? null,
      effective_to: rec.effective_to ?? null,
      basis: rec.effective_from_basis ?? null,
      status: rec.status,
      deadline: rec.deadline
        ? `${rec.deadline.duration?.value} ${rec.deadline.duration?.unit}`.replace(/_/g, ' ')
        : null,
      verified: rec.verification_status === 'verbatim_confirmed',
      pra: rec.enforcement?.private_right_of_action === true,
    })).sort((a, b) => citeKey(a.citation).localeCompare(citeKey(b.citation))),
    // An instrument is something that IMPOSES DUTIES. Authorities, definitions, doctrine,
    // principles and taxonomy records are scaffolding the engine reasons with — real corpus
    // content, but not what a lawyer means by "which laws are in here". Listing them together
    // made "us.usc.t12" sit beside the HIPAA Breach Notification Rule as though they were peers.
    kind: recs.some(rec => rec.record_type === 'obligation') ? 'instrument' : 'support',
    record_types: [...new Set(recs.map(rec => rec.record_type))].sort(),
  };
}).filter(i => i.provisions.length)
  .sort((a, b) => a.title.localeCompare(b.title));

const SUPPORT_LABEL = {
  authority: 'Enforcement authorities',
  definition: 'Defined terms',
  doctrine: 'Constitutional doctrine',
  principle: 'Foundational principles',
  enforcement_action: 'Enforcement patterns',
  taxonomy: 'Sources of law',
  workflow_constraint: 'Workflow constraints',
};
const statutes = instruments.filter(i => i.kind === 'instrument');
const support = instruments.filter(i => i.kind === 'support');

const totals = {
  records: records.length,
  instruments: instruments.filter(i => i.kind === 'instrument').length,
  provisions: records.length,
  suppressed: records.filter(r => r.verification_status !== 'verbatim_confirmed').length,
  withDeadline: records.filter(r => r.deadline).length,
  partial: instruments.filter(i => i.complete === false).length,
  support: instruments.filter(i => i.kind === 'support').reduce((n, i) => n + i.provisions.length, 0),
  pending: records.filter(r => r.status === 'enacted_pending').length,
};

const BASIS_LABEL = {
  versioner_evidence: 'point-in-time evidence — the source’s own version history shows when this text began',
  stated_in_text: 'stated in the instrument’s own words',
  citation_apparatus: 'read off the citation apparatus — a publication or enactment date standing in for effectiveness',
  api_snapshot: 'the API snapshot date — NOT a property of the law',
  undetermined: 'not traceable to anything the repository holds',
};

// ---------------------------------------------------------------- render
const card = inst => {
  const done = inst.categories.filter(c => c.present).length;
  const bar = inst.categories.length
    ? `<span class="cbar" title="${done} of ${inst.categories.length} declared duty categories present">${
        inst.categories.map(c => `<i class="${c.present ? 'on' : 'off'}" title="${esc(c.id)}${c.present ? '' : ' — ABSENT'}"></i>`).join('')
      }</span>` : '';
  return `
<article class="ic" data-jur="${esc(inst.jurisdiction)}" data-dom="${esc(inst.domain)}"
         data-q="${esc((inst.title + ' ' + inst.id + ' ' + inst.provisions.map(p => p.citation).join(' ')).toLowerCase())}">
  <details>
    <summary>
      <span class="ic-t">${esc(inst.title)}</span>
      <span class="ic-n">${inst.provisions.length}</span>
      ${bar}
      ${inst.complete === false ? '<span class="tag warn">partial</span>' : ''}
    </summary>
    <div class="ic-body">
      <p class="ic-meta"><code>${esc(inst.id)}</code>
        ${inst.url ? ` · <a href="${esc(inst.url)}" rel="nofollow noopener">primary source</a>` : ''}
        ${inst.format ? ` · ${esc(inst.format)}` : ''}
        ${inst.fetched ? ` · fetched ${esc(inst.fetched)}` : ''}</p>
      ${inst.note ? `<p class="ic-note">${esc(inst.note)}</p>` : ''}
      ${inst.complete === false ? `<p class="ic-gap"><b>Declared but not held:</b> ${
        inst.categories.filter(c => !c.present).map(c =>
          `<span>${esc((c.missing ?? []).join(', ') || c.id)}</span>${c.supplies ? ' — ' + esc(c.supplies) : ''}`).join('; ')
      }</p>` : ''}
      <table class="pv">
        <thead><tr><th>Provision</th><th>What it requires</th><th>In force</th><th>Clock</th></tr></thead>
        <tbody>
        ${inst.provisions.map(p => `<tr>
          <td><b>${esc(p.citation)}</b><br><code class="rid">${esc(p.id)}</code>
            ${p.pra ? '<span class="tag pra">private right of action</span>' : ''}
            ${!p.verified ? '<span class="tag warn">unverified — suppressed from answers</span>' : ''}</td>
          <td>${esc(p.summary ?? '—')}</td>
          <td>${p.effective_from ? esc(p.effective_from) : '—'}${p.effective_to ? ' → ' + esc(p.effective_to) : ''}
            ${p.status === 'enacted_pending' ? '<br><span class="tag warn">not law yet</span>' : ''}
            ${p.basis ? `<br><span class="basis b-${esc(p.basis)}" title="${esc(BASIS_LABEL[p.basis] ?? p.basis)}">${esc(p.basis.replace(/_/g, ' '))}</span>` : ''}</td>
          <td>${p.deadline ? '<b>' + esc(p.deadline) + '</b>' : '—'}</td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </details>
</article>`;
};

// CARDS ARE RENDERED ONCE. The first cut emitted every card twice — once per organising axis —
// which doubled a 300KB page for a view most readers never switch to. The domain sections ship
// empty and the toggle reparents the existing nodes, so the two axes cost one card each.
const jurSections = Object.entries(JUR).map(([code, meta]) => {
  const list = statutes.filter(i => i.jurisdiction === code);
  if (!list.length) return '';
  return `<section class="grp" data-view="jur" data-key="${esc(code)}">
    <h3>${esc(meta.label)} <span class="grp-n">${list.length} instruments · ${
      list.reduce((n, i) => n + i.provisions.length, 0)} provisions</span></h3>
    <p class="grp-b">${esc(meta.blurb)}</p>
    <div class="slot">${list.map(card).join('')}</div></section>`;
}).join('');

const domSections = domains.map(d => {
  const list = statutes.filter(i => i.domain === d.domain);
  if (!list.length) return '';
  return `<section class="grp" data-view="dom" data-key="${esc(d.domain)}" hidden>
    <h3>${esc(d.domain)}. ${esc(d.title)} <span class="grp-n">${list.length} instruments · ${
      list.reduce((n, i) => n + i.provisions.length, 0)} provisions</span></h3>
    <div class="slot"></div></section>`;
}).join('');

// SUPPORTING RECORDS. Authorities, definitions, doctrine and principles are real corpus content
// that the engine reasons with, and they are NOT statutes. Listing them together put
// "us.usc.t12" beside the HIPAA Breach Notification Rule as though a reader should treat them
// as peers.
const supportSection = support.length ? `
<section class="grp support" data-view="both">
  <h3>Supporting records <span class="grp-n">${support.length} groups · ${
    support.reduce((n, i) => n + i.provisions.length, 0)} records</span></h3>
  <p class="grp-b">Not statutes. These are what the engine reasons <em>with</em>: who enforces,
  what a term means under which Act, the constitutional limits on privacy regulation, and the
  1973 fair information practice principles every later statute is built on.</p>
  <div class="slot">${support.map(inst => {
    const label = inst.record_types.map(t => SUPPORT_LABEL[t] ?? t).join(' · ');
    return card({ ...inst, title: `${label} — ${inst.provisions[0].citation}` });
  }).join('')}</div>
</section>` : '';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>What is in the corpus · Privacy-KB</title>
<meta name="description" content="Every statute, regulation and provision Privacy-KB holds: ${totals.instruments} instruments, ${totals.provisions} provisions, each with its primary source, its in-force dates and what kind of date those are.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%23C8102E'/><rect x='6' y='7' width='20' height='2.6' fill='white'/><rect x='6' y='14.7' width='20' height='2.6' fill='white'/><rect x='6' y='22.4' width='12' height='2.6' fill='white'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
/* Generated by tools/build-corpus-page.mjs. Tokens mirror index.html deliberately: this file is
   self-contained so a build cannot half-apply. Red marks what is wrong, early, or unchecked. */
:root{
  --white:#FFFFFF; --paper:#FAFAF9; --ink:#111214; --grey:#565B62; --grey-2:#6B7178;
  --line:#E4E6E9; --line-2:#CDD1D6;
  --red:#C8102E; --red-deep:#8E0B20; --red-wash:#FDF1F3; --red-line:#F3C9D0;
  --ok:#1B7F4B; --ok-wash:#F0F8F3; --ok-line:#CFE7DA;
}
/* Mirrors index.html's dark tokens exactly. Without this the contents page rendered light while
   the rest of the site rendered dark — the same page, two identities, depending on the reader's
   system setting. */
@media (prefers-color-scheme:dark){
  :root{
    --white:#111214; --paper:#17181B; --ink:#F0EFEE; --grey:#A2A7AE; --grey-2:#868C94;
    --line:#26282C; --line-2:#383B41;
    --red:#FF5A6E; --red-deep:#FF8492; --red-wash:#241318; --red-line:#4A2028;
    --ok:#5FD69B; --ok-wash:#12211A; --ok-line:#26402F;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font:16px/1.55 Archivo,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased}
code,.mono{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
a{color:var(--red-deep)}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
header.top{background:var(--white);border-bottom:1px solid var(--line);padding:14px 0}
.navr{display:flex;gap:20px;align-items:center;flex-wrap:wrap}
.navr a{color:var(--grey);text-decoration:none;font-size:14px;font-weight:500}
.navr a:hover,.navr a[aria-current]{color:var(--ink)}
.navr .brand{font-weight:700;color:var(--ink);letter-spacing:-.01em}
h1{font-size:clamp(28px,4vw,42px);line-height:1.1;letter-spacing:-.022em;margin:36px 0 10px}
h1 em{font-style:normal;color:var(--red)}
.lede{color:var(--grey);font-size:17px;max-width:62ch;margin:0 0 22px}
.stats{display:flex;flex-wrap:wrap;gap:0;border:1px solid var(--line);background:var(--white);border-radius:2px;margin:0 0 8px}
.stat{padding:14px 20px;border-right:1px solid var(--line);flex:1 1 auto;min-width:132px}
.stat:last-child{border-right:0}
.stat b{display:block;font-size:24px;letter-spacing:-.02em}
.stat span{font-size:12px;color:var(--grey);text-transform:uppercase;letter-spacing:.06em}
.caveat{background:var(--red-wash);border:1px solid var(--red-line);border-radius:2px;padding:14px 18px;margin:16px 0 28px;font-size:14.5px}
.caveat b{color:var(--red-deep)}
.controls{position:sticky;top:0;z-index:5;background:var(--paper);padding:14px 0 12px;border-bottom:1px solid var(--line);margin-bottom:22px}
.controls .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.controls input{flex:1 1 260px;min-width:200px;padding:9px 12px;border:1px solid var(--line-2);border-radius:2px;font:inherit;font-size:14px;background:var(--white)}
.seg{display:inline-flex;border:1px solid var(--line-2);border-radius:2px;overflow:hidden;background:var(--white)}
.seg button{border:0;background:transparent;padding:9px 14px;font:inherit;font-size:13.5px;font-weight:500;cursor:pointer;color:var(--grey)}
.seg button[aria-pressed="true"]{background:var(--ink);color:var(--white)}
.count{font-size:13px;color:var(--grey)}
.grp{margin:0 0 30px}
.grp h3{font-size:19px;margin:26px 0 4px;letter-spacing:-.015em}
.grp-n{font-weight:400;font-size:13px;color:var(--grey);margin-left:8px}
.grp-b{color:var(--grey);font-size:14px;margin:0 0 12px}
.ic{background:var(--white);border:1px solid var(--line);border-radius:2px;margin:0 0 8px}
/* The marker is POSITIONED, not a flex item. As a flex item it wrapped onto a line of its own
   whenever a long instrument title pushed the title to the next row — visible on narrow screens,
   where most titles are long. */
.ic summary{cursor:pointer;padding:12px 16px 12px 34px;display:flex;gap:12px;align-items:center;
  list-style:none;flex-wrap:wrap;position:relative}
.ic summary::-webkit-details-marker{display:none}
.ic summary::before{content:"▸";color:var(--grey);font-size:12px;position:absolute;left:16px;
  top:15px;transition:transform .12s}
.ic details[open] summary::before{transform:rotate(90deg)}
.ic-t{font-weight:600;flex:1 1 200px;min-width:0;letter-spacing:-.01em}
.ic-n{font:500 12px/1 "IBM Plex Mono",monospace;color:var(--grey);border:1px solid var(--line);border-radius:2px;padding:4px 7px}
.cbar{display:inline-flex;gap:2px}
.cbar i{width:14px;height:6px;border-radius:1px;background:var(--ok)}
.cbar i.off{background:var(--red-line)}
.tag{font:500 11px/1 Archivo,sans-serif;text-transform:uppercase;letter-spacing:.05em;padding:4px 6px;border-radius:2px;white-space:nowrap}
.tag.warn{background:var(--red-wash);color:var(--red-deep);border:1px solid var(--red-line)}
.tag.pra{background:var(--ok-wash);color:var(--ok);border:1px solid var(--ok-line)}
.ic-body{padding:0 16px 16px;border-top:1px solid var(--line)}
.ic-meta{font-size:13px;color:var(--grey);margin:12px 0 8px}
.ic-meta code{font-size:12px}
.ic-note{font-size:14px;color:var(--grey);border-left:2px solid var(--line-2);padding-left:12px;margin:8px 0}
.ic-gap{font-size:13.5px;background:var(--red-wash);border:1px solid var(--red-line);border-radius:2px;padding:10px 12px;margin:10px 0}
.ic-gap span{font-family:"IBM Plex Mono",monospace;font-size:12px}
.pv{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px;display:block;overflow-x:auto}
.pv th{text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--grey);border-bottom:1px solid var(--line-2);padding:8px 10px 6px;white-space:nowrap}
.pv td{border-bottom:1px solid var(--line);padding:10px;vertical-align:top}
.pv tr:last-child td{border-bottom:0}
.rid{font-size:11px;color:var(--grey)}
.basis{font:500 11px/1.3 "IBM Plex Mono",monospace;color:var(--grey);border-bottom:1px dotted var(--line-2);cursor:help}
.basis.b-api_snapshot,.basis.b-undetermined{color:var(--red-deep)}
.basis.b-versioner_evidence{color:var(--ok)}
.empty{padding:28px;text-align:center;color:var(--grey);background:var(--white);border:1px dashed var(--line-2);border-radius:2px}
footer{border-top:1px solid var(--line);margin-top:44px;padding:26px 0 44px;color:var(--grey);font-size:13.5px;background:var(--white)}
footer a{color:var(--grey)}
@media (max-width:640px){ .stat{min-width:50%} .controls{position:static} }
</style>
</head>
<body>

<header class="top"><div class="wrap navr">
  <a class="brand" href="./">Privacy-KB</a>
  <a href="./#hour">A worked hour</a>
  <a href="./#verify">Verify a citation</a>
  <a href="./corpus.html" aria-current="page">What is in it</a>
  <a href="https://github.com/rakib-nyc/privacy-kb">Repository</a>
</div></header>

<main class="wrap">
  <h1>Every provision in the corpus, <em>and what kind of date it carries</em></h1>
  <p class="lede">${totals.instruments} instruments, ${totals.provisions} provisions, each quoted verbatim
  from a primary source, hash-anchored, and dated. Open any instrument to see its provisions, the
  clock each one starts, and how far its in-force date can actually be defended.</p>

  <div class="stats">
    <div class="stat"><b>${totals.instruments}</b><span>instruments</span></div>
    <div class="stat"><b>${totals.provisions}</b><span>provisions</span></div>
    <div class="stat"><b>${totals.withDeadline}</b><span>carry a clock</span></div>
    <div class="stat"><b>${totals.partial}</b><span>partially extracted</span></div>
    <div class="stat"><b>${totals.pending}</b><span>enacted, not yet law</span></div>
  </div>

  <div class="caveat">
    <b>Read this before using the list.</b> Coverage is federal, New York State and New York City —
    <b>one state of fifty</b>. There is no California, no Colorado, no Virginia. A question about
    another state returns no obligations and says so, which is honest and not useful. Instruments
    marked <span class="tag warn">partial</span> hold some duty categories and not others, and the
    absent ones are named. ${totals.suppressed} record${totals.suppressed === 1 ? ' is' : 's are'}
    held but suppressed from every answer as unverified.
  </div>

  <div class="controls">
    <div class="row">
      <input id="q" type="search" placeholder="Search a statute, a citation, a record id…" aria-label="Search instruments and citations">
      <span class="seg" role="group" aria-label="Group by">
        <button id="byJur" aria-pressed="true">By jurisdiction</button>
        <button id="byDom" aria-pressed="false">By subject</button>
      </span>
      <span class="count" id="count"></span>
    </div>
  </div>

  <div id="list">
    ${jurSections}
    ${domSections}
    ${supportSection}
    <p class="empty" id="none" hidden>Nothing matches that search.</p>
  </div>
</main>

<footer><div class="wrap">
  <p>Generated from the corpus by <code>tools/build-corpus-page.mjs</code> at version ${esc(pkg.version)}.
  This page is built from the records themselves, so it cannot claim the repository holds something it does not.</p>
  <p><b>Not legal advice. No warranty.</b> Check every citation against the primary source before
  relying on it — <code>privacy-kb cite &lt;record id&gt;</code> returns the verbatim text with its
  URL and hash, or fails. <a href="https://github.com/rakib-nyc/privacy-kb">Repository</a> ·
  <a href="./">Home</a></p>
</div></footer>

<script>
(function(){
  var q=document.getElementById('q'), count=document.getElementById('count'),
      none=document.getElementById('none'), byJur=document.getElementById('byJur'),
      byDom=document.getElementById('byDom'), view='jur';
  // Move the cards rather than render them twice. Each instrument exists once in the DOM.
  function regroup(){
    document.querySelectorAll('.grp[data-view="'+view+'"]').forEach(function(g){
      var key=g.getAttribute('data-key'), slot=g.querySelector('.slot');
      document.querySelectorAll('.ic').forEach(function(card){
        if(card.closest('.support')) return;               // supporting records never move
        var val=view==='jur'?card.getAttribute('data-jur'):card.getAttribute('data-dom');
        if(val===key && card.parentNode!==slot) slot.appendChild(card);
      });
    });
  }
  function apply(){
    regroup();
    var term=(q.value||'').trim().toLowerCase(), shown=0;
    document.querySelectorAll('.grp').forEach(function(g){
      var gv=g.getAttribute('data-view');
      var active=(gv===view||gv==='both'), any=false;
      g.querySelectorAll('.ic').forEach(function(card){
        var hit=!term||card.getAttribute('data-q').indexOf(term)>-1;
        card.hidden=!(active&&hit);
        if(active&&hit){any=true; if(gv!=='both') shown++;}
        // Open matching cards on a search so the hit is visible without another click.
        var d=card.querySelector('details');
        if(term&&hit){d.open=true;} else if(!term){d.open=false;}
      });
      g.hidden=!(active&&any);
    });
    none.hidden=shown>0;
    count.textContent=shown+' instrument'+(shown===1?'':'s')+(term?' matching':'');
  }
  q.addEventListener('input',apply);
  byJur.addEventListener('click',function(){view='jur';byJur.setAttribute('aria-pressed','true');byDom.setAttribute('aria-pressed','false');apply();});
  byDom.addEventListener('click',function(){view='dom';byDom.setAttribute('aria-pressed','true');byJur.setAttribute('aria-pressed','false');apply();});
  apply();
})();
</script>
</body>
</html>
`;

if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== html) {
    console.log(`${OUT.replace(ROOT + '/', '')} is STALE — run: node tools/build-corpus-page.mjs`);
    process.exit(1);
  }
  console.log(`${OUT.replace(ROOT + '/', '')} is current`);
  process.exit(0);
}
writeFileSync(OUT, html);
console.log(`wrote ${OUT.replace(ROOT + '/', '')}`);
console.log(`  ${totals.instruments} instruments · ${totals.provisions} provisions · ` +
            `${totals.withDeadline} with a clock · ${totals.partial} partial · ${totals.suppressed} suppressed`);
