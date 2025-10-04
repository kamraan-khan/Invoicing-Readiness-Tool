import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { initDb, run, get, all } from './db.js';
import { analyzeRaw, readinessLabel } from './analyze.js';

export const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }));

// In serverless, static is served by the platform; in local dev, server.js also serves /public

initDb();

function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

// POST /upload
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    let text = '';
    let country = req.body.country || null;
    let erp = req.body.erp || null;
    if (req.is('application/json') && req.body && req.body.text) {
      text = String(req.body.text);
      country = req.body.country || country;
      erp = req.body.erp || erp;
    } else if (req.file) {
      text = req.file.buffer.toString('utf-8');
    } else if (typeof req.body === 'string') {
      text = req.body;
    } else {
      return res.status(400).json({ error: 'No input provided' });
    }

    const uploadId = newId('u');
    const { parseInputString } = await import('./parser.js');
    const rowsParsed = parseInputString(text).length;

    const created_at = new Date().toISOString();
    await run(
      'INSERT INTO uploads (id, created_at, country, erp, rows_parsed, raw) VALUES (?, ?, ?, ?, ?, ?)',
      [uploadId, created_at, country, erp, rowsParsed, text]
    );
    return res.json({ uploadId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'UPLOAD_FAILED' });
  }
});

// POST /analyze
app.post('/analyze', async (req, res) => {
  try {
    const { uploadId, questionnaire } = req.body || {};
    if (!uploadId) return res.status(400).json({ error: 'MISSING_UPLOAD_ID' });
    const row = await get('SELECT * FROM uploads WHERE id = ?', [uploadId]);
    if (!row) return res.status(404).json({ error: 'UPLOAD_NOT_FOUND' });

    const { rows, coverage, findings, scores, gaps } = analyzeRaw(row.raw, { questionnaire });
    const reportId = newId('r');
    const created_at = new Date().toISOString();
    const report = {
      reportId,
      scores,
      coverage,
      ruleFindings: findings,
      gaps,
      readiness: readinessLabel(scores.overall),
      meta: {
        rowsParsed: rows.length,
        linesTotal: rows.reduce((acc, r) => acc + (Array.isArray(r.lines) ? r.lines.length : 0), 0),
        country: row.country || null,
        erp: row.erp || null,
        db: process.env.DATABASE_URL ? 'postgres' : 'sqlite'
      }
    };

    await run(
      'INSERT INTO reports (id, upload_id, created_at, scores_overall, report_json, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [reportId, uploadId, created_at, scores.overall, JSON.stringify(report), new Date(Date.now() + 7*24*3600*1000).toISOString()]
    );

    return res.json(report);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'ANALYZE_FAILED' });
  }
});

// GET /report/:id
app.get('/report/:id', async (req, res) => {
  try {
    const rid = req.params.id;
    const row = await get('SELECT report_json FROM reports WHERE id = ?', [rid]);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    res.setHeader('Content-Type', 'application/json');
    return res.send(row.report_json);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'REPORT_FAILED' });
  }
});

// P1: GET /reports
app.get('/reports', async (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit || '10', 10));
  try {
    const rows = await all('SELECT id, created_at, scores_overall FROM reports ORDER BY created_at DESC LIMIT ?', [limit]);
    return res.json(rows.map(r => ({ id: r.id, createdAt: r.created_at, overall: r.scores_overall })));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'LIST_FAILED' });
  }
});
