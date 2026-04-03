#!/usr/bin/env node
'use strict';

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'start') {
  require('../src/index');
} else {
  console.log(`
  Throttle — Universal AI Cost Meter & Control Panel

  Usage:
    throttle start       Start the proxy + dashboard
    throttle help        Show this help

  Proxy:    http://localhost:4000  (point your agent here)
  Dashboard: http://localhost:4001
  `);
}
