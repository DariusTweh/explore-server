import { rapidGet } from "../providers/rapidClient.js";

export async function searchAttractions(params) {
  const response = await rapidGet("/api/v1/attraction/searchAttractions", {
    qs: { ...params },
  });

  if (response?.status === false || !response?.data) {
    const err = new Error("Attractions search failed");
    err.status = 502;
    throw err;
  }

  return response.data;
}
