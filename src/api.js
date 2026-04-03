'use strict';
const express = require('express');
const db = require('./db');
const { PRICING } = require('./pricing');

async function getConfig(key) {
  const row = await db.getAsync('SELECT value FROM config WHERE key=?', [key]);
  return row ? row.value : null;
}
async function setConfig(key, value) {
  await db.runAsync('INSERT OR REPLACE INTO config(key,value) VALUES(?,?)', [key, String(value)]);
}

const { registerChat } = require('./chat');

function registerAPI(app) {
  registerChat(app);

  app.get('/api/stats/daily', async (req, res) => {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days || 30) || 30)); // cap 1-365
    const rows = await db.allAsync(`
      SELECT date(ts) as day, COUNT(*) as calls,
        SUM(input_tokens) as input, SUM(output_tokens) as output,
        SUM(cache_read) as cache_read, SUM(cache_write) as cache_write,
        SUM(cost_usd) as cost, AVG(latency_ms) as avg_latency
      FROM requests
      WHERE ts >= datetime('now', '-' || ? || ' days')
      GROUP BY date(ts) ORDER BY day DESC`, [days]);
    const result = rows.map(r => ({
      ...r,
      cache_savings: ((r.cache_read || 0) * 2.70) / 1e6
    }));
    res.json(result);
  });

  app.get('/api/stats/today', async (req, res) => {
    const row = await db.getAsync(`
      SELECT COUNT(*) as calls,
        SUM(input_tokens) as input, SUM(output_tokens) as output,
        SUM(cache_read) as cache_read, SUM(cache_write) as cache_write,
        SUM(cost_usd) as cost, AVG(latency_ms) as avg_latency
      FROM requests WHERE date(ts) = date('now')`);
    res.json({ ...row, cache_savings: ((row.cache_read || 0) * 2.70) / 1e6 });
  });

  app.get('/api/stats/models', async (req, res) => {
    const rows = await db.allAsync(`
      SELECT model, COUNT(*) as calls,
        SUM(input_tokens) as input, SUM(output_tokens) as output, SUM(cost_usd) as cost
      FROM requests WHERE ts >= datetime('now','-30 days')
      GROUP BY model ORDER BY cost DESC`);
    res.json(rows);
  });

  app.get('/api/stats/recent', async (req, res) => {
    const rows = await db.allAsync(`
      SELECT id,ts,provider,model,input_tokens,output_tokens,cost_usd,latency_ms,status,error
      FROM requests ORDER BY id DESC LIMIT 50`);
    res.json(rows);
  });

  app.get('/api/config', async (req, res) => {
    const rows = await db.allAsync('SELECT key,value FROM config');
    const cfg = {};
    rows.forEach(r => cfg[r.key] = r.value);
    res.json(cfg);
  });

  // Config key allowlist — prevents arbitrary DB writes
  const CONFIG_ALLOWLIST = new Set([
    'proxy_port','dashboard_port','active_provider','active_model',
    'daily_budget','alert_threshold','custom_endpoint',
    'anthropic_key','openai_key','google_key','groq_key',
    'ollama_endpoint','lmstudio_endpoint',
  ]);

  app.patch('/api/config', express.json(), async (req, res) => {
    const rejected = [];
    for (const [k, v] of Object.entries(req.body)) {
      if (!CONFIG_ALLOWLIST.has(k)) { rejected.push(k); continue; }
      await setConfig(k, v);
    }
    res.json({ ok: true, rejected: rejected.length ? rejected : undefined });
  });

  app.get('/api/models', (req, res) => {
    const models = Object.entries(PRICING).map(([id, p]) => ({
      id,
      provider: id.startsWith('claude') ? 'anthropic' :
                id.startsWith('gpt')||id.startsWith('o3')||id.startsWith('o4') ? 'openai' :
                id.startsWith('gemini') ? 'google' :
                id.startsWith('llama')||id.startsWith('mixtral') ? 'groq' : 'other',
      input_per_m: p.input, output_per_m: p.output, has_cache: p.cacheRead > 0,
    }));
    res.json(models);
  });

  app.get('/api/budget/status', async (req, res) => {
    const budget = parseFloat(await getConfig('daily_budget') || 50);
    const threshold = parseFloat(await getConfig('alert_threshold') || 80);
    const row = await db.getAsync(`SELECT SUM(cost_usd) as spent FROM requests WHERE date(ts)=date('now')`);
    const spent = row.spent || 0;
    const pct = (spent / budget) * 100;
    res.json({ budget, spent, remaining: Math.max(0,budget-spent), pct: Math.min(100,pct), alert: pct>=threshold, threshold });
  });
}

module.exports = { registerAPI };
