export async function geocodeMapbox({ query, country, language = "en" }) {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new Error("Missing MAPBOX_ACCESS_TOKEN");

  const params = new URLSearchParams({
    access_token: token,
    limit: "1",
    language,
  });

  if (country) {
    params.set("country", String(country).toLowerCase());
  }

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    query
  )}.json?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) return null;

  let json;
  try {
    json = await res.json();
  } catch {
    return null;
  }

  const top = json?.features?.[0];
  if (!top?.center || top.center.length < 2) return null;

  const [lng, lat] = top.center;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;

  return {
    lat: Number(lat),
    lng: Number(lng),
    place_name: top.place_name || null,
    relevance: top.relevance ?? null,
    raw: top,
  };
}
