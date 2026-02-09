import { createClient } from "@supabase/supabase-js";

let cachedAuthClient = null;

function getEnv() {
  return {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  };
}

function getAuthClient() {
  if (cachedAuthClient) return cachedAuthClient;
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = getEnv();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  cachedAuthClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  return cachedAuthClient;
}

export async function requireAuth(req, reply) {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    await reply.code(401).send({ error: "Unauthorized" });
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    await reply.code(401).send({ error: "Unauthorized" });
    return null;
  }

  const supabase = getAuthClient();
  if (!supabase) {
    await reply.code(500).send({ error: "Supabase auth not configured" });
    return null;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    await reply.code(401).send({ error: "Unauthorized" });
    return null;
  }

  return { id: data.user.id };
}
