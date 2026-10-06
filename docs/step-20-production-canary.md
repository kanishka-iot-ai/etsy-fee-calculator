# Step 20 — Live Production Synthetic Canary Documentation

## 1. Overview
The **ShopProfit Production Synthetic Canary** provides continuous, automated, zero-cost monitoring of the live ShopProfit Fee Intelligence API (`https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev`). It runs via GitHub Actions on a scheduled hourly cadence and can be triggered on demand via workflow dispatch.

---

## 2. Workflow Specifications
- **Workflow Path:** `.github/workflows/production-canary.yml`
- **Execution Script:** `scripts/production-canary.mjs`
- **Trigger Schedule:**
  - Automated: Hourly cron schedule (`0 * * * *`)
  - Manual: `workflow_dispatch` trigger via GitHub Actions UI / CLI
- **Runner Environment:** `ubuntu-latest`
- **Runtime:** Node.js v20 (zero external npm dependencies required; relies strictly on Node built-in `fetch` and `AbortController`)
- **Permissions:** `contents: read`

---

## 3. Endpoints Audited
The synthetic canary probes the following live production Cloudflare Worker endpoints:
1. `GET /health` — Worker health and availability
2. `GET /v1/version` — Active release version and source hash metadata
3. `GET /v1/fees` — Active global fee catalog and country index
4. `GET /v1/fees/US` — United States country-specific endpoint
5. `GET /v1/fees/IN` — India country-specific endpoint
6. `GET /v1/fees/TR` — Turkey country-specific endpoint
7. `GET /v1/fees/VN` — Vietnam country-specific endpoint
8. `GET /v1/fees?version=v1.0.0` — Historical snapshot v1.0.0
9. `GET /v1/fees?version=v1.1.0` — Historical snapshot v1.1.0
10. `GET /v1/fees?version=v1.1.1` — Historical snapshot v1.1.1

---

## 4. Assertions and Validation Matrix

### A. Health & Version State
- `/health`: HTTP 200, status strictly equals `"healthy"`.
- `/v1/version`: HTTP 200, `version_id` strictly equals `"v1.1.1"`, status strictly equals `"active"`.
- **Source Provenance:** `source_hash` strictly equals canonical composite hash:
  `44526eef75082b7751e59f32eff9bfaf27ad22f2cdc83446ea18a34f012adf54`

### B. Global Market Schedule
- `/v1/fees`: HTTP 200, `version_id` strictly equals `"v1.1.1"`.
- `countryOrder`: Contains exactly 62 markets.
- `countries`: Dictionary maps exactly 62 keys (61 sovereign countries + `OTHER` USD fallback).

### C. Country-Specific Endpoints
- Individual requests to `/v1/fees/{US,IN,TR,VN}` return HTTP 200.
- Payload contains matching `country.code`.
- Numeric rates (`processingRate`, `listingFee`) are populated and non-null.

### D. Fee Policy Baseline Integrity
- **United States (US):**
  - Processing rate: 3.0% (`0.03`)
  - Processing fixed: $0.25 (`0.25`)
  - Listing fee: $0.20 (`0.20`)
  - Offsite ads fee cap: $100.00 (`100`)
- **United Kingdom (UK):**
  - Regulatory operating fee rate: 0.48% (`0.0048`)
- **Turkey (TR):**
  - Statutory deposit schedule: 50 TRY minimum, 600 TRY threshold, 42 TRY deposit fee.
- **Vietnam (VN):**
  - Statutory deposit schedule: 45,000 VND minimum, 2,300,000 VND threshold, 45,000 VND deposit fee.
- **Global Fallback (OTHER):**
  - Record present with currency `"USD"`.

### E. Historical Snapshot Immutability
- `/v1/fees?version=v1.0.0`: HTTP 200, `version_id === "v1.0.0"`, exactly 12 markets.
- `/v1/fees?version=v1.1.0`: HTTP 200, `version_id === "v1.1.0"`, exactly 62 markets.
- `/v1/fees?version=v1.1.1`: HTTP 200, `version_id === "v1.1.1"`, exactly 62 markets.

---

## 5. Security and Zero Secrets Architecture
- **Zero Secrets:** The canary interacts solely with public read-only GET endpoints.
- **No Credentials Required:** Does not require `CLOUDFLARE_API_TOKEN`, `ADMIN_KEY`, or any database credentials.
- **No Third-Party Webhooks:** No Slack, Discord, or external webhook configurations needed.
- **Native Failure Alerting:** Unhandled exceptions or assertion failures trigger `process.exit(1)`. GitHub Actions natively registers job failure and notifies repository maintainers via GitHub notifications and emails.

---

## 6. Output & Error Handling

### Standard Success Output
When all assertions pass, the canary logs:
```
ShopProfit production canary: PASS
Version: v1.1.1
Markets: 62
Health: PASS
API: PASS
Historical snapshots: PASS
Fee integrity: PASS
```

### Diagnostic Failure Handling
On any assertion error or network timeout:
```
::error::ShopProfit production canary FAILED
CANARY ERROR: <diagnostic details>
Steps Completed: <JSON summary of completed stages>
```
Process exits with code `1`.

---

## 7. Production Invariants Preserved
- Cloudflare Pages: Deployment `681f4e6b` untouched.
- Cloudflare Worker: Deployment `73858135-0a40-4eef-befa-4187e65534d0` untouched.
- Cloudflare D1: Database `shopprofit-fees-db` unmodified (zero writes/mutations).
- Cloudflare Cron: `0 8 * * *` unchanged.
- Active Version: `v1.1.1` immutable.
