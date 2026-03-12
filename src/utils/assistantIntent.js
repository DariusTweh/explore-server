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

function sanitizeDestinationCandidate(value) {
  const normalized = clean(value)
    .replace(/\btrip\b.*$/i, "")
    .replace(/\bwith my\b.*$/i, "")
    .replace(/\bwith\b.*$/i, "")
    .replace(/\bfor\s+\d+\s*(?:days?|nights?)\b.*$/i, "")
    .replace(/\bon a\b.*$/i, "")
    .replace(/\b(?:next|this)\s+(?:week|month|weekend|spring|summer|winter|fall|autumn)\b.*$/i, "")
    .replace(/[?.!,]$/g, "")
    .trim();

  if (!normalized) return null;
  if (/\bmuseum|hotel|restaurant|cafe|station|airport|park|temple|shrine|castle\b/i.test(normalized)) {
    return null;
  }
  if (normalized.length > 40) return null;
  return normalized;
}

export function extractDestinationHint(text) {
  const source = clean(text);
  const patterns = [
    /\b(?:trip to|visit|visiting|going to|plan me(?: a| an)?|plan)\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bbest places in\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\b([A-Za-z][A-Za-z\s'-]{2,50})\s+trip\b/i,
    /\b(?:actually|instead)\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const sanitized = sanitizeDestinationCandidate(match?.[1]);
    if (sanitized) return sanitized;
  }
  return null;
}

export function extractPlaceSubject(text) {
  const source = clean(text);
  const patterns = [
    /\bwhat about\s+(.+)/i,
    /\bwhat'?s near\s+(.+)/i,
    /\bwhich are near\s+(.+)/i,
    /\bnear\s+(?:the\s+)?(.+)/i,
    /\bthe actual\s+(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const candidate = clean(match?.[1]).replace(/^(?:the)\s+/i, "").replace(/[?.!,]$/, "");
    if (candidate && candidate.length <= 80) return candidate;
  }
  if (/\b(porsche museum|museum|landmark|hotel|restaurant|airport)\b/i.test(source)) {
    return source.replace(/[?.!,]$/, "");
  }
  return null;
}

export function looksLikeTripConstraintFollowup(text) {
  return /\b(make it cheaper|cheaper|more luxury|budget|with my girlfriend|with my boyfriend|with my partner|4 days|5 days|for \d+ days|for \d+ nights|instead|actually)\b/i.test(
    String(text || "")
  );
}

function fallbackClassification(message, memory = {}) {
  const raw = clean(message);
  const text = raw.toLowerCase();
  const destinationHint = extractDestinationHint(raw) || memory?.destination?.label || null;
  const placeSubject = extractPlaceSubject(raw);
  const hasTripContext = Boolean(memory?.destination?.label || memory?.last_mode === "trip_planning");

  if (looksLikeTripConstraintFollowup(raw) && hasTripContext) {
    return {
      intent: "trip_plan",
      mode: "trip_planning",
      task: "build_trip_outline",
      query: raw,
      destinationHint,
      confidence: 0.88,
      response: null,
      location: null,
      nearMe: null,
      openNow: null,
      lateNight: null,
      rank: null,
      radiusKm: null,
    };
  }

  if (/\b(show flights|flights|flight options|book flight)\b/.test(text) || /\bfrom\s+\w+\s+to\s+\w+\b/.test(text)) {
    return {
      intent: "flights",
      mode: "travel_action",
      task: "show_flights",
      query: raw,
      destinationHint,
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
      destinationHint,
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

  if ((/\bnear\b|\bnearby\b/.test(text)) && placeSubject) {
    return {
      intent: "spots",
      mode: "nearby_search",
      task: "find_places_near_named_place",
      query: placeSubject,
      destinationHint,
      confidence: 0.82,
      response: null,
      location: null,
      nearMe: /\bnear me\b/.test(text),
      openNow: /\bopen now\b/.test(text),
      lateNight: /\blate night\b/.test(text),
      rank: /\bclosest\b|\bnearby\b/.test(text) ? "distance" : null,
      radiusKm: null,
    };
  }

  if ((/\bwhat about\b|\bmuseum\b|\blandmark\b|\bactual\b/.test(text)) && placeSubject) {
    return {
      intent: "spots",
      mode: "place_lookup",
      task: "resolve_named_poi",
      query: placeSubject,
      destinationHint,
      confidence: 0.8,
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
      destinationHint,
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

  if (/\b(currency|exchange rate|exchange|usd|eur|thb|jpy|idr|xof)\b/.test(text)) {
    return {
      intent: "chat",
      mode: "travel_knowledge",
      task: "answer_currency_question",
      query: raw,
      destinationHint,
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
    mode: hasTripContext && looksLikeTripConstraintFollowup(raw) ? "trip_planning" : "travel_knowledge",
    task: hasTripContext && looksLikeTripConstraintFollowup(raw) ? "build_trip_outline" : "answer_general_travel_question",
    query: raw,
    destinationHint,
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

function postProcessClassification(data, memory, userMessage) {
  const next = { ...data };
  next.destinationHint = sanitizeDestinationCandidate(next.destinationHint) || extractDestinationHint(userMessage) || memory?.destination?.label || null;
  if (next.mode === "place_lookup" || next.mode === "nearby_search") {
    next.query = extractPlaceSubject(next.query || userMessage);
  } else {
    next.query = clean(next.query || userMessage) || null;
  }
  if (looksLikeTripConstraintFollowup(userMessage) && (memory?.destination?.label || memory?.last_mode === "trip_planning")) {
    next.mode = "trip_planning";
    next.task = "build_trip_outline";
    next.intent = "trip_plan";
    next.destinationHint = next.destinationHint || memory?.destination?.label || null;
  }
  return next;
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

Rules:
- Follow-up constraints like "make it cheaper", "with my girlfriend", "4 days", "actually Japan instead" should stay in trip_planning if prior trip context exists.
- destinationHint must be destination-level context only, never a POI.
- query must be concise. Do not return the whole raw message for place lookup if you can isolate the POI.

User message: ${JSON.stringify(userMessage)}
Existing memory: ${JSON.stringify(memory || {})}
`.trim();

  try {
    const resp = await client.responses.create({
      model,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "assistant_intent_v3",
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

    const postProcessed = postProcessClassification(
      {
        ...validated.data,
        intent: validated.data.intent || inferLegacyIntent(validated.data),
      },
      memory || {},
      userMessage
    );

    return {
      ...postProcessed,
      intent: postProcessed.intent || inferLegacyIntent(postProcessed),
    };
  } catch {
    return fallbackClassification(userMessage, memory || {});
  }
}
