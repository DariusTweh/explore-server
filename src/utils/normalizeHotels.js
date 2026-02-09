export function normalizeHotel(hotel) {
  const property = hotel?.property || {};
  const grossPrice = property?.priceBreakdown?.grossPrice || {};
  const excludedPrice = property?.priceBreakdown?.excludedPrice || {};

  return {
    hotelId: hotel?.hotel_id || property?.id || null,
    name: property?.name || null,
    imageUrl: property?.photoUrls?.[0] || null,
    reviewScore: property?.reviewScore ?? null,
    reviewScoreWord: property?.reviewScoreWord || null,
    reviewCount: property?.reviewCount || 0,
    stars: property?.propertyClass ?? property?.accuratePropertyClass ?? null,
    currency: grossPrice?.currency || grossPrice?.currencyCode || null,
    priceTotal: grossPrice?.value ?? null,
    priceTaxes: excludedPrice?.value ?? null,
    benefitBadges: property?.priceBreakdown?.benefitBadges || [],
    checkinDate: property?.checkinDate || null,
    checkoutDate: property?.checkoutDate || null,
    lat: property?.latitude ?? null,
    lng: property?.longitude ?? null,
    accessibilityLabel: hotel?.accessibilityLabel || null,
  };
}

export function normalizeHotelsResponse(apiResponseData) {
  const data = apiResponseData || {};
  const hotels = Array.isArray(data?.hotels) ? data.hotels : [];
  const totalLabel = data?.meta?.[0]?.title || null;

  return {
    totalLabel,
    hotels: hotels.map(normalizeHotel),
  };
}
