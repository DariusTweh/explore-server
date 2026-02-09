import { rapidGet } from "../providers/rapidClient.js";

export async function getAttractionDetails({
  slug,
  currency_code = "USD",
  languagecode = "en-us",
}) {
  const safeSlug = String(slug || "").trim();
  if (!safeSlug) {
    const err = new Error("slug is required");
    err.status = 400;
    throw err;
  }

  const response = await rapidGet("/api/v1/attraction/getAttractionDetails", {
    qs: { slug: safeSlug, currency_code, languagecode },
  });

  if (response?.status === false || !response?.data) {
    const err = new Error(response?.message || "Attraction details failed");
    err.status = 502;
    throw err;
  }

  return response.data;
}
