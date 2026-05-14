/**
 * Calorie Tracker - Nutrition Extraction Worker
 * Receives nutrition screenshots, extracts data via OpenRouter API
 */

interface ExtractRequest {
  image_base64: string;
  filename: string;
  meal_type: string;
  date: string;
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      return handleSync(request, env);
    }

    if (pathname.endsWith('/api/admin')) {
      return handleAdmin(request, env);
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
        if (!body.image_base64 || !body.filename) {
          return new Response(
            JSON.stringify({ error: 'Missing image_base64 or filename' }),
            { status: 400, headers: corsHeaders }
          );
        }
        const result = await callOpenRouter(body.image_base64, openRouterKey);
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
        logUsage(env, token, 'extract-nutrition', 'openai/gpt-4o-mini', success);
      }
    }

    if (pathname.endsWith('/api/daily-insight')) {
      let success = true;
      let token = '';
      try {
        const body: InsightRequest & { token?: string } = await request.json();
        token = body.token || '';
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
        logUsage(env, token, 'daily-insight', 'deepseek/deepseek-v4-flash:free', success);
      }
    }

    if (pathname.endsWith('/api/calorie-target')) {
      let success = true;
      let token = '';
      try {
        const body = await request.json() as any;
        token = body.token || '';
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
        logUsage(env, token, 'calorie-target', 'deepseek/deepseek-v4-flash:free', success);
      }
    }

    return new Response('Not found', { status: 404 });
  },
};

// ── Admin ─────────────────────────────────────────────────────────────────────

