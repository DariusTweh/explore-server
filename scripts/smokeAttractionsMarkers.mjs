const API_BASE = process.env.API_BASE || "http://127.0.0.1:8787";
const id = process.env.ATTRACTIONS_ID || process.argv[2];
const city = process.env.ATTRACTIONS_CITY || process.argv[3] || "";
const country = process.env.ATTRACTIONS_COUNTRY || process.argv[4] || "";

if (!id) {
  console.error("Usage: ATTRACTIONS_ID=<id> npm run smoke:attractions:markers");
  console.error("   or: npm run smoke:attractions:markers -- <id> [city] [country]");
  process.exit(1);
}

const url = new URL(`${API_BASE}/api/attractions/search`);
url.searchParams.set("id", String(id));
url.searchParams.set("page", "1");
url.searchParams.set("sortBy", "trending");
url.searchParams.set("currency_code", "USD");
url.searchParams.set("languagecode", "en-us");
if (city) url.searchParams.set("city", city);
if (country) url.searchParams.set("country", country);

const res = await fetch(url.toString());
if (!res.ok) {
  const text = await res.text();
  console.error("Request failed:", res.status, text || res.statusText);
  process.exit(1);
}

const json = await res.json();
const markers = Array.isArray(json?.data?.markers)
  ? json.data.markers
  : Array.isArray(json?.markers)
    ? json.markers
    : [];
const products = Array.isArray(json?.data?.products)
  ? json.data.products
  : Array.isArray(json?.products)
    ? json.products
    : [];

console.log("products:", products.length);
console.log("markers:", markers.length);
if (markers[0]) {
  console.log("first marker:", {
    id: markers[0].id,
    name: markers[0].name,
    lat: markers[0].lat,
    lng: markers[0].lng,
  });
}
