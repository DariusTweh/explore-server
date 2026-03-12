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
  tokyo: { country_code: "JP", place_type: "city", currency: { code: "JPY", label: "Japanese yen" } },
  kyoto: { country_code: "JP", place_type: "city", currency: { code: "JPY", label: "Japanese yen" } },
  osaka: { country_code: "JP", place_type: "city", currency: { code: "JPY", label: "Japanese yen" } },
  berlin: { country_code: "DE", place_type: "city", currency: { code: "EUR", label: "Euro" } },
  munich: { country_code: "DE", place_type: "city", currency: { code: "EUR", label: "Euro" } },
  "los angeles": { country_code: "US", place_type: "city", currency: { code: "USD", label: "US dollar" } },
};

const SUMMARY_INTERVAL_MESSAGES = 4;
const MONTH_INDEX = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function clean(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function lower(text) {
  return clean(text).toLowerCase();
}

function titleCase(value) {
  return clean(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function dedupeList(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(Boolean))];
}

function isLikelyPoi(value) {
  return /\bmuseum|hotel|restaurant|cafe|station|airport|mall|park|market|center|centre|bridge|tower|temple|shrine|castle|beach\b/i.test(
    clean(value)
  );
}

function addDaysLocal(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date) {
  return addDaysLocal(date, -date.getDay());
}

function nextWeekday(date, weekday) {
  const base = new Date(date);
  const delta = (weekday - base.getDay() + 7) % 7 || 7;
  return addDaysLocal(base, delta);
}

function normalizeCandidateLabel(value) {
  return clean(
    String(value || "")
      .replace(/\btrip\b.*$/i, "")
      .replace(/\bwith my\b.*$/i, "")
      .replace(/\bwith\b.*$/i, "")
      .replace(/\bfor\s+\d+\s*(?:days?|nights?)\b.*$/i, "")
      .replace(/\bon a\b.*$/i, "")
      .replace(/\bnext\s+(?:week|month|weekend|spring|summer|winter|fall|autumn)\b.*$/i, "")
      .replace(/\bthis\s+(?:week|month|weekend|spring|summer|winter|fall|autumn)\b.*$/i, "")
      .replace(/[?.!,]$/g, "")
  );
}

function buildDestination(label, confidence = 0.8) {
  const normalized = normalizeCandidateLabel(label);
  if (!normalized || isLikelyPoi(normalized)) return null;
  const meta = DESTINATION_META[lower(normalized)] || null;
  return {
    label: titleCase(normalized),
    country_code: meta?.country_code || null,
    place_type: meta?.place_type || "unknown",
    lat: null,
    lng: null,
    confidence,
  };
}

function buildOrigin(label, confidence = 0.82) {
  const normalized = normalizeCandidateLabel(label);
  if (!normalized) return null;
  const airportCode = /^[A-Za-z]{3}$/.test(normalized) ? normalized.toUpperCase() : null;
  return {
    label: airportCode || titleCase(normalized),
    airport_code: airportCode,
    city_code: null,
    confidence,
  };
}

function inferCurrencyFromDestination(destination) {
  const meta = DESTINATION_META[lower(destination?.label)];
  if (!meta?.currency) return null;
  return { ...meta.currency, confidence: 0.9 };
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
  const base = previousMemory && typeof previousMemory === "object" ? previousMemory : {};
  return {
    ...defaultMemory(),
    ...base,
    vibe: Array.isArray(base?.vibe) ? dedupeList(base.vibe.map((item) => lower(item))) : [],
    open_loops: Array.isArray(base?.open_loops) ? dedupeList(base.open_loops.map((item) => lower(item))) : [],
  };
}

function normalizeDates(dates) {
  if (!dates || typeof dates !== "object") return null;
  return {
    start_date: dates.start_date || null,
    end_date: dates.end_date || null,
    is_flexible: Boolean(dates.is_flexible),
    duration_days: Number.isFinite(Number(dates.duration_days)) ? Number(dates.duration_days) : null,
    raw_text: dates.raw_text ? clean(dates.raw_text) : null,
    date_window_type: dates.date_window_type || null,
    confidence: Number.isFinite(Number(dates.confidence)) ? Number(dates.confidence) : 0.75,
  };
}

function mergeDates(previousDates, nextDates) {
  if (!nextDates) return normalizeDates(previousDates);
  const prev = normalizeDates(previousDates) || {};
  const next = normalizeDates(nextDates) || {};
  return {
    start_date: next.start_date ?? prev.start_date ?? null,
    end_date: next.end_date ?? prev.end_date ?? null,
    is_flexible: next.is_flexible ?? prev.is_flexible ?? false,
    duration_days: next.duration_days ?? prev.duration_days ?? null,
    raw_text: next.raw_text || prev.raw_text || null,
    date_window_type: next.date_window_type || prev.date_window_type || null,
    confidence: Math.max(Number(prev.confidence || 0), Number(next.confidence || 0.75)),
  };
}

function mergeBudget(previousBudget, nextBudget) {
  if (!nextBudget) return previousBudget || null;
  return {
    amount: nextBudget.amount ?? previousBudget?.amount ?? null,
    currency: nextBudget.currency ?? previousBudget?.currency ?? null,
    level: nextBudget.level || previousBudget?.level || null,
    confidence: Math.max(Number(previousBudget?.confidence || 0), Number(nextBudget.confidence || 0.8)),
  };
}

function sanitizePlaceLabel(value) {
  const text = clean(
    String(value || "")
      .replace(/^(?:the)\s+/i, "")
      .replace(/[?.!,]$/g, "")
  );
  if (!text) return null;
  if (text.length > 80) return null;
  return text;
}

function parseMonthDay(text, baseDate) {
  const match = clean(text).match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/i
  );
  if (!match) return null;
  const month = MONTH_INDEX[match[1].toLowerCase()];
  const day = Number(match[2]);
  const explicitYear = Number(match[3] || 0) || null;
  const year = explicitYear || baseDate.getFullYear();
  let candidate = new Date(year, month, day);
  if (!explicitYear && candidate < new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate())) {
    candidate = new Date(year + 1, month, day);
  }
  return toDateString(candidate);
}

