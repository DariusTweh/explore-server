import { searchAttractionLocations } from "../services/attractionLocationService.js";
import { normalizeAttractionLocations } from "../utils/normalizeAttractionLocations.js";
import { searchAttractions } from "../services/attractionsSearchService.js";
import { getAttractionAvailability } from "../services/attractionAvailabilityService.js";
import { getAttractionAvailabilityCalendar } from "../services/attractionAvailabilityCalendarService.js";
import { getAttractionDetails } from "../services/attractionDetailsService.js";
import { normalizeAttractions } from "../utils/normalizeAttractions.js";
import { normalizeAttractionDetails } from "../utils/normalizeAttractionDetails.js";
import { normalizeAttractionAvailability } from "../utils/normalizeAttractionAvailability.js";
import { normalizeAttractionAvailabilityCalendar } from "../utils/normalizeAttractionAvailabilityCalendar.js";
import { bookingGet } from "../utils/bookingClient.js";
import { geocodeMapbox } from "../utils/geocodeMapbox.js";
import { getCoordsFromCache, upsertCoordsCache } from "../utils/coordsCache.js";
import { upsertAttractions } from "../utils/attractionsCache.js";
import { extractAttractionCoordsFromDetails } from "../utils/extractAttractionCoordsFromDetails.js";
import { cacheGet, cacheSet } from "../utils/memoryCache.js";

const SORT_ALLOWLIST = new Set([
  "trending",
  "attr_book_score",
  "lowest_price",
  "highest_weighted_rating",
]);

function sanitizeAttractionId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!raw.includes(":")) return raw;

  // Handle legacy composite ids like "12345:city".
  const [left, right] = raw.split(":");
  if (/^\d+$/.test(left)) return left;
  if (/^\d+$/.test(right || "")) return right;
  return left || raw;
}

function isValidDateYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isValidLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat === 0 || lng === 0) return false;
  return true;
}

function normalizeCoords(value) {
  const lat = toNumber(value?.lat);
  const lng = toNumber(value?.lng);
  if (!isValidLatLng(lat, lng)) return null;
  return { lat, lng };
}

function extractStartingPointText(additionalInfo) {
  const text = String(additionalInfo || "");
  const match = text.match(/starting point\s*:\s*(.+)/i);
  return match?.[1] ? match[1].trim() : "";
}

function inferCoordSourceFromCache(cacheRow) {
  const query = String(cacheRow?.query || "");
  if (query.startsWith("DETAILS:")) return query.replace("DETAILS:", "").trim() || "details";
  if (query.startsWith("GEOCODE:") || query === "GEOCODED") return "geocoded";
  return "cache";
}

function inferCoordAddressFromCache(cacheRow) {
  if (typeof cacheRow?.raw?.address === "string" && cacheRow.raw.address.trim()) {
    return cacheRow.raw.address.trim();
  }
  const placeName = String(cacheRow?.raw?.place_name || "").trim();
  if (placeName) return placeName;
  const fallback = [cacheRow?.name, cacheRow?.city, cacheRow?.country].filter(Boolean).join(", ");
  return fallback || null;
}

function buildDetailsGeocodeQueries(detailsData, cityName, countryCode) {
  const queries = [];
  const startPoint = extractStartingPointText(detailsData?.additionalInfo);
  if (startPoint) {
    queries.push([startPoint, cityName, countryCode].filter(Boolean).join(", "));
  }
  queries.push([detailsData?.name, cityName, countryCode].filter(Boolean).join(", "));
  return [...new Set(queries.filter(Boolean))];
}

async function geocodeWithQueries({ queries, countryCode, language = "en" }) {
  let attempts = 0;
  for (const query of queries) {
    attempts += 1;
    const result = await geocodeMapbox({
      query,
      country: countryCode || undefined,
      language,
    });
    const coords = normalizeCoords(result);
    if (!coords) continue;
    return {
      ...coords,
      query,
      attempts,
      raw: result?.raw ?? null,
      place_name: result?.place_name ?? null,
    };
  }
  return { attempts, hit: null };
}

