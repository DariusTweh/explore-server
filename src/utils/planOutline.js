import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generatePlanOutline({
  promptText,
  destinationLabel,
  startDate,
  endDate,
  budget,
  vibe,
  travelers,
}) {
  if (!process.env.OPENAI_API_KEY) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const system = `
You create short trip outlines for a travel app.
Return JSON only and follow the schema strictly.
Do not invent lat/lng or IDs. Use plain titles and query intents.
Keep it compact: 2-4 items per day. If dates are missing, return null for them.
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
    model,
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
          required: ["title", "destinationLabel", "startDate", "endDate", "days", "highlights"],
          properties: {
            title: { type: "string" },
            destinationLabel: { type: "string" },
            startDate: { type: ["string", "null"] },
            endDate: { type: ["string", "null"] },
            highlights: { type: "array", items: { type: "string" }, minItems: 1 },
            days: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "theme", "items"],
                properties: {
                  label: { type: ["string", "null"] },
                  theme: { type: ["string", "null"] },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["type", "title", "timeOfDay", "query", "sourcePreference"],
                      properties: {
                        type: {
                          type: "string",
                          enum: ["place", "attraction", "hotel", "note"],
                        },
                        title: { type: "string" },
                        timeOfDay: {
                          type: ["string", "null"],
                          enum: [
                            "morning",
                            "midday",
                            "afternoon",
                            "evening",
                            "night",
                            null,
                          ],
                        },
                        query: { type: ["string", "null"] },
                        sourcePreference: {
                          type: ["string", "null"],
                          enum: ["google", "booking_attractions", "booking_hotels", null],
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
