const DESTINATION_META = {
  thailand: { country_code: "TH", place_type: "country", currency: { code: "THB", label: "Thai baht" } },
  bali: { country_code: "ID", place_type: "region", currency: { code: "IDR", label: "Indonesian rupiah" } },
  indonesia: { country_code: "ID", place_type: "country", currency: { code: "IDR", label: "Indonesian rupiah" } },
  senegal: { country_code: "SN", place_type: "country", currency: { code: "XOF", label: "West African CFA franc" } },
  germany: { country_code: "DE", place_type: "country", currency: { code: "EUR", label: "Euro" } },
  japan: { country_code: "JP", place_type: "country", currency: { code: "JPY", label: "Japanese yen" } },
  france: { country_code: "FR", place_type: "country", currency: { code: "EUR", label: "Euro" } },
  spain: { country_code: "ES", place_type: "country", currency: { code: "EUR", label: "Euro" } },
  italy: { country_code: "IT", place_type: "country", currency: { code: "EUR", label: "Euro" } },
  portugal: { country_code: "PT", place_type: "country", currency: { code: "EUR", label: "Euro" } },
  usa: { country_code: "US", place_type: "country", currency: { code: "USD", label: "US dollar" } },
  "united states": { country_code: "US", place_type: "country", currency: { code: "USD", label: "US dollar" } },
};

const DATE_RE = /\b(\d{4}-\d{2}-\d{2})\b/g;
const SUMMARY_INTERVAL_MESSAGES = 8;

