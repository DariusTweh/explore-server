import { supabaseAdmin } from "./supabaseAdmin.js";

export async function getCoordsFromCache({ source, source_id }) {
  const { data, error } = await supabaseAdmin
    .from("place_coords_cache")
    .select("lat,lng,query,raw,place_id,name,city,country")
    .eq("source", source)
    .eq("source_id", String(source_id))
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function upsertCoordsCache(row) {
  const { error } = await supabaseAdmin.from("place_coords_cache").upsert(
    {
      source: row.source,
      source_id: String(row.source_id),
      name: row.name ?? null,
      city: row.city ?? null,
      country: row.country ?? null,
      lat: row.lat,
      lng: row.lng,
      place_id: row.place_id ?? null,
      query: row.query ?? null,
      raw: row.raw ?? null,
    },
    { onConflict: "source,source_id" }
  );

  if (error) throw error;
}