async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const json = await request.json() as { token?: string };
  if (!env.ADMIN_TOKEN || json.token !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const db = env.calorie_tracker_sync;
  const [usageToday, usageWeek, usageMonth, users, records, recent] = await Promise.all([
    db.prepare(`SELECT endpoint, COUNT(*) as n FROM usage WHERE ts >= date('now') GROUP BY endpoint`).all(),
    db.prepare(`SELECT endpoint, COUNT(*) as n FROM usage WHERE ts >= date('now', '-7 days') GROUP BY endpoint`).all(),
    db.prepare(`SELECT endpoint, COUNT(*) as n FROM usage WHERE ts >= date('now', 'start of month') GROUP BY endpoint`).all(),
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

function logUsage(env: Env, token: string, endpoint: string, model: string, success: boolean): void {
  if (!env.calorie_tracker_sync || !token) return;
  // Fire-and-forget — don't block the response
  env.calorie_tracker_sync
    .prepare('INSERT INTO usage (token, endpoint, model, success, ts) VALUES (?, ?, ?, ?, ?)')
    .bind(token, endpoint, model, success ? 1 : 0, new Date().toISOString())
    .run()
    .catch(() => {});
}

// ── Sync ─────────────────────────────────────────────────────────────────────

async function handleSync(request: Request, env: Env): Promise<Response> {
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

async function callOpenRouter(
  imageBase64: string,
  apiKey: string
): Promise<ExtractResponse> {
  const prompt = `You are a nutrition analysis system. First determine what type of image this is, then respond accordingly.

STEP 1 - IDENTIFY IMAGE TYPE:
- "label": a nutrition facts/information label, packaging, or nutritional table
- "food_photo": a photo of actual food, a meal, a dish, or ingredients

STEP 2 - RESPOND BASED ON TYPE:

IF "label": Extract exact values from the label. Return PER SERVING values (calculate if shown per 100ml/g).

IF "food_photo": Estimate nutrition for the visible food based on typical values for that food/portion size. Use your knowledge of common foods. Set confidence lower (0.4-0.65) to reflect estimation uncertainty. Add a warning that values are estimated.

RULES FOR BOTH:
- All numbers must be PLAIN NUMBERS with NO units (e.g., "103" not "103kcal", "23" not "23g")
- Return ONLY valid JSON - NO other text before or after
- Do not include any explanation, text, or commentary

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

  const response = await fetch('https://openrouter.ai/api/v1/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://dnb-calories.example.com',
      'X-Title': 'DNB Calories',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} ${error}`);
  }

  const data = await response.json();

  // Handle Llama response format (different from OpenAI)
  let content = null;

  if (data.content && Array.isArray(data.content)) {
    // Llama format: content is an array
    const textContent = data.content.find((item: any) => item.type === 'text');
    content = textContent?.text;
  } else if (data.choices?.[0]?.message?.content) {
    // OpenAI format
    content = data.choices[0].message.content;
  }

  if (!content) {
    throw new Error('No content in API response');
  }

  let extractedData: ExtractResponse;
  try {
    let cleanedContent = content;

    // Try to extract JSON from markdown code block first
    const jsonMatch = cleanedContent.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      cleanedContent = jsonMatch[1];
    }

    // Try to find JSON object in the text (handles extra text before/after)
    const jsonObjectMatch = cleanedContent.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      cleanedContent = jsonObjectMatch[0];
    }

    // Remove any remaining markdown
    cleanedContent = cleanedContent
      .replace(/```json\n?/g, '')
      .replace(/\n?```/g, '')
      .trim();

    // Clean up common issues before parsing
    cleanedContent = cleanedContent
      .replace(/:\s*<([0-9.]+)/g, ': $1')  // Convert <0.5 to 0.5
      .replace(/:\s*>([0-9.]+)/g, ': $1')  // Convert >1 to 1
      .replace(/:\s*≤([0-9.]+)/g, ': $1')  // Convert ≤0.5 to 0.5
      .replace(/:\s*≥([0-9.]+)/g, ': $1')  // Convert ≥0.5 to 0.5
      .replace(/:\s*"([^"]*)<([0-9.]+)([^"]*)"/g, ': "$1$2$3"');  // Clean quoted values

    // Parse the JSON
    extractedData = JSON.parse(cleanedContent);
  } catch (parseError) {
    console.error('Failed to parse response:', content);
    // Return empty result instead of throwing
    extractedData = {
      image_type: 'label',
      food_name: null,
      brand: null,
      serving_size_text: null,
      servings: 1,
      per_pack: false,
      calories_kcal: null,
      protein_g: null,
      carbs_g: null,
      fat_g: null,
      sugar_g: null,
      salt_g: null,
      fibre_g: null,
      confidence: 0,
      warnings: ['Could not parse extraction'],
    };
  }

  return normalizeExtraction(extractedData);
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

  const proteinStatus = pct(data.protein, data.rda_protein) >= 80 ? 'strong' : pct(data.protein, data.rda_protein) >= 50 ? 'moderate' : 'low';
  const calStatus = pct(data.consumed, data.target_kcal) > 100 ? 'over target' : pct(data.consumed, data.target_kcal) >= 80 ? 'close to target' : 'well under target';

  const prompt = `You are a nutrition coach writing a daily check-in for a specific person. Write exactly 2-3 sentences. Every sentence must reference at least one actual number from the data below — never speak in generalities.

STRICT RULES:
- Do NOT use filler phrases like "Keep it up", "Great job", "Well done", "You're doing great", "Stay hydrated", "Listen to your body"
- Do NOT give generic advice unrelated to the actual numbers
- You MUST mention at least two specific nutrients by name with their actual values
- Vary your opening — do not start with "You"
- If protein is low, say so clearly. If calories are high, say so clearly. Be honest but constructive.

Person: ${data.sex}, age ${data.age}, ${data.activity_level} activity, ${data.current_weight_kg}kg → target ${data.target_weight_kg}kg
Calorie target: ${data.target_kcal} kcal/day (maintenance ${data.maintenance_kcal} kcal)

Today's intake:
- Calories: ${data.consumed} kcal (${pct(data.consumed, data.target_kcal)}% of target) — ${calStatus}, ${remaining} kcal remaining
- Protein: ${data.protein}g / ${data.rda_protein}g RDA (${pct(data.protein, data.rda_protein)}%) — ${proteinStatus}
- Carbs: ${data.carbs}g / ${data.rda_carbs}g RDA (${pct(data.carbs, data.rda_carbs)}%)
- Fat: ${data.fat}g / ${data.rda_fat}g RDA (${pct(data.fat, data.rda_fat)}%)
- Fibre: ${data.fiber}g / ${data.rda_fiber}g RDA (${pct(data.fiber, data.rda_fiber)}%)
- Salt: ${data.salt}g / 6g max (${pct(data.salt, 6)}%)

Reply with ONLY this JSON and nothing else:
{"insight": "2-3 sentences referencing real numbers", "mood": "great|good|caution"}

mood = "great" if calories on track AND protein >= 80% RDA; "caution" if calories over target OR protein < 40% RDA; otherwise "good".`;

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

  if (calPct > 110) {
    mood = 'caution';
    parts.push(`You've consumed ${data.consumed} kcal, which is ${calPct - 100}% over your ${data.target_kcal} kcal target.`);
  } else if (calPct >= 80) {
    parts.push(`You've consumed ${data.consumed} kcal — ${calPct}% of your ${data.target_kcal} kcal target, with ${remaining} kcal remaining.`);
    mood = 'great';
  } else {
    parts.push(`You've logged ${data.consumed} kcal so far, leaving ${remaining} kcal of your ${data.target_kcal} kcal daily target.`);
  }

  if (protPct >= 80) {
    parts.push(`Protein is looking strong at ${data.protein}g (${protPct}% of your ${data.rda_protein}g RDA).`);
    if (mood !== 'caution') mood = 'great';
  } else if (protPct < 40) {
    parts.push(`Protein is low at ${data.protein}g — try to work toward your ${data.rda_protein}g RDA throughout the day.`);
    if (mood !== 'caution') mood = 'good';
  } else {
    parts.push(`Protein is at ${data.protein}g (${protPct}% of your ${data.rda_protein}g RDA) — keep building toward your target.`);
  }

  return { insight: parts.join(' '), mood };
}