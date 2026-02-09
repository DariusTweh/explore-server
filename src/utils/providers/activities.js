import { amadeusGet } from "../amadeusClient.js";

function clampRadius(radiusKm) {
  const radius = Math.round(Number(radiusKm) || 0);
  if (!Number.isFinite(radius) || radius <= 0) return 1;
  return Math.max(1, Math.min(20, radius));
}

export async function resolveCityGeo(keyword) {
  if (!keyword) return null;
  const response = await amadeusGet("/v1/reference-data/locations", {
    subType: "CITY",
    keyword,
    "page[limit]": 8,
  });

  const locations = response?.data || [];
  const match =
    locations.find((loc) => loc?.geoCode?.latitude && loc?.geoCode?.longitude) ||
    locations[0];

  if (!match?.geoCode?.latitude || !match?.geoCode?.longitude) return null;
  return {
    lat: Number(match.geoCode.latitude),
    lng: Number(match.geoCode.longitude),
    label: match?.name || match?.address?.cityName || keyword,
  };
}

export async function searchActivities({ lat, lng, radiusKm = 3 }) {
  const radius = clampRadius(radiusKm);
  const response = await amadeusGet("/v1/shopping/activities", {
    latitude: lat,
    longitude: lng,
    radius,
  });

  const data = Array.isArray(response?.data) ? response.data : [];

  return data.map((a) => ({
    id: String(a?.id ?? ""),
    title: a?.name ?? "",
    description: a?.shortDescription ?? null,
    lat: Number(a?.geoCode?.latitude ?? 0),
    lng: Number(a?.geoCode?.longitude ?? 0),
    rating: a?.rating ? Number(a.rating) : null,
    price: a?.price?.amount
      ? { amount: Number(a.price.amount), currency: a.price.currencyCode || "USD" }
      : null,
    imageUrl: Array.isArray(a?.pictures) && a.pictures.length ? a.pictures[0] : null,
    bookingUrl: a?.bookingLink ?? null,
    provider: "amadeus_mla",
  }));
}
