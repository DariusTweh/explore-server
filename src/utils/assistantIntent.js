import OpenAI from "openai";
import { z } from "zod";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODE_VALUES = [
  "travel_knowledge",
  "destination_discovery",
  "place_lookup",
  "nearby_search",
  "trip_planning",
  "travel_action",
];

const IntentSchema = z.object({
  intent: z
    .enum(["chat", "trip_plan", "spots", "restaurants", "hotels", "activities", "flights"])
    .nullable()
    .optional(),
  mode: z.enum(MODE_VALUES),
  task: z.string().min(1),
  query: z.string().nullable(),
  destinationHint: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  response: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  nearMe: z.boolean().nullable().optional(),
  openNow: z.boolean().nullable().optional(),
  lateNight: z.boolean().nullable().optional(),
  rank: z.enum(["distance", "popularity"]).nullable().optional(),
  radiusKm: z.number().nullable().optional(),
});

function clean(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDestinationHint(text) {
  const source = clean(text);
  const patterns = [
    /\b(?:in|to|for|around)\s+([A-Za-z][A-Za-z\s'-]{2,})/i,
    /\b([A-Za-z][A-Za-z\s'-]{2,})\s+trip\b/i,
    /\bbest places in\s+([A-Za-z][A-Za-z\s'-]{2,})/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return clean(match[1]).replace(/[?.!,]$/, "");
  }
  return null;
}

function extractPlaceSubject(text) {
  const source = clean(text);
  const patterns = [
    /\bwhat about\s+(.+)/i,
    /\bwhat'?s near\s+(.+)/i,
    /\bnear\s+(.+)/i,
    /\bthe actual\s+(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return clean(match[1]).replace(/[?.!,]$/, "");
  }
  return source;
}

function fallbackClassification(message, memory = {}) {
  const raw = clean(message);
  const text = raw.toLowerCase();

  const flightLike = /\b(show flights|flights|flight options|book flight)\b/.test(text);
  if (flightLike) {
    return {
      intent: "flights",
      mode: "travel_action",
      task: "show_flights",
      query: raw,
      destinationHint: extractDestinationHint(raw) || memory?.destination?.label || null,
      confidence: 0.84,
      response: null,
      location: null,
      nearMe: null,
      openNow: null,
      lateNight: null,
      rank: null,
      radiusKm: null,
    };
  }

  if (/\b(plan|itinerary|outline|schedule)\b/.test(text)) {
    return {
      intent: "trip_plan",
      mode: "trip_planning",
      task: "build_trip_outline",
      query: raw,
      destinationHint: extractDestinationHint(raw) || memory?.destination?.label || null,
      confidence: 0.86,
      response: null,
      location: null,
      nearMe: null,
      openNow: null,
      lateNight: null,
      rank: null,
      radiusKm: null,
    };
  }

  if (/\bnear\b|\bnearby\b/.test(text)) {
    return {
      intent: "spots",
      mode: "nearby_search",
      task: "find_places_near_named_place",
      query: extractPlaceSubject(raw),
      destinationHint: extractDestinationHint(raw) || memory?.destination?.label || null,
      confidence: 0.8,
      response: null,
      location: null,
      nearMe: /\bnear me\b/.test(text),
      openNow: /\bopen now\b/.test(text),
      lateNight: /\blate night\b/.test(text),
      rank: /\bclosest\b|\bnearby\b/.test(text) ? "distance" : null,
      radiusKm: null,
    };
  }

  if (/\bwhat about\b|\bmuseum\b|\blandmark\b|\bactual\b/.test(text)) {
    return {
      intent: "spots",
      mode: "place_lookup",
      task: "resolve_named_poi",
      query: extractPlaceSubject(raw),
      destinationHint: extractDestinationHint(raw) || memory?.destination?.label || null,
      confidence: 0.78,
      response: null,
      location: null,
      nearMe: null,
      openNow: null,
      lateNight: null,
      rank: null,
      radiusKm: null,
    };
  }

  if (/\bbest places\b|\btop places\b|\bthings to do\b/.test(text)) {
    return {
      intent: "activities",
      mode: "destination_discovery",
      task: "discover_top_places",
      query: raw,
      destinationHint: extractDestinationHint(raw) || memory?.destination?.label || null,
      confidence: 0.82,
      response: null,
      location: null,
      nearMe: null,
      openNow: null,
      lateNight: null,
      rank: "popularity",
      radiusKm: null,
    };
  }

  const currencyLike = /\b(currency|exchange rate|exchange|usd|eur|thb|jpy|idr|xof)\b/.test(text);
  if (currencyLike) {
    return {
      intent: "chat",
      mode: "travel_knowledge",
      task: "answer_currency_question",
      query: raw,
      destinationHint: extractDestinationHint(raw) || memory?.destination?.label || null,
      confidence: 0.86,
      response: null,
      location: null,
      nearMe: null,
      openNow: null,
      lateNight: null,
      rank: null,
      radiusKm: null,
    };
  }

  return {
    intent: "chat",
    mode: "travel_knowledge",
    task: "answer_general_travel_question",
    query: raw,
    destinationHint: extractDestinationHint(raw) || memory?.destination?.label || null,
    confidence: 0.64,
    response: null,
    location: null,
    nearMe: null,
    openNow: null,
    lateNight: null,
    rank: null,
    radiusKm: null,
  };
}

function inferLegacyIntent(classification) {
  const mode = classification?.mode;
  const task = classification?.task;
  const query = clean(classification?.query);

  if (mode === "trip_planning") return "trip_plan";
  if (mode === "travel_action") {
    if (task === "show_flights") return "flights";
    if (task === "compare_hotels") return "hotels";
    return "chat";
  }
  if (mode === "destination_discovery") return "activities";
  if (mode === "place_lookup" || mode === "nearby_search") {
    if (/\brestaurant|food|dinner|lunch|brunch|eat\b/.test(query)) return "restaurants";
    return "spots";
  }
  return "chat";
}

export async function classifyAssistantIntent(input = {}) {
  const payload = typeof input === "string" ? { message: input } : input || {};
  const { message, memory } = payload;
  const userMessage = clean(message);
  if (!userMessage) return null;

  if (!process.env.OPENAI_API_KEY) {
    return fallbackClassification(userMessage, memory || {});
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const prompt = `
You are the intent router for a Trip Operating System assistant.
Return JSON only.

Classify the user message into exactly one mode and one task.

Modes:
- travel_knowledge
- destination_discovery
- place_lookup
- nearby_search
- trip_planning
- travel_action

Tasks examples:
- answer_general_travel_question
- answer_currency_question
- discover_top_places
- resolve_named_poi
- find_places_near_named_place
- build_trip_outline
- show_flights
- compare_hotels
- save_place

Rules:
- place_lookup is for exact named POI/entity lookup. Example: "What about the Porsche museum".
- destination_discovery is broad destination recommendations. Example: "Best places in Germany".
- nearby_search is location-proximity intent around a named place or near-me context.
- travel_action is for execution-oriented asks like flights/hotels/saving places.
- If user asks for currency conversion/exchange, prefer travel_knowledge + answer_currency_question.
- query should be concise and preserve the key user ask.
- destinationHint should only be destination-level context (city/region/country), not a specific POI.
- confidence in [0,1].

Strong examples:
- "Where is Thailand?" => mode: travel_knowledge, task: answer_general_travel_question, destinationHint: "Thailand"
- "What is the currency exchange rate with usd" => mode: travel_knowledge, task: answer_currency_question
- "Best places in Germany" => mode: destination_discovery, task: discover_top_places, destinationHint: "Germany"
- "What about the Porsche museum" => mode: place_lookup, task: resolve_named_poi, query should include "Porsche museum"
- "What’s near the Porsche museum?" => mode: nearby_search, task: find_places_near_named_place, query should include "Porsche museum"
- "Plan me a 4 day Germany trip in spring with my girlfriend" => mode: trip_planning, task: build_trip_outline, destinationHint: "Germany"
- "Show flights" => mode: travel_action, task: show_flights

User message: ${JSON.stringify(userMessage)}
`.trim();

  try {
    const resp = await client.responses.create({
      model,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "assistant_intent_v2",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["mode", "task", "query", "destinationHint", "confidence"],
            properties: {
              intent: {
                type: ["string", "null"],
                enum: ["chat", "trip_plan", "spots", "restaurants", "hotels", "activities", "flights", null],
              },
              mode: { type: "string", enum: MODE_VALUES },
              task: { type: "string" },
              query: { type: ["string", "null"] },
              destinationHint: { type: ["string", "null"] },
              confidence: { type: "number" },
              response: { type: ["string", "null"] },
              location: { type: ["string", "null"] },
              nearMe: { type: ["boolean", "null"] },
              openNow: { type: ["boolean", "null"] },
              lateNight: { type: ["boolean", "null"] },
              rank: { type: ["string", "null"], enum: ["distance", "popularity", null] },
              radiusKm: { type: ["number", "null"] },
            },
          },
        },
      },
      max_output_tokens: 240,
    });

    const outputText = String(resp.output_text || "").trim();
    if (!outputText) return fallbackClassification(userMessage, memory || {});

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return fallbackClassification(userMessage, memory || {});
    }

    const validated = IntentSchema.safeParse(parsed);
    if (!validated.success) return fallbackClassification(userMessage, memory || {});

    return {
      ...validated.data,
      intent: validated.data.intent || inferLegacyIntent(validated.data),
    };
  } catch {
    return fallbackClassification(userMessage, memory || {});
  }
}
