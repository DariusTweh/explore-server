import { supabaseAdmin } from "../utils/supabaseAdmin.js";
import { requireAuth } from "../utils/requireAuth.js";
import { cacheGet, cacheSet } from "../utils/memoryCache.js";
import {
  searchFlightLocations,
  searchFlights,
} from "../providers/bookingcom/flights.js";
import {
  searchHotelDestination,
  searchHotels,
} from "../services/hotelsService.js";
import { normalizeHotelsResponse } from "../utils/normalizeHotels.js";
import { searchAttractionLocations } from "../services/attractionLocationService.js";
import { searchAttractions } from "../services/attractionsSearchService.js";
import { normalizeAttractionLocations } from "../utils/normalizeAttractionLocations.js";
import { normalizeAttractions } from "../utils/normalizeAttractions.js";
import { resolveCityGeo } from "../utils/providers/activities.js";
import {
  placesNearbySearchNew,
  placesSearchTextNew,
  placesAutocompleteNew,
  placesDetailsNew,
  buildPhotoUrl,
} from "../utils/googlePlaces.js";
import { classifyAssistantIntent } from "../utils/assistantIntent.js";
import { bookingGet } from "../utils/bookingClient.js";
import { getCoordsFromCache, upsertCoordsCache } from "../utils/coordsCache.js";
import { geocodeMapbox } from "../utils/geocodeMapbox.js";
import { generatePlanOutline } from "../utils/planOutline.js";
import {
  buildFlightSubtitle,
  shortlistFlightOffers,
} from "../utils/scoreFlights.js";
import { scheduleDay, SCHEDULE_DEFAULTS } from "../utils/scheduleDay.js";

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
  "grocery",
  "supermarket",
  "pharmacy",
  "drugstore",
  "gas",
  "gas station",
  "atm",
  "bank",
  "hospital",
  "clinic",
  "doctor",
  "dentist",
  "laundry",
  "laundromat",
  "mall",
  "shopping",
  "bookstore",
  "bakery",
  "convenience store",
  "hardware",
  "electronics",
  "clothing",
  "shoe",
  "furniture",
  "department store",
  "liquor",
  "pet store",
  "vet",
  "salon",
  "barber",
  "spa",
  "post office",
  "parking",
  "car wash",
  "car repair",
  "car rental",
  "movie",
  "theater",
  "museum",
  "night club",
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

const SPOT_VERBS = [
  "show me",
  "find",
  "search",
  "look for",
  "nearest",
  "closest",
  "open now",
  "late night",
  "near me",
  "nearby",
];

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

function messageMentionsHotels(message) {
  const text = (message || "").toLowerCase();
  return HOTEL_KEYWORDS.some((kw) => text.includes(kw));
}

