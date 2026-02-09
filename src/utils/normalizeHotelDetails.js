function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function uniqueByName(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = String(item?.name || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function includesBreakfast(mealplan) {
  return String(mealplan || "").toLowerCase().includes("breakfast");
}

function normalizeRoom(block, fallbackPrice) {
  const policies = (block?.block_text?.policies || [])
    .map((policy) => policy?.content)
    .filter(Boolean);

  return {
    blockId: String(block?.block_id || ""),
    roomId: toNumber(block?.room_id),
    title: block?.name_without_policy || block?.name || "Room",
    roomName: block?.room_name || null,
    mealplan: block?.mealplan || null,
    refundable: Boolean(block?.refundable === 1),
    refundableUntil: block?.refundable_until || null,
    policies,
    maxOccupancy: toNumber(block?.max_occupancy),
    price: {
      currency: fallbackPrice?.currency || null,
      total: toNumber(fallbackPrice?.value),
      totalRounded: fallbackPrice?.amountRounded || null,
    },
  };
}

export function normalizeHotelDetails(apiData, hotelPhotos = [], facilitiesData = {}) {
  const rawData = apiData?.rawData || {};
  const composite = apiData?.composite_price_breakdown || {};
  const product = apiData?.product_price_breakdown || {};
  const rawPrice = rawData?.priceBreakdown || {};

  const gross = pick(composite?.gross_amount, product?.gross_amount, rawPrice?.grossPrice) || {};
  const perNight = pick(composite?.gross_amount_per_night, product?.gross_amount_per_night) || {};
  const excluded = pick(composite?.excluded_amount, product?.excluded_amount) || {};
  const allInclusive = pick(composite?.all_inclusive_amount, product?.all_inclusive_amount) || {};

  const roomKeys = Object.keys(apiData?.rooms || {});
  const firstRoomPhotos = roomKeys.length ? apiData?.rooms?.[roomKeys[0]]?.photos || [] : [];

  const endpointPhotos = (hotelPhotos || [])
    .map((photo) => ({
      id: toNumber(photo?.id),
      url: photo?.url || null,
      urlLarge: photo?.url || null,
      urlThumb: photo?.url || null,
      ratio: null,
    }))
    .filter((photo) => !!photo.url);

  const fallbackPhotos = firstRoomPhotos.map((photo) => ({
    id: toNumber(photo?.photo_id),
    url: pick(photo?.url_original, photo?.url_max1280, photo?.url_max750),
    urlLarge: photo?.url_max1280 || null,
    urlThumb: pick(photo?.url_square180, photo?.url_max300),
    ratio: toNumber(photo?.ratio),
  }));

  const photos = endpointPhotos.length ? endpointPhotos : fallbackPhotos;

  const highlights = Array.isArray(apiData?.property_highlight_strip)
    ? apiData.property_highlight_strip.map((item) => item?.name).filter(Boolean)
    : Array.isArray(apiData?.top_ufi_benefits)
      ? apiData.top_ufi_benefits.map((item) => item?.translated_name).filter(Boolean)
      : [];

  const importantInfo = (apiData?.hotel_important_information_with_codes || [])
    .map((item) => item?.phrase)
    .filter(Boolean)
    .slice(0, 8);

  const facilitiesAmenities = uniqueByName(
    (facilitiesData?.facilities || [])
      .flatMap((facility) => facility?.instances || [])
      .map((instance) => ({
        name: instance?.title || "",
        icon: null,
      }))
  );
  const highlightAmenities = uniqueByName(
    (facilitiesData?.accommodationHighlights || []).map((item) => ({
      name: item?.title || "",
      icon: null,
    }))
  );
  const fallbackAmenities = uniqueByName(
    (apiData?.facilities_block?.facilities || []).map((facility) => ({
      name: facility?.name || "",
      icon: facility?.icon || null,
    }))
  );
  const amenities = facilitiesAmenities.length
    ? facilitiesAmenities
    : highlightAmenities.length
      ? highlightAmenities
      : fallbackAmenities;

  const fallbackRoomPrice = {
    currency: rawPrice?.grossPrice?.currency || rawPrice?.grossPrice?.currencyCode || null,
    value: rawPrice?.grossPrice?.value ?? null,
    amountRounded: rawPrice?.grossPrice?.amountRounded || null,
  };

  const rooms = (apiData?.block || []).map((block) => normalizeRoom(block, fallbackRoomPrice));
  rooms.sort((a, b) => {
    if (a.refundable !== b.refundable) return a.refundable ? -1 : 1;
    const aBreakfast = includesBreakfast(a.mealplan);
    const bBreakfast = includesBreakfast(b.mealplan);
    if (aBreakfast !== bBreakfast) return aBreakfast ? -1 : 1;
    return 0;
  });

  return {
    hotelId: pick(apiData?.hotel_id, rawData?.hotel_id),
    name: apiData?.hotel_name || rawData?.name || "Hotel",
    url: apiData?.url || null,

    address: apiData?.address || null,
    city: apiData?.city || null,
    countryCode: apiData?.countrycode || null,
    zip: apiData?.zip || null,

    lat: toNumber(apiData?.latitude),
    lng: toNumber(apiData?.longitude),

    checkinDate: pick(apiData?.arrival_date, rawData?.checkinDate),
    checkoutDate: pick(apiData?.departure_date, rawData?.checkoutDate),

    review: {
      score: toNumber(rawData?.reviewScore),
      scoreWord: pick(rawData?.reviewScoreWord, apiData?.breakfast_review_score?.review_score_word),
      count: toNumber(pick(apiData?.review_nr, rawData?.reviewCount)),
    },

    pricing: {
      currency: pick(gross?.currency, gross?.currencyCode),
      total: toNumber(gross?.value),
      totalRounded: gross?.amount_rounded || gross?.amountRounded || null,
      perNight: toNumber(perNight?.value),
      perNightRounded: perNight?.amount_rounded || perNight?.amountRounded || null,
      taxes: toNumber(excluded?.value),
      taxesRounded: excluded?.amount_rounded || excluded?.amountRounded || null,
      allInclusive: toNumber(allInclusive?.value),
      allInclusiveRounded: allInclusive?.amount_rounded || allInclusive?.amountRounded || null,
    },

    photos,

    overview: {
      highlights,
      importantInfo,
    },

    amenities,

    rooms,
  };
}
