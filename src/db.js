'use strict';
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const os = require('os');
const fs = require('fs');

const DIR = path.join(os.homedir(), '.throttle');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const db = new sqlite3.Database(path.join(DIR, 'throttle.db'));

// Promisify helpers
db.runAsync = (sql, params=[]) => new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this); }));
db.getAsync  = (sql, params=[]) => new Promise((res, rej) => db.get(sql, params, (err,row) => err ? rej(err) : res(row)));
db.allAsync  = (sql, params=[]) => new Promise((res, rej) => db.all(sql, params, (err,rows) => err ? rej(err) : res(rows)));

// Init schema
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read INTEGER DEFAULT 0,
    cache_write INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    latency_ms INTEGER DEFAULT 0,
    status INTEGER DEFAULT 200,
    error TEXT
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ts ON requests(ts)`);
  db.run(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`);

  const defaults = {
    proxy_port: '4000', dashboard_port: '4001',
    active_provider: 'anthropic', active_model: 'claude-sonnet-4-6',
    daily_budget: '50', alert_threshold: '80',
  };
  const stmt = db.prepare('INSERT OR IGNORE INTO config(key,value) VALUES(?,?)');
  for (const [k,v] of Object.entries(defaults)) stmt.run(k, v);
  stmt.finalize();
});

module.exports = db;
