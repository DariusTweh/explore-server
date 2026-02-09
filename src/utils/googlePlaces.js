const BASE_URL = "https://places.googleapis.com/v1";

function getGoogleKey() {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
}

function getGoogleHeaders(fieldMask) {
  const key = getGoogleKey();
  if (!key) {
    const err = new Error("Missing GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY");
    err.status = 500;
    throw err;
  }
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": key,
  };
  if (fieldMask) {
    headers["X-Goog-FieldMask"] = fieldMask;
  }
  return headers;
}

async function googlePost(path, body, fieldMask) {
  const res = await fetch(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: getGoogleHeaders(fieldMask),
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || "Google Places request failed");
    err.status = res.status || 502;
    err.payload = json;
    throw err;
  }
  return json;
}

async function googleGet(path, fieldMask) {
  const res = await fetch(`${BASE_URL}/${path}`, {
    method: "GET",
    headers: getGoogleHeaders(fieldMask),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || "Google Places request failed");
    err.status = res.status || 502;
    err.payload = json;
    throw err;
  }
  return json;
}

export async function placesNearbySearchNew(body, fieldMask) {
  return googlePost("places:searchNearby", body, fieldMask);
}

export async function placesDetailsNew(placeId, fieldMask) {
  const safeId = encodeURIComponent(String(placeId || "").trim());
  return googleGet(`places/${safeId}`, fieldMask);
}

export async function placesAutocompleteNew(body, fieldMask) {
  return googlePost("places:autocomplete", body, fieldMask);
}

export async function placesSearchTextNew(body, fieldMask) {
  return googlePost("places:searchText", body, fieldMask);
}

export function buildPhotoUrl(photoName, maxWidthPx = 500) {
  const key = getGoogleKey();
  if (!photoName || !key) return null;
  const safeName = String(photoName).replace(/^\/+/, "");
  const url = new URL(`${BASE_URL}/${safeName}/media`);
  url.searchParams.set("maxWidthPx", String(maxWidthPx));
  url.searchParams.set("key", key);
  return url.toString();
}
