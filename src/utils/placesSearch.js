import { buildPhotoUrl, placesSearchTextNew } from "./googlePlaces.js";

export async function searchPlacesAround({ query, lat, lng, radius = 3000, max = 40 }) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  const safeRadius = Math.max(500, Math.min(15000, Number(radius) || 3000));
  const maxResultCount = Math.max(1, Math.min(50, Number(max) || 40));

  if (!Number.isFinite(safeLat) || !Number.isFinite(safeLng)) {
    throw new Error("lat/lng are required");
  }

  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.rating",
    "places.userRatingCount",
    "places.photos",
    "places.regularOpeningHours",
    "places.types",
  ].join(",");

  const body = {
    textQuery: String(query || "places").trim() || "places",
    maxResultCount,
    rankPreference: "RELEVANCE",
    locationBias: {
      circle: {
        center: { latitude: safeLat, longitude: safeLng },
        radius: safeRadius,
      },
    },
  };

  const data = await placesSearchTextNew(body, fieldMask);
  const list = Array.isArray(data?.places) ? data.places : [];

  return list
    .map((place) => {
      const photoRef = place?.photos?.[0]?.name || null;
      return {
        id: String(place?.id || ""),
        name: place?.displayName?.text || "Place",
        lat: Number(place?.location?.latitude),
        lng: Number(place?.location?.longitude),
        address: place?.formattedAddress || null,
        rating: Number.isFinite(Number(place?.rating)) ? Number(place.rating) : null,
        user_ratings_total: Number.isFinite(Number(place?.userRatingCount))
          ? Number(place.userRatingCount)
          : null,
        photo_ref: photoRef,
        photo_url: photoRef ? buildPhotoUrl(photoRef, 500) : null,
        open_now:
          typeof place?.regularOpeningHours?.openNow === "boolean"
            ? place.regularOpeningHours.openNow
            : null,
        types: Array.isArray(place?.types) ? place.types : [],
      };
    })
    .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lng));
}
