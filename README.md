# ⚡ Throttle

**Universal AI cost meter and model control panel — self-hosted.**

Works with every LLM: OpenAI, Anthropic, Google Gemini, Groq, Ollama, LM Studio, and any OpenAI-compatible endpoint.

---

## What it does

- **Cost meter** — see exactly what you're spending per day, per model, per request
- **Cache efficiency** — track how much cache is saving you vs. full pricing
- **Model switcher** — change your active model from a dashboard, no config file editing
- **Budget alerts** — set a daily limit, get warned before you overshoot
- **Request log** — every request logged with tokens, cost, latency, and status
- **Fully local** — no data leaves your machine, no account required

---

## Install

```bash
npm install -g throttle-ai
throttle start
```

- **Proxy:** `http://localhost:4000` — point your agent here
- **Dashboard:** `http://localhost:4001` — opens automatically

---

## How it works

Throttle runs a lightweight proxy between your agent and any LLM provider. You change one URL in your agent's config:

**Before:**
```
ANTHROPIC_BASE_URL=https://api.anthropic.com
```

**After:**
```
ANTHROPIC_BASE_URL=http://localhost:4000
```

Throttle forwards all requests unchanged, logs token counts and costs, and serves a live dashboard.

---

## Supported providers

| Provider | Models |
|---|---|
| Anthropic | claude-opus-4, claude-sonnet-4-6, claude-haiku-3-5, + more |
| OpenAI | gpt-4o, gpt-4o-mini, o3, o4-mini, gpt-4-turbo |
| Google | gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash |
| Groq | llama-3.3-70b, llama-3.1-8b, mixtral-8x7b |
| Ollama | Any locally running model |
| LM Studio | Any locally running model |
| OpenRouter | Any model via OpenRouter |
| Custom | Any OpenAI-compatible endpoint |

---

## Data & privacy

All data is stored locally in `~/.throttle/throttle.db` (SQLite). Nothing is sent anywhere. No account, no telemetry, no cloud.

---

## License

MIT — use it, fork it, ship it.
