import { amadeusGet } from "../utils/amadeusClient.js";
import { cacheGet, cacheSet } from "../utils/memoryCache.js";
import { resolveCityGeo, searchActivities } from "../utils/providers/activities.js";
import {
  searchFlightLocations,
  searchFlights,
  getFlightDetails,
} from "../providers/bookingcom/flights.js";

export async function searchRoutes(app) {
  app.get("/flight-locations", async (req, reply) => {
    // Auto-complete airport/city locations for flight search.
    const { q } = req.query || {};
    if (!q) return reply.code(400).send({ error: "Missing required query param: q" });

    try {
      const response = await amadeusGet("/v1/reference-data/locations", {
        subType: "AIRPORT,CITY",
        keyword: q,
        "page[limit]": 8,
      });

      const results = (response?.data || []).map((item) => ({
        name: item?.name,
        iataCode: item?.iataCode,
        subType: item?.subType,
        cityName: item?.address?.cityName,
        countryCode: item?.address?.countryCode,
      }));

      return reply.send({ results });
    } catch (err) {
      const message = err?.message ?? String(err);
      return reply.code(500).send({ error: message });
    }
  });

  const priceFromUnits = (money) => {
    if (!money) return null;
    if (typeof money === "number") return money;
    if (typeof money?.amount === "number") return money.amount;
    if (typeof money?.value === "number") return money.value;
    if (typeof money?.units === "number") {
      const nanos = Number(money?.nanos || 0);
      return Number(money.units) + nanos / 1e9;
    }
    return null;
  };

  const parseDurationSec = (val) => {
    if (typeof val === "number") return val;
    if (!val || typeof val !== "string") return null;
    const match = val.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return null;
    const hours = Number(match[1] || 0);
    const mins = Number(match[2] || 0);
    const secs = Number(match[3] || 0);
    return hours * 3600 + mins * 60 + secs;
  };

  const normalizeOffer = (offer) => {
    const segments = offer?.segments || [];
    const firstSeg = segments[0] || {};
    const lastSeg = segments[segments.length - 1] || {};
    const firstLeg = firstSeg?.legs?.[0] || {};
    const carriers = (firstLeg?.carriersData || offer?.carriers || offer?.airlines || [])
      .map((c) => ({
        code: c?.code || c?.carrierCode || c?.id || null,
        name: c?.name || c?.carrierName || null,
        logo: c?.logo || c?.logoUrl || null,
      }))
      .filter((c) => c.code || c.name || c.logo);

    const marketingCarrier =
      firstSeg?.marketingCarrier ||
      firstSeg?.carrier ||
      firstSeg?.carrierCode ||
      null;

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
    const currency =
      priceObj?.currencyCode || priceObj?.currency || offer?.currency || "USD";

    const stops =
      typeof offer?.stops === "number"
        ? offer.stops
        : Math.max((segments?.length || 1) - 1, 0);

    return {
      id: offer?.id || offer?.key || offer?.offerKey || offer?.token,
      token: offer?.token || offer?.offerToken || offer?.id || offer?.key,
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
      durationSec:
        parseDurationSec(offer?.duration) ||
        parseDurationSec(firstSeg?.duration) ||
        null,
      stops,
      airlineName: carriers?.[0]?.name || null,
      airlineCode: carriers?.[0]?.code || null,
      airlineLogoUrl: carriers?.[0]?.logo || null,
      carriers,
      baggage: {
        carryOn: !!offer?.baggage?.carryOn || !!offer?.baggage?.carry_on,
        checked: !!offer?.baggage?.checked || !!offer?.baggage?.checked_bag,
      },
    };
  };

  app.get("/flights/locations", async (req, reply) => {
    const { query, languageCode } = req.query || {};
    if (!query) return reply.code(400).send({ error: "Missing required query param: query" });

    const key = `flightLocations:${languageCode || "en"}:${String(query).toLowerCase()}`;
    const cached = cacheGet(key);
    if (cached) return reply.send({ ok: true, data: cached });

    try {
      const data = await searchFlightLocations({ query, languageCode });
      const normalized = (Array.isArray(data) ? data : []).map((item) => ({
        id: item?.id || item?.destinationId || item?.code,
        type: item?.type || item?.dest_type || null,
        code: item?.code || item?.iataCode || item?.airportCode || null,
        name: item?.name || item?.city_name || item?.label || null,
        cityName: item?.cityName || item?.city_name || null,
        regionName: item?.regionName || item?.region_name || null,
        countryName: item?.countryName || item?.country_name || null,
        photoUrl: item?.photoUrl || item?.image_url || null,
        parent: item?.parent || item?.parentCode || null,
        distanceKm: item?.distance || item?.distance_km || null,
      }));

      cacheSet(key, normalized, 1000 * 60 * 60 * 24 * 7);
      return reply.send({ ok: true, data: normalized });
    } catch (err) {
      console.warn("[search] flights/locations error", err?.message ?? String(err));
      return reply.code(500).send({ error: err?.message ?? "Flight locations failed" });
    }
  });

  app.get("/flights", async (req, reply) => {
    const {
      fromId,
      toId,
      departDate,
      returnDate,
      pageNo,
      adults,
      children,
      sort,
      cabinClass,
      currency,
    } = req.query || {};

    if (!fromId) return reply.code(400).send({ error: "Missing required query param: fromId" });
    if (!toId) return reply.code(400).send({ error: "Missing required query param: toId" });
    if (!departDate) {
      return reply.code(400).send({ error: "Missing required query param: departDate" });
    }

    const cacheKey = `flightSearch:${JSON.stringify({
      fromId,
      toId,
      departDate,
      returnDate,
      pageNo,
      adults,
      children,
      sort,
      cabinClass,
      currency,
    })}`;
    const cached = cacheGet(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const data = await searchFlights({
        fromId,
        toId,
        departDate,
        returnDate,
        pageNo: pageNo ? Number(pageNo) : 1,
        adults: adults ? Number(adults) : 1,
        childrenAges: children,
        sort,
        cabinClass,
        currencyCode: currency || "USD",
      });

      const offersRaw =
        data?.flightOffers || data?.offers || data?.results || data?.flights || [];
      const offers = (Array.isArray(offersRaw) ? offersRaw : [])
        .map(normalizeOffer)
        .filter((o) => o?.token);

      const payload = {
        aggregation: data?.aggregation || data?.filters || null,
        flightDeals: data?.flightDeals || data?.aggregation?.flightDeals || null,
        flightOffers: Array.isArray(offersRaw) ? offersRaw : [],
        offers,
      };

      cacheSet(cacheKey, payload, 1000 * 60 * 15);
      return reply.send(payload);
    } catch (err) {
      console.warn("[search] flights error", err?.message ?? String(err));
      return reply.code(500).send({ error: err?.message ?? "Flights search failed" });
    }
  });

  app.get("/flights/details", async (req, reply) => {
    const { token, currency } = req.query || {};
    if (!token) return reply.code(400).send({ error: "Missing required query param: token" });

    const cacheKey = `flightDetails:${token}:${currency || "USD"}`;
    const cached = cacheGet(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const data = await getFlightDetails({ token, currencyCode: currency || "USD" });
      const segments = Array.isArray(data?.segments) ? data.segments : [];
      const normalizedSegments = segments.map((segment) => {
        const legs = Array.isArray(segment?.legs) ? segment.legs : [];
        const firstCarrier = legs?.[0]?.carriersData?.[0] || null;
        return {
          from: {
            code: segment?.departureAirport?.code || null,
            city: segment?.departureAirport?.cityName || null,
            airport: segment?.departureAirport?.name || null,
          },
          to: {
            code: segment?.arrivalAirport?.code || null,
            city: segment?.arrivalAirport?.cityName || null,
            airport: segment?.arrivalAirport?.name || null,
          },
          departAt: segment?.departureTimeTz || segment?.departureTime || null,
          arriveAt: segment?.arrivalTimeTz || segment?.arrivalTime || null,
          durationSec: segment?.totalTime || null,
          airline: {
            name: firstCarrier?.name || null,
            code: firstCarrier?.code || null,
            logo: firstCarrier?.logo || null,
          },
          cabinClass: legs?.[0]?.cabinClass || null,
          flightNumber: legs?.[0]?.flightInfo?.flightNumber || null,
          legs: legs.map((leg) => ({
            departAt: leg?.departureTimeTz || leg?.departureTime || null,
            arriveAt: leg?.arrivalTimeTz || leg?.arrivalTime || null,
            fromCode: leg?.departureAirport?.code || null,
            toCode: leg?.arrivalAirport?.code || null,
            durationSec: leg?.totalTime || null,
            carrier: leg?.carriersData?.[0] || null,
            flightNumber: leg?.flightInfo?.flightNumber || null,
          })),
        };
      });

      const details = {
        meta: {
          token,
          offerReference: data?.offerReference || data?.offerRef || null,
          currency: currency || "USD",
          tripType: data?.tripType || null,
          flightKey: data?.flightKey || null,
        },
        summary: {
          totalPrice: priceFromUnits(data?.priceBreakdown?.total),
          baseFare: priceFromUnits(data?.priceBreakdown?.baseFare),
          tax: priceFromUnits(data?.priceBreakdown?.tax),
          carrierTaxBreakdown: (data?.priceBreakdown?.carrierTaxBreakdown || []).map((item) => ({
            airlineName: item?.carrier?.name || null,
            airlineCode: item?.carrier?.code || null,
            airlineLogoUrl: item?.carrier?.logo || null,
            amount: priceFromUnits(item?.avgPerAdult),
          })),
        },
        itinerary: {
          segments: normalizedSegments,
          priceBreakdown: data?.priceBreakdown || data?.price?.breakdown || null,
          baggagePolicies: data?.baggagePolicies || [],
        },
        requirements: {
          travellerDataRequirements: data?.travellerDataRequirements || [],
          bookerDataRequirement: data?.bookerDataRequirement || [],
          travellers: data?.travellers || [],
        },
        baggage: {
          includedProducts: data?.includedProducts || null,
          bySegment: data?.includedProductsBySegment || [],
        },
        extras: {
          flexibleTicket:
            data?.offerExtras?.flexibleTicket ||
            data?.ancillaries?.flexibleTicket ||
            null,
          cabinBaggagePerTraveller:
            data?.ancillaries?.cabinBaggagePerTraveller || null,
          travelInsurance: data?.ancillaries?.travelInsurance?.options || null,
        },
      };

      cacheSet(cacheKey, details, 1000 * 60 * 60);
      return reply.send(details);
    } catch (err) {
      console.warn("[search] flights/details error", err?.message ?? String(err));
      return reply.code(500).send({ error: err?.message ?? "Flight details failed" });
    }
  });

  app.get("/activities", async (req, reply) => {
    const { lat, lng, radiusKm, city } = req.query || {};
    let latitude = lat !== undefined ? Number(lat) : null;
    let longitude = lng !== undefined ? Number(lng) : null;
    let locationLabel = null;

    try {
      if ((latitude == null || longitude == null) && city) {
        const resolved = await resolveCityGeo(String(city));
        if (resolved) {
          latitude = resolved.lat;
          longitude = resolved.lng;
          locationLabel = resolved.label;
        }
      }

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return reply
          .code(400)
          .send({ error: "lat and lng are required (or provide city if supported)" });
      }

      const activities = await searchActivities({
        lat: latitude,
        lng: longitude,
        radiusKm: radiusKm ? Number(radiusKm) : 3,
      });

      return reply.send({
        activities: activities.slice(0, 15).map((item) => ({
          ...item,
          locationLabel: locationLabel || String(city || ""),
        })),
      });
    } catch (err) {
      req.log.error(err);
      return reply.code(200).send({
        activities: [],
        warning: "activities_provider_unavailable",
      });
    }
  });
}
