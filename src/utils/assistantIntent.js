import OpenAI from "openai";
import { z } from "zod";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const IntentSchema = z.object({
  intent: z.enum([
    "chat",
    "trip_plan",
    "spots",
    "restaurants",
    "hotels",
    "activities",
    "flights",
  ]),
  confidence: z.number().min(0).max(1),
  response: z.string().nullable(),
  location: z.string().nullable(),
  nearMe: z.boolean().nullable(),
  query: z.string().nullable(),
  openNow: z.boolean().nullable(),
  lateNight: z.boolean().nullable(),
  rank: z.enum(["distance", "popularity"]).nullable(),
  radiusKm: z.number().nullable(),
});

export async function classifyAssistantIntent(message) {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!message || !String(message).trim()) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const prompt = `
You are a routing assistant for a travel app.
Decide if the user wants a trip plan, a tool-based search (spots/restaurants/hotels/activities/flights), or just chat.
Return JSON only.

Rules:
- Use intent "trip_plan" for itinerary/plan/schedule/build-a-trip requests.
- Use intent "restaurants" for food/dinner/lunch/eat/restaurant queries.
- Use intent "spots" for everyday places (cafe, gym, pharmacy, park, etc.).
- Use "chat" for normal conversation, planning thoughts, or unclear requests.
- Set confidence 0..1.
- If intent is "chat", provide a friendly, human response in "response" (1-2 sentences).
- If near me is mentioned, set nearMe=true.
- If city/location is present, set location.
- If a search query exists (e.g. "sushi", "late night coffee"), put it in query.
- If "open now" mentioned -> openNow=true.
- If "late night" mentioned -> lateNight=true.
- If "closest/nearby" -> rank="distance"; if "best/top" -> rank="popularity".

User message: ${JSON.stringify(String(message))}
`.trim();

  const resp = await client.responses.create({
    model,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "assistant_intent",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "intent",
            "confidence",
            "response",
            "location",
            "nearMe",
            "query",
            "openNow",
            "lateNight",
            "rank",
            "radiusKm",
          ],
          properties: {
            intent: {
              type: "string",
              enum: [
                "chat",
                "trip_plan",
                "spots",
                "restaurants",
                "hotels",
                "activities",
                "flights",
              ],
            },
            confidence: { type: "number" },
            response: { type: ["string", "null"] },
            location: { type: ["string", "null"] },
            nearMe: { type: ["boolean", "null"] },
            query: { type: ["string", "null"] },
            openNow: { type: ["boolean", "null"] },
            lateNight: { type: ["boolean", "null"] },
            rank: { type: ["string", "null"], enum: ["distance", "popularity", null] },
            radiusKm: { type: ["number", "null"] },
          },
        },
      },
    },
    max_output_tokens: 200,
  });

  const outputText = resp.output_text || "";
  if (!outputText.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    return null;
  }

  const validated = IntentSchema.safeParse(parsed);
  if (!validated.success) return null;
  return validated.data;
}
