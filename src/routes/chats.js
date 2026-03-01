import { requireAuth } from "../utils/requireAuth.js";
import { supabaseAdmin } from "../utils/supabaseAdmin.js";
import { generateChatReply } from "../utils/chatCompletion.js";

function buildThreadTitle(content) {
  const words = String(content || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 8);

  return words.length ? words.join(" ") : null;
}

async function getOwnedThread(threadId, userId) {
  const { data, error } = await supabaseAdmin
    .from("chat_threads")
    .select("id, user_id, title, trip_id")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function chatsRoutes(app) {
  app.post("/thread", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const body = req.body || {};
    const title =
      typeof body.title === "string" && body.title.trim() ? body.title.trim() : null;
    const tripId =
      typeof body.trip_id === "string" && body.trip_id.trim() ? body.trip_id.trim() : null;

    const { data, error } = await supabaseAdmin
      .from("chat_threads")
      .insert({
        user_id: authUser.id,
        title,
        trip_id: tripId,
      })
      .select("id")
      .single();

    if (error) {
      req.log.error({ error }, "create chat thread failed");
      return reply.code(500).send({ error: "Failed to create chat thread" });
    }

    return reply.send({ threadId: data.id });
  });

  app.get("/threads", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const { data, error } = await supabaseAdmin
      .from("chat_threads")
      .select("id, title, updated_at, last_message_preview, last_message_at, trip_id")
      .eq("user_id", authUser.id)
      .order("updated_at", { ascending: false })
      .limit(25);

    if (error) {
      req.log.error({ error }, "list chat threads failed");
      return reply.code(500).send({ error: "Failed to load chat threads" });
    }

    return reply.send(Array.isArray(data) ? data : []);
  });

  app.get("/:threadId/messages", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const { threadId } = req.params;
    const parsedLimit = Number(req.query?.limit);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;

    const thread = await getOwnedThread(threadId, authUser.id);
    if (!thread) {
      return reply.code(404).send({ error: "Chat not found" });
    }

    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .select("id, role, content, created_at")
      .eq("thread_id", threadId)
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      req.log.error({ error }, "load chat messages failed");
      return reply.code(500).send({ error: "Failed to load chat messages" });
    }

    return reply.send((Array.isArray(data) ? data : []).reverse());
  });

  app.post("/:threadId/send", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const { threadId } = req.params;
    const content = String(req.body?.content || "").trim();

    if (!content) {
      return reply.code(400).send({ error: "Content is required" });
    }

    const thread = await getOwnedThread(threadId, authUser.id);
    if (!thread) {
      return reply.code(404).send({ error: "Chat not found" });
    }

    const { error: userInsertError } = await supabaseAdmin.from("chat_messages").insert({
      thread_id: threadId,
      user_id: authUser.id,
      role: "user",
      content,
    });

    if (userInsertError) {
      req.log.error({ error: userInsertError }, "save user chat message failed");
      return reply.code(500).send({ error: "Failed to save message" });
    }

    const { data: history, error: historyError } = await supabaseAdmin
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("thread_id", threadId)
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (historyError) {
      req.log.error({ error: historyError }, "load chat history failed");
      return reply.code(500).send({ error: "Failed to build assistant context" });
    }

    let assistantReply;
    try {
      assistantReply = await generateChatReply((Array.isArray(history) ? history : []).reverse());
    } catch (error) {
      req.log.error({ error }, "assistant chat completion failed");
      return reply.code(502).send({ error: "Could not get response. Try again." });
    }

    const { data: assistantMessage, error: assistantInsertError } = await supabaseAdmin
      .from("chat_messages")
      .insert({
        thread_id: threadId,
        user_id: authUser.id,
        role: "assistant",
        content: assistantReply,
      })
      .select("role, content, created_at")
      .single();

    if (assistantInsertError) {
      req.log.error({ error: assistantInsertError }, "save assistant chat message failed");
      return reply.code(500).send({ error: "Failed to save assistant response" });
    }

    if (!thread.title) {
      const title = buildThreadTitle(content);
      if (title) {
        const { error: titleError } = await supabaseAdmin
          .from("chat_threads")
          .update({ title })
          .eq("id", threadId)
          .eq("user_id", authUser.id);

        if (titleError) {
          req.log.warn({ error: titleError }, "update chat thread title failed");
        }
      }
    }

    return reply.send({
      assistantMessage: {
        role: "assistant",
        content: assistantMessage.content,
        created_at: assistantMessage.created_at,
      },
    });
  });
}
