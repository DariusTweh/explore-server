import { rapidGet } from "../providers/rapidClient.js";
import { searchAttractionLocations } from "./attractionLocationService.js";
import { normalizeAttractionLocations } from "../utils/normalizeAttractionLocations.js";
import { normalizeAttractions } from "../utils/normalizeAttractions.js";

const JUNK_KEYWORDS = [
  "gas station",
  "petrol",
  "supermarket",
  "grocery",
  "parking",
  "car wash",
  "pharmacy",
  "mall",
  "bank",
  "atm",
];

function clean(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return clean(text).split(" ").filter(Boolean);
}

function scoreTokenOverlap(name, query) {
  const nameTokens = new Set(tokenize(name));
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;

  let score = 0;
  for (const token of queryTokens) {
    if (nameTokens.has(token)) score += 1;
  }
  if (clean(name) === clean(query)) score += 4;
  if (clean(name).startsWith(clean(query))) score += 2;
  return score;
}

function isLikelyJunk(name) {
  const text = clean(name);
  return JUNK_KEYWORDS.some((word) => text.includes(word));
}

function rankAttractionsForQuery(products, query, { allowJunk = false } = {}) {
  const queryText = String(query || "").trim();
  return (Array.isArray(products) ? products : [])
    .map((item, index) => {
      const overlap = scoreTokenOverlap(item?.name, queryText);
      const rating = Number(item?.rating?.average || 0);
      const reviews = Number(item?.rating?.total || item?.rating?.allReviewsCount || 0);
      const junkPenalty = !allowJunk && isLikelyJunk(item?.name) ? -8 : 0;
      const score = overlap * 10 + rating + Math.min(reviews / 200, 4) + junkPenalty;
      return { item, score, _idx: index };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a._idx - b._idx;
    })
    .map((row) => row.item);
}

function shouldAllowJunkFromQuery(query) {
  return /\bgas|supermarket|grocery|pharmacy|fuel|petrol\b/i.test(String(query || ""));
}

async function searchAttractionsRaw(params) {
  const response = await rapidGet("/api/v1/attraction/searchAttractions", {
    qs: { ...params },
  });

  if (response?.status === false || !response?.data) {
    const err = new Error("Attractions search failed");
    err.status = 502;
    throw err;
  }

  return response.data;
}

async function resolveDestinationLocation({ destinationHint, languagecode = "en-us" }) {
  const term = String(destinationHint || "").trim();
  if (!term) return null;

  const raw = await searchAttractionLocations({ query: term, languagecode });
  const candidates = normalizeAttractionLocations(raw, term);
  return candidates[0] || null;
}

function mapCardsFromAttractions(attractions, max = 6) {
  return (Array.isArray(attractions) ? attractions : []).slice(0, max).map((item) => ({
    type: "place",
    id: item.id,
    title: item.name,
    subtitle: [item?.location?.city, item?.location?.country].filter(Boolean).join(", ") || null,
    rating: item?.rating?.average || null,
    price: item?.price?.amount || null,
    currency: item?.price?.currency || null,
    lat: item?.location?.lat ?? null,
    lng: item?.location?.lng ?? null,
  }));
}

export async function searchAttractions(params) {
  return searchAttractionsRaw(params);
}

export async function searchAttractionsBroadDiscovery({
  destinationHint,
  languagecode = "en-us",
  currencyCode = "USD",
  limit = 8,
}) {
  const resolvedDestination = await resolveDestinationLocation({ destinationHint, languagecode });
  if (!resolvedDestination?.id) {
    return {
      mode: "destination_discovery",
      destinationHint: destinationHint || null,
      resolvedDestination: null,
      attractions: [],
      cards: [],
      notes: ["Could not resolve destination for broad discovery search."],
    };
  }

  const raw = await searchAttractionsRaw({
    id: resolvedDestination.id,
    page: 1,
    sortBy: "attr_book_score",
    currency_code: currencyCode,
    languagecode,
  });
  const normalized = normalizeAttractions(raw);
  const ranked = rankAttractionsForQuery(normalized.products, destinationHint, { allowJunk: false }).slice(0, limit);

  return {
    mode: "destination_discovery",
    destinationHint: destinationHint || null,
    resolvedDestination,
    attractions: ranked,
    cards: mapCardsFromAttractions(ranked),
    notes: ranked.length ? [] : ["No attraction results were returned for this destination."],
  };
}

export async function searchAttractionExactPoi({
  query,
  destinationHint,
  languagecode = "en-us",
  currencyCode = "USD",
  limit = 6,
}) {
  const placeQuery = String(query || "").trim();
  if (!placeQuery) {
    return {
      mode: "place_lookup",
      query: null,
      resolvedDestination: null,
      attractions: [],
      cards: [],
      notes: ["No place query provided for exact POI lookup."],
    };
  }

  const resolvedDestination = destinationHint
    ? await resolveDestinationLocation({ destinationHint, languagecode })
    : null;

  if (!resolvedDestination?.id) {
    return {
      mode: "place_lookup",
      query: placeQuery,
      resolvedDestination: null,
      attractions: [],
      cards: [],
      notes: ["Exact POI lookup requires destination context to avoid irrelevant fallback results."],
    };
  }

  const raw = await searchAttractionsRaw({
    id: resolvedDestination.id,
    page: 1,
    sortBy: "attr_book_score",
    currency_code: currencyCode,
    languagecode,
  });

  const normalized = normalizeAttractions(raw);
  const ranked = rankAttractionsForQuery(normalized.products, placeQuery, {
    allowJunk: shouldAllowJunkFromQuery(placeQuery),
  });

  const filtered = ranked.filter((item) => scoreTokenOverlap(item?.name, placeQuery) >= 1).slice(0, limit);

  return {
    mode: "place_lookup",
    query: placeQuery,
    resolvedDestination,
    attractions: filtered,
    cards: mapCardsFromAttractions(filtered),
    notes: filtered.length
      ? []
      : ["No strong exact POI match found; generic nearby businesses were intentionally excluded."],
  };
}

export async function searchAttractionsNearbyAroundPoi({
  resolvedPlace,
  destinationHint,
  languagecode = "en-us",
  currencyCode = "USD",
  limit = 8,
}) {
  const fallbackDestination = destinationHint || resolvedPlace?.city || null;
  const resolvedDestination = await resolveDestinationLocation({
    destinationHint: fallbackDestination,
    languagecode,
  });

  if (!resolvedDestination?.id) {
    return {
      mode: "nearby_search",
      resolvedPlace: resolvedPlace || null,
      resolvedDestination: null,
      attractions: [],
      cards: [],
      notes: ["Nearby search could not resolve a destination around the named place."],
    };
  }

  const raw = await searchAttractionsRaw({
    id: resolvedDestination.id,
    page: 1,
    sortBy: "attr_book_score",
    currency_code: currencyCode,
    languagecode,
  });

  const normalized = normalizeAttractions(raw);
  const nearQuery = resolvedPlace?.label || "";
  const allowJunk = shouldAllowJunkFromQuery(nearQuery);
  const ranked = rankAttractionsForQuery(normalized.products, nearQuery, { allowJunk });

  const excludedLabel = clean(resolvedPlace?.label || "");
  const nearby = ranked
    .filter((item) => clean(item?.name || "") !== excludedLabel)
    .slice(0, limit);

  return {
    mode: "nearby_search",
    resolvedPlace: resolvedPlace || null,
    resolvedDestination,
    attractions: nearby,
    cards: mapCardsFromAttractions(nearby),
    notes: nearby.length ? [] : ["No nearby results found after excluding the same named place."],
  };
}
