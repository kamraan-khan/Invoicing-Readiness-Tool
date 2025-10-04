import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import pkg from 'pg';

const isPg = !!process.env.DATABASE_URL;

let db; // sqlite Database instance
let pool; // pg Pool

if (!isPg) {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'app.db');
  sqlite3.verbose();
  db = new sqlite3.Database(dbPath);
} else {
  const { Pool } = pkg;
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : undefined });
}

export function initDb() {
  if (!isPg) {
    db.serialize(() => {
      db.run(`CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        country TEXT,
        erp TEXT,
        rows_parsed INTEGER,
        raw TEXT
      )`);

      db.run(`CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        upload_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        scores_overall INTEGER,
        report_json TEXT NOT NULL,
        expires_at TEXT
      )`);

      db.run(`CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at)`);
    });
  } else {
    const q = async (sql) => { await pool.query(sql); };
    q(`CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      country TEXT,
      erp TEXT,
      rows_parsed INTEGER,
      raw TEXT
    )`);
    q(`CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      upload_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      scores_overall INTEGER,
      report_json TEXT NOT NULL,
      expires_at TEXT
    )`);
    q(`CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at)`);
  }
}

export function run(sql, params = []) {
  if (!isPg) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  } else {
    const { text, values } = toPg(sql, params);
    return pool.query(text, values);
  }
}

export function get(sql, params = []) {
  if (!isPg) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, function (err, row) {
        if (err) reject(err);
        else resolve(row);
      });
    });
  } else {
    const { text, values } = toPg(sql, params);
    return pool.query(text, values).then(r => r.rows[0]);
  }
}

export function all(sql, params = []) {
  if (!isPg) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, function (err, rows) {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  } else {
    const { text, values } = toPg(sql, params);
    return pool.query(text, values).then(r => r.rows);
  }
}

function toPg(sql, params) {
  let i = 0;
  const text = sql.replace(/\?/g, () => `$${++i}`);
  return { text, values: params };
}
