# ShopProfit — Step 17: Security Header + API Rate-Limit Hardening Report

**Hardening Mode:** Production Security Header and Application-Layer Rate Limiting Implementation  
**Execution Date:** 2026-10-06  
**Auditor/Engineer:** Senior Security & Cloudflare Architecture Engineer  
**Production Targets:**
- **Cloudflare Pages:** `https://shopprofitcalculator.com/` (Deployment ID: `681f4e6b`)
- **Cloudflare Worker:** `https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev` (Version ID: `73858135-0a40-4eef-befa-4187e65534d0`)
- **Cloudflare D1 Database:** `shopprofit-fees-db` (`758e36ac-4d94-45a7-9c0d-d6a18d32780e`) — **UNCHANGED**
- **Active Release:** `v1.1.1` (62 countries, source hash: `44526eef...`) — **UNCHANGED**

---

## Executive Summary

Step 17 has successfully closed both advisory warnings identified in the Step 16 Security and Abuse-Resistance Audit:

1. **Missing Explicit Security Headers:**
   - **Cloudflare Pages:** Added explicit `Strict-Transport-Security` (HSTS) with `max-age=31536000; includeSubDomains` and an explicit, non-bypassable `Content-Security-Policy` (CSP) avoiding `unsafe-eval` and preventing script injection while permitting legitimate Google Fonts and local ES modules.
   - **Cloudflare Worker:** Added explicit `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` across all public API routes and preflight handlers.
2. **Missing Application-Layer API Rate Limiting:**
   - Designed and deployed an in-memory, zero-D1-overhead sliding window rate limiter in `worker/src/rate-limiter.js` for public routes (`/v1/fees`, `/v1/fees/:country`, `/v1/version`).
   - Generous limit: 60 requests per minute per IP per endpoint category (isolated across endpoints).
   - Rate-limited responses return HTTP `429 Too Many Requests` with a sanitized JSON payload `{ "error": "rate_limited" }` and standard `Retry-After` header without exposing IP addresses or internal limits.

All 306 automated tests pass cleanly, and live production endpoints have been verified against both Pages and Worker.

---

## 1. Baseline Preservation

Before making any changes, the baseline state was captured and verified:
- **Pages deployment:** `00dea2ce`
- **Worker deployment:** `d45b674c`
- **Active fee version:** `v1.1.1`
- **D1 Database:** `shopprofit-fees-db`
- **Test Suite Status:** 300 tests passing.

---

## 2. Pages Security Headers & Content-Security-Policy

### Headers Applied in `_headers`
```http
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

### Rationale for Content-Security-Policy Directives
- `default-src 'self'`: Restricts default fallback resources to the origin.
- `script-src 'self'`: Only allows verified ES modules from origin (`/src/app.js`, etc.). **Zero `unsafe-eval`** and **zero `unsafe-inline`** script permissions.
- `style-src 'self' https://fonts.googleapis.com 'unsafe-inline'`: Allows local stylesheets (`/styles.css`), Google Fonts stylesheets, and dynamic CSSOM attribute calculations for progress bars (e.g. `style.width`).
- `font-src 'self' https://fonts.gstatic.com`: Allows Google Fonts binary downloads (Silkscreen).
- `img-src 'self' data: https:`: Allows local vector SVGs, PNG icons, and social preview assets.
- `connect-src 'self' https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev`: Permits legitimate API fetching by `FeeIntelligenceClient`.
- `frame-ancestors 'none'`: Enforces framing protection against clickjacking, mirroring `X-Frame-Options: DENY`.
- `base-uri 'self'`: Prevents `<base>` tag injection attacks.
- `form-action 'self'`: Restricts any form targets to origin.

---

## 3. Worker Security Headers

Added `PUBLIC_SECURITY_HEADERS` in `worker/src/api.js` and merged into `CORS_HEADERS` in `worker/src/index.js`:
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

Verified live on:
- `GET /` & `GET /health`
- `GET /v1/fees`
- `GET /v1/fees/:country`
- `GET /v1/version`
- `OPTIONS` preflight requests

---

## 4. Application-Layer Rate Limiting Architecture

Implemented in `worker/src/rate-limiter.js`:

```javascript
// Rate Limiter Parameters
export const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute sliding window
export const DEFAULT_MAX_REQUESTS = 60;     // 60 requests per minute per IP per endpoint
```

