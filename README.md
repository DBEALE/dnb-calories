# FitnessHealth — Calorie Tracker

A privacy-first, offline-capable calorie and nutrition tracker with AI food scanning.

- **Live:** https://www.fitnesshealth.app
- **GitHub Pages:** https://dbeale.github.io/dnb-calories

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Single-page HTML/JS app (no framework) |
| Backend / AI proxy | Cloudflare Worker (`worker/`) |
| Database | Cloudflare D1 (SQLite) |
| Sync | Custom offline-first sync via D1 |
| Hosting | Cloudflare Workers Assets |

---

## AI Models

### 📸 Label scan
**Cost: ~$0.00033 / scan**

| Step | Model | Role |
|---|---|---|
| 1 | `openai/gpt-4o-mini` | Detect label vs photo, extract all nutrition values from label |

### 📷 Food photo scan
**Cost: ~$0.00060 / scan**

| Step | Model | Role |
|---|---|---|
| 1 | `openai/gpt-4o-mini` | Detect whether image is a label or a food photo |
| 2 | `google/gemini-2.0-flash-001` | Identify the food and return a confidence score (0–1) |
| 3 | `openai/gpt-4o-mini` | Calculate nutrition from identified food name (temperature 0 for consistency) |

If identification returns no result, falls back to direct Gemini Flash estimation.

### 🔄 Re-analyse (user-confirmed name)
**Cost: ~$0.00015 / scan**

| Step | Model | Role |
|---|---|---|
| 1 | `openai/gpt-4o-mini` | Calculate nutrition from user-confirmed food name (temperature 0, confidence 92%) |

Image is not used — the name is treated as ground truth. Values are deterministic.

### 💡 Daily insight
**Cost: Free**

Tries these models in order, using the first successful response:
1. `deepseek/deepseek-v4-flash:free`
2. `google/gemma-4-31b-it:free`
3. `nvidia/nemotron-3-super-120b-a12b:free`
4. `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`

Prompt is time-aware (compares intake to expected for the hour, not full daily target).

### 🎯 Calorie target
**Cost: Free**

Tries these models in order:
1. `deepseek/deepseek-v4-flash:free`
2. `google/gemma-4-31b-it:free`
3. `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`

Falls back to a deterministic maths-based calculation if all models fail.

---

## Deploy

### Prerequisites

```bash
npm install -g wrangler
wrangler login
```

### First-time D1 setup

```bash
# Create the database
wrangler d1 create calorie-tracker-sync

# Paste the returned database_id into worker/wrangler.toml

# Apply all schema migrations
wrangler d1 execute calorie-tracker-sync --file=worker/schema.sql --remote
wrangler d1 execute calorie-tracker-sync --file=worker/migrate_usage.sql --remote
wrangler d1 execute calorie-tracker-sync --file=worker/migrate_suggestions.sql --remote
wrangler d1 execute calorie-tracker-sync --file=worker/migrate_settings.sql --remote
```

### Secrets

```bash
wrangler secret put OPENROUTER_API_KEY --config worker/wrangler.toml
wrangler secret put ADMIN_TOKEN --config worker/wrangler.toml   # use your sync key
wrangler secret put GOOGLE_VISION_API_KEY --config worker/wrangler.toml  # optional, unused
```

### Deploy the worker

```bash
npm run deploy
# or: wrangler deploy --config worker/wrangler.toml
```

### Deploy the static site

```bash
wrangler deploy   # uses wrangler.jsonc at repo root
```

---

## D1 Tables

| Table | Purpose |
|---|---|
| `food_entries` | User food logs, synced per token |
| `weight_entries` | Weight logs, synced per token |
| `favourites` | Saved meals, synced per token |
| `profile` | User profile & settings, synced per token |
| `usage` | AI call log (token, endpoint, model, timestamp) |
| `suggestions` | User-submitted feature suggestions |
| `settings` | Admin-configurable values (quota_requests, quota_period) |

---

## Admin screen

Access by tapping the build number **5 times** in Settings → About. Requires the `ADMIN_TOKEN` secret to match your current sync key.

Shows: user count, record counts, AI usage by endpoint/model with cost estimates, quota configuration, suggestions inbox, and model pipeline reference.

---

## Quota

Default: 100 AI requests per month per user. Configurable from the admin screen. The admin token is always exempt. When a user exceeds their quota, AI endpoints return `429` and the app shows a clear message directing them to manual entry.
