import { rapidGet } from "../providers/rapidClient.js";

export async function searchHotelDestination({ query, languagecode }) {
  const response = await rapidGet("/api/v1/hotels/searchDestination", {
    qs: { query, languagecode },
  });
  return response?.data ?? [];
}

export async function searchHotels(params) {
  const response = await rapidGet("/api/v1/hotels/searchHotels", {
    qs: { ...params },
  });
  return response?.data ?? null;
}

export async function getRoomListWithAvailability(params) {
  const response = await rapidGet("/api/v1/hotels/getRoomListWithAvailability", {
    qs: { ...params },
  });
  return response ?? null;
}
