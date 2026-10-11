/**
 * ShopProfit Worker — Security Regression Tests
 *
 * Covers all verified security findings from the mandatory security review:
 *   M1 — err.message must not appear in HTTP 500 response bodies
 *   M2 — Admin responses (200/400/401/415/500/OPTIONS) must not emit Access-Control-Allow-Origin: *
 *   L1 — timingSafeEqual: correct tokens pass, wrong/prefix tokens fail
 *   L2 — Admin POST routes reject non-JSON Content-Type with 415 and malformed JSON with 400
 *   L3 — isValidEtsySourceId and executeMonitorRun reject invalid source_id formats before fetch
 *   L4 — validateWebhookUrl and executeMonitorRun enforce HTTPS, approved hosts, and redirect: "error"
 */

import assert from "node:assert/strict";
import test from "node:test";
import worker from "./src/index.js";
import { verifyAdminAuth } from "./src/admin.js";
import { OFFICIAL_SOURCES } from "./src/governance.js";
import {
  isValidEtsySourceId,
  validateWebhookUrl,
  executeMonitorRun
} from "./src/monitor.js";

// ─── Shared mock infrastructure ───────────────────────────────────────────────

const mockDB = {
  prepare(sql) {
    return {
      bind(...params) { return this; },
      async first() {
        if (sql.includes("FROM fee_versions")) {
          return {
            version_id: "v1.0.0", version_label: "1.0.0", status: "active",
            created_at: "2026-10-06T00:00:00Z", published_at: "2026-10-06T00:00:00Z",
            source_hash: "abc123", notes: "Test baseline"
          };
        }
        if (sql.includes("review_queue")) return null;
        return null;
      },
      async all() {
        if (sql.includes("fee_rules") || sql.includes("FROM countries")) {
          return {
            results: [{
              country_code: "US", country_name: "United States", currency_code: "USD",
              currency_symbol: "$", locale: "en-US", sort_order: 1, transaction_rate: 0.065,
              listing_fee_amount: 0.20, processing_rate: 0.03, processing_fixed_amount: 0.25,
              regulatory_rate: 0, plus_monthly_amount: 10, offsite_cap_amount: 100
            }]
          };
        }
        return { results: [] };
      }
    };
  }
};

const mockEnv = {
  DB: mockDB,
  ADMIN_API_KEY: "valid-test-token-abc123"
};

// ─── M1: HTTP 500 must not expose err.message ──────────────────────────────

test("M1: HTTP 500 response must not include a 'message' field containing internal error details", async () => {
  const throwingEnv = {
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async first() { throw new Error("D1 internal schema detail: table fee_versions has X rows"); },
          async all() { throw new Error("D1 internal schema detail: table fee_rules has X rows"); }
        };
      }
    },
    ADMIN_API_KEY: "valid-test-token-abc123"
  };

  const req = new Request("https://api.shopprofitcalculator.com/v1/fees");
  const res = await worker.fetch(req, throwingEnv);
  assert.equal(res.status, 500, "Should return HTTP 500");
  const body = await res.json();
  assert.deepEqual(body, { error: "Internal Server Error" });
  assert.ok(!("message" in body), "HTTP 500 body must NOT contain a 'message' field");
  assert.ok(!JSON.stringify(body).includes("D1 internal schema"), "HTTP 500 body must NOT leak internal error details");
});

// ─── M2: Admin routes must not include CORS wildcard ───────────────────────

test("M2: Unauthenticated admin request (401) must not emit Access-Control-Allow-Origin: *", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/review-queue");
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 401, "Should be 401 Unauthorized");
  assert.equal(
    res.headers.get("Access-Control-Allow-Origin"),
    null,
    "Admin 401 must NOT include Access-Control-Allow-Origin header"
  );
});

test("M2: Authenticated admin request (200) must not emit Access-Control-Allow-Origin: *", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/review-queue", {
    headers: { "Authorization": "Bearer valid-test-token-abc123" }
  });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get("Access-Control-Allow-Origin"),
    null,
    "Admin 200 must NOT include Access-Control-Allow-Origin header"
  );
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
});

test("M2: OPTIONS preflight on admin route must not emit Access-Control-Allow-Origin: *", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/review-queue", {
    method: "OPTIONS"
  });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 204);
  assert.equal(
    res.headers.get("Access-Control-Allow-Origin"),
    null,
    "Admin OPTIONS preflight must NOT emit Access-Control-Allow-Origin: *"
  );
});

test("M2: Public API routes retain Access-Control-Allow-Origin: *", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/v1/fees");
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*", "Public API must retain CORS wildcard");
});

test("M2: OPTIONS preflight on public route retains CORS wildcard", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/v1/fees", { method: "OPTIONS" });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
});

// ─── L1: timingSafeEqual via verifyAdminAuth ──────────────────────────────

test("L1: verifyAdminAuth returns true for exact matching token", () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/review-queue", {
    headers: { "Authorization": "Bearer valid-test-token-abc123" }
  });
  assert.equal(verifyAdminAuth(req, mockEnv), true, "Correct token should authenticate");
});

