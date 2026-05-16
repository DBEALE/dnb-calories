/**
 * Calorie Tracker - Nutrition Extraction Worker
 * Receives nutrition screenshots, extracts data via OpenRouter API
 */

interface ExtractRequest {
  image_base64: string;
  filename: string;
  meal_type: string;
  date: string;
  food_description?: string;
}

interface ExtractResponse {
  image_type: 'label' | 'food_photo';
  food_name: string | null;
  brand: string | null;
  serving_size_text: string | null;
  servings: number;
  per_pack: boolean;
  calories_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  sugar_g: number | null;
  salt_g: number | null;
  fibre_g: number | null;
  confidence: number;
  warnings: string[];
}

const ALLOWED_ORIGINS = new Set([
  'https://fitnesshealth.app',
  'https://www.fitnesshealth.app',
  'https://dnb-calories.pages.dev',
  'https://dbeale.github.io',
]);

function getCors(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://fitnesshealth.app';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

interface SyncRequest {
  token: string;
  since: string;
  foodEntries: any[];
  weightEntries: any[];
  favourites: any[];
  profile: any | null;
}

interface Env {
  OPENROUTER_API_KEY: string;
  calorie_tracker_sync: D1Database;
  ADMIN_TOKEN: string;
}

interface InsightRequest {
  sex: string;
  age: number;
  activity_level: string;
  target_kcal: number;
  maintenance_kcal: number;
  current_weight_kg: number;
  target_weight_kg: number;
  consumed: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  salt: number;
  rda_protein: number;
  rda_carbs: number;
  rda_fat: number;
  rda_fiber: number;
  current_hour?: number;
  is_today?: boolean;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const corsHeaders = getCors(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // Sync endpoint — does not require OPENROUTER_API_KEY
    if (pathname.endsWith('/api/sync')) {
      return handleSync(request, env, corsHeaders);
    }

    if (pathname.endsWith('/api/admin')) {
      return handleAdmin(request, env, corsHeaders);
    }

    if (pathname.endsWith('/api/suggestions')) {
      return handleSuggestions(request, env, corsHeaders);
    }

    const openRouterKey = env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      return new Response(
        JSON.stringify({ error: 'API not configured' }),
        { status: 500, headers: corsHeaders }
      );
    }

    if (pathname.endsWith('/api/extract-nutrition')) {
      let success = true;
      let token = '';
      try {
        const body: ExtractRequest & { token?: string } = await request.json();
        token = body.token || '';
        if (!isValidToken(token)) {
          return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        if (!body.image_base64 || !body.filename) {
          return new Response(
            JSON.stringify({ error: 'Missing image_base64 or filename' }),
            { status: 400, headers: corsHeaders }
          );
        }
        const result = await callOpenRouter(body.image_base64, openRouterKey, body.food_description);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        success = false;
        console.error('Error:', error);
        return new Response(
          JSON.stringify({ error: 'Extraction failed', details: error instanceof Error ? error.message : 'Unknown error' }),
          { status: 500, headers: corsHeaders }
        );
      } finally {
        logUsage(ctx, env, token, 'extract-nutrition', 'gpt-4o-mini+gemini-flash-1.5', success);
      }
    }

    if (pathname.endsWith('/api/daily-insight')) {
      let success = true;
      let token = '';
      try {
        const body: InsightRequest & { token?: string } = await request.json();
        token = body.token || '';
        if (!isValidToken(token)) {
          return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        const result = await callInsight(body, openRouterKey);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        success = false;
        console.error('Error:', error);
        return new Response(
          JSON.stringify({ error: 'Insight failed', details: error instanceof Error ? error.message : 'Unknown error' }),
          { status: 500, headers: corsHeaders }
        );
      } finally {
        logUsage(ctx, env, token, 'daily-insight', 'deepseek/deepseek-v4-flash:free', success);
      }
    }

    if (pathname.endsWith('/api/calorie-target')) {
      let success = true;
      let token = '';
      try {
        const body = await request.json() as any;
        token = body.token || '';
        if (!isValidToken(token)) {
          return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
        const result = await callCalorieTarget(body, openRouterKey);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        success = false;
        console.error('Error:', error);
        return new Response(
          JSON.stringify({ error: 'Calorie target failed', details: error instanceof Error ? error.message : 'Unknown error' }),
          { status: 500, headers: corsHeaders }
        );
      } finally {
        logUsage(ctx, env, token, 'calorie-target', 'deepseek/deepseek-v4-flash:free', success);
      }
    }

    return new Response('Not found', { status: 404 });
  },
};

// ── Suggestions ───────────────────────────────────────────────────────────────

async function handleSuggestions(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const json = await request.json() as { token?: string; action?: string; sync_id?: string; body?: string; status?: string };
  const { token, action } = json;
  const ok = (data: object) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  const err = (msg: string, code = 400) => new Response(JSON.stringify({ error: msg }), { status: code, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

  if (!isValidToken(token)) return err('Unauthorised', 401);
  const db = env.calorie_tracker_sync;

  // List own suggestions
  if (action === 'list') {
    const result = await db.prepare('SELECT * FROM suggestions WHERE token=? ORDER BY updated_at DESC').bind(token).all();
    return ok({ suggestions: result.results });
  }

  // Save (create or update) a suggestion
  if (action === 'save') {
    const text = json.body?.trim();
    if (!text) return err('Empty suggestion');
    const now = new Date().toISOString();
    const id = json.sync_id || crypto.randomUUID();
    await db.prepare(`
      INSERT INTO suggestions (sync_id, token, body, status, created_at, updated_at)
      VALUES (?, ?, ?, 'open', ?, ?)
      ON CONFLICT(sync_id) DO UPDATE SET
        body=excluded.body, updated_at=excluded.updated_at
      WHERE token=excluded.token
    `).bind(id, token, text, now, now).run();
    return ok({ sync_id: id });
  }

  // Admin: list all suggestions
  if (action === 'admin-list') {
    if (token !== env.ADMIN_TOKEN) return err('Forbidden', 403);
    const result = await db.prepare('SELECT * FROM suggestions ORDER BY updated_at DESC').all();
    return ok({ suggestions: result.results });
  }

  // Admin: update status
  if (action === 'admin-status') {
    if (token !== env.ADMIN_TOKEN) return err('Forbidden', 403);
    const validStatuses = ['open', 'reviewed', 'done'];
    if (!json.sync_id || !validStatuses.includes(json.status ?? '')) return err('Invalid');
    await db.prepare('UPDATE suggestions SET status=?, updated_at=? WHERE sync_id=?')
      .bind(json.status, new Date().toISOString(), json.sync_id).run();
    return ok({ ok: true });
  }

  return err('Unknown action');
}

// ── Admin ─────────────────────────────────────────────────────────────────────

async function handleAdmin(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const json = await request.json() as { token?: string };
  if (!env.ADMIN_TOKEN || json.token !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const db = env.calorie_tracker_sync;
  const [usageToday, usageWeek, usageMonth, users, records, recent] = await Promise.all([
    db.prepare(`SELECT endpoint, model, COUNT(*) as n FROM usage WHERE ts >= date('now') GROUP BY endpoint, model ORDER BY n DESC`).all(),
    db.prepare(`SELECT endpoint, model, COUNT(*) as n FROM usage WHERE ts >= date('now', '-7 days') GROUP BY endpoint, model ORDER BY n DESC`).all(),
    db.prepare(`SELECT endpoint, model, COUNT(*) as n FROM usage WHERE ts >= date('now', 'start of month') GROUP BY endpoint, model ORDER BY n DESC`).all(),
    db.prepare(`SELECT COUNT(DISTINCT token) as n FROM usage`).first<{ n: number }>(),
    db.prepare(`
      SELECT 'food' as store, COUNT(*) as n FROM food_entries WHERE deleted=0
      UNION ALL SELECT 'weight', COUNT(*) FROM weight_entries WHERE deleted=0
      UNION ALL SELECT 'favourites', COUNT(*) FROM favourites WHERE deleted=0
      UNION ALL SELECT 'profile', COUNT(*) FROM profile
    `).all(),
    db.prepare(`SELECT substr(token,1,8) as user, endpoint, success, ts FROM usage ORDER BY ts DESC LIMIT 20`).all(),
  ]);

  return new Response(JSON.stringify({
    usageToday:  usageToday.results,
    usageWeek:   usageWeek.results,
    usageMonth:  usageMonth.results,
    totalUsers:  users?.n ?? 0,
    records:     records.results,
    recent:      recent.results,
  }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}

// ── Usage logging ────────────────────────────────────────────────────────────

function isValidToken(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token);
}

function logUsage(ctx: ExecutionContext, env: Env, token: string, endpoint: string, model: string, success: boolean): void {
  if (!env.calorie_tracker_sync || !token) return;
  ctx.waitUntil(
    env.calorie_tracker_sync
      .prepare('INSERT INTO usage (token, endpoint, model, success, ts) VALUES (?, ?, ?, ?, ?)')
      .bind(token, endpoint, model, success ? 1 : 0, new Date().toISOString())
      .run()
      .catch(() => {})
  );
}

// ── Sync ─────────────────────────────────────────────────────────────────────

async function handleSync(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (!env.calorie_tracker_sync) {
    return new Response(JSON.stringify({ error: 'Sync not configured' }), {
      status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  let body: SyncRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const { token, since = '1970-01-01T00:00:00.000Z', foodEntries = [], weightEntries = [], favourites = [], profile } = body;
  if (!token || typeof token !== 'string' || token.length < 8) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Chunk helper — D1 batch limit is 100 statements
  const chunk = <T>(arr: T[], n = 80): T[][] =>
    arr.length === 0 ? [] : [arr.slice(0, n), ...chunk(arr.slice(n), n)];

  // Upsert food entries
  for (const batch of chunk(foodEntries)) {
    await env.calorie_tracker_sync.batch(batch.map((e: any) =>
      env.calorie_tracker_sync.prepare(`
        INSERT INTO food_entries
          (sync_id,token,date,time,meal_type,food_name,brand,serving_description,
           calories,protein_g,carbs_g,fat_g,fibre_g,salt_g,sugar_g,
           source_type,ocr_confidence,updated_at,deleted)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(sync_id) DO UPDATE SET
          date=excluded.date, time=excluded.time, meal_type=excluded.meal_type,
          food_name=excluded.food_name, brand=excluded.brand,
          serving_description=excluded.serving_description, calories=excluded.calories,
          protein_g=excluded.protein_g, carbs_g=excluded.carbs_g, fat_g=excluded.fat_g,
          fibre_g=excluded.fibre_g, salt_g=excluded.salt_g, sugar_g=excluded.sugar_g,
          source_type=excluded.source_type, ocr_confidence=excluded.ocr_confidence,
          updated_at=excluded.updated_at, deleted=excluded.deleted
        WHERE excluded.updated_at > food_entries.updated_at
      `).bind(
        e.sync_id, token, e.date ?? null, e.time ?? null, e.meal_type ?? null,
        e.food_name ?? null, e.brand ?? null, e.serving_description ?? null,
        e.calories ?? null, e.protein_g ?? null, e.carbs_g ?? null, e.fat_g ?? null,
        e.fibre_g ?? null, e.salt_g ?? null, e.sugar_g ?? null,
        e.source_type ?? null, e.ocr_confidence ?? null,
        e.updated_at, e.deleted ? 1 : 0,
      )
    ));
  }

  // Upsert weight entries
  for (const batch of chunk(weightEntries)) {
    await env.calorie_tracker_sync.batch(batch.map((e: any) =>
      env.calorie_tracker_sync.prepare(`
        INSERT INTO weight_entries (sync_id,token,date,time,weight_kg,is_morning,note,updated_at,deleted)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(sync_id) DO UPDATE SET
          date=excluded.date, time=excluded.time, weight_kg=excluded.weight_kg,
          is_morning=excluded.is_morning, note=excluded.note,
          updated_at=excluded.updated_at, deleted=excluded.deleted
        WHERE excluded.updated_at > weight_entries.updated_at
      `).bind(
        e.sync_id, token, e.date ?? null, e.time ?? null, e.weight_kg ?? null,
        e.is_morning ? 1 : 0, e.note ?? null, e.updated_at, e.deleted ? 1 : 0,
      )
    ));
  }

  // Upsert favourites
  for (const batch of chunk(favourites)) {
    await env.calorie_tracker_sync.batch(batch.map((e: any) =>
      env.calorie_tracker_sync.prepare(`
        INSERT INTO favourites
          (sync_id,token,food_name,brand,serving_description,calories,
           protein_g,carbs_g,fat_g,fibre_g,salt_g,meal_type,updated_at,deleted)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(sync_id) DO UPDATE SET
          food_name=excluded.food_name, brand=excluded.brand,
          serving_description=excluded.serving_description, calories=excluded.calories,
          protein_g=excluded.protein_g, carbs_g=excluded.carbs_g, fat_g=excluded.fat_g,
          fibre_g=excluded.fibre_g, salt_g=excluded.salt_g, meal_type=excluded.meal_type,
          updated_at=excluded.updated_at, deleted=excluded.deleted
        WHERE excluded.updated_at > favourites.updated_at
      `).bind(
        e.sync_id, token, e.food_name ?? null, e.brand ?? null,
        e.serving_description ?? null, e.calories ?? null,
        e.protein_g ?? null, e.carbs_g ?? null, e.fat_g ?? null,
        e.fibre_g ?? null, e.salt_g ?? null, e.meal_type ?? null,
        e.updated_at, e.deleted ? 1 : 0,
      )
    ));
  }

  // Upsert profile
  if (profile && profile.updated_at) {
    await env.calorie_tracker_sync.prepare(`
      INSERT INTO profile (token, data, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
      WHERE excluded.updated_at > profile.updated_at
    `).bind(token, JSON.stringify(profile), profile.updated_at).run();
  }

  // Fetch records newer than since
  const serverTime = new Date().toISOString();
  const [newFood, newWeight, newFavs, serverProfile] = await Promise.all([
    env.calorie_tracker_sync.prepare('SELECT * FROM food_entries  WHERE token=? AND updated_at>?').bind(token, since).all(),
    env.calorie_tracker_sync.prepare('SELECT * FROM weight_entries WHERE token=? AND updated_at>?').bind(token, since).all(),
    env.calorie_tracker_sync.prepare('SELECT * FROM favourites    WHERE token=? AND updated_at>?').bind(token, since).all(),
    env.calorie_tracker_sync.prepare('SELECT * FROM profile        WHERE token=?').bind(token).first<{ token: string; data: string; updated_at: string }>(),
  ]);

  const parsedProfile = serverProfile
    ? { ...JSON.parse(serverProfile.data), updated_at: serverProfile.updated_at }
    : null;

  return new Response(JSON.stringify({
    foodEntries:   newFood.results,
    weightEntries: newWeight.results,
    favourites:    newFavs.results,
    profile:       parsedProfile,
    serverTime,
  }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}

// ── AI endpoints ──────────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a nutrition analysis system. First determine what type of image this is, then respond accordingly.

STEP 1 - IDENTIFY IMAGE TYPE:
- "label": a nutrition facts/information label, packaging, or nutritional table
- "food_photo": a photo of actual food, a meal, a dish, or ingredients

STEP 2 - RESPOND BASED ON TYPE:

IF "label": Extract exact values from the label. Return PER SERVING values (calculate if shown per 100ml/g).

IF "food_photo": Identify every visible food item and estimate calories and macros based on typical portion sizes. Consider the plate/bowl size, food depth, and any visible reference objects. Set confidence 0.4-0.65. Add a warning that values are estimated.

RULES FOR BOTH:
- All numbers must be PLAIN NUMBERS with NO units (e.g., "103" not "103kcal", "23" not "23g")
- Return ONLY valid JSON - NO other text before or after

Return this JSON and NOTHING ELSE:
{
  "image_type": "label" or "food_photo",
  "food_name": "string or null",
  "brand": "string or null",
  "serving_size_text": "string or null",
  "servings": 1,
  "per_pack": false,
  "calories_kcal": number or null,
  "protein_g": number or null,
  "carbs_g": number or null,
  "fat_g": number or null,
  "sugar_g": number or null,
  "salt_g": number or null,
  "fibre_g": number or null,
  "confidence": 0.9,
  "warnings": []
}`;

function parseModelContent(raw: any): string | null {
  if (raw.content && Array.isArray(raw.content)) {
    return raw.content.find((i: any) => i.type === 'text')?.text ?? null;
  }
  return raw.choices?.[0]?.message?.content ?? null;
}

function parseExtractResponse(content: string): ExtractResponse {
  let cleaned = content;
  const blockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (blockMatch) cleaned = blockMatch[1];
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) cleaned = objMatch[0];
  cleaned = cleaned
    .replace(/```json\n?/g, '').replace(/\n?```/g, '').trim()
    .replace(/:\s*<([0-9.]+)/g, ': $1').replace(/:\s*>([0-9.]+)/g, ': $1')
    .replace(/:\s*≤([0-9.]+)/g, ': $1').replace(/:\s*≥([0-9.]+)/g, ': $1')
    .replace(/:\s*"([^"]*)<([0-9.]+)([^"]*)"/g, ': "$1$2$3"');
  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      image_type: 'label', food_name: null, brand: null, serving_size_text: null,
      servings: 1, per_pack: false, calories_kcal: null, protein_g: null,
      carbs_g: null, fat_g: null, sugar_g: null, salt_g: null, fibre_g: null,
      confidence: 0, warnings: ['Could not parse extraction'],
    };
  }
}

// gpt-4o-mini via Anthropic-compatible endpoint — best for label extraction
async function callLabelModel(imageBase64: string, apiKey: string): Promise<ExtractResponse> {
  const res = await fetch('https://openrouter.ai/api/v1/messages', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://fitnesshealth.app', 'X-Title': 'FitnessHealth' },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini', max_tokens: 500,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: EXTRACTION_PROMPT },
      ]}],
    }),
  });
  if (!res.ok) throw new Error(`Label model error: ${res.status} ${await res.text()}`);
  const content = parseModelContent(await res.json());
  if (!content) throw new Error('No content from label model');
  return normalizeExtraction(parseExtractResponse(content));
}

// Text-only nutrition lookup — used when the user has provided a confirmed food description.
// Skips the image entirely so visual misidentification can't interfere.
async function callTextNutrition(description: string, apiKey: string): Promise<ExtractResponse> {
  const prompt = `You are a precise nutrition calculator. The user has described their meal as: "${description}"

Step 1 — identify each ingredient and its quantity from the description.
Step 2 — for each ingredient, state the exact weight (g) and its nutritional values per that weight using standard UK/USDA food data.
Step 3 — sum all ingredients to get the total meal nutrition.
Step 4 — return the totals as JSON.

Use these standard reference values (do not deviate):
- 1 medium egg scrambled (cooked with a little butter): ~90 kcal, 6g protein, 1g carbs, 7g fat
- 1 slice wholegrain/wholemeal bread (40g): ~88 kcal, 4g protein, 15g carbs, 1.5g fat, 2g fibre
- 1 slice white bread (35g): ~83 kcal, 3g protein, 16g carbs, 0.8g fat
- 1 rasher bacon (grilled): ~80 kcal, 7g protein, 0g carbs, 6g fat
- 1 tbsp butter (15g): ~110 kcal, 0g protein, 0g carbs, 12g fat
Use similar precision for any other ingredients mentioned.

Return ONLY this JSON, no other text:
{
  "image_type": "food_photo",
  "food_name": "${description}",
  "brand": null,
  "serving_size_text": "${description}",
  "servings": 1,
  "per_pack": false,
  "calories_kcal": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "sugar_g": null,
  "salt_g": null,
  "fibre_g": number or null,
  "confidence": 0.85,
  "warnings": ["Calculated from food description — adjust if portion differs"]
}`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://fitnesshealth.app', 'X-Title': 'FitnessHealth' },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini', max_tokens: 500,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Text nutrition model error: ${res.status} ${await res.text()}`);
  const content = parseModelContent(await res.json());
  if (!content) throw new Error('No content from text nutrition model');
  const result = normalizeExtraction(parseExtractResponse(content)) as ExtractResponse & { text_only_lookup?: boolean };
  result.food_name = description; // always force the confirmed name
  result.text_only_lookup = true;
  return result;
}

// gemini-flash-1.5 via OpenAI-compatible endpoint — better for food photo estimation
async function callFoodPhotoModel(imageBase64: string, apiKey: string): Promise<ExtractResponse> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://fitnesshealth.app', 'X-Title': 'FitnessHealth' },
    body: JSON.stringify({
      model: 'google/gemini-flash-1.5', max_tokens: 500,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        { type: 'text', text: EXTRACTION_PROMPT },
      ]}],
    }),
  });
  if (!res.ok) throw new Error(`Food photo model error: ${res.status} ${await res.text()}`);
  const content = parseModelContent(await res.json());
  if (!content) throw new Error('No content from food photo model');
  return normalizeExtraction(parseExtractResponse(content));
}

async function callOpenRouter(imageBase64: string, apiKey: string, description?: string): Promise<ExtractResponse> {
  // If the user has confirmed the food name, skip the image entirely —
  // visual misidentification cannot affect the result.
  if (description) {
    return callTextNutrition(description, apiKey);
  }

  // First call: gpt-4o-mini to detect image type and extract (great for labels)
  const initial = await callLabelModel(imageBase64, apiKey);

  // If it's a food photo, re-run with gemini-flash-1.5 for better estimation
  if (initial.image_type === 'food_photo') {
    try {
      return await callFoodPhotoModel(imageBase64, apiKey);
    } catch (err) {
      console.warn('Food photo model failed, using gpt-4o-mini result:', err);
      return initial;
    }
  }

  return initial;
}

function normalizeExtraction(data: any): ExtractResponse {
  return {
    image_type: data.image_type === 'food_photo' ? 'food_photo' : 'label',
    food_name: sanitizeString(data.food_name),
    brand: sanitizeString(data.brand),
    serving_size_text: sanitizeString(data.serving_size_text),
    servings: sanitizeNumber(data.servings, 1),
    per_pack: typeof data.per_pack === 'boolean' ? data.per_pack : false,
    calories_kcal: sanitizeNumber(data.calories_kcal),
    protein_g: sanitizeNumber(data.protein_g),
    carbs_g: sanitizeNumber(data.carbs_g),
    fat_g: sanitizeNumber(data.fat_g),
    sugar_g: sanitizeNumber(data.sugar_g),
    salt_g: sanitizeNumber(data.salt_g),
    fibre_g: sanitizeNumber(data.fibre_g),
    confidence: sanitizeConfidence(data.confidence),
    warnings: Array.isArray(data.warnings)
      ? data.warnings.filter((w: any) => typeof w === 'string')
      : [],
  };
}

function sanitizeString(value: any): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim().substring(0, 255);
  }
  return null;
}

function sanitizeNumber(value: any, defaultValue: number | null = null): number | null {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }

  // Convert to string and extract first number
  let str = String(value).trim();

  // Handle fractions like "173.4/100ml" - take first number
  const match = str.match(/^([0-9.]+)/);
  if (match) {
    const num = parseFloat(match[1]);
    if (!isNaN(num) && num >= 0 && num < 100000) {
      return Math.round(num * 10) / 10;
    }
  }

  return defaultValue;
}

function sanitizeConfidence(value: any): number {
  const num = parseFloat(value);
  if (!isNaN(num) && num >= 0 && num <= 1) {
    return Math.round(num * 100) / 100;
  }
  return 0.5;
}

async function callCalorieTarget(data: any, apiKey: string): Promise<{ target_kcal: number; reasoning: string }> {
  const minSafe = data.sex === 'male' ? 1500 : 1200;
  const deficit = Math.round(data.loss_rate_kg_per_week * 7700 / 7);
  const mathTarget = Math.max(data.maintenance_kcal - deficit, minSafe);

  const prompt = `You are a nutrition expert. Calculate a safe, personalised daily calorie target.

Profile: ${data.sex}, age ${data.age}, ${data.height_cm}cm, ${data.current_weight_kg}kg → goal ${data.target_weight_kg}kg
Activity: ${data.activity_level} | Maintenance: ${data.maintenance_kcal} kcal/day
Desired loss rate: ${data.loss_rate_kg_per_week} kg/week

Standard calculation: ${data.maintenance_kcal} − ${deficit} = ${data.maintenance_kcal - deficit} kcal/day
Safe minimum: ${minSafe} kcal/day

Validate and adjust if needed. Consider the person's current weight, how far they are from their goal, and whether the rate is sustainable. Provide a rounded, practical number.

Return ONLY this JSON, no other text:
{"target_kcal": <integer>, "reasoning": "<one concise sentence explaining the recommendation>"}`;

  const models = [
    'deepseek/deepseek-v4-flash:free',
    'google/gemma-4-31b-it:free',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  ];
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://dnb-calories.example.com',
    'X-Title': 'DNB Calories',
  };

  for (const model of models) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers,
      body: JSON.stringify({ model, max_tokens: 120, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!response.ok) continue;
    const result: any = await response.json();
    const content: string = result.choices?.[0]?.message?.content || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (typeof parsed.target_kcal === 'number' && parsed.target_kcal > 800) {
          return { target_kcal: Math.round(parsed.target_kcal), reasoning: parsed.reasoning || '' };
        }
      } catch (_) {}
    }
  }

  return {
    target_kcal: mathTarget,
    reasoning: `${data.maintenance_kcal} kcal maintenance minus ${deficit} kcal/day deficit for ${data.loss_rate_kg_per_week} kg/week loss.`,
  };
}

