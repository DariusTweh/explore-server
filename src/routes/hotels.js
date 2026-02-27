import {
  getRoomListWithAvailability,
  searchHotelDestination,
  searchHotels,
} from "../services/hotelsService.js";
import { normalizeHotelsResponse } from "../utils/normalizeHotels.js";
import { cacheGet, cacheSet } from "../utils/memoryCache.js";

export async function hotelsRoutes(app) {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const asInt = (value, fallback) => {
    const num = Number(value);
    if (!Number.isInteger(num)) return fallback;
    return num;
  };

  app.get("/search-destination", async (req, reply) => {
    const { query, languagecode = "en-us" } = req.query || {};
    if (!query) {
      return reply.code(400).send({ message: "query is required" });
    }

    const cacheKey = `hotels:dest:${String(query).toLowerCase()}:${languagecode}`;
    const cached = cacheGet(cacheKey);
    if (cached) return reply.send({ data: cached });

    try {
      const data = await searchHotelDestination({ query, languagecode });
      cacheSet(cacheKey, data, 1000 * 60 * 60 * 24 * 7);
      return reply.send({ data });
    } catch (err) {
      const status = err?.status || 500;
      const message = err?.message || "Hotel destination search failed";
      return reply.code(status).send({ message });
    }
  });

  app.get("/search", async (req, reply) => {
    const {
      dest_id,
      search_type,
      arrival_date,
      departure_date,
      adults = 1,
      children_age,
      room_qty = 1,
      page_number = 1,
      price_min,
      price_max,
      sort_by,
      categories_filter,
      units = "metric",
      temperature_unit = "c",
      languagecode = "en-us",
      currency_code = "USD",
      location = "US",
      raw,
    } = req.query || {};

    if (!dest_id) {
      return reply.code(400).send({ message: "dest_id is required" });
    }
    if (!search_type) {
      return reply.code(400).send({ message: "search_type is required" });
    }
    if (!arrival_date) {
      return reply.code(400).send({ message: "arrival_date is required" });
    }
    if (!departure_date) {
      return reply.code(400).send({ message: "departure_date is required" });
    }

    const cacheKey = `hotels:search:${JSON.stringify({
      dest_id,
      search_type,
      arrival_date,
      departure_date,
      adults,
      children_age,
      room_qty,
      page_number,
      price_min,
      price_max,
      sort_by,
      categories_filter,
      units,
      temperature_unit,
      languagecode,
      currency_code,
      location,
    })}`;
    const cached = cacheGet(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const data = await searchHotels({
        dest_id,
        search_type,
        arrival_date,
        departure_date,
        adults,
        children_age,
        room_qty,
        page_number,
        price_min,
        price_max,
        sort_by,
        categories_filter,
        units,
        temperature_unit,
        languagecode,
        currency_code,
        location,
      });

      const normalized = normalizeHotelsResponse(data);
      const payload = {
        totalLabel: normalized.totalLabel,
        hotels: normalized.hotels,
      };

      if (String(raw || "") === "1") {
        payload.raw = data;
      }

      cacheSet(cacheKey, payload, 1000 * 60 * 10);
      return reply.send(payload);
    } catch (err) {
      const status = err?.status || 500;
      const message = err?.message || "Hotel search failed";
      return reply.code(status).send({ message });
    }
  });

  app.get("/rooms", async (req, reply) => {
    const {
      hotel_id,
      arrival_date,
      departure_date,
      adults = 1,
      room_qty = 1,
      children_age = "",
      units = "metric",
      temperature_unit = "c",
      languagecode = "en-us",
      currency_code = "USD",
      location = "US",
    } = req.query || {};

    if (!hotel_id) {
      return reply.code(400).send({ error: "Missing required query param: hotel_id" });
    }
    if (!arrival_date) {
      return reply.code(400).send({ error: "Missing required query param: arrival_date" });
    }
    if (!departure_date) {
      return reply.code(400).send({ error: "Missing required query param: departure_date" });
    }
    if (!DATE_RE.test(String(arrival_date))) {
      return reply.code(400).send({ error: "Invalid query param: arrival_date (expected YYYY-MM-DD)" });
    }
    if (!DATE_RE.test(String(departure_date))) {
      return reply.code(400).send({ error: "Invalid query param: departure_date (expected YYYY-MM-DD)" });
    }

    try {
      const data = await getRoomListWithAvailability({
        hotel_id,
        arrival_date,
        departure_date,
        adults: asInt(adults, 1),
        room_qty: asInt(room_qty, 1),
        children_age,
        units,
        temperature_unit,
        languagecode,
        currency_code,
        location,
      });
      return reply.send(data);
    } catch (err) {
      if (err?.status && Number(err.status) !== 500) {
        return reply.code(502).send({ error: "Upstream booking provider error" });
      }
      return reply.code(500).send({ error: "Failed to load rooms availability" });
    }
  });

  app.get("/booking-url", async (req, reply) => {
    const {
      hotel_id,
      block_id,
      checkin,
      checkout,
      adults,
      rooms = 1,
      children = 0,
      hotel_url,
    } = req.query || {};

    if (!hotel_id) {
      return reply.code(400).send({ error: "Missing required query param: hotel_id" });
    }
    if (!block_id) {
      return reply.code(400).send({ error: "Missing required query param: block_id" });
    }
    if (!checkin) {
      return reply.code(400).send({ error: "Missing required query param: checkin" });
    }
    if (!checkout) {
      return reply.code(400).send({ error: "Missing required query param: checkout" });
    }
    if (!DATE_RE.test(String(checkin))) {
      return reply.code(400).send({ error: "Invalid query param: checkin (expected YYYY-MM-DD)" });
    }
    if (!DATE_RE.test(String(checkout))) {
      return reply.code(400).send({ error: "Invalid query param: checkout (expected YYYY-MM-DD)" });
    }

    const checkinMs = new Date(String(checkin)).getTime();
    const checkoutMs = new Date(String(checkout)).getTime();
    if (!Number.isFinite(checkinMs) || !Number.isFinite(checkoutMs) || checkoutMs <= checkinMs) {
      return reply.code(400).send({ error: "Invalid date range: checkout must be after checkin" });
    }

    const adultsInt = asInt(adults, NaN);
    if (!Number.isInteger(adultsInt) || adultsInt < 1) {
      return reply.code(400).send({ error: "Invalid query param: adults (expected integer >= 1)" });
    }
    const roomsInt = asInt(rooms, 1);
    if (!Number.isInteger(roomsInt) || roomsInt < 1) {
      return reply.code(400).send({ error: "Invalid query param: rooms (expected integer >= 1)" });
    }
    const childrenInt = asInt(children, 0);
    if (!Number.isInteger(childrenInt) || childrenInt < 0) {
      return reply.code(400).send({ error: "Invalid query param: children (expected integer >= 0)" });
    }

    const occupancy = [
      ...Array.from({ length: adultsInt }, () => "A"),
      ...Array.from({ length: childrenInt }, () => "C"),
    ].join(",");

    const qs = new URLSearchParams();
    qs.set("hotel_id", String(hotel_id));
    qs.set("stage", "1");
    qs.set("checkin", String(checkin));
    qs.set("checkout", String(checkout));
    qs.set("room1", occupancy);
    qs.set(`nr_rooms_${String(block_id)}`, "1");

    const aid = process.env.BOOKING_AID || "";
    const label = process.env.BOOKING_LABEL || "";
    if (aid) qs.set("aid", aid);
    if (label) qs.set("label", label);

    const url = `https://secure.booking.com/book.html?${qs.toString()}`;

    let fallbackUrl = "";
    try {
      const base =
        String(hotel_url || "").trim() || `https://www.booking.com/hotel/hotel-${hotel_id}.html`;
      const fallback = new URL(base);
      fallback.searchParams.set("checkin", String(checkin));
      fallback.searchParams.set("checkout", String(checkout));
      fallback.searchParams.set("group_adults", String(adultsInt));
      fallback.searchParams.set("group_children", String(childrenInt));
      fallback.searchParams.set("no_rooms", String(roomsInt));
      if (aid) fallback.searchParams.set("aid", aid);
      if (label) fallback.searchParams.set("label", label);
      fallbackUrl = fallback.toString();
    } catch {
      fallbackUrl = "";
    }

    return reply.send({ url, fallbackUrl });
  });
}
