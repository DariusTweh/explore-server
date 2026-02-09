import { rapidGet } from "../providers/rapidClient.js";

export async function getHotelDetails(params) {
  const { hotel_id, arrival_date, departure_date } = params || {};
  if (!hotel_id || !arrival_date || !departure_date) {
    const err = new Error("hotel_id, arrival_date, departure_date are required");
    err.status = 400;
    throw err;
  }

  const response = await rapidGet("/api/v1/hotels/getHotelDetails", {
    qs: { ...params },
  });

  if (response?.status === false || !response?.data) {
    const err = new Error(response?.message || "Hotel details provider returned no data");
    err.status = 502;
    throw err;
  }

  return response.data;
}

export async function getHotelPhotos({ hotel_id }) {
  if (!hotel_id) {
    const err = new Error("hotel_id is required");
    err.status = 400;
    throw err;
  }

  const response = await rapidGet("/api/v1/hotels/getHotelPhotos", {
    qs: { hotel_id },
  });

  if (response?.status === false) {
    const err = new Error(response?.message || "Hotel photos provider returned an error");
    err.status = 502;
    throw err;
  }

  return Array.isArray(response?.data) ? response.data : [];
}

export async function getHotelFacilities({
  hotel_id,
  arrival_date,
  departure_date,
  languagecode = "en-us",
}) {
  if (!hotel_id) {
    const err = new Error("hotel_id is required");
    err.status = 400;
    throw err;
  }

  const response = await rapidGet("/api/v1/hotels/getHotelFacilities", {
    qs: {
      hotel_id,
      arrival_date,
      departure_date,
      languagecode,
    },
  });

  if (response?.status === false) {
    const err = new Error(response?.message || "Hotel facilities provider returned an error");
    err.status = 502;
    throw err;
  }

  return response?.data || {};
}
