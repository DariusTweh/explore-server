import { supabaseAdmin } from "./supabaseAdmin.js";

export async function upsertAttractions(
  products,
  { source = "booking_attractions", ufi, city, country } = {}
) {
  if (!Array.isArray(products) || products.length === 0) return;

  const now = Date.now();
  const rows = products
    .map((p) => {
      const externalId = p?.id ?? p?.productId;
      if (externalId === undefined || externalId === null) return null;

      return {
        source,
        external_id: String(externalId),
        name: p?.name || null,
        short_description: p?.shortDescription ?? null,
        description: p?.description ?? null,
        city: city ?? p?.ufiDetails?.bCityName ?? null,
        country: country ?? p?.ufiDetails?.url?.country ?? null,
        ufi: String(ufi ?? p?.ufiDetails?.ufi ?? ""),
        currency: p?.representativePrice?.currency ?? null,
        price_from:
          p?.representativePrice?.publicAmount ?? p?.representativePrice?.chargeAmount ?? null,
        rating: p?.reviewsStats?.combinedNumericStats?.average ?? null,
        rating_count: p?.reviewsStats?.combinedNumericStats?.total ?? null,
        free_cancellation: p?.cancellationPolicy?.hasFreeCancellation ?? null,
        image_url: p?.primaryPhoto?.small ?? null,
        url: null,
        raw: p,
        fetched_at: new Date(now).toISOString(),
        expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
    })
    .filter(Boolean);

  if (!rows.length) return;

  const { error } = await supabaseAdmin
    .from("attractions_cache")
    .upsert(rows, { onConflict: "source,external_id" });

  if (error) throw error;
}
