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

const DESTINATION_HIGHLIGHTS = {
  germany: [
    "Berlin for history, museums, and nightlife",
    "Munich for Bavarian culture, beer halls, and alpine day trips",
    "Hamburg for a waterfront city feel and strong food scene",
    "Cologne for the cathedral, lively neighborhoods, and easy Rhine access",
    "The Rhine Valley or Black Forest for castles, scenery, and smaller-town charm",
  ],
  japan: [
    "Tokyo for food, neighborhoods, and big-city energy",
    "Kyoto for temples, gardens, and traditional atmosphere",
    "Osaka for nightlife, street food, and a more casual feel",
    "Hakone for hot springs and Mount Fuji views",
    "Hokkaido for nature, hiking, and winter trips",
  ],
};

const STAY_GUIDES = {
  tokyo: [
    "Shinjuku if you want convenience, nightlife, and major train access",
    "Shibuya for first-timers who want energy, shopping, and late nights",
    "Ginza or Marunouchi for a polished, upscale base",
    "Asakusa or Ueno for a quieter, more traditional feel and better value",
    "Ebisu or Nakameguro for a more local, stylish neighborhood feel",
  ],
};

function formatBullets(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function getSubject(memory, toolContext) {
  return memory?.destination?.label || toolContext?.destinationHint || null;
}

function buildDestinationAdviceReply(subject) {
  const normalized = String(subject || "").trim().toLowerCase();
  const curated = DESTINATION_HIGHLIGHTS[normalized];
  if (curated?.length) {
    return `A strong starter list for ${subject} is:\n${formatBullets(curated)}\nIf you want, I can narrow that down by nightlife, scenery, food, or first-time visits.`;
  }
  if (subject) {
    return `${subject} is broad, so I’d narrow it by vibe first. If you want, I can break it down by big cities, scenery, food, nightlife, or a first-time itinerary.`;
  }
  return "I can narrow it down fast if you tell me the destination and what kind of trip you want.";
}

function buildWhereToStayReply(subject) {
  const normalized = String(subject || "").trim().toLowerCase();
  const curated = STAY_GUIDES[normalized];
  if (curated?.length) {
    return `If you're choosing where to stay in ${subject}, I’d usually frame it like this:\n${formatBullets(curated)}\nIf you want, I can narrow it down for first-time, nightlife, budget, or luxury.`;
  }
  if (subject) {
    return `The best area in ${subject} depends on whether you care most about convenience, nightlife, budget, or a more local feel. If you want, I can break the city into the best neighborhoods for each.`;
  }
  return "The best place to stay depends on the city and your style. Tell me the destination and I can break it down by first-time, nightlife, budget, and luxury.";
}

function buildBudgetReply(subject) {
  if (subject && /japan/i.test(subject)) {
    return "Japan can be done on a budget, but it is not the cheapest destination. Roughly: budget travelers often land around 80 to 140 USD per day, midrange around 180 to 300, and luxury goes well above that. Tokyo and Kyoto are pricier than many smaller cities. If you want, I can break that down by hotels, food, and trains.";
  }
  if (subject) {
    return `${subject} can vary a lot by season and travel style. A budget trip usually means simpler hotels and transit-heavy days, while midrange and luxury rise quickly in popular areas. If you want, I can break it down by daily budget tiers.`;
  }
  return "Trip cost depends a lot on the destination, season, and travel style. Tell me where you're thinking about going and I can sketch budget, midrange, and luxury ranges.";
}

function fallbackReply({ memory, toolContext }) {
  const mode = toolContext?.mode || memory?.last_mode || "travel_knowledge";
  const task = toolContext?.task || memory?.last_task || "answer_general_travel_question";
  const userQuery = String(toolContext?.userQuery || "").trim();
  const subject = getSubject(memory, toolContext);

  const flightTimeQuestion = /\b(avg flight time|average flight time|flight time|how long is the flight|how long is a flight)\b/i.test(
    userQuery
  );
  const cruisePassportQuestion = /\bcruise\b/i.test(userQuery) && /\bpassport\b/i.test(userQuery);
  const passportQuestion = /\b(passport requirements?|do i need a passport|need a passport)\b/i.test(userQuery);
  const whereToStayQuestion = /\b(where should i stay|where to stay|best area to stay|best neighborhood to stay)\b/i.test(
    userQuery
  );
  const budgetQuestion = /\b(is .+ expensive|how expensive is|cost of travel in|budget for)\b/i.test(userQuery);
  const destinationAdviceQuestion = /\b(best places in|top places in|things to do in|best neighborhoods in|where should i go in)\b/i.test(
    userQuery
  );
  const asksCurrency = /\bcurrency|exchange rate|exchange\b/i.test(userQuery);
  const asksEntryRules = /\bvisa|entry|admission|immigration|border|arrival\b/i.test(userQuery);
  const mentionsNationality = /\bpassport\b|\bi am\b|\bamerican\b|\bcanadian\b|\buk\b|\bindian\b|\baustralian\b/i.test(userQuery);

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

  if (mode === "trip_planning") {
    const planTitle = toolContext?.planningOutput?.title || "Trip outline";
    return `${planTitle} is ready. I can refine it by budget, pace, or interests.`;
  }

  if (mode === "travel_action" && task === "show_flights") {
    return "Tell me your departure city if you want me to narrow the flight options.";
  }

  if (mode === "travel_action" && task === "compare_hotels") {
    return "Tell me the destination and dates and I can compare hotel options.";
  }

  if (mode === "destination_discovery" || mode === "travel_knowledge") {
    if (flightTimeQuestion) {
      const origin = memory?.origin?.label || null;
      if (origin && subject) {
        return `From ${origin} to ${subject}, nonstop flights are often around 8 to 12 hours, and one-stop options can run longer. If you want, tell me the exact city pair and I can narrow it down.`;
      }
      if (subject) {
        return `From the U.S. to ${subject}, nonstop flights are usually around 7 to 10 hours from the East Coast and roughly 10 to 12 from the West Coast. One-stop routes can be quite a bit longer. If you want, tell me the departure city and I’ll narrow it down.`;
      }
      return "Flight time depends a lot on the departure city and whether the route is nonstop. Tell me the route and I’ll narrow it down.";
    }

    if (cruisePassportQuestion) {
      if (subject) {
        return `For a cruise to ${subject}, the big question is whether it is a closed-loop cruise that starts and ends at the same U.S. port. Some U.S. citizens can sometimes cruise closed-loop itineraries with a birth certificate and government ID, but a passport is still the safest option and is often required for non-closed-loop itineraries or emergencies. If you want, tell me the start and end port and what passport you’re traveling on.`;
      }
      return "For cruises, passport rules usually depend on whether it is a closed-loop cruise that starts and ends at the same U.S. port. Some U.S. citizens can sometimes use a birth certificate plus government ID on closed-loop itineraries, but a passport is still the safest option and is often required outside that setup. If you want, tell me the route and what passport you’re traveling on.";
    }

    if (passportQuestion && !subject) {
      return "Passport rules depend on the destination and how you are traveling. Tell me the route or country and I can narrow it down.";
    }

    if (asksCurrency && subject) {
      return `The local currency in ${subject} is ${memory?.currency?.label || memory?.currency?.code || "the local currency"}. If you want, I can also give you a quick cost context.`;
    }
    if (asksEntryRules && subject && !mentionsNationality) {
      return `Entry rules for ${subject} depend on your nationality. What passport are you traveling on?`;
    }
    if (whereToStayQuestion || task === "answer_where_to_stay_question") {
      return buildWhereToStayReply(subject);
    }
    if (budgetQuestion || task === "answer_budget_expectation_question") {
      return buildBudgetReply(subject);
    }
    if (destinationAdviceQuestion || task === "answer_destination_advice_question") {
      return buildDestinationAdviceReply(subject);
    }
    if (asksEntryRules && !subject && !mentionsNationality) {
      return "Entry rules depend on the country and your nationality. Tell me the destination and what passport you’re traveling on, and I’ll narrow it down.";
    }
    if (subject) return `Tell me what you want to know about ${subject}, and I’ll keep it practical.`;
  }

  return "Tell me the destination or route and I’ll help you from there.";
}

export async function generateChatReply({ messages, threadSummary, memory, toolContext }) {
  const userQuery = String(toolContext?.userQuery || "").trim();
  const forceDeterministicKnowledgeReply =
    (toolContext?.mode === "travel_knowledge" || toolContext?.mode === "destination_discovery") &&
    /\b(avg flight time|average flight time|flight time|how long is the flight|how long is a flight|passport requirements?|do i need a passport|need a passport|visa|entry|admission|immigration|tourist entry|border|arrival|cruise|best places in|top places in|things to do in|where should i stay|where to stay|is .+ expensive|how expensive is|currency|weather|safe|safety)\b/i.test(
      userQuery
    );

  if (forceDeterministicKnowledgeReply) {
    return fallbackReply({ memory, toolContext });
  }

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
            "Default to answering the user's question directly in a natural travel-assistant voice. " +
            "Use toolContext as the primary source of truth when tools were actually used. " +
            "Do not invent places, nearby results, prices, or resolved POIs. " +
            "If toolContext lacks evidence, still answer from general travel knowledge when reasonable and ask at most one concrete follow-up. " +
            "For exact named place lookup, prioritize the resolved place and exact-matching attraction results. " +
            "If user asks what is near a named place, only discuss nearby results grounded in toolContext. " +
            "Never reply with a capability menu or internal routing language. " +
            "Keep replies concise, useful, practical, and plain text. " +
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
