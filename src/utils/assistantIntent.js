import OpenAI from "openai";
import { z } from "zod";
import { getOpenAIModels } from "./openaiModels.js";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

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

function lower(text) {
  return clean(text).toLowerCase();
}

function isLikelyPoi(value) {
  return /\bmuseum|hotel|restaurant|cafe|station|airport|park|temple|shrine|castle|louvre|tower\b/i.test(
    clean(value)
  );
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
  if (normalized.length > 50) return null;
  if (isLikelyPoi(normalized)) return null;
  return normalized;
}

export function extractDestinationHint(text) {
  const source = clean(text);
  const patterns = [
    /\b(?:trip to|visit|visiting|going to|plan me(?: a| an)?|plan)\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bbest places in\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bbest neighborhoods in\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bwhere should i go in\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\b([A-Za-z][A-Za-z\s'-]{2,50})\s+trip\b/i,
    /\b(?:actually|instead)\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\b(?:visa|entry|admission|immigration|border|arrival)\s+requirements?\s+(?:to|for)\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bwhat currency do they use in\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bcurrency in\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
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
    /\btell me about\s+(.+)/i,
    /\bwhat'?s near\s+(.+)/i,
    /\bwhich are near\s+(.+)/i,
    /\bnear\s+(?:the\s+)?(.+)/i,
    /\bthe actual\s+(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const candidate = clean(match?.[1]).replace(/^(?:the)\s+/i, "").replace(/[?.!,]$/, "");
    if (candidate && candidate.length <= 80 && isLikelyPoi(candidate)) return candidate;
  }
  return null;
}

export function looksLikeTripConstraintFollowup(text) {
  return /\b(make it cheaper|cheaper|more luxury|budget|with my girlfriend|with my boyfriend|with my partner|4 days|5 days|for \d+ days|for \d+ nights|instead|actually|more nightlife|make it walkable|less touristy)\b/i.test(
    String(text || "")
  );
}

function inferLegacyIntent(classification) {
  if (classification?.mode === "trip_planning") return "trip_plan";
  if (classification?.mode === "destination_discovery") return "activities";
  if (classification?.mode === "travel_action") {
    if (classification?.task === "show_flights") return "flights";
    if (classification?.task === "compare_hotels") return "hotels";
  }
  if (classification?.mode === "place_lookup" || classification?.mode === "nearby_search") {
    return "spots";
  }
  return "chat";
}

function hasPlanningContext(memory = {}) {
  return Boolean(
    memory?.last_mode === "trip_planning" ||
      memory?.planning_stage === "itinerary" ||
      memory?.destination?.label
  );
}

function hasKnowledgeContext(memory = {}) {
  return Boolean(memory?.last_mode === "travel_knowledge" || memory?.destination?.label);
}

function extractKnowledgeSubject(text, memory = {}) {
  const source = clean(text);
  const explicit = extractDestinationHint(source);
  if (explicit) return explicit;

  const patterns = [
    /\b([A-Za-z][A-Za-z\s'-]{2,50})\s+(?:visa|entry|admission|immigration|border|arrival)\s+requirements?\b/i,
    /\b(?:visa|entry|admission|immigration|border|arrival)\s+requirements?\s+(?:to|for)\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bdo i need a visa for\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bcan i enter\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\b(?:currency|safety|weather)\s+(?:in|for)\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bwhat about\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bfor\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const candidate = sanitizeDestinationCandidate(match?.[1]);
    if (candidate) return candidate;
  }

  if (/^what about\b/i.test(source) && memory?.destination?.label) {
    return memory.destination.label;
  }
  return null;
}

function looksLikeActionFollowup(text) {
  return /\b(next weekend|this weekend|next week|next month|tomorrow|today|tonight|flexible|for \d+ days|for \d+ nights|\d+ days|\d+ nights)\b/i.test(
    String(text || "")
  );
}

function extractDestinationFromRoute(text) {
  const match = clean(text).match(/\bfrom\s+[A-Za-z][A-Za-z\s'-]{1,40}\s+to\s+([A-Za-z][A-Za-z\s'-]{1,40}|[A-Z]{3})\b/i);
  return sanitizeDestinationCandidate(match?.[1]);
}

function isKnowledgeQuestion(text, memory = {}) {
  const raw = lower(text);
  if (
    /\b(visa|entry|admission|immigration|tourist entry|border|arrival)\b/.test(raw) ||
    /\b(currency|exchange rate|exchange|safety|safe|weather)\b/.test(raw) ||
    /\bdo i need a visa\b/.test(raw) ||
    /\bcan i enter\b/.test(raw)
  ) {
    return true;
  }
  if (/^what about\b/i.test(raw) && hasKnowledgeContext(memory) && !isLikelyPoi(raw.replace(/^what about\s+/i, ""))) {
    return true;
  }
  if (/you couldn't find it for\b/i.test(raw) && hasKnowledgeContext(memory)) {
    return true;
  }
  return false;
}

function isActionIntent(text) {
  const raw = lower(text);
  return (
    /\b(show flights|flight options|book flight|compare hotels|show hotels|save this place|save place)\b/.test(raw) ||
    /\bfrom\s+[a-z]{3,40}\s+to\s+[a-z]{3,40}\b/.test(raw)
  );
}

function isNearbyIntent(text) {
  const raw = lower(text);
  return /\bwhat'?s near\b|\bwhich are near\b|\bnear it\b|\bnearby\b|\bnear me\b/.test(raw);
}

function isPlaceLookupIntent(text) {
  const raw = clean(text);
  return Boolean(
    /^what about\b/i.test(raw) ||
      /^tell me about\b/i.test(raw) ||
      (isLikelyPoi(raw) && !/\brequirements?\b/i.test(raw))
  );
}

function isDestinationDiscoveryIntent(text) {
  const raw = lower(text);
  return /\bbest places in\b|\btop places in\b|\bthings to do in\b|\bbest neighborhoods in\b|\bwhere should i go in\b/.test(raw);
}

function buildRuleClassification(overrides) {
  const base = {
    response: null,
    location: null,
    nearMe: null,
    openNow: null,
    lateNight: null,
    rank: null,
    radiusKm: null,
  };
  const next = { ...base, ...overrides };
  return {
    ...next,
    intent: next.intent || inferLegacyIntent(next),
  };
}

function determineIntentFromRules(message, memory = {}) {
  const raw = clean(message);
  const destinationHint = extractDestinationHint(raw);
  const placeSubject = extractPlaceSubject(raw);

  if (isActionIntent(raw)) {
    const hotelLike = /\bhotel|hotels\b/i.test(raw);
    return buildRuleClassification({
      intent: hotelLike ? "hotels" : "flights",
      mode: "travel_action",
      task: hotelLike ? "compare_hotels" : "show_flights",
      query: raw,
      destinationHint: destinationHint || extractDestinationFromRoute(raw) || memory?.destination?.label || null,
      confidence: 0.94,
      nearMe: /\bnear me\b/i.test(raw),
    });
  }

  if (isNearbyIntent(raw)) {
    return buildRuleClassification({
      mode: "nearby_search",
      task: "find_places_near_named_place",
      query: placeSubject || memory?.active_place?.label || raw,
      destinationHint: destinationHint || memory?.destination?.label || null,
      confidence: 0.92,
      nearMe: /\bnear me\b/i.test(raw),
      openNow: /\bopen now\b/i.test(raw),
      lateNight: /\btonight\b|\blate night\b/i.test(raw),
      rank: /\bclosest\b|\bnearby\b/i.test(raw) ? "distance" : null,
    });
  }

  if (isPlaceLookupIntent(raw) && placeSubject) {
    return buildRuleClassification({
      mode: "place_lookup",
      task: "resolve_named_poi",
      query: placeSubject,
      destinationHint: destinationHint || memory?.destination?.label || null,
      confidence: 0.9,
    });
  }

  if (looksLikeTripConstraintFollowup(raw) && hasPlanningContext(memory)) {
    return buildRuleClassification({
      intent: "trip_plan",
      mode: "trip_planning",
      task: "build_trip_outline",
      query: raw,
      destinationHint: destinationHint || memory?.destination?.label || null,
      confidence: 0.9,
    });
  }

  if (looksLikeActionFollowup(raw) && memory?.last_mode === "travel_action") {
    return buildRuleClassification({
      intent: memory?.last_task === "compare_hotels" ? "hotels" : "flights",
      mode: "travel_action",
      task: memory?.last_task === "compare_hotels" ? "compare_hotels" : "show_flights",
      query: raw,
      destinationHint: destinationHint || memory?.destination?.label || null,
      confidence: 0.82,
    });
  }

  if (/\b(plan|itinerary|outline|schedule)\b/i.test(raw)) {
    return buildRuleClassification({
      intent: "trip_plan",
      mode: "trip_planning",
      task: "build_trip_outline",
      query: raw,
      destinationHint: destinationHint || memory?.destination?.label || null,
      confidence: 0.9,
    });
  }

  if (isDestinationDiscoveryIntent(raw)) {
    return buildRuleClassification({
      intent: "activities",
      mode: "destination_discovery",
      task: "discover_top_places",
      query: raw,
      destinationHint: destinationHint || memory?.destination?.label || null,
      confidence: 0.9,
      rank: "popularity",
    });
  }

  if (isKnowledgeQuestion(raw, memory)) {
    const knowledgeSubject = extractKnowledgeSubject(raw, memory);
    const currencyLike = /\bcurrency|exchange rate|exchange\b/i.test(raw);
    return buildRuleClassification({
      intent: "chat",
      mode: "travel_knowledge",
      task: currencyLike ? "answer_currency_question" : "answer_general_travel_question",
      query: raw,
      destinationHint: knowledgeSubject || memory?.destination?.label || null,
      confidence: 0.92,
    });
  }

  if (/^what about\b/i.test(raw) && hasPlanningContext(memory)) {
    const knowledgeSubject = extractKnowledgeSubject(raw, memory);
    if (knowledgeSubject && !isLikelyPoi(knowledgeSubject)) {
      return buildRuleClassification({
        intent: "chat",
        mode: "travel_knowledge",
        task: "answer_general_travel_question",
        query: raw,
        destinationHint: knowledgeSubject,
        confidence: 0.76,
      });
    }
  }

  return null;
}

function postProcessClassification(data, memory, userMessage) {
  const next = { ...data };
  next.destinationHint =
    sanitizeDestinationCandidate(next.destinationHint) ||
    extractDestinationHint(userMessage) ||
    extractKnowledgeSubject(userMessage, memory) ||
    memory?.destination?.label ||
    null;

  if (next.mode === "place_lookup" || next.mode === "nearby_search") {
    next.query = extractPlaceSubject(next.query || userMessage) || clean(next.query || userMessage) || null;
  } else {
    next.query = clean(next.query || userMessage) || null;
  }

  if (looksLikeTripConstraintFollowup(userMessage) && hasPlanningContext(memory)) {
    next.mode = "trip_planning";
    next.task = "build_trip_outline";
    next.intent = "trip_plan";
    next.destinationHint = next.destinationHint || memory?.destination?.label || null;
  }

  return {
    ...next,
    intent: next.intent || inferLegacyIntent(next),
  };
}

export async function classifyAssistantIntent(input = {}) {
  const payload = typeof input === "string" ? { message: input } : input || {};
  const { message, memory } = payload;
  const userMessage = clean(message);
  const safeMemory = memory || {};
  if (!userMessage) return null;

  const deterministic = determineIntentFromRules(userMessage, safeMemory);
  if (deterministic) {
    return postProcessClassification(deterministic, safeMemory, userMessage);
  }

  if (!client) {
    return postProcessClassification(
      buildRuleClassification({
        intent: "chat",
        mode: "travel_knowledge",
        task: "answer_general_travel_question",
        query: userMessage,
        destinationHint: extractDestinationHint(userMessage) || safeMemory?.destination?.label || null,
        confidence: 0.55,
      }),
      safeMemory,
      userMessage
    );
  }

  const { routerModel } = getOpenAIModels();
  const prompt = `
You are the intent router for a Trip Operating System assistant.
Return JSON only.

Use these exact modes only:
- travel_knowledge
- destination_discovery
- place_lookup
- nearby_search
- trip_planning
- travel_action

Respect this precedence:
1. action intent
2. explicit POI / nearby
3. trip planning follow-up with prior planning context
4. destination discovery
5. travel knowledge

Do not classify visa, entry, admission, immigration, border, or currency questions as place lookup.
Do not return a POI as destinationHint.

User message: ${JSON.stringify(userMessage)}
Existing memory: ${JSON.stringify(safeMemory)}
`.trim();

  try {
    const resp = await client.responses.create({
      model: routerModel,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "assistant_intent_v4",
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
    if (!outputText) {
      return postProcessClassification(
        buildRuleClassification({
          intent: "chat",
          mode: "travel_knowledge",
          task: "answer_general_travel_question",
          query: userMessage,
          destinationHint: safeMemory?.destination?.label || null,
          confidence: 0.5,
        }),
        safeMemory,
        userMessage
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return postProcessClassification(
        buildRuleClassification({
          intent: "chat",
          mode: "travel_knowledge",
          task: "answer_general_travel_question",
          query: userMessage,
          destinationHint: safeMemory?.destination?.label || null,
          confidence: 0.5,
        }),
        safeMemory,
        userMessage
      );
    }

    const validated = IntentSchema.safeParse(parsed);
    if (!validated.success) {
      return postProcessClassification(
        buildRuleClassification({
          intent: "chat",
          mode: "travel_knowledge",
          task: "answer_general_travel_question",
          query: userMessage,
          destinationHint: safeMemory?.destination?.label || null,
          confidence: 0.5,
        }),
        safeMemory,
        userMessage
      );
    }

    return postProcessClassification(validated.data, safeMemory, userMessage);
  } catch {
    return postProcessClassification(
      buildRuleClassification({
        intent: "chat",
        mode: "travel_knowledge",
        task: "answer_general_travel_question",
        query: userMessage,
        destinationHint: safeMemory?.destination?.label || null,
        confidence: 0.5,
      }),
      safeMemory,
      userMessage
    );
  }
}
