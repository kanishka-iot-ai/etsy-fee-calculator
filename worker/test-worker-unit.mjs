import assert from "node:assert/strict";
import test from "node:test";
import worker from "./src/index.js";

// Mock D1 Database implementation
const mockDB = {
  prepare(sql) {
    return {
      bind(...params) {
        return this;
      },
      async first() {
        if (sql.includes("FROM fee_versions")) {
          return {
            version_id: "v1.0.0",
            version_label: "1.0.0",
            status: "active",
            created_at: "2026-10-06T00:00:00Z",
            published_at: "2026-10-06T00:00:00Z",
            source_hash: "44526eef75082b7751e59f32eff9bfaf27ad22f2cdc83446ea18a34f012adf54",
            notes: "Initial baseline seed from verified ShopProfit production dataset."
          };
        }
        if (sql.includes("country_code = ?")) {
          return {
            country_code: "UK",
            country_name: "United Kingdom",
            currency_code: "GBP",
            currency_symbol: "£",
            locale: "en-GB",
            transaction_rate: 0.065,
            listing_fee_amount: 0.16,
            processing_rate: 0.04,
            processing_fixed_amount: 0.20,
            regulatory_rate: 0.0048,
            plus_monthly_amount: 8,
            offsite_cap_amount: 80,
            version_id: "v1.0.0",
            version_label: "1.0.0",
            published_at: "2026-10-06T00:00:00Z"
          };
        }
        return null;
      },
      async all() {
        if (sql.includes("fee_rules") || sql.includes("FROM countries")) {
          return {
            results: [
              {
                country_code: "US", country_name: "United States", currency_code: "USD",
                currency_symbol: "$", locale: "en-US", sort_order: 1, transaction_rate: 0.065,
                listing_fee_amount: 0.20, processing_rate: 0.03, processing_fixed_amount: 0.25,
                regulatory_rate: 0, plus_monthly_amount: 10, offsite_cap_amount: 100
              },
              {
                country_code: "UK", country_name: "United Kingdom", currency_code: "GBP",
                currency_symbol: "£", locale: "en-GB", sort_order: 2, transaction_rate: 0.065,
                listing_fee_amount: 0.16, processing_rate: 0.04, processing_fixed_amount: 0.20,
                regulatory_rate: 0.0048, plus_monthly_amount: 8, offsite_cap_amount: 80
              }
            ]
          };
        }
        if (sql.includes("FROM review_queue")) {
          return { results: [] };
        }
        return { results: [] };
      }
    };
  }
};

const mockEnv = {
  DB: mockDB,
  ADMIN_API_KEY: "secret-test-key"
};

test("GET /health returns healthy status", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/health");
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "healthy");
  assert.equal(data.service, "shopprofit-fee-intelligence");
});

test("GET /v1/fees returns version, countryOrder, and country mappings", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/v1/fees");
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("ETag"));
  const data = await res.json();
  assert.equal(data.version, "1.0.0");
  assert.equal(data.version_id, "v1.0.0");
  assert.deepEqual(data.countryOrder, ["US", "UK"]);
  assert.equal(data.countries.US.currency, "USD");
  assert.equal(data.countries.UK.currency, "GBP");
  assert.equal(data.countries.UK.regulatoryRate, 0.0048);
  assert.ok(data.countries.UK.depositSchedule);
  assert.equal(data.countries.UK.depositSchedule.mode, "not_listed");
});

test("GET /v1/fees/:country returns specific country schedule", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/v1/fees/UK");
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.version, "1.0.0");
  assert.equal(data.version_id, "v1.0.0");
  assert.equal(data.country.code, "UK");
  assert.equal(data.country.processingRate, 0.04);
  assert.equal(data.country.regulatoryRate, 0.0048);
  assert.ok(data.country.depositSchedule);
  assert.equal(data.country.depositSchedule.mode, "not_listed");
});

test("GET /v1/version returns active version metadata", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/v1/version");
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.version_label, "1.0.0");
  assert.equal(data.status, "active");
});

test("Admin endpoints reject unauthenticated requests with 401", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/review-queue");
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 401);
});

test("Admin endpoints accept requests with valid Bearer token", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/review-queue", {
    headers: { "Authorization": "Bearer secret-test-key" }
  });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.queue, []);
});

test("OPTIONS preflight returns 204 with CORS headers", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/v1/fees", { method: "OPTIONS" });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
});

test("Public API responses include X-Content-Type-Options and Referrer-Policy", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/v1/fees");
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
});

test("Rate limiting enforces 429 when threshold exceeded and isolates endpoints", async () => {
  const { resetRateLimiter } = await import("./src/rate-limiter.js");
  resetRateLimiter();

  const customEnv = {
    ...mockEnv,
    RATE_LIMIT_OPTIONS: {
      maxRequests: 3,
      windowMs: 1000
    }
  };

  const clientHeaders = { "cf-connecting-ip": "198.51.100.42" };

  // First 3 requests to /v1/fees succeed (200)
  for (let i = 0; i < 3; i++) {
    const req = new Request("https://api.shopprofitcalculator.com/v1/fees", { headers: clientHeaders });
    const res = await worker.fetch(req, customEnv);
    assert.equal(res.status, 200, `Request ${i + 1} should be 200`);
  }

  // 4th request exceeds threshold -> 429 rate_limited
  const blockedReq = new Request("https://api.shopprofitcalculator.com/v1/fees", { headers: clientHeaders });
  const blockedRes = await worker.fetch(blockedReq, customEnv);
  assert.equal(blockedRes.status, 429);
  assert.ok(blockedRes.headers.get("Retry-After"));
  assert.equal(blockedRes.headers.get("X-Content-Type-Options"), "nosniff");
  const blockedData = await blockedRes.json();
  assert.deepEqual(blockedData, { error: "rate_limited" });

  // Endpoint isolation: /v1/version for the same IP is NOT blocked
  const versionReq = new Request("https://api.shopprofitcalculator.com/v1/version", { headers: clientHeaders });
  const versionRes = await worker.fetch(versionReq, customEnv);
  assert.equal(versionRes.status, 200);

  // After window expiration (simulate with now offset)
  const futureReq = new Request("https://api.shopprofitcalculator.com/v1/fees", { headers: clientHeaders });
  const futureEnv = {
    ...mockEnv,
    RATE_LIMIT_OPTIONS: {
      maxRequests: 3,
      windowMs: 1000,
      now: Date.now() + 2000
    }
  };
  const resetRes = await worker.fetch(futureReq, futureEnv);
  assert.equal(resetRes.status, 200);

  resetRateLimiter();
});
