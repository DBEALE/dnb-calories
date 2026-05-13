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

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    if (!url.pathname.endsWith('/api/extract-nutrition')) {
      return new Response('Not found', { status: 404 });
    }

    try {
      const body: ExtractRequest = await request.json();

      if (!body.image_base64 || !body.filename) {
        return new Response(
          JSON.stringify({ error: 'Missing image_base64 or filename' }),
          { status: 400, headers: corsHeaders }
        );
      }

      const openRouterKey = env.OPENROUTER_API_KEY;
      if (!openRouterKey) {
        return new Response(
          JSON.stringify({ error: 'API not configured' }),
          { status: 500, headers: corsHeaders }
        );
      }

      const result = await callOpenRouter(body.image_base64, openRouterKey);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (error) {
      console.error('Error:', error);
      return new Response(
        JSON.stringify({
          error: 'Extraction failed',
          details: error instanceof Error ? error.message : 'Unknown error',
        }),
        { status: 500, headers: corsHeaders }
      );
    }
  },
};

async function callOpenRouter(
  imageBase64: string,
  apiKey: string
): Promise<ExtractResponse> {
  const prompt = `You are a professional nutrition label OCR system with high accuracy.

CRITICAL INSTRUCTIONS - FOLLOW EXACTLY:
1. Extract nutrition data from the food label image
2. Return PER SERVING values ONLY (calculate if shown per 100ml/g)
3. Extract all these fields: food_name, brand, serving_size_text, servings, per_pack, calories_kcal, protein_g, carbs_g, fat_g, sugar_g, salt_g, fibre_g
4. All numbers must be PLAIN NUMBERS with NO units (e.g., "103" not "103kcal", "23" not "23g")
5. Return confidence as number 0-1 (0.9 = 90% confident)
6. Return ONLY valid JSON - NO other text before or after

IMPORTANT: Do not include any explanation, text, or commentary. Only return the JSON object.

Return this JSON and NOTHING ELSE:
{
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