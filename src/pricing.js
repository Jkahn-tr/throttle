'use strict';

// Prices per 1M tokens (USD)
const PRICING = {
  // Anthropic
  'claude-opus-4':          { input: 15.00, output: 75.00, cacheRead: 1.50,  cacheWrite: 18.75 },
  'claude-sonnet-4-6':      { input: 3.00,  output: 15.00, cacheRead: 0.30,  cacheWrite: 3.75  },
  'claude-sonnet-4':        { input: 3.00,  output: 15.00, cacheRead: 0.30,  cacheWrite: 3.75  },
  'claude-haiku-3-5':       { input: 0.80,  output: 4.00,  cacheRead: 0.08,  cacheWrite: 1.00  },
  'claude-haiku-3':         { input: 0.25,  output: 1.25,  cacheRead: 0.03,  cacheWrite: 0.30  },
  // OpenAI
  'gpt-4o':                 { input: 2.50,  output: 10.00, cacheRead: 1.25,  cacheWrite: 0     },
  'gpt-4o-mini':            { input: 0.15,  output: 0.60,  cacheRead: 0.075, cacheWrite: 0     },
  'o3':                     { input: 10.00, output: 40.00, cacheRead: 5.00,  cacheWrite: 0     },
  'o4-mini':                { input: 1.10,  output: 4.40,  cacheRead: 0.275, cacheWrite: 0     },
  'gpt-4-turbo':            { input: 10.00, output: 30.00, cacheRead: 5.00,  cacheWrite: 0     },
  // Google
  'gemini-2.0-flash':       { input: 0.10,  output: 0.40,  cacheRead: 0.025, cacheWrite: 0     },
  'gemini-1.5-pro':         { input: 1.25,  output: 5.00,  cacheRead: 0.3125,cacheWrite: 0     },
  'gemini-1.5-flash':       { input: 0.075, output: 0.30,  cacheRead: 0.01875,cacheWrite: 0    },
  // Groq
  'llama-3.3-70b-versatile':{ input: 0.59,  output: 0.79,  cacheRead: 0,     cacheWrite: 0     },
  'llama-3.1-8b-instant':   { input: 0.05,  output: 0.08,  cacheRead: 0,     cacheWrite: 0     },
  'mixtral-8x7b-32768':     { input: 0.24,  output: 0.24,  cacheRead: 0,     cacheWrite: 0     },
};

function calcCost(model, input, output, cacheRead = 0, cacheWrite = 0) {
  if (!model) return 0;
  const m = model.toLowerCase();
  // Try exact match first
  let key = Object.keys(PRICING).find(k => k === m);
  // Then prefix match (longer keys first to avoid 'gpt-4o' matching 'gpt-4o-mini')
  if (!key) {
    const sorted = Object.keys(PRICING).sort((a,b) => b.length - a.length);
    key = sorted.find(k => m.startsWith(k) || m.includes(k));
  }
  const p = PRICING[key] || { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 };
  return (
    (input * p.input / 1e6) +
    (output * p.output / 1e6) +
    (cacheRead * p.cacheRead / 1e6) +
    (cacheWrite * p.cacheWrite / 1e6)
  );
}

function getPricing(model) {
  const key = Object.keys(PRICING).find(k => model && model.toLowerCase().includes(k.replace(/-/g,'').replace(/\./g,'')));
  return PRICING[key] || null;
}

module.exports = { PRICING, calcCost, getPricing };
