function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDurationSec(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value || "").trim();
  if (!raw) return null;

  const match = raw.match(/P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function priceFromUnits(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") return null;
  if (typeof value.amount === "number" && Number.isFinite(value.amount)) return value.amount;
  if (typeof value.units === "number") {
    return Number(value.units) + Number(value.nanos || 0) / 1e9;
  }
  return null;
}

export function normalizeFlightOffer(offer) {
  const segments = Array.isArray(offer?.segments)
    ? offer.segments
    : Array.isArray(offer?.legs?.[0]?.segments)
      ? offer.legs[0].segments
      : Array.isArray(offer?.itinerary?.segments)
        ? offer.itinerary.segments
        : [];

  const firstSeg = segments[0] || {};
  const lastSeg = segments[segments.length - 1] || {};
  const firstLeg = firstSeg?.legs?.[0] || {};
  const carriers = (firstLeg?.carriersData || offer?.carriers || offer?.airlines || [])
    .map((carrier) => ({
      code: carrier?.code || carrier?.carrierCode || carrier?.id || null,
      name: carrier?.name || carrier?.carrierName || null,
      logo: carrier?.logo || carrier?.logoUrl || null,
    }))
    .filter((carrier) => carrier.code || carrier.name || carrier.logo);

  const marketingCarrier =
    firstSeg?.marketingCarrier || firstSeg?.carrier || firstSeg?.carrierCode || null;

  if (!carriers.length && marketingCarrier) {
    carriers.push({
      code: marketingCarrier?.code || marketingCarrier || null,
      name: marketingCarrier?.name || null,
      logo: marketingCarrier?.logo || marketingCarrier?.logoUrl || null,
    });
  }

  const priceObj =
    offer?.price?.total ||
    offer?.price?.grandTotal ||
    offer?.price?.amount ||
    offer?.totalPrice ||
    offer?.total;
  const currency = priceObj?.currencyCode || priceObj?.currency || offer?.currency || "USD";
  const stops =
    typeof offer?.stops === "number" ? offer.stops : Math.max((segments?.length || 1) - 1, 0);

  return {
    id: offer?.id || offer?.key || offer?.offerKey || offer?.token || null,
    token: offer?.token || offer?.offerToken || offer?.id || offer?.key || null,
    raw: offer,
    price: {
      total: priceFromUnits(priceObj),
      currency,
    },
    depart: {
      time: firstSeg?.departure?.at || firstSeg?.departureTime || null,
      airportCode: firstSeg?.departure?.iataCode || firstSeg?.origin || null,
      cityName: firstSeg?.departure?.city || firstSeg?.originCityName || null,
    },
    arrive: {
      time: lastSeg?.arrival?.at || lastSeg?.arrivalTime || null,
      airportCode: lastSeg?.arrival?.iataCode || lastSeg?.destination || null,
      cityName: lastSeg?.arrival?.city || lastSeg?.destinationCityName || null,
    },
    durationSec: parseDurationSec(offer?.duration) || parseDurationSec(firstSeg?.duration) || null,
    stops,
    airlineName: carriers?.[0]?.name || null,
    airlineCode: carriers?.[0]?.code || null,
    airlineLogoUrl: carriers?.[0]?.logo || null,
    carriers,
    cabinClass:
      offer?.cabinClass ||
      offer?.fareClass ||
      firstSeg?.cabinClass ||
      firstLeg?.cabinClass ||
      null,
  };
}

function parseTimeValue(isoLike) {
  if (!isoLike) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(isoLike);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function scoreBestOffer(offer) {
  const price = toNumber(offer?.price?.total) ?? 1e9;
  const durationSec = toNumber(offer?.durationSec) ?? 1e9;
  const stops = toNumber(offer?.stops) ?? 4;
  return price + durationSec / 600 + stops * 120;
}

export function shortlistFlightOffers(offers, flightIntent = {}, maxCount = 8) {
  const maxStops = Number.isFinite(Number(flightIntent?.maxStops))
    ? Number(flightIntent.maxStops)
    : 1;
  const preferredCabin = flightIntent?.cabinClass || null;
  const preference = flightIntent?.preference || "best";

  const filtered = (Array.isArray(offers) ? offers : [])
    .map((offer) => normalizeFlightOffer(offer))
    .filter((offer) => offer?.token)
    .filter((offer) => (offer?.stops ?? 99) <= maxStops)
    .filter((offer) => {
      if (!preferredCabin) return true;
      if (!offer?.cabinClass) return true;
      return String(offer.cabinClass).toUpperCase() === String(preferredCabin).toUpperCase();
    });

  const sorted = filtered.sort((a, b) => {
    if (preference === "cheapest") {
      return (toNumber(a?.price?.total) ?? 1e9) - (toNumber(b?.price?.total) ?? 1e9);
    }
    if (preference === "earliest") {
      return parseTimeValue(a?.depart?.time) - parseTimeValue(b?.depart?.time);
    }
    if (preference === "latest") {
      return parseTimeValue(b?.depart?.time) - parseTimeValue(a?.depart?.time);
    }
    return scoreBestOffer(a) - scoreBestOffer(b);
  });

  return sorted.slice(0, maxCount);
}

export function buildFlightItemMeta(selectedOffer, extra = {}) {
  if (!selectedOffer) return null;
  return {
    bookingToken: selectedOffer.token || null,
    offerId: selectedOffer.id || null,
    airlineCode: selectedOffer.airlineCode || null,
    airlineName: selectedOffer.airlineName || null,
    airlineLogoUrl: selectedOffer.airlineLogoUrl || null,
    departTime: selectedOffer.depart?.time || null,
    arriveTime: selectedOffer.arrive?.time || null,
    departAirportCode: selectedOffer.depart?.airportCode || null,
    arriveAirportCode: selectedOffer.arrive?.airportCode || null,
    stops: selectedOffer.stops ?? null,
    durationSec: selectedOffer.durationSec ?? null,
    ...extra,
  };
}

export function buildFlightSubtitle(selectedOffer) {
  if (!selectedOffer) return null;
  const airline = selectedOffer.airlineName || selectedOffer.airlineCode || "Flight";
  const depart = selectedOffer.depart?.time || "";
  const arrive = selectedOffer.arrive?.time || "";
  const stops = selectedOffer.stops === 0 ? "nonstop" : `${selectedOffer.stops || 0} stop`;
  return `${airline} • ${depart} → ${arrive} • ${stops}`;
}
