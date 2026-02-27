const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TYPE_SET = new Set(["ONEWAY", "ROUNDTRIP"]);
const CABIN_SET = new Set(["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"]);

const bad = (reply, message) => reply.code(400).send({ error: message });

const asIntOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return null;
  return n;
};

const appendIfPresent = (qs, key, value) => {
  if (value === undefined || value === null || value === "") return;
  qs.set(key, String(value));
};

export async function flightsBookingRoutes(app) {
  app.get("/booking-url", async (req, reply) => {
    const query = req.query || {};
    const from = String(query?.from || "").trim();
    const to = String(query?.to || "").trim();
    const token = String(query?.token || "").trim();
    const depart = String(query?.depart || "").trim();
    const returnDate = String(query?.return || "").trim();
    const type = String(query?.type || "ONEWAY")
      .trim()
      .toUpperCase();
    const adultsRaw = query?.adults ?? 1;
    const childrenRaw = query?.children;
    const cabinClass = String(query?.cabinClass || "ECONOMY")
      .trim()
      .toUpperCase();

    if (!from) return bad(reply, "Missing required query param: from");
    if (!to) return bad(reply, "Missing required query param: to");
    if (!token) return bad(reply, "Missing required query param: token");
    if (!depart) return bad(reply, "Missing required query param: depart");
    if (!DATE_RE.test(depart)) return bad(reply, "Invalid query param: depart (expected YYYY-MM-DD)");
    if (returnDate && !DATE_RE.test(returnDate)) {
      return bad(reply, "Invalid query param: return (expected YYYY-MM-DD)");
    }
    if (!TYPE_SET.has(type)) {
      return bad(reply, "Invalid query param: type (expected ONEWAY or ROUNDTRIP)");
    }
    const adults = asIntOrNull(adultsRaw);
    if (adults === null || adults < 1) {
      return bad(reply, "Invalid query param: adults (expected integer >= 1)");
    }
    const children = asIntOrNull(childrenRaw);
    if (childrenRaw !== undefined && (children === null || children < 0)) {
      return bad(reply, "Invalid query param: children (expected integer >= 0)");
    }
    if (!CABIN_SET.has(cabinClass)) {
      return bad(reply, "Invalid query param: cabinClass");
    }

    const path = `https://flights.booking.com/flights/${from}-${to}/${encodeURIComponent(token)}/`;
    const qs = new URLSearchParams();
    appendIfPresent(qs, "type", type);
    appendIfPresent(qs, "adults", adults);
    appendIfPresent(qs, "cabinClass", cabinClass);
    appendIfPresent(qs, "children", childrenRaw === undefined ? undefined : children);
    appendIfPresent(qs, "from", from);
    appendIfPresent(qs, "to", to);
    appendIfPresent(qs, "depart", depart);
    appendIfPresent(qs, "return", type === "ROUNDTRIP" ? returnDate : undefined);
    appendIfPresent(qs, "fromCountry", query?.fromCountry);
    appendIfPresent(qs, "toCountry", query?.toCountry);
    appendIfPresent(qs, "fromLocationName", query?.fromLocationName);
    appendIfPresent(qs, "toLocationName", query?.toLocationName);
    appendIfPresent(qs, "sort", query?.sort);
    appendIfPresent(qs, "travelPurpose", query?.travelPurpose);
    appendIfPresent(qs, "aid", query?.aid);
    appendIfPresent(qs, "label", query?.label);
    appendIfPresent(qs, "ca_source", query?.ca_source);

    const queryString = qs.toString();
    const url = queryString ? `${path}?${queryString}` : path;
    return reply.send({ url, provider: "bookingcom15" });
  });
}
