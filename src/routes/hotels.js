import { searchHotelDestination, searchHotels } from "../services/hotelsService.js";
import { normalizeHotelsResponse } from "../utils/normalizeHotels.js";
import { cacheGet, cacheSet } from "../utils/memoryCache.js";

export async function hotelsRoutes(app) {
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
}
