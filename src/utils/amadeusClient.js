
const { AMADEUS_BASE_URL, AMADEUS_CLIENT_ID, AMADEUS_CLIENT_SECRET } =
  process.env;

if (!AMADEUS_BASE_URL || !AMADEUS_CLIENT_ID || !AMADEUS_CLIENT_SECRET) {
  throw new Error(
    "Missing Amadeus env vars. Ensure AMADEUS_BASE_URL, AMADEUS_CLIENT_ID, and AMADEUS_CLIENT_SECRET are set."
  );
}

let cachedToken = null;
let tokenExpiresAt = 0;
let cachedFetch = globalThis.fetch || null;

async function getFetch() {
  if (cachedFetch) return cachedFetch;
  const mod = await import("node-fetch");
  cachedFetch = mod.default || mod;
  return cachedFetch;
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 30_000) {
    return cachedToken;
  }

  const fetchFn = await getFetch();
  const url = `${AMADEUS_BASE_URL}/v1/security/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: AMADEUS_CLIENT_ID,
    client_secret: AMADEUS_CLIENT_SECRET,
  });

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Amadeus token error ${res.status}: ${text}`);
  }

  const data = JSON.parse(text);
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + Number(data.expires_in || 0) * 1000;
  return cachedToken;
}

export async function amadeusGet(path, params = {}) {
  const token = await getToken();
  
  const url = new URL(`${AMADEUS_BASE_URL}${path}`);

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  const fetchFn = await getFetch();
  const res = await fetchFn(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Amadeus API error ${res.status}: ${text}`);
  }

  return res.json();
}
