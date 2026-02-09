import { rapidGet } from "../providers/rapidClient.js";

export async function searchAttractionLocations({ query, languagecode = "en-us" }) {
  const term = String(query || "").trim();
  if (!term || term.length < 2) {
    const err = new Error("query is required (min 2 chars)");
    err.status = 400;
    throw err;
  }

  const response = await rapidGet("/api/v1/attraction/searchLocation", {
    qs: { query: term, languagecode },
  });

  if (response?.status === false || response?.data === undefined) {
    const err = new Error("Attraction location search failed");
    err.status = 502;
    throw err;
  }

  return response.data;
}
