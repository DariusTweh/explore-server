import { searchAttractionLocations } from "./attractionLocationService.js";
import { normalizeAttractionLocations } from "../utils/normalizeAttractionLocations.js";

function clean(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return clean(text).split(" ").filter(Boolean);
}

function overlapScore(a, b) {
  const aSet = new Set(tokenize(a));
  const bTokens = tokenize(b);
  if (!aSet.size || !bTokens.length) return 0;
  let score = 0;
  for (const token of bTokens) {
    if (aSet.has(token)) score += 1;
  }
  return score;
}

function inferKind(row, query) {
  const type = clean(row?.type || "");
  const source = `${clean(row?.name)} ${clean(row?.label)} ${clean(query)}`;
  if (/museum/.test(source)) return "museum";
  if (/landmark|monument|tower|bridge/.test(source)) return "landmark";
  if (/neighbo|district|quarter/.test(source)) return "neighborhood";
  if (/city/.test(type)) return "city";
  if (/country/.test(type)) return "country";
  return type || "place";
}

function scoreCandidate(row, query) {
  let score = 0;
  const queryNorm = clean(query);
  const labelNorm = clean(row?.label);
  const nameNorm = clean(row?.name);

  if (labelNorm === queryNorm || nameNorm === queryNorm) score += 4;
  if (labelNorm.startsWith(queryNorm) || nameNorm.startsWith(queryNorm)) score += 2;
  score += overlapScore(`${row?.name} ${row?.label}`, query);
  if (row?.lat !== null && row?.lng !== null) score += 0.6;

  return score;
}

function toResolvedPlace(row, query, confidence = 0.7) {
  return {
    label: row?.label || row?.name || String(query || "").trim(),
    kind: inferKind(row, query),
    city: row?.city || null,
    country_code: row?.countryCode || null,
    lat: Number.isFinite(Number(row?.lat)) ? Number(row.lat) : null,
    lng: Number.isFinite(Number(row?.lng)) ? Number(row.lng) : null,
    confidence,
    source: "attraction_location_search",
    id: row?.id ? String(row.id) : null,
  };
}

export async function resolveNamedPlace({ query, destinationHint, languagecode = "en-us" }) {
  const term = String(query || "").trim();
  if (!term) return null;

  const composed = destinationHint ? `${term}, ${destinationHint}` : term;
  const raw = await searchAttractionLocations({ query: composed, languagecode });
  const candidates = normalizeAttractionLocations(raw, term);
  if (!candidates.length) return null;

  const ranked = candidates
    .map((row) => ({ row, score: scoreCandidate(row, term) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;
  const confidence = Math.max(0.35, Math.min(0.97, 0.45 + best.score * 0.1));

  return toResolvedPlace(best.row, term, confidence);
}