function clean(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function titleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function defaultMemory() {
  return {
    destination: null,
    origin: null,
    currency: null,
    dates: null,
    travelers: null,
    budget: null,
    vibe: [],
    planning_stage: "discovery",
    open_loops: [],
    active_place: null,
    last_mode: null,
    last_task: null,
  };
}

function normalizeMemory(previousMemory) {
  return {
    ...defaultMemory(),
    ...(previousMemory && typeof previousMemory === "object" ? previousMemory : {}),
    vibe: Array.isArray(previousMemory?.vibe) ? previousMemory.vibe : [],
    open_loops: Array.isArray(previousMemory?.open_loops) ? previousMemory.open_loops : [],
  };
}

function isLikelyPoi(value) {
  const text = clean(value);
  return /\bmuseum|hotel|restaurant|cafe|station|airport|mall|park|market|center|centre|bridge|tower\b/.test(text);
}

function buildDestination(label) {
  const cleaned = String(label || "").replace(/[?.!,]$/g, "").trim();
  if (!cleaned) return null;
  const key = clean(cleaned);
  const meta = DESTINATION_META[key] || null;
  return {
    label: titleCase(cleaned),
    country_code: meta?.country_code || null,
    place_type: meta?.place_type || "unknown",
    lat: null,
    lng: null,
    confidence: meta ? 0.92 : 0.72,
  };
}

function pickDestination({ classification, resolvedContext, latestUserMessage }) {
  if (resolvedContext?.destination?.label) return resolvedContext.destination;
  const hint = classification?.destinationHint;
  if (hint && !isLikelyPoi(hint)) return buildDestination(hint);

  const text = String(latestUserMessage || "");
  const pattern = /\b(?:where is|trip to|trip in|visit|visiting|going to|best places in|in|to)\s+([A-Za-z][A-Za-z\s'-]{2,})/i;
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const candidate = String(match[1]).trim();
  if (!candidate || isLikelyPoi(candidate)) return null;
  return buildDestination(candidate);
}

function extractNamedPlace(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;
  const patterns = [
    /\bwhat about\s+(.+)/i,
    /\bnear\s+(.+)/i,
    /\bthe actual\s+(.+)/i,
    /\bmean\s+(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/[?.!,]$/g, "").trim() || null;
    }
  }
  return text.replace(/[?.!,]$/g, "").trim() || null;
}

function pickActivePlace({ classification, resolvedContext, latestUserMessage, previousMemory }) {
  if (resolvedContext?.active_place) return resolvedContext.active_place;

  const mode = classification?.mode;
  if (mode !== "place_lookup" && mode !== "nearby_search") return previousMemory?.active_place || null;

  const query = classification?.query || extractNamedPlace(latestUserMessage);
  const label = String(query || "").trim();
  if (!label) return previousMemory?.active_place || null;

  return {
    label,
    kind: null,
    city: null,
    country_code: null,
    lat: null,
    lng: null,
    confidence: 0.65,
    source: "memory_inferred",
  };
}

function detectOriginAndDestinationRoute(message) {
  const text = String(message || "");
  const match = text.match(/\bfrom\s+([A-Za-z][A-Za-z\s'-]{2,})\s+to\s+([A-Za-z][A-Za-z\s'-]{2,})/i);
  if (!match?.[1] || !match?.[2]) return null;
  return {
    origin: {
      label: titleCase(match[1].trim()),
      airport_code: null,
      city_code: null,
      confidence: 0.86,
    },
    destination: buildDestination(match[2]),
  };
}

function detectDates(message) {
  const text = String(message || "");
  const matches = [...text.matchAll(DATE_RE)].map((m) => m[1]);
  const duration = text.match(/\b(\d{1,2})\s*day\b/i);

  if (!matches.length && !duration) {
    if (/\b(flexible|anytime|not sure)\b/i.test(text)) {
      return {
        start_date: null,
        end_date: null,
        is_flexible: true,
        duration_days: null,
        confidence: 0.8,
      };
    }
    return null;
  }

  return {
    start_date: matches[0] || null,
    end_date: matches[1] || matches[0] || null,
    is_flexible: false,
    duration_days: duration?.[1] ? Number(duration[1]) : null,
    confidence: 0.88,
  };
}

function detectTravelers(message) {
  const text = clean(message);
  const countMatch = text.match(/\b(\d+)\s+(traveler|travelers|people|adults?)\b/i);
  if (countMatch?.[1]) {
    return {
      count: Number(countMatch[1]),
      composition: countMatch[2],
      confidence: 0.88,
    };
  }

  if (/\b(my girlfriend|my boyfriend|my partner|as a couple|with my wife|with my husband)\b/.test(text)) {
    return {
      count: 2,
      composition: "couple",
      confidence: 0.81,
    };
  }

  return null;
}

function detectBudget(message) {
  const text = clean(message);
  let level = null;
  if (/\bbudget|cheap|low cost|affordable\b/.test(text)) level = "budget";
  if (/\bluxury|premium|high end\b/.test(text)) level = "luxury";
  if (/\bmid|midrange|moderate\b/.test(text)) level = "midrange";

  const amountMatch = text.match(/\b(\d{2,6})\s*(usd|eur|thb|idr|jpy|xof)?\b/i);
  if (!level && !amountMatch) return null;

  return {
    amount: amountMatch?.[1] ? Number(amountMatch[1]) : null,
    currency: amountMatch?.[2] ? amountMatch[2].toUpperCase() : null,
    level,
    confidence: 0.8,
  };
}

function detectVibes(message) {
  const text = clean(message);
  const vibes = [];
  if (/\bnightlife|bar|club|party\b/.test(text)) vibes.push("nightlife");
  if (/\bmuseum|culture|historical|history\b/.test(text)) vibes.push("museum");
  if (/\bwalkable|walk\b/.test(text)) vibes.push("walkable");
  if (/\bbeach\b/.test(text)) vibes.push("beach");
  if (/\bfood|culinary|restaurant\b/.test(text)) vibes.push("food");
  if (/\brelax|chill\b/.test(text)) vibes.push("relax");
  if (/\bspring|summer|winter|autumn|fall\b/.test(text)) vibes.push("seasonal");
  return vibes;
}

function inferCurrencyFromDestination(destination) {
  const key = clean(destination?.label);
  const meta = DESTINATION_META[key];
  if (!meta?.currency) return null;
  return { ...meta.currency, confidence: 0.9 };
}

function dedupeList(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(Boolean))];
}

