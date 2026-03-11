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
  "what should i do",
  "what should we do",
  "what can i do",
  "sightseeing",
  "sight seeing",
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

function messageWantsRoundTrip(message) {
  const text = (message || "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("round trip") ||
    text.includes("roundtrip") ||
    text.includes("return flight") ||
    text.includes("return flights") ||
    text.includes("returning") ||
    text.includes("with return") ||
    text.includes("back on")
  );
}

function messageWantsOneWay(message) {
  const text = (message || "").toLowerCase();
  if (!text) return false;
  return text.includes("one way") || text.includes("one-way") || text.includes("oneway");
}

function messageMentionsFlightAdjustment(message) {
  const text = (message || "").toLowerCase();
  if (!text) return false;
  return (
    messageWantsRoundTrip(text) ||
    messageWantsOneWay(text) ||
    text.includes("keep same date") ||
    text.includes("keep same dates") ||
    text.includes("same dates") ||
    text.includes("switch destination") ||
    text.includes("change destination") ||
    text.includes("make it") ||
    text.includes("instead")
  );
}

function messageMentionsTripPlan(message) {
  const text = (message || "").toLowerCase();
  return PLAN_KEYWORDS.some((kw) => text.includes(kw));
}

function detectLocationInMessage(message) {
  const text = (message || "").toLowerCase();
  const patterns = [
    /\b(?:what about)\s+([a-z\s'-]{2,})/i,
    /\b(?:where is|where's|tell me about)\s+([a-z\s'-]{2,})/i,
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

function applyContextualLocationHint(message, location) {
  const text = String(message || "");
  const loc = String(location || "").trim();
  if (!text || !loc) return text;
  if (!/\bthere\b/i.test(text)) return text;
  if (detectLocationInMessage(text)) return text;
  return text.replace(/\bthere\b/gi, `in ${loc}`);
}

function isFollowupReply(message) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;
  if (text.split(/\s+/).length <= 8) return true;
  const genericFollowups = [
    "nothing specific",
    "just find me something",
    "surprise me",
    "whatever works",
    "anything",
    "something fun",
    "something chill",
    "sight seeing",
    "sightseeing",
  ];
  return genericFollowups.some((phrase) => text.includes(phrase));
}

function messageLooksGeneralInfoQuestion(message) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;
  const questionLead = /^(what|which|who|where|when|why|how)\b/i.test(text);
  const infoSignals =
    /\b(currency|language|timezone|time zone|weather|population|capital|visa|religion|culture)\b/i.test(
      text
    );
  const hasRouteSignal = /\bfrom\s+.+\s+to\s+.+\b/i.test(text);
  return (questionLead || infoSignals) && !hasRouteSignal;
}

function normalizePendingIntent(value) {
  const intent = String(value || "").trim().toLowerCase();
  if (
    intent === "activities" ||
    intent === "spots" ||
    intent === "restaurants" ||
    intent === "hotels" ||
    intent === "flights" ||
    intent === "trip_plan"
  ) {
    return intent;
  }
  return null;
}

function getEffectiveIntent(message, ctx) {
  const pendingIntent = normalizePendingIntent(ctx?.pendingIntent);
  const explicit = {
    tripPlan: messageMentionsTripPlan(message),
    hotels: messageMentionsHotels(message),
    spots: messageMentionsSpots(message),
    restaurants: messageMentionsRestaurants(message),
    activities: messageMentionsActivities(message),
    flights: messageMentionsFlights(message),
  };
  if (
    !explicit.tripPlan &&
    !explicit.hotels &&
    !explicit.spots &&
    !explicit.restaurants &&
    !explicit.activities &&
    !explicit.flights &&
    pendingIntent &&
    isFollowupReply(message) &&
    !messageLooksGeneralInfoQuestion(message)
  ) {
    if (pendingIntent === "restaurants") explicit.restaurants = true;
    if (pendingIntent === "spots") explicit.spots = true;
    if (pendingIntent === "activities") explicit.activities = true;
    if (pendingIntent === "hotels") explicit.hotels = true;
    if (pendingIntent === "flights") explicit.flights = true;
    if (pendingIntent === "trip_plan") explicit.tripPlan = true;
  }
  return explicit;
}

function cleanRouteEndpoint(text) {
  if (!text) return "";
  return trimTemporalLocationSuffix(sanitizeLocationText(text))
    .replace(
      /\b(next|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*$/i,
      ""
    )
    .replace(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\b.*$/i,
      ""
    )
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b.*$/i, "")
    .replace(/\b(?:on|for|during|leaving|departing)\b.*$/i, "")
    .trim();
}

function parseRoute(message) {
  const text = (message || "").toLowerCase();
  const fromToMatch = text.match(/from\s+(.+?)\s+to\s+(.+)/i);
  if (fromToMatch) {
    return {
      fromText: cleanRouteEndpoint(fromToMatch[1].trim()),
      toText: cleanRouteEndpoint(fromToMatch[2].trim()),
    };
  }
  return null;
}

function parseFlightDestinationOnly(message) {
  const text = (message || "").toLowerCase();
  const match = text.match(
    /\b(?:to|destination(?:\s+to)?|switch destination to|change destination to)\s+([a-z\s'-]{2,})/i
  );
  if (!match?.[1]) return null;
  return cleanRouteEndpoint(match[1]);
}

function parseHotelCity(message) {
  const text = (message || "").toLowerCase();
  const cleanHotelCity = (value) =>
    trimTemporalLocationSuffix(sanitizeLocationText(value))
      .replace(
        /\b(?:find|show|book|need|looking|search|with|for|please|can you|could you|help me)\b.*$/i,
        ""
      )
      .replace(/\b(?:near|close to)\s+transit\b.*$/i, "")
      .trim();
  const inMatch = text.match(/(?:hotel|hotels|stay|stays|accommodation|lodging)\s+in\s+(.+)/i);
  if (inMatch) return cleanHotelCity(inMatch[1]);
  const atMatch = text.match(/(?:hotel|hotels|stay|stays|accommodation|lodging)\s+at\s+(.+)/i);
  if (atMatch) return cleanHotelCity(atMatch[1]);
  const stayingMatch = text.match(/(?:staying(?:\s+in)?|stay\s+in)\s+(.+)/i);
  if (stayingMatch) return cleanHotelCity(stayingMatch[1]);
  const nearMatch = text.match(
    /(?:hotel|hotels|stay|stays|staying|accommodation|lodging)\s+(?:near|around)\s+(.+)/i
  );
  if (nearMatch) return cleanHotelCity(nearMatch[1]);
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
  const cleanSpotLocation = (value) =>
    sanitizeLocationText(value)
      .replace(/\b(?:open now|late night|24 hours?)\b.*$/i, "")
      .trim();
  const generic = text.match(
    /\b(?:in|near|around|at|by)\s+([a-z\s'-]{2,})(?:\s+(?:open now|late night|24 hours?))?$/i
  );
  if (generic?.[1]) return cleanSpotLocation(generic[1]);
  const midSentence = text.match(
    /\b(?:in|near|around|at|by)\s+([a-z\s'-]{2,}?)(?=\s+\b(?:open now|late night|24 hours?|with|for|please|find|show|search)\b|$)/i
  );
  if (midSentence?.[1]) return cleanSpotLocation(midSentence[1]);
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
    label: "hotel city parses staying clause with follow-up request",
    run: () => parseHotelCity("I’m staying in Kyoto, find me boutique hotels near transit"),
    expect: "kyoto",
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
    label: "one-way by default when return is not requested",
    run: () => messageWantsRoundTrip("show me flights from sfo to jfk"),
    expect: false,
  },
  {
    label: "round-trip is detected when explicitly requested",
    run: () => messageWantsRoundTrip("show me round trip flights from sfo to jfk"),
    expect: true,
  },
  {
    label: "flight follow-up adjustment intent is detected",
    run: () => messageMentionsFlightAdjustment("make it a round trip instead"),
    expect: true,
  },
  {
    label: "flight destination-only update parses",
    run: () => parseFlightDestinationOnly("Actually switch destination to BOS"),
    expect: "bos",
  },
  {
    label: "flight destination-only update is not parsed as full route",
    run: () => parseRoute("Actually switch destination to BOS and keep the same dates"),
    expect: null,
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
    label: "flight route strips day suffix from destination",
    run: () => parseRoute("Find me early morning flights from SFO to JFK next Friday"),
    expect: { fromText: "sfo", toText: "jfk" },
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
    label: "what should i do counts as activity intent",
    run: () => messageMentionsActivities("what should i do in amsterdam"),
    expect: true,
  },
  {
    label: "what should i do parses activity city",
    run: () => parseActivityLocation("what should i do in amsterdam"),
    expect: "amsterdam",
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
    label: "spot location parses city with open-now suffix",
    run: () => parseSpotLocation("find sushi restaurants in tokyo open now"),
    expect: "tokyo",
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
    label: "where is phrasing sets location context",
    run: () => detectLocationInMessage("Where is Bali"),
    expect: "bali",
  },
  {
    label: "what about phrasing sets new location context",
    run: () => detectLocationInMessage("Hmm what about Senegal"),
    expect: "senegal",
  },
  {
    label: "contextual there resolves to previous location",
    run: () => applyContextualLocationHint("What is the local language there?", "Bali"),
    expect: "What is the local language in Bali?",
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
    label: "short followup inherits activities intent",
    run: () => getEffectiveIntent("sight seeing", { pendingIntent: "activities" }).activities,
    expect: true,
  },
  {
    label: "generic followup inherits activities intent",
    run: () => getEffectiveIntent("nothing specific just find me something", { pendingIntent: "activities" }).activities,
    expect: true,
  },
  {
    label: "info question does not inherit pending flights intent",
    run: () => getEffectiveIntent("What is the currency compared to the US", { pendingIntent: "flights" }).flights,
    expect: false,
  },
  {
    label: "followup does not inherit without pending intent",
    run: () => getEffectiveIntent("sight seeing", {}).activities,
    expect: true,
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
