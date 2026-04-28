/**
 * Edge
 * ----------------
 * Forwards traffic to a configured backend origin.
 * Maintained by Aryana — personal deployment.
 */

export const config = { runtime: "edge" };

// Resolve target origin once at cold start
const ORIGIN_URL = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

// Hop-by-hop and platform headers we don't forward upstream
const SKIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

export default async function handler(request) {
  // Misconfiguration guard — env not provided
  if (!ORIGIN_URL) {
    return new Response("Service unavailable: origin not configured", {
      status: 500,
    });
  }

  try {
    // Extract path+query from incoming URL without allocating a URL object
    const pathOffset = request.url.indexOf("/", 8);
    const upstreamUrl =
      pathOffset === -1
        ? ORIGIN_URL + "/"
        : ORIGIN_URL + request.url.slice(pathOffset);

    // Build forwarded headers in a single pass
    const forwardHeaders = new Headers();
    let originatingIp = null;

    for (const [key, value] of request.headers) {
      if (SKIP_HEADERS.has(key)) continue;
      if (key.startsWith("x-vercel-")) continue;

      if (key === "x-real-ip") {
        originatingIp = value;
        continue;
      }
      if (key === "x-forwarded-for") {
        if (!originatingIp) originatingIp = value;
        continue;
      }

      forwardHeaders.set(key, value);
    }

    if (originatingIp) {
      forwardHeaders.set("x-forwarded-for", originatingIp);
    }

    // Determine if request carries a body (GET/HEAD do not)
    const httpMethod = request.method;
    const carriesBody = httpMethod !== "GET" && httpMethod !== "HEAD";

    // Stream upstream, no buffering
    return await fetch(upstreamUrl, {
      method: httpMethod,
      headers: forwardHeaders,
      body: carriesBody ? request.body : undefined,
      duplex: "half",
      redirect: "manual",
    });
  } catch (err) {
    console.error("[relay] upstream error:", err);
    return new Response("Bad Gateway: upstream unreachable", { status: 502 });
  }
}
