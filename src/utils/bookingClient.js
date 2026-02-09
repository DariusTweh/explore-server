import { rapidGet } from "../providers/rapidClient.js";

export async function bookingGet(path, params = {}) {
  return rapidGet(path, { qs: params });
}
