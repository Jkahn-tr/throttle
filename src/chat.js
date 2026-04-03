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

const fmt = n => n >= 1e9 ? (n/1e9).toFixed(1)+'B' : n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : (n||0).toLocaleString();
const fmtMs = ms => ms >= 1000 ? (ms/1000).toFixed(1)+'s' : Math.round(ms||0)+'ms';

// ── Intent detection ────────────────────────────────────────────
function detectIntent(msg) {
  const m = msg.toLowerCase().trim();

  // Define reusable patterns
  const COST_WORDS = /\b(cost|spend|spending|spent|bill|billing|charge|money|dollar|\$|how much)\b/;
  const MODEL_NAMES = /\b(claude|gpt|gemini|llama|haiku|sonnet|opus|flash|turbo|mini|o3|o4)\b/;
  const SWITCH_VERBS = /\b(switch|change|use|set|move to|upgrade|downgrade|activate|enable|try)\b/;

  // "What model am I using" — check FIRST before list/switch to avoid misclassification
  if (/\b(what|which)\b/.test(m) && /\b(model|llm|ai)\b/.test(m) && /\b(using|am i|currently|active|running)\b/.test(m)) return 'current_model';
  if (/\b(model|llm)\b/.test(m) && /\b(using|running|active|current)\b/.test(m)) return 'current_model';

  // List models — explicit list/show, not a switch command
  if (/\b(list|show)\b/.test(m) && /\b(model|models|option|options|available)\b/.test(m) && !SWITCH_VERBS.test(m)) return 'list_models';
  if (/\b(available|what)\b/.test(m) && /\b(model|models|option|options)\b/.test(m) && !SWITCH_VERBS.test(m)) return 'list_models';

  // Model switch — broad pattern: "use X", "switch to X", "change to X"
  // Also catches "switch to unknownmodel" — extractModel will handle unknown gracefully
  if (SWITCH_VERBS.test(m) && (MODEL_NAMES.test(m) || /\b(model|to )\b/.test(m))) {
    return 'switch_model';
  }
  if (MODEL_NAMES.test(m) && /\b(please|now|instead)\b/.test(m)) {
    return 'switch_model';
  }

  // Cost queries — ordered by specificity
  if (/\b(week|7 day|7-day|weekly|this week|last week)\b/.test(m)) return 'cost_week';
  if (/\b(month|30 day|30-day|monthly|this month|last month)\b/.test(m)) return 'cost_month';
  if (COST_WORDS.test(m)) {
    if (/\b(model|by model|per model|breakdown)\b/.test(m)) return 'cost_models';
    return 'cost_today';
  }

  // Cache
  if (/\b(cache|cach|saving|savings|efficient|efficiency)\b/.test(m)) return 'cache';

  // What model am I using
  if (/\b(what|which|current|active)\b/.test(m) && /\b(model|llm|ai)\b/.test(m)) return 'current_model';
  if (/\b(model|llm)\b/.test(m) && /\b(using|running|active|current)\b/.test(m)) return 'current_model';

  // Budget
  if (/\b(budget|limit|remaining|left|allowance)\b/.test(m)) return 'budget';

  // Requests / traffic
  if (/\b(request|call|traffic|api|how many|count)\b/.test(m)) return 'requests';

  // Latency
  if (/\b(latency|speed|slow|fast|response time)\b/.test(m) || /how (fast|slow)/.test(m)) return 'latency';

  // Stats general
  if (/\b(stats|status|summary|report|overview)\b/.test(m) || /how.*(doing|going)/.test(m)) return 'summary';

  // Help
  if (/\b(help|what can|commands|what do)\b/.test(m)) return 'help';

  return 'unknown';
}

// ── Extract model name from message ────────────────────────────
function extractModel(msg) {
  const m = msg.toLowerCase();
  // Order matters: more specific aliases must come before generic ones
  const modelMap = {
    'gpt-4o-mini':       ['gpt-4o-mini','gpt 4o mini','4o mini','gpt4omini'],
    'claude-sonnet-4-6': ['sonnet 4.6','sonnet-4-6','claude sonnet','sonnet 4','claude 4','sonnet'],
    'claude-opus-4-6':   ['opus 4.6','opus-4-6','claude opus 4.6'],
    'claude-opus-4':     ['opus 4','claude opus','opus'],
    'claude-haiku-3-5':  ['haiku 3.5','haiku-3-5','claude haiku','haiku'],
    'claude-haiku-3':    ['haiku 3','haiku-3'],
    'gpt-4o':            ['gpt-4o ','gpt 4o ','gpt-4o,','gpt-4o.'],  // space/punct boundary to avoid matching 4o-mini
    'o3':                [' o3 ',' o3,', 'model o3'],
    'o4-mini':           ['o4-mini','o4 mini'],
    'gemini-2.0-flash':  ['gemini 2','gemini-2','gemini flash 2','gemini 2.0','flash 2'],
    'gemini-1.5-pro':    ['gemini pro','gemini-1.5-pro','gemini 1.5 pro'],
    'gemini-1.5-flash':  ['gemini flash','gemini-1.5-flash','gemini 1.5 flash'],
    'llama-3.3-70b-versatile': ['llama 3.3','llama-3.3','llama 70b','llama'],
    'llama-3.1-8b-instant':    ['llama 3.1','llama 8b','llama-3.1'],
  };
  for (const [id, aliases] of Object.entries(modelMap)) {
    if (aliases.some(a => m.includes(a))) return id;
  }
  // Try direct model ID match
  const known = Object.keys(PRICING);
  for (const id of known) {
    if (m.includes(id)) return id;
  }
  return null;
}

