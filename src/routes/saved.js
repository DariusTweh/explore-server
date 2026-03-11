import { requireAuth } from "../utils/requireAuth.js";
import { supabaseAdmin } from "../utils/supabaseAdmin.js";

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function computeItemKey({
  provider,
  providerId,
  name,
  type,
  lat,
  lng,
}) {
  const providerText = normalizeText(provider);
  const providerIdText = normalizeText(providerId);
  if (providerText && providerIdText) {
    return `${providerText}:${providerIdText}`;
  }
  const normalizedName = normalizeText(name).replace(/\s+/g, " ");
  const normalizedType = normalizeText(type) || "place";
  const latRounded = Number.isFinite(Number(lat)) ? Number(lat).toFixed(3) : "0.000";
  const lngRounded = Number.isFinite(Number(lng)) ? Number(lng).toFixed(3) : "0.000";
  return `${normalizedName}:${normalizedType}:${latRounded}:${lngRounded}`;
}

function mapSavedRow(row, sources = []) {
  return {
    id: row?.id || null,
    type: row?.type || "place",
    name: row?.name || "Saved item",
    photoUrl: row?.photo_url || null,
    rating: row?.rating ?? null,
    reviewCount: row?.review_count ?? null,
    priceLabel: row?.price_label || null,
    locationLabel: row?.location_label || null,
    lat: row?.lat ?? null,
    lng: row?.lng ?? null,
    provider: row?.provider || null,
    providerId: row?.provider_id || null,
    deepLink: row?.deep_link || null,
    raw: row?.raw || null,
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    sources: sources.map((source) => ({
      id: source?.id || null,
      sourceSurface: source?.source_surface || null,
      threadId: source?.thread_id || null,
      tripId: source?.trip_id || null,
      sourceLabel: source?.source_label || null,
      createdAt: source?.created_at || null,
    })),
  };
}

async function getSavedSourcesForUserItem({
  userId,
  savedItemId,
  sourceSurface = null,
  threadId = null,
  tripId = null,
}) {
  let q = supabaseAdmin
    .from("user_saved_item_sources")
    .select("*")
    .eq("user_id", userId)
    .eq("saved_item_id", savedItemId);

  if (sourceSurface) q = q.eq("source_surface", sourceSurface);
  if (threadId !== undefined) {
    q = threadId ? q.eq("thread_id", threadId) : q.is("thread_id", null);
  }
  if (tripId !== undefined) {
    q = tripId ? q.eq("trip_id", tripId) : q.is("trip_id", null);
  }

  const { data, error } = await q.limit(1);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : null;
}

