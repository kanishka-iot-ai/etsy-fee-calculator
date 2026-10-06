/**
 * ShopProfit Fee Intelligence API - In-Memory Application-Layer Rate Limiter
 *
 * Provides bounded sliding-window rate limiting for public Worker API endpoints.
 * Operates purely in-memory (per edge isolate) with zero D1 overhead.
 *
 * Invariants:
 * - Zero database writes on rate limit checks.
 * - Endpoint-isolated: Rate limits for /v1/fees, /v1/fees/:country, and /v1/version do not cross-contaminate.
 * - Sanitized responses: HTTP 429 returns only {"error": "rate_limited"} with Retry-After header.
 * - Automatic eviction: Old entries are pruned when bucket map exceeds maximum threshold.
 */

const buckets = new Map();
const MAX_BUCKETS = 10_000;

export const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute
export const DEFAULT_MAX_REQUESTS = 60;     // 60 requests per minute per IP per endpoint

/**
 * Extracts client IP identifier from request headers.
 */
export function getClientIdentifier(request) {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

/**
 * Checks rate limit for a client IP and endpoint category.
 *
 * @param {Request} request
 * @param {string} endpointKey e.g. "fees", "country_fees", "version"
 * @param {object} [options]
 * @returns {{ allowed: boolean, retryAfter: number, remaining: number }}
 */
export function checkRateLimit(request, endpointKey, options = {}) {
  const windowMs = options.windowMs || DEFAULT_WINDOW_MS;
  const maxRequests = options.maxRequests || DEFAULT_MAX_REQUESTS;
  const now = options.now || Date.now();

  const ip = getClientIdentifier(request);
  const bucketKey = `${ip}:${endpointKey}`;

  // Memory bounded safety: prune expired buckets if size exceeds MAX_BUCKETS
  if (buckets.size > MAX_BUCKETS) {
    for (const [key, record] of buckets.entries()) {
      if (now >= record.resetAt) {
        buckets.delete(key);
      }
    }
  }

  let record = buckets.get(bucketKey);
  if (!record || now >= record.resetAt) {
    record = { count: 1, resetAt: now + windowMs };
    buckets.set(bucketKey, record);
    return { allowed: true, retryAfter: 0, remaining: maxRequests - 1 };
  }

  if (record.count >= maxRequests) {
    const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return { allowed: false, retryAfter, remaining: 0 };
  }

  record.count += 1;
  return { allowed: true, retryAfter: 0, remaining: Math.max(0, maxRequests - record.count) };
}

/**
 * Builds standard sanitized HTTP 429 response.
 */
export function createRateLimitResponse(retryAfter, headers = {}) {
  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
      ...headers
    }
  });
}

/**
 * Resets the in-memory buckets (primarily for testing).
 */
export function resetRateLimiter() {
  buckets.clear();
}