// ── Response generators ─────────────────────────────────────────
async function handleIntent(intent, msg) {
  switch (intent) {

    case 'cost_today': {
      const r = await db.getAsync(`SELECT COUNT(*) as calls, SUM(cost_usd) as cost, SUM(cache_read) as cr, SUM(cache_write) as cw, SUM(input_tokens) as it, SUM(output_tokens) as ot FROM requests WHERE date(ts)=date('now')`);
      const savings = ((r.cr||0) * 2.70) / 1e6;
      return `**Today's cost: $${(r.cost||0).toFixed(2)}**\n\n• ${r.calls||0} requests\n• ${fmt(r.ot||0)} output tokens / ${fmt(r.it||0)} input tokens\n• ${fmt(r.cr||0)} tokens served from cache\n• Cache saving you **$${savings.toFixed(2)}** vs. full pricing`;
    }

    case 'cost_week': {
      const r = await db.getAsync(`SELECT COUNT(*) as calls, SUM(cost_usd) as cost FROM requests WHERE ts >= datetime('now','-7 days')`);
      return `**This week: $${(r.cost||0).toFixed(2)}** across ${r.calls||0} requests.`;
    }

    case 'cost_month': {
      const r = await db.getAsync(`SELECT COUNT(*) as calls, SUM(cost_usd) as cost FROM requests WHERE ts >= datetime('now','-30 days')`);
      const daily = (r.cost||0) / 30;
      return `**Last 30 days: $${(r.cost||0).toFixed(2)}** across ${r.calls||0} requests.\n\nAverage daily burn: $${daily.toFixed(2)}/day\nProjected monthly: ~$${(daily*30).toFixed(0)}`;
    }

    case 'cost_models': {
      const rows = await db.allAsync(`SELECT model, SUM(cost_usd) as cost, COUNT(*) as calls FROM requests WHERE ts >= datetime('now','-30 days') GROUP BY model ORDER BY cost DESC LIMIT 6`);
      if (!rows.length) return 'No model cost data yet.';
      const lines = rows.map(r => `• **${r.model}**: $${(r.cost||0).toFixed(2)} (${r.calls} calls)`);
      return `**Cost by model — last 30 days:**\n\n${lines.join('\n')}`;
    }

    case 'cache': {
      const r = await db.getAsync(`SELECT SUM(cache_read) as cr, SUM(cache_write) as cw, SUM(input_tokens) as it, SUM(cost_usd) as cost FROM requests WHERE date(ts)=date('now')`);
      const total = (r.cr||0) + (r.cw||0) + (r.it||0);
      const hitRate = total ? ((r.cr||0)/total*100).toFixed(0) : 0;
      const savings = ((r.cr||0) * 2.70) / 1e6;
      return `**Cache hit rate today: ${hitRate}%**\n\n• ${fmt(r.cr||0)} tokens from cache\n• ${fmt(r.cw||0)} tokens written to cache\n• Saving **$${savings.toFixed(2)}** vs. full input pricing today`;
    }

    case 'switch_model': {
      const target = extractModel(msg);
      if (!target) {
        const known = ['claude-sonnet-4-6','claude-haiku-3-5','claude-opus-4','gpt-4o','gpt-4o-mini','gemini-2.0-flash','llama-3.3-70b-versatile'];
        return `I couldn't identify which model you want. Try:\n\n${known.map(m=>`• ${m}`).join('\n')}\n\nExample: "switch to haiku" or "use gpt-4o-mini"`;
      }
      await setConfig('active_model', target);
      const p = PRICING[target] || {};
      return `✅ **Switched to ${target}**\n\nPricing: $${p.input||'?'}/M input · $${p.output||'?'}/M output${p.cacheRead ? ` · cache supported ✓` : ''}`;
    }

    case 'current_model': {
      const model = await getConfig('active_model');
      const p = PRICING[model] || {};
      return `**Active model: ${model || 'not set'}**\n\nPricing: $${p.input||'?'}/M input · $${p.output||'?'}/M output`;
    }

    case 'budget': {
      const budget = parseFloat(await getConfig('daily_budget') || 50);
      const r = await db.getAsync(`SELECT SUM(cost_usd) as spent FROM requests WHERE date(ts)=date('now')`);
      const spent = r.spent || 0;
      const remaining = Math.max(0, budget - spent);
      const pct = (spent/budget*100).toFixed(0);
      return `**Daily budget: $${budget}**\n\n• Spent today: $${spent.toFixed(2)} (${pct}%)\n• Remaining: $${remaining.toFixed(2)}\n\nTo change your budget: "set daily budget to $100"`;
    }

    case 'requests': {
      const r = await db.getAsync(`SELECT COUNT(*) as calls, AVG(latency_ms) as lat FROM requests WHERE date(ts)=date('now')`);
      const week = await db.getAsync(`SELECT COUNT(*) as calls FROM requests WHERE ts >= datetime('now','-7 days')`);
      return `**Requests today: ${r.calls||0}**\n\n• This week: ${week.calls||0}\n• Avg latency: ${fmtMs(r.lat||0)}`;
    }

    case 'latency': {
      const r = await db.getAsync(`SELECT AVG(latency_ms) as avg_lat, MIN(latency_ms) as min_lat, MAX(latency_ms) as max_lat FROM requests WHERE date(ts)=date('now')`);
      return `**Latency today:**\n\n• Average: ${fmtMs(r.avg_lat)}\n• Fastest: ${fmtMs(r.min_lat)}\n• Slowest: ${fmtMs(r.max_lat)}`;
    }

    case 'summary': {
      const today = await db.getAsync(`SELECT COUNT(*) as calls, SUM(cost_usd) as cost, AVG(latency_ms) as lat, SUM(cache_read) as cr, SUM(input_tokens)+SUM(output_tokens)+SUM(cache_read)+SUM(cache_write) as total FROM requests WHERE date(ts)=date('now')`);
      const model = await getConfig('active_model');
      const hitRate = today.total ? ((today.cr||0)/today.total*100).toFixed(0) : 0;
      const savings = ((today.cr||0) * 2.70) / 1e6;
      return `**Throttle Summary — Today**\n\n• Active model: **${model}**\n• Requests: ${today.calls||0}\n• Cost: **$${(today.cost||0).toFixed(2)}**\n• Cache hit rate: ${hitRate}%\n• Cache savings: $${savings.toFixed(2)}\n• Avg latency: ${fmtMs(today.lat)}`;
    }

    case 'list_models': {
      const byProvider = {};
      for (const [id, p] of Object.entries(PRICING)) {
        const prov = id.startsWith('claude') ? 'Anthropic' : id.startsWith('gpt')||id.startsWith('o3')||id.startsWith('o4') ? 'OpenAI' : id.startsWith('gemini') ? 'Google' : 'Groq/Other';
        if (!byProvider[prov]) byProvider[prov] = [];
        byProvider[prov].push(`${id} ($${p.input}/M in)`);
      }
      const lines = Object.entries(byProvider).map(([p,ms]) => `**${p}**\n${ms.map(m=>`• ${m}`).join('\n')}`);
      return `**Available models:**\n\n${lines.join('\n\n')}\n\nSay "switch to [model name]" to change.`;
    }

    case 'help': {
      return `**Throttle Chat — what you can ask:**\n\n📊 **Costs**\n• "What am I spending today?"\n• "Show me this week's costs"\n• "Cost breakdown by model"\n\n🧠 **Models**\n• "What model am I using?"\n• "Switch to claude haiku"\n• "Use gpt-4o-mini"\n• "List available models"\n\n⚡ **Stats**\n• "How many requests today?"\n• "What's my cache hit rate?"\n• "Show me a summary"\n• "What's my budget?"\n\n💡 You can also ask me (Inigo) these questions in Telegram and I'll query Throttle for you.`;
    }

    default:
      return `I didn't quite catch that. Try asking:\n• "What am I spending today?"\n• "Switch to claude haiku"\n• "Show me a summary"\n• "Help" for all commands`;
  }
}

function registerChat(app) {
  app.post('/api/chat', express.json(), async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    try {
      const intent = detectIntent(message);
      const response = await handleIntent(intent, message);
      res.json({ response, intent });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

// Export for use by OpenClaw / Inigo
module.exports = { registerChat, detectIntent, handleIntent };
