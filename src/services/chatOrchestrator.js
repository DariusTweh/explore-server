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

function shouldRouteTools(classification) {
  const mode = classification?.mode || "travel_knowledge";
  if (mode === "travel_knowledge") return false;
  if (mode === "trip_planning") return true;
  if (mode === "travel_action") return true;
  if (mode === "nearby_search" || mode === "place_lookup") return true;
  if (mode === "destination_discovery") return true;
  return false;
}

export async function runChatOrchestrator({
  threadId,
  userId,
  latestUserMessage,
  recentMessages,
  previousMemory,
  threadSummary,
  logger,
}) {
  const initialMemory = previousMemory || {};
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

  const toolRouting = shouldRouteTools(classification)
    ? await routeChatTools({
        classification,
        memory: initialMemory,
        latestUserMessage,
        logger,
      })
    : {
        toolContext: {
          mode: classification.mode,
          task: classification.task,
          destinationHint: classification.destinationHint || initialMemory?.destination?.label || null,
          userQuery: classification.query || latestUserMessage || null,
          fallbackNotes: [],
        },
        cards: [],
        resolvedContext: {},
      };

  const refinedUpdate = updateThreadMemory({
    previousMemory: initialMemory,
    latestUserMessage,
    recentMessages,
    classification,
    resolvedContext: toolRouting?.resolvedContext || null,
  });

  const refinedMemory = refinedUpdate?.memory || initialMemory;

  const toolContext = {
    ...(toolRouting?.toolContext || {}),
    mode: classification.mode,
    task: classification.task,
    classification,
    resolvedContext: toolRouting?.resolvedContext || {},
  };

  const assistantReply = await generateChatReply({
    messages: recentMessages,
    threadSummary: threadSummary || "",
    memory: refinedMemory,
    toolContext,
  });

  const uiHints = buildUiHints(refinedMemory);
  const majorChanged = stableString(initialMemory) !== stableString(refinedMemory);

  return {
    assistantMessage: assistantReply,
    context: {
      classification,
      toolContext,
      resolvedContext: toolRouting?.resolvedContext || {},
      recentMessageCount: Array.isArray(recentMessages) ? recentMessages.length : 0,
      threadId,
      userId,
    },
    memory: refinedMemory,
    memoryMajorChanged: majorChanged,
    cards: Array.isArray(toolRouting?.cards) ? toolRouting.cards : [],
    uiHints,
    summaryText: threadSummary || "",
  };
}
