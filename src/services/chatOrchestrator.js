import { supabaseAdmin } from "../utils/supabaseAdmin.js";
import { classifyAssistantIntent } from "../utils/assistantIntent.js";
import { updateThreadMemory, buildUiHints } from "../utils/threadMemory.js";
import { routeChatTools } from "./chatToolRouter.js";
import { generateChatReply } from "../utils/chatCompletion.js";

function stableString(value) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return "{}";
  }
}

async function loadRecentThreadMessages(threadId, userId, limit = 20) {
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

async function loadThreadMemory(threadId) {
  const { data, error } = await supabaseAdmin
    .from("thread_memory")
    .select("thread_id, memory_json, version, updated_at")
    .eq("thread_id", threadId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function upsertThreadMemory(threadId, memory, currentVersion = 0) {
  const payload = {
    thread_id: threadId,
    memory_json: memory || {},
    version: Number(currentVersion || 0) + 1,
  };

  const { data, error } = await supabaseAdmin
    .from("thread_memory")
    .upsert(payload, { onConflict: "thread_id" })
    .select("thread_id, memory_json, version, updated_at")
    .single();

  if (error) throw error;
  return data;
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

export async function runChatOrchestrator({ threadId, userId, latestUserMessage, logger }) {
  const [recentMessages, memoryRow, summaryRow] = await Promise.all([
    loadRecentThreadMessages(threadId, userId, 20),
    loadThreadMemory(threadId),
    loadThreadSummary(threadId),
  ]);

  const initialMemory = memoryRow?.memory_json || {};
  const classification =
    (await classifyAssistantIntent({
      message: latestUserMessage,
      memory: initialMemory,
    })) || {
      mode: "travel_knowledge",
      task: "answer_general_travel_question",
      query: latestUserMessage,
      destinationHint: null,
      confidence: 0.4,
    };

  const earlyUpdate = updateThreadMemory({
    previousMemory: initialMemory,
    latestUserMessage,
    recentMessages,
    classification,
    resolvedContext: null,
  });

  let currentMemoryRow = memoryRow;
  const earlyMemory = earlyUpdate?.memory || {};
  currentMemoryRow = await upsertThreadMemory(threadId, earlyMemory, currentMemoryRow?.version || 0);

  const toolRouting = await routeChatTools({
    classification,
    memory: currentMemoryRow?.memory_json || earlyMemory,
    latestUserMessage,
    logger,
  });

  const refinedUpdate = updateThreadMemory({
    previousMemory: currentMemoryRow?.memory_json || earlyMemory,
    latestUserMessage,
    recentMessages,
    classification,
    resolvedContext: toolRouting?.resolvedContext || null,
  });

  const refinedMemory = refinedUpdate?.memory || currentMemoryRow?.memory_json || earlyMemory;
  if (stableString(refinedMemory) !== stableString(currentMemoryRow?.memory_json || {})) {
    currentMemoryRow = await upsertThreadMemory(threadId, refinedMemory, currentMemoryRow?.version || 0);
  }

  const toolContext = {
    ...(toolRouting?.toolContext || {}),
    mode: classification.mode,
    task: classification.task,
    classification,
    resolvedContext: toolRouting?.resolvedContext || {},
  };

  const assistantReply = await generateChatReply({
    messages: recentMessages,
    threadSummary: summaryRow?.summary_text || "",
    memory: currentMemoryRow?.memory_json || refinedMemory,
    toolContext,
  });

  const uiHints = buildUiHints(currentMemoryRow?.memory_json || refinedMemory);
  const majorChanged =
    stableString(initialMemory) !== stableString(currentMemoryRow?.memory_json || refinedMemory);

  return {
    assistantMessage: assistantReply,
    context: {
      classification,
      toolContext,
      resolvedContext: toolRouting?.resolvedContext || {},
      recentMessageCount: recentMessages.length,
    },
    memory: currentMemoryRow?.memory_json || refinedMemory,
    memoryVersion: currentMemoryRow?.version || memoryRow?.version || 0,
    memoryMajorChanged: majorChanged,
    cards: Array.isArray(toolRouting?.cards) ? toolRouting.cards : [],
    uiHints,
    summaryText: summaryRow?.summary_text || "",
  };
}