function parseWeekdayRange(startLabel, endLabel, baseDate) {
  const startIdx = WEEKDAY_INDEX[lower(startLabel)];
  const endIdx = WEEKDAY_INDEX[lower(endLabel)];
  if (startIdx === undefined || endIdx === undefined) return null;
  const startDate = nextWeekday(baseDate, startIdx);
  let endDate = nextWeekday(startDate, endIdx);
  if (endDate <= startDate) endDate = addDaysLocal(endDate, 7);
  return {
    start_date: toDateString(startDate),
    end_date: toDateString(endDate),
    is_flexible: false,
    duration_days: Math.max(1, Math.round((endDate - startDate) / 86400000) + 1),
    raw_text: `${startLabel} to ${endLabel}`,
    date_window_type: "weekday_range",
    confidence: 0.89,
  };
}

function parseRelativeDates(message) {
  const text = lower(message);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (/\b(flexible|anytime|not sure|not certain)\b/.test(text)) {
    return {
      start_date: null,
      end_date: null,
      is_flexible: true,
      duration_days: null,
      raw_text: clean(message),
      date_window_type: "flexible",
      confidence: 0.9,
    };
  }

  if (/\btonight\b/.test(text)) {
    return {
      start_date: toDateString(today),
      end_date: toDateString(addDaysLocal(today, 1)),
      is_flexible: false,
      duration_days: 2,
      raw_text: "tonight",
      date_window_type: "relative_tonight",
      confidence: 0.86,
    };
  }

  if (/\btoday\b/.test(text)) {
    return {
      start_date: toDateString(today),
      end_date: toDateString(today),
      is_flexible: false,
      duration_days: 1,
      raw_text: "today",
      date_window_type: "relative_today",
      confidence: 0.86,
    };
  }

  if (/\btomorrow\b/.test(text)) {
    const start = addDaysLocal(today, 1);
    return {
      start_date: toDateString(start),
      end_date: toDateString(start),
      is_flexible: false,
      duration_days: 1,
      raw_text: "tomorrow",
      date_window_type: "relative_tomorrow",
      confidence: 0.86,
    };
  }

  if (/\bthis weekend\b/.test(text)) {
    const friday = nextWeekday(addDaysLocal(today, -1), 5);
    const sunday = addDaysLocal(friday, 2);
    return {
      start_date: toDateString(friday),
      end_date: toDateString(sunday),
      is_flexible: false,
      duration_days: 3,
      raw_text: "this weekend",
      date_window_type: "relative_weekend",
      confidence: 0.9,
    };
  }

  if (/\bnext weekend\b/.test(text)) {
    const friday = addDaysLocal(nextWeekday(today, 5), 7);
    const sunday = addDaysLocal(friday, 2);
    return {
      start_date: toDateString(friday),
      end_date: toDateString(sunday),
      is_flexible: false,
      duration_days: 3,
      raw_text: "next weekend",
      date_window_type: "relative_weekend",
      confidence: 0.9,
    };
  }

  if (/\bnext week\b/.test(text)) {
    const monday = addDaysLocal(startOfWeek(today), 8);
    const sunday = addDaysLocal(monday, 6);
    return {
      start_date: toDateString(monday),
      end_date: toDateString(sunday),
      is_flexible: false,
      duration_days: 7,
      raw_text: "next week",
      date_window_type: "relative_week",
      confidence: 0.84,
    };
  }

  if (/\bnext month\b/.test(text)) {
    const start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    return {
      start_date: toDateString(start),
      end_date: toDateString(end),
      is_flexible: false,
      duration_days: null,
      raw_text: "next month",
      date_window_type: "relative_month",
      confidence: 0.8,
    };
  }

  const weekdayRangeMatch = text.match(
    /\b(friday|saturday|sunday|monday|tuesday|wednesday|thursday)\s+(?:to|-)\s+(friday|saturday|sunday|monday|tuesday|wednesday|thursday)\b/i
  );
  if (weekdayRangeMatch) {
    return parseWeekdayRange(weekdayRangeMatch[1], weekdayRangeMatch[2], today);
  }

  const monthRangeMatch = clean(message).match(
    /\b([A-Za-z]{3,9}\s+\d{1,2})\s*(?:to|-)\s*([A-Za-z]{3,9}\s+\d{1,2}|\d{1,2})\b/i
  );
  if (monthRangeMatch) {
    const start = parseMonthDay(monthRangeMatch[1], today);
    const endCandidate = /\d{1,2}/.test(monthRangeMatch[2]) && !/[A-Za-z]/.test(monthRangeMatch[2])
      ? parseMonthDay(`${monthRangeMatch[1].split(/\s+/)[0]} ${monthRangeMatch[2]}`, today)
      : parseMonthDay(monthRangeMatch[2], today);
    if (start && endCandidate) {
      return {
        start_date: start,
        end_date: endCandidate,
        is_flexible: false,
        duration_days: null,
        raw_text: clean(monthRangeMatch[0]),
        date_window_type: "calendar_range",
        confidence: 0.92,
      };
    }
  }

  const isoDates = clean(message).match(/\b\d{4}-\d{2}-\d{2}\b/g);
  if (isoDates?.length) {
    return {
      start_date: isoDates[0] || null,
      end_date: isoDates[1] || isoDates[0] || null,
      is_flexible: false,
      duration_days: null,
      raw_text: clean(message),
      date_window_type: "explicit_dates",
      confidence: 0.95,
    };
  }

  const monthDay = parseMonthDay(message, today);
  if (monthDay) {
    return {
      start_date: monthDay,
      end_date: monthDay,
      is_flexible: false,
      duration_days: null,
      raw_text: clean(message),
      date_window_type: "calendar_day",
      confidence: 0.9,
    };
  }

  const durationMatch = text.match(/\b(\d{1,2})\s*(day|days|night|nights)\b/);
  if (durationMatch) {
    return {
      start_date: null,
      end_date: null,
      is_flexible: /\b(flexible|anytime)\b/.test(text),
      duration_days: Number(durationMatch[1]),
      raw_text: clean(durationMatch[0] + (/\b(spring|summer|winter|fall|autumn)\b/i.exec(message)?.[0] ? ` ${/\b(spring|summer|winter|fall|autumn)\b/i.exec(message)?.[0]}` : "")),
      date_window_type: /\b(spring|summer|winter|fall|autumn)\b/.test(text) ? "seasonal_duration" : "duration_only",
      confidence: 0.82,
    };
  }

  return null;
}

