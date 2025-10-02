# GETS Readiness & Gap Analyzer

A full-stack web tool to assess e‑invoicing data against a mock GETS v0.1 schema.

- Backend: Node.js + Express + SQLite (durable persistence)
- Frontend: Static HTML/CSS/JS served by Express
- Persistence: reports stored in SQLite for ≥7 days

## Run locally

1) Install Node.js 18+
2) Install deps:
```
npm install
```
3) Start server:
```
npm start
```
Open http://localhost:3000

## API
- POST /upload
  - Multipart: file=CSV/JSON
  - OR JSON: { "text":"<CSV or JSON>", "country":"UAE", "erp":"SAP" }
  - Response: { "uploadId":"u_xxx" }
- POST /analyze
  - Body: { "uploadId":"u_xxx", "questionnaire": { "webhooks":true, "sandbox_env":true, "retries":false } }
  - Response: Report JSON with `reportId`
- GET /report/:reportId
  - Response: Report JSON from datastore
- (P1) GET /reports?limit=10
  - Recent summaries

## Scoring Weights
All scores are integers 0–100.
- Data (25%): rows parsed (>0 => 100, else 0)
- Coverage (35%): header/seller/buyer weighted 70%, lines 30%. Score = (matched_header/header_total*0.7 + matched_lines/line_total*0.3) * 100
- Rules (30%): equally weighted across 5 checks
- Posture (10%): (webhooks + sandbox_env + retries)/3 * 100
- Overall: 0.25*Data + 0.35*Coverage + 0.30*Rules + 0.10*Posture

Readiness label:
- High: overall ≥ 80
- Medium: 50–79
- Low: < 50

## Rules Implemented
1. TOTALS_BALANCE: total_excl_vat + vat_amount == total_incl_vat (±0.01)
2. LINE_MATH: line_total == qty * unit_price (±0.01); returns exampleLine/expected/got
3. DATE_ISO: invoice.issue_date matches YYYY-MM-DD
4. CURRENCY_ALLOWED: currency ∈ [AED, SAR, MYR, USD]; returns value when false
5. TRN_PRESENT: buyer.trn and seller.trn non-empty

## Field Detection & Coverage
- Normalize: lowercase, strip spaces/underscores
- Similarity: exact/startsWith/contains or edit distance (basic), type-agnostic with simple gating
- Coverage sections: matched, close (with confidence), missing

## Limits & Performance
- Cap parsing at first 200 rows
- File size limit: 5MB
- Analyzes provided samples in ≤5s

## Structure
- `src/server.js` Express server & endpoints
- `src/db.js` SQLite init/wrappers (db file under `data/app.db`)
- `src/parser.js` CSV/JSON parsing & type inference
- `src/analyze.js` coverage detection, rules, scoring
- `public/` UI (3-step wizard, preview, results)
- `data/` schema and samples

## Samples
- `data/sample_clean.json` — mostly passes
- `data/sample_flawed.csv` — invalid currency/date and line-math error

## DB
- `meta.db` value in reports: "sqlite"
- Tables: `uploads`, `reports` (stores full report JSON + expires_at ~7 days)
