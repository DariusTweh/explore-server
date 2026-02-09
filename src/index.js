import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { onboardingRoutes } from "./routes/onboarding.js";
import { searchRoutes } from "./routes/search.js";
import { tripsRoutes } from "./routes/trips.js";
import { assistantRoutes } from "./routes/assistant.js";
import { hotelsRoutes } from "./routes/hotels.js";
import { hotelDetailsRoutes } from "./routes/hotelDetails.js";
import { attractionsRoutes } from "./routes/attractions.js";
import { placesRoutes } from "./routes/places.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

await app.register(onboardingRoutes);
await app.register(searchRoutes, { prefix: "/api/search" });
await app.register(hotelsRoutes, { prefix: "/api/hotels" });
await app.register(hotelDetailsRoutes, { prefix: "/api/hotels" });
await app.register(attractionsRoutes, { prefix: "/api/attractions" });
await app.register(placesRoutes, { prefix: "/api/places" });
await app.register(tripsRoutes, { prefix: "/api/trips" });
await app.register(assistantRoutes, { prefix: "/api/assistant" });
app.get("/ping", async () => "pong");

const port = Number(process.env.PORT || 8787);
const host = "0.0.0.0";

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
