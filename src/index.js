'use strict';

const express = require('express');
const path = require('path');
const chalk = require('chalk');

const db = require('./db');
const { createProxy } = require('./proxy');
const { registerAPI } = require('./api');

const getConfig = k => { const r = db.prepare('SELECT value FROM config WHERE key=?').get(k); return r?.value; };
const PROXY_PORT = parseInt(getConfig('proxy_port') || 4000);
const DASH_PORT  = parseInt(getConfig('dashboard_port') || 4001);

// ── PROXY SERVER ──────────────────────────────────────────────
const proxyApp = express();
proxyApp.use(express.raw({ type: '*/*', limit: '50mb' }));
createProxy(proxyApp);

proxyApp.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(chalk.gray('  Proxy:     ') + chalk.cyan(`http://localhost:${PROXY_PORT}`));
});

// ── DASHBOARD SERVER ──────────────────────────────────────────
const dashApp = express();
dashApp.use(express.json());
dashApp.use(express.static(path.join(__dirname, '../public')));
registerAPI(dashApp);

// Fallback to index.html for SPA
dashApp.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

dashApp.listen(DASH_PORT, '127.0.0.1', () => {
  console.log(chalk.gray('  Dashboard: ') + chalk.cyan(`http://localhost:${DASH_PORT}`));
  console.log('');

  // Auto-open dashboard
  try {
    const open = require('open');
    open(`http://localhost:${DASH_PORT}`);
  } catch {}
});

console.log('');
console.log(chalk.bold('  ⚡ Throttle') + chalk.gray(' — AI Cost Meter & Control Panel'));
console.log('');
console.log(chalk.gray('  Point your agent at the proxy instead of the provider URL.'));
console.log(chalk.gray('  Example: use http://localhost:') + chalk.cyan(PROXY_PORT) + chalk.gray(' as your base URL.'));
console.log('');
