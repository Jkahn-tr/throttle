'use strict';
const fetch = require('node-fetch');
const url = require('url');
const db = require('./db');
const { calcCost } = require('./pricing');

// Allowlisted upstream hostnames — prevents SSRF
const ALLOWED_UPSTREAM_HOSTS = new Set([
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'api.groq.com',
  'openrouter.ai',
  'localhost',
  '127.0.0.1',
]);

function isSafeUpstreamUrl(rawUrl) {
  try {
    const parsed = new url.URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    // Allow localhost and allowlisted hosts
    if (ALLOWED_UPSTREAM_HOSTS.has(host)) return true;
    // Allow custom subdomains of known providers
    const knownDomains = ['anthropic.com','openai.com','googleapis.com','groq.com','openrouter.ai'];
    if (knownDomains.some(d => host.endsWith('.' + d))) return true;
    return false;
  } catch { return false; }
}

const PROVIDER_URLS = {
  anthropic:  'https://api.anthropic.com',
  openai:     'https://api.openai.com',
  google:     'https://generativelanguage.googleapis.com',
  groq:       'https://api.groq.com/openai',
  ollama:     'http://localhost:11434',
  openrouter: 'https://openrouter.ai/api',
};

async function getConfig(key) {
  const row = await db.getAsync('SELECT value FROM config WHERE key=?', [key]);
  return row ? row.value : null;
}

function detectProvider(path) {
  if (path.includes('/messages')) return 'anthropic';
  return 'openai';
}

function createProxy(app) {
  app.all('*', async (req, res) => {
    const start = Date.now();
    const provider = detectProvider(req.path);
    const customEndpoint = await getConfig('custom_endpoint');
    // Custom endpoint ALWAYS overrides provider URL when set — this is the SSRF risk vector
    const resolvedProviderUrl = PROVIDER_URLS[provider] || 'https://api.openai.com';
    const baseUrl = (customEndpoint && customEndpoint.trim()) ? customEndpoint.trim() : resolvedProviderUrl;

    // SSRF protection: validate the final resolved upstream URL against allowlist
    if (!isSafeUpstreamUrl(baseUrl)) {
      console.warn(`[throttle] SSRF blocked: ${baseUrl}`);
      return res.status(400).json({ error: { message: `Upstream host not allowed: ${baseUrl}. Only known LLM provider hosts are permitted.` } });
    }

    const targetUrl = `${baseUrl}${req.path}`;

    let model = await getConfig('active_model') || 'unknown';
    let bodyBuf = req.body;
    if (!Buffer.isBuffer(bodyBuf)) bodyBuf = Buffer.from('');

    try {
      const bodyStr = bodyBuf.toString();
      if (bodyStr) {
        const parsed = JSON.parse(bodyStr);
        if (parsed.model) model = parsed.model;
      }
    } catch {}

    const fwdHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === 'host' || k === 'content-length') continue;
      fwdHeaders[k] = v;
    }

    let status = 200, errorMsg = null;
    let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheWrite = 0;

    try {
      const upstreamRes = await fetch(targetUrl, {
        method: req.method,
        headers: fwdHeaders,
        body: bodyBuf.length ? bodyBuf : undefined,
      });
      status = upstreamRes.status;

      for (const [k, v] of upstreamRes.headers.entries()) {
        if (k === 'content-encoding' || k === 'transfer-encoding') continue;
        try { res.setHeader(k, v); } catch {}
      }
      res.status(status);

      const respBuf = await upstreamRes.buffer();
      try {
        const obj = JSON.parse(respBuf.toString());
        const u = obj.usage || {};
        inputTokens = u.input_tokens || u.prompt_tokens || 0;
        outputTokens = u.output_tokens || u.completion_tokens || 0;
        cacheRead = u.cache_read_input_tokens || 0;
        cacheWrite = u.cache_creation_input_tokens || 0;
        if (obj.model) model = obj.model;
      } catch {}

      res.send(respBuf);
    } catch (err) {
      status = 502;
      errorMsg = err.message;
      if (!res.headersSent) res.status(502).json({ error: { message: 'Upstream request failed. Check provider URL and API key.' } });
    }

    const latency = Date.now() - start;
    const cost = calcCost(model, inputTokens, outputTokens, cacheRead, cacheWrite);
    db.runAsync(
      `INSERT INTO requests (ts,provider,model,input_tokens,output_tokens,cache_read,cache_write,cost_usd,latency_ms,status,error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [new Date().toISOString(), provider, model, inputTokens, outputTokens, cacheRead, cacheWrite, cost, latency, status, errorMsg]
    ).catch(() => {});
  });
}

module.exports = { createProxy };
