import { rapidGet } from "../rapidClient.js";

export async function searchFlightLocations({ query, languageCode }) {
  const qs = { query };
  if (languageCode) qs.languagecode = languageCode;
  const res = await rapidGet("/api/v1/flights/searchDestination", { qs });
  return res?.data ?? [];
}

export async function searchFlights(params) {
  const {
    fromId,
    toId,
    departDate,
    returnDate,
    stops = "none",
    pageNo = 1,
    adults = 1,
    childrenAges,
    sort = "BEST",
    cabinClass = "ECONOMY",
    currencyCode = "USD",
  } = params;

  const qs = {
    fromId,
    toId,
    departDate,
    returnDate,
    stops,
    pageNo,
    adults,
    sort,
    cabinClass,
    currency_code: currencyCode,
  };

  if (childrenAges) qs.children = childrenAges;

  const res = await rapidGet("/api/v1/flights/searchFlights", { qs });
  return res?.data ?? null;
}

function buildLegs({ fromId, toId, departDate, returnDate }) {
  const legs = [{ fromId, toId, date: departDate }];
  if (returnDate) legs.push({ fromId: toId, toId: fromId, date: returnDate });

  return `[${legs
    .map((l) => `{'fromId':'${l.fromId}','toId':'${l.toId}','date':'${l.date}'}`)
    .join(",")}]`;
}

export async function searchFlightsMultiStops(params) {
  const {
    fromId,
    toId,
    departDate,
    returnDate,
    pageNo = 1,
    adults = 1,
    childrenAges,
    sort = "BEST",
    cabinClass = "ECONOMY",
    currencyCode = "USD",
  } = params;

  const qs = {
    legs: buildLegs({ fromId, toId, departDate, returnDate }),
    pageNo,
    adults,
    sort,
    cabinClass,
    currency_code: currencyCode,
  };

  if (childrenAges) qs.children = childrenAges;

  const res = await rapidGet("/api/v1/flights/searchFlightsMultiStops", { qs });
  return res?.data ?? null;
}

export async function getFlightDetails({ token, currencyCode = "USD" }) {
  const qs = { token };
  if (currencyCode) qs.currency_code = currencyCode;
  const res = await rapidGet("/api/v1/flights/getFlightDetails", { qs });
  return res?.data ?? null;
}
