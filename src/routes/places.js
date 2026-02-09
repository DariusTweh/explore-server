import { supabaseAdmin } from "../utils/supabaseAdmin.js";
import { cacheGet, cacheSet } from "../utils/memoryCache.js";
import {
  placesNearbySearchNew,
  placesSearchTextNew,
  placesDetailsNew,
  placesAutocompleteNew,
  buildPhotoUrl,
} from "../utils/googlePlaces.js";

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeNearby(results) {
  const list = Array.isArray(results) ? results : [];
  return list.map((place) => {
    const lat = toNumber(place?.location?.latitude);
    const lng = toNumber(place?.location?.longitude);
    const photoRef = place?.photos?.[0]?.name || null;
    return {
      id: place?.id ? `google:${place.id}` : null,
      placeId: place?.id || null,
      name: place?.displayName?.text || null,
      lat,
      lng,
      addressShort: place?.shortFormattedAddress || place?.formattedAddress || null,
      rating: toNumber(place?.rating),
      ratingCount: toNumber(place?.userRatingCount),
      priceLevel: toNumber(place?.priceLevel),
      photoUrl: photoRef ? buildPhotoUrl(photoRef, 500) : null,
      openNow:
        typeof place?.regularOpeningHours?.openNow === "boolean"
          ? place.regularOpeningHours.openNow
          : null,
      types: Array.isArray(place?.types) ? place.types : [],
    };
  });
}

function normalizeDetails(details) {
  const place = details || {};
  const lat = toNumber(place?.location?.latitude);
  const lng = toNumber(place?.location?.longitude);
  const photoRef = place?.photos?.[0]?.name || null;

  return {
    placeId: place?.id || null,
    name: place?.displayName?.text || null,
    formattedAddress: place?.formattedAddress || null,
    lat,
    lng,
    rating: toNumber(place?.rating),
    ratingCount: toNumber(place?.userRatingCount),
    priceLevel: toNumber(place?.priceLevel),
    website: place?.website || null,
    phone: place?.internationalPhoneNumber || null,
    openingHours: place?.regularOpeningHours || null,
    photoUrls: Array.isArray(place?.photos)
      ? place.photos
          .map((p) => buildPhotoUrl(p?.name, 900))
          .filter(Boolean)
      : [],
    primaryPhoto: photoRef ? buildPhotoUrl(photoRef, 600) : null,
  };
}

const CATEGORY_TO_TYPES = {
  cafes: ["cafe", "coffee_shop"],
  coffee: ["cafe", "coffee_shop"],
  restaurants: ["restaurant"],
  bars: ["bar"],
  parks: ["park"],
  libraries: ["library"],
  gyms: ["gym"],
  groceries: ["supermarket"],
  pharmacy: ["pharmacy"],
  gas: ["gas_station"],
  atm: ["atm"],
  bank: ["bank"],
  hospital: ["hospital"],
  doctor: ["doctor"],
  dentist: ["dentist"],
  laundry: ["laundry"],
  shopping: ["shopping_mall"],
  bookstore: ["book_store"],
  bakery: ["bakery"],
  convenience: ["convenience_store"],
  hardware: ["hardware_store"],
  electronics: ["electronics_store"],
  clothing: ["clothing_store"],
  shoe: ["shoe_store"],
  furniture: ["furniture_store"],
  department: ["department_store"],
  liquor: ["liquor_store"],
  pet: ["pet_store"],
  vet: ["veterinary_care"],
  salon: ["beauty_salon"],
  barber: ["hair_care"],
  spa: ["spa"],
  postoffice: ["post_office"],
  parking: ["parking"],
  carwash: ["car_wash"],
  carrepair: ["car_repair"],
  carrental: ["car_rental"],
  movies: ["movie_theater"],
  museum: ["museum"],
  nightclub: ["night_club"],
};

async function safeUpsert(table, rows, opts) {
  try {
    if (!rows || (Array.isArray(rows) && rows.length === 0)) return;
    const { error } = await supabaseAdmin.from(table).upsert(rows, opts);
    if (error) throw error;
  } catch (err) {
    console.warn(`[places] cache upsert failed: ${table}`, err?.message ?? String(err));
  }
}

