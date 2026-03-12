import OpenAI from "openai";
import { z } from "zod";
import { getOpenAIModels } from "./openaiModels.js";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const PersonaSchema = z.object({
  persona_key: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  long: z.string().optional().nullable(),
  interests: z.array(z.string()).min(1).max(6),
});

function extractAnyJsonOrText(resp) {
  // 1) convenience field
  const t = (resp.output_text || "").trim();
  if (t) return { raw: t, source: "resp.output_text" };

  // 2) walk resp.output content
  const out = resp.output || [];
  for (const item of out) {
    const content = item?.content || [];
    for (const c of content) {
      // common case
      if (c?.type === "output_text" && typeof c.text === "string" && c.text.trim()) {
        return { raw: c.text.trim(), source: "resp.output[].content.output_text" };
      }

      // IMPORTANT: structured outputs sometimes come back as JSON content
      if (c?.type === "output_json") {
        // some SDKs use c.json, some use c.value. log will reveal it.
        const jsonVal = c.json ?? c.value ?? c.data;
        if (jsonVal) return { raw: JSON.stringify(jsonVal), source: "resp.output[].content.output_json" };
      }

      // refusals
      if (c?.type === "refusal" && typeof c.refusal === "string" && c.refusal.trim()) {
        return { raw: c.refusal.trim(), source: "resp.output[].content.refusal" };
      }
    }
  }

  return { raw: "", source: "none" };
}

export async function buildPersonaFromProfile(profile) {
  if (!client) {
    throw new Error("Missing OPENAI_API_KEY for persona generation");
  }

  const { chatModel } = getOpenAIModels();

  // LOG WHAT'S GOING IN
  console.log("\n[persona] ===== BUILD PERSONA START =====");
  console.log("[persona] model:", chatModel);
  console.log("[persona] profile:", JSON.stringify(profile, null, 2));

  const input = `
Create a travel persona from this user's saved onboarding profile.
Keep it useful for itinerary planning, not corny.

Return JSON with this exact shape:
{
  "persona_key": "snake_case_id",
  "title": "Short title",
  "summary": "1-2 sentences",
  "long": "optional longer paragraph or null",
  "interests": ["up to 6 short interest tags"]
}

Rules:
- Make interests align tightly with the user's choices (travel_types, travel_with, spending, day_rhythm, social_style).
- Keep title short.
- Summary should be behavior-based and concrete.

Profile:
${JSON.stringify(profile, null, 2)}
`.trim();

  console.log("[persona] input prompt being sent to OpenAI (first 2500 chars):");
  console.log(input.slice(0, 2500));
  console.log("[persona] input length:", input.length);

  const resp = await client.responses.create({
    model: chatModel,
    input,
    text: {
      format: {
        type: "json_schema",
        name: "travel_persona",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["persona_key", "title", "summary", "long", "interests"],
          properties: {
            persona_key: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            long: { type: ["string", "null"] },
            interests: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 6,
            },
          },
        },
      },
    },
    max_output_tokens: 500,
  });

  // LOG WHAT'S COMING OUT
  console.log("[persona] resp.output_text length:", (resp.output_text || "").length);
  console.log("[persona] resp.output preview (first 6000 chars):");
  console.log(JSON.stringify(resp.output, null, 2).slice(0, 6000));

  const { raw, source } = extractAnyJsonOrText(resp);
  console.log("[persona] extracted source:", source);
  console.log("[persona] extracted raw preview (first 1200 chars):", JSON.stringify(raw.slice(0, 1200)));

  if (!raw) {
    throw new Error("Model returned empty output (check resp.output preview above)");
  }

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    console.log("[persona] JSON.parse failed. Raw (first 2000 chars):");
    console.log(raw.slice(0, 2000));
    throw new Error("Model did not return valid JSON");
  }

  const parsed = PersonaSchema.safeParse(obj);
  if (!parsed.success) {
    console.log("[persona] validation issues:", parsed.error.issues);
    console.log("[persona] obj:", obj);
    throw new Error("Persona JSON failed validation");
  }

  console.log("[persona] ===== BUILD PERSONA SUCCESS =====\n");

  return {
    ...parsed.data,
    interests: parsed.data.interests.slice(0, 3),
    long: parsed.data.long ?? null,
  };
}
