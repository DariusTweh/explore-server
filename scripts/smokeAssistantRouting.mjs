import assert from "node:assert/strict";

const FLIGHT_KEYWORDS = [
  "flight",
  "flights",
  "airline",
  "airport",
  "depart",
  "early morning",
  "morning",
  "red eye",
  "redeye",
];

const HOTEL_KEYWORDS = [
  "hotel",
  "hotels",
  "stay",
  "stays",
  "staying",
  "accommodation",
  "lodging",
];
const ACTIVITY_KEYWORDS = [
  "things to do",
  "thing to do",
  "what to do",
  "attraction",
  "attractions",
  "activity",
  "activities",
  "tour",
  "tours",
  "experience",
  "experiences",
];
const RESTAURANT_KEYWORDS = [
  "restaurant",
  "restaurants",
  "food",
  "dinner",
  "lunch",
  "brunch",
  "eat",
  "eats",
  "dining",
];
const SPOT_KEYWORDS = [
  "spot",
  "spots",
  "place",
  "places",
  "cafe",
  "cafes",
  "coffee",
  "library",
  "gym",
  "restaurant",
  "restaurants",
  "bar",
  "bars",
  "park",
  "parks",
];
const SPOT_VERBS = ["show me", "find", "search", "look for", "nearest", "closest", "near me", "nearby"];
const PLAN_KEYWORDS = [
  "itinerary",
  "plan",
  "schedule",
  "trip plan",
  "build a trip",
  "plan a trip",
  "plan my trip",
  "trip to",
  "2-day",
  "3-day",
  "weekend trip",
  "romantic trip",
];