test("L1: verifyAdminAuth returns false for wrong token (timing-safe path is exercised)", () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/review-queue", {
    headers: { "Authorization": "Bearer wrong-token" }
  });
  assert.equal(verifyAdminAuth(req, mockEnv), false, "Wrong token should be rejected");
});

test("L1: verifyAdminAuth returns false for prefix-match token (not a substring oracle)", () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/review-queue", {
    headers: { "Authorization": "Bearer valid" }
  });
  assert.equal(verifyAdminAuth(req, mockEnv), false, "Prefix token must be rejected");
});

test("L1: verifyAdminAuth returns false for missing Authorization header", () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/review-queue");
  assert.equal(verifyAdminAuth(req, mockEnv), false);
});

test("L1: verifyAdminAuth returns false when ADMIN_API_KEY is absent from env", () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/review-queue", {
    headers: { "Authorization": "Bearer valid-test-token-abc123" }
  });
  assert.equal(verifyAdminAuth(req, {}), false, "No key in env should reject all requests");
});

// ─── L2: Content-Type and JSON body validation on admin POST routes ─────────

test("L2: Admin POST without Content-Type header returns 415", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/approve-change", {
    method: "POST",
    headers: { "Authorization": "Bearer valid-test-token-abc123" }
  });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 415, "Missing Content-Type should return 415");
  const body = await res.json();
  assert.match(body.error, /Unsupported Media Type/i);
});

test("L2: Admin POST with Content-Type: text/plain returns 415", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/approve-change", {
    method: "POST",
    headers: {
      "Authorization": "Bearer valid-test-token-abc123",
      "Content-Type": "text/plain"
    },
    body: "{}"
  });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 415, "text/plain Content-Type should return 415");
});

test("L2: Admin POST with malformed JSON returns 400 Bad Request (not 500)", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/approve-change", {
    method: "POST",
    headers: {
      "Authorization": "Bearer valid-test-token-abc123",
      "Content-Type": "application/json"
    },
    body: "{invalid json"
  });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Malformed JSON/i);
});

test("L2: Admin POST with JSON null/array returns 400 Bad Request (not 500 TypeError)", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/approve-change", {
    method: "POST",
    headers: {
      "Authorization": "Bearer valid-test-token-abc123",
      "Content-Type": "application/json"
    },
    body: "null"
  });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /JSON body must be an object/i);
});

test("L2: Admin POST with Content-Type: application/json is accepted (not rejected at Content-Type layer)", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/approve-change", {
    method: "POST",
    headers: {
      "Authorization": "Bearer valid-test-token-abc123",
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({ review_id: "test-id" })
  });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 404, "Valid JSON reaches handler and returns 404 for unknown review_id");
});

test("L2: Admin POST 415 response must not include CORS wildcard (M2 coverage)", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/approve-change", {
    method: "POST",
    headers: {
      "Authorization": "Bearer valid-test-token-abc123",
      "Content-Type": "text/xml"
    },
    body: "<data/>"
  });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 415);
  assert.equal(
    res.headers.get("Access-Control-Allow-Origin"),
    null,
    "Admin 415 must NOT emit CORS wildcard"
  );
});

// ─── L3: source_id format validation ──────────────────────────────────────

test("L3: isValidEtsySourceId accepts all 8 registered official Etsy article IDs", () => {
  for (const id of OFFICIAL_SOURCES) {
    assert.ok(isValidEtsySourceId(id), `Known official source ID ${id} should be accepted`);
  }
});

test("L3: isValidEtsySourceId rejects invalid or malicious source_id formats", () => {
  const invalidIds = [
    "../etc/passwd",
    "1;DROP TABLE source_registry",
    "javascript:alert(1)",
    "http://evil.com/",
    "115015628847.evil.com",
    "115015628847?foo=bar",
    "115015628847#frag",
    "12345678",
    "1234567890123456",
    "",
    "abc123def456",
    " 115015628847",
    null,
    undefined
  ];
  for (const id of invalidIds) {
    assert.equal(isValidEtsySourceId(id), false, `Invalid source_id "${id}" should be rejected`);
  }
});

test("L3: executeMonitorRun skips malformed source_id without calling fetch", async () => {
  const fetchedUrls = [];
  const monitorEnv = {
    fetchOverride: async (url) => {
      fetchedUrls.push(url);
      return new Response(JSON.stringify({ article: { body: "<p>ok</p>" } }), { status: 200 });
    },
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async all() {
            if (sql.includes("FROM source_registry")) {
              return {
                results: [
                  { source_id: "../../internal-metadata", source_name: "Tampered", source_url: "https://help.etsy.com", latest_hash: "h1" },
                  { source_id: "115015628847", source_name: "Payment Processing", source_url: "https://help.etsy.com/hc/en-us/articles/115015628847", latest_hash: "h2" }
                ]
              };
            }
            return { results: [] };
          },
          async run() { return { success: true }; }
        };
      }
    }
  };

  const result = await executeMonitorRun(monitorEnv);
  assert.equal(result.sourcesChecked, 2);
  assert.equal(result.errors, 1, "Invalid source_id should increment error count");
  assert.equal(fetchedUrls.length, 1, "Only the valid Etsy source_id should trigger fetch");
  assert.equal(fetchedUrls[0], "https://help.etsy.com/api/v2/help_center/en-us/articles/115015628847.json");
});