export function extractRouteFromMessage(message) {
  const text = clean(message);
  const match = text.match(/\bfrom\s+([A-Za-z][A-Za-z\s'-]{1,40}|[A-Z]{3})\s+to\s+([A-Za-z][A-Za-z\s'-]{1,40}|[A-Z]{3})\b/i);
  if (!match) return null;
  const origin = buildOrigin(match[1], 0.9);
  const destination = buildDestination(match[2], 0.9);
  if (!origin && !destination) return null;
  return { origin, destination };
}

export function extractDestinationFromMessage(message, classification = null) {
  const text = clean(message);
  const candidates = [];
  if (classification?.destinationHint && !isLikelyPoi(classification.destinationHint)) {
    candidates.push(classification.destinationHint);
  }

  const patterns = [
    /\b(?:trip to|visit|visiting|going to|plan me(?: a| an)?|plan)\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bbest places in\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bbest neighborhoods in\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\b(?:actually|instead)\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\b([A-Za-z][A-Za-z\s'-]{2,50})\s+trip\b/i,
    /\b(?:visa|entry|admission|immigration|border|arrival)\s+requirements?\s+(?:to|for)\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bdo i need a visa for\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
    /\bwhat currency do they use in\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) candidates.push(match[1]);
  }

  if (
    classification?.mode &&
    ["trip_planning", "destination_discovery", "travel_action"].includes(classification.mode)
  ) {
    const inMatch = text.match(/\bin\s+([A-Za-z][A-Za-z\s'-]{2,50})\b/i);
    if (inMatch?.[1] && !isLikelyPoi(inMatch[1])) candidates.push(inMatch[1]);
  }

  for (const candidate of candidates) {
    const built = buildDestination(candidate, classification?.destinationHint === candidate ? 0.88 : 0.82);
    if (built) return built;
  }
  return null;
}

export function extractDatesFromMessage(message) {
  return parseRelativeDates(message);
}

export function extractTravelerInfoFromMessage(message) {
  const text = lower(message);
  const countMatch = text.match(/\b(\d+)\s+(traveler|travelers|people|adults?)\b/);
  if (countMatch) {
    return {
      count: Number(countMatch[1]),
      composition: "group",
      confidence: 0.88,
    };
  }
  if (/\b(my girlfriend|my boyfriend|my partner|as a couple|with my wife|with my husband)\b/.test(text)) {
    return {
      count: 2,
      composition: "couple",
      confidence: 0.84,
    };
  }
  if (/\bsolo\b|\bby myself\b|\bjust me\b/.test(text)) {
    return {
      count: 1,
      composition: "solo",
      confidence: 0.82,
    };
  }
  return null;
}

export function extractBudgetFromMessage(message) {
  const text = lower(message);
  let level = null;
  if (/\bbudget|cheap|low cost|affordable|cheaper\b/.test(text)) level = "budget";
  else if (/\bluxury|premium|high end|more premium\b/.test(text)) level = "luxury";
  else if (/\bmidrange|moderate\b/.test(text)) level = "midrange";

  const amountMatch = text.match(/\b(?:under|around|about)?\s*(\d{2,6})\s*(usd|eur|thb|idr|jpy|xof)?\b/);
  if (!level && !amountMatch) return null;
  return {
    amount: amountMatch?.[1] ? Number(amountMatch[1]) : null,
    currency: amountMatch?.[2] ? amountMatch[2].toUpperCase() : null,
    level,
    confidence: 0.82,
  };
}

export function extractVibesFromMessage(message) {
  const text = lower(message);
  const vibes = [];
  if (/\bnightlife|bar|club|party\b/.test(text)) vibes.push("nightlife");
  if (/\bmuseum|culture|historical|history\b/.test(text)) vibes.push("museum");
  if (/\bwalkable|walk\b/.test(text)) vibes.push("walkable");
  if (/\bbeach\b/.test(text)) vibes.push("beach");
  if (/\bfood|culinary|restaurant\b/.test(text)) vibes.push("food");
  if (/\brelax|chill\b/.test(text)) vibes.push("relax");
  return vibes;
}

export function extractActivePlaceFromMessage(message, classification = null) {
  const text = clean(message);
  if (!text) return null;
  if (!["place_lookup", "nearby_search"].includes(classification?.mode || "")) return null;

  const patterns = [
    /\bwhat about\s+(.+)/i,
    /\bwhat'?s near\s+(.+)/i,
    /\bwhich are near\s+(.+)/i,
    /\bnear\s+(?:the\s+)?(.+)/i,
    /\bthis place\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    if (pattern.source.includes("this place")) {
      return { label: "this place", kind: null, city: null, country_code: null, lat: null, lng: null, confidence: 0.4, source: "memory_inferred" };
    }
    const label = sanitizePlaceLabel(match[1]);
    if (!label) continue;
    return {
      label,
      kind: null,
      city: null,
      country_code: null,
      lat: null,
      lng: null,
      confidence: classification?.mode === "nearby_search" ? 0.8 : 0.7,
      source: "memory_inferred",
    };
  }

  if (classification?.mode === "place_lookup" && classification?.query) {
    const label = sanitizePlaceLabel(classification.query);
    if (label) {
      return {
        label,
        kind: null,
        city: null,
        country_code: null,
        lat: null,
        lng: null,
        confidence: 0.72,
        source: "memory_inferred",
      };
    }
  }

  return null;
}

export function shouldClearActivePlace({ classification, latestUserMessage }) {
  const mode = classification?.mode;
  if (mode === "trip_planning") return true;
  if (mode === "travel_action") return true;
  if (mode === "destination_discovery") return true;
  if (
    mode === "travel_knowledge" &&
    !/\bnear\b|\bwhat about\b|\bthis place\b/i.test(String(latestUserMessage || ""))
  ) {
    return true;
  }
  return false;
}

function nextPlanningStage(lastMode, lastTask, previousStage) {
  if (lastMode === "trip_planning") return "itinerary";
  if (lastMode === "travel_action") return "booking";
  if (lastMode === "destination_discovery") return "discovery";
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
  if (memory?.last_mode === "trip_planning" && !memory?.dates?.duration_days && !memory?.dates?.start_date) {
    loops.push("missing_trip_length_or_dates");
  }
  if (memory?.last_mode === "trip_planning" && !memory?.travelers?.count) {
    loops.push("missing_travelers");
  }
  if (memory?.last_mode === "trip_planning" && !memory?.budget?.level && memory?.budget?.amount == null) {
    loops.push("missing_budget");
  }
  return dedupeList(loops);
}

function stableList(list) {
  return JSON.stringify(dedupeList((Array.isArray(list) ? list : []).map((item) => lower(item))));
}

function stableValue(value) {
  return lower(value || "");
}

function stableNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function getDurableFieldOwners(mode, task) {
  const owners = new Set();
  if (mode === "trip_planning") {
    owners.add("destination");
    owners.add("dates");
    owners.add("travelers");
    owners.add("budget");
    owners.add("vibe");
    owners.add("planning_stage");
  }
  if (mode === "travel_action") {
    owners.add("origin");
    owners.add("destination");
    owners.add("dates");
    if (task === "save_place") owners.add("active_place");
  }
  if (mode === "destination_discovery") {
    owners.add("destination");
    owners.add("vibe");
  }
  if (mode === "travel_knowledge") {
    owners.add("destination");
    owners.add("currency");
  }
  return owners;
}

function hasStrongConfidence(candidate, threshold = 0.84) {
  return Number(candidate?.confidence || 0) >= threshold;
}

function hasExplicitDestinationSignal(message) {
  return /\b(trip to|visit|going to|best places in|best neighborhoods in|visa|entry|admission|immigration|border|currency)\b/i.test(
    String(message || "")
  );
}

function collectSignals(message, classification = null) {
  const route = extractRouteFromMessage(message);
  const destination = extractDestinationFromMessage(message, classification);
  const dates = extractDatesFromMessage(message);
  const travelers = extractTravelerInfoFromMessage(message);
  const budget = extractBudgetFromMessage(message);
  const vibe = extractVibesFromMessage(message);
  const activePlace = extractActivePlaceFromMessage(message, classification);
  const currencyExplicit = String(message || "").match(/\b(usd|eur|thb|idr|jpy|xof)\b/i);
  return {
    route,
    destination,
    dates,
    travelers,
    budget,
    vibe,
    activePlace,
    currency: currencyExplicit
      ? { code: currencyExplicit[1].toUpperCase(), label: null, confidence: 0.86 }
      : null,
  };
}

function applySignals(next, signals, { classification, source, message }) {
  const durableOwners = getDurableFieldOwners(classification?.mode, classification?.task);
  const allowBackfill = source === "recent";
  const allowExplicitKnowledgeDestination =
    classification?.mode === "travel_knowledge" && hasExplicitDestinationSignal(message);
  const allowStrongResolvedDestination =
    (classification?.mode === "place_lookup" || classification?.mode === "nearby_search") &&
    source === "resolved";

  if (durableOwners.has("origin") && signals?.route?.origin && hasStrongConfidence(signals.route.origin, 0.84)) {
    next.origin = signals.route.origin;
  }

  const destinationCandidate = signals?.route?.destination || signals?.destination || null;
  if (destinationCandidate) {
    const canWriteDestination =
      durableOwners.has("destination") ||
      allowExplicitKnowledgeDestination ||
      (allowStrongResolvedDestination && hasStrongConfidence(destinationCandidate, 0.9));
    if (canWriteDestination && hasStrongConfidence(destinationCandidate, allowStrongResolvedDestination ? 0.9 : 0.84)) {
      next.destination = destinationCandidate;
    } else if (allowBackfill && !next.destination && hasStrongConfidence(destinationCandidate, 0.9)) {
      next.destination = destinationCandidate;
    }
  }

  if ((durableOwners.has("dates") || (allowBackfill && !next.dates)) && signals?.dates && hasStrongConfidence(signals.dates, 0.8)) {
    next.dates = mergeDates(next.dates, signals.dates);
  }

  if ((durableOwners.has("travelers") || (allowBackfill && !next.travelers)) && signals?.travelers && hasStrongConfidence(signals.travelers, 0.8)) {
    next.travelers = signals.travelers;
  }

  if ((durableOwners.has("budget") || (allowBackfill && !next.budget)) && signals?.budget && hasStrongConfidence(signals.budget, 0.8)) {
    next.budget = mergeBudget(next.budget, signals.budget);
  }

  if (durableOwners.has("vibe") && Array.isArray(signals?.vibe) && signals.vibe.length) {
    next.vibe = dedupeList([...(next.vibe || []), ...signals.vibe]);
  }

  if ((durableOwners.has("currency") || allowExplicitKnowledgeDestination) && signals?.currency) {
    next.currency = { ...next.currency, ...signals.currency };
  }

  if ((classification?.mode === "place_lookup" || classification?.mode === "nearby_search") && signals?.activePlace) {
    next.active_place = signals.activePlace;
  }
}

function applyResolvedContext(next, resolvedContext, classification, latestUserMessage) {
  if (!resolvedContext || typeof resolvedContext !== "object") return next;
  const signals = {
    route: { origin: resolvedContext.origin || null, destination: resolvedContext.destination || null },
    destination: resolvedContext.destination || null,
    dates: resolvedContext.dates || null,
    travelers: resolvedContext.travelers || null,
    budget: resolvedContext.budget || null,
    vibe: Array.isArray(resolvedContext.vibe) ? resolvedContext.vibe.map((item) => lower(item)) : [],
    activePlace: resolvedContext.active_place || null,
    currency: resolvedContext.currency || null,
  };
  applySignals(next, signals, {
    classification,
    source: "resolved",
    message: latestUserMessage,
  });
}

export function resolveMemoryFromRecentMessages({
  previousMemory,
  recentMessages,
  classification,
  resolvedContext,
  latestUserMessage,
}) {
  const next = normalizeMemory(previousMemory);
  for (const msg of Array.isArray(recentMessages) ? recentMessages : []) {
    if (msg?.role !== "user") continue;
    applySignals(next, collectSignals(msg.content, classification), {
      classification,
      source: "recent",
      message: msg.content,
    });
  }

  applyResolvedContext(next, resolvedContext, classification, latestUserMessage);
  applySignals(next, collectSignals(latestUserMessage, classification), {
    classification,
    source: "latest",
    message: latestUserMessage,
  });

  if (!next.currency && next.destination) {
    next.currency = inferCurrencyFromDestination(next.destination);
  }

  if (shouldClearActivePlace({ classification, latestUserMessage })) {
    const samePoi =
      next.active_place?.label &&
      (lower(latestUserMessage).includes(lower(next.active_place.label)) ||
        lower(classification?.query).includes(lower(next.active_place.label)));
    if (!samePoi) next.active_place = null;
  }

  next.last_mode = classification?.mode || next.last_mode || null;
  next.last_task = classification?.task || next.last_task || null;
  next.planning_stage = nextPlanningStage(next.last_mode, next.last_task, next.planning_stage);
  if (classification?.mode === "destination_discovery" && !next.planning_stage) {
    next.planning_stage = "discovery";
  }
  next.open_loops = buildOpenLoops(next);
  return next;
}

export function majorMemoryChanged(prev, next) {
  return (
    stableValue(prev?.destination?.label) !== stableValue(next?.destination?.label) ||
    stableValue(prev?.origin?.label) !== stableValue(next?.origin?.label) ||
    stableValue(prev?.currency?.code) !== stableValue(next?.currency?.code) ||
    stableValue(prev?.dates?.start_date) !== stableValue(next?.dates?.start_date) ||
    stableValue(prev?.dates?.end_date) !== stableValue(next?.dates?.end_date) ||
    stableValue(prev?.dates?.date_window_type) !== stableValue(next?.dates?.date_window_type) ||
    stableNumber(prev?.dates?.duration_days) !== stableNumber(next?.dates?.duration_days) ||
    Boolean(prev?.dates?.is_flexible) !== Boolean(next?.dates?.is_flexible) ||
    stableNumber(prev?.travelers?.count) !== stableNumber(next?.travelers?.count) ||
    stableValue(prev?.travelers?.composition) !== stableValue(next?.travelers?.composition) ||
    stableNumber(prev?.budget?.amount) !== stableNumber(next?.budget?.amount) ||
    stableValue(prev?.budget?.level) !== stableValue(next?.budget?.level) ||
    stableValue(prev?.budget?.currency) !== stableValue(next?.budget?.currency) ||
    stableList(prev?.vibe) !== stableList(next?.vibe) ||
    stableValue(prev?.active_place?.label) !== stableValue(next?.active_place?.label) ||
    stableValue(prev?.planning_stage) !== stableValue(next?.planning_stage) ||
    stableList(prev?.open_loops) !== stableList(next?.open_loops) ||
    stableValue(prev?.last_mode) !== stableValue(next?.last_mode) ||
    stableValue(prev?.last_task) !== stableValue(next?.last_task)
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
  const next = resolveMemoryFromRecentMessages({
    previousMemory: prev,
    recentMessages,
    classification,
    resolvedContext,
    latestUserMessage,
  });
  return {
    memory: next,
    majorChanged: majorMemoryChanged(prev, next),
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
  parts.push(`Destination: ${m.destination?.label || "unknown"}.`);
  if (m.origin?.label) parts.push(`Origin: ${m.origin.label}.`);

  const shape = [];
  if (m.dates?.duration_days) shape.push(`${m.dates.duration_days} days`);
  if (m.dates?.raw_text && !shape.includes(m.dates.raw_text)) shape.push(m.dates.raw_text);
  if (m.travelers?.composition) shape.push(m.travelers.composition);
  else if (m.travelers?.count) shape.push(`${m.travelers.count} travelers`);
  if (shape.length) parts.push(`Trip shape: ${shape.join(", ")}.`);

  if (m.budget?.level || m.budget?.amount != null) {
    const budgetBits = [m.budget?.level, m.budget?.amount != null ? `${m.budget.amount}${m.budget?.currency ? ` ${m.budget.currency}` : ""}` : null].filter(Boolean);
    parts.push(`Budget: ${budgetBits.join(", ")}.`);
  }
  if (m.currency?.code) parts.push(`Currency: ${m.currency.code}.`);
  if (m.vibe?.length) parts.push(`Vibes: ${m.vibe.join(", ")}.`);
  if (m.active_place?.label) parts.push(`Active place: ${m.active_place.label}.`);
  if (m.last_mode || m.last_task) {
    parts.push(`Current focus: ${[m.last_mode, m.last_task].filter(Boolean).join(" / ")}.`);
  }
  if (m.open_loops?.length) parts.push(`Open questions: ${m.open_loops.join(", ")}.`);
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