function nextPlanningStage(lastMode, lastTask, previousStage) {
  if (lastMode === "trip_planning") return "itinerary";
  if (lastMode === "travel_action") return "booking";
  if (lastMode === "destination_discovery" || lastMode === "travel_knowledge") return "discovery";
  if (lastTask === "save_place") return "curation";
  return previousStage || "discovery";
}

function buildOpenLoops(memory) {
  const loops = [];
  if (!memory?.destination?.label && memory?.last_mode !== "place_lookup") loops.push("missing_destination");

  if (memory?.last_task === "show_flights") {
    if (!memory?.origin?.label) loops.push("missing_origin");
    if (!memory?.destination?.label) loops.push("missing_destination");
    if (!memory?.dates?.start_date && !memory?.dates?.is_flexible) loops.push("missing_dates");
  }

  if (memory?.last_task === "compare_hotels" && !memory?.dates?.start_date) {
    loops.push("missing_hotel_dates");
  }

  if (memory?.last_mode === "trip_planning" && !memory?.dates?.duration_days && !memory?.dates?.start_date) {
    loops.push("missing_trip_length_or_dates");
  }

  return dedupeList(loops);
}

function majorMemoryChanged(prev, next) {
  return (
    clean(prev?.destination?.label) !== clean(next?.destination?.label) ||
    clean(prev?.active_place?.label) !== clean(next?.active_place?.label) ||
    clean(prev?.origin?.label) !== clean(next?.origin?.label) ||
    clean(prev?.currency?.code) !== clean(next?.currency?.code) ||
    clean(prev?.dates?.start_date) !== clean(next?.dates?.start_date) ||
    clean(prev?.dates?.end_date) !== clean(next?.dates?.end_date) ||
    clean(prev?.planning_stage) !== clean(next?.planning_stage) ||
    clean(prev?.last_mode) !== clean(next?.last_mode) ||
    clean(prev?.last_task) !== clean(next?.last_task)
  );
}

export function updateThreadMemory({
  previousMemory,
  latestUserMessage,
  recentMessages,
  classification,
  resolvedContext,
}) {
  const prev = normalizeMemory(previousMemory);
  const route = detectOriginAndDestinationRoute(latestUserMessage);

  const destinationFromContext =
    classification?.mode === "place_lookup" ? null : pickDestination({ classification, resolvedContext, latestUserMessage });
  const destination = route?.destination || destinationFromContext || prev.destination || null;

  const currencyExplicit = /\b(usd|eur|thb|idr|jpy|xof)\b/i.exec(String(latestUserMessage || ""));
  const explicitCurrency = currencyExplicit
    ? { code: currencyExplicit[1].toUpperCase(), label: null, confidence: 0.86 }
    : null;
  const currencyFromDestination = inferCurrencyFromDestination(destination || prev.destination);

  const next = {
    ...prev,
    destination,
    origin: route?.origin || resolvedContext?.origin || prev.origin || null,
    currency: explicitCurrency || resolvedContext?.currency || currencyFromDestination || prev.currency || null,
    dates: detectDates(latestUserMessage) || resolvedContext?.dates || prev.dates || null,
    travelers: detectTravelers(latestUserMessage) || resolvedContext?.travelers || prev.travelers || null,
    budget: detectBudget(latestUserMessage) || resolvedContext?.budget || prev.budget || null,
    vibe: dedupeList([...(prev.vibe || []), ...detectVibes(latestUserMessage), ...(resolvedContext?.vibe || [])]),
    active_place: pickActivePlace({
      classification,
      resolvedContext,
      latestUserMessage,
      previousMemory: prev,
    }),
    last_mode: classification?.mode || prev.last_mode || null,
    last_task: classification?.task || prev.last_task || null,
    planning_stage: nextPlanningStage(classification?.mode, classification?.task, prev.planning_stage),
  };

  if (classification?.mode === "place_lookup" && next.active_place?.label) {
    // Keep destination stable during POI lookup turns unless explicitly provided.
    next.destination = destinationFromContext || prev.destination || null;
  }

  next.open_loops = buildOpenLoops(next);
  const majorChanged = majorMemoryChanged(prev, next);

  return {
    memory: next,
    majorChanged,
    recentMessagesUsed: Array.isArray(recentMessages) ? Math.min(recentMessages.length, 20) : 0,
  };
}

