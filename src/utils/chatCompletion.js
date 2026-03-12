import OpenAI from "openai";
import { getOpenAIModels } from "./openaiModels.js";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

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
  const userQuery = String(toolContext?.userQuery || "").trim();

  if (mode === "place_lookup") {
    const place = toolContext?.resolvedPlace?.label || memory?.active_place?.label || "that place";
    const top = Array.isArray(toolContext?.attractionResults) ? toolContext.attractionResults[0] : null;
    if (top?.name) {
      return `${top.name} appears to be the closest exact match for ${place}. Want nearby options next?`;
    }
    return `I’m not fully confident about ${place} yet. If you want, give me the city or country and I’ll narrow it down.`;
  }

  if (mode === "nearby_search") {
    const place = toolContext?.resolvedPlace?.label || memory?.active_place?.label || "that place";
    const names = (toolContext?.attractionResults || []).slice(0, 3).map((x) => x?.name).filter(Boolean);
    if (names.length) {
      return `Near ${place}, good options include ${names.join(", ")}.`;
    }
    return `I couldn’t find solid nearby results around ${place} yet. I can broaden the search or switch to the surrounding city if you want.`;
  }

  if (mode === "destination_discovery") {
    const dest = memory?.destination?.label || toolContext?.destinationHint || "your destination";
    const names = (toolContext?.attractionResults || []).slice(0, 4).map((x) => x?.name).filter(Boolean);
    if (names.length) return `Top places in ${dest}: ${names.join(", ")}.`;
    return `I can help with top places, neighborhoods, and things to do in ${dest}.`;
  }

  if (mode === "trip_planning") {
    const planTitle = toolContext?.planningOutput?.title || "Trip outline";
    return `${planTitle} is ready. I can refine it by budget, pace, or interests.`;
  }

  if (mode === "travel_action" && task === "show_flights") {
    return "I can show flights using your saved destination and dates. If needed, tell me your origin city.";
  }

  if (mode === "travel_action" && task === "compare_hotels") {
    return "I can compare hotels once I have the destination and dates.";
  }

  if (mode === "travel_knowledge") {
    const subject = memory?.destination?.label || toolContext?.destinationHint || null;
    const asksEntryRules = /\bvisa|entry|admission|immigration|border|arrival\b/i.test(userQuery);
    const mentionsNationality = /\bpassport\b|\bi am\b|\bamerican\b|\bcanadian\b|\buk\b|\bindian\b|\baustralian\b/i.test(userQuery);
    const asksCurrency = /\bcurrency|exchange rate|exchange\b/i.test(userQuery);

    if (asksCurrency && subject) {
      return `They use the local currency in ${subject}. If you want, I can also help with exchange-rate context.`;
    }
    if (asksEntryRules && subject && !mentionsNationality) {
      return `I can help with ${subject} entry rules. What passport are you traveling on?`;
    }
    if (subject) {
      return `I can help with ${subject} travel questions like visas, entry rules, currency, safety, weather, flights, and hotels.`;
    }
  }

  return "I can help with visas, entry rules, places to go, itinerary ideas, flights, and hotels.";
}

export async function generateChatReply({ messages, threadSummary, memory, toolContext }) {
  if (!client) {
    return fallbackReply({ memory, toolContext });
  }

  const { chatModel } = getOpenAIModels();
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
            "Keep replies concise, useful, action-oriented, and plain text. " +
            "Do not use markdown, bold markers, headings, or code formatting.",
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

  try {
    const resp = await client.responses.create({
      model: chatModel,
      input,
      max_output_tokens: 700,
    });

    const text = extractOutputText(resp);
    if (!text) {
      return fallbackReply({ memory, toolContext });
    }
    return text;
  } catch {
    return fallbackReply({ memory, toolContext });
  }
}
