import fs from 'fs';
import path from 'path';
import { parseInputString, inferType } from './parser.js';

const schemaPath = path.join(process.cwd(), 'data', 'gets_v0_1_schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
const allowedCurrencies = ['AED', 'SAR', 'MYR', 'USD'];

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+|_/g, '');
}

function flattenRecord(rec) {
  // Flatten nested simple objects with dot paths; leave arrays as-is
  const out = {};
  function walk(obj, prefix = '') {
    Object.entries(obj || {}).forEach(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) out[key] = v;
      else if (v && typeof v === 'object') walk(v, key);
      else out[key] = v;
    });
  }
  walk(rec);
  return out;
}

function listTargetKeys(schema) {
  const keys = [];
  function walk(obj, prefix = '') {
    Object.entries(obj).forEach(([k, v]) => {
      if (Array.isArray(v)) {
        if (v.length && typeof v[0] === 'object') {
          // lines[] keys
          Object.keys(v[0]).forEach(sub => keys.push(`${prefix ? prefix + '.' : ''}${k}[].${sub}`));
        } else keys.push(`${prefix ? prefix + '.' : ''}${k}[]`);
      } else if (v && typeof v === 'object') walk(v, `${prefix ? prefix + '.' : ''}${k}`);
      else keys.push(`${prefix ? prefix + '.' : ''}${k}`);
    });
  }
  walk(schema);
  return keys;
}

const targetKeys = listTargetKeys(schema);

function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.8;
  if (a.includes(b) || b.includes(a)) return 0.6;
  // simple edit distance ratio
  const dist = levenshtein(a, b);
  const m = Math.max(a.length, b.length) || 1;
  return 1 - dist / m;
}

function levenshtein(a, b) {
  const dp = Array(b.length + 1).fill(0).map((_, i) => [i]);
  for (let j = 0; j <= a.length; j++) dp[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (a[j-1] === b[i-1]) dp[i][j] = dp[i-1][j-1];
      else dp[i][j] = Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]) + 1;
    }
  }
  return dp[b.length][a.length];
}

export function previewTable(rows) {
  const first = rows.slice(0, 20);
  const cols = new Set();
  first.forEach(r => Object.keys(r).forEach(k => cols.add(k)));
  const columns = Array.from(cols);
  const types = {};
  columns.forEach(c => {
    const vals = first.map(r => r[c]).filter(v => v !== undefined && v !== '');
    const t = vals.length ? inferType(vals[0]) : 'empty';
    types[c] = t;
  });
  return { columns, rows: first, types };
}

export function detectCoverage(rows) {
  if (!rows.length) return { matched: [], close: [], missing: targetKeys };
  const columns = new Set();
  rows.forEach(r => Object.keys(flattenRecord(r)).forEach(k => columns.add(k)));
  const cols = Array.from(columns);

  const matched = [];
  const close = [];
  const used = new Set();

  for (const t of targetKeys) {
    let best = { sim: 0, cand: null };
    for (const c of cols) {
      const sim = similarity(c, t);
      if (sim > best.sim) best = { sim, cand: c };
    }
    if (best.sim >= 0.9) { matched.push(t); used.add(best.cand); }
    else if (best.sim >= 0.6) { close.push({ target: t, candidate: best.cand, confidence: Number(best.sim.toFixed(2)) }); }
  }
  const missing = targetKeys.filter(t => !matched.includes(t));
  return { matched, close, missing };
}

function toNumber(x) { const n = Number(x); return isNaN(n) ? null : n; }

