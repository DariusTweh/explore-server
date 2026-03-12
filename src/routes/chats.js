import { requireAuth } from "../utils/requireAuth.js";
import { supabaseAdmin } from "../utils/supabaseAdmin.js";
import { buildThreadSummary, shouldRefreshSummary } from "../utils/threadMemory.js";
import { runChatOrchestrator } from "../services/chatOrchestrator.js";

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

async function getThreadMessageCount(threadId, userId) {
  const { count, error } = await supabaseAdmin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("user_id", userId);

  if (error) throw error;
  return Number(count || 0);
}

async function loadThreadSummary(threadId) {
  const { data, error } = await supabaseAdmin
    .from("thread_summaries")
    .select("thread_id, summary_text, updated_at")
    .eq("thread_id", threadId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadRecentMessages(threadId, userId, limit = 20) {
  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (Array.isArray(data) ? data : []).reverse();
}

async function loadThreadMemory(threadId, userId) {
  const { data, error } = await supabaseAdmin
    .from("thread_memory")
    .select("thread_id, user_id, memory_json, updated_at")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function upsertThreadMemory(threadId, userId, memory) {
  const payload = {
    thread_id: threadId,
    user_id: userId,
    memory_json: memory || {},
  };
  const { data, error } = await supabaseAdmin
    .from("thread_memory")
    .upsert(payload, { onConflict: "thread_id" })
    .select("thread_id, user_id, memory_json, updated_at")
    .single();
  if (error) throw error;
  return data;
}

async function upsertThreadSummary(threadId, summaryText) {
  const payload = {
    thread_id: threadId,
    summary_text: String(summaryText || ""),
  };
  const { data, error } = await supabaseAdmin
    .from("thread_summaries")
    .upsert(payload, { onConflict: "thread_id" })
    .select("thread_id, summary_text, updated_at")
    .single();
  if (error) throw error;
  return data;
}

async function touchThreadOnUserSend(threadId, userId, preview) {
  return touchThread(threadId, userId, preview);
}

async function touchThread(threadId, userId, preview) {
  const patch = {
    last_message_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_message_preview: String(preview || "").slice(0, 180),
  };
  await supabaseAdmin
    .from("chat_threads")
    .update(patch)
    .eq("id", threadId)
    .eq("user_id", userId);
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

  app.post("/:threadId/messages", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const { threadId } = req.params;
    const role = String(req.body?.role || "").trim();
    const content = String(req.body?.content || "").trim();

    if ((role !== "user" && role !== "assistant") || !content) {
      return reply.code(400).send({ error: "Role and content are required" });
    }

    const thread = await getOwnedThread(threadId, authUser.id);
    if (!thread) {
      return reply.code(404).send({ error: "Chat not found" });
    }

    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .insert({
        thread_id: threadId,
        user_id: authUser.id,
        role,
        content,
      })
      .select("id, role, content, created_at")
      .single();

    if (error) {
      req.log.error({ error }, "save chat message failed");
      return reply.code(500).send({ error: "Failed to save message" });
    }

    if (!thread.title && role === "user") {
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

    return reply.send(data);
  });

  app.delete("/:threadId", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const { threadId } = req.params;
    const thread = await getOwnedThread(threadId, authUser.id);
    if (!thread) {
      return reply.code(404).send({ error: "Chat not found" });
    }

    const messageCount = await getThreadMessageCount(threadId, authUser.id);
    if (messageCount > 0) {
      return reply.send({ deleted: false });
    }

    const { error } = await supabaseAdmin
      .from("chat_threads")
      .delete()
      .eq("id", threadId)
      .eq("user_id", authUser.id);

    if (error) {
      req.log.error({ error }, "delete empty chat thread failed");
      return reply.code(500).send({ error: "Failed to delete chat thread" });
    }

    return reply.send({ deleted: true });
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

    await touchThreadOnUserSend(threadId, authUser.id, content);

    let orchestration;
    try {
      const [recentMessages, memoryRow, summaryRow] = await Promise.all([
        loadRecentMessages(threadId, authUser.id, 20),
        loadThreadMemory(threadId, authUser.id),
        loadThreadSummary(threadId),
      ]);

      orchestration = await runChatOrchestrator({
        threadId,
        userId: authUser.id,
        latestUserMessage: content,
        recentMessages,
        previousMemory: memoryRow?.memory_json || {},
        threadSummary: summaryRow?.summary_text || "",
        logger: req.log,
      });

      await upsertThreadMemory(threadId, authUser.id, orchestration.memory || {});
    } catch (error) {
      req.log.error({ error }, "chat orchestration failed");
      return reply.code(502).send({ error: "Could not get response. Try again." });
    }

    const { data: assistantMessage, error: assistantInsertError } = await supabaseAdmin
      .from("chat_messages")
      .insert({
        thread_id: threadId,
        user_id: authUser.id,
        role: "assistant",
        content: orchestration.assistantMessage,
      })
      .select("id, role, content, created_at")
      .single();

    if (assistantInsertError) {
      req.log.error({ error: assistantInsertError }, "save assistant chat message failed");
      return reply.code(500).send({ error: "Failed to save assistant response" });
    }

    let nextSummary = orchestration.summaryText || "";
    try {
      const messageCount = await getThreadMessageCount(threadId, authUser.id);
      const latestSummaryRow = await loadThreadSummary(threadId);

      const refreshSummary = shouldRefreshSummary({
        messageCount,
        majorChanged: orchestration.memoryMajorChanged,
        existingSummary: latestSummaryRow?.summary_text || orchestration.summaryText || "",
      });
      if (refreshSummary) {
        nextSummary = buildThreadSummary(orchestration.memory || {});
        await upsertThreadSummary(threadId, nextSummary);
      } else {
        nextSummary = latestSummaryRow?.summary_text || orchestration.summaryText || "";
      }
    } catch (error) {
      req.log.warn({ error }, "thread summary refresh failed");
    }

    await touchThread(threadId, authUser.id, orchestration.assistantMessage);

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
      threadId,
      assistantMessage: {
        id: assistantMessage.id,
        role: "assistant",
        content: assistantMessage.content,
        created_at: assistantMessage.created_at,
      },
      assistantText: assistantMessage.content,
      context: orchestration.context,
      memory: orchestration.memory,
      cards: Array.isArray(orchestration.cards) ? orchestration.cards : [],
      summary: nextSummary,
      uiHints: orchestration.uiHints,
    });
  });
}