function sanitizeLocationText(text) {
  if (!text) return "";
  let cleaned = text.toLowerCase();
  cleaned = cleaned.replace(/[.,!?]/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  const stopPhrases = [" and ", " then ", " please ", " asap ", " thanks ", " thank you "];
  for (const phrase of stopPhrases) {
    const idx = cleaned.indexOf(phrase);
    if (idx !== -1) cleaned = cleaned.slice(0, idx).trim();
  }
  cleaned = cleaned.replace(/\b(?:please|thanks|thank you|asap)\b$/i, "").trim();
  return cleaned;
}

function trimTemporalLocationSuffix(text) {
  if (!text) return "";
  return String(text)
    .replace(
      /\b(next week|next month|this weekend|this week|tomorrow|today|tonight|for \d+ nights?|for \d+ days?)\b.*$/i,
      ""
    )
    .replace(/^(?:in|at|near|around)\s+/i, "")
    .trim();
}

function messageMentionsRestaurants(message) {
  const text = (message || "").toLowerCase();
  return RESTAURANT_KEYWORDS.some((kw) => text.includes(kw));
}

function messageMentionsSpots(message) {
  const text = (message || "").toLowerCase();
  const hasKeyword = SPOT_KEYWORDS.some((kw) => text.includes(kw));
  const hasVerb = SPOT_VERBS.some((kw) => text.includes(kw));
  const hasLocationHint =
    /\b(in|near|around|at|by)\s+[a-z]/i.test(text) || text.includes("near me");
  return hasKeyword && (hasVerb || hasLocationHint);
}

function messageMentionsHotels(message) {
  const text = (message || "").toLowerCase();
  return HOTEL_KEYWORDS.some((kw) => text.includes(kw));
}

function messageMentionsActivities(message) {
  const text = (message || "").toLowerCase();
  return ACTIVITY_KEYWORDS.some((kw) => text.includes(kw));
}

function messageMentionsFlights(message) {
  const text = (message || "").toLowerCase();
  if (messageMentionsRestaurants(message)) return false;
  if (messageMentionsSpots(message)) return false;
  if (messageMentionsHotels(message)) return false;
  if (messageMentionsActivities(message)) return false;
  return FLIGHT_KEYWORDS.some((kw) => text.includes(kw));
}

function messageMentionsTripPlan(message) {
  const text = (message || "").toLowerCase();
  return PLAN_KEYWORDS.some((kw) => text.includes(kw));
}

function detectLocationInMessage(message) {
  const text = (message || "").toLowerCase();
  const patterns = [
    /\b(?:going to|traveling to|trip to|heading to|visiting|visit)\s+([a-z\s'-]{2,})/i,
    /\b(?:in|around|near|at)\s+([a-z\s'-]{2,})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return sanitizeLocationText(match[1]);
  }
  return null;
}

function detectTravelMode(message) {
  const text = (message || "").toLowerCase();
  if (text.includes("drive") || text.includes("driving") || text.includes("road trip")) {
    return "drive";
  }
  if (text.includes("fly") || text.includes("flight") || text.includes("airplane")) {
    return "fly";
  }
  return null;
}

function parseRoute(message) {
  const text = (message || "").toLowerCase();
  const fromToMatch = text.match(/from\s+(.+?)\s+to\s+(.+)/i);
  if (fromToMatch) {
    return {
      fromText: sanitizeLocationText(fromToMatch[1].trim()),
      toText: sanitizeLocationText(fromToMatch[2].trim()),
    };
  }
  return null;
}

function parseHotelCity(message) {
  const text = (message || "").toLowerCase();
  const inMatch = text.match(/(?:hotel|hotels|stay|stays|accommodation|lodging)\s+in\s+(.+)/i);
  if (inMatch) return trimTemporalLocationSuffix(sanitizeLocationText(inMatch[1]));
  const atMatch = text.match(/(?:hotel|hotels|stay|stays|accommodation|lodging)\s+at\s+(.+)/i);
  if (atMatch) return trimTemporalLocationSuffix(sanitizeLocationText(atMatch[1]));
  const stayingMatch = text.match(/(?:staying(?:\s+in)?|stay\s+in)\s+(.+)/i);
  if (stayingMatch) return trimTemporalLocationSuffix(sanitizeLocationText(stayingMatch[1]));
  const nearMatch = text.match(
    /(?:hotel|hotels|stay|stays|staying|accommodation|lodging)\s+(?:near|around)\s+(.+)/i
  );
  if (nearMatch) return trimTemporalLocationSuffix(sanitizeLocationText(nearMatch[1]));
  return null;
}

function parseActivityLocation(message) {
  const text = (message || "").toLowerCase();
  const keywordPatterns = [
    /(?:things?\s+to\s+do|what\s+to\s+do|attractions?|activities?|tours?|experiences?)\s+in\s+(.+)/i,
    /(?:things?\s+to\s+do|what\s+to\s+do|attractions?|activities?|tours?|experiences?)\s+at\s+(.+)/i,
    /(?:find|show|search)\s+(?:things?\s+to\s+do|attractions?|activities?|tours?|experiences?)\s+in\s+(.+)/i,
  ];
  for (const pattern of keywordPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) return trimTemporalLocationSuffix(sanitizeLocationText(match[1]));
  }
  const generic = text.match(/\b(?:in|at|near)\s+([a-z\s'-]{2,})$/i);
  if (generic?.[1] && messageMentionsActivities(message)) {
    return trimTemporalLocationSuffix(sanitizeLocationText(generic[1]));
  }
  const aroundMatch = text.match(/\b(?:around)\s+([a-z\s'-]{2,})$/i);
  if (aroundMatch?.[1] && messageMentionsActivities(message)) {
    return trimTemporalLocationSuffix(sanitizeLocationText(aroundMatch[1]));
  }
  return null;
}

function parseSpotLocation(message) {
  const fromActivity = parseActivityLocation(message);
  if (fromActivity) return fromActivity;
  const text = (message || "").toLowerCase();
  if (text.includes("near me") || text.includes("nearby")) return null;
  const generic = text.match(/\b(?:in|near|around|at|by)\s+([a-z\s'-]{2,})$/i);
  if (generic?.[1]) return sanitizeLocationText(generic[1]);
  return null;
}

function getTimeWindow(message) {
  const text = (message || "").toLowerCase();
  if (text.includes("early morning")) return "early_morning";
  if (text.includes("morning")) return "morning";
  return "any";
}

const cases = [
  {
    label: "flight route parses",
    run: () => parseRoute("early morning flight from nyc to lax"),
    expect: { fromText: "nyc", toText: "lax" },
  },
  {
    label: "hotel intent catches staying phrasing",
    run: () => messageMentionsHotels("I'm staying in Miami next month"),
    expect: true,
  },
  {
    label: "hotel city parses staying in",
    run: () => parseHotelCity("I'm staying in Miami next month"),
    expect: "miami",
  },
  {
    label: "activity city parses around",
    run: () => parseActivityLocation("best things to do around Tokyo"),
    expect: "tokyo",
  },
  {
    label: "restaurants do not route as flights",
    run: () => messageMentionsFlights("best dinner spots in chicago"),
    expect: false,
  },
  {
    label: "simple flight keyword routes to flights",
    run: () => messageMentionsFlights("show me flights to lax"),
    expect: true,
  },
  {
    label: "early morning maps to early_morning time window",
    run: () => getTimeWindow("early morning flight from nyc to lax"),
    expect: "early_morning",
  },
  {
    label: "morning maps to morning time window",
    run: () => getTimeWindow("morning flights from sfo to jfk"),
    expect: "morning",
  },
  {
    label: "default time window is any",
    run: () => getTimeWindow("flights from sfo to jfk"),
    expect: "any",
  },
  {
    label: "flight route strips filler",
    run: () => parseRoute("can you find me a flight from nyc to lax please"),
    expect: { fromText: "nyc", toText: "lax" },
  },
  {
    label: "hotel city parses hotel in phrase",
    run: () => parseHotelCity("find me a hotel in Paris"),
    expect: "paris",
  },
  {
    label: "hotel city parses around phrase",
    run: () => parseHotelCity("stays around Kyoto for 3 nights"),
    expect: "kyoto",
  },
  {
    label: "hotel city returns null on no location",
    run: () => parseHotelCity("show me hotels"),
    expect: null,
  },
  {
    label: "activities intent detected",
    run: () => messageMentionsActivities("what are the best things to do in rome"),
    expect: true,
  },
  {
    label: "activity location parses in phrase",
    run: () => parseActivityLocation("what are the best things to do in Rome"),
    expect: "rome",
  },
  {
    label: "activity location trims temporal suffix",
    run: () => parseActivityLocation("activities in Tokyo next week"),
    expect: "tokyo",
  },
  {
    label: "spot intent detects cafes near me",
    run: () => messageMentionsSpots("find cafes near me"),
    expect: true,
  },
  {
    label: "spot location parses city tail",
    run: () => parseSpotLocation("best cafes in chicago"),
    expect: "chicago",
  },
  {
    label: "spot location returns null for near me",
    run: () => parseSpotLocation("find pharmacies near me"),
    expect: null,
  },
  {
    label: "restaurant intent detected",
    run: () => messageMentionsRestaurants("best dinner in chicago"),
    expect: true,
  },
  {
    label: "restaurants still count as spot search phrasing",
    run: () => messageMentionsSpots("find restaurants in miami"),
    expect: true,
  },
  {
    label: "trip plan intent detected",
    run: () => messageMentionsTripPlan("plan a trip to japan for me"),
    expect: true,
  },
  {
    label: "trip destination detected",
    run: () => detectLocationInMessage("I am going to Barcelona in June"),
    expect: "barcelona in june",
  },
  {
    label: "drive mode detected",
    run: () => detectTravelMode("we are driving from la to san diego"),
    expect: "drive",
  },
  {
    label: "fly mode detected",
    run: () => detectTravelMode("I want to fly from nyc to miami"),
    expect: "fly",
  },
  {
    label: "chat prompt does not look like flight",
    run: () => messageMentionsFlights("how are you today"),
    expect: false,
  },
  {
    label: "hotel prompt does not look like activity",
    run: () => messageMentionsActivities("hotel in tokyo"),
    expect: false,
  },
  {
    label: "activity prompt does not look like hotel",
    run: () => messageMentionsHotels("things to do in lisbon"),
    expect: false,
  },
  {
    label: "restaurant prompt does not look like hotel",
    run: () => messageMentionsHotels("best brunch in austin"),
    expect: false,
  },
  {
    label: "airport wording counts as flights",
    run: () => messageMentionsFlights("best airport options from jfk to lax"),
    expect: true,
  },
  {
    label: "route parser handles uppercase cities",
    run: () => parseRoute("Flights from NYC to LAX"),
    expect: { fromText: "nyc", toText: "lax" },
  },
  {
    label: "sanitize location removes thanks suffix",
    run: () => sanitizeLocationText("Tokyo thanks"),
    expect: "tokyo",
  },
];

let passed = 0;
for (const testCase of cases) {
  const actual = testCase.run();
  assert.deepEqual(actual, testCase.expect, testCase.label);
  passed += 1;
  console.log(`PASS ${testCase.label}`);
}

console.log(`\n${passed} assistant smoke checks passed`);
