import {
  getHotelDetails,
  getHotelPhotos,
  getHotelFacilities,
} from "../services/hotelDetailsService.js";
import { normalizeHotelDetails } from "../utils/normalizeHotelDetails.js";
import { cacheGet, cacheSet } from "../utils/memoryCache.js";

export async function hotelDetailsRoutes(app) {
  app.get("/details", async (req, reply) => {
    const {
      hotel_id,
      arrival_date,
      departure_date,
      adults = 1,
      children_age,
      room_qty = 1,
      units = "metric",
      temperature_unit = "c",
      languagecode = "en-us",
      currency_code = "USD",
      raw,
    } = req.query || {};

    if (!hotel_id || !arrival_date || !departure_date) {
      return reply.code(400).send({ message: "hotel_id, arrival_date, departure_date are required" });
    }

    const cacheKey = `hotels:details:${JSON.stringify({
      hotel_id,
      arrival_date,
      departure_date,
      adults,
      children_age,
      room_qty,
      units,
      temperature_unit,
      languagecode,
      currency_code,
    })}`;
    const cached = cacheGet(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const detailsPromise = getHotelDetails({
        hotel_id,
        arrival_date,
        departure_date,
        adults,
        children_age,
        room_qty,
        units,
        temperature_unit,
        languagecode,
        currency_code,
      });

      const photosPromise = getHotelPhotos({ hotel_id }).catch(() => []);
      const facilitiesPromise = getHotelFacilities({
        hotel_id,
        arrival_date,
        departure_date,
        languagecode,
      }).catch(() => ({}));
      const [data, photos, facilities] = await Promise.all([
        detailsPromise,
        photosPromise,
        facilitiesPromise,
      ]);

      const hotel = normalizeHotelDetails(data, photos, facilities);
      const payload = { hotel };

      if (String(raw || "") === "1") {
        payload.raw = data;
      }

      cacheSet(cacheKey, payload, 1000 * 60 * 30);
      return reply.send(payload);
    } catch (err) {
      const status = err?.status || 500;
      const message = err?.message || "Hotel details failed";
      return reply.code(status).send({ message });
    }
  });
}