async function resolveCoordsForAttraction({
  slug,
  name,
  cityName,
  countryCode,
  currency_code,
  languagecode,
  req,
  detailsData,
}) {
  const source = "booking_attractions";
  const source_id = String(slug || "").trim();
  if (!source_id) return { coords: null, coordSource: null, coordAddress: null, detailsData: null, strategy: "miss" };

  const cached = await getCoordsFromCache({ source, source_id });
  const cachedCoords = normalizeCoords(cached);
  if (cachedCoords) {
    return {
      coords: cachedCoords,
      coordSource: inferCoordSourceFromCache(cached),
      coordAddress: inferCoordAddressFromCache(cached),
      place_id: cached?.place_id || null,
      detailsData: detailsData || null,
      strategy: "cache",
    };
  }

  let details = detailsData || null;
  if (!details) {
    try {
      details = await getAttractionDetails({
        slug: source_id,
        currency_code,
        languagecode,
      });
    } catch (err) {
      req?.log?.warn?.({ err, slug: source_id }, "Details lookup failed while resolving coords");
    }
  }

  if (details) {
    const extracted = extractAttractionCoordsFromDetails(details);
    if (extracted) {
      await upsertCoordsCache({
        source,
        source_id,
        name: details?.name || name || null,
        city: cityName || details?.ufiDetails?.bCityName || null,
        country: countryCode || details?.ufiDetails?.url?.country || null,
        lat: extracted.lat,
        lng: extracted.lng,
        place_id: extracted.place_id || null,
        query: `DETAILS:${extracted.coordSource}`,
        raw: extracted.rawChosenAddress || null,
      });
      return {
        coords: { lat: extracted.lat, lng: extracted.lng },
        coordSource: extracted.coordSource,
        coordAddress: extracted.coordAddress || null,
        place_id: extracted.place_id || null,
        detailsData: details,
        strategy: "details",
      };
    }
  }

  const geoQueries = buildDetailsGeocodeQueries(details || { name }, cityName, countryCode);
  try {
    const geocoded = await geocodeWithQueries({
      queries: geoQueries,
      countryCode,
      language: "en",
    });
    if (geocoded?.hit === null) {
      return {
        coords: null,
        coordSource: null,
        coordAddress: null,
        place_id: null,
        detailsData: details,
        strategy: "miss",
        geocodeAttempts: geocoded.attempts,
      };
    }
    if (geocoded) {
      await upsertCoordsCache({
        source,
        source_id,
        name: details?.name || name || null,
        city: cityName || details?.ufiDetails?.bCityName || null,
        country: countryCode || details?.ufiDetails?.url?.country || null,
        lat: geocoded.lat,
        lng: geocoded.lng,
        place_id: null,
        query: `GEOCODE:${geocoded.query}`,
        raw: geocoded.raw,
      });
      return {
        coords: { lat: geocoded.lat, lng: geocoded.lng },
        coordSource: "geocoded",
        coordAddress: geocoded.place_name || geocoded.query,
        place_id: null,
        detailsData: details,
        strategy: "geocoded",
        geocodeAttempts: geocoded.attempts,
      };
    }
  } catch (err) {
    req?.log?.warn?.({ err, slug: source_id }, "Mapbox geocode failed");
  }

  return {
    coords: null,
    coordSource: null,
    coordAddress: null,
    place_id: null,
    detailsData: details,
    strategy: "miss",
    geocodeAttempts: 0,
  };
}

function buildSearchParams(query) {
  const {
    id,
    startDate,
    endDate,
    sortBy,
    page = 1,
    currency_code = "USD",
    languagecode = "en-us",
    typeFilters,
    priceFilters,
    ufiFilters,
    labelFilters,
  } = query || {};

  const params = {
    id: sanitizeAttractionId(id),
    page: Number(page),
    currency_code,
    languagecode,
  };

  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  if (sortBy) params.sortBy = sortBy;
  if (typeFilters) params.typeFilters = typeFilters;
  if (priceFilters) params.priceFilters = priceFilters;
  if (ufiFilters) params.ufiFilters = ufiFilters;
  if (labelFilters) params.labelFilters = labelFilters;

  return params;
}

function validateSearchQuery(query) {
  const { id, page = 1, startDate, endDate, sortBy } = query || {};
  const trimmedId = String(id || "").trim();
  if (!trimmedId) return "id is required";

  const pageNum = Number(page);
  if (!Number.isFinite(pageNum) || pageNum < 1) return "page must be >= 1";

  if (startDate && !isValidDateYmd(startDate)) {
    return "startDate must be in yyyy-mm-dd format";
  }
  if (endDate && !isValidDateYmd(endDate)) {
    return "endDate must be in yyyy-mm-dd format";
  }
  if (sortBy && !SORT_ALLOWLIST.has(String(sortBy))) {
    return "sortBy must be one of trending, attr_book_score, lowest_price, highest_weighted_rating";
  }
  return null;
}