async function safeInsert(table, row) {
  try {
    const { error } = await supabaseAdmin.from(table).insert(row);
    if (error) throw error;
  } catch (err) {
    console.warn(`[places] cache insert failed: ${table}`, err?.message ?? String(err));
  }
}

export async function placesRoutes(app) {
  app.get("/search", async (req, reply) => {
    const {
      lat,
      lng,
      radius = 3000,
      q,
      category,
      subcategory,
      types,
      openNow,
      lateNight,
      max = 20,
      rank = "popularity",
      languageCode,
      regionCode,
    } = req.query || {};

    if (!lat || !lng) {
      return reply.code(400).send({ message: "lat and lng are required" });
    }

    const cacheKey = `places:search:${JSON.stringify({
      lat,
      lng,
      radius,
      q,
      category,
      subcategory,
      types,
      openNow,
      lateNight,
      max,
      rank,
      languageCode,
      regionCode,
    })}`;
    const cached = cacheGet(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const safeRadius = Math.max(500, Math.min(10000, Number(radius) || 3000));
      const maxResultCount = Math.max(1, Math.min(30, Number(max) || 20));

      const requestedTypes = String(types || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const mappedTypes =
        requestedTypes.length > 0
          ? requestedTypes
          : CATEGORY_TO_TYPES[String(subcategory || category || "").toLowerCase()] || [];

      const rankPreference =
        String(rank || "popularity").toLowerCase() === "distance" ? "DISTANCE" : "POPULARITY";

      const fieldMask = [
        "places.id",
        "places.displayName",
        "places.location",
        "places.formattedAddress",
        "places.shortFormattedAddress",
        "places.types",
        "places.rating",
        "places.userRatingCount",
        "places.priceLevel",
        "places.photos",
        "places.regularOpeningHours",
      ].join(",");

      let data;
      let searchMode = "nearby";

      const hasText = String(q || "").trim().length > 0 || lateNight;
      if (hasText) {
        searchMode = "text";
        const textQuery = String(q || "").trim() || String(category || subcategory || "").trim();
        const lateNightHint = lateNight ? " late night 24 hours" : "";
        const query = `${textQuery}${lateNightHint}`.trim();

        const body = {
          textQuery: query,
          maxResultCount,
          rankPreference: rankPreference === "DISTANCE" ? "DISTANCE" : "RELEVANCE",
          locationBias: {
            circle: {
              center: { latitude: Number(lat), longitude: Number(lng) },
              radius: safeRadius,
            },
          },
        };
        if (mappedTypes.length === 1) body.includedType = mappedTypes[0];
        if (languageCode) body.languageCode = String(languageCode);
        if (regionCode) body.regionCode = String(regionCode);
        if (openNow) body.openNow = true;

        data = await placesSearchTextNew(body, fieldMask);
      } else {
        const body = {
          locationRestriction: {
            circle: {
              center: { latitude: Number(lat), longitude: Number(lng) },
              radius: safeRadius,
            },
          },
          includedTypes: mappedTypes.length ? mappedTypes : ["cafe"],
          maxResultCount,
          rankPreference,
        };
        if (languageCode) body.languageCode = String(languageCode);
        if (regionCode) body.regionCode = String(regionCode);
        if (openNow) body.openNow = true;

        data = await placesNearbySearchNew(body, fieldMask);
      }

      const normalized = normalizeNearby(data?.places || data?.results);
      const payload = {
        status: true,
        data: normalized,
        meta: {
          searchMode,
          rankPreference,
          types: mappedTypes,
          maxResultCount,
          lateNight: !!lateNight,
          openNow: !!openNow,
        },
      };

      cacheSet(cacheKey, payload, 1000 * 60 * 10);

      const now = Date.now();
      await safeUpsert(
        "places_cache",
        normalized.map((p) => ({
          place_id: p.placeId,
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          address_short: p.addressShort,
          rating: p.rating,
          rating_count: p.ratingCount,
          price_level: p.priceLevel,
          photo_url: p.photoUrl,
          open_now: p.openNow,
          types: p.types,
          fetched_at: new Date(now).toISOString(),
          expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
          raw: null,
        })),
        { onConflict: "place_id" }
      );

      await safeUpsert(
        "place_coords_cache",
        normalized
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
          .map((p) => ({
            source: "google",
            source_id: p.placeId,
            name: p.name,
            lat: p.lat,
            lng: p.lng,
            place_id: p.placeId,
            query: searchMode.toUpperCase(),
            raw: p,
          })),
        { onConflict: "source,source_id" }
      );

      await safeInsert("search_cache_log", {
        source: searchMode === "text" ? "google_places_search_text" : "google_places_nearby_new",
        query: JSON.stringify({
          lat,
          lng,
          radius: safeRadius,
          q,
          category,
          subcategory,
          types: mappedTypes,
          openNow,
          lateNight,
          max: maxResultCount,
          rank,
          languageCode,
          regionCode,
        }),
        created_at: new Date().toISOString(),
      });

      return reply.send(payload);
    } catch (err) {
      const status = err?.status || 502;
      const message = status === 502 ? "Places search failed" : err?.message;
      return reply.code(status).send({ message: message || "Places search failed" });
    }
  });

  app.get("/nearby", async (req, reply) => {
    const {
      lat,
      lng,
      radius = 1500,
      type,
      keyword,
      openNow,
      types,
      max = 20,
      rank = "popularity",
      languageCode,
      regionCode,
    } = req.query || {};

    if (!lat || !lng) {
      return reply.code(400).send({ message: "lat and lng are required" });
    }

    const cacheKey = `places:nearby:${JSON.stringify({
      lat,
      lng,
      radius,
      type,
      types,
      keyword,
      openNow,
      max,
      rank,
      languageCode,
      regionCode,
    })}`;
    const cached = cacheGet(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const safeRadius = Math.max(500, Math.min(5000, Number(radius) || 1500));
      const maxResultCount = Math.max(1, Math.min(30, Number(max) || 20));
      const includedTypes = String(types || type || "cafe")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const body = {
        locationRestriction: {
          circle: {
            center: {
              latitude: Number(lat),
              longitude: Number(lng),
            },
            radius: safeRadius,
          },
        },
        includedTypes,
        maxResultCount,
        rankPreference: String(rank || "popularity").toLowerCase() === "distance"
          ? "DISTANCE"
          : "POPULARITY",
      };
      if (languageCode) body.languageCode = String(languageCode);
      if (regionCode) body.regionCode = String(regionCode);
      if (openNow) body.openNow = true;

      const fieldMask = [
        "places.id",
        "places.displayName",
        "places.location",
        "places.formattedAddress",
        "places.shortFormattedAddress",
        "places.types",
        "places.rating",
        "places.userRatingCount",
        "places.priceLevel",
        "places.photos",
        "places.regularOpeningHours",
      ].join(",");

      const data = await placesNearbySearchNew(body, fieldMask);

      const normalized = normalizeNearby(data?.places || data?.results);
      const payload = { status: true, data: normalized };

      cacheSet(cacheKey, payload, 1000 * 60 * 10);

      const now = Date.now();
      await safeUpsert(
        "places_cache",
        normalized.map((p) => ({
          place_id: p.placeId,
          name: p.name,
          lat: p.lat,
          lng: p.lng,
          address_short: p.addressShort,
          rating: p.rating,
          rating_count: p.ratingCount,
          price_level: p.priceLevel,
          photo_url: p.photoUrl,
          open_now: p.openNow,
          types: p.types,
          fetched_at: new Date(now).toISOString(),
          expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
          raw: null,
        })),
        { onConflict: "place_id" }
      );

      await safeUpsert(
        "place_coords_cache",
        normalized
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
          .map((p) => ({
            source: "google",
            source_id: p.placeId,
            name: p.name,
            lat: p.lat,
            lng: p.lng,
            place_id: p.placeId,
            query: "NEARBY",
            raw: p,
          })),
        { onConflict: "source,source_id" }
      );

      await safeInsert("search_cache_log", {
        source: "google_places_nearby_new",
        query: JSON.stringify({
          lat,
          lng,
          radius: safeRadius,
          types: includedTypes,
          keyword,
          openNow,
          max: maxResultCount,
          rank,
          languageCode,
          regionCode,
        }),
        created_at: new Date().toISOString(),
      });

      return reply.send(payload);
    } catch (err) {
      const status = err?.status || 502;
      const message = status === 502 ? "Places nearby search failed" : err?.message;
      return reply.code(status).send({ message: message || "Places nearby search failed" });
    }
  });

  app.get("/details", async (req, reply) => {
    const { placeId } = req.query || {};
    const safeId = String(placeId || "").trim();
    if (!safeId) {
      return reply.code(400).send({ message: "placeId is required" });
    }

    const cacheKey = `places:details:${safeId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const baseFields = [
        "id",
        "displayName",
        "formattedAddress",
        "location",
        "regularOpeningHours",
        "website",
        "internationalPhoneNumber",
        "photos",
        "rating",
        "userRatingCount",
        "priceLevel",
      ];
      let fieldMask = baseFields.join(",");
      let data;
      try {
        data = await placesDetailsNew(safeId, fieldMask);
      } catch (err) {
        if (err?.status !== 400) throw err;
        fieldMask = baseFields.map((f) => `places.${f}`).join(",");
        data = await placesDetailsNew(safeId, fieldMask);
      }

      const normalized = normalizeDetails(data);
      const payload = { status: true, data: normalized };
      cacheSet(cacheKey, payload, 1000 * 60 * 30);

      const now = Date.now();
      await safeUpsert(
        "place_details_cache",
        {
          place_id: safeId,
          details: normalized,
          fetched_at: new Date(now).toISOString(),
          expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: "place_id" }
      );

      if (Number.isFinite(normalized?.lat) && Number.isFinite(normalized?.lng)) {
        await safeUpsert(
          "place_coords_cache",
          {
            source: "google",
            source_id: safeId,
            name: normalized?.name || null,
            lat: normalized.lat,
            lng: normalized.lng,
            place_id: safeId,
            query: "DETAILS",
            raw: normalized,
          },
          { onConflict: "source,source_id" }
        );
      }

      return reply.send(payload);
    } catch (err) {
      const status = err?.status || 502;
      const message = status === 502 ? "Place details failed" : err?.message;
      return reply.code(status).send({ message: message || "Place details failed" });
    }
  });

  app.get("/autocomplete", async (req, reply) => {
    const { input, lat, lng } = req.query || {};
    const term = String(input || "").trim();
    if (!term) {
      return reply.code(400).send({ message: "input is required" });
    }

    const cacheKey = `places:autocomplete:${JSON.stringify({ term, lat, lng })}`;
    const cached = cacheGet(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const body = { input: term };
      if (lat && lng) {
        body.locationBias = {
          circle: {
            center: { latitude: Number(lat), longitude: Number(lng) },
            radius: 50000,
          },
        };
      }
      const fieldMask =
        "suggestions.placePrediction.placeId," +
        "suggestions.placePrediction.text," +
        "suggestions.placePrediction.structuredFormat";
      const data = await placesAutocompleteNew(body, fieldMask);
      const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
      const predictions = suggestions
        .map((s) => s?.placePrediction)
        .filter(Boolean)
        .map((p) => ({
          placeId: p?.placeId || null,
          description: p?.text?.text || null,
          mainText: p?.structuredFormat?.mainText?.text || null,
          secondaryText: p?.structuredFormat?.secondaryText?.text || null,
        }))
        .filter((p) => p.placeId);

      const payload = { status: true, data: predictions };
      cacheSet(cacheKey, payload, 1000 * 60 * 10);
      return reply.send(payload);
    } catch (err) {
      const status = err?.status || 502;
      const message = status === 502 ? "Places autocomplete failed" : err?.message;
      return reply.code(status).send({ message: message || "Places autocomplete failed" });
    }
  });
}
