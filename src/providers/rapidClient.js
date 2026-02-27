const HOST = process.env.RAPIDAPI_HOST || "booking-com15.p.rapidapi.com";
const BASE_URL = `https://${HOST}`;
const RAPID_API_KEY = process.env.RAPID_API_KEY || process.env.RAPIDAPI_KEY;

const MAX_ATTEMPTS = 3;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function rapidGet(path, { qs = {} } = {}) {
  if (!RAPID_API_KEY) {
    const err = new Error("Missing RAPID_API_KEY");
    err.status = 500;
    throw err;
  }

  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(qs)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-rapidapi-key": RAPID_API_KEY,
        "x-rapidapi-host": HOST,
      },
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      await delay(300 * attempt);
      continue;
    }

    if (!res.ok || json?.status === false) {
      const err = new Error(json?.message || "RapidAPI request failed");
      err.status = res.status;
      err.payload = json;
      throw err;
    }

    return json;
  }

  const err = new Error("RapidAPI request failed");
  err.status = 429;
  throw err;
}