export async function attractionsRoutes(app) {
  app.get("/locations", async (req, reply) => {
    const { query, languagecode = "en-us", raw } = req.query || {};
    const term = String(query || "").trim();

    if (!term || term.length < 2) {
      return reply.code(400).send({ message: "query is required (min 2 chars)" });
    }

    try {
      const apiData = await searchAttractionLocations({ query: term, languagecode });
      const locations = normalizeAttractionLocations(apiData, term);
      const payload = {
        query: term,
        locations,
      };

      if (String(raw || "") === "1") {
        payload.raw = apiData;
      }

      return reply.send(payload);
    } catch (err) {
      const status = err?.status || 502;
      const message = status === 502 ? "Attraction location search failed" : err?.message;
      return reply.code(status).send({ message: message || "Attraction location search failed" });
    }
  });

  app.get("/search", async (req, reply) => {
    const validationError = validateSearchQuery(req.query || {});
    if (validationError) {
      return reply.code(400).send({ message: validationError });
    }

    const { id, raw, city, country } = req.query || {};
    const params = buildSearchParams(req.query || {});

    const cacheKey = `attractions:search:${JSON.stringify(params)}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      return reply.send(cached);
    }

    try {
      const apiResponse = await bookingGet("/api/v1/attraction/searchAttractions", {
        ...params,
        sortBy: params.sortBy || "trending",
      });
      const apiData = apiResponse?.data;
      const productsRaw = Array.isArray(apiData?.products) ? apiData.products : [];
      if (!Array.isArray(productsRaw)) {
        return reply.code(502).send({ message: "Attractions search failed" });
      }

      const ufi = productsRaw?.[0]?.ufiDetails?.ufi ?? null;
      await upsertAttractions(productsRaw, {
        source: "booking_attractions",
        ufi,
        city: city ? String(city) : undefined,
        country: country ? String(country) : undefined,
      });

      const markers = [];
      const geocodeStats = {
        totalProducts: productsRaw.length,
        cacheHits: 0,
        detailsCoords: 0,
        detailsMisses: 0,
        geocodeAttempts: 0,
        geocoded: 0,
        geocodeMisses: 0,
        markerCount: 0,
      };

      for (const p of productsRaw) {
        const productId = p?.id ?? p?.productId;
        if (productId === undefined || productId === null) continue;

        const slug = String(p?.slug || "").trim();
        if (!slug) {
          geocodeStats.detailsMisses += 1;
          continue;
        }

        const cityName = String(city || p?.ufiDetails?.bCityName || "").trim();
        const countryCode = String(country || p?.ufiDetails?.url?.country || "").trim();
        const resolved = await resolveCoordsForAttraction({
          slug,
          name: p?.name || null,
          cityName,
          countryCode,
          currency_code: params.currency_code || "USD",
          languagecode: params.languagecode || "en-us",
          req,
        });

        if (resolved.strategy === "cache") geocodeStats.cacheHits += 1;
        if (resolved.strategy === "details") geocodeStats.detailsCoords += 1;
        if (resolved.strategy === "geocoded") geocodeStats.geocoded += 1;
        geocodeStats.geocodeAttempts += Number(resolved?.geocodeAttempts || 0);
        if (resolved.strategy === "miss") {
          geocodeStats.detailsMisses += 1;
          geocodeStats.geocodeMisses += 1;
        }

        if (Number.isFinite(Number(resolved?.coords?.lat)) && Number.isFinite(Number(resolved?.coords?.lng))) {
          markers.push({
            id: String(productId),
            slug,
            name: p?.name || "Attraction",
            lat: Number(resolved.coords.lat),
            lng: Number(resolved.coords.lng),
            image: p?.primaryPhoto?.small ?? null,
            price: p?.representativePrice?.publicAmount ?? null,
            currency: p?.representativePrice?.currency ?? null,
            rating: p?.reviewsStats?.combinedNumericStats?.average ?? null,
            ratingCount: p?.reviewsStats?.combinedNumericStats?.total ?? null,
          });
        }
      }
      geocodeStats.markerCount = markers.length;

      const normalized = normalizeAttractions(apiData);
      const payload = {
        status: true,
        id: sanitizeAttractionId(id),
        ...normalized,
        markers,
        geocodeStats,
        data: {
          products: productsRaw,
          markers,
          geocodeStats,
        },
      };

      if (String(raw || "") === "1") {
        payload.raw = apiData;
      }

      cacheSet(cacheKey, payload, 1000 * 60 * 10);
      return reply.send(payload);
    } catch (err) {
      const status = err?.status || 502;
      const message = status === 502 ? "Attractions search failed" : err?.message;
      return reply.code(status).send({ message: message || "Attractions search failed" });
    }
  });

  app.get("/details", async (req, reply) => {
    const {
      slug,
      languagecode = "en-us",
      currency_code = "USD",
      city,
      country,
      raw,
    } = req.query || {};

    const safeSlug = String(slug || "").trim();
    if (!safeSlug) {
      return reply.code(400).send({ message: "slug is required" });
    }

    const cacheKey = `attractions:details:${safeSlug}:${currency_code}:${languagecode}`;
    const cached = cacheGet(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const detailsRaw = await getAttractionDetails({
        slug: safeSlug,
        languagecode,
        currency_code,
      });

      await upsertAttractions([detailsRaw], {
        source: "booking_attractions",
        ufi: detailsRaw?.ufiDetails?.ufi ?? null,
        city: city ? String(city) : undefined,
        country: country ? String(country) : undefined,
      });

      const cityName = String(city || detailsRaw?.ufiDetails?.bCityName || "").trim();
      const countryCode = String(country || detailsRaw?.ufiDetails?.url?.country || "").trim();
      const resolved = await resolveCoordsForAttraction({
        slug: safeSlug,
        name: detailsRaw?.name || null,
        cityName,
        countryCode,
        currency_code,
        languagecode,
        detailsData: detailsRaw,
        req,
      });

      const bestCoords = resolved?.coords
        ? {
            lat: Number(resolved.coords.lat),
            lng: Number(resolved.coords.lng),
            source: resolved.coordSource || null,
            addressLabel: resolved.coordAddress || null,
          }
        : null;

      const product = normalizeAttractionDetails(detailsRaw, { coords: bestCoords });
      const payload = {
        status: true,
        data: {
          product,
          bestCoords,
          mapPreview: product.mapPreview,
        },
      };

      if (String(raw || "") === "1") {
        payload.raw = detailsRaw;
      }

      cacheSet(cacheKey, payload, 1000 * 60 * 30);
      return reply.send(payload);
    } catch (err) {
      const status = err?.status || 502;
      const message = status === 502 ? "Attraction details failed" : err?.message;
      return reply.code(status).send({ message: message || "Attraction details failed" });
    }
  });

  app.get("/availability", async (req, reply) => {
    const { slug, date, currency_code = "USD", languagecode = "en-us", raw } = req.query || {};
    const safeSlug = String(slug || "").trim();
    if (!safeSlug) {
      return reply.code(400).send({ message: "slug is required" });
    }

    const cacheKey = `attractions:availability:${safeSlug}:${date || "any"}:${currency_code}:${languagecode}`;
    const cached = cacheGet(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const data = await getAttractionAvailability({
        slug: safeSlug,
        date,
        currency_code,
        languagecode,
      });
      const normalized = normalizeAttractionAvailability(data);
      const payload = {
        status: true,
        data: {
          slug: safeSlug,
          date: date || null,
          slots: normalized,
        },
      };
      if (String(raw || "") === "1") {
        payload.raw = data;
      }
      cacheSet(cacheKey, payload, 1000 * 60 * 5);
      return reply.send(payload);
    } catch (err) {
      const status = err?.status || 502;
      const message = status === 502 ? "Attraction availability failed" : err?.message;
      return reply.code(status).send({ message: message || "Attraction availability failed" });
    }
  });

  app.get("/availability-calendar", async (req, reply) => {
    const { id, languagecode = "en-us", raw } = req.query || {};
    const safeId = String(id || "").trim();
    if (!safeId) {
      return reply.code(400).send({ message: "id is required" });
    }

    const cacheKey = `attractions:availabilityCalendar:${safeId}:${languagecode}`;
    const cached = cacheGet(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const data = await getAttractionAvailabilityCalendar({ id: safeId, languagecode });
      const normalized = normalizeAttractionAvailabilityCalendar(data);
      const payload = {
        status: true,
        data: {
          id: safeId,
          calendar: normalized,
        },
      };
      if (String(raw || "") === "1") {
        payload.raw = data;
      }
      cacheSet(cacheKey, payload, 1000 * 60 * 60 * 6);
      return reply.send(payload);
    } catch (err) {
      const status = err?.status || 502;
      const message = status === 502 ? "Attraction availability calendar failed" : err?.message;
      return reply.code(status).send({ message: message || "Attraction availability calendar failed" });
    }
  });

  app.get("/filters", async (req, reply) => {
    const validationError = validateSearchQuery(req.query || {});
    if (validationError) {
      return reply.code(400).send({ message: validationError });
    }

    const { id, raw } = req.query || {};
    const params = buildSearchParams(req.query || {});

    try {
      const apiData = await searchAttractions(params);
      if (!Array.isArray(apiData?.products)) {
        return reply.code(502).send({ message: "Attractions search failed" });
      }

      const normalized = normalizeAttractions(apiData);
      const payload = {
        id: sanitizeAttractionId(id),
        sorters: normalized.sorters,
        defaultSorter: normalized.defaultSorter,
        filters: normalized.filters,
      };

      if (String(raw || "") === "1") {
        payload.raw = apiData;
      }

      return reply.send(payload);
    } catch (err) {
      const status = err?.status || 502;
      const message = status === 502 ? "Attractions search failed" : err?.message;
      return reply.code(status).send({ message: message || "Attractions search failed" });
    }
  });
}