export async function savedRoutes(app) {
  app.get("/items", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const sourceSurface = String(req.query?.source_surface || "").trim().toLowerCase() || null;
    const threadId = String(req.query?.thread_id || "").trim() || null;
    const type = String(req.query?.type || "").trim().toLowerCase() || null;
    const sortRaw = String(req.query?.sort || "newest").trim().toLowerCase();
    const ascending = sortRaw === "oldest";

    let sourceRows = [];
    if (sourceSurface || threadId) {
      let sourceQuery = supabaseAdmin
        .from("user_saved_item_sources")
        .select("*")
        .eq("user_id", authUser.id);
      if (sourceSurface) sourceQuery = sourceQuery.eq("source_surface", sourceSurface);
      if (threadId) sourceQuery = sourceQuery.eq("thread_id", threadId);
      const { data, error } = await sourceQuery;
      if (error) return reply.code(500).send({ error: error.message });
      sourceRows = Array.isArray(data) ? data : [];
      if (!sourceRows.length) return reply.send({ items: [] });
    }

    let itemsQuery = supabaseAdmin
      .from("user_saved_items")
      .select("*")
      .eq("user_id", authUser.id)
      .order("created_at", { ascending });

    if (type) itemsQuery = itemsQuery.eq("type", type);
    if (sourceRows.length) {
      const ids = [...new Set(sourceRows.map((row) => row?.saved_item_id).filter(Boolean))];
      if (!ids.length) return reply.send({ items: [] });
      itemsQuery = itemsQuery.in("id", ids);
    }

    const { data: itemRows, error: itemsError } = await itemsQuery;
    if (itemsError) return reply.code(500).send({ error: itemsError.message });

    const items = Array.isArray(itemRows) ? itemRows : [];
    if (!items.length) return reply.send({ items: [] });

    const itemIds = items.map((item) => item.id).filter(Boolean);
    const { data: allSources, error: sourceError } = await supabaseAdmin
      .from("user_saved_item_sources")
      .select("*")
      .eq("user_id", authUser.id)
      .in("saved_item_id", itemIds);

    if (sourceError) return reply.code(500).send({ error: sourceError.message });

    const sourceByItemId = new Map();
    for (const source of Array.isArray(allSources) ? allSources : []) {
      const key = String(source?.saved_item_id || "");
      if (!key) continue;
      const list = sourceByItemId.get(key) || [];
      list.push(source);
      sourceByItemId.set(key, list);
    }

    return reply.send({
      items: items.map((item) => mapSavedRow(item, sourceByItemId.get(String(item.id)) || [])),
    });
  });

  app.post("/items", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

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
      source_surface: sourceSurfaceInput,
      thread_id: threadIdInput,
      trip_id: tripIdInput,
      source_label: sourceLabelInput,
    } = req.body || {};

    const sourceSurface = String(sourceSurfaceInput || "trip").trim().toLowerCase();
    const threadId = String(threadIdInput || "").trim() || null;
    const tripId = String(tripIdInput || "").trim() || null;
    const sourceLabel = String(sourceLabelInput || "").trim() || null;

    const itemKey = computeItemKey({
      provider,
      providerId,
      name,
      type,
      lat,
      lng,
    });

    const canonicalPayload = {
      user_id: authUser.id,
      item_key: itemKey,
      type: String(type || "place").trim().toLowerCase(),
      name: String(name || "Saved item").trim() || "Saved item",
      photo_url: photoUrl || null,
      rating: Number.isFinite(Number(rating)) ? Number(rating) : null,
      review_count: Number.isFinite(Number(reviewCount)) ? Number(reviewCount) : null,
      price_label: priceLabel || null,
      location_label: locationLabel || null,
      lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
      lng: Number.isFinite(Number(lng)) ? Number(lng) : null,
      provider: String(provider || "unknown").trim() || "unknown",
      provider_id: String(providerId || "").trim() || itemKey,
      deep_link: deepLink || null,
      raw: raw || null,
      updated_at: new Date().toISOString(),
    };

    const { data: upsertedRows, error: upsertError } = await supabaseAdmin
      .from("user_saved_items")
      .upsert(canonicalPayload, { onConflict: "user_id,item_key" })
      .select("*");

    if (upsertError) return reply.code(500).send({ error: upsertError.message });

    const savedRow = Array.isArray(upsertedRows) ? upsertedRows[0] : null;
    if (!savedRow?.id) {
      return reply.code(500).send({ error: "Failed to save item" });
    }

    const sourcePayload = {
      saved_item_id: savedRow.id,
      user_id: authUser.id,
      source_surface: sourceSurface,
      thread_id: threadId,
      trip_id: tripId,
      source_label: sourceLabel,
    };

    const { error: sourceInsertError } = await supabaseAdmin
      .from("user_saved_item_sources")
      .insert(sourcePayload);

    if (sourceInsertError) {
      const isUnique =
        sourceInsertError.code === "23505" ||
        /unique constraint|duplicate key/i.test(sourceInsertError.message || "");
      if (!isUnique) {
        return reply.code(500).send({ error: sourceInsertError.message });
      }
    }

    const { data: sourceRows, error: sourceFetchError } = await supabaseAdmin
      .from("user_saved_item_sources")
      .select("*")
      .eq("user_id", authUser.id)
      .eq("saved_item_id", savedRow.id);

    if (sourceFetchError) return reply.code(500).send({ error: sourceFetchError.message });

    return reply.send({
      item: mapSavedRow(savedRow, Array.isArray(sourceRows) ? sourceRows : []),
    });
  });

  app.delete("/items/:savedItemId", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const savedItemId = String(req.params?.savedItemId || "").trim();
    if (!savedItemId) return reply.code(400).send({ error: "Missing savedItemId" });

    const { error } = await supabaseAdmin
      .from("user_saved_items")
      .delete()
      .eq("id", savedItemId)
      .eq("user_id", authUser.id);

    if (error) return reply.code(500).send({ error: error.message });
    return reply.send({ ok: true });
  });

  app.delete("/items/:savedItemId/source", async (req, reply) => {
    const authUser = await requireAuth(req, reply);
    if (!authUser) return;

    const savedItemId = String(req.params?.savedItemId || "").trim();
    if (!savedItemId) return reply.code(400).send({ error: "Missing savedItemId" });

    const sourceSurface = String(req.body?.source_surface || req.query?.source_surface || "")
      .trim()
      .toLowerCase();
    const threadIdRaw = req.body?.thread_id ?? req.query?.thread_id;
    const tripIdRaw = req.body?.trip_id ?? req.query?.trip_id;
    const threadId = threadIdRaw ? String(threadIdRaw).trim() : null;
    const tripId = tripIdRaw ? String(tripIdRaw).trim() : null;

    if (!sourceSurface) {
      return reply.code(400).send({ error: "Missing source_surface" });
    }

    let deleteQuery = supabaseAdmin
      .from("user_saved_item_sources")
      .delete()
      .eq("saved_item_id", savedItemId)
      .eq("user_id", authUser.id)
      .eq("source_surface", sourceSurface);

    if (threadIdRaw !== undefined) {
      deleteQuery = threadId ? deleteQuery.eq("thread_id", threadId) : deleteQuery.is("thread_id", null);
    }
    if (tripIdRaw !== undefined) {
      deleteQuery = tripId ? deleteQuery.eq("trip_id", tripId) : deleteQuery.is("trip_id", null);
    }

    const { error: deleteError } = await deleteQuery;
    if (deleteError) return reply.code(500).send({ error: deleteError.message });

    const remaining = await getSavedSourcesForUserItem({
      userId: authUser.id,
      savedItemId,
      sourceSurface: null,
      threadId: undefined,
      tripId: undefined,
    });

    if (!remaining) {
      await supabaseAdmin
        .from("user_saved_items")
        .delete()
        .eq("id", savedItemId)
        .eq("user_id", authUser.id);
    }

    return reply.send({ ok: true });
  });
}