export function runRules(rows) {
  const flat = rows.map(flattenRecord);
  const findings = [];

  // Helper getters using best-effort aliases
  const getOne = (keys) => {
    for (const k of keys) {
      const cand = flat[0][k];
      if (cand !== undefined && cand !== '') return cand;
    }
    return undefined;
  };

  // 1) TOTALS_BALANCE
  const excl = toNumber(getOne(['invoice.total_excl_vat', 'total_excl_vat']));
  const vat = toNumber(getOne(['invoice.vat_amount', 'vat_amount']));
  const incl = toNumber(getOne(['invoice.total_incl_vat', 'total_incl_vat']));
  let ok1 = false;
  if (excl !== null && vat !== null && incl !== null) {
    ok1 = Math.abs((excl + vat) - incl) <= 0.01;
  }
  findings.push({ rule: 'TOTALS_BALANCE', ok: !!ok1 });

  // 2) LINE_MATH (check first offending line)
  let ok2 = true; let exampleLine = undefined; let expected = undefined; let got = undefined;
  // handle either nested lines[] or flat fields per-row
  const lineRows = [];
  const nested = getOne(['lines']);
  if (Array.isArray(nested) && nested.length) lineRows.push(...nested);
  else {
    // derive from rows if have qty/unit_price/line_total
    rows.forEach((r, idx) => {
      const qty = toNumber(r['lines[].qty'] ?? r['qty'] ?? r['line_qty']);
      const unit = toNumber(r['lines[].unit_price'] ?? r['unit_price']);
      const total = toNumber(r['lines[].line_total'] ?? r['line_total']);
      if (qty !== null || unit !== null || total !== null) lineRows.push({ qty, unit_price: unit, line_total: total, __row: idx+1 });
    });
  }
  for (let i = 0; i < lineRows.length; i++) {
    const L = lineRows[i];
    const qty = toNumber(L.qty);
    const unit = toNumber(L.unit_price);
    const tot = toNumber(L.line_total);
    if (qty !== null && unit !== null && tot !== null) {
      const exp = +(qty * unit).toFixed(2);
      if (Math.abs(exp - tot) > 0.01) { ok2 = false; exampleLine = L.__row || (i+1); expected = exp; got = tot; break; }
    }
  }
  const f2 = { rule: 'LINE_MATH', ok: !!ok2 };
  if (!ok2) { f2.exampleLine = exampleLine; f2.expected = expected; f2.got = got; }
  findings.push(f2);

  // 3) DATE_ISO for invoice.issue_date
  const dateVal = getOne(['invoice.issue_date', 'issue_date', 'invoice_date']);
  const ok3 = typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateVal);
  findings.push({ rule: 'DATE_ISO', ok: !!ok3 });

  // 4) CURRENCY_ALLOWED
  const curVal = (getOne(['invoice.currency', 'currency']) || '').toString().toUpperCase();
  const ok4 = allowedCurrencies.includes(curVal);
  const f4 = { rule: 'CURRENCY_ALLOWED', ok: !!ok4 };
  if (!ok4) f4.value = curVal || null;
  findings.push(f4);

  // 5) TRN_PRESENT
  const buyerTrn = getOne(['buyer.trn', 'buyer_trn', 'buyer.trn_number']);
  const sellerTrn = getOne(['seller.trn', 'seller_trn', 'seller.trn_number']);
  const ok5 = !!(buyerTrn && sellerTrn);
  findings.push({ rule: 'TRN_PRESENT', ok: !!ok5 });

  return findings;
}

export function computeScores(rows, coverage, findings, questionnaire) {
  // Data (25): rows parsed share + basic type inference success
  const rowsParsed = rows.length;
  const dataScore = Math.min(100, Math.round((rowsParsed > 0 ? 100 : 0)));

  // Coverage (35): matched required fields vs GETS, weight header/seller/buyer > lines
  const required = targetKeys.length;
  const headerKeys = targetKeys.filter(k => k.startsWith('invoice.') || k.startsWith('seller.') || k.startsWith('buyer.')).length;
  const lineKeys = targetKeys.length - headerKeys;
  const matchedHeader = coverage.matched.filter(k => k.startsWith('invoice.') || k.startsWith('seller.') || k.startsWith('buyer.')).length;
  const matchedLines = coverage.matched.length - matchedHeader;
  const cov = required ? ((matchedHeader / Math.max(1, headerKeys)) * 0.7 + (matchedLines / Math.max(1, lineKeys)) * 0.3) * 100 : 0;
  const coverageScore = Math.max(0, Math.min(100, Math.round(cov)));

  // Rules (30): 5 checks equally weighted
  const passed = findings.filter(f => f.ok).length;
  const rulesScore = Math.round((passed / 5) * 100);

  // Posture (10): simple scaling
  const p = questionnaire || {};
  const postureScore = Math.round(((p.webhooks?1:0) + (p.sandbox_env?1:0) + (p.retries?1:0)) / 3 * 100);

  // Weights
  const overall = Math.round(dataScore * 0.25 + coverageScore * 0.35 + rulesScore * 0.30 + postureScore * 0.10);

  return { data: dataScore, coverage: coverageScore, rules: rulesScore, posture: postureScore, overall };
}

export function readinessLabel(overall) {
  if (overall >= 80) return 'High';
  if (overall >= 50) return 'Medium';
  return 'Low';
}

export function analyzeRaw(rawText, options = {}) {
  const rows = parseInputString(rawText);
  const coverage = detectCoverage(rows);
  const findings = runRules(rows);
  const scores = computeScores(rows, coverage, findings, options.questionnaire || {});
  const gaps = [];
  if (coverage.missing.length) gaps.push(...coverage.missing.map(k => `Missing ${k}`));
  findings.forEach(f => {
    if (!f.ok) {
      if (f.rule === 'CURRENCY_ALLOWED') gaps.push(`Invalid currency ${f.value}`);
      if (f.rule === 'DATE_ISO') gaps.push('Invalid issue_date format');
      if (f.rule === 'LINE_MATH') gaps.push('Line total does not equal qty*unit_price');
      if (f.rule === 'TRN_PRESENT') gaps.push('Missing TRN(s)');
      if (f.rule === 'TOTALS_BALANCE') gaps.push('Totals do not balance');
    }
  });
  return { rows, coverage, findings, scores, gaps };
}