function messageMentionsActivities(message) {
  const text = (message || "").toLowerCase();
  return ACTIVITY_KEYWORDS.some((kw) => text.includes(kw));
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

function messageWantsBookableActivities(message) {
  const text = (message || "").toLowerCase();
  const bookingSignals = [
    "book",
    "booking",
    "ticket",
    "tickets",
    "reserve",
    "reservation",
    "availability",
    "skip the line",
    "skip-the-line",
    "price",
    "cost",
  ];
  return bookingSignals.some((kw) => text.includes(kw));
}

function messageMentionsSpots(message) {
  const text = (message || "").toLowerCase();
  const hasKeyword = SPOT_KEYWORDS.some((kw) => text.includes(kw));
  const hasVerb = SPOT_VERBS.some((kw) => text.includes(kw));
  const hasLocationHint =
    /\b(in|near|around|at|by)\s+[a-z]/i.test(text) || text.includes("near me");
  return hasKeyword && (hasVerb || hasLocationHint);
}

function messageMentionsRestaurants(message) {
  const text = (message || "").toLowerCase();
  return RESTAURANT_KEYWORDS.some((kw) => text.includes(kw));
}

function messageMentionsTripPlan(message) {
  const text = (message || "").toLowerCase();
  return PLAN_KEYWORDS.some((kw) => text.includes(kw));
}

function messageAsksForSummary(message) {
  const text = (message || "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("summarize") ||
    text.includes("summary") ||
    text.includes("recap") ||
    text.includes("what we decided") ||
    text.includes("what did we decide")
  );
}

function messageIsAffirmative(message) {
  const text = String(message || "").trim().toLowerCase();
  return ["yes", "y", "yep", "yeah", "sure", "ok", "okay", "please do"].includes(text);
}

function applyContextualLocationHint(message, location) {
  const text = String(message || "");
  const loc = String(location || "").trim();
  if (!text || !loc) return text;
  if (!/\bthere\b/i.test(text)) return text;
  if (detectLocationInMessage(text)) return text;
  return text.replace(/\bthere\b/gi, `in ${loc}`);
}

function buildContextSummaryMessage(ctx) {
  const parts = [];
  const flight = ctx?.lastFlight;
  if (flight?.fromLabel && flight?.toLabel && flight?.departDate) {
    const tripType = flight?.returnDate ? "round-trip" : "one-way";
    const dateText = flight?.returnDate
      ? `${flight.departDate} to ${flight.returnDate}`
      : flight.departDate;
    const timeText = flight?.timeWindow && flight.timeWindow !== "any"
      ? ` (${flight.timeWindow.replace("_", " ")})`
      : "";
    parts.push(`Flights: ${tripType} ${flight.fromLabel} -> ${flight.toLabel} on ${dateText}${timeText}.`);
  }
  if (ctx?.lastHotel?.city) {
    const hotelDates = ctx.lastHotel.checkIn && ctx.lastHotel.checkOut
      ? ` (${ctx.lastHotel.checkIn} to ${ctx.lastHotel.checkOut})`
      : "";
    parts.push(`Hotels: searching in ${ctx.lastHotel.city}${hotelDates}.`);
  }
  if (ctx?.lastPlaces?.category && ctx?.lastPlaces?.location) {
    const modifierText = ctx.lastPlaces.openNow ? " (open now)" : "";
    parts.push(
      `${ctx.lastPlaces.category === "restaurants" ? "Dining" : "Spots"}: ${ctx.lastPlaces.category} in ${ctx.lastPlaces.location}${modifierText}.`
    );
  }
  if (ctx?.lastIntent && !parts.length) {
    parts.push(`Latest focus: ${ctx.lastIntent.replace("_", " ")}.`);
  }
  if (!parts.length) {
    return "We have not locked in concrete decisions yet. Share your route or destination and I will summarize as we go.";
  }
  return `Here is the recap:\n- ${parts.join("\n- ")}`;
}

function sanitizeLocationText(text) {
  if (!text) return "";
  let cleaned = text.toLowerCase();
  cleaned = cleaned.replace(/[.,!?]/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  const stopPhrases = [" and ", " then ", " please ", " asap ", " thanks ", " thank you "];
  for (const phrase of stopPhrases) {
    const idx = cleaned.indexOf(phrase);
    if (idx !== -1) {
      cleaned = cleaned.slice(0, idx).trim();
    }
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

function detectStandaloneLocationReply(message) {
  const cleaned = sanitizeLocationText(message);
  if (!cleaned) return null;
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  if (wordCount > 5) return null;
  if (/\d/.test(cleaned)) return null;
  if (
    [
      "yes",
      "no",
      "maybe",
      "not sure",
      "tomorrow",
      "today",
      "next week",
      "this weekend",
      "morning",
      "afternoon",
      "evening",
    ].includes(cleaned)
  ) {
    return null;
  }
  return cleaned;
}

function detectTravelMode(message) {
  const text = (message || "").toLowerCase();
  if (text.includes("drive") || text.includes("driving") || text.includes("road trip"))
    return "drive";
  if (text.includes("fly") || text.includes("flight") || text.includes("airplane"))
    return "fly";
  return null;
}

function getContextKey(authUser, tripId) {
  const base = authUser?.id || "anon";
  const trip = tripId || "no_trip";
  return `assistant:context:${base}:${trip}`;
}

function getAssistantContext(authUser, tripId) {
  const key = getContextKey(authUser, tripId);
  return cacheGet(key) || {};
}

function setAssistantContext(authUser, tripId, patch) {
  const key = getContextKey(authUser, tripId);
  const current = cacheGet(key) || {};
  const next = { ...current, ...patch, updatedAt: Date.now() };
  cacheSet(key, next, 1000 * 60 * 60 * 2);
  return next;
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

  const simpleMatch = text.match(/([a-z\s]+?)\s+to\s+([a-z\s]+)/i);
  if (simpleMatch) {
    const fromCandidate = cleanRouteEndpoint(simpleMatch[1].trim());
    const toCandidate = cleanRouteEndpoint(simpleMatch[2].trim());
    const invalidFrom =
      !fromCandidate ||
      /\b(?:switch|change|destination|make it|instead|actually|keep same dates?)\b/i.test(
        fromCandidate
      );
    if (invalidFrom) return null;
    return {
      fromText: fromCandidate,
      toText: toCandidate,
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

function parseOriginDestinationForPlan(message) {
  const text = (message || "").toLowerCase();
  const fromMatch = text.match(/from\s+([a-z\s'-]{2,})/i);
  const toMatch = text.match(/to\s+([a-z\s'-]{2,})/i);

  const cleanCandidate = (value, stopWord) => {
    if (!value) return null;
    let candidate = sanitizeLocationText(value);
    candidate = candidate.replace(/\b(on|for|with|and|during|from|to)\b.*$/i, "").trim();
    if (stopWord) {
      const idx = candidate.indexOf(` ${stopWord} `);
      if (idx !== -1) {
        candidate = candidate.slice(0, idx).trim();
      }
    }
    if (!candidate || /\d/.test(candidate)) return null;
    return candidate;
  };

  const fromText = cleanCandidate(fromMatch?.[1] || null, "to");
  const toText = cleanCandidate(toMatch?.[1] || null, "from");

  if (fromText || toText) {
    return { fromText, toText };
  }

  const toOnly = text.match(/\btrip to\s+([a-z\s'-]{2,})/i);
  if (toOnly?.[1]) {
    const dest = cleanCandidate(toOnly[1]);
    if (dest) return { fromText: null, toText: dest };
  }

  return null;
}

function normalizeTitleKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimeToMinutes(isoLike) {
  if (!isoLike) return null;
  const timePart = String(isoLike).split("T")[1] || "";
  const [hh, mm] = timePart.split(":");
  const hour = Number(hh);
  const min = Number(mm);
  if (!Number.isFinite(hour) || !Number.isFinite(min)) return null;
  return hour * 60 + min;
}

function minutesToClock(totalMinutes) {
  const value = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const hh = String(Math.floor(value / 60)).padStart(2, "0");
  const mm = String(value % 60).padStart(2, "0");
  return `${hh}:${mm}`;
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
    /(?:what\s+should\s+i\s+do|what\s+should\s+we\s+do|what\s+can\s+i\s+do)\s+in\s+(.+)/i,
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

  const keywordTail = text.match(
    /\b(?:cafe|cafes|coffee|library|gym|restaurant|restaurants|bar|bars|park|parks|atm|pharmacy|drugstore|gas|gas station|grocery|supermarket|laundry|laundromat|museum|mall|shopping|bookstore|bakery|convenience store|hardware|electronics|clothing|shoe|furniture|department store|liquor|pet store|vet|salon|barber|spa|post office|parking|car wash|car repair|car rental|movie|theater|night club)\s+([a-z\s'-]{2,})$/i
  );
  if (keywordTail?.[1]) return cleanSpotLocation(keywordTail[1]);

  return null;
}

function inferSpotTypes(message, { defaultType = null } = {}) {
  const text = (message || "").toLowerCase();
  const types = new Set();
  if (text.includes("things to do") || text.includes("what to do")) {
    types.add("tourist_attraction");
  }
  if (text.includes("cafe") || text.includes("cafes") || text.includes("coffee")) types.add("cafe");
  if (text.includes("library")) types.add("library");
  if (text.includes("gym")) types.add("gym");
  if (text.includes("restaurant")) types.add("restaurant");
  if (text.includes("bar")) types.add("bar");
  if (text.includes("park")) types.add("park");
  if (text.includes("grocery") || text.includes("supermarket")) types.add("supermarket");
  if (text.includes("pharmacy") || text.includes("drugstore")) types.add("pharmacy");
  if (text.includes("gas")) types.add("gas_station");
  if (text.includes("atm")) types.add("atm");
  if (text.includes("bank")) types.add("bank");
  if (text.includes("hospital")) types.add("hospital");
  if (text.includes("clinic") || text.includes("doctor")) types.add("doctor");
  if (text.includes("dentist")) types.add("dentist");
  if (text.includes("laundry") || text.includes("laundromat")) types.add("laundry");
  if (text.includes("mall") || text.includes("shopping")) types.add("shopping_mall");
  if (text.includes("bookstore")) types.add("book_store");
  if (text.includes("bakery")) types.add("bakery");
  if (text.includes("convenience")) types.add("convenience_store");
  if (text.includes("hardware")) types.add("hardware_store");
  if (text.includes("electronics")) types.add("electronics_store");
  if (text.includes("clothing")) types.add("clothing_store");
  if (text.includes("shoe")) types.add("shoe_store");
  if (text.includes("furniture")) types.add("furniture_store");
  if (text.includes("department")) types.add("department_store");
  if (text.includes("liquor")) types.add("liquor_store");
  if (text.includes("pet store") || (text.includes("pet") && text.includes("store"))) types.add("pet_store");
  if (text.includes("vet") || text.includes("veterinary")) types.add("veterinary_care");
  if (text.includes("salon") || text.includes("beauty")) types.add("beauty_salon");
  if (text.includes("barber")) types.add("hair_care");
  if (text.includes("spa")) types.add("spa");
  if (text.includes("post office")) types.add("post_office");
  if (text.includes("parking")) types.add("parking");
  if (text.includes("car wash")) types.add("car_wash");
  if (text.includes("car repair")) types.add("car_repair");
  if (text.includes("car rental")) types.add("car_rental");
  if (text.includes("movie") || text.includes("theater")) types.add("movie_theater");
  if (text.includes("museum")) types.add("museum");
  if (text.includes("night club") || text.includes("club")) types.add("night_club");
  if (!types.size && defaultType) types.add(defaultType);
  return Array.from(types);
}

function extractSpotModifiers(message) {
  const text = (message || "").toLowerCase();
  const openNow = text.includes("open now");
  const lateNight =
    text.includes("late night") || text.includes("late-night") || text.includes("24 hour");
  const rank =
    text.includes("closest") || text.includes("nearby") || text.includes("near me")
      ? "distance"
      : text.includes("best") || text.includes("top rated")
        ? "popularity"
        : "popularity";

  const radiusMatch = text.match(
    /\bwithin\s+(\d+(?:\.\d+)?)\s*(mile|miles|km|kilometer|kilometers|m|meter|meters)\b/i
  );
  let radiusMeters = null;
  if (radiusMatch) {
    const value = Number(radiusMatch[1]);
    const unit = radiusMatch[2].toLowerCase();
    if (Number.isFinite(value)) {
      if (unit.startsWith("mile")) radiusMeters = Math.round(value * 1609.34);
      else if (unit.startsWith("km") || unit.startsWith("kilometer"))
        radiusMeters = Math.round(value * 1000);
      else radiusMeters = Math.round(value);
    }
  }

  return { openNow, lateNight, rank, radiusMeters };
}

function stripLocationAndVerbs(message) {
  if (!message) return "";
  let text = message.toLowerCase();
  text = text.replace(/\b(in|near|around|at|by)\s+[a-z\s'-]{2,}$/i, "");
  for (const verb of SPOT_VERBS) {
    text = text.replace(verb, "");
  }
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function chooseDisplayLocationLabel(resolvedLabel, locationText) {
  const resolved = String(resolvedLabel || "").trim();
  const fallback = String(locationText || "").trim();
  if (!resolved) return fallback || null;
  if (/\brailway\b/i.test(resolved) && fallback) return fallback;
  return resolved;
}

async function resolveSpotCenter({ locationText, clientLat, clientLng }) {
  if (clientLat !== null && clientLng !== null) {
    return { lat: clientLat, lng: clientLng, label: "Current location" };
  }
  if (!locationText) return null;

  const cacheKey = `places:resolve:${locationText}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const fallback = await resolveCityGeo(locationText);
    if (fallback?.lat !== undefined && fallback?.lng !== undefined) {
      const resolved = {
        lat: fallback.lat,
        lng: fallback.lng,
        label: fallback.label || locationText,
        placeId: null,
      };
      cacheSet(cacheKey, resolved, 1000 * 60 * 60);
      return resolved;
    }
  } catch {
    // ignore
  }

  try {
    const fieldMask =
      "suggestions.placePrediction.placeId," +
      "suggestions.placePrediction.text," +
      "suggestions.placePrediction.structuredFormat";
    const auto = await placesAutocompleteNew({ input: locationText }, fieldMask);
    const suggestion = Array.isArray(auto?.suggestions) ? auto.suggestions[0] : null;
    const placeId = suggestion?.placePrediction?.placeId || null;

    if (placeId) {
      const detailMask = ["id", "displayName", "location", "formattedAddress"].join(",");
      const details = await placesDetailsNew(placeId, detailMask);
      const lat = details?.location?.latitude ?? null;
      const lng = details?.location?.longitude ?? null;
      const label =
        details?.shortFormattedAddress ||
        details?.formattedAddress ||
        details?.displayName?.text ||
        locationText;
      if (lat !== null && lng !== null) {
        const resolved = { lat, lng, label, placeId };
        cacheSet(cacheKey, resolved, 1000 * 60 * 60);
        return resolved;
      }
    }
  } catch {
    // fall through to text search
  }

  try {
    const fieldMask = [
      "places.id",
      "places.displayName",
      "places.location",
      "places.formattedAddress",
      "places.shortFormattedAddress",
    ].join(",");
    const data = await placesSearchTextNew(
      { textQuery: locationText, maxResultCount: 1 },
      fieldMask
    );
    const place = Array.isArray(data?.places) ? data.places[0] : null;
    if (!place?.location) return null;
    const resolved = {
      lat: place.location.latitude ?? null,
      lng: place.location.longitude ?? null,
      label:
        place.shortFormattedAddress ||
        place.formattedAddress ||
        place.displayName?.text ||
        locationText,
      placeId: place.id || null,
    };
    if (resolved.lat !== null && resolved.lng !== null) {
      cacheSet(cacheKey, resolved, 1000 * 60 * 60);
    }
    return resolved;
  } catch {
    // fall through to amadeus fallback
  }

  return null;
}

function normalizePlacesNearby(places) {
  const list = Array.isArray(places) ? places : [];
  return list.map((place) => {
    const photoRef = place?.photos?.[0]?.name || null;
    return {
      placeId: place?.id || null,
      providerId: place?.id || null,
      name: place?.displayName?.text || null,
      address: place?.shortFormattedAddress || place?.formattedAddress || null,
      rating: place?.rating ?? null,
      ratingCount: place?.userRatingCount ?? null,
      lat: place?.location?.latitude ?? null,
      lng: place?.location?.longitude ?? null,
      imageUrl: photoRef ? buildPhotoUrl(photoRef, 500) : null,
    };
  });
}

function buildSpotMarkers(places) {
  const list = Array.isArray(places) ? places : [];
  return list
    .map((p) => ({
      id: p.placeId || p.providerId || p.name,
      lat: Number(p.lat),
      lng: Number(p.lng),
      title: p.name || "Spot",
      subtitle: p.address || "",
    }))
    .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
}

function sanitizeAttractionId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.includes(":")) return raw;
  const [left, right] = raw.split(":");
  if (/^\d+$/.test(left)) return left;
  if (/^\d+$/.test(right || "")) return right;
  return left || raw;
}

async function handlePlacesIntent({
  message,
  tripId,
  workspaceId,
  authUser,
  locationText,
  nearMe,
  isRestaurantIntent,
  queryOverride,
  modifiersOverride,
  clientLat,
  clientLng,
  logger,
}) {
  const startedAt = Date.now();
  const modifiers = modifiersOverride || extractSpotModifiers(message);
  const broadPlacesQuery =
    !isRestaurantIntent && /\b(best|top)\s+places?\s+in\b/i.test(String(message || ""));
  const typeHints = inferSpotTypes(message, {
    defaultType: isRestaurantIntent
      ? "restaurant"
      : broadPlacesQuery
        ? "tourist_attraction"
        : "cafe",
  });

  if (!nearMe && !locationText) {
    return {
      assistantMessage: "Which city should I look around for spots?",
    };
  }

  let resolvedTripId = tripId || null;
  if (tripId) {
    const { data, error } = await supabaseAdmin
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .eq("user_id", authUser.id)
      .single();
    if (error || !data?.id) resolvedTripId = null;
  }
  const resultRefId = resolvedTripId || workspaceId || null;

  const hasClientLocation =
    Number.isFinite(clientLat) &&
    Number.isFinite(clientLng) &&
    !(clientLat === 0 && clientLng === 0);

  const resolved = await resolveSpotCenter({
    locationText: nearMe ? null : locationText,
    clientLat: nearMe && hasClientLocation ? clientLat : null,
    clientLng: nearMe && hasClientLocation ? clientLng : null,
  });
  console.log("[spots] resolve", {
    message: message?.slice(0, 80),
    locationText,
    nearMe,
    clientLat: hasClientLocation ? clientLat : null,
    clientLng: hasClientLocation ? clientLng : null,
    resolved,
  });

  if (nearMe && !resolved) {
    return {
      assistantMessage: "Turn on location to find spots near you.",
      errorCode: "NEEDS_LOCATION",
    };
  }

  if (!resolved?.lat || !resolved?.lng) {
    return {
      assistantMessage: `I couldn't locate ${locationText}. Try another city.`,
    };
  }

  const radius = modifiers.radiusMeters || 3000;
  const rankPreference = modifiers.rank || "popularity";
  const hasOverrideQuery = String(queryOverride || "").trim().length > 0;
  const useTextSearch = hasOverrideQuery || modifiers.lateNight || !typeHints.length || broadPlacesQuery;
  const q = hasOverrideQuery
    ? String(queryOverride).trim()
    : useTextSearch
      ? broadPlacesQuery
        ? `top attractions in ${locationText || ""}`.trim()
        : stripLocationAndVerbs(message)
      : null;
  const categoryLabel = isRestaurantIntent ? "restaurants" : "spots";
  const displayLocation = chooseDisplayLocationLabel(resolved?.label, locationText);

  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.location",
    "places.formattedAddress",
    "places.shortFormattedAddress",
    "places.rating",
    "places.userRatingCount",
    "places.photos",
  ].join(",");

  let results;
  let searchMode = "nearby";
  if (useTextSearch) {
    searchMode = "text";
    const textQuery = q || typeHints.join(" ") || "spots";
    const lateNightHint = modifiers.lateNight ? " late night 24 hours" : "";
    const body = {
      textQuery: `${textQuery}${lateNightHint}`.trim(),
      maxResultCount: 12,
      rankPreference: rankPreference === "distance" ? "DISTANCE" : "RELEVANCE",
      locationBias: {
        circle: {
          center: { latitude: resolved.lat, longitude: resolved.lng },
          radius,
        },
      },
    };
    if (typeHints.length === 1) body.includedType = typeHints[0];
    if (modifiers.openNow) body.openNow = true;
    results = await placesSearchTextNew(body, fieldMask);
  } else {
    const body = {
      locationRestriction: {
        circle: {
          center: { latitude: resolved.lat, longitude: resolved.lng },
          radius,
        },
      },
      includedTypes: typeHints.length ? typeHints : ["cafe"],
      maxResultCount: 12,
      rankPreference: rankPreference === "distance" ? "DISTANCE" : "POPULARITY",
    };
    if (modifiers.openNow) body.openNow = true;
    results = await placesNearbySearchNew(body, fieldMask);
  }

  let cards = normalizePlacesNearby(results?.places).slice(0, 6);
  if (!cards.length && !isRestaurantIntent) {
    try {
      const fallbackBody = {
        locationRestriction: {
          circle: {
            center: { latitude: resolved.lat, longitude: resolved.lng },
            radius,
          },
        },
        includedTypes: ["tourist_attraction", "museum", "park"],
        maxResultCount: 12,
        rankPreference: "POPULARITY",
      };
      const fallback = await placesNearbySearchNew(fallbackBody, fieldMask);
      cards = normalizePlacesNearby(fallback?.places).slice(0, 6);
      if (cards.length) searchMode = "nearby_fallback";
    } catch {
      // no-op
    }
  }
  const markers = buildSpotMarkers(cards);
  const keyword = q || typeHints.join(" ") || (isRestaurantIntent ? "restaurants" : "spots");

  const payload = {
    assistantMessage: cards.length
      ? `Here are some ${isRestaurantIntent ? "restaurants" : "spots"} in ${displayLocation}.`
      : `I couldn't find ${isRestaurantIntent ? "restaurants" : "spots"} in ${displayLocation} right now.`,
    cards,
    actions: [
      {
        type: "view_all_spots",
        label: "View all",
        params: {
          tripId: resultRefId,
          tab: isRestaurantIntent ? "restaurant" : "spots",
          category: categoryLabel,
          label: displayLocation || "Spots",
          lat: resolved.lat,
          lng: resolved.lng,
          radius,
          keyword,
        },
      },
      {
        type: "view_map_spots",
        label: "Map",
        params: {
          tripId: resultRefId,
          source: "spots",
        },
      },
    ],
    toolResult: {
      type: "places_results",
      center: {
        lat: resolved.lat,
        lng: resolved.lng,
        label: displayLocation || "Current location",
      },
      places: cards,
      markers,
      meta: {
        category: typeHints.join(","),
        q: q || null,
        openNow: modifiers.openNow,
        lateNight: modifiers.lateNight,
        rank: rankPreference,
        radius,
        searchMode,
      },
    },
    tripId: resultRefId,
  };
  logger?.info?.(
    {
      ms: Date.now() - startedAt,
      mode: searchMode,
      results: cards.length,
      nearMe,
      locationText: locationText || null,
      query: q || null,
    },
    "[assistant] places_intent"
  );
  return payload;
}

function getTimeWindow(message) {
  const text = (message || "").toLowerCase();
  if (text.includes("early morning")) return "early_morning";
  if (text.includes("morning")) return "morning";
  return "any";
}

function toDateString(date) {
  const d = new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function makePlanId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

function normalizeDateInput(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return toDateString(d);
}

function parseDateRangeFromText(text) {
  if (!text) return null;
  const raw = String(text).toLowerCase();
  const monthMap = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };

  const isoRange = raw.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|-|–)\s*(\d{4}-\d{2}-\d{2})/);
  if (isoRange) {
    return {
      startDate: normalizeDateInput(isoRange[1]),
      endDate: normalizeDateInput(isoRange[2]),
    };
  }

  const singleIso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (singleIso) {
    const date = normalizeDateInput(singleIso[1]);
    return date ? { startDate: date, endDate: date } : null;
  }

  const relativeSingleMap = {
    today: 0,
    tonight: 0,
    tomorrow: 1,
  };
  for (const [token, offset] of Object.entries(relativeSingleMap)) {
    if (raw.includes(token)) {
      const date = addDays(new Date(), offset);
      const normalized = toDateString(date);
      return { startDate: normalized, endDate: normalized };
    }
  }

  const weekdayMap = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const weekdayMatch = raw.match(/\b(this|next)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekdayMatch) {
    const mode = weekdayMatch[1];
    const targetWeekday = weekdayMap[weekdayMatch[2]];
    const now = new Date();
    const todayWeekday = now.getUTCDay();
    let daysAhead = (targetWeekday - todayWeekday + 7) % 7;
    if (mode === "next") {
      daysAhead = daysAhead === 0 ? 7 : daysAhead + 7;
    } else if (daysAhead === 0) {
      daysAhead = 7;
    }
    const start = addDays(now, daysAhead);
    const end = addDays(start, 3);
    return { startDate: toDateString(start), endDate: toDateString(end) };
  }

  if (raw.includes("this weekend") || raw.includes("next weekend")) {
    const now = new Date();
    const weekday = now.getUTCDay();
    const daysUntilSaturday = ((6 - weekday + 7) % 7) || 7;
    const start = addDays(now, daysUntilSaturday);
    const end = addDays(start, 2);
    return { startDate: toDateString(start), endDate: toDateString(end) };
  }

  if (raw.includes("next week")) {
    const now = new Date();
    const weekday = now.getUTCDay();
    const daysUntilNextMonday = ((1 - weekday + 7) % 7) || 7;
    const start = addDays(now, daysUntilNextMonday);
    const end = addDays(start, 4);
    return { startDate: toDateString(start), endDate: toDateString(end) };
  }

  const monthRange = raw.match(
    /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:to|-|–)\s*(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?/
  );
  if (monthRange) {
    const month = monthMap[monthRange[1]];
    const dayStart = Number(monthRange[2]);
    const dayEnd = Number(monthRange[3]);
    const year = Number(monthRange[4] || new Date().getUTCFullYear());
    if (Number.isFinite(month) && dayStart && dayEnd) {
      const start = new Date(Date.UTC(year, month, dayStart));
      const end = new Date(Date.UTC(year, month, dayEnd));
      return { startDate: toDateString(start), endDate: toDateString(end) };
    }
  }

  const monthSingle = raw.match(
    /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?/
  );
  if (monthSingle) {
    const month = monthMap[monthSingle[1]];
    const day = Number(monthSingle[2]);
    const year = Number(monthSingle[3] || new Date().getUTCFullYear());
    if (Number.isFinite(month) && day) {
      const date = new Date(Date.UTC(year, month, day));
      return { startDate: toDateString(date), endDate: toDateString(date) };
    }
  }

  return null;
}

function normalizeCreateTripPrefs(input) {
  const prefs = input && typeof input === "object" ? input : null;
  if (!prefs) return null;
  const travelers = Number(prefs.travelers);
  const breakdown = prefs.travelerBreakdown && typeof prefs.travelerBreakdown === "object"
    ? prefs.travelerBreakdown
    : null;

  const adults = Number(breakdown?.adults);
  const children = Number(breakdown?.children);
  const infants = Number(breakdown?.infants);
  const pets = Number(breakdown?.pets);

  return {
    destination: prefs.destination ? String(prefs.destination).trim() : null,
    destinationPlaceId: prefs.destinationPlaceId ? String(prefs.destinationPlaceId).trim() : null,
    roadTrip: Boolean(prefs.roadTrip),
    startDate: normalizeDateInput(prefs.startDate),
    endDate: normalizeDateInput(prefs.endDate),
    travelers: Number.isFinite(travelers) ? Math.max(1, Math.round(travelers)) : null,
    travelerBreakdown: {
      adults: Number.isFinite(adults) ? Math.max(0, Math.round(adults)) : 0,
      children: Number.isFinite(children) ? Math.max(0, Math.round(children)) : 0,
      infants: Number.isFinite(infants) ? Math.max(0, Math.round(infants)) : 0,
      pets: Number.isFinite(pets) ? Math.max(0, Math.round(pets)) : 0,
    },
    budget: prefs.budget ? String(prefs.budget).trim().toLowerCase() : null,
  };
}

function deriveAdultCount(userPrefs, fallback = 1) {
  const adultsFromBreakdown = Number(userPrefs?.travelerBreakdown?.adults);
  if (Number.isFinite(adultsFromBreakdown) && adultsFromBreakdown > 0) {
    return Math.max(1, Math.min(9, Math.round(adultsFromBreakdown)));
  }
  const travelerTotal = Number(userPrefs?.travelers);
  if (Number.isFinite(travelerTotal) && travelerTotal > 0) {
    return Math.max(1, Math.min(9, Math.round(travelerTotal)));
  }
  return Math.max(1, Math.min(9, Math.round(fallback)));
}

function pickTopMatchByName(list, query) {
  const q = String(query || "").toLowerCase();
  if (!q) return null;
  let best = null;
  let bestScore = -1;
  for (const item of list || []) {
    const name = String(item?.name || "").toLowerCase();
    if (!name) continue;
    let score = 0;
    if (name === q) score += 5;
    if (name.includes(q) || q.includes(name)) score += 3;
    const words = q.split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (name.includes(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore > 0 ? best : null;
}

function dedupeBy(list, getKey) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(list) ? list : []) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function hashString(value) {
  const text = String(value || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function scoreAttractionCandidate(item) {
  const rating = Number(item?.rating?.average || 0);
  const reviewCount = Number(item?.rating?.allReviewsCount || item?.rating?.total || 0);
  const price = Number(item?.price?.publicAmount || item?.price?.amount || 0);
  const flagScore = Array.isArray(item?.flags)
    ? item.flags.reduce((sum, flag) => sum + Number(flag?.rank || 0), 0)
    : 0;
  return rating * 40 + Math.log10(reviewCount + 1) * 18 + flagScore - price / 120;
}

function scoreHotelCandidate(item, budget = null) {
  const reviewScore = Number(item?.reviewScore || 0);
  const reviewCount = Number(item?.reviewCount || 0);
  const stars = Number(item?.stars || 0);
  const price = Number(item?.priceTotal || 0);

  let pricePenalty = 0;
  if (budget === "budget") pricePenalty = price / 45;
  else if (budget === "luxury") pricePenalty = price / 200;
  else pricePenalty = price / 90;

  return reviewScore * 30 + Math.log10(reviewCount + 1) * 20 + stars * 8 - pricePenalty;
}

function addExplorationJitter(items, getKey, range = 0.35) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const key = getKey(item);
    const jitter = ((hashString(`${key}:${Date.now()}:${Math.random()}`) % 1000) / 1000 - 0.5) * range;
    return { ...item, _plannerJitter: jitter };
  });
}

async function fetchAttractionCandidates(locationId) {
  if (!locationId) return [];

  const pages = [1, 2, 3, 4];
  const responses = await Promise.all(
    pages.map((page) =>
      searchAttractions({
        id: locationId,
        page,
        currency_code: "USD",
        languagecode: "en-us",
        sortBy: "trending",
      }).catch(() => null)
    )
  );

  const merged = responses.flatMap((response) => normalizeAttractions(response)?.products || []);
  const deduped = dedupeBy(
    merged,
    (item) => String(item?.slug || item?.id || item?.name || "").trim().toLowerCase()
  );

  return addExplorationJitter(deduped, (item) => item?.slug || item?.id || item?.name)
    .sort(
      (a, b) =>
        scoreAttractionCandidate(b) +
        Number(b?._plannerJitter || 0) -
        (scoreAttractionCandidate(a) + Number(a?._plannerJitter || 0))
    )
    .map(({ _plannerJitter, ...item }) => item);
}

async function fetchHotelCandidates({
  destination,
  startDate,
  endDate,
  adultsCount,
  budget,
}) {
  if (!destination?.dest_id || !destination?.search_type) return [];

  const pages = [1, 2, 3];
  const responses = await Promise.all(
    pages.map((page_number) =>
      searchHotels({
        dest_id: destination.dest_id,
        search_type: destination.search_type,
        arrival_date: startDate,
        departure_date: endDate,
        adults: adultsCount,
        room_qty: 1,
        page_number,
        currency_code: "USD",
        languagecode: "en-us",
      }).catch(() => null)
    )
  );

  const merged = responses.flatMap((response) => normalizeHotelsResponse(response)?.hotels || []);
  const deduped = dedupeBy(
    merged,
    (item) => String(item?.hotelId || item?.name || "").trim().toLowerCase()
  );

  return addExplorationJitter(deduped, (item) => item?.hotelId || item?.name)
    .sort(
      (a, b) =>
        scoreHotelCandidate(b, budget) +
        Number(b?._plannerJitter || 0) -
        (scoreHotelCandidate(a, budget) + Number(a?._plannerJitter || 0))
    )
    .map(({ _plannerJitter, ...item }) => item);
}

async function fetchRestaurantCandidates(center) {
  if (!center?.lat || !center?.lng) return [];

  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.location",
    "places.formattedAddress",
    "places.shortFormattedAddress",
    "places.rating",
    "places.userRatingCount",
    "places.photos",
  ].join(",");
  const queries = [
    "restaurants",
    "best restaurants",
    "lunch restaurants",
    "dinner restaurants",
  ];

  const responses = await Promise.all(
    queries.map((textQuery) =>
      placesSearchTextNew(
        {
          textQuery,
          maxResultCount: 12,
          locationBias: {
            circle: {
              center: { latitude: center.lat, longitude: center.lng },
              radius: 9000,
            },
          },
        },
        fieldMask
      ).catch(() => null)
    )
  );

  const merged = responses.flatMap((response) => normalizePlacesNearby(response?.places));
  const deduped = dedupeBy(
    merged,
    (item) => String(item?.placeId || item?.providerId || item?.name || "").trim().toLowerCase()
  );

  return addExplorationJitter(deduped, (item) => item?.placeId || item?.providerId || item?.name)
    .sort(
      (a, b) =>
        Number(b?.rating || 0) * 20 +
        Math.log10(Number(b?.ratingCount || 0) + 1) * 15 +
        Number(b?._plannerJitter || 0) -
        (Number(a?.rating || 0) * 20 +
          Math.log10(Number(a?.ratingCount || 0) + 1) * 15 +
          Number(a?._plannerJitter || 0))
    )
    .map(({ _plannerJitter, ...item }) => item);
}

function coerceFlightIntent(outlineFlightIntent, routeForFlight) {
  const preference = ["cheapest", "best", "earliest", "latest"].includes(
    outlineFlightIntent?.preference
  )
    ? outlineFlightIntent.preference
    : "best";

  return {
    fromAirportCode: outlineFlightIntent?.fromAirportCode || null,
    toAirportCode: outlineFlightIntent?.toAirportCode || null,
    preference,
    maxStops: Number.isFinite(Number(outlineFlightIntent?.maxStops))
      ? Math.max(0, Math.min(3, Number(outlineFlightIntent.maxStops)))
      : 1,
    cabinClass: outlineFlightIntent?.cabinClass || null,
    fromText: routeForFlight?.fromText || null,
    toText: routeForFlight?.toText || null,
  };
}

function sortRestaurantsForMeal(restaurants, mealType, anchor = null) {
  const list = Array.isArray(restaurants) ? restaurants.slice() : [];
  return list.sort((a, b) => {
    const aRating = Number(a?.rating || 0);
    const bRating = Number(b?.rating || 0);
    const aCount = Number(a?.ratingCount || 0);
    const bCount = Number(b?.ratingCount || 0);

    if (anchor?.lat !== null && anchor?.lat !== undefined && anchor?.lng !== null && anchor?.lng !== undefined) {
      const aDist =
        Math.abs(Number(a?.lat ?? 999) - anchor.lat) + Math.abs(Number(a?.lng ?? 999) - anchor.lng);
      const bDist =
        Math.abs(Number(b?.lat ?? 999) - anchor.lat) + Math.abs(Number(b?.lng ?? 999) - anchor.lng);
      if (aDist !== bDist) return aDist - bDist;
    }

    if (mealType === "dinner" && aCount !== bCount) return bCount - aCount;
    if (aRating !== bRating) return bRating - aRating;
    return bCount - aCount;
  });
}

function pickRestaurantForMeal(restaurantPool, mealType, anchor = null) {
  if (!Array.isArray(restaurantPool) || !restaurantPool.length) return null;
  const ranked = sortRestaurantsForMeal(restaurantPool, mealType, anchor);
  const chosen = ranked[0] || null;
  if (!chosen) return null;
  const idx = restaurantPool.findIndex(
    (item) => (item?.placeId || item?.providerId || item?.name) === (chosen?.placeId || chosen?.providerId || chosen?.name)
  );
  if (idx >= 0) restaurantPool.splice(idx, 1);
  return chosen;
}

function buildRestaurantPlanItem(restaurant, resolvedDestination, mealType) {
  if (restaurant) {
    return {
      id: makePlanId(),
      type: "restaurant",
      kind: mealType === "lunch" ? "meal_lunch" : "meal_dinner",
      title: restaurant.name || (mealType === "lunch" ? "Lunch" : "Dinner"),
      subtitle: restaurant.address || resolvedDestination,
      source: "google",
      sourceId: restaurant.placeId || restaurant.providerId || null,
      lat: restaurant.lat ?? null,
      lng: restaurant.lng ?? null,
      imageUrl: restaurant.imageUrl || null,
      price: null,
      rating: restaurant.rating ?? null,
      timeWindow: mealType,
      meta: { meal: mealType, ratingCount: restaurant.ratingCount ?? null },
    };
  }

  return {
    id: makePlanId(),
    type: "restaurant",
    kind: mealType === "lunch" ? "meal_lunch" : "meal_dinner",
    title: mealType === "lunch" ? "Lunch" : "Dinner",
    subtitle: resolvedDestination,
    source: null,
    sourceId: null,
    lat: null,
    lng: null,
    imageUrl: null,
    price: null,
    rating: null,
    timeWindow: mealType,
    meta: { meal: mealType, placeholder: true },
  };
}

function mapTimeWindowToTimeOfDay(timeWindow) {
  if (timeWindow === "lunch") return "midday";
  if (timeWindow === "dinner") return "evening";
  if (timeWindow === "evening") return "evening";
  if (timeWindow === "morning") return "morning";
  return "afternoon";
}

function buildPlanFlightMeta(flightPreview, overrides = {}) {
  if (!flightPreview) return null;
  return {
    bookingToken: flightPreview.bookingToken || null,
    offerId: flightPreview.offerId || null,
    airlineCode: flightPreview.airlineCode || null,
    airlineName: flightPreview.airlineName || null,
    airlineLogoUrl: flightPreview.airlineLogoUrl || null,
    departTime: flightPreview.departAt || null,
    arriveTime: flightPreview.arriveAt || null,
    departAirportCode: flightPreview.fromLabel || null,
    arriveAirportCode: flightPreview.toLabel || null,
    stops: flightPreview.stops ?? null,
    durationSec: flightPreview.durationSec ?? null,
    fromId: flightPreview.fromId || null,
    toId: flightPreview.toId || null,
    fromLabel: flightPreview.fromLabel || null,
    toLabel: flightPreview.toLabel || null,
    ...overrides,
  };
}

function pickAttractionCoords(details) {
  const addresses = details?.addresses || {};
  const priority = [
    "meeting",
    "pickup",
    "guestPickup",
    "entrance",
    "attraction",
    "departure",
    "arrival",
  ];
  for (const key of priority) {
    const list = Array.isArray(addresses?.[key]) ? addresses[key] : [];
    const first = list[0];
    const lat = Number(first?.latitude);
    const lng = Number(first?.longitude);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180 &&
      !(lat === 0 && lng === 0)
    ) {
      return {
        lat,
        lng,
        source: key,
        address: first?.address || first?.city || null,
        raw: first,
        placeId: first?.googlePlaceId || null,
      };
    }
  }
  return null;
}

async function hydrateCoordsForItem(item, destinationLabel) {
  if (Number.isFinite(item?.lat) && Number.isFinite(item?.lng)) {
    return { lat: item.lat, lng: item.lng, cached: true };
  }
  if (!item?.source || !item?.sourceId) return null;

  const cached = await getCoordsFromCache({
    source: item.source,
    source_id: item.sourceId,
  }).catch(() => null);
  if (cached?.lat && cached?.lng) {
    return { lat: cached.lat, lng: cached.lng, cached: true };
  }

  if (item.source === "google") {
    try {
      const detailMask = ["id", "displayName", "location", "formattedAddress"].join(",");
      const details = await placesDetailsNew(item.sourceId, detailMask);
      const lat = details?.location?.latitude ?? null;
      const lng = details?.location?.longitude ?? null;
      if (lat !== null && lng !== null) {
        await upsertCoordsCache({
          source: "google",
          source_id: item.sourceId,
          name: details?.displayName?.text || item.title,
          city: null,
          country: null,
          lat,
          lng,
          place_id: details?.id || item.sourceId,
          query: "DETAILS:google",
          raw: details,
        });
        return { lat, lng, cached: false };
      }
    } catch {
      return null;
    }
  }

  if (item.source === "booking_attractions") {
    try {
      const details = await bookingGet("/api/v1/attraction/getAttractionDetails", {
        slug: item.sourceId,
        currency_code: "USD",
        languagecode: "en-us",
      });
      const coords = pickAttractionCoords(details?.data || details);
      if (coords?.lat && coords?.lng) {
        await upsertCoordsCache({
          source: "booking_attractions",
          source_id: item.sourceId,
          name: item.title,
          city: destinationLabel || null,
          country: null,
          lat: coords.lat,
          lng: coords.lng,
          place_id: coords.placeId || null,
          query: `DETAILS:${coords.source}`,
          raw: coords.raw || null,
        });
        return { lat: coords.lat, lng: coords.lng, cached: false };
      }
    } catch {
      // fall through to geocode
    }
  }

  try {
    const q = [item.title, destinationLabel].filter(Boolean).join(", ");
    const g = await geocodeMapbox({ query: q, language: "en" });
    if (g?.lat && g?.lng) {
      await upsertCoordsCache({
        source: item.source || "unknown",
        source_id: item.sourceId || item.id,
        name: item.title,
        city: destinationLabel || null,
        country: null,
        lat: g.lat,
        lng: g.lng,
        place_id: g.raw?.id || null,
        query: q,
        raw: g.raw || null,
      });
      return { lat: g.lat, lng: g.lng, cached: false };
    }
  } catch {
    return null;
  }

  return null;
}

async function createQuickTrip({ userId, primaryLocationName, startDate, endDate, title }) {
  const { data, error } = await supabaseAdmin
    .from("trips")
    .insert({
      user_id: userId,
      primary_location_name: primaryLocationName,
      start_date: startDate,
      end_date: endDate,
      travelers: 1,
      budget_tier: "midrange",
      road_trip: false,
      title,
      planning_state: "draft",
    })
    .select("id,start_date,end_date")
    .single();

  if (error) throw error;
  return data;
}

async function ensurePlannerTrip({
  authUser,
  tripId,
  createTripPrefs,
  destinationLabel,
  startDate,
  endDate,
}) {
  if (tripId) {
    const { data } = await supabaseAdmin
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .eq("user_id", authUser.id)
      .single();
    if (data?.id) return data.id;
  }

  if (!createTripPrefs?.destination && !destinationLabel) return null;

  const tripTitle = [
    createTripPrefs?.destination || destinationLabel || "Trip",
    startDate && endDate ? `${startDate}–${endDate}` : null,
  ]
    .filter(Boolean)
    .join(" • ");

  const { data, error } = await supabaseAdmin
    .from("trips")
    .insert({
      user_id: authUser.id,
      primary_location_name: createTripPrefs?.destination || destinationLabel,
      primary_location_place_id: createTripPrefs?.destinationPlaceId || null,
      start_date: startDate,
      end_date: endDate,
      travelers: createTripPrefs?.travelers || deriveAdultCount(createTripPrefs, 1),
      budget_tier: createTripPrefs?.budget || "midrange",
      road_trip: Boolean(createTripPrefs?.roadTrip),
      title: tripTitle || `${createTripPrefs?.destination || destinationLabel} Trip`,
      planning_state: "draft",
    })
    .select("id")
    .single();

  if (error) throw error;
  return data?.id || null;
}

async function ensurePlannerTripForMessage({
  authUser,
  tripId,
  createTripPrefs,
  destinationLabel,
  startDate,
  endDate,
}) {
  if (tripId) return tripId;
  const resolvedDestination = createTripPrefs?.destination || destinationLabel || null;
  if (!resolvedDestination || !startDate || !endDate) return null;
  return ensurePlannerTrip({
    authUser,
    tripId,
    createTripPrefs: createTripPrefs || { destination: resolvedDestination },
    destinationLabel: resolvedDestination,
    startDate,
    endDate,
  });
}

function getAssistantThreadId(input = {}) {
  const raw =
    input.threadId ||
    input.thread_id ||
    input.workspaceId ||
    input.tripId ||
    input.trip_id ||
    null;
  return raw ? String(raw) : "default";
}

function getTripDraftCacheKey(authUser, threadId) {
  return `assistant:trip_draft:${authUser?.id || "anon"}:${threadId || "default"}`;
}

function getTripDraft(authUser, threadId) {
  return cacheGet(getTripDraftCacheKey(authUser, threadId)) || null;
}

function setTripDraft(authUser, threadId, draft) {
  cacheSet(getTripDraftCacheKey(authUser, threadId), draft, 1000 * 60 * 60 * 24);
  return draft;
}

async function loadTripDraft(authUser, threadId) {
  const cached = getTripDraft(authUser, threadId);
  if (cached) return cached;

  try {
    const { data, error } = await supabaseAdmin
      .from("assistant_trip_drafts")
      .select("draft_json")
      .eq("user_id", authUser.id)
      .eq("thread_id", threadId)
      .maybeSingle();

    if (error) throw error;
    const draft = data?.draft_json || null;
    if (draft) setTripDraft(authUser, threadId, draft);
    return draft;
  } catch {
    return null;
  }
}

async function loadLatestTripDraftByTripId(authUser, tripId) {
  const normalizedTripId = String(tripId || "").trim();
  if (!normalizedTripId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("assistant_trip_drafts")
      .select("thread_id,draft_json,updated_at")
      .eq("user_id", authUser.id)
      .eq("trip_id", normalizedTripId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const draft = data?.draft_json || null;
    if (draft && data?.thread_id) setTripDraft(authUser, data.thread_id, draft);
    return draft;
  } catch {
    return null;
  }
}

async function persistTripDraft(authUser, threadId, draft) {
  setTripDraft(authUser, threadId, draft);
  try {
    await supabaseAdmin.from("assistant_trip_drafts").upsert(
      {
        user_id: authUser.id,
        thread_id: threadId,
        trip_id: draft?.tripId || null,
        draft_json: draft,
      },
      { onConflict: "user_id,thread_id" }
    );
  } catch {
    // Cache remains the fallback if storage is temporarily unavailable.
  }
  return draft;
}

function nextDefaultDateRange() {
  const now = new Date();
  const weekday = now.getUTCDay();
  const daysUntilFriday = ((5 - weekday + 7) % 7) || 7;
  const start = addDays(now, daysUntilFriday);
  const end = addDays(start, 3);
  return {
    startDate: toDateString(start),
    endDate: toDateString(end),
  };
}

function normalizeBudgetTier(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["budget", "cheap", "low"].includes(text)) return "budget";
  if (["luxury", "premium", "high"].includes(text)) return "luxury";
  return "mid";
}

function normalizeVibes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
  return String(value)
    .split(/[,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function buildEntityRefId(prefix, item) {
  return `${prefix}_${String(item?.sourceId || item?.placeId || item?.providerId || item?.id || item?.name || makePlanId())
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 48)}`;
}

function averageCoords(items) {
  const valid = (Array.isArray(items) ? items : []).filter(
    (item) => Number.isFinite(Number(item?.lat)) && Number.isFinite(Number(item?.lng))
  );
  if (!valid.length) return null;
  const lat = valid.reduce((sum, item) => sum + Number(item.lat), 0) / valid.length;
  const lng = valid.reduce((sum, item) => sum + Number(item.lng), 0) / valid.length;
  return { lat, lng };
}

function clusterKeyForCoords(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "fallback";
  return `${Math.round(lat * 20) / 20}:${Math.round(lng * 20) / 20}`;
}

function clusterAttractionsByNeighborhood(attractions, anchor = null) {
  const buckets = new Map();
  for (const attraction of Array.isArray(attractions) ? attractions : []) {
    const lat = Number(attraction?.location?.lat);
    const lng = Number(attraction?.location?.lng);
    const key = clusterKeyForCoords(lat, lng);
    const bucket = buckets.get(key) || {
      key,
      center: { lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null },
      items: [],
    };
    bucket.items.push(attraction);
    buckets.set(key, bucket);
  }

  const clusters = [...buckets.values()].sort((a, b) => b.items.length - a.items.length);
  if (!anchor?.lat || !anchor?.lng) return clusters;

  return clusters.sort((a, b) => {
    const aDist =
      Math.abs(Number(a?.center?.lat ?? 999) - Number(anchor.lat)) +
      Math.abs(Number(a?.center?.lng ?? 999) - Number(anchor.lng));
    const bDist =
      Math.abs(Number(b?.center?.lat ?? 999) - Number(anchor.lat)) +
      Math.abs(Number(b?.center?.lng ?? 999) - Number(anchor.lng));
    if (aDist !== bDist) return aDist - bDist;
    return (b?.items?.length || 0) - (a?.items?.length || 0);
  });
}

function getClusterPlanForDay(clusters, dayIndex) {
  const list = Array.isArray(clusters) ? clusters : [];
  if (!list.length) return [];
  if (list.length === 1) return [list[0].key];
  const first = list[dayIndex % list.length]?.key;
  const second = list[(dayIndex + 1) % list.length]?.key;
  return dedupeBy([first, second].filter(Boolean), (item) => item);
}

function filterNovelItems(list, usedIds, getId, minKeep = 12) {
  const blocked = new Set(Array.isArray(usedIds) ? usedIds : []);
  const fresh = (Array.isArray(list) ? list : []).filter((item) => !blocked.has(getId(item)));
  if (fresh.length >= minKeep) return fresh;
  return Array.isArray(list) ? list : [];
}

function scoreFlightCandidateForDraft(offer) {
  const price = Number(offer?.price?.total ?? 999999);
  const durationSec = Number(offer?.durationSec ?? 999999);
  const stops = Number(offer?.stops ?? 3);
  const arriveMinutes = parseTimeToMinutes(offer?.arrive?.time);
  const badRedEyePenalty =
    Number.isFinite(arriveMinutes) && arriveMinutes >= 0 && arriveMinutes < 5 * 60 ? 120 : 0;
  return price * 0.35 + durationSec / 60 * 0.30 + stops * 120 * 0.20 + badRedEyePenalty * 0.15;
}

function pickFlightBundle(shortlist) {
  const ranked = (Array.isArray(shortlist) ? shortlist : []).slice().sort(
    (a, b) => scoreFlightCandidateForDraft(a) - scoreFlightCandidateForDraft(b)
  );
  return {
    selected: ranked[0] || null,
    alternates: ranked.slice(1, 5),
  };
}

function buildFlightCardSelection(selectedOffer, fromLoc, toLoc) {
  if (!selectedOffer) return null;
  return {
    provider: "booking_flights",
    offer_id: selectedOffer.id || selectedOffer.token || null,
    booking_token: selectedOffer.token || null,
    origin: selectedOffer.depart?.airportCode || fromLoc?.code || fromLoc?.label || null,
    destination: selectedOffer.arrive?.airportCode || toLoc?.code || toLoc?.label || null,
    depart_at: selectedOffer.depart?.time || null,
    arrive_at: selectedOffer.arrive?.time || null,
    stops: selectedOffer.stops ?? null,
    duration_minutes: selectedOffer.durationSec ? Math.round(selectedOffer.durationSec / 60) : null,
    price: selectedOffer.price?.total !== undefined && selectedOffer.price?.total !== null
      ? { amount: selectedOffer.price.total, currency: selectedOffer.price.currency || "USD" }
      : null,
    airline: selectedOffer.airlineName || selectedOffer.airlineCode || null,
  };
}

function buildTripDraftActions({ tripId, date, threadId }) {
  const base = { trip_id: tripId || null, thread_id: threadId || null };
  return [
    {
      id: "swap_flight",
      label: "Swap flight",
      style: "primary",
      endpoint: "/api/assistant/actions/swap-flight",
      method: "POST",
      payload: base,
    },
    {
      id: "swap_hotel",
      label: "Swap hotel",
      style: "secondary",
      endpoint: "/api/assistant/actions/swap-hotel",
      method: "POST",
      payload: base,
    },
    {
      id: "cheaper_options",
      label: "Cheaper options",
      style: "secondary",
      endpoint: "/api/assistant/actions/tune",
      method: "POST",
      payload: { ...base, budget_tier: "budget" },
    },
    {
      id: "more_premium",
      label: "More premium",
      style: "secondary",
      endpoint: "/api/assistant/actions/tune",
      method: "POST",
      payload: { ...base, budget_tier: "luxury" },
    },
    {
      id: "more_attractions",
      label: "More attractions",
      style: "ghost",
      endpoint: "/api/assistant/actions/more-attractions",
      method: "POST",
      payload: { ...base, count: 10 },
    },
    {
      id: "regen_day",
      label: "Regenerate Day",
      style: "secondary",
      endpoint: "/api/assistant/actions/regenerate-day",
      method: "POST",
      payload: { ...base, date: date || null },
    },
    {
      id: "lock_plan",
      label: "Lock this plan",
      style: "primary",
      endpoint: "/api/assistant/actions/lock-plan",
      method: "POST",
      payload: base,
    },
    {
      id: "add_day_trip",
      label: "Add a day trip",
      style: "ghost",
      endpoint: "/api/assistant/actions/tune",
      method: "POST",
      payload: { ...base, vibe_add: ["day_trip"] },
    },
    {
      id: "view_full_plan",
      label: "View full plan",
      style: "primary",
      ui: { open: "bottom_sheet", target: "trip_plan" },
    },
  ];
}

function buildTripDraftResponse(draft, extraCards = []) {
  const firstUnlockedDay = Array.isArray(draft?.plan?.days)
    ? draft.plan.days.find((day) => !draft?.locks?.locked_days?.includes(day?.date))
    : null;

  return {
    type: "assistant_response",
    thread_id: draft?.threadId || null,
    trip_id: draft?.tripId || null,
    message:
      draft?.message ||
      `I built a realistic ${draft?.plan?.days?.length || 0}-day ${draft?.destinationLabel || "trip"} plan around your flights.`,
    cards: [
      {
        type: "trip_overview",
        trip_name: draft?.plan?.title || `Trip to ${draft?.destinationLabel || "your destination"}`,
        destination: { city: draft?.destinationLabel || null, country: null },
        dates: { start: draft?.startDate || null, end: draft?.endDate || null },
        travelers: {
          adults: draft?.travelers?.adults || 1,
          children: draft?.travelers?.children || 0,
        },
        budget_tier: draft?.budgetTier || "mid",
        vibes: draft?.vibes || [],
        status: { needs_confirmation: Boolean(draft?.needsConfirmation) },
      },
      {
        type: "flight_card",
        selected: draft?.selectedFlight || null,
        alternates: draft?.flightAlternates || [],
        lock_state: { locked: Boolean(draft?.locks?.flight) },
      },
      {
        type: "hotel_card",
        selected: draft?.selectedHotel || null,
        alternates: draft?.hotelAlternates || [],
        lock_state: { locked: Boolean(draft?.locks?.hotel) },
      },
      {
        type: "itinerary_card",
        days: (draft?.plan?.days || []).map((day) => ({
          date: day?.date || null,
          title: day?.theme || day?.label || null,
          time_blocks: (day?.items || []).map((item) => ({
            start: String(item?.startTime || "").split("T")[1]?.slice(0, 5) || null,
            end: String(item?.endTime || "").split("T")[1]?.slice(0, 5) || null,
            kind: item?.kind || item?.type || "activity",
            title: item?.title || null,
            image_url: item?.imageUrl || null,
            ref_id:
              item?.type === "attraction"
                ? buildEntityRefId("a", item)
                : item?.type === "restaurant"
                  ? buildEntityRefId("r", item)
                  : item?.type === "hotel"
                    ? buildEntityRefId("h", item)
                    : null,
          })),
        })),
        locks: { locked_days: draft?.locks?.locked_days || [] },
      },
      ...extraCards,
    ],
    entities: {
      attractions: draft?.entities?.attractions || [],
      restaurants: draft?.entities?.restaurants || [],
      hotels: draft?.entities?.hotels || [],
    },
    actions: buildTripDraftActions({
      tripId: draft?.tripId,
      threadId: draft?.threadId,
      date: firstUnlockedDay?.date || draft?.startDate || null,
    }),
    ui: {
      suggested_quick_replies: [
        "Cheaper options",
        "More nightlife",
        "More museums",
        "Make it walkable",
        "Add a day trip",
      ],
    },
    debug: draft?.debug || null,
  };
}

function getDepartureTimeWindowOk(departureAt, timeWindow) {
  if (timeWindow === "any") return true;
  if (!departureAt) return false;
  const text = String(departureAt || "").trim();
  if (!text) return false;

  let hour = NaN;
  let minute = NaN;

  // ISO-like strings: 2026-03-01T08:25:00 or 2026-03-01 08:25
  const isoMatch = text.match(/(?:T|\s)(\d{1,2}):(\d{2})/);
  if (isoMatch) {
    hour = Number(isoMatch[1]);
    minute = Number(isoMatch[2]);
  } else {
    // Time-only formats: 08:25 or 8:25 AM
    const timeOnlyMatch = text.match(/(\d{1,2}):(\d{2})(?:\s*([ap]m))?/i);
    if (timeOnlyMatch) {
      hour = Number(timeOnlyMatch[1]);
      minute = Number(timeOnlyMatch[2]);
      const meridiem = String(timeOnlyMatch[3] || "").toLowerCase();
      if (meridiem === "pm" && hour < 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;
    }
  }

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;

  const minutes = hour * 60 + minute;
  if (timeWindow === "early_morning") {
    return minutes >= 5 * 60 && minutes <= 9 * 60 + 59;
  }
  if (timeWindow === "morning") {
    return minutes >= 5 * 60 && minutes <= 11 * 60 + 59;
  }
  return true;
}

function parseDurationSec(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 2_000_000) return Math.round(value / 1000);
    return value;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const iso = text.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (iso) {
    const hours = Number(iso[1] || 0);
    const mins = Number(iso[2] || 0);
    const secs = Number(iso[3] || 0);
    return hours * 3600 + mins * 60 + secs;
  }
  const plain = Number(text);
  if (!Number.isFinite(plain)) return null;
  if (plain > 2_000_000) return Math.round(plain / 1000);
  return plain;
}

function diffSecondsFromTimes(departAt, arriveAt) {
  const departMs = new Date(departAt || "").getTime();
  const arriveMs = new Date(arriveAt || "").getTime();
  if (!Number.isFinite(departMs) || !Number.isFinite(arriveMs)) return null;
  let diff = Math.round((arriveMs - departMs) / 1000);
  if (diff < 0) diff += 24 * 3600;
  return diff > 0 ? diff : null;
}

function moneyToNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (!value || typeof value !== "object") return null;
  if (typeof value.amount === "number" && Number.isFinite(value.amount)) return value.amount;
  if (typeof value.amount === "string") {
    const parsed = Number(value.amount);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value.value === "number" && Number.isFinite(value.value)) return value.value;
  if (typeof value.value === "string") {
    const parsed = Number(value.value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value.units === "number") {
    return Number(value.units) + Number(value.nanos || 0) / 1e9;
  }
  return null;
}

async function resolveIataCode(keyword) {
  const primary = sanitizeLocationText(keyword);
  if (!primary) return null;

  const lookup = async (term) => {
    const data = await searchFlightLocations({ query: term });
    const list = Array.isArray(data) ? data : [];
    const first = list.find((item) => item?.id || item?.destinationId) || list[0];
    if (!first) return null;
    return {
      id: first?.id || first?.destinationId || null,
      code: first?.code || first?.iataCode || first?.airportCode || null,
      label: first?.name || first?.city_name || first?.label || term,
    };
  };

  let loc = await lookup(primary);
  if (loc?.id) return loc;

  const stripped = primary.replace(/\s+(city|airport)$/i, "").trim();
  if (stripped && stripped !== primary) {
    loc = await lookup(stripped);
  }
  return loc?.id ? loc : null;
}

async function resolveDepartureAirportFromCoords(clientLat, clientLng) {
  if (!Number.isFinite(clientLat) || !Number.isFinite(clientLng)) return null;

  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.shortFormattedAddress",
  ].join(",");

  try {
    const nearby = await placesNearbySearchNew(
      {
        locationRestriction: {
          circle: {
            center: { latitude: clientLat, longitude: clientLng },
            radius: 120000,
          },
        },
        includedTypes: ["airport"],
        maxResultCount: 5,
        rankPreference: "DISTANCE",
      },
      fieldMask
    );

    const places = Array.isArray(nearby?.places) ? nearby.places : [];
    for (const place of places) {
      const terms = [
        place?.displayName?.text,
        place?.shortFormattedAddress,
        place?.formattedAddress,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);

      for (const term of terms) {
        const resolved = await resolveIataCode(term);
        if (resolved?.id) return resolved;
      }
    }
  } catch {}

  try {
    const text = await placesSearchTextNew(
      {
        textQuery: "airport",
        maxResultCount: 5,
        rankPreference: "DISTANCE",
        locationBias: {
          circle: {
            center: { latitude: clientLat, longitude: clientLng },
            radius: 120000,
          },
        },
      },
      fieldMask
    );

    const places = Array.isArray(text?.places) ? text.places : [];
    for (const place of places) {
      const terms = [
        place?.displayName?.text,
        place?.shortFormattedAddress,
        place?.formattedAddress,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);

      for (const term of terms) {
        const resolved = await resolveIataCode(term);
        if (resolved?.id) return resolved;
      }
    }
  } catch {}

  return null;
}

async function resolveHotelDestination(keyword) {
  const list = await searchHotelDestination({ query: keyword, languagecode: "en-us" });
  const first = Array.isArray(list) ? list[0] : null;
  if (!first) return null;
  return {
    dest_id: first?.dest_id || first?.id || null,
    search_type: first?.search_type || first?.dest_type || null,
    label: first?.label || first?.name || keyword,
  };
}

async function resolveAttractionLocation(keyword) {
  const raw = await searchAttractionLocations({ query: keyword, languagecode: "en-us" });
  let normalized = normalizeAttractionLocations(raw, keyword);

  // Extra fallback for unusual upstream payloads.
  if (!normalized.length && raw && typeof raw === "object") {
    const candidates = [
      raw?.locations,
      raw?.results,
      raw?.result,
      raw?.items,
      raw?.suggestions,
      raw?.destinations,
      raw?.entities,
      raw?.places,
    ].find((entry) => Array.isArray(entry));
    normalized = normalizeAttractionLocations(candidates || [], keyword);
  }

  const first = Array.isArray(normalized) ? normalized[0] : null;
  if (!first?.id) return null;

  return {
    id: sanitizeAttractionId(first.id),
    label: first.label || first.name || keyword,
    city: first.city || null,
    lat: first.lat ?? null,
    lng: first.lng ?? null,
    type: first.type || null,
  };
}

async function buildTripPlanFromPrompt({
  promptText,
  tripId,
  authUser,
  overrides = {},
}) {
  const startedAt = Date.now();
  const existingDraft = overrides?.existingDraft || null;
  const parsedRouteForPlan = parseOriginDestinationForPlan(promptText) || parseRoute(promptText);
  const destinationLabel =
    overrides.destinationLabel ||
    parsedRouteForPlan?.toText ||
    detectLocationInMessage(promptText);
  const parsedDates = parseDateRangeFromText(promptText);

  const outlineStart = Date.now();
  const outline = await generatePlanOutline({
    promptText,
    destinationLabel: destinationLabel || null,
    startDate: overrides.startDate || null,
    endDate: overrides.endDate || null,
    budget: overrides?.userPrefs?.budget || null,
    vibe: overrides?.userPrefs?.vibe || null,
    travelers: overrides?.userPrefs?.travelers || null,
  });
  const outlineMs = Date.now() - outlineStart;

  const resolvedDestination =
    outline?.destinationLabel || destinationLabel || overrides.destinationLabel;
  if (!resolvedDestination) {
    return {
      error: "missing_destination",
      assistantMessage: "Where would you like to go?",
    };
  }

  let startDate = normalizeDateInput(
    overrides.startDate || parsedDates?.startDate || outline?.startDate
  );
  let endDate = normalizeDateInput(
    overrides.endDate || parsedDates?.endDate || outline?.endDate
  );
  let needsConfirmation = false;

  if (!startDate || !endDate) {
    const fallbackRange = nextDefaultDateRange();
    startDate = startDate || fallbackRange.startDate;
    endDate = endDate || fallbackRange.endDate;
    needsConfirmation = true;
  }

  if (new Date(endDate) < new Date(startDate)) {
    const swap = startDate;
    startDate = endDate;
    endDate = swap;
  }

  const dayCount =
    Math.max(1, Math.min(10, Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1)) ||
    2;
  const adultsCount = deriveAdultCount(overrides?.userPrefs, 2);

  let resolvedTripId = tripId || null;
  if (tripId) {
    const { data } = await supabaseAdmin
      .from("trips")
      .select("id")
      .eq("id", tripId)
      .eq("user_id", authUser.id)
      .single();
    if (!data?.id) resolvedTripId = null;
  }

  if (!resolvedTripId) {
    try {
      resolvedTripId = await ensurePlannerTripForMessage({
        authUser,
        tripId: null,
        createTripPrefs: overrides?.userPrefs || null,
        destinationLabel: resolvedDestination,
        startDate,
        endDate,
      });
    } catch (err) {
      return {
        error: err?.message || "Failed to create trip",
      };
    }
  }

  if (!resolvedTripId) {
    return {
      error: "trip_required",
      assistantMessage: "Use Create a Trip to save a full itinerary. I can still help with flights, stays, and things to do here.",
    };
  }

  const center = await resolveSpotCenter({
    locationText: resolvedDestination,
    clientLat: null,
    clientLng: null,
  });
  const outlineDays = Array.isArray(outline?.days) ? outline.days.slice(0, dayCount) : [];
  const normalizedOutlineDays = outlineDays.map((day) => ({
    label: day?.label || null,
    theme: day?.theme || null,
    dayStartTime: day?.dayStartTime || SCHEDULE_DEFAULTS.dayStartTime,
    dayEndTime: day?.dayEndTime || SCHEDULE_DEFAULTS.dayEndTime,
    maxActivities: Number.isFinite(Number(day?.maxActivities))
      ? Math.max(1, Math.min(6, Number(day.maxActivities)))
      : 3,
    items: Array.isArray(day?.items) ? day.items : [],
  }));
  if (!normalizedOutlineDays.length) {
    normalizedOutlineDays.push({
      label: null,
      theme: null,
      dayStartTime: SCHEDULE_DEFAULTS.dayStartTime,
      dayEndTime: SCHEDULE_DEFAULTS.dayEndTime,
      maxActivities: 3,
      items: [],
    });
  }

  const routeForFlight = parsedRouteForPlan || parseRoute(promptText);
  const flightIntent = coerceFlightIntent(outline?.flightIntent, routeForFlight);
  const clientLat = Number(overrides?.clientLat);
  const clientLng = Number(overrides?.clientLng);
  const hasClientCoords =
    Number.isFinite(clientLat) &&
    Number.isFinite(clientLng) &&
    !(clientLat === 0 && clientLng === 0);

  const needAttractions = !overrides?.userPrefs?.roadTrip;
  const needHotel = true;
  const usedIds = existingDraft?.usedIds || {};

  let attractionLocation = null;
  let attractionsList = [];
  let hotelResult = null;
  let hotelCandidates = [];
  const attractionPromise = needAttractions
    ? (async () => {
        try {
          attractionLocation = await resolveAttractionLocation(resolvedDestination);
          if (attractionLocation?.id) {
            attractionsList = await fetchAttractionCandidates(attractionLocation.id);
          }
        } catch {
          attractionsList = [];
        }
      })()
    : Promise.resolve();

  const hotelPromise = needHotel
    ? (async () => {
        try {
          const destination = await resolveHotelDestination(resolvedDestination);
          const hotels = await fetchHotelCandidates({
            destination,
            startDate,
            endDate,
            adultsCount,
            budget: overrides?.userPrefs?.budget || null,
          });
          hotelCandidates = filterNovelItems(
            hotels,
            usedIds.hotels,
            (item) => String(item?.hotelId || item?.name || ""),
            8
          );
          hotelResult = hotelCandidates[0] || hotels[0] || null;
        } catch {
          hotelResult = null;
          hotelCandidates = [];
        }
      })()
    : Promise.resolve();

  await Promise.all([attractionPromise, hotelPromise]);

  let restaurantsList = [];
  try {
    restaurantsList = await fetchRestaurantCandidates(center);
  } catch {
    restaurantsList = [];
  }

  attractionsList = filterNovelItems(
    attractionsList,
    usedIds.attractions,
    (item) => String(item?.slug || item?.id || item?.name || ""),
    18
  );
  restaurantsList = filterNovelItems(
    restaurantsList,
    usedIds.restaurants,
    (item) => String(item?.placeId || item?.providerId || item?.name || ""),
    12
  );

  let flightPreview = null;
  let flightBundle = { selected: null, alternates: [] };
  let resolvedFlightFrom = null;
  let resolvedFlightTo = null;
  const inferredOrigin =
    !flightIntent?.fromText && !flightIntent?.fromAirportCode && hasClientCoords
      ? await resolveDepartureAirportFromCoords(clientLat, clientLng)
      : null;
  const originLookup = flightIntent?.fromAirportCode || flightIntent?.fromText || inferredOrigin?.id || inferredOrigin?.code || inferredOrigin?.label || null;
  const destinationLookup =
    flightIntent?.toAirportCode ||
    flightIntent?.toText ||
    resolvedDestination ||
    null;

  if (originLookup && destinationLookup) {
    try {
      const [fromLoc, toLoc] = await Promise.all([
        resolveIataCode(originLookup),
        resolveIataCode(destinationLookup),
      ]);
      if (fromLoc?.id && toLoc?.id) {
        resolvedFlightFrom = fromLoc;
        resolvedFlightTo = toLoc;
        const cacheKey = `planFlights:${fromLoc.id}:${toLoc.id}:${startDate}:${endDate}`;
        let response = cacheGet(cacheKey);
        if (!response) {
          response = await searchFlights({
            fromId: fromLoc.id,
            toId: toLoc.id,
            departDate: startDate,
            returnDate: endDate,
            adults: adultsCount,
            cabinClass: flightIntent?.cabinClass || "ECONOMY",
            currencyCode: "USD",
          });
          cacheSet(cacheKey, response, 1000 * 60 * 10);
        }

        const offersRaw = Array.isArray(response?.flightOffers)
          ? response.flightOffers
          : Array.isArray(response?.offers)
            ? response.offers
            : Array.isArray(response?.results)
              ? response.results
              : [];
        const shortlist = shortlistFlightOffers(offersRaw, flightIntent, 8);
        flightBundle = pickFlightBundle(shortlist);
        const selectedOffer = flightBundle.selected || null;
        if (selectedOffer) {
          const offer = selectedOffer.raw || {};
          const segments =
            offer?.segments || offer?.legs?.[0]?.segments || offer?.itinerary?.segments || [];
          const firstSegment = segments[0] || {};
          const lastSegment = segments[segments.length - 1] || {};
          const returnSegments =
            offer?.itineraries?.[1]?.segments ||
            offer?.legs?.[1]?.segments ||
            [];
          const returnFirst = returnSegments[0] || {};
          const returnLast = returnSegments[returnSegments.length - 1] || {};
          flightPreview = {
            title: `Flight: ${fromLoc.code || fromLoc.label} → ${toLoc.code || toLoc.label}`,
            subtitle: buildFlightSubtitle(selectedOffer),
            price:
              selectedOffer?.price?.total !== null && selectedOffer?.price?.total !== undefined
                ? {
                    amount: selectedOffer.price.total,
                    currency: selectedOffer.price.currency || "USD",
                  }
                : null,
            raw: offer,
            fromId: fromLoc.id,
            toId: toLoc.id,
            fromLabel: fromLoc.code || fromLoc.label,
            toLabel: toLoc.code || toLoc.label,
            offerId: selectedOffer.id || null,
            bookingToken: selectedOffer.token || null,
            airlineCode: selectedOffer.airlineCode || null,
            airlineName: selectedOffer.airlineName || null,
            airlineLogoUrl: selectedOffer.airlineLogoUrl || null,
            durationSec: selectedOffer.durationSec ?? null,
            stops: selectedOffer.stops ?? null,
            departAt: selectedOffer.depart?.time || firstSegment?.departure?.at || firstSegment?.departureTime || null,
            arriveAt: selectedOffer.arrive?.time || lastSegment?.arrival?.at || lastSegment?.arrivalTime || null,
            returnDepartAt: returnFirst?.departure?.at || returnFirst?.departureTime || null,
            returnArriveAt: returnLast?.arrival?.at || returnLast?.arrivalTime || null,
            shortlist,
          };
        }
      }
    } catch {
      flightPreview = null;
    }
  }

  const planDays = [];
  const attractionPool = [...attractionsList];
  const restaurantPool = [...restaurantsList];
  const attractionClusters = clusterAttractionsByNeighborhood(
    attractionsList,
    hotelResult?.lat && hotelResult?.lng
      ? { lat: hotelResult.lat, lng: hotelResult.lng }
      : center
  );
  const placeLookupCache = new Map();
  const hasReturnFlight =
    Boolean(flightPreview?.returnDepartAt) || Boolean(flightPreview?.returnArriveAt);
  const usedPlanKeys = new Set();
  const arrivalMinutes = parseTimeToMinutes(flightPreview?.arriveAt);
  const departureMinutes = parseTimeToMinutes(
    flightPreview?.returnDepartAt || flightPreview?.departAt
  );

  const findPlaceOnce = async (textQuery) => {
    const key = normalizeTitleKey(textQuery);
    if (!key) return null;
    if (placeLookupCache.has(key)) return placeLookupCache.get(key);

    try {
      const fieldMask = [
        "places.id",
        "places.displayName",
        "places.location",
        "places.formattedAddress",
        "places.shortFormattedAddress",
        "places.rating",
        "places.userRatingCount",
        "places.photos",
      ].join(",");
      const body = { textQuery, maxResultCount: 1 };
      if (center?.lat && center?.lng) {
        body.locationBias = {
          circle: {
            center: { latitude: center.lat, longitude: center.lng },
            radius: 6000,
          },
        };
      }
      const data = await placesSearchTextNew(body, fieldMask);
      const place = Array.isArray(data?.places) ? data.places[0] : null;
      placeLookupCache.set(key, place || null);
      return place || null;
    } catch {
      placeLookupCache.set(key, null);
      return null;
    }
  };

  const pickClusteredAttraction = (dayIndex, query = null) => {
    const clusterKeys = getClusterPlanForDay(attractionClusters, dayIndex);
    if (query) {
      const withinClusters = attractionPool.filter((item) =>
        clusterKeys.includes(clusterKeyForCoords(Number(item?.location?.lat), Number(item?.location?.lng)))
      );
      const matched = pickTopMatchByName(withinClusters, query) || pickTopMatchByName(attractionPool, query);
      if (matched) {
        const idx = attractionPool.findIndex(
          (candidate) => String(candidate?.slug || candidate?.id || "") === String(matched?.slug || matched?.id || "")
        );
        if (idx >= 0) attractionPool.splice(idx, 1);
        return matched;
      }
    }

    const idx = attractionPool.findIndex((item) =>
      clusterKeys.includes(clusterKeyForCoords(Number(item?.location?.lat), Number(item?.location?.lng)))
    );
    if (idx >= 0) {
      return attractionPool.splice(idx, 1)[0] || null;
    }
    return attractionPool.shift() || null;
  };

  for (let i = 0; i < dayCount; i += 1) {
    const date = toDateString(addDays(new Date(startDate), i));
    const outlineDay = normalizedOutlineDays[i] || normalizedOutlineDays[normalizedOutlineDays.length - 1] || null;
    const outlineItems = Array.isArray(outlineDay?.items) ? outlineDay.items : [];
    const dayItems = [];
    const daySeen = new Set();
    const firstDayStartTime =
      i === 0 && Number.isFinite(arrivalMinutes)
        ? minutesToClock(
            Math.max(
              parseTimeToMinutes(SCHEDULE_DEFAULTS.dayStartTime) || 540,
              arrivalMinutes + 90
            )
          )
        : outlineDay?.dayStartTime || SCHEDULE_DEFAULTS.dayStartTime;
    const lastDayEndTime =
      i === dayCount - 1 && Number.isFinite(departureMinutes)
        ? minutesToClock(
            Math.max(
              parseTimeToMinutes(SCHEDULE_DEFAULTS.dayStartTime) || 540,
              departureMinutes - 120
            )
          )
        : outlineDay?.dayEndTime || SCHEDULE_DEFAULTS.dayEndTime;

    const pushDayItem = (item) => {
      if (!item) return;
      const key = `${item.kind || item.type}:${item.source || "na"}:${item.sourceId || normalizeTitleKey(item.title)}`;
      if (daySeen.has(key)) return;
      if (
        item.type === "attraction" ||
        item.type === "place" ||
        item.type === "restaurant" ||
        item.kind === "activity"
      ) {
        if (usedPlanKeys.has(key)) return;
        usedPlanKeys.add(key);
      }
      daySeen.add(key);
      dayItems.push(item);
    };

    if (i === 0 && flightPreview) {
      pushDayItem({
        id: makePlanId(),
        type: "flight",
        kind: "arrival_flight",
        title: flightPreview.title,
        subtitle: flightPreview.subtitle,
        timeWindow: "morning",
        timeOfDay: "morning",
        startTime: flightPreview.departAt || null,
        endTime: flightPreview.arriveAt || null,
        source: "booking_flights",
        sourceId: flightPreview.offerId || flightPreview.bookingToken || null,
        lat: null,
        lng: null,
        imageUrl: null,
        price: flightPreview.price,
        rating: null,
        durationMin: flightPreview.durationSec ? Math.max(30, Math.round(flightPreview.durationSec / 60)) : null,
        meta: buildPlanFlightMeta(flightPreview),
      });
    } else if (i === 0 && !overrides?.userPrefs?.roadTrip) {
      pushDayItem({
        id: makePlanId(),
        type: "flight",
        kind: "arrival_flight",
        title: `Flight to ${resolvedDestination}`,
        subtitle: "Add your departure airport to lock a real flight option.",
        timeWindow: "morning",
        timeOfDay: "morning",
        startTime: `${date}T09:00:00`,
        endTime: `${date}T11:00:00`,
        source: null,
        sourceId: null,
        lat: null,
        lng: null,
        imageUrl: null,
        price: null,
        rating: null,
        durationMin: 120,
        meta: { placeholder: true },
      });
    }

    if (i === 0) {
      const hotelCheckinStart =
        Number.isFinite(arrivalMinutes) && arrivalMinutes + 60 > 15 * 60
          ? minutesToClock(arrivalMinutes + 60)
          : "15:00";
      const hotelCheckinEnd =
        Number.isFinite(arrivalMinutes) && arrivalMinutes + 90 > 15 * 60 + 30
          ? minutesToClock(arrivalMinutes + 90)
          : "15:30";
      pushDayItem({
        id: makePlanId(),
        type: "hotel",
        kind: "hotel_checkin",
        title: hotelResult?.name || `Check-in near ${resolvedDestination}`,
        subtitle: hotelResult?.name ? resolvedDestination : "Check-in around 3:00 PM",
        timeWindow: "afternoon",
        timeOfDay: "afternoon",
        startTime: `${date}T${hotelCheckinStart}:00`,
        endTime: `${date}T${hotelCheckinEnd}:00`,
        source: hotelResult?.hotelId ? "booking_hotels" : null,
        sourceId: hotelResult?.hotelId ? String(hotelResult.hotelId) : null,
        lat: hotelResult?.lat ?? null,
        lng: hotelResult?.lng ?? null,
        imageUrl: hotelResult?.imageUrl || null,
        price: hotelResult?.priceTotal
          ? { amount: hotelResult.priceTotal, currency: hotelResult.currency || "USD" }
          : null,
        rating: hotelResult?.reviewScore ?? null,
        durationMin: 30,
        meta: { checkinTime: "3:00 PM" },
      });
    }

    if (i === dayCount - 1) {
      pushDayItem({
        id: makePlanId(),
        type: "hotel",
        kind: "hotel_checkout",
        title: hotelResult?.name ? `Check-out: ${hotelResult.name}` : "Hotel check-out",
        subtitle: "Check-out around 11:00 AM",
        timeWindow: "morning",
        timeOfDay: "morning",
        startTime: `${date}T11:00:00`,
        endTime: `${date}T11:30:00`,
        source: hotelResult?.hotelId ? "booking_hotels" : null,
        sourceId: hotelResult?.hotelId ? String(hotelResult.hotelId) : null,
        lat: hotelResult?.lat ?? null,
        lng: hotelResult?.lng ?? null,
        imageUrl: hotelResult?.imageUrl || null,
        price: hotelResult?.priceTotal
          ? { amount: hotelResult.priceTotal, currency: hotelResult.currency || "USD" }
          : null,
        rating: hotelResult?.reviewScore ?? null,
        durationMin: 30,
        meta: { checkoutTime: "11:00 AM" },
      });
    }

    for (const item of outlineItems) {
      if (!item?.type) continue;
      const base = {
        id: makePlanId(),
        kind: item?.type === "transit" ? "transit" : "activity",
        title: item?.title || "Plan item",
        subtitle: null,
        timeWindow: item?.timeWindow || "afternoon",
        timeOfDay: mapTimeWindowToTimeOfDay(item?.timeWindow),
        source: item?.sourcePreference || null,
        sourceId: null,
        lat: null,
        lng: null,
        imageUrl: null,
        price: null,
        rating: null,
        durationMin: item?.durationMin ?? null,
        meta: item?.notes ? { notes: item.notes } : null,
      };

      if (item.type === "restaurant") {
        continue;
      }

      if (item.type === "attraction" && attractionsList.length) {
        const match = pickClusteredAttraction(i, item?.query || item?.title);
        if (match) {
          pushDayItem({
            ...base,
            type: "attraction",
            title: match.name || base.title,
            subtitle: match.location?.city || resolvedDestination,
            source: "booking_attractions",
            sourceId: match.slug || match.id || null,
            lat: match.location?.lat ?? null,
            lng: match.location?.lng ?? null,
            imageUrl: match.image || null,
            rating: match.rating?.average ?? null,
            price: match.price?.publicAmount
              ? { amount: match.price.publicAmount, currency: match.price.currency || "USD" }
              : null,
            meta: { ...(base.meta || {}), attractionId: match.id },
          });
          continue;
        }
      }

      if (item.type === "place" || item.type === "attraction") {
        const textQuery = item?.query || item?.title || "things to do";
        const place = await findPlaceOnce(textQuery);
        if (place?.id) {
          const photoRef = place?.photos?.[0]?.name || null;
          pushDayItem({
            ...base,
            type: item.type === "attraction" ? "attraction" : "place",
            title: place?.displayName?.text || base.title,
            subtitle:
              place?.shortFormattedAddress || place?.formattedAddress || resolvedDestination,
            source: "google",
            sourceId: place.id,
            lat: place?.location?.latitude ?? null,
            lng: place?.location?.longitude ?? null,
            imageUrl: photoRef ? buildPhotoUrl(photoRef, 500) : null,
            rating: place?.rating ?? null,
            meta: { ...(base.meta || {}), userRatingCount: place?.userRatingCount ?? null },
          });
          continue;
        }
      }

      if (item.type === "transit") {
        pushDayItem({
          ...base,
          type: "transit",
          kind: "transit",
          subtitle: item?.notes || resolvedDestination,
        });
        continue;
      }

      if (item.type === "hotel" && hotelResult?.hotelId) {
        pushDayItem({
          ...base,
          type: "hotel",
          kind: "hotel_visit",
          title: hotelResult.name || base.title,
          subtitle: resolvedDestination,
          source: "booking_hotels",
          sourceId: String(hotelResult.hotelId),
          lat: hotelResult.lat ?? null,
          lng: hotelResult.lng ?? null,
          imageUrl: hotelResult.imageUrl || null,
          price: hotelResult.priceTotal
            ? { amount: hotelResult.priceTotal, currency: hotelResult.currency || "USD" }
            : null,
          rating: hotelResult.reviewScore ?? null,
        });
      }
    }

    while (dayItems.filter((item) => item.type === "attraction" || item.kind === "activity").length < (outlineDay?.maxActivities || 3) && attractionPool.length) {
      const next = pickClusteredAttraction(i);
      if (!next) break;
      const activityIndex = dayItems.filter(
        (item) => item.type === "attraction" || item.kind === "activity"
      ).length;
      pushDayItem({
        id: makePlanId(),
        type: "attraction",
        kind: "activity",
        title: next.name,
        subtitle: next.location?.city || resolvedDestination,
        timeWindow:
          activityIndex === 0 ? "morning" : activityIndex === 1 ? "afternoon" : "evening",
        timeOfDay:
          activityIndex === 0 ? "morning" : activityIndex === 1 ? "afternoon" : "evening",
        source: "booking_attractions",
        sourceId: next.slug || next.id || null,
        lat: next.location?.lat ?? null,
        lng: next.location?.lng ?? null,
        imageUrl: next.image || null,
        price: next.price?.publicAmount
          ? { amount: next.price.publicAmount, currency: next.price.currency || "USD" }
          : null,
        rating: next.rating?.average ?? null,
        durationMin: null,
        meta: { attractionId: next.id },
      });
    }

    const middayAnchor =
      dayItems.find((item) => item.timeWindow === "afternoon" && item.lat && item.lng) ||
      dayItems.find((item) => item.timeWindow === "morning" && item.lat && item.lng) ||
      null;
    const eveningAnchor =
      [...dayItems].reverse().find((item) => (item.timeWindow === "evening" || item.timeWindow === "afternoon") && item.lat && item.lng) ||
      null;

    pushDayItem(
      buildRestaurantPlanItem(
        pickRestaurantForMeal(
          restaurantPool,
          "lunch",
          middayAnchor ? { lat: middayAnchor.lat, lng: middayAnchor.lng } : center
        ),
        resolvedDestination,
        "lunch"
      )
    );
    pushDayItem(
      buildRestaurantPlanItem(
        pickRestaurantForMeal(
          restaurantPool,
          "dinner",
          eveningAnchor ? { lat: eveningAnchor.lat, lng: eveningAnchor.lng } : center
        ),
        resolvedDestination,
        "dinner"
      )
    );

    if (i === dayCount - 1 && (flightPreview || hasReturnFlight)) {
      pushDayItem({
        id: makePlanId(),
        type: "flight",
        kind: "departure_flight",
        title: `Return flight: ${flightPreview.toLabel} → ${flightPreview.fromLabel}`,
        subtitle:
          `${flightPreview.airlineName || flightPreview.airlineCode || "Flight"} • ` +
          `${flightPreview.returnDepartAt || flightPreview.departAt || ""} → ` +
          `${flightPreview.returnArriveAt || flightPreview.arriveAt || ""} • ` +
          `${flightPreview.stops === 0 ? "nonstop" : `${flightPreview.stops || 0} stop`}`,
        timeWindow: "evening",
        timeOfDay: "evening",
        startTime: flightPreview.returnDepartAt || flightPreview.departAt || null,
        endTime: flightPreview.returnArriveAt || flightPreview.arriveAt || null,
        source: "booking_flights",
        sourceId: flightPreview.offerId || flightPreview.bookingToken || null,
        lat: null,
        lng: null,
        imageUrl: null,
        price: flightPreview.price,
        rating: null,
        durationMin: flightPreview.durationSec ? Math.max(30, Math.round(flightPreview.durationSec / 60)) : null,
        meta: buildPlanFlightMeta(flightPreview, {
          fromId: flightPreview.toId,
          toId: flightPreview.fromId,
          fromLabel: flightPreview.toLabel,
          toLabel: flightPreview.fromLabel,
          departTime: flightPreview.returnDepartAt || flightPreview.departAt || null,
          arriveTime: flightPreview.returnArriveAt || flightPreview.arriveAt || null,
          departAirportCode: flightPreview.toLabel || null,
          arriveAirportCode: flightPreview.fromLabel || null,
        }),
      });
    } else if (i === dayCount - 1 && !overrides?.userPrefs?.roadTrip) {
      pushDayItem({
        id: makePlanId(),
        type: "flight",
        kind: "departure_flight",
        title: `Return flight from ${resolvedDestination}`,
        subtitle: "Add your departure airport to lock a real return option.",
        timeWindow: "evening",
        timeOfDay: "evening",
        startTime: `${date}T19:00:00`,
        endTime: `${date}T21:00:00`,
        source: null,
        sourceId: null,
        lat: null,
        lng: null,
        imageUrl: null,
        price: null,
        rating: null,
        durationMin: 120,
        meta: { placeholder: true },
      });
    }

    const scheduledItems = scheduleDay({
      date,
      items: dayItems,
      dayStartTime: firstDayStartTime,
      dayEndTime: lastDayEndTime,
      maxActivities: outlineDay?.maxActivities || 3,
    }).map((item) => ({
      ...item,
      timeOfDay: item.timeOfDay || mapTimeWindowToTimeOfDay(item.timeWindow),
    }));

    planDays.push({
      date,
      label: outlineDay?.label || `Day ${i + 1}`,
      theme: outlineDay?.theme || null,
      dayStartTime: firstDayStartTime,
      dayEndTime: lastDayEndTime,
      maxActivities: outlineDay?.maxActivities || 3,
      items: scheduledItems,
    });
  }

  const plan = {
    id: makePlanId(),
    tripId: resolvedTripId,
    title: outline?.title || `Trip to ${resolvedDestination}`,
    startDate,
    endDate,
    destinationLabel: resolvedDestination,
    days: planDays,
  };

  const { data: saved, error } = await supabaseAdmin
    .from("trip_plans")
    .insert({
      id: plan.id,
      trip_id: resolvedTripId,
      user_id: authUser.id,
      title: plan.title,
      start_date: startDate,
      end_date: endDate,
      destination_label: resolvedDestination,
      plan_json: plan,
    })
    .select("*")
    .single();

  if (error) {
    return { error: error.message || "Failed to save trip plan" };
  }

  const highlights =
    Array.isArray(outline?.highlights) && outline.highlights.length
      ? outline.highlights.slice(0, 5)
      : planDays
          .flatMap((day) => day.items)
          .slice(0, 5)
          .map((item) => item.title);

  const dateRangeLabel = `${startDate} → ${endDate}`;
  const assistantMessage = {
    type: "plan_card",
    text: `Here's a ${planDays.length}-day plan for ${resolvedDestination}.`,
    planId: plan.id,
    title: plan.title,
    dateRangeLabel,
    highlights,
    actions: {
      primary: { type: "open_plan", label: "View full plan", planId: plan.id },
      optional: { type: "open_map", label: "Map", planId: plan.id },
    },
  };

  const attractionEntities = [];
  const restaurantEntities = [];
  const hotelEntities = [];
  for (const day of planDays) {
    for (const item of day?.items || []) {
      if (item?.type === "attraction") {
        attractionEntities.push({
          id: buildEntityRefId("a", item),
          provider_id: item?.sourceId || null,
          name: item?.title || null,
          lat: item?.lat ?? null,
          lng: item?.lng ?? null,
          category: item?.kind || "activity",
          source: item?.source || null,
        });
      }
      if (item?.type === "restaurant") {
        restaurantEntities.push({
          id: buildEntityRefId("r", item),
          provider_id: item?.sourceId || null,
          name: item?.title || null,
          lat: item?.lat ?? null,
          lng: item?.lng ?? null,
          category: item?.meta?.meal || "restaurant",
          source: item?.source || null,
        });
      }
      if (item?.type === "hotel") {
        hotelEntities.push({
          id: buildEntityRefId("h", item),
          provider_id: item?.sourceId || null,
          name: item?.title || null,
          lat: item?.lat ?? null,
          lng: item?.lng ?? null,
          category: item?.kind || "hotel",
          source: item?.source || null,
        });
      }
    }
  }

  const draft = {
    threadId: overrides?.threadId || null,
    tripId: resolvedTripId,
    startDate,
    endDate,
    destinationLabel: resolvedDestination,
    budgetTier: normalizeBudgetTier(overrides?.userPrefs?.budget),
    vibes: normalizeVibes(overrides?.userPrefs?.vibe),
    travelers: {
      adults: adultsCount,
      children: Number(overrides?.userPrefs?.travelerBreakdown?.children || 0),
    },
    needsConfirmation,
    message: needsConfirmation
      ? `I built a realistic ${planDays.length}-day plan for ${resolvedDestination} using ${startDate} to ${endDate}. Confirm the dates and I can tighten it further.`
      : `I built a realistic ${planDays.length}-day plan for ${resolvedDestination}. Want a cheaper flight or a more walkable hotel area?`,
    selectedFlight: buildFlightCardSelection(flightBundle.selected, resolvedFlightFrom, resolvedFlightTo),
    flightAlternates: flightBundle.alternates.map((offer) => buildFlightCardSelection(offer, resolvedFlightFrom, resolvedFlightTo)),
    selectedHotel: hotelResult
      ? {
          provider: "booking_hotels",
          hotel_id: String(hotelResult.hotelId),
          name: hotelResult.name || null,
          rating: hotelResult.reviewScore ?? null,
          price_per_night: hotelResult.priceTotal
            ? {
                amount: Number(hotelResult.priceTotal) / Math.max(1, dayCount - 1),
                currency: hotelResult.currency || "USD",
              }
            : null,
          location: {
            name: resolvedDestination,
            lat: hotelResult.lat ?? null,
            lng: hotelResult.lng ?? null,
          },
          image_url: hotelResult.imageUrl || null,
        }
      : null,
    hotelAlternates: hotelCandidates.slice(1, 5).map((hotel) => ({
      provider: "booking_hotels",
      hotel_id: String(hotel.hotelId),
      name: hotel.name || null,
      rating: hotel.reviewScore ?? null,
      price_per_night: hotel.priceTotal
        ? { amount: Number(hotel.priceTotal) / Math.max(1, dayCount - 1), currency: hotel.currency || "USD" }
        : null,
      location: {
        name: resolvedDestination,
        lat: hotel.lat ?? null,
        lng: hotel.lng ?? null,
      },
      image_url: hotel.imageUrl || null,
    })),
    plan,
    pools: {
      attractions: attractionsList,
      restaurants: restaurantsList,
      hotels: hotelCandidates,
      flights: (flightBundle.selected ? [flightBundle.selected] : []).concat(flightBundle.alternates),
    },
    entities: {
      attractions: dedupeBy(attractionEntities, (item) => item.id),
      restaurants: dedupeBy(restaurantEntities, (item) => item.id),
      hotels: dedupeBy(hotelEntities, (item) => item.id),
    },
    locks: existingDraft?.locks || { flight: false, hotel: false, locked_days: [] },
    usedIds: {
      attractions: dedupeBy(
        [...(usedIds.attractions || []), ...attractionEntities.map((item) => item.provider_id).filter(Boolean)],
        (item) => item
      ),
      restaurants: dedupeBy(
        [...(usedIds.restaurants || []), ...restaurantEntities.map((item) => item.provider_id).filter(Boolean)],
        (item) => item
      ),
      hotels: dedupeBy(
        [...(usedIds.hotels || []), ...(hotelResult?.hotelId ? [String(hotelResult.hotelId)] : [])],
        (item) => item
      ),
    },
    debug: {
      used_pages: { attractions: 4, hotels: 3, restaurants: 4 },
      dedupe_removed: {
        attractions: Math.max(0, 4 * 20 - attractionsList.length),
        hotels: Math.max(0, 3 * 25 - hotelCandidates.length),
        restaurants: Math.max(0, 4 * 12 - restaurantsList.length),
      },
    },
  };
  const structuredResponse = buildTripDraftResponse(draft);

  console.log("[plan] outline_ms", outlineMs, "total_ms", Date.now() - startedAt);
  return { plan, assistantMessage, assistantResponse: structuredResponse, tripId: resolvedTripId, draft };
}

function rotateDraftFlight(draft) {
  if (!draft?.selectedFlight || !Array.isArray(draft?.flightAlternates) || !draft.flightAlternates.length) {
    return draft;
  }
  const [next, ...rest] = draft.flightAlternates;
  return {
    ...draft,
    selectedFlight: next,
    flightAlternates: [...rest, draft.selectedFlight].filter(Boolean).slice(0, 4),
    message: "I swapped in the next-best flight option and kept the rest as alternates.",
  };
}

function rotateDraftHotel(draft) {
  if (!draft?.selectedHotel || !Array.isArray(draft?.hotelAlternates) || !draft.hotelAlternates.length) {
    return draft;
  }
  const [next, ...rest] = draft.hotelAlternates;
  return {
    ...draft,
    selectedHotel: next,
    hotelAlternates: [...rest, draft.selectedHotel].slice(0, 4),
    message: "I swapped the hotel to the next-best alternate.",
  };
}

function regenerateDraftDay(draft, date) {
  const targetDate = String(date || "");
  const pools = draft?.pools || {};
  const dayIndex = (draft?.plan?.days || []).findIndex((day) => day?.date === targetDate);
  if (dayIndex < 0) return draft;
  if (draft?.locks?.locked_days?.includes(targetDate)) return draft;

  const attractions = filterNovelItems(
    pools.attractions || [],
    draft?.usedIds?.attractions || [],
    (item) => String(item?.slug || item?.id || item?.name || ""),
    6
  );
  const restaurants = filterNovelItems(
    pools.restaurants || [],
    draft?.usedIds?.restaurants || [],
    (item) => String(item?.placeId || item?.providerId || item?.name || ""),
    4
  );

  const nextAttraction = attractions[0];
  const secondAttraction = attractions[1] || attractions[0] || null;
  const lunch = restaurants[0];
  const dinner = restaurants[1] || restaurants[0] || null;
  const day = draft.plan.days[dayIndex];
  const newItems = [];

  if (nextAttraction) {
    newItems.push({
      id: makePlanId(),
      type: "attraction",
      kind: "activity",
      title: nextAttraction.name,
      source: "booking_attractions",
      sourceId: nextAttraction.slug || nextAttraction.id || null,
      lat: nextAttraction.location?.lat ?? null,
      lng: nextAttraction.location?.lng ?? null,
      imageUrl: nextAttraction.image || null,
      timeWindow: "morning",
    });
  }
  if (lunch) newItems.push(buildRestaurantPlanItem(lunch, draft.destinationLabel, "lunch"));
  if (secondAttraction) {
    newItems.push({
      id: makePlanId(),
      type: "attraction",
      kind: "activity",
      title: secondAttraction.name,
      source: "booking_attractions",
      sourceId: secondAttraction.slug || secondAttraction.id || null,
      lat: secondAttraction.location?.lat ?? null,
      lng: secondAttraction.location?.lng ?? null,
      imageUrl: secondAttraction.image || null,
      timeWindow: "afternoon",
    });
  }
  if (dinner) newItems.push(buildRestaurantPlanItem(dinner, draft.destinationLabel, "dinner"));

  const scheduled = scheduleDay({
    date: day.date,
    items: newItems,
    dayStartTime: day.dayStartTime || SCHEDULE_DEFAULTS.dayStartTime,
    dayEndTime: day.dayEndTime || SCHEDULE_DEFAULTS.dayEndTime,
    maxActivities: 3,
  });

  const nextDays = draft.plan.days.map((entry) =>
    entry.date === targetDate ? { ...entry, items: scheduled, theme: `${entry.theme || entry.label} refreshed` } : entry
  );

  return {
    ...draft,
    plan: { ...draft.plan, days: nextDays },
    message: `I rebuilt ${targetDate} with a different mix of places.`,
    usedIds: {
      ...draft.usedIds,
      attractions: dedupeBy(
        [...(draft?.usedIds?.attractions || []), ...newItems.map((item) => item.sourceId).filter(Boolean)],
        (item) => item
      ),
      restaurants: dedupeBy(
        [...(draft?.usedIds?.restaurants || []), ...newItems.filter((item) => item.type === "restaurant").map((item) => item.sourceId).filter(Boolean)],
        (item) => item
      ),
    },
  };
}

function lockDraftPlan(draft) {
  return {
    ...draft,
    locks: {
      flight: true,
      hotel: true,
      locked_days: (draft?.plan?.days || []).map((day) => day?.date).filter(Boolean),
    },
    message: "Locked the current flight, hotel, and itinerary days.",
  };
}

function tuneDraft(draft, payload = {}) {
  const budgetTier = payload?.budget_tier ? normalizeBudgetTier(payload.budget_tier) : draft?.budgetTier;
  const addedVibes = normalizeVibes(payload?.vibe_add || []);
  const removedVibes = normalizeVibes(payload?.vibe_remove || []);
  const nextVibes = dedupeBy(
    [...(draft?.vibes || []), ...addedVibes].filter((item) => !removedVibes.includes(item)),
    (item) => item
  );
  let nextDraft = {
    ...draft,
    budgetTier,
    vibes: nextVibes,
  };

  const notes = [];
  if (budgetTier !== draft?.budgetTier) {
    notes.push(`set budget to ${budgetTier}`);
  }

  if (budgetTier === "budget") {
    const tunedCheaper = tuneDraftToCheaperOptions(nextDraft);
    if (tunedCheaper.changedFlights) notes.push("swapped to a cheaper flight");
    if (tunedCheaper.changedHotels) notes.push("swapped to a cheaper hotel");
    nextDraft = tunedCheaper.draft;
  }

  if (addedVibes.includes("nightlife")) {
    const nightlife = tuneDraftForNightlife(nextDraft);
    if (nightlife.changedDays > 0) notes.push(`added nightlife to ${nightlife.changedDays} day(s)`);
    nextDraft = nightlife.draft;
  }

  if (addedVibes.includes("museum")) {
    const museum = tuneDraftForMuseums(nextDraft);
    if (museum.changedDays > 0) notes.push(`added museum time to ${museum.changedDays} day(s)`);
    nextDraft = museum.draft;
  }

  if (addedVibes.includes("walkable")) {
    notes.push("prioritized more walkable pacing");
  }
  if (addedVibes.includes("day_trip")) {
    notes.push("added a day-trip preference");
  }

  const message = notes.length
    ? `Updated the plan: ${notes.join("; ")}.`
    : "Updated the plan preferences.";

  return { ...nextDraft, message };
}

function parseDraftTunePayloadFromMessage(message) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return null;
  if (text.includes("cheaper")) return { budget_tier: "budget" };
  if (text.includes("more premium") || text.includes("more luxury") || text.includes("luxury")) {
    return { budget_tier: "luxury" };
  }
  if (text.includes("more nightlife") || text.includes("nightlife")) return { vibe_add: ["nightlife"] };
  if (text.includes("more museums") || text.includes("museum")) return { vibe_add: ["museum"] };
  if (text.includes("walkable")) return { vibe_add: ["walkable"] };
  if (text.includes("day trip")) return { vibe_add: ["day_trip"] };
  return null;
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function flightPriceAmount(flight) {
  return toFiniteNumber(flight?.price?.amount);
}

function hotelNightlyAmount(hotel) {
  return toFiniteNumber(hotel?.price_per_night?.amount);
}

function tuneDraftToCheaperOptions(draft) {
  let changedFlights = false;
  let changedHotels = false;
  let selectedFlight = draft?.selectedFlight || null;
  let flightAlternates = Array.isArray(draft?.flightAlternates) ? draft.flightAlternates.slice() : [];
  let selectedHotel = draft?.selectedHotel || null;
  let hotelAlternates = Array.isArray(draft?.hotelAlternates) ? draft.hotelAlternates.slice() : [];

  if (selectedFlight) {
    const flightPool = [selectedFlight, ...flightAlternates];
    const cheapestFlight = flightPool
      .filter((item) => flightPriceAmount(item) !== null)
      .sort((a, b) => flightPriceAmount(a) - flightPriceAmount(b))[0];
    if (cheapestFlight && cheapestFlight !== selectedFlight) {
      changedFlights = true;
      selectedFlight = cheapestFlight;
      flightAlternates = flightPool.filter((item) => item !== cheapestFlight).slice(0, 4);
    }
  }

  if (selectedHotel) {
    const hotelPool = [selectedHotel, ...hotelAlternates];
    const cheapestHotel = hotelPool
      .filter((item) => hotelNightlyAmount(item) !== null)
      .sort((a, b) => hotelNightlyAmount(a) - hotelNightlyAmount(b))[0];
    if (cheapestHotel && cheapestHotel !== selectedHotel) {
      changedHotels = true;
      selectedHotel = cheapestHotel;
      hotelAlternates = hotelPool.filter((item) => item !== cheapestHotel).slice(0, 4);
    }
  }

  return {
    changedFlights,
    changedHotels,
    draft: {
      ...draft,
      selectedFlight,
      flightAlternates,
      selectedHotel,
      hotelAlternates,
    },
  };
}

function isUnlockedDay(draft, day) {
  const locked = draft?.locks?.locked_days || [];
  return !locked.includes(day?.date);
}

function tuneDraftForNightlife(draft) {
  const nightlifePool = (draft?.pools?.restaurants || []).filter((item) =>
    /\b(bar|pub|club|lounge|cocktail|brewery|taproom|speakeasy|night)\b/i.test(
      String(item?.name || "")
    )
  );
  if (!nightlifePool.length || !Array.isArray(draft?.plan?.days)) {
    return { changedDays: 0, draft };
  }

  let idx = 0;
  let changedDays = 0;
  const nextDays = draft.plan.days.map((day) => {
    if (!isUnlockedDay(draft, day)) return day;
    const items = Array.isArray(day?.items) ? day.items.slice() : [];
    const dinnerIdx = items.findIndex(
      (item) =>
        item?.type === "restaurant" &&
        (item?.meta?.meal === "dinner" || item?.timeWindow === "dinner")
    );
    const targetIdx = dinnerIdx >= 0 ? dinnerIdx : items.findIndex((item) => item?.type === "restaurant");
    if (targetIdx < 0) return day;
    const pick = nightlifePool[idx % nightlifePool.length];
    idx += 1;
    items[targetIdx] = {
      ...items[targetIdx],
      title: pick?.name || items[targetIdx].title,
      sourceId: pick?.placeId || pick?.providerId || items[targetIdx].sourceId,
      imageUrl: pick?.imageUrl || items[targetIdx].imageUrl,
      lat: pick?.lat ?? items[targetIdx].lat ?? null,
      lng: pick?.lng ?? items[targetIdx].lng ?? null,
      meta: { ...(items[targetIdx].meta || {}), meal: "dinner" },
    };
    changedDays += 1;
    return { ...day, items };
  });

  return { changedDays, draft: { ...draft, plan: { ...draft.plan, days: nextDays } } };
}

function tuneDraftForMuseums(draft) {
  const museumPool = (draft?.pools?.attractions || []).filter((item) =>
    /\b(museum|gallery|history|heritage|science|art)\b/i.test(String(item?.name || ""))
  );
  if (!museumPool.length || !Array.isArray(draft?.plan?.days)) {
    return { changedDays: 0, draft };
  }

  let idx = 0;
  let changedDays = 0;
  const nextDays = draft.plan.days.map((day) => {
    if (!isUnlockedDay(draft, day)) return day;
    const items = Array.isArray(day?.items) ? day.items.slice() : [];
    const attractionIdx = items.findIndex((item) => item?.type === "attraction");
    if (attractionIdx < 0) return day;
    const pick = museumPool[idx % museumPool.length];
    idx += 1;
    items[attractionIdx] = {
      ...items[attractionIdx],
      title: pick?.name || items[attractionIdx].title,
      sourceId: pick?.slug || pick?.id || items[attractionIdx].sourceId,
      imageUrl: pick?.image || items[attractionIdx].imageUrl,
      lat: pick?.location?.lat ?? items[attractionIdx].lat ?? null,
      lng: pick?.location?.lng ?? items[attractionIdx].lng ?? null,
      kind: "activity",
    };
    changedDays += 1;
    return { ...day, items };
  });

  return { changedDays, draft: { ...draft, plan: { ...draft.plan, days: nextDays } } };
}


// Legacy non-threaded assistant routes.
// Private 1:1 chat should use /api/chats exclusively; keep this router only for
// trip-draft generation, assistant action endpoints, and transitional planner flows.
export async function assistantRoutes(app) {
  app.post("/plan", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const { tripId, promptText, userPrefs, startDate, endDate, destinationLabel, threadId, workspaceId } = req.body || {};
    if (!promptText) {
      return reply.code(400).send({ error: "promptText is required" });
    }
    const assistantThreadId = getAssistantThreadId({ threadId, workspaceId, tripId });
    const existingDraft = await loadTripDraft(authUser, assistantThreadId);

    let plannerTripId = tripId || null;
    try {
      plannerTripId = await ensurePlannerTripForMessage({
        authUser,
        tripId,
        createTripPrefs: userPrefs || null,
        destinationLabel: destinationLabel || detectLocationInMessage(promptText),
        startDate: startDate || parseDateRangeFromText(promptText)?.startDate || null,
        endDate: endDate || parseDateRangeFromText(promptText)?.endDate || null,
      });
    } catch (err) {
      return reply.code(500).send({ error: err?.message ?? String(err) });
    }

    const result = await buildTripPlanFromPrompt({
      promptText,
      tripId: plannerTripId,
      authUser,
      overrides: { userPrefs, startDate, endDate, destinationLabel, threadId: assistantThreadId, existingDraft },
    });

    if (result?.draft) {
      await persistTripDraft(authUser, assistantThreadId, result.draft);
    }
    if (result?.error && result?.assistantResponse) {
      return reply.send(result.assistantResponse);
    }
    if (result?.error && result?.assistantMessage) {
      return reply.send({ assistantMessage: result.assistantMessage, thread_id: assistantThreadId });
    }
    if (result?.error) {
      return reply.code(500).send({ error: result.error });
    }

    return reply.send(result.assistantResponse || {
      assistantMessage: result.assistantMessage,
      planId: result.plan?.id,
      tripId: result.tripId || plannerTripId,
      thread_id: assistantThreadId,
    });
  });

  app.post("/actions/swap-flight", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;
    const assistantThreadId = getAssistantThreadId(req.body || {});
    const draft = await loadTripDraft(authUser, assistantThreadId);
    if (!draft) return reply.code(404).send({ error: "Trip draft not found" });
    const nextDraft = rotateDraftFlight(draft);
    await persistTripDraft(authUser, assistantThreadId, nextDraft);
    return reply.send(buildTripDraftResponse(nextDraft));
  });

  app.post("/actions/swap-hotel", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;
    const assistantThreadId = getAssistantThreadId(req.body || {});
    const draft = await loadTripDraft(authUser, assistantThreadId);
    if (!draft) return reply.code(404).send({ error: "Trip draft not found" });
    const nextDraft = rotateDraftHotel(draft);
    await persistTripDraft(authUser, assistantThreadId, nextDraft);
    return reply.send(buildTripDraftResponse(nextDraft));
  });

  app.post("/actions/regenerate-day", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;
    const assistantThreadId = getAssistantThreadId(req.body || {});
    const draft = await loadTripDraft(authUser, assistantThreadId);
    if (!draft) return reply.code(404).send({ error: "Trip draft not found" });
    const nextDraft = regenerateDraftDay(draft, req.body?.date);
    await persistTripDraft(authUser, assistantThreadId, nextDraft);
    return reply.send(buildTripDraftResponse(nextDraft));
  });

  app.post("/actions/more-attractions", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;
    const assistantThreadId = getAssistantThreadId(req.body || {});
    const draft = await loadTripDraft(authUser, assistantThreadId);
    if (!draft) return reply.code(404).send({ error: "Trip draft not found" });
    const count = Math.max(1, Math.min(20, Number(req.body?.count || 10)));
    const fresh = filterNovelItems(
      draft?.pools?.attractions || [],
      draft?.usedIds?.attractions || [],
      (item) => String(item?.slug || item?.id || item?.name || ""),
      count
    ).slice(0, count);
    const extraCard = {
      type: "attractions_list_card",
      title: "More attractions",
      items: fresh.map((item) => ({
        ref_id: buildEntityRefId("a", { sourceId: item?.slug || item?.id, name: item?.name }),
        name: item?.name || null,
        rating: item?.rating?.average ?? null,
        price: item?.price?.publicAmount ?? item?.price?.amount ?? null,
        lat: item?.location?.lat ?? null,
        lng: item?.location?.lng ?? null,
      })),
    };
    return reply.send(buildTripDraftResponse(draft, [extraCard]));
  });

  app.post("/actions/lock-plan", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;
    const assistantThreadId = getAssistantThreadId(req.body || {});
    const draft = await loadTripDraft(authUser, assistantThreadId);
    if (!draft) return reply.code(404).send({ error: "Trip draft not found" });
    const nextDraft = lockDraftPlan(draft);
    await persistTripDraft(authUser, assistantThreadId, nextDraft);
    const promotedTripId = String(nextDraft?.tripId || "").trim() || null;
    const lockedPlanId = String(nextDraft?.plan?.id || "").trim() || null;

    let warningMessage = null;
    if (promotedTripId) {
      const updatePayload = {
        planning_state: "unconfirmed",
        locked_at: new Date().toISOString(),
        confirmed_at: null,
      };
      if (lockedPlanId) {
        updatePayload.locked_plan_id = lockedPlanId;
      }

      const { data, error } = await supabaseAdmin
        .from("trips")
        .update(updatePayload)
        .eq("id", promotedTripId)
        .eq("user_id", authUser.id)
        .select("id")
        .maybeSingle();

      if (error || !data?.id) {
        warningMessage = "Plan locked in chat, but we couldn't add it to My Trips yet.";
      }
    } else {
      warningMessage = "Plan locked in chat. Add trip dates/destination to save it in My Trips.";
    }

    const payload = buildTripDraftResponse(nextDraft);
    if (warningMessage) {
      payload.message = warningMessage;
    }
    return reply.send(payload);
  });

  app.post("/actions/tune", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;
    const assistantThreadId = getAssistantThreadId(req.body || {});
    const draft = await loadTripDraft(authUser, assistantThreadId);
    if (!draft) return reply.code(404).send({ error: "Trip draft not found" });
    const nextDraft = tuneDraft(draft, req.body || {});
    await persistTripDraft(authUser, assistantThreadId, nextDraft);
    return reply.send(buildTripDraftResponse(nextDraft));
  });

  app.post("/chat", async (req, reply) => {
    const { message, tripId, workspaceId, threadId, createTripPrefs: createTripPrefsRaw } = req.body || {};
    if (!message) {
      return reply.code(400).send({ error: "Missing message" });
    }

    const authUser = await requireAuth(req, reply);
    if (!authUser) return;
    const clientLat = Number(req.body?.clientLat);
    const clientLng = Number(req.body?.clientLng);

    const contextId = getAssistantThreadId({ threadId, workspaceId, tripId });
    const ctx = getAssistantContext(authUser, contextId);
    const contextualMessage = applyContextualLocationHint(message, ctx?.location || null);
    const existingDraft = await loadTripDraft(authUser, contextId);
    const effectiveIntent = getEffectiveIntent(contextualMessage, ctx);
    const createTripPrefs = normalizeCreateTripPrefs(createTripPrefsRaw);
    const effectiveUserPrefs = createTripPrefs || ctx?.createTripPrefs || null;
    const detectedLocation = detectLocationInMessage(contextualMessage);
    const detectedMode = detectTravelMode(contextualMessage);
    if (detectedLocation) {
      setAssistantContext(authUser, contextId, { location: detectedLocation });
    }
    if (detectedMode) {
      setAssistantContext(authUser, contextId, { travelMode: detectedMode });
    }
    if (createTripPrefs) {
      setAssistantContext(authUser, contextId, { createTripPrefs });
    }

    if (messageAsksForSummary(message) || (ctx?.pendingSummary && messageIsAffirmative(message))) {
      const latestCtx = getAssistantContext(authUser, contextId);
      setAssistantContext(authUser, contextId, { pendingSummary: false });
      return reply.send({
        assistantMessage: buildContextSummaryMessage(latestCtx),
      });
    }

    if (ctx?.pendingPlan) {
      const parsedDates = parseDateRangeFromText(message);
      const followupLocation =
        detectLocationInMessage(message) || detectStandaloneLocationReply(message);
      if (parsedDates?.startDate || parsedDates?.endDate || followupLocation) {
        const nextDestinationLabel = followupLocation || ctx.pendingPlan.destinationLabel || null;
        const nextStartDate =
          parsedDates?.startDate ||
          ctx.pendingPlan.startDate ||
          createTripPrefs?.startDate ||
          ctx.pendingPlan.userPrefs?.startDate ||
          ctx?.createTripPrefs?.startDate ||
          null;
        const nextEndDate =
          parsedDates?.endDate ||
          ctx.pendingPlan.endDate ||
          createTripPrefs?.endDate ||
          ctx.pendingPlan.userPrefs?.endDate ||
          ctx?.createTripPrefs?.endDate ||
          null;
        let plannerTripId = tripId || null;
        try {
          plannerTripId = await ensurePlannerTripForMessage({
            authUser,
            tripId,
            createTripPrefs:
              createTripPrefs || ctx.pendingPlan.userPrefs || ctx?.createTripPrefs || null,
            destinationLabel: nextDestinationLabel,
            startDate: nextStartDate,
            endDate: nextEndDate,
          });
        } catch (err) {
          const messageText = err?.message ?? String(err);
          return reply.code(500).send({ error: messageText });
        }

        const result = await buildTripPlanFromPrompt({
          promptText: ctx.pendingPlan.promptText || message,
          tripId: plannerTripId,
          authUser,
          overrides: {
            destinationLabel: nextDestinationLabel,
            startDate: nextStartDate,
            endDate: nextEndDate,
            userPrefs:
              createTripPrefs ||
              ctx.pendingPlan.userPrefs ||
              ctx?.createTripPrefs ||
              undefined,
            clientLat,
            clientLng,
            threadId: contextId,
            existingDraft,
          },
        });
        if (result?.draft) await persistTripDraft(authUser, contextId, result.draft);
        if (result?.error === "missing_dates" || result?.error === "missing_destination") {
          setAssistantContext(authUser, contextId, {
            pendingPlan: {
              ...ctx.pendingPlan,
              destinationLabel: nextDestinationLabel,
              startDate: nextStartDate,
              endDate: nextEndDate,
              userPrefs: createTripPrefs || ctx.pendingPlan.userPrefs || ctx?.createTripPrefs || undefined,
            },
          });
        } else {
          setAssistantContext(authUser, contextId, { pendingPlan: null });
        }
        if (result?.assistantResponse) {
          return reply.send(result.assistantResponse);
        }
        if (result?.assistantMessage) {
          return reply.send({
            assistantMessage: result.assistantMessage,
            planId: result.plan?.id,
            tripId: result.tripId || plannerTripId,
            thread_id: contextId,
          });
        }
      }
    }

    const tunePayloadFromMessage = parseDraftTunePayloadFromMessage(message);
    if (tunePayloadFromMessage) {
      let draftToTune = existingDraft;
      if (!draftToTune && tripId) {
        draftToTune = await loadLatestTripDraftByTripId(authUser, tripId);
      }
      if (draftToTune) {
        const nextDraft = tuneDraft(draftToTune, tunePayloadFromMessage);
        const persistThreadId = nextDraft?.threadId || contextId;
        await persistTripDraft(authUser, persistThreadId, nextDraft);
        setAssistantContext(authUser, contextId, {
          pendingIntent: null,
          lastIntent: "trip_plan_tune",
        });
        return reply.send(buildTripDraftResponse(nextDraft));
      }
    }

    if (createTripPrefs?.destination) {
      let plannerTripId = tripId || null;
      try {
        plannerTripId = await ensurePlannerTrip({
          authUser,
          tripId,
          createTripPrefs,
          destinationLabel: createTripPrefs.destination,
          startDate: createTripPrefs.startDate || null,
          endDate: createTripPrefs.endDate || null,
        });
      } catch (err) {
        const messageText = err?.message ?? String(err);
        return reply.code(500).send({ error: messageText });
      }

      const result = await buildTripPlanFromPrompt({
        promptText: message,
        tripId: plannerTripId,
        authUser,
        overrides: {
          destinationLabel: createTripPrefs.destination,
          startDate: createTripPrefs.startDate || null,
          endDate: createTripPrefs.endDate || null,
          userPrefs: createTripPrefs,
          clientLat,
          clientLng,
          threadId: contextId,
          existingDraft,
        },
      });
      if (result?.draft) await persistTripDraft(authUser, contextId, result.draft);
      if (result?.assistantResponse) {
        return reply.send(result.assistantResponse);
      }
      if (result?.assistantMessage) {
        return reply.send({
          assistantMessage: result.assistantMessage,
          planId: result.plan?.id,
          tripId: result.tripId || plannerTripId,
          thread_id: contextId,
        });
      }
    }

    if (effectiveIntent.tripPlan) {
      const parsedDates = parseDateRangeFromText(message);
      let plannerTripId = tripId || null;
      try {
        plannerTripId = await ensurePlannerTripForMessage({
          authUser,
          tripId,
          createTripPrefs: createTripPrefs || ctx?.createTripPrefs || null,
          destinationLabel:
            createTripPrefs?.destination ||
            detectLocationInMessage(message) ||
            detectStandaloneLocationReply(message) ||
            ctx.location ||
            null,
          startDate: createTripPrefs?.startDate || parsedDates?.startDate || null,
          endDate: createTripPrefs?.endDate || parsedDates?.endDate || null,
        });
      } catch (err) {
        const messageText = err?.message ?? String(err);
        return reply.code(500).send({ error: messageText });
      }

      const result = await buildTripPlanFromPrompt({
        promptText: message,
        tripId: plannerTripId,
        authUser,
        overrides: {
          destinationLabel: createTripPrefs?.destination || undefined,
          startDate: createTripPrefs?.startDate || null,
          endDate: createTripPrefs?.endDate || null,
          userPrefs: createTripPrefs || ctx?.createTripPrefs || undefined,
          clientLat,
          clientLng,
          threadId: contextId,
          existingDraft,
        },
      });
      if (result?.draft) await persistTripDraft(authUser, contextId, result.draft);
      if (result?.assistantMessage) {
        if (result?.error === "missing_dates" || result?.error === "missing_destination") {
          setAssistantContext(authUser, contextId, {
            pendingPlan: {
              promptText: message,
              destinationLabel:
                createTripPrefs?.destination ||
                detectLocationInMessage(message) ||
                detectStandaloneLocationReply(message) ||
                ctx.location ||
                null,
              startDate: createTripPrefs?.startDate || parsedDates?.startDate || null,
              endDate: createTripPrefs?.endDate || parsedDates?.endDate || null,
              userPrefs: effectiveUserPrefs,
            },
          });
        }
        if (result?.assistantResponse) {
          return reply.send(result.assistantResponse);
        }
        return reply.send({
          assistantMessage: result.assistantMessage,
          planId: result.plan?.id,
          tripId: result.tripId || plannerTripId,
          thread_id: contextId,
        });
      }
    }

    if (effectiveIntent.hotels) {
      const cityText = parseHotelCity(message) || detectedLocation || ctx.location || null;
      if (!cityText) {
        setAssistantContext(authUser, contextId, { pendingIntent: "hotels" });
        return reply.send({ assistantMessage: "Which city are you staying in?" });
      }

      let resolvedTripId = tripId || null;
      let checkIn;
      let checkOut;

      if (tripId) {
        const { data, error } = await supabaseAdmin
          .from("trips")
          .select("start_date,end_date")
          .eq("id", tripId)
          .eq("user_id", authUser.id)
          .single();

        if (!error && data) {
          checkIn = data.start_date;
          checkOut = data.end_date;
        } else {
          resolvedTripId = null;
        }
      }

      if (!resolvedTripId) {
        const checkInDate = toDateString(addDays(new Date(), 30));
        const checkOutDate = toDateString(addDays(new Date(checkInDate), 3));
        checkIn = checkInDate;
        checkOut = checkOutDate;
      }
      const resultRefId = resolvedTripId || workspaceId || null;

      let destination;
      let hotelsResponse;
      try {
        destination = await resolveHotelDestination(cityText);
        if (!destination?.dest_id || !destination?.search_type) {
          return reply.send({ assistantMessage: "Which city are you staying in?" });
        }
        hotelsResponse = await searchHotels({
          dest_id: destination.dest_id,
          search_type: destination.search_type,
          arrival_date: checkIn,
          departure_date: checkOut,
          adults: deriveAdultCount(effectiveUserPrefs, 1),
          room_qty: 1,
          page_number: 1,
          units: "metric",
          temperature_unit: "c",
          languagecode: "en-us",
          currency_code: "USD",
          location: "US",
        });
      } catch (err) {
        const messageText = err?.message ?? String(err);
        return reply.code(500).send({ error: messageText });
      }

      const normalized = normalizeHotelsResponse(hotelsResponse);
      const cards = (normalized?.hotels || []).slice(0, 5).map((hotel) => {
        return {
          providerId: hotel?.hotelId,
          name: hotel?.name,
          rating: hotel?.reviewScore ?? null,
          cityCode: destination?.label || cityText,
          checkIn,
          checkOut,
          price: hotel?.priceTotal ?? null,
          currency: hotel?.currency || "USD",
          imageUrl: hotel?.imageUrl || null,
          guestScore: hotel?.reviewScore ?? null,
          reviewCount: hotel?.reviewCount ?? null,
          lat: hotel?.lat ?? null,
          lng: hotel?.lng ?? null,
        };
      });

      setAssistantContext(authUser, contextId, {
        pendingIntent: null,
        lastIntent: "hotels",
        location: destination?.label || cityText,
        lastHotel: {
          city: destination?.label || cityText,
          checkIn: checkIn || null,
          checkOut: checkOut || null,
        },
      });
      return reply.send({
        assistantMessage: `Here are a few hotel options in ${destination?.label || cityText}.`,
        cards,
        actions: [
          {
            type: "view_all_hotels",
            label: "View all",
            params: {
              tripId: resultRefId,
              dest_id: destination?.dest_id,
              search_type: destination?.search_type,
              city: destination?.label || cityText,
              checkIn,
              checkOut,
              adults: deriveAdultCount(effectiveUserPrefs, 1),
            },
          },
          {
            type: "view_map_hotels",
            label: "Map",
            params: {
              tripId: resultRefId,
              source: "hotels",
              city: destination?.label || cityText,
              checkIn,
              checkOut,
            },
          },
        ],
        tripId: resultRefId,
      });
    }

    if (effectiveIntent.spots || effectiveIntent.restaurants) {
      const locationText = parseSpotLocation(message) || detectedLocation || ctx.location || null;
      const modifiers = extractSpotModifiers(message);
      const nearMe =
        (message || "").toLowerCase().includes("near me") ||
        (message || "").toLowerCase().includes("nearby");
      const isRestaurantIntent = effectiveIntent.restaurants;
      const clientLat = Number(req.body?.clientLat);
      const clientLng = Number(req.body?.clientLng);

      if (!nearMe && !locationText) {
        setAssistantContext(authUser, contextId, {
          pendingIntent: isRestaurantIntent ? "restaurants" : "spots",
        });
      }

      const payload = await handlePlacesIntent({
        message,
        tripId,
        workspaceId,
        authUser,
        locationText,
        nearMe,
        isRestaurantIntent,
        queryOverride: null,
        modifiersOverride: modifiers,
        clientLat,
        clientLng,
        logger: req.log,
      });
      if (locationText) {
        setAssistantContext(authUser, contextId, {
          pendingIntent: null,
          lastIntent: isRestaurantIntent ? "restaurants" : "spots",
          location: locationText,
          lastPlaces: {
            category: isRestaurantIntent ? "restaurants" : "spots",
            location: locationText,
            openNow: Boolean(modifiers?.openNow),
          },
        });
      }
      return reply.send(payload);
    }

    if (effectiveIntent.activities) {
      const locationText = parseActivityLocation(message) || detectedLocation || ctx.location || null;
      const nearMe =
        (message || "").toLowerCase().includes("near me") ||
        (message || "").toLowerCase().includes("nearby");
      const clientLat = Number(req.body?.clientLat);
      const clientLng = Number(req.body?.clientLng);
      const explicitBookable = messageWantsBookableActivities(message);

      if (!explicitBookable) {
        if (!locationText && !nearMe) {
          setAssistantContext(authUser, contextId, { pendingIntent: "activities" });
        }
        const payload = await handlePlacesIntent({
          message,
          tripId,
          workspaceId,
          authUser,
          locationText,
          nearMe,
          isRestaurantIntent: false,
          queryOverride: stripLocationAndVerbs(message) || "things to do",
          modifiersOverride: extractSpotModifiers(message),
          clientLat,
          clientLng,
          logger: req.log,
        });
        if (locationText) {
          setAssistantContext(authUser, contextId, {
            pendingIntent: null,
            lastIntent: "activities",
            location: locationText,
          });
        }
        if (typeof payload?.assistantMessage === "string") {
          payload.assistantMessage = payload.assistantMessage.replace(/spots/g, "things to do");
        }
        return reply.send(payload);
      }

      if (!locationText) {
        setAssistantContext(authUser, contextId, { pendingIntent: "activities" });
        return reply.send({
          assistantMessage: "Which city should I use for attractions?",
        });
      }

      let resolvedTripId = tripId || null;
      if (tripId) {
        const { data, error } = await supabaseAdmin
          .from("trips")
          .select("id")
          .eq("id", tripId)
          .eq("user_id", authUser.id)
          .single();
        if (error || !data?.id) resolvedTripId = null;
      }

      const resultRefId = resolvedTripId || workspaceId || null;

      let location;
      let normalized;
      try {
        location = await resolveAttractionLocation(locationText);
        if (!location?.id) {
          return reply.send({
            assistantMessage: `I couldn't find attractions for "${locationText}". Try another city.`,
          });
        }

        const searchData = await searchAttractions({
          id: location.id,
          page: 1,
          currency_code: "USD",
          languagecode: "en-us",
          sortBy: "trending",
        });
        normalized = normalizeAttractions(searchData);
      } catch (err) {
        if (err?.status === 429) {
          return reply.send({
            assistantMessage:
              "The experiences provider is rate-limiting right now. Please try again in a minute.",
          });
        }
        const messageText = err?.message ?? String(err);
        return reply.code(500).send({ error: messageText });
      }

      const cards = (normalized?.products || []).slice(0, 5).map((product) => ({
        providerId: product.id,
        name: product.name,
        locationLabel: product.location?.city || location?.label || locationText,
        rating: product.rating?.average ?? null,
        reviewCount: product.rating?.allReviewsCount ?? null,
        price: product.price?.publicAmount ?? product.price?.amount ?? null,
        currency: product.price?.currency || "USD",
        imageUrl: product.image || null,
        lat: product.location?.lat ?? null,
        lng: product.location?.lng ?? null,
        raw: product,
      }));

      const displayLocation = location?.label || locationText;
      if (displayLocation) {
        setAssistantContext(authUser, contextId, {
          pendingIntent: null,
          lastIntent: "activities",
          location: displayLocation,
        });
      }
      return reply.send({
        assistantMessage: cards.length
          ? `Here are some experiences in ${displayLocation}.`
          : `I couldn't find experiences in ${displayLocation} right now.`,
        cards,
        actions: [
          {
            type: "view_all_activities",
            label: "View all",
            params: {
              tripId: resultRefId,
              locationId: location?.id,
              locationLabel: displayLocation,
              city: location?.city || locationText,
              sortBy: "trending",
              currency_code: "USD",
            },
          },
          {
            type: "view_map_activities",
            label: "Map",
            params: {
              tripId: resultRefId,
              source: "experiences",
              locationId: location?.id,
              locationLabel: displayLocation,
              city: location?.city || locationText,
            },
          },
        ],
        tripId: resultRefId,
      });
    }

    const initialParsed = parseRoute(message);
    const hasFlightContext = Boolean(ctx?.lastFlight?.fromText && ctx?.lastFlight?.toText);
    const flightFollowupIntent =
      !initialParsed &&
      messageMentionsFlightAdjustment(message) &&
      (ctx?.lastIntent === "flights" || ctx?.pendingIntent === "flights" || hasFlightContext);
    let parsed = initialParsed;
    if (!parsed && flightFollowupIntent && ctx?.lastFlight?.fromText && ctx?.lastFlight?.toText) {
      parsed = { fromText: ctx.lastFlight.fromText, toText: ctx.lastFlight.toText };
      const toOnly = parseFlightDestinationOnly(message);
      if (toOnly) parsed.toText = toOnly;
    }
    if (!parsed && ctx?.travelMode === "drive") {
      return reply.send({
        assistantMessage:
          "Got it — driving. Want hotels, restaurants, or things to do in your destination?",
      });
    }
    if (!effectiveIntent.flights && !parsed && !flightFollowupIntent) {
      const llm = await classifyAssistantIntent(contextualMessage);
      if (llm && llm.confidence >= 0.65) {
        if (llm.intent === "trip_plan") {
          const result = await buildTripPlanFromPrompt({
            promptText: message,
            tripId,
            authUser,
            overrides: {
              destinationLabel: llm.location || undefined,
              clientLat,
              clientLng,
              threadId: contextId,
              existingDraft,
            },
          });
          if (result?.draft) await persistTripDraft(authUser, contextId, result.draft);
          setAssistantContext(authUser, contextId, {
            pendingIntent: result?.error === "missing_dates" || result?.error === "missing_destination"
              ? "trip_plan"
              : null,
          });
          if (result?.assistantResponse) {
            return reply.send(result.assistantResponse);
          }
          if (result?.assistantMessage) {
            return reply.send({
              assistantMessage: result.assistantMessage,
              planId: result.plan?.id,
              tripId: result.tripId,
              thread_id: contextId,
            });
          }
        }

        if (llm.intent === "spots" || llm.intent === "restaurants") {
          const clientLat = Number(req.body?.clientLat);
          const clientLng = Number(req.body?.clientLng);
          const payload = await handlePlacesIntent({
            message,
            tripId,
            workspaceId,
            authUser,
            locationText: llm.location || null,
            nearMe: !!llm.nearMe,
            isRestaurantIntent: llm.intent === "restaurants",
            queryOverride: llm.query || null,
            modifiersOverride: {
              openNow: !!llm.openNow,
              lateNight: !!llm.lateNight,
              rank: llm.rank || "popularity",
              radiusMeters: llm.radiusKm ? Math.round(llm.radiusKm * 1000) : undefined,
            },
            clientLat,
            clientLng,
            logger: req.log,
          });
          setAssistantContext(authUser, contextId, {
            pendingIntent: null,
            lastIntent: llm.intent,
            location: llm.location || ctx.location || null,
            lastPlaces: {
              category: llm.intent === "restaurants" ? "restaurants" : "spots",
              location: llm.location || ctx.location || null,
              openNow: Boolean(llm.openNow),
            },
          });
          return reply.send(payload);
        }

        if (llm.intent === "hotels" && (llm.location || ctx.location) && llm.confidence >= 0.65) {
          setAssistantContext(authUser, contextId, {
            pendingIntent: "hotels",
            location: llm.location || ctx.location || null,
          });
        }

        if (llm.intent === "chat") {
          return reply.send({
            assistantMessage:
              llm.response ||
              "Hey! I can help with flights, hotels, experiences, restaurants, or spots. What are you thinking?",
          });
        }

        return reply.send({
          assistantMessage:
            llm.response ||
            "I can help with flights, hotels, experiences, or restaurants. What should I look up?",
        });
      }

      return reply.send({
        assistantMessage:
          llm?.response ||
          "Hey! Tell me what you want to do — flights, hotels, experiences, restaurants, or spots.",
      });
    }

    if (!parsed) parsed = parseRoute(message);
    if (!parsed && hasFlightContext) {
      parsed = { fromText: ctx.lastFlight.fromText, toText: ctx.lastFlight.toText };
      const toOnly = parseFlightDestinationOnly(message);
      if (toOnly) parsed.toText = toOnly;
    }
    if (!parsed?.fromText || !parsed?.toText) {
      setAssistantContext(authUser, contextId, { pendingIntent: "flights" });
      return reply.send({ assistantMessage: "From where to where?" });
    }

    let fromLoc;
    let toLoc;
    try {
      [fromLoc, toLoc] = await Promise.all([
        resolveIataCode(parsed.fromText),
        resolveIataCode(parsed.toText),
      ]);
    } catch (err) {
      const messageText = err?.message ?? String(err);
      return reply.code(500).send({ error: messageText });
    }

    if (!fromLoc?.id || !toLoc?.id) {
      setAssistantContext(authUser, contextId, { pendingIntent: "flights" });
      return reply.send({ assistantMessage: "From where to where?" });
    }

    const parsedTimeWindow = getTimeWindow(message);
    const timeWindow =
      parsedTimeWindow !== "any"
        ? parsedTimeWindow
        : ctx?.lastIntent === "flights" && ctx?.lastFlight?.timeWindow
          ? ctx.lastFlight.timeWindow
          : "any";
    const wantsRoundTrip = messageWantsRoundTrip(message);
    const wantsOneWay = messageWantsOneWay(message);
    let departDate;
    let returnDate;
    const parsedDatesFromMessage = parseDateRangeFromText(message);
    let resolvedTripId = tripId || null;

    if (parsedDatesFromMessage?.startDate) {
      departDate = parsedDatesFromMessage.startDate;
      returnDate = wantsRoundTrip
        ? parsedDatesFromMessage.endDate ||
          toDateString(addDays(new Date(parsedDatesFromMessage.startDate), 3))
        : null;
    } else if (ctx?.lastIntent === "flights" && ctx?.lastFlight?.departDate) {
      departDate = ctx.lastFlight.departDate;
      returnDate = ctx.lastFlight.returnDate || null;
      if (wantsRoundTrip && !returnDate) {
        returnDate = toDateString(addDays(new Date(departDate), 3));
      }
      if (wantsOneWay) {
        returnDate = null;
      }
    } else if (tripId) {
      const { data, error } = await supabaseAdmin
        .from("trips")
        .select("start_date,end_date")
        .eq("id", tripId)
        .single();

      if (!error && data) {
        departDate = data.start_date;
        returnDate = wantsRoundTrip ? data.end_date : null;
      } else {
        resolvedTripId = null;
      }
    }

    if (!departDate) {
      const fallback = nextDefaultDateRange();
      departDate = fallback.startDate;
      returnDate = wantsRoundTrip ? fallback.endDate : null;
    }
    const resultRefId = resolvedTripId || workspaceId || null;

    let response;
    try {
      const cacheKey = `chatFlights:${fromLoc.id}:${toLoc.id}:${departDate}:${returnDate || "oneway"}`;
      const cached = cacheGet(cacheKey);
      if (cached) {
        response = cached;
      } else {
        response = await searchFlights({
          fromId: fromLoc.id,
          toId: toLoc.id,
          departDate,
          returnDate,
          adults: deriveAdultCount(effectiveUserPrefs, 1),
          currencyCode: "USD",
        });
        cacheSet(cacheKey, response, 1000 * 60 * 10);
      }
    } catch (err) {
      if (err?.status === 429) {
        return reply.send({
          assistantMessage:
            "The flight provider is rate-limiting requests right now. Please try again in a minute.",
        });
      }
      const messageText = err?.message ?? String(err);
      return reply.code(500).send({ error: messageText });
    }

    const offers = Array.isArray(response?.flightOffers)
      ? response.flightOffers
      : Array.isArray(response?.offers)
        ? response.offers
        : Array.isArray(response?.results)
          ? response.results
          : [];
    const timeMatched = offers.filter((offer) => {
      const firstSegment =
        offer?.segments?.[0] ||
        offer?.legs?.[0]?.segments?.[0] ||
        offer?.itinerary?.segments?.[0];
      const departAt =
        firstSegment?.departure?.at || firstSegment?.departureTime || null;
      return getDepartureTimeWindowOk(departAt, timeWindow);
    });
    const hadTimeWindow = timeWindow && timeWindow !== "any";
    const fallbackToUnfiltered = hadTimeWindow && offers.length > 0 && timeMatched.length === 0;
    const filtered = fallbackToUnfiltered ? offers : timeMatched;

    const previewCards = filtered.slice(0, 5).map((offer, index) => {
      const segments =
        offer?.segments ||
        offer?.legs?.[0]?.segments ||
        offer?.itinerary?.segments ||
        [];
      const firstSegment = segments[0] || {};
      const lastSegment = segments[segments.length - 1] || {};
      const airline =
        offer?.segments?.[0]?.legs?.[0]?.carriersData?.[0]?.code ||
        offer?.segments?.[0]?.legs?.[0]?.carriersData?.[0]?.name ||
        offer?.carriers?.[0]?.code ||
        firstSegment?.carrierCode ||
        firstSegment?.marketingCarrier?.code ||
        null;
      const airlineName =
        offer?.segments?.[0]?.legs?.[0]?.carriersData?.[0]?.name ||
        offer?.carriers?.[0]?.name ||
        null;
      const airlineLogoUrl =
        offer?.segments?.[0]?.legs?.[0]?.carriersData?.[0]?.logo ||
        offer?.carriers?.[0]?.logo ||
        null;
      const allLegs = segments.flatMap((segment) =>
        Array.isArray(segment?.legs) ? segment.legs : []
      );
      const priceObj =
        offer?.priceBreakdown?.total ||
        offer?.price?.total ||
        offer?.price?.grandTotal ||
        offer?.price?.amount ||
        offer?.totalPrice ||
        offer?.total;
      const departAt = firstSegment?.departure?.at || firstSegment?.departureTime || null;
      const arriveAt = lastSegment?.arrival?.at || lastSegment?.arrivalTime || null;
      const segmentDurationSum = segments
        .map((segment) => parseDurationSec(segment?.totalTime) || parseDurationSec(segment?.duration))
        .filter((value) => Number.isFinite(value))
        .reduce((sum, value) => sum + value, 0);
      const legDurationSum = allLegs
        .map((leg) => parseDurationSec(leg?.totalTime) || parseDurationSec(leg?.duration))
        .filter((value) => Number.isFinite(value))
        .reduce((sum, value) => sum + value, 0);
      const durationSec =
        parseDurationSec(offer?.totalTime) ||
        parseDurationSec(offer?.duration) ||
        parseDurationSec(firstSegment?.duration) ||
        (segmentDurationSum > 0 ? segmentDurationSum : null) ||
        (legDurationSum > 0 ? legDurationSum : null) ||
        parseDurationSec(offer?.totalDuration) ||
        diffSecondsFromTimes(departAt, arriveAt);
      const price = moneyToNumber(priceObj) || moneyToNumber(offer?.price);

      return {
        providerId: offer?.token || offer?.id || `${fromLoc.id}-${toLoc.id}-${index}`,
        token: offer?.token || offer?.id || null,
        from: fromLoc.code || fromLoc.label,
        to: toLoc.code || toLoc.label,
        departAt,
        arriveAt,
        durationSec,
        stops:
          typeof offer?.stops === "number"
            ? offer.stops
            : Math.max((allLegs.length || 1) - 1, 0),
        price,
        currency:
          priceObj?.currencyCode ||
          priceObj?.currency ||
          offer?.price?.currencyCode ||
          offer?.price?.currency ||
          offer?.currency ||
          "USD",
        airline: airlineName || airline,
        airlineLogoUrl,
      };
    });

    const assistantMessage = previewCards.length
      ? fallbackToUnfiltered
        ? `I couldn't find exact ${timeWindow.replace("_", " ")} departures, but here are the best available ${fromLoc.code || fromLoc.label} → ${toLoc.code || toLoc.label} options.`
        : `Here are a few ${fromLoc.code || fromLoc.label} → ${toLoc.code || toLoc.label} options.`
      : `I couldn't find flights from ${fromLoc.code || fromLoc.label} to ${toLoc.code || toLoc.label}.`;

    setAssistantContext(authUser, contextId, {
      pendingIntent: null,
      lastIntent: "flights",
      location: parsed?.toText || ctx.location || null,
      lastFlight: {
        fromText: parsed?.fromText || null,
        toText: parsed?.toText || null,
        fromId: fromLoc.id || null,
        toId: toLoc.id || null,
        fromLabel: fromLoc.code || fromLoc.label || null,
        toLabel: toLoc.code || toLoc.label || null,
        departDate,
        returnDate: returnDate || null,
        timeWindow,
      },
    });
    return reply.send({
      assistantMessage,
      cards: previewCards,
      actions: [
        {
          type: "view_all_flights",
          label: "View all",
          params: {
            tripId: resultRefId,
            fromId: fromLoc.id,
            toId: toLoc.id,
            fromLabel: fromLoc.code || fromLoc.label,
            toLabel: toLoc.code || toLoc.label,
            departDate,
            returnDate,
            timeWindow,
          },
        },
      ],
      tripId: resultRefId,
    });
  });
}