### Key Safety Invariants
1. **Zero D1 Writes:** High-frequency rate limiting is tracked in Worker isolate memory using a bounded `Map()`. D1 is never touched during rate limit evaluations.
2. **Client Identification:** Uses Cloudflare Edge client header `CF-Connecting-IP`, falling back to `X-Forwarded-For`.
3. **Endpoint Isolation:** Keys are scoped as `${ip}:${endpointKey}` (e.g. `198.51.100.42:fees` vs `198.51.100.42:version`). Exceeding the threshold on `/v1/fees` does not block requests to `/v1/version`.
4. **Memory Hygiene:** If isolate bucket count exceeds 10,000, expired buckets are pruned automatically.
5. **Generous Allowance:** Normal client usage fetches `/v1/fees` once per hour (cached in client `localStorage` with a 1-hour TTL). A limit of 60 req/min provides a 60x safety margin against accidental blocking.
6. **Error Contract (HTTP 429):**
   ```json
   {
     "error": "rate_limited"
   }
   ```
   Headers returned:
   - `HTTP/1.1 429 Too Many Requests`
   - `Content-Type: application/json`
   - `Retry-After: <seconds_remaining>`
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Access-Control-Allow-Origin: *`

---

## 5. Automated Test Coverage

- Added unit and integration tests in:
  - `tests/seo.test.js`: Asserts Pages `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, and `X-Frame-Options`.
  - `tests/rate-limiting.test.js`: Asserts rate limiter standard flow (200), threshold breach (429 + `Retry-After`), endpoint isolation, and post-window reset (200).
  - `worker/test-worker-unit.mjs`: Asserts worker headers and rate limiter integration within Worker request pipeline.
- Total Test Count: **306 tests passing (100% green)**.

---

## 6. Live Production Verification

Live checks executed against deployed infrastructure:

### Pages Verification (`https://shopprofitcalculator.com/`)
- `status`: `200 OK`
- `strict-transport-security`: `max-age=31536000; includeSubDomains`
- `content-security-policy`: `default-src 'self'; script-src 'self'; ...`
- `x-content-type-options`: `nosniff`
- `referrer-policy`: `strict-origin-when-cross-origin`
- `permissions-policy`: `camera=(), microphone=(), geolocation=()`
- `x-frame-options`: `DENY`

### Worker Verification (`https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev`)
- `status`: `200 OK`
- `x-content-type-options`: `nosniff`
- `referrer-policy`: `strict-origin-when-cross-origin`
- `access-control-allow-origin`: `*`
- `content-type`: `application/json`
- `etag`: `W/"3b2ac9fe"`

### Live Version & Snapshot Immutability
- `GET /v1/version` → `v1.1.1` (`active`)
- `GET /v1/fees` → 62 markets
- `GET /v1/fees?version=v1.0.0` → 12 markets (snapshot unchanged)
- `GET /v1/fees?version=v1.1.0` → 62 markets (snapshot unchanged)
- `GET /v1/fees?version=v1.1.1` → 62 markets (snapshot unchanged)

### Security Regression Check
- `GET /api/admin/review-queue` without token → `401 Unauthorized`
- `GET /api/admin/review-queue` with invalid token → `401 Unauthorized`
- `GET /v1/fees?version=' OR 1=1--` → `404 Not Found`
- `GET /v1/fees/INVALID_COUNTRY` → `404 Not Found`
- Zero stack traces or credentials leaked in responses.

---

## 7. Cloudflare State Ledger

| Component | State | Details |
|---|---|---|
| **Pages** | `CHANGED` | Security headers (HSTS, CSP) updated; deployment `681f4e6b` |
| **Worker** | `CHANGED` | Security headers & in-memory rate limiting updated; version `73858135-0a40-4eef-befa-4187e65534d0` |
| **D1** | `UNCHANGED` | `shopprofit-fees-db` (`758e36ac-...`) intact; zero writes |
| **DNS** | `UNCHANGED` | `shopprofitcalculator.com` active |
| **Cron** | `UNCHANGED` | `0 8 * * *` scheduled policy monitor active |
| **Active Version** | `UNCHANGED` | `v1.1.1` active across all 62 markets |
| **Fee Rules** | `UNCHANGED` | Source hash `44526eef...` 100% identical |

---

## Final Status

**STEP 17 STATUS: SECURITY HARDENING PASSED**
