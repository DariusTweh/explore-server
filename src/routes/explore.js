import { geocodeText } from "../utils/geocode.js";
import { searchPlacesAround } from "../utils/placesSearch.js";

export async function exploreRoutes(app) {
  app.get("/geocode", async (req, reply) => {
    try {
      const text = String(req.query?.text || "").trim();
      if (!text) {
        return reply.code(400).send({ message: "text is required" });
      }

      const result = await geocodeText(text);
      if (!result) {
        return reply.code(404).send({ message: "Location not found" });
      }

      return reply.send(result);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ message: err?.message || "Geocode failed" });
    }
  });

  app.get("/search", async (req, reply) => {
    try {
      const query = String(req.query?.query || "").trim();
      const lat = Number(req.query?.lat);
      const lng = Number(req.query?.lng);
      const radius = Number(req.query?.radius || 3000);

      if (!query) {
        return reply.code(400).send({ message: "query is required" });
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return reply.code(400).send({ message: "lat/lng are required" });
      }

      const places = await searchPlacesAround({ query, lat, lng, radius, max: 40 });
      return reply.send({ places });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ message: err?.message || "Place search failed" });
    }
  });
}
