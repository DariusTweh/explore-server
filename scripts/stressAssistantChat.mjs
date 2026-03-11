import { performance } from "node:perf_hooks";

const API_BASE = process.env.API_BASE || "http://127.0.0.1:8787";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const TOTAL_REQUESTS = toPositiveInt(process.env.REQUESTS, 100);
const CONCURRENCY = Math.min(toPositiveInt(process.env.CONCURRENCY, 10), TOTAL_REQUESTS);
const TIMEOUT_MS = toPositiveInt(process.env.TIMEOUT_MS, 30000);
const WORKSPACE_ID = process.env.WORKSPACE_ID || null;
const TRIP_ID = process.env.TRIP_ID || null;
const SAVE_JSON = process.env.SAVE_JSON || "";
const MESSAGES = parseMessages(
  process.env.MESSAGES ||
    [
      "Give me 3 practical tips to reduce travel stress.",
      "How can I sleep better on a plane?",
      "What should I always carry in a daypack?",
    ].join("|")
);
const TARGET = `${API_BASE}/api/assistant/chat`;

if (!AUTH_TOKEN) {
  console.error("Missing AUTH_TOKEN.");
  console.error(
    "Example: AUTH_TOKEN=<supabase_access_token> REQUESTS=120 CONCURRENCY=12 npm run stress:assistant:chat"
  );
  process.exit(1);
}

if (!MESSAGES.length) {
  console.error("No messages configured. Set MESSAGES as pipe-separated values.");
  process.exit(1);
}

const results = [];
let nextIndex = 0;
const startedAt = performance.now();

console.log(
  `Starting assistant stress test: ${TOTAL_REQUESTS} requests, concurrency=${CONCURRENCY}, timeout=${TIMEOUT_MS}ms`
);
console.log(`Target: ${TARGET}`);

await Promise.all(Array.from({ length: CONCURRENCY }, (_, workerId) => worker(workerId)));

const elapsedMs = performance.now() - startedAt;
const summary = summarize(results, elapsedMs);

printSummary(summary);

if (SAVE_JSON) {
  const fs = await import("node:fs/promises");
  await fs.writeFile(SAVE_JSON, JSON.stringify({ config: getConfig(), summary, results }, null, 2), "utf8");
  console.log(`Saved detailed output to ${SAVE_JSON}`);
}

if (summary.failures > 0) {
  process.exitCode = 1;
}

async function worker(workerId) {
  while (true) {
    const requestNumber = nextIndex++;
    if (requestNumber >= TOTAL_REQUESTS) return;

    const threadId = `loadtest-${Date.now()}-w${workerId}`;
    const message = MESSAGES[requestNumber % MESSAGES.length];
    const payload = {
      message,
      threadId,
      ...(WORKSPACE_ID ? { workspaceId: WORKSPACE_ID } : {}),
      ...(TRIP_ID ? { tripId: TRIP_ID } : {}),
    };

    const started = performance.now();
    try {
      const res = await fetchWithTimeout(TARGET, {
        method: "POST",
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const latencyMs = performance.now() - started;
      const body = await safeParseJson(res);
      results.push({
        ok: res.ok,
        status: res.status,
        latencyMs,
        error: extractError(body, res),
      });
    } catch (error) {
      const latencyMs = performance.now() - started;
      results.push({
        ok: false,
        status: 0,
        latencyMs,
        error: normalizeError(error),
      });
    }

    if ((requestNumber + 1) % Math.max(1, Math.floor(TOTAL_REQUESTS / 10)) === 0) {
      console.log(`Progress: ${requestNumber + 1}/${TOTAL_REQUESTS}`);
    }
  }
}

function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function safeParseJson(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

function extractError(body, res) {
  if (res.ok) return null;
  if (typeof body?.error === "string" && body.error.trim()) return body.error.trim();
  if (typeof body?.message === "string" && body.message.trim()) return body.message.trim();
  if (typeof body?.raw === "string" && body.raw.trim()) return body.raw.trim();
  return `HTTP ${res.status}`;
}

function normalizeError(error) {
  if (error?.name === "AbortError") return `Timeout after ${TIMEOUT_MS}ms`;
  if (typeof error?.message === "string" && error.message.trim()) return error.message.trim();
  return "Unknown error";
}

function summarize(allResults, elapsedMs) {
  const total = allResults.length;
  const successes = allResults.filter((r) => r.ok).length;
  const failures = total - successes;
  const latencies = allResults.map((r) => r.latencyMs).sort((a, b) => a - b);

  const statusCounts = countBy(allResults, (r) => String(r.status));
  const errorCounts = countBy(
    allResults.filter((r) => !r.ok),
    (r) => r.error || "Unknown error"
  );

  return {
    total,
    successes,
    failures,
    successRate: total ? (successes / total) * 100 : 0,
    requestsPerSecond: elapsedMs > 0 ? total / (elapsedMs / 1000) : 0,
    elapsedMs,
    latencyMs: {
      min: percentile(latencies, 0),
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: percentile(latencies, 100),
      avg: latencies.length ? latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length : 0,
    },
    statusCounts,
    topErrors: Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([error, count]) => ({ error, count })),
  };
}

function printSummary(summary) {
  console.log("\nSummary");
  console.log("-------");
  console.log(`Requests: ${summary.total}`);
  console.log(`Success: ${summary.successes}`);
  console.log(`Failures: ${summary.failures}`);
  console.log(`Success rate: ${summary.successRate.toFixed(2)}%`);
  console.log(`Throughput: ${summary.requestsPerSecond.toFixed(2)} req/s`);
  console.log(`Elapsed: ${summary.elapsedMs.toFixed(0)}ms`);

  const latency = summary.latencyMs;
  console.log(
    `Latency(ms): min=${latency.min.toFixed(1)} p50=${latency.p50.toFixed(1)} p90=${latency.p90.toFixed(
      1
    )} p95=${latency.p95.toFixed(1)} p99=${latency.p99.toFixed(1)} max=${latency.max.toFixed(1)} avg=${latency.avg.toFixed(
      1
    )}`
  );

  console.log(`Status counts: ${JSON.stringify(summary.statusCounts)}`);
  if (summary.topErrors.length) {
    console.log("Top errors:");
    for (const item of summary.topErrors) {
      console.log(`  ${item.count}x ${item.error}`);
    }
  }
}

function parseMessages(raw) {
  return String(raw || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  if (p <= 0) return sortedValues[0];
  if (p >= 100) return sortedValues[sortedValues.length - 1];
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, idx))];
}

function countBy(values, getKey) {
  const out = {};
  for (const value of values) {
    const key = getKey(value);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function getConfig() {
  return {
    apiBase: API_BASE,
    target: TARGET,
    requests: TOTAL_REQUESTS,
    concurrency: CONCURRENCY,
    timeoutMs: TIMEOUT_MS,
    workspaceId: WORKSPACE_ID,
    tripId: TRIP_ID,
    messages: MESSAGES,
  };
}
