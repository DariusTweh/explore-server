import OpenAI from "openai";
import { getOpenAIModels } from "./openaiModels.js";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export async function generatePlanOutline({
  promptText,
  destinationLabel,
  startDate,
  endDate,
  budget,
  vibe,
  travelers,
}) {
  if (!client) return null;

  const { chatModel } = getOpenAIModels();
  const system = `
You create short trip outlines for a travel app.
Return JSON only and follow the schema strictly.
Do not invent lat/lng or IDs. Use plain titles and query intents.
Keep it compact: 2-4 items per day. If dates are missing, return null for them.
Every day must include lunch and dinner as items unless the user explicitly says otherwise.
Return items in the order you expect them to happen.
Use timeWindow, not just timeOfDay.
Do not add a separate meals section.
Favor distinct attractions across days and avoid repeating the same venue category back-to-back.
Make arrival and departure days lighter than full middle days.
`.trim();

  const input = {
    promptText,
    destinationLabel,
    startDate,
    endDate,
    budget,
    vibe,
    travelers,
  };

  const resp = await client.responses.create({
    model: chatModel,
    input: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(input) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "trip_plan_outline",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "destinationLabel",
            "startDate",
            "endDate",
            "days",
            "highlights",
            "flightIntent",
          ],
          properties: {
            title: { type: "string" },
            destinationLabel: { type: "string" },
            startDate: { type: ["string", "null"] },
            endDate: { type: ["string", "null"] },
            highlights: { type: "array", items: { type: "string" }, minItems: 1 },
            flightIntent: {
              type: "object",
              additionalProperties: false,
              required: ["fromAirportCode", "toAirportCode", "preference", "maxStops", "cabinClass"],
              properties: {
                fromAirportCode: { type: ["string", "null"] },
                toAirportCode: { type: ["string", "null"] },
                preference: {
                  type: "string",
                  enum: ["cheapest", "best", "earliest", "latest"],
                },
                maxStops: { type: "integer", minimum: 0, maximum: 3 },
                cabinClass: {
                  type: ["string", "null"],
                  enum: ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST", null],
                },
              },
            },
            days: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "theme", "dayStartTime", "dayEndTime", "maxActivities", "items"],
                properties: {
                  label: { type: ["string", "null"] },
                  theme: { type: ["string", "null"] },
                  dayStartTime: { type: "string" },
                  dayEndTime: { type: "string" },
                  maxActivities: { type: "integer", minimum: 1, maximum: 6 },
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: [
                          "type",
                          "title",
                          "query",
                          "sourcePreference",
                          "timeWindow",
                          "durationMin",
                          "notes",
                        ],
                        properties: {
                          type: {
                            type: "string",
                            enum: ["attraction", "restaurant", "place", "flight", "hotel", "transit"],
                        },
                        title: { type: "string" },
                        timeWindow: {
                          type: "string",
                          enum: ["morning", "lunch", "afternoon", "dinner", "evening"],
                        },
                        query: { type: ["string", "null"] },
                        sourcePreference: {
                          type: ["string", "null"],
                          enum: [
                            "google",
                            "booking_attractions",
                            "booking_hotels",
                            "booking_flights",
                            null,
                          ],
                        },
                        durationMin: { type: ["integer", "null"], minimum: 15, maximum: 480 },
                        notes: { type: ["string", "null"] },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    max_output_tokens: 700,
  });

  const outputText = resp.output_text || "";
  if (!outputText.trim()) return null;
  try {
    return JSON.parse(outputText);
  } catch {
    return null;
  }
}
