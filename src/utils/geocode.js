function getGoogleMapsKey() {
  return process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "";
}

export async function geocodeText(text) {
  const q = String(text || "").trim();
  if (!q) throw new Error("Missing geocode text");

  const key = getGoogleMapsKey();
  if (!key) throw new Error("Missing GOOGLE_MAPS_API_KEY");

  const params = new URLSearchParams({
    address: q,
    key,
  });

  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
  const payload = await res.json().catch(() => ({}));

  if (!res.ok || payload?.status === "REQUEST_DENIED") {
    throw new Error(payload?.error_message || "Geocode request failed");
  }

  const first = payload?.results?.[0];
  if (!first?.geometry?.location) {
    return null;
  }

  return {
    lat: Number(first.geometry.location.lat),
    lng: Number(first.geometry.location.lng),
    name: first.formatted_address || q,
  };
}
