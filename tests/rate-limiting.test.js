import assert from "node:assert/strict";
import test from "node:test";
import { checkRateLimit, createRateLimitResponse, resetRateLimiter } from "../worker/src/rate-limiter.js";

test("Rate limiter: normal requests return allowed=true (200 equivalent)", () => {
  resetRateLimiter();
  const req = new Request("https://api.example.com/v1/fees", {
    headers: { "cf-connecting-ip": "203.0.113.195" }
  });

  const res1 = checkRateLimit(req, "fees", { maxRequests: 2, windowMs: 1000 });
  assert.equal(res1.allowed, true);
  assert.equal(res1.remaining, 1);

  const res2 = checkRateLimit(req, "fees", { maxRequests: 2, windowMs: 1000 });
  assert.equal(res2.allowed, true);
  assert.equal(res2.remaining, 0);
});

test("Rate limiter: threshold exceeded returns allowed=false with Retry-After (429 equivalent)", () => {
  resetRateLimiter();
  const req = new Request("https://api.example.com/v1/fees", {
    headers: { "cf-connecting-ip": "203.0.113.195" }
  });

  checkRateLimit(req, "fees", { maxRequests: 2, windowMs: 1000 });
  checkRateLimit(req, "fees", { maxRequests: 2, windowMs: 1000 });

  const res3 = checkRateLimit(req, "fees", { maxRequests: 2, windowMs: 1000 });
  assert.equal(res3.allowed, false);
  assert.ok(res3.retryAfter >= 1);

  const httpRes = createRateLimitResponse(res3.retryAfter, { "Access-Control-Allow-Origin": "*" });
  assert.equal(httpRes.status, 429);
  assert.equal(httpRes.headers.get("Retry-After"), String(res3.retryAfter));
  assert.equal(httpRes.headers.get("Content-Type"), "application/json");
});

test("Rate limiter: endpoints are strictly isolated for the same client IP", () => {
  resetRateLimiter();
  const reqFees = new Request("https://api.example.com/v1/fees", {
    headers: { "cf-connecting-ip": "203.0.113.195" }
  });
  const reqVersion = new Request("https://api.example.com/v1/version", {
    headers: { "cf-connecting-ip": "203.0.113.195" }
  });

  // Exhaust fees bucket
  checkRateLimit(reqFees, "fees", { maxRequests: 1, windowMs: 5000 });
  const feesBlocked = checkRateLimit(reqFees, "fees", { maxRequests: 1, windowMs: 5000 });
  assert.equal(feesBlocked.allowed, false);

  // Version bucket must still be allowed
  const versionCheck = checkRateLimit(reqVersion, "version", { maxRequests: 1, windowMs: 5000 });
  assert.equal(versionCheck.allowed, true);
});

test("Rate limiter: resets after window expires", () => {
  resetRateLimiter();
  const req = new Request("https://api.example.com/v1/fees", {
    headers: { "cf-connecting-ip": "203.0.113.195" }
  });

  const now = 100000;
  checkRateLimit(req, "fees", { maxRequests: 1, windowMs: 1000, now });
  const blocked = checkRateLimit(req, "fees", { maxRequests: 1, windowMs: 1000, now });
  assert.equal(blocked.allowed, false);

  const futureNow = now + 1500;
  const unblocked = checkRateLimit(req, "fees", { maxRequests: 1, windowMs: 1000, now: futureNow });
  assert.equal(unblocked.allowed, true);

  resetRateLimiter();
});