async function callInsight(data: InsightRequest, apiKey: string): Promise<{ insight: string; mood: string }> {
  const pct = (v: number, rda: number) => rda > 0 ? Math.round(v / rda * 100) : 0;
  const remaining = Math.max(0, data.target_kcal - data.consumed);

  // Work out how far through the eating day we are (7am–10pm = 15 hrs)
  const hour = data.is_today ? (data.current_hour ?? 23) : 23;
  const dayFraction = Math.min(1, Math.max(0, (hour - 7) / 15));
  const expectedByNow = Math.round(data.target_kcal * dayFraction);
  const isPartialDay = data.is_today && hour < 21;

  const proteinStatus = pct(data.protein, data.rda_protein) >= 80 ? 'strong' : pct(data.protein, data.rda_protein) >= 50 ? 'moderate' : 'low';
  const calStatus = data.consumed > data.target_kcal
    ? 'over daily target'
    : isPartialDay
      ? data.consumed > expectedByNow * 1.2 ? 'ahead of pace' : data.consumed < expectedByNow * 0.7 ? 'behind pace (day not over)' : 'on pace for the day'
      : pct(data.consumed, data.target_kcal) >= 80 ? 'close to target' : 'under target';

  const timeContext = isPartialDay
    ? `It is currently ${hour}:00. The user has NOT finished eating for the day — do NOT say they are under their daily target. Instead comment on their pace (they have logged ${data.consumed} kcal, expected ~${expectedByNow} kcal by this time of day based on a ${data.target_kcal} kcal target).`
    : `This is a end-of-day or historical summary. Assess intake against the full daily target.`;

  const prompt = `You are a nutrition coach writing a daily check-in for a specific person. Write exactly 2-3 sentences. Every sentence must reference at least one actual number from the data below — never speak in generalities.

STRICT RULES:
- Do NOT use filler phrases like "Keep it up", "Great job", "Well done", "You're doing great", "Stay hydrated", "Listen to your body"
- Do NOT give generic advice unrelated to the actual numbers
- You MUST mention at least two specific nutrients by name with their actual values
- Vary your opening — do not start with "You"
- If protein is low, say so clearly. If calories are high, say so clearly. Be honest but constructive.
- ${timeContext}

Person: ${data.sex}, age ${data.age}, ${data.activity_level} activity, ${data.current_weight_kg}kg → target ${data.target_weight_kg}kg
Calorie target: ${data.target_kcal} kcal/day (maintenance ${data.maintenance_kcal} kcal)

Today's intake so far:
- Calories: ${data.consumed} kcal — ${calStatus}${isPartialDay ? ` (${remaining} kcal remaining in budget)` : ''}
- Protein: ${data.protein}g / ${data.rda_protein}g RDA (${pct(data.protein, data.rda_protein)}%) — ${proteinStatus}
- Carbs: ${data.carbs}g / ${data.rda_carbs}g RDA (${pct(data.carbs, data.rda_carbs)}%)
- Fat: ${data.fat}g / ${data.rda_fat}g RDA (${pct(data.fat, data.rda_fat)}%)
- Fibre: ${data.fiber}g / ${data.rda_fiber}g RDA (${pct(data.fiber, data.rda_fiber)}%)
- Salt: ${data.salt}g / 6g max (${pct(data.salt, 6)}%)

Reply with ONLY this JSON and nothing else:
{"insight": "2-3 sentences referencing real numbers", "mood": "great|good|caution"}

mood = "great" if on pace or better AND protein >= 80% RDA; "caution" if over daily target OR protein < 40% RDA; otherwise "good".`;

  const models = [
    'deepseek/deepseek-v4-flash:free',
    'google/gemma-4-31b-it:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  ];

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://dnb-calories.example.com',
    'X-Title': 'DNB Calories',
  };

  for (const model of models) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (response.status === 429 || response.status === 503) continue;
    if (!response.ok) continue;

    const result: any = await response.json();
    const content: string = result.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (isValidInsight(parsed.insight)) {
          parsed.mood = ['great', 'good', 'caution'].includes(parsed.mood) ? parsed.mood : 'good';
          return parsed;
        }
      } catch (_) {}
    }
    // If we got a response but it was garbage, try next model
  }

  // All models failed or produced invalid output — generate a reliable template insight
  return templateInsight(data);
}

