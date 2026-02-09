import { rapidGet } from "../providers/rapidClient.js";

export async function getAttractionAvailabilityCalendar({ id, languagecode = "en-us" }) {
  const safeId = String(id || "").trim();
  if (!safeId) {
    const err = new Error("id is required");
    err.status = 400;
    throw err;
  }

  const response = await rapidGet("/api/v1/attraction/getAvailabilityCalendar", {
    qs: { id: safeId, languagecode },
  });

  if (response?.status === false || response?.data === undefined) {
    const err = new Error(response?.message || "Attraction availability calendar failed");
    err.status = 502;
    throw err;
  }

  return response.data;
}
