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

const HOTEL_KEYWORDS = ["hotel", "hotels", "stay", "stays", "accommodation", "lodging"];
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

function messageMentionsHotels(message) {
  const text = (message || "").toLowerCase();
  return HOTEL_KEYWORDS.some((kw) => text.includes(kw));
}

function messageMentionsActivities(message) {
  const text = (message || "").toLowerCase();
  return ACTIVITY_KEYWORDS.some((kw) => text.includes(kw));
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
  return cleaned;
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

function parseRoute(message) {
  const text = (message || "").toLowerCase();
  const fromToMatch = text.match(/from\s+(.+?)\s+to\s+(.+)/i);
  if (fromToMatch) {
    return {
      fromText: sanitizeLocationText(fromToMatch[1].trim()),
      toText: sanitizeLocationText(fromToMatch[2].trim()),
    };
  }

  const simpleMatch = text.match(/([a-z\s]+?)\s+to\s+([a-z\s]+)/i);
  if (simpleMatch) {
    return {
      fromText: sanitizeLocationText(simpleMatch[1].trim()),
      toText: sanitizeLocationText(simpleMatch[2].trim()),
    };
  }

  return null;
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

function parseHotelCity(message) {
  const text = (message || "").toLowerCase();
  const inMatch = text.match(/(?:hotel|hotels|stay|stays|accommodation|lodging)\s+in\s+(.+)/i);
  if (inMatch) return sanitizeLocationText(inMatch[1]);
  const atMatch = text.match(/(?:hotel|hotels|stay|stays|accommodation|lodging)\s+at\s+(.+)/i);
  if (atMatch) return sanitizeLocationText(atMatch[1]);
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
    if (match?.[1]) return sanitizeLocationText(match[1]);
  }

  const generic = text.match(/\b(?:in|at|near)\s+([a-z\s'-]{2,})$/i);
  if (generic?.[1] && messageMentionsActivities(message)) {
    return sanitizeLocationText(generic[1]);
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

  const keywordTail = text.match(
    /\b(?:cafe|cafes|coffee|library|gym|restaurant|restaurants|bar|bars|park|parks|atm|pharmacy|drugstore|gas|gas station|grocery|supermarket|laundry|laundromat|museum|mall|shopping|bookstore|bakery|convenience store|hardware|electronics|clothing|shoe|furniture|department store|liquor|pet store|vet|salon|barber|spa|post office|parking|car wash|car repair|car rental|movie|theater|night club)\s+([a-z\s'-]{2,})$/i
  );
  if (keywordTail?.[1]) return sanitizeLocationText(keywordTail[1]);

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
  const typeHints = inferSpotTypes(message, {
    defaultType: isRestaurantIntent ? "restaurant" : "cafe",
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

  if (!resolvedTripId && locationText) {
    const startDate = toDateString(addDays(new Date(), 30));
    const endDate = toDateString(addDays(new Date(startDate), 3));

    try {
      const created = await createQuickTrip({
        userId: authUser.id,
        primaryLocationName: locationText,
        startDate,
        endDate,
        title: `${locationText} • ${startDate}–${endDate}`,
      });
      resolvedTripId = created?.id || null;
    } catch (err) {
      resolvedTripId = null;
    }
  }

  const hasClientLocation =
    Number.isFinite(clientLat) &&
    Number.isFinite(clientLng) &&
    !(clientLat === 0 && clientLng === 0);

  const resolved = await resolveSpotCenter({
    locationText: nearMe ? null : locationText,
    clientLat: hasClientLocation ? clientLat : null,
    clientLng: hasClientLocation ? clientLng : null,
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
  const useTextSearch = hasOverrideQuery || modifiers.lateNight || !typeHints.length;
  const q = hasOverrideQuery ? String(queryOverride).trim() : useTextSearch ? stripLocationAndVerbs(message) : null;
  const categoryLabel = isRestaurantIntent ? "restaurants" : "spots";

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
      ? `Here are some ${isRestaurantIntent ? "restaurants" : "spots"} in ${resolved.label || locationText}.`
      : `I couldn't find ${isRestaurantIntent ? "restaurants" : "spots"} in ${resolved.label || locationText} right now.`,
    cards,
    actions: [
      {
        type: "view_all_spots",
        label: "View all",
        params: {
          tripId: resolvedTripId,
          tab: isRestaurantIntent ? "restaurant" : "spots",
          category: categoryLabel,
          label: resolved.label || locationText || "Spots",
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
          tripId: resolvedTripId,
          source: "spots",
        },
      },
    ],
    toolResult: {
      type: "places_results",
      center: {
        lat: resolved.lat,
        lng: resolved.lng,
        label: resolved.label || locationText || "Current location",
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
    tripId: resolvedTripId,
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
    })
    .select("id,start_date,end_date")
    .single();

  if (error) throw error;
  return data;
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
  if (typeof value === "number" && Number.isFinite(value)) return value;
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
  return Number.isFinite(plain) ? plain : null;
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

  if (!startDate || !endDate) {
    return {
      error: "missing_dates",
      assistantMessage: "What dates should I plan for?",
    };
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
    const created = await createQuickTrip({
      userId: authUser.id,
      primaryLocationName: resolvedDestination,
      startDate,
      endDate,
      title: `${resolvedDestination} • ${startDate}–${endDate}`,
    });
    resolvedTripId = created?.id || null;
  }

  const center = await resolveSpotCenter({
    locationText: resolvedDestination,
    clientLat: null,
    clientLng: null,
  });
  const outlineDays = Array.isArray(outline?.days) ? outline.days.slice(0, dayCount) : [];
  if (!outlineDays.length) {
    outlineDays.push({
      label: null,
      theme: null,
      items: [
        {
          type: "note",
          title: `Explore ${resolvedDestination}`,
          timeOfDay: null,
          query: null,
          sourcePreference: null,
        },
      ],
    });
  }

  const needAttractions = !overrides?.userPrefs?.roadTrip;
  const needHotel = true;

  let attractionLocation = null;
  let attractionsList = [];
  let hotelResult = null;
  const attractionPromise = needAttractions
    ? (async () => {
        try {
          attractionLocation = await resolveAttractionLocation(resolvedDestination);
          if (attractionLocation?.id) {
            const searchData = await searchAttractions({
              id: attractionLocation.id,
              page: 1,
              currency_code: "USD",
              languagecode: "en-us",
              sortBy: "trending",
            });
            attractionsList = normalizeAttractions(searchData)?.products || [];
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
          if (destination?.dest_id && destination?.search_type) {
            const hotelData = await searchHotels({
              dest_id: destination.dest_id,
              search_type: destination.search_type,
              arrival_date: startDate,
              departure_date: endDate,
              adults: adultsCount,
              room_qty: 1,
              page_number: 1,
              currency_code: "USD",
              languagecode: "en-us",
            });
            const normalized = normalizeHotelsResponse(hotelData);
            hotelResult = normalized?.hotels?.[0] || null;
          }
        } catch {
          hotelResult = null;
        }
      })()
    : Promise.resolve();

  await Promise.all([attractionPromise, hotelPromise]);

  let restaurantsList = [];
  try {
    if (center?.lat && center?.lng) {
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
      const data = await placesSearchTextNew(
        {
          textQuery: "restaurants",
          maxResultCount: 12,
          locationBias: {
            circle: {
              center: { latitude: center.lat, longitude: center.lng },
              radius: 6000,
            },
          },
        },
        fieldMask
      );
      restaurantsList = normalizePlacesNearby(data?.places);
    }
  } catch {
    restaurantsList = [];
  }

  let flightPreview = null;
  const routeForFlight = parsedRouteForPlan || parseRoute(promptText);
  if (routeForFlight?.fromText && routeForFlight?.toText) {
    try {
      const [fromLoc, toLoc] = await Promise.all([
        resolveIataCode(routeForFlight.fromText),
        resolveIataCode(routeForFlight.toText),
      ]);
      if (fromLoc?.id && toLoc?.id) {
        const cacheKey = `planFlights:${fromLoc.id}:${toLoc.id}:${startDate}:${endDate}`;
        let response = cacheGet(cacheKey);
        if (!response) {
          response = await searchFlights({
            fromId: fromLoc.id,
            toId: toLoc.id,
            departDate: startDate,
            returnDate: endDate,
            adults: adultsCount,
            currencyCode: "USD",
          });
          cacheSet(cacheKey, response, 1000 * 60 * 10);
        }

        const offers = Array.isArray(response?.flightOffers)
          ? response.flightOffers
          : Array.isArray(response?.offers)
            ? response.offers
            : Array.isArray(response?.results)
              ? response.results
              : [];
        const offer = offers[0];
        if (offer) {
          const segments =
            offer?.segments ||
            offer?.legs?.[0]?.segments ||
            offer?.itinerary?.segments ||
            [];
          const firstSegment = segments[0] || {};
          const lastSegment = segments[segments.length - 1] || {};
          const returnSegments =
            offer?.itineraries?.[1]?.segments ||
            offer?.legs?.[1]?.segments ||
            [];
          const returnFirst = returnSegments[0] || {};
          const returnLast = returnSegments[returnSegments.length - 1] || {};
          const priceObj =
            offer?.price?.total ||
            offer?.price?.grandTotal ||
            offer?.price?.amount ||
            offer?.totalPrice ||
            offer?.total;
          const price =
            typeof priceObj === "number"
              ? priceObj
              : typeof priceObj?.amount === "number"
                ? priceObj.amount
                : typeof priceObj?.units === "number"
                  ? Number(priceObj.units) + Number(priceObj.nanos || 0) / 1e9
                  : null;
          flightPreview = {
            title: `Flight: ${fromLoc.code || fromLoc.label} → ${toLoc.code || toLoc.label}`,
            subtitle: `${firstSegment?.departure?.at || firstSegment?.departureTime || ""} • ${
              lastSegment?.arrival?.at || lastSegment?.arrivalTime || ""
            }`,
            price:
              price !== null
                ? { amount: price, currency: priceObj?.currencyCode || priceObj?.currency || "USD" }
                : null,
            raw: offer,
            fromId: fromLoc.id,
            toId: toLoc.id,
            fromLabel: fromLoc.code || fromLoc.label,
            toLabel: toLoc.code || toLoc.label,
            departAt: firstSegment?.departure?.at || firstSegment?.departureTime || null,
            arriveAt: lastSegment?.arrival?.at || lastSegment?.arrivalTime || null,
            returnDepartAt: returnFirst?.departure?.at || returnFirst?.departureTime || null,
            returnArriveAt: returnLast?.arrival?.at || returnLast?.arrivalTime || null,
          };
        }
      }
    } catch {
      flightPreview = null;
    }
  }

  const planDays = [];
  const usedIds = new Set();
  const usedTitles = new Set();
  const attractionPool = [...attractionsList];
  const restaurantPool = [...restaurantsList];
  const placeLookupCache = new Map();

  const addUniqueItem = (list, item) => {
    if (!item) return;
    const titleKey = normalizeTitleKey(item.title);
    const idKey = item.sourceId ? `${item.source}:${item.sourceId}` : null;
    if (idKey && usedIds.has(idKey)) return;
    if (titleKey && usedTitles.has(titleKey)) return;
    if (idKey) usedIds.add(idKey);
    if (titleKey) usedTitles.add(titleKey);
    list.push(item);
  };

  const hotelCheckinTime = 15 * 60;
  const arrivalMinutes = parseTimeToMinutes(flightPreview?.arriveAt);
  const returnDepartMinutes = parseTimeToMinutes(flightPreview?.returnDepartAt);
  const hasReturnFlight =
    Boolean(flightPreview?.returnDepartAt) || Boolean(flightPreview?.returnArriveAt);

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

  for (let i = 0; i < dayCount; i += 1) {
    const date = toDateString(addDays(new Date(startDate), i));
    const outlineDay = outlineDays[i] || outlineDays[outlineDays.length - 1] || null;
    const sections = [];

    if (i === 0 && flightPreview) {
      const arrivalItems = [];
      addUniqueItem(arrivalItems, {
        id: makePlanId(),
        type: "flight",
        kind: "arrival_flight",
        title: flightPreview.title,
        subtitle: flightPreview.subtitle,
        timeOfDay: "morning",
        source: "booking_flights",
        sourceId: null,
        lat: null,
        lng: null,
        imageUrl: null,
        price: flightPreview.price,
        rating: null,
        meta: flightPreview,
      });
      sections.push({ type: "arrival", label: "Arrive", items: arrivalItems });
    }

    if (i === 0) {
      const checkinItems = [];
      if (hotelResult?.hotelId) {
        addUniqueItem(checkinItems, {
          id: makePlanId(),
          type: "hotel",
          kind: "hotel_checkin",
          title: hotelResult.name || "Hotel check-in",
          subtitle: resolvedDestination,
          timeOfDay: "afternoon",
          source: "booking_hotels",
          sourceId: String(hotelResult.hotelId),
          lat: hotelResult.lat ?? null,
          lng: hotelResult.lng ?? null,
          imageUrl: hotelResult.imageUrl || null,
          price: hotelResult.priceTotal
            ? { amount: hotelResult.priceTotal, currency: hotelResult.currency || "USD" }
            : null,
          rating: hotelResult.reviewScore ?? null,
          meta: { checkinTime: "3:00 PM" },
        });
      } else {
        addUniqueItem(checkinItems, {
          id: makePlanId(),
          type: "note",
          kind: "hotel_checkin",
          title: `Check-in near ${resolvedDestination}`,
          subtitle: "Check-in around 3:00 PM",
          timeOfDay: "afternoon",
          source: null,
          sourceId: null,
          lat: null,
          lng: null,
          imageUrl: null,
          price: null,
          rating: null,
          meta: null,
        });
      }
      sections.push({ type: "checkin", label: "Check-in", items: checkinItems });
    }

    if (i === dayCount - 1) {
      const checkoutItems = [];
      if (hotelResult?.hotelId) {
        addUniqueItem(checkoutItems, {
          id: makePlanId(),
          type: "hotel",
          kind: "hotel_checkout",
          title: `Check-out: ${hotelResult.name || "Hotel"}`,
          subtitle: "Check-out around 11:00 AM",
          timeOfDay: "morning",
          source: "booking_hotels",
          sourceId: String(hotelResult.hotelId),
          lat: hotelResult.lat ?? null,
          lng: hotelResult.lng ?? null,
          imageUrl: hotelResult.imageUrl || null,
          price: hotelResult.priceTotal
            ? { amount: hotelResult.priceTotal, currency: hotelResult.currency || "USD" }
            : null,
          rating: hotelResult.reviewScore ?? null,
          meta: { checkoutTime: "11:00 AM" },
        });
      } else {
        addUniqueItem(checkoutItems, {
          id: makePlanId(),
          type: "note",
          kind: "hotel_checkout",
          title: "Hotel check-out",
          subtitle: "Check-out around 11:00 AM",
          timeOfDay: "morning",
          source: null,
          sourceId: null,
          lat: null,
          lng: null,
          imageUrl: null,
          price: null,
          rating: null,
          meta: null,
        });
      }
      if (checkoutItems.length) {
        sections.push({ type: "checkin", label: "Check-out", items: checkoutItems });
      }
    }

    if (i === 0 && arrivalMinutes !== null && arrivalMinutes < hotelCheckinTime) {
      const gapItems = [];
      const gapCoffee = restaurantPool.shift();
      if (gapCoffee) {
        addUniqueItem(gapItems, {
          id: makePlanId(),
          type: "place",
          kind: "gap_filler",
          title: gapCoffee.name || "Quick bite",
          subtitle: gapCoffee.address || resolvedDestination,
          timeOfDay: "midday",
          source: "google",
          sourceId: gapCoffee.placeId || null,
          lat: gapCoffee.lat ?? null,
          lng: gapCoffee.lng ?? null,
          imageUrl: gapCoffee.imageUrl || null,
          price: null,
          rating: gapCoffee.rating ?? null,
          meta: { meal: "lunch" },
        });
      }
      const gapActivity = attractionPool.shift();
      if (gapActivity) {
        addUniqueItem(gapItems, {
          id: makePlanId(),
          type: "attraction",
          kind: "gap_filler",
          title: gapActivity.name,
          subtitle: gapActivity.location?.city || resolvedDestination,
          timeOfDay: "midday",
          source: "booking_attractions",
          sourceId: gapActivity.slug || gapActivity.id || null,
          lat: gapActivity.location?.lat ?? null,
          lng: gapActivity.location?.lng ?? null,
          imageUrl: gapActivity.image || null,
          price: gapActivity.price?.publicAmount
            ? { amount: gapActivity.price.publicAmount, currency: gapActivity.price.currency }
            : null,
          rating: gapActivity.rating?.average ?? null,
          meta: { attractionId: gapActivity.id },
        });
      }
      if (gapItems.length) {
        sections.push({ type: "gap", label: "Before check-in", items: gapItems });
      }
    }

    const itineraryItems = [];
    const outlineItems = Array.isArray(outlineDay?.items) ? outlineDay.items : [];
    for (const item of outlineItems) {
      if (itineraryItems.length >= 3) break;
      const base = {
        id: makePlanId(),
        type: item?.type || "note",
        kind: "activity",
        title: item?.title || "Plan item",
        subtitle: null,
        timeOfDay: item?.timeOfDay || null,
        source: item?.sourcePreference || null,
        sourceId: null,
        lat: null,
        lng: null,
        imageUrl: null,
        price: null,
        rating: null,
        meta: null,
      };

      if (item?.type === "attraction" && attractionsList.length) {
        const match = pickTopMatchByName(attractionsList, item?.query || item?.title);
        if (match) {
          addUniqueItem(itineraryItems, {
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
            meta: { attractionId: match.id },
          });
          continue;
        }
      }

      if (item?.type === "place" || item?.type === "attraction") {
        const textQuery = item?.query || item?.title || "things to do";
        const place = await findPlaceOnce(textQuery);
        if (place?.id) {
          const photoRef = place?.photos?.[0]?.name || null;
          addUniqueItem(itineraryItems, {
            ...base,
            type: "place",
            title: place?.displayName?.text || base.title,
            subtitle:
              place?.shortFormattedAddress || place?.formattedAddress || resolvedDestination,
            source: "google",
            sourceId: place.id,
            lat: place?.location?.latitude ?? null,
            lng: place?.location?.longitude ?? null,
            imageUrl: photoRef ? buildPhotoUrl(photoRef, 500) : null,
            rating: place?.rating ?? null,
            meta: { userRatingCount: place?.userRatingCount ?? null },
          });
          continue;
        }
      }
    }

    while (itineraryItems.length < 3 && attractionPool.length) {
      const next = attractionPool.shift();
      if (!next) break;
      addUniqueItem(itineraryItems, {
        id: makePlanId(),
        type: "attraction",
        kind: "activity",
        title: next.name,
        subtitle: next.location?.city || resolvedDestination,
        timeOfDay: itineraryItems.length === 0 ? "morning" : "afternoon",
        source: "booking_attractions",
        sourceId: next.slug || next.id || null,
        lat: next.location?.lat ?? null,
        lng: next.location?.lng ?? null,
        imageUrl: next.image || null,
        price: next.price?.publicAmount
          ? { amount: next.price.publicAmount, currency: next.price.currency }
          : null,
        rating: next.rating?.average ?? null,
        meta: { attractionId: next.id },
      });
    }

    if (itineraryItems.length) {
      sections.push({ type: "itinerary", label: "Itinerary", items: itineraryItems });
    }

    const mealItems = [];
    const lunch = restaurantPool.shift();
    if (lunch) {
      addUniqueItem(mealItems, {
        id: makePlanId(),
        type: "place",
        kind: "meal_lunch",
        title: lunch.name || "Lunch",
        subtitle: lunch.address || resolvedDestination,
        timeOfDay: "midday",
        source: "google",
        sourceId: lunch.placeId || null,
        lat: lunch.lat ?? null,
        lng: lunch.lng ?? null,
        imageUrl: lunch.imageUrl || null,
        price: null,
        rating: lunch.rating ?? null,
        meta: { meal: "lunch" },
      });
    }
    const dinner = restaurantPool.shift();
    if (dinner) {
      addUniqueItem(mealItems, {
        id: makePlanId(),
        type: "place",
        kind: "meal_dinner",
        title: dinner.name || "Dinner",
        subtitle: dinner.address || resolvedDestination,
        timeOfDay: "evening",
        source: "google",
        sourceId: dinner.placeId || null,
        lat: dinner.lat ?? null,
        lng: dinner.lng ?? null,
        imageUrl: dinner.imageUrl || null,
        price: null,
        rating: dinner.rating ?? null,
        meta: { meal: "dinner" },
      });
    }
    if (mealItems.length) {
      sections.push({ type: "meals", label: "Meals", items: mealItems });
    }

    if (i === dayCount - 1 && (flightPreview || hasReturnFlight)) {
      const departItems = [];
      addUniqueItem(departItems, {
        id: makePlanId(),
        type: "flight",
        kind: "departure_flight",
        title: `Return flight: ${flightPreview.toLabel} → ${flightPreview.fromLabel}`,
        subtitle:
          `${flightPreview.returnDepartAt || flightPreview.departAt || ""} • ` +
          `${flightPreview.returnArriveAt || flightPreview.arriveAt || ""}`,
        timeOfDay: "evening",
        source: "booking_flights",
        sourceId: null,
        lat: null,
        lng: null,
        imageUrl: null,
        price: flightPreview.price,
        rating: null,
        meta: flightPreview,
      });
      sections.push({ type: "departure", label: "Departure", items: departItems });
    }

    const flatItems = sections.flatMap((section) => section.items || []);
    planDays.push({
      date,
      label: outlineDay?.label || `Day ${i + 1}`,
      theme: outlineDay?.theme || null,
      items: flatItems,
      sections,
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

  console.log("[plan] outline_ms", outlineMs, "total_ms", Date.now() - startedAt);
  return { plan, assistantMessage, tripId: resolvedTripId };
}


export async function assistantRoutes(app) {
  app.post("/plan", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const { tripId, promptText, userPrefs, startDate, endDate, destinationLabel } = req.body || {};
    if (!promptText) {
      return reply.code(400).send({ error: "promptText is required" });
    }

    const result = await buildTripPlanFromPrompt({
      promptText,
      tripId,
      authUser,
      overrides: { userPrefs, startDate, endDate, destinationLabel },
    });

    if (result?.error && result?.assistantMessage) {
      return reply.send({ assistantMessage: result.assistantMessage });
    }
    if (result?.error) {
      return reply.code(500).send({ error: result.error });
    }

    return reply.send({
      assistantMessage: result.assistantMessage,
      planId: result.plan?.id,
      tripId: result.tripId,
    });
  });

  app.post("/chat", async (req, reply) => {
    const { message, tripId, createTripPrefs: createTripPrefsRaw } = req.body || {};
    if (!message) {
      return reply.code(400).send({ error: "Missing message" });
    }

    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const ctx = getAssistantContext(authUser, tripId);
    const createTripPrefs = normalizeCreateTripPrefs(createTripPrefsRaw);
    const effectiveUserPrefs = createTripPrefs || ctx?.createTripPrefs || null;
    const detectedLocation = detectLocationInMessage(message);
    const detectedMode = detectTravelMode(message);
    if (detectedLocation) {
      setAssistantContext(authUser, tripId, { location: detectedLocation });
    }
    if (detectedMode) {
      setAssistantContext(authUser, tripId, { travelMode: detectedMode });
    }
    if (createTripPrefs) {
      setAssistantContext(authUser, tripId, { createTripPrefs });
    }

    if (ctx?.pendingPlan) {
      const parsedDates = parseDateRangeFromText(message);
      if (parsedDates?.startDate && parsedDates?.endDate) {
        const result = await buildTripPlanFromPrompt({
          promptText: ctx.pendingPlan.promptText || message,
          tripId,
          authUser,
          overrides: {
            destinationLabel: ctx.pendingPlan.destinationLabel,
            startDate: parsedDates.startDate,
            endDate: parsedDates.endDate,
            userPrefs:
              createTripPrefs ||
              ctx.pendingPlan.userPrefs ||
              ctx?.createTripPrefs ||
              undefined,
          },
        });
        setAssistantContext(authUser, tripId, { pendingPlan: null });
        if (result?.assistantMessage) {
          return reply.send({
            assistantMessage: result.assistantMessage,
            planId: result.plan?.id,
            tripId: result.tripId,
          });
        }
      }
    }

    if (createTripPrefs?.destination) {
      const result = await buildTripPlanFromPrompt({
        promptText: message,
        tripId,
        authUser,
        overrides: {
          destinationLabel: createTripPrefs.destination,
          startDate: createTripPrefs.startDate || null,
          endDate: createTripPrefs.endDate || null,
          userPrefs: createTripPrefs,
        },
      });
      if (result?.assistantMessage) {
        return reply.send({
          assistantMessage: result.assistantMessage,
          planId: result.plan?.id,
          tripId: result.tripId,
        });
      }
    }

    if (messageMentionsTripPlan(message)) {
      const result = await buildTripPlanFromPrompt({
        promptText: message,
        tripId,
        authUser,
        overrides: {
          destinationLabel: createTripPrefs?.destination || undefined,
          startDate: createTripPrefs?.startDate || null,
          endDate: createTripPrefs?.endDate || null,
          userPrefs: createTripPrefs || ctx?.createTripPrefs || undefined,
        },
      });
      if (result?.assistantMessage) {
        if (result?.error === "missing_dates" || result?.error === "missing_destination") {
          setAssistantContext(authUser, tripId, {
            pendingPlan: {
              promptText: message,
              destinationLabel: detectLocationInMessage(message) || ctx.location || null,
              userPrefs: effectiveUserPrefs,
            },
          });
        }
        return reply.send({
          assistantMessage: result.assistantMessage,
          planId: result.plan?.id,
          tripId: result.tripId,
        });
      }
    }

    if (messageMentionsHotels(message)) {
      const cityText = parseHotelCity(message) || detectedLocation || ctx.location || null;
      if (!cityText) {
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

        try {
          const created = await createQuickTrip({
            userId: authUser.id,
            primaryLocationName: cityText,
            startDate: checkIn,
            endDate: checkOut,
            title: `${cityText} • ${checkIn}–${checkOut}`,
          });
          resolvedTripId = created?.id || null;
        } catch (err) {
          return reply.code(500).send({ error: err?.message ?? "Failed to create trip" });
        }
      }

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

      return reply.send({
        assistantMessage: `Here are a few hotel options in ${destination?.label || cityText}.`,
        cards,
        actions: [
          {
            type: "view_all_hotels",
            label: "View all",
            params: {
              tripId: resolvedTripId,
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
              tripId: resolvedTripId,
              source: "hotels",
              city: destination?.label || cityText,
              checkIn,
              checkOut,
            },
          },
        ],
        tripId: resolvedTripId,
      });
    }

    if (messageMentionsSpots(message)) {
      const locationText = parseSpotLocation(message) || detectedLocation || ctx.location || null;
      const modifiers = extractSpotModifiers(message);
      const nearMe =
        (message || "").toLowerCase().includes("near me") ||
        (message || "").toLowerCase().includes("nearby");
      const isRestaurantIntent = messageMentionsRestaurants(message);
      const clientLat = Number(req.body?.clientLat);
      const clientLng = Number(req.body?.clientLng);

      const payload = await handlePlacesIntent({
        message,
        tripId,
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
      if (locationText) setAssistantContext(authUser, tripId, { location: locationText });
      return reply.send(payload);
    }

    if (messageMentionsActivities(message)) {
      const locationText = parseActivityLocation(message) || detectedLocation || ctx.location || null;
      const nearMe =
        (message || "").toLowerCase().includes("near me") ||
        (message || "").toLowerCase().includes("nearby");
      const clientLat = Number(req.body?.clientLat);
      const clientLng = Number(req.body?.clientLng);
      const explicitBookable = messageWantsBookableActivities(message);

      if (!explicitBookable) {
        const payload = await handlePlacesIntent({
          message,
          tripId,
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
        if (locationText) setAssistantContext(authUser, tripId, { location: locationText });
        if (typeof payload?.assistantMessage === "string") {
          payload.assistantMessage = payload.assistantMessage.replace(/spots/g, "things to do");
        }
        return reply.send(payload);
      }

      if (!locationText) {
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

      if (!resolvedTripId) {
        const startDate = toDateString(addDays(new Date(), 30));
        const endDate = toDateString(addDays(new Date(startDate), 3));

        try {
          const created = await createQuickTrip({
            userId: authUser.id,
            primaryLocationName: locationText,
            startDate,
            endDate,
            title: `${locationText} • ${startDate}–${endDate}`,
          });
          resolvedTripId = created?.id || null;
        } catch (err) {
          return reply.code(500).send({ error: err?.message ?? "Failed to create trip" });
        }
      }

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
      if (displayLocation) setAssistantContext(authUser, tripId, { location: displayLocation });
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
              tripId: resolvedTripId,
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
              tripId: resolvedTripId,
              source: "experiences",
              locationId: location?.id,
              locationLabel: displayLocation,
              city: location?.city || locationText,
            },
          },
        ],
        tripId: resolvedTripId,
      });
    }

    let parsed = parseRoute(message);
    if (!parsed && ctx?.travelMode === "drive") {
      return reply.send({
        assistantMessage:
          "Got it — driving. Want hotels, restaurants, or things to do in your destination?",
      });
    }
    if (!messageMentionsFlights(message) && !parsed) {
      const llm = await classifyAssistantIntent(message);
      if (llm && llm.confidence >= 0.65) {
        if (llm.intent === "trip_plan") {
          const result = await buildTripPlanFromPrompt({
            promptText: message,
            tripId,
            authUser,
            overrides: {
              destinationLabel: llm.location || undefined,
            },
          });
          if (result?.assistantMessage) {
            return reply.send({
              assistantMessage: result.assistantMessage,
              planId: result.plan?.id,
              tripId: result.tripId,
            });
          }
        }

        if (llm.intent === "spots" || llm.intent === "restaurants") {
          const clientLat = Number(req.body?.clientLat);
          const clientLng = Number(req.body?.clientLng);
          const payload = await handlePlacesIntent({
            message,
            tripId,
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
          if (llm.location) setAssistantContext(authUser, tripId, { location: llm.location });
          return reply.send(payload);
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
    if (!parsed?.fromText || !parsed?.toText) {
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
      return reply.send({ assistantMessage: "From where to where?" });
    }

    const timeWindow = getTimeWindow(message);
    let departDate;
    let returnDate;
    let resolvedTripId = tripId || null;

    if (tripId) {
      const { data, error } = await supabaseAdmin
        .from("trips")
        .select("start_date,end_date")
        .eq("id", tripId)
        .single();

      if (!error && data) {
        departDate = data.start_date;
        returnDate = data.end_date;
      } else {
        resolvedTripId = null;
      }
    }

    if (!resolvedTripId) {
      const depart = addDays(new Date(), 30);
      const ret = addDays(depart, 3);
      departDate = toDateString(depart);
      returnDate = toDateString(ret);

      try {
        const created = await createQuickTrip({
          userId: authUser.id,
          primaryLocationName: parsed?.toText || "Quick Trip",
          startDate: departDate,
          endDate: returnDate,
          title: `${parsed?.fromText || "Trip"} • ${departDate}–${returnDate}`,
        });
        resolvedTripId = created?.id || null;
      } catch (err) {
        return reply.code(500).send({ error: err?.message ?? "Failed to create trip" });
      }
    }

    let response;
    try {
      const cacheKey = `chatFlights:${fromLoc.id}:${toLoc.id}:${departDate}:${returnDate}`;
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
      const priceObj =
        offer?.price?.total ||
        offer?.price?.grandTotal ||
        offer?.price?.amount ||
        offer?.totalPrice ||
        offer?.total;
      const departAt = firstSegment?.departure?.at || firstSegment?.departureTime || null;
      const arriveAt = lastSegment?.arrival?.at || lastSegment?.arrivalTime || null;
      const durationSec =
        parseDurationSec(offer?.duration) ||
        parseDurationSec(firstSegment?.duration) ||
        parseDurationSec(offer?.totalDuration) ||
        diffSecondsFromTimes(departAt, arriveAt);
      const price = moneyToNumber(priceObj) || moneyToNumber(offer?.price);

      return {
        providerId: offer?.token || offer?.id || `${fromLoc.id}-${toLoc.id}-${index}`,
        from: fromLoc.code || fromLoc.label,
        to: toLoc.code || toLoc.label,
        departAt,
        arriveAt,
        durationSec,
        stops: Math.max(segments.length - 1, 0),
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

    return reply.send({
      assistantMessage,
      cards: previewCards,
      actions: [
        {
          type: "view_all_flights",
          label: "View all",
          params: {
            tripId: resolvedTripId,
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
      tripId: resolvedTripId,
    });
  });
}
