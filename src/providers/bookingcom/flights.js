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

const BOOKING_URL_KEYS = [
  "bookingUrl",
  "booking_url",
  "deeplink",
  "deepLink",
  "checkoutUrl",
  "checkout_url",
  "deep_link",
  "redirectUrl",
  "redirect_url",
  "bookingLink",
  "booking_link",
  "url",
  "link",
];

const looksLikeUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value.trim());

const rankUrl = (url) => {
  const value = String(url || "").toLowerCase();
  if (value.includes("flights.booking.com/flights/")) return 100;
  if (value.includes("booking.com/flights")) return 95;
  if (value.includes("booking.com")) return 90;
  if (value.includes("checkout") || value.includes("book")) return 80;
  return 10;
};

const extractBookingUrls = (input) => {
  if (!input) return null;
  const queue = [input];
  const found = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    if (looksLikeUrl(current)) found.add(current.trim());
    if (typeof current !== "object") continue;
    for (const key of BOOKING_URL_KEYS) {
      const candidate = current?.[key];
      if (looksLikeUrl(candidate)) found.add(candidate.trim());
    }
    if (Array.isArray(current)) {
      current.forEach((item) => queue.push(item));
    } else {
      Object.values(current).forEach((value) => queue.push(value));
    }
  }
  return [...found].sort((a, b) => rankUrl(b) - rankUrl(a));
};

export async function getFlightBookingUrl({ token }) {
  const attempts = [
    { path: "/api/v1/flights/getBookingUrl", qs: { token } },
    { path: "/api/v1/flights/getFlightBookingUrl", qs: { token } },
    { path: "/api/v1/flights/getFlightDetails", qs: { token } },
  ];

  for (const attempt of attempts) {
    try {
      const res = await rapidGet(attempt.path, { qs: attempt.qs });
      const urls = extractBookingUrls(res?.data || res) || [];
      if (urls.length) return { url: urls[0], candidates: urls, raw: res };
    } catch {
      // Keep trying supported endpoints for provider variance.
    }
  }

  const err = new Error("No booking URL found for this token");
  err.status = 404;
  throw err;
}
