/* Cadence dashboard — dependency-free. No browser storage; all state lives in
   memory and on the server. Renders KPIs, a sparkline, the signature decision
   tape with expandable reasoning, top earners, and the escrow desk. */

const $ = (id) => document.getElementById(id);
const fmtUsd = (n) => Number(n || 0).toFixed(6);
const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const VERDICT_TAG = { settled: 'settled', escrowed: 'escrowed', rejected: 'withheld' };
const seen = new Set();           // decision ids already in the tape
let lastSeries = [];

/* ── KPIs + chrome ─────────────────────────────────────────────────────── */
function renderStats(stats) {
  if (!stats) return;
  const { config, metrics } = stats;

  if (config) {
    const live = config.mode === 'real';
    const badge = $('modeBadge');
    badge.classList.toggle('live', live);
    $('modeLabel').textContent = config.modeLabel || (live ? 'LIVE' : 'MOCK');
    $('footMode').textContent = live ? 'live · arc testnet' : 'mock · deterministic';
  }

  if (metrics) {
    const t = metrics.totals || {};
    $('kpiPaid').textContent = fmtUsd(t.totalPaidUsd);
    $('kpiSettled').textContent = fmtInt(t.settledPlays);
    $('kpiEscrow').textContent = fmtUsd(t.totalEscrowUsd);
    $('kpiEscrowOpen').textContent = fmtInt(metrics.escrowOpen);
    $('kpiRejected').textContent = fmtInt(t.rejectedPlays);
    $('kpiArtists').textContent = fmtInt(metrics.uniqueArtists);
    $('kpiUsers').textContent = fmtInt(metrics.uniqueUsers);
    $('kpiBatches').textContent = fmtInt(metrics.operators);

    const settled = t.settledPlays || 0;
    $('trendMeta').textContent = settled
      ? `${fmtInt(settled)} settlements · $${fmtUsd(t.totalPaidUsd)} paid`
      : 'awaiting plays';

    if (Array.isArray(metrics.series)) { lastSeries = metrics.series; renderSpark(metrics.series); }
    renderRanks(metrics.topArtists || []);
  }
}