export function shouldRefreshSummary({ messageCount, majorChanged, existingSummary }) {
  if (!existingSummary || !String(existingSummary).trim()) return true;
  if (majorChanged) return true;
  return messageCount > 0 && messageCount % SUMMARY_INTERVAL_MESSAGES === 0;
}

export function buildThreadSummary(memory) {
  const m = normalizeMemory(memory);
  const parts = [];

  if (m.destination?.label) parts.push(`Destination context: ${m.destination.label}.`);
  if (m.active_place?.label) parts.push(`Active place context: ${m.active_place.label}.`);
  if (m.origin?.label) parts.push(`Origin context: ${m.origin.label}.`);
  if (m.currency?.code || m.currency?.label) {
    parts.push(`Currency context: ${m.currency?.label || m.currency?.code}.`);
  }
  if (m.dates?.start_date || m.dates?.end_date || m.dates?.is_flexible || m.dates?.duration_days) {
    if (m.dates?.is_flexible) parts.push("Dates are flexible.");
    else if (m.dates?.start_date || m.dates?.end_date) {
      parts.push(`Dates: ${m.dates?.start_date || "?"} to ${m.dates?.end_date || "?"}.`);
    }
    if (m.dates?.duration_days) parts.push(`Trip length hint: ${m.dates.duration_days} days.`);
  }
  if (m.travelers?.composition || m.travelers?.count) {
    parts.push(`Travelers: ${m.travelers?.count || "?"} (${m.travelers?.composition || "unspecified"}).`);
  }
  if (m.budget?.level) parts.push(`Budget level: ${m.budget.level}.`);
  if (Array.isArray(m.vibe) && m.vibe.length) parts.push(`Vibes: ${m.vibe.join(", ")}.`);
  if (m.last_mode) parts.push(`Last mode: ${m.last_mode}.`);
  if (m.last_task) parts.push(`Last task: ${m.last_task}.`);
  if (m.planning_stage) parts.push(`Planning stage: ${m.planning_stage}.`);
  if (Array.isArray(m.open_loops) && m.open_loops.length) {
    parts.push(`Open loops: ${m.open_loops.join(", ")}.`);
  }

  if (!parts.length) return "No strong travel context established yet.";
  return parts.join(" ");
}

export function buildUiHints(memory) {
  const m = normalizeMemory(memory);
  const chips = [];

  if (m.last_mode === "travel_knowledge" && m.last_task === "answer_currency_question") {
    chips.push("Show live exchange rate", "Convert 100 USD");
  }
  if (m.last_mode === "destination_discovery" && m.destination?.label) {
    chips.push(`Top attractions in ${m.destination.label}`, `Best neighborhoods in ${m.destination.label}`);
  }
  if (m.last_mode === "place_lookup" && m.active_place?.label) {
    chips.push(`What is near ${m.active_place.label}?`, `Save ${m.active_place.label}`);
  }
  if (m.last_mode === "trip_planning") {
    chips.push("Show day-by-day plan", "Add budget constraints");
  }
  if (m.last_task === "show_flights") {
    chips.push("Show flexible dates", "Find cheaper flights");
  }

  return { chips: dedupeList(chips).slice(0, 4) };
}
