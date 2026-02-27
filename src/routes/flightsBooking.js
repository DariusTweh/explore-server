import { getFlightBookingUrl } from "../providers/bookingcom/flights.js";

const ALLOWED_BOOKING_HOSTS = [
  "booking.com",
  "flights.booking.com",
  "secure.booking.com",
  "gotogate.com",
  "expedia.com",
  "travelpayouts.com",
  "kiwi.com",
];

const isAllowedHost = (host) => {
  if (!host) return false;
  const normalized = String(host).toLowerCase();
  return ALLOWED_BOOKING_HOSTS.some(
    (allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`)
  );
};

const sanitizeBookingUrl = (value) => {
  try {
    const cleaned = String(value || "").trim().replace(/^['"]|['"]$/g, "");
    const url = new URL(cleaned);
    if (!/^https?:$/i.test(url.protocol)) return null;
    if (!isAllowedHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
};

export async function flightsBookingRoutes(app) {
  app.get("/booking-url", async (req, reply) => {
    const token = String(req.query?.token || "").trim();
    if (!token) return reply.code(400).send({ error: "Missing required query param: token" });

    try {
      const resolved = await getFlightBookingUrl({ token });
      const safeUrl = sanitizeBookingUrl(resolved?.url);
      if (!safeUrl) {
        const fallbackCandidate = Array.isArray(resolved?.candidates)
          ? resolved.candidates.map((candidate) => sanitizeBookingUrl(candidate)).find(Boolean)
          : null;
        if (fallbackCandidate) {
          return reply.send({
            url: fallbackCandidate,
            provider: "bookingcom15",
          });
        }
        return reply.code(400).send({ error: "Unsafe or invalid booking URL returned" });
      }

      return reply.send({
        url: safeUrl,
        provider: "bookingcom15",
      });
    } catch (err) {
      return reply
        .code(Number(err?.status) || 500)
        .send({ error: err?.message || "Failed to resolve booking URL" });
    }
  });
}
