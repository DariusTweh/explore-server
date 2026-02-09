function parseCoord(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null;
  return n;
}

function isValidLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function formatAddressLabel(address) {
  if (!address || typeof address !== "object") return null;
  const primary = [address.address, address.city, address.country]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
  const instructions = String(address.instructions || "").trim();
  if (primary && instructions) return `${primary} - ${instructions}`;
  return primary || instructions || null;
}

const PRIORITY = [
  "meeting",
  "pickup",
  "guestPickup",
  "entrance",
  "attraction",
  "departure",
  "arrival",
];

export function extractAttractionCoordsFromDetails(data) {
  const addresses = data?.addresses || {};

  for (const source of PRIORITY) {
    const items = toArray(addresses?.[source]);
    for (const item of items) {
      const lat = parseCoord(item?.latitude);
      const lng = parseCoord(item?.longitude);
      if (!isValidLatLng(lat, lng)) continue;

      return {
        lat,
        lng,
        coordSource: source,
        coordAddress: formatAddressLabel(item),
        place_id: item?.googlePlaceId || null,
        rawChosenAddress: item || null,
      };
    }
  }

  return null;
}