// ─── L4: validateWebhookUrl and redirect protection ───────────────────────

test("L4: validateWebhookUrl accepts HTTPS URLs for approved hosts and custom allowedHosts", () => {
  assert.equal(
    validateWebhookUrl("https://hooks.slack.com/services/T000/B000/xxx"),
    "https://hooks.slack.com/services/T000/B000/xxx"
  );
  assert.equal(
    validateWebhookUrl("https://shopprofitcalculator.com/api/webhook"),
    "https://shopprofitcalculator.com/api/webhook"
  );
  assert.equal(
    validateWebhookUrl("https://alerts.example.org/hook", { allowedHosts: "alerts.example.org" }),
    "https://alerts.example.org/hook"
  );
});

test("L4: validateWebhookUrl rejects http://, malformed URLs, credentials, IPs, localhost, and unapproved hosts", () => {
  const rejected = [
    "http://hooks.slack.com/services/T000/B000/xxx", // non-HTTPS
    "https://user:pass@hooks.slack.com/services/x",  // embedded credentials
    "https://localhost/hook",                        // localhost
    "https://127.0.0.1/hook",                        // loopback IP
    "https://169.254.169.254/latest/meta-data/",     // cloud metadata IP
    "https://192.168.1.1/hook",                      // private IP
    "https://[::1]/hook",                            // IPv6 loopback
    "https://internal.local/hook",                   // .local domain
    "https://unapproved-domain.example.com/hook",    // unapproved host
    "ftp://hooks.slack.com/hook",                    // non-HTTPS scheme
    "javascript:alert(1)",                           // script scheme
    "not-a-url",                                     // malformed
    "",
    null,
    undefined
  ];
  for (const candidate of rejected) {
    assert.equal(validateWebhookUrl(candidate), null, `Webhook URL "${candidate}" must be rejected`);
  }
});

test("L4: executeMonitorRun enforces redirect:'error' on approved webhooks and blocks unapproved webhook URLs", async () => {
  const fetchCalls = [];
  const makeMonitorEnv = (webhookUrl) => ({
    ALERT_WEBHOOK_URL: webhookUrl,
    fetchOverride: async (url, init = {}) => {
      fetchCalls.push({ url, init });
      if (url.includes("help.etsy.com")) {
        return new Response(JSON.stringify({ article: { body: "<p>changed content</p>" } }), { status: 200 });
      }
      return new Response("ok", { status: 200 });
    },
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async all() {
            if (sql.includes("FROM source_registry")) {
              return {
                results: [
                  { source_id: "115015628847", source_name: "Payment Processing", source_url: "https://help.etsy.com/hc/en-us/articles/115015628847", latest_hash: "old_hash_value" }
                ]
              };
            }
            return { results: [] };
          },
          async run() { return { success: true }; }
        };
      }
    }
  });

  // 1. Unapproved or non-HTTPS webhook must not be fetched
  await executeMonitorRun(makeMonitorEnv("http://hooks.slack.com/services/T0/B0/X"));
  assert.equal(fetchCalls.length, 1, "Insecure http:// webhook must not be called");
  assert.equal(fetchCalls[0].init.redirect, "error", "Etsy article fetch must use redirect:'error'");

  // 2. Approved HTTPS webhook is fetched with redirect: "error"
  fetchCalls.length = 0;
  await executeMonitorRun(makeMonitorEnv("https://hooks.slack.com/services/T0/B0/X"));
  assert.equal(fetchCalls.length, 2, "Approved https:// webhook should be called");
  assert.equal(fetchCalls[1].url, "https://hooks.slack.com/services/T0/B0/X");
  assert.equal(fetchCalls[1].init.redirect, "error", "Webhook fetch must set redirect:'error'");
});

// ─── Identifier validation on public & admin routes ───────────────────────

test("Validation: GET /v1/fees/:country rejects malformed country identifiers with 400", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/v1/fees/INVALID_COUNTRY_123");
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 400);
});

test("Validation: GET /v1/fees?version= rejects malformed version parameter with 400", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/v1/fees?version=../../etc/passwd");
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 400);
});

test("Validation: GET /api/admin/review/:id rejects malformed reviewId with 400", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/review/bad$id!@#", {
    headers: { "Authorization": "Bearer valid-test-token-abc123" }
  });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 400);
});

// ─── Existing invariants must still hold after hardening ──────────────────

test("Existing: public API GET /v1/fees still returns 200 after hardening", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/v1/fees");
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.version_id, "v1.0.0");
});

test("Existing: unauthenticated admin GET still returns 401 after hardening", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/review-queue");
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 401);
});

test("Existing: authenticated admin GET review-queue still returns 200 after hardening", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/api/admin/review-queue", {
    headers: { "Authorization": "Bearer valid-test-token-abc123" }
  });
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 200);
});

test("Existing: GET /health still returns healthy after hardening", async () => {
  const req = new Request("https://api.shopprofitcalculator.com/health");
  const res = await worker.fetch(req, mockEnv);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "healthy");
});