function isValidInsight(text: any): boolean {
  if (typeof text !== 'string') return false;
  if (text.length < 40 || text.length > 600) return false;
  // Reject code-like patterns, foreign script injections, template artifacts
  if (/[{}`]|\/\*|\*\/|::|<\/|\$\{|console\.|function\s*\(/.test(text)) return false;
  // Must be mostly ASCII (rejects garbled unicode injection)
  const ascii = text.split('').filter((c: string) => c.charCodeAt(0) < 128).length;
  if (ascii / text.length < 0.90) return false;
  // Must contain at least one number (we demand data references)
  if (!/\d/.test(text)) return false;
  return true;
}

function templateInsight(data: InsightRequest): { insight: string; mood: string } {
  const pct = (v: number, r: number) => r > 0 ? Math.round(v / r * 100) : 0;
  const calPct = pct(data.consumed, data.target_kcal);
  const protPct = pct(data.protein, data.rda_protein);
  const remaining = Math.max(0, data.target_kcal - data.consumed);
  const parts: string[] = [];
  let mood = 'good';

  const hour = data.is_today ? (data.current_hour ?? 23) : 23;
  const isPartialDay = data.is_today && hour < 21;
  const dayFraction = Math.min(1, Math.max(0, (hour - 7) / 15));
  const expectedByNow = Math.round(data.target_kcal * dayFraction);

  if (calPct > 110) {
    mood = 'caution';
    parts.push(`You've consumed ${data.consumed} kcal — ${calPct - 100}% over your ${data.target_kcal} kcal target.`);
  } else if (isPartialDay) {
    if (data.consumed > expectedByNow * 1.2) {
      parts.push(`At ${hour}:00, you've logged ${data.consumed} kcal — slightly ahead of the ~${expectedByNow} kcal pace for this time of day, with ${remaining} kcal remaining in your budget.`);
    } else if (data.consumed < expectedByNow * 0.7) {
      parts.push(`You've logged ${data.consumed} kcal so far — a little behind the ~${expectedByNow} kcal expected by ${hour}:00, though there's plenty of the day left.`);
      mood = 'good';
    } else {
      parts.push(`At ${hour}:00, ${data.consumed} kcal logged is right on pace against your ${data.target_kcal} kcal daily target.`);
      mood = 'great';
    }
  } else if (calPct >= 80) {
    parts.push(`You've consumed ${data.consumed} kcal — ${calPct}% of your ${data.target_kcal} kcal target, with ${remaining} kcal remaining.`);
    mood = 'great';
  } else {
    parts.push(`You've logged ${data.consumed} kcal today against a ${data.target_kcal} kcal target, with ${remaining} kcal still available.`);
  }

  if (protPct >= 80) {
    parts.push(`Protein is strong at ${data.protein}g (${protPct}% of your ${data.rda_protein}g RDA).`);
    if (mood !== 'caution') mood = 'great';
  } else if (protPct < 40) {
    parts.push(`Protein is low at ${data.protein}g — aim to build toward your ${data.rda_protein}g RDA through the rest of the day.`);
    if (mood !== 'caution') mood = 'good';
  } else {
    parts.push(`Protein is at ${data.protein}g (${protPct}% of your ${data.rda_protein}g RDA) — keep building.`);
  }

  return { insight: parts.join(' '), mood };
}