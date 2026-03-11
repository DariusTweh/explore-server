import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function extractOutputText(resp) {
  const direct = String(resp?.output_text || "").trim();
  if (direct) return direct;

  const output = Array.isArray(resp?.output) ? resp.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }

  return "";
}

function fallbackReply({ memory, toolContext }) {
  const mode = toolContext?.mode || memory?.last_mode || "travel_knowledge";
  const task = toolContext?.task || memory?.last_task || "answer_general_travel_question";

  if (mode === "place_lookup") {
    const place = toolContext?.resolvedPlace?.label || memory?.active_place?.label || "that place";
    const top = Array.isArray(toolContext?.attractionResults) ? toolContext.attractionResults[0] : null;
    if (top?.name) {
      return `${top.name} appears to be the closest exact match for ${place}. Want nearby options next?`;
    }
    return `I couldn't confirm an exact match for ${place} yet. Share the city or country and I'll refine it.`;
  }

  if (mode === "nearby_search") {
    const place = toolContext?.resolvedPlace?.label || memory?.active_place?.label || "that place";
    const names = (toolContext?.attractionResults || []).slice(0, 3).map((x) => x?.name).filter(Boolean);
    if (names.length) {
      return `Near ${place}, good options include ${names.join(", ")}.`;
    }
    return `I couldn't find nearby results around ${place} with confidence yet.`;
  }

  if (mode === "destination_discovery") {
    const dest = memory?.destination?.label || toolContext?.destinationHint || "your destination";
    const names = (toolContext?.attractionResults || []).slice(0, 4).map((x) => x?.name).filter(Boolean);
    if (names.length) return `Top places in ${dest}: ${names.join(", ")}.`;
    return `I can help discover top places in ${dest}.`;
  }

  if (mode === "trip_planning") {
    const planTitle = toolContext?.planningOutput?.title || "Trip outline";
    return `${planTitle} is ready. I can refine it by budget, pace, or interests.`;
  }

  if (mode === "travel_action" && task === "show_flights") {
    return "I can show flights using your saved destination and dates. If needed, tell me your origin city.";
  }

  return "I can help with destination discovery, exact place lookup, nearby search, trip planning, or travel actions.";
}

export async function generateChatReply({ messages, threadSummary, memory, toolContext }) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackReply({ memory, toolContext });
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const summaryText = String(threadSummary || "No summary yet.");
  const memoryText = JSON.stringify(memory || {}, null, 2);
  const toolContextText = JSON.stringify(toolContext || {}, null, 2);

  const input = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text:
            "You are the Trip Operating System assistant for private chat. " +
            "Use toolContext as the primary source of truth. " +
            "Do not invent places, nearby results, prices, or resolved POIs. " +
            "If toolContext lacks evidence, say so briefly and ask one concrete follow-up. " +
            "For exact named place lookup, prioritize the resolved place and exact-matching attraction results. " +
            "If user asks what is near a named place, only discuss nearby results grounded in toolContext. " +
            "Keep replies concise, useful, and action-oriented.",
        },
      ],
    },
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: `Thread summary:\n${summaryText}`,
        },
      ],
    },
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: `Structured memory JSON:\n${memoryText}`,
        },
      ],
    },
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: `Grounded toolContext JSON (primary basis):\n${toolContextText}`,
        },
      ],
    },
    ...messages.map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: [{ type: "input_text", text: String(message.content || "") }],
    })),
  ];

  const resp = await client.responses.create({
    model,
    input,
    max_output_tokens: 700,
  });

  const text = extractOutputText(resp);
  if (!text) {
    throw new Error("Assistant returned empty output");
  }

  return text;
}