/* ── sparkline ─────────────────────────────────────────────────────────── */
function renderSpark(series) {
  const el = $('spark');
  if (!series.length) { el.innerHTML = ''; return; }
  const W = 1000, H = 54, pad = 3;
  const max = Math.max(...series, 0.000001);
  const n = series.length;
  const step = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const pts = series.map((v, i) => {
    const x = pad + i * step;
    const y = H - pad - (v / max) * (H - pad * 2);
    return [x, y];
  });
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="settlement amounts over time">
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#5BC8A0" stop-opacity="0.28"/>
          <stop offset="1" stop-color="#5BC8A0" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#sg)"/>
      <path d="${line}" fill="none" stroke="#5BC8A0" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
      ${pts.length ? `<circle cx="${pts[pts.length - 1][0].toFixed(1)}" cy="${pts[pts.length - 1][1].toFixed(1)}" r="2.6" fill="#E3C173"/>` : ''}
    </svg>`;
}

/* ── top earners ───────────────────────────────────────────────────────── */
function renderRanks(top) {
  const el = $('ranks');
  if (!top.length) { el.innerHTML = '<li class="ranks-empty">No payouts yet.</li>'; return; }
  const max = Math.max(...top.map((a) => a.paidUsd), 0.000001);
  el.innerHTML = top.map((a) => `
    <li class="rank">
      <span class="who">
        <span class="name">${esc(a.name)}</span>
        <span class="plays">${fmtInt(a.plays)} play${a.plays === 1 ? '' : 's'}</span>
      </span>
      <span class="paid">$${fmtUsd(a.paidUsd)}</span>
      <span class="rank-bar"><i style="width:${Math.max(4, (a.paidUsd / max) * 100).toFixed(1)}%"></i></span>
    </li>`).join('');
}

/* ── escrow desk ───────────────────────────────────────────────────────── */
async function refreshEscrow() {
  try {
    const r = await fetch('/api/escrow');
    const { escrow } = await r.json();
    const el = $('escrow');
    if (!escrow || !escrow.length) { el.innerHTML = '<li class="escrow-empty">Nothing in escrow.</li>'; return; }
    el.innerHTML = escrow.map((e) => `
      <li class="item">
        <span class="name">${esc(e.name)}</span>
        <span class="held">$${fmtUsd(e.usd)}</span>
        <span class="hash">${esc(e.identityHash)}</span>
      </li>`).join('');
  } catch { /* offline-friendly: leave as-is */ }
}

/* ── decision tape (signature) ─────────────────────────────────────────── */
const KIND_RE = /^\[([a-z]+)\]\s*(.*)$/i;

function stepRow(line) {
  const m = KIND_RE.exec(line);
  const kind = m ? m[1].toLowerCase() : 'note';
  const text = m ? m[2] : line;
  return `<li class="step"><span class="step-kind k-${esc(kind)}">${esc(kind)}</span><span class="step-text">${esc(text)}</span></li>`;
}

function payoutRow(p) {
  const isEscrow = p.escrowed;
  const wallet = isEscrow
    ? `<span class="wallet badge8004">↳ no wallet — held in escrow, claimable via ERC-8004 id ${esc((p.identityHash || '').slice(0, 14))}…</span>`
    : (p.wallet ? `<span class="wallet">↳ ${esc(p.wallet)}</span>` : '');
  return `
    <div class="payout ${isEscrow ? 'is-escrow' : ''}">
      <span class="who">${esc(p.name)}<span class="role">${esc(p.role || '')}</span></span>
      <span class="share">${(p.share * 100).toFixed(1)}%</span>
      <span class="amt">$${fmtUsd(p.amountUsd)}</span>
      ${wallet}
    </div>`;
}

function decisionRow(d) {
  const v = d.verdict || 'settled';
  const review = d.needsReview ? '<span class="tag flag-review">needs review</span>' : '';
  const conf = (typeof d.confidence === 'number') ? `${Math.round(d.confidence * 100)}% conf` : '';
  const amount = v === 'rejected' ? `$${fmtUsd(d.amountUsd)}` : `$${fmtUsd(d.amountUsd)}`;
  const steps = (d.reasoning || []).map(stepRow).join('');
  const payouts = (d.payees || []).length
    ? `<div class="payout-table">${d.payees.map(payoutRow).join('')}</div>` : '';
  const tx = d.txHash
    ? `<div class="tx-line"><b>batch</b> ${esc(d.batchId || '—')} &nbsp; <b>tx</b> ${esc(d.txHash)}</div>` : '';

  const li = document.createElement('li');
  li.className = `row row-${v}`;
  li.innerHTML = `
    <div class="row-main" role="button" tabindex="0" aria-expanded="false">
      <span class="rail" aria-hidden="true"></span>
      <span class="row-body">
        <span class="row-title">
          <span class="row-track">${esc(d.track?.title || 'Unknown track')}</span>
          <span class="row-artist">— ${esc(d.track?.artist || 'Unknown artist')}</span>
        </span>
        <span class="row-meta">
          <span class="tag v-${v}">${esc(VERDICT_TAG[v] || v)}</span>
          ${review}
          <span class="row-user">${esc(d.user || '')}</span>
        </span>
      </span>
      <span class="row-right">
        <span class="row-amount">${amount}</span>
        <span class="row-conf">${esc(conf)}<span class="chev"> ▶</span></span>
      </span>
    </div>
    <div class="trace"><div class="trace-inner"><div class="trace-pad">
      <ul class="steps">${steps}</ul>
      ${payouts}
      ${tx}
    </div></div></div>`;

  const head = li.querySelector('.row-main');
  const toggle = () => {
    const open = li.classList.toggle('open');
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
  return li;
}

function prependDecision(d) {
  if (!d || !d.id || seen.has(d.id)) return;
  seen.add(d.id);
  const empty = $('tapeEmpty');
  if (empty) empty.remove();
  const tape = $('tape');
  tape.prepend(decisionRow(d));
  // keep the DOM bounded
  while (tape.children.length > 120) tape.removeChild(tape.lastChild);
}

function renderDecisions(list) {
  // oldest first so prepend yields newest-on-top
  for (let i = list.length - 1; i >= 0; i--) prependDecision(list[i]);
}

/* ── live stream ───────────────────────────────────────────────────────── */
function connectStream() {
  if (typeof EventSource === 'undefined') return;
  let es;
  try { es = new EventSource('/api/stream'); } catch { return; }
  es.addEventListener('decision', (e) => {
    try { prependDecision(JSON.parse(e.data)); } catch { /* ignore */ }
  });
  es.addEventListener('metrics', () => { refreshStats(); refreshEscrow(); });
  es.onerror = () => { /* browser auto-reconnects via retry: */ };
}

/* ── bootstrap ─────────────────────────────────────────────────────────── */
async function refreshStats() {
  try { renderStats(await (await fetch('/api/stats')).json()); } catch { /* offline */ }
}

async function loadInitial() {
  await refreshStats();
  try {
    const { decisions } = await (await fetch('/api/decisions?n=60')).json();
    if (decisions?.length) renderDecisions(decisions);
  } catch { /* offline */ }
  await refreshEscrow();
}

async function runSimulation() {
  const btn = $('runBtn');
  btn.disabled = true;
  const label = btn.querySelector('.run-btn-glyph');
  const prev = label.textContent; label.textContent = '◷';
  try {
    await fetch('/api/simulate', { method: 'POST' });
    // SSE will stream the rows in; refresh aggregates as a fallback
    await refreshStats();
    await refreshEscrow();
  } catch {
    $('trendMeta').textContent = 'simulation failed — is the server running?';
  } finally {
    label.textContent = prev; btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('runBtn').addEventListener('click', runSimulation);
  loadInitial();
  connectStream();
});
