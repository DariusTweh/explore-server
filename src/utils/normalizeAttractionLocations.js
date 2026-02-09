function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickId(item, fallbackId) {
  const rawId =
    item?.id ??
    item?.location?.id ??
    item?.dest_id ??
    item?.location_id ??
    item?.ufi ??
    item?.city_ufi ??
    null;

  if (rawId !== null && rawId !== undefined && String(rawId).trim() !== "") {
    return String(rawId).trim();
  }

  return fallbackId;
}

function pickArray(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== "object") return [];

  // Upstream shape varies a lot by region/provider version.
  const keys = [
    "locations",
    "result",
    "results",
    "data",
    "destinations",
    "suggestions",
    "items",
    "places",
    "cities",
    "regions",
    "entities",
  ];
  for (const key of keys) {
    if (Array.isArray(input[key])) return input[key];
  }

  // Fallback: treat object as a single location row if it looks location-like.
  if (
    input?.id !== undefined ||
    input?.name ||
    input?.label ||
    input?.dest_id !== undefined ||
    input?.ufi !== undefined
  ) {
    return [input];
  }
  return [];
}

export function normalizeAttractionLocations(apiData, queryText = "") {
  const list = pickArray(apiData?.data ?? apiData);
  const queryNorm = normalizeText(queryText);
  const queryTokens = queryNorm.split(" ").filter(Boolean);

  const mapped = list.map((item, index) => {
    const lat = toNumber(item?.latitude ?? item?.lat);
    const lng = toNumber(item?.longitude ?? item?.lng);
    const cityName = item?.cityName || item?.city_name || item?.city || null;
    const countryName = item?.country || item?.countryName || null;
    const name =
      item?.name ||
      cityName ||
      item?.label ||
      item?.region ||
      countryName ||
      "Unknown";
    const derivedLabel =
      cityName && countryName ? `${cityName}, ${countryName}` : cityName || countryName || name;
    const label =
      item?.label ||
      item?.fullname ||
      derivedLabel ||
      item?.name ||
      item?.region ||
      name;

    const id = pickId(item, `${name}:${lat ?? ""}:${lng ?? ""}:${index}`);
    const city = cityName;
    const searchSurface = normalizeText(`${name} ${label} ${city || ""}`);
    let score = 0;
    if (queryNorm) {
      if (searchSurface === queryNorm) score += 250;
      if (searchSurface.startsWith(queryNorm)) score += 160;
      if (searchSurface.includes(queryNorm)) score += 120;
      if (normalizeText(String(city || "")) === queryNorm) score += 140;
      for (const token of queryTokens) {
        if (searchSurface.includes(token)) score += 25;
      }
    }

    const type = item?.dest_type || item?.type || item?.location_type || null;
    if (type && /city|district|region|state|country/i.test(String(type))) score += 10;
    if (lat !== null && lng !== null) score += 5;

    return {
      id: String(id),
      name: String(name),
      label: String(label),
      type,
      countryCode: item?.cc1 || item?.country_code || item?.countryCode || null,
      city,
      lat,
      lng,
      _score: score,
      _idx: index,
    };
  });

  const deduped = [];
  const seen = new Set();
  for (const row of mapped) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    deduped.push(row);
  }

  deduped.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;

    const aHasGeo = a.lat !== null && a.lng !== null;
    const bHasGeo = b.lat !== null && b.lng !== null;
    if (aHasGeo !== bHasGeo) return aHasGeo ? -1 : 1;

    const lenDiff = (a.label?.length || 0) - (b.label?.length || 0);
    if (lenDiff !== 0) return lenDiff;

    return a._idx - b._idx;
  });

  return deduped.slice(0, 12).map(({ _idx, _score, ...row }) => row);
}
