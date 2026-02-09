import { z } from "zod";
import { supabaseAdmin } from "../utils/supabaseAdmin.js";
import { buildPersonaFromProfile } from "../utils/persona.js";

const AuthHeaderSchema = z.string().min(1);

function getBearerToken(req) {
  const h = req.headers.authorization;
  const parsed = AuthHeaderSchema.safeParse(h);
  if (!parsed.success) return null;

  const val = parsed.data;
  if (!val.toLowerCase().startsWith("bearer ")) return null;
  return val.slice(7).trim();
}

export async function onboardingRoutes(app) {
  app.post("/v1/onboarding/build-persona", async (req, reply) => {
    const token = getBearerToken(req);
    if (!token) return reply.code(401).send({ error: "Missing bearer token" });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return reply.code(401).send({ error: "Invalid token" });

    const userId = userData.user.id;

    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select(
        [
          "id",
          "full_name",
          "age",
          "gender",
          "travel_with",
          "location",
          "travel_spending_habit",
          "travel_day_rhythm",
          "travel_social_style",
          "travel_types",
        ].join(",")
      )
      .eq("id", userId)
      .single();

    if (pErr || !profile) return reply.code(400).send({ error: "Profile not found" });

    let persona;
    try {
        console.log("[onboarding] userId:", userId);
        console.log("[onboarding] profile being sent to persona builder:", JSON.stringify(profile, null, 2));

      persona = await buildPersonaFromProfile(profile);
    } catch (e) {
      // This ensures you see the logs from persona.js and returns readable info to the app
      req.log.error({ err: e }, "buildPersonaFromProfile failed");
      return reply.code(500).send({
        error: "Persona build failed",
        message: e?.message ?? String(e),
      });
    }

    const { error: saveErr } = await supabaseAdmin
      .from("profiles")
      .update({
        persona_key: persona.persona_key,
        persona_title: persona.title,
        persona_summary: persona.summary,
        persona_long: persona.long,
        persona_interests: persona.interests,
        persona_generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (saveErr) return reply.code(500).send({ error: "Failed to save persona" });

    return reply.send(persona);
  });
}
