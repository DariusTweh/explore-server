import { requireAuth } from "../utils/requireAuth.js";
import { supabaseAdmin } from "../utils/supabaseAdmin.js";
import { getCoordsFromCache, upsertCoordsCache } from "../utils/coordsCache.js";
import { geocodeMapbox } from "../utils/geocodeMapbox.js";
import { bookingGet } from "../utils/bookingClient.js";
import { placesDetailsNew } from "../utils/googlePlaces.js";

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
    return { lat: item.lat, lng: item.lng };
  }
  if (!item?.source || !item?.sourceId) return null;

  const cached = await getCoordsFromCache({
    source: item.source,
    source_id: item.sourceId,
  }).catch(() => null);
  if (cached?.lat && cached?.lng) {
    return { lat: cached.lat, lng: cached.lng };
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
        return { lat, lng };
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
        return { lat: coords.lat, lng: coords.lng };
      }
    } catch {
      // fall through
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
      return { lat: g.lat, lng: g.lng };
    }
  } catch {
    return null;
  }

  return null;
}

export async function tripsRoutes(app) {
  app.post("/", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const {
      primaryLocationName,
      startDate,
      endDate,
      travelers,
      budgetTier,
      roadTrip,
      title,
    } = req.body || {};

    const tripTitle =
      title || `${primaryLocationName} • ${startDate}–${endDate}`;

    const { data, error } = await supabaseAdmin
      .from("trips")
      .insert({
        user_id: authUser.id,
        primary_location_name: primaryLocationName,
        start_date: startDate,
        end_date: endDate,
        travelers,
        budget_tier: budgetTier,
        road_trip: roadTrip,
        title: tripTitle,
      })
      .select("*")
      .single();

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    return reply.send({ trip: data });
  });

  app.get("/:tripId", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const { tripId } = req.params || {};
    const { data, error } = await supabaseAdmin
      .from("trips")
      .select("*")
      .eq("id", tripId)
      .eq("user_id", authUser.id)
      .single();

    if (error || !data) {
      return reply.code(404).send({ error: "Trip not found" });
    }

    return reply.send({ trip: data });
  });

  app.get("/:tripId/saved", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const { tripId } = req.params || {};
    const { data, error } = await supabaseAdmin
      .from("trip_saved_items")
      .select("*")
      .eq("trip_id", tripId)
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: false });

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    return reply.send({ items: data || [] });
  });

  app.post("/:tripId/saved", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const { tripId } = req.params || {};
    const {
      type,
      name,
      photoUrl,
      rating,
      reviewCount,
      priceLabel,
      locationLabel,
      lat,
      lng,
      provider,
      providerId,
      deepLink,
      raw,
    } = req.body || {};

    const insertPayload = {
      trip_id: tripId,
      user_id: authUser.id,
      type,
      name,
      photo_url: photoUrl,
      rating,
      review_count: reviewCount,
      price_label: priceLabel,
      location_label: locationLabel,
      lat,
      lng,
      provider,
      provider_id: providerId,
      deep_link: deepLink,
      raw,
    };

    const { data, error } = await supabaseAdmin
      .from("trip_saved_items")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      const isUnique =
        error.code === "23505" ||
        /unique constraint|duplicate key/i.test(error.message || "");
      if (!isUnique) {
        return reply.code(500).send({ error: error.message });
      }

      const { data: existing, error: existingError } = await supabaseAdmin
        .from("trip_saved_items")
        .select("*")
        .eq("trip_id", tripId)
        .eq("user_id", authUser.id)
        .eq("provider", provider)
        .eq("provider_id", providerId)
        .single();

      if (existingError || !existing) {
        return reply.code(500).send({ error: existingError?.message || "Insert failed" });
      }

      return reply.send({ item: existing });
    }

    return reply.send({ item: data });
  });

  app.delete("/:tripId/saved/:savedItemId", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const { tripId, savedItemId } = req.params || {};
    const { error } = await supabaseAdmin
      .from("trip_saved_items")
      .delete()
      .eq("id", savedItemId)
      .eq("trip_id", tripId)
      .eq("user_id", authUser.id);

    if (error) {
      return reply.code(500).send({ error: error.message });
    }

    return reply.send({ ok: true });
  });

  app.get("/:tripId/plans/:planId", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const { tripId, planId } = req.params || {};
    const { data, error } = await supabaseAdmin
      .from("trip_plans")
      .select("*")
      .eq("id", planId)
      .eq("trip_id", tripId)
      .eq("user_id", authUser.id)
      .single();

    if (error || !data) {
      return reply.code(404).send({ error: "Plan not found" });
    }

    const plan = data.plan_json || {};
    return reply.send({
      plan: {
        id: data.id,
        tripId: data.trip_id,
        title: data.title,
        startDate: data.start_date,
        endDate: data.end_date,
        destinationLabel: data.destination_label,
        days: plan.days || [],
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    });
  });

  app.get("/:tripId/plans/:planId/markers", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const { tripId, planId } = req.params || {};
    const { data, error } = await supabaseAdmin
      .from("trip_plans")
      .select("*")
      .eq("id", planId)
      .eq("trip_id", tripId)
      .eq("user_id", authUser.id)
      .single();

    if (error || !data) {
      return reply.code(404).send({ error: "Plan not found" });
    }

    const plan = data.plan_json || {};
    const days = Array.isArray(plan?.days) ? plan.days : [];
    const markers = [];

    for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
      const day = days[dayIndex];
      const items = Array.isArray(day?.items) ? day.items : [];
      for (const item of items) {
        let lat = item?.lat ?? null;
        let lng = item?.lng ?? null;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          const hydrated = await hydrateCoordsForItem(item, plan?.destinationLabel);
          lat = hydrated?.lat ?? null;
          lng = hydrated?.lng ?? null;
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        markers.push({
          id: item?.id || `${dayIndex}-${item?.title || "item"}`,
          title: item?.title || "Place",
          lat,
          lng,
          type: item?.type || "place",
          dayIndex,
          date: day?.date || null,
        });
      }
    }

    return reply.send({ markers });
  });
}
