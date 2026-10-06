# ShopProfit — Step 19: Production Observability & Monitoring Gap Audit Report

**Audit Mode:** Strictly Read-Only Observability, Telemetry & Alerting Gap Analysis  
**Audit Date:** 2026-10-06  
**Auditor:** Senior Site Reliability & Production Architecture Auditor  
**Production Targets Audited:**
- **Cloudflare Pages:** `https://shopprofitcalculator.com/` (Deployment ID: `681f4e6b`)
- **Cloudflare Worker:** `https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev` (Version ID: `73858135-0a40-4eef-befa-4187e65534d0`)
- **Cloudflare D1 Database:** `shopprofit-fees-db` (`758e36ac-4d94-45a7-9c0d-d6a18d32780e`) — **UNCHANGED**
- **Active Release:** `v1.1.1` (62 countries, source hash: `44526eef...`) — **UNCHANGED**
- **Scheduled Monitor:** `0 8 * * *` — **UNCHANGED**

---

## Executive Summary

A comprehensive, strictly read-only audit of ShopProfit’s production observability and monitoring capabilities was conducted. The audit analyzed what is currently monitored natively by Cloudflare and the application, identified visibility gaps across the frontend, API, D1 database, rate limiter, and scheduled Cron, and established a prioritized roadmap for future observability hardening—without adding third-party tracking, cookies, or compromising user privacy.

---

## 1. Cloudflare Observability Inventory (Step 1)

| Platform Layer | Capability | Current Status | Cost / Feature Tier | What is Visible Today |
|---|---|---|---|---|
| **Cloudflare Pages** | Build & Deployment Logs | **Active** | Free | Git commit history, build step output, deployment status (`681f4e6b`). |
| **Cloudflare Pages** | Web Analytics | **Available** (Unconfigured) | Free | Privacy-friendly, cookie-less page view metrics (requires toggle in Dashboard). |
| **Cloudflare Pages** | Real-time HTTP Logpush | **Unavailable** | Enterprise | Raw edge HTTP request logs for Pages origin. |
| **Cloudflare Worker** | Standard Worker Metrics | **Active** | Free | Total requests, 2xx/3xx/4xx/5xx status breakdown, median & p99 CPU time, duration. |
| **Cloudflare Worker** | Real-time Logs (`wrangler tail`) | **Active** | Free | Live streaming of `console.log`, `console.error`, uncaught exceptions during active session. |
| **Cloudflare Worker** | Workers Analytics Engine | **Available** (Unconfigured) | Paid ($5/mo) or Beta | Writing high-cardinality custom telemetry events without hitting D1. |
| **Cloudflare Worker** | Automated Alerts (Notifications) | **Partial** | Free | Edge alerts for high error rate (> 1% 5xx) or CPU limits via email/webhook. |
| **Cloudflare D1** | Database Metrics | **Active** | Free | Read query count, write query count, database storage volume, row metrics. |
| **Cloudflare D1** | Query Failure / Slow Query Alerts | **Unavailable** | Free | No native alerting for failed prepared statements. |
| **Cloudflare Cron** | Scheduled Trigger Telemetry | **Active** | Free | Cron trigger invocation count, success/failure status in Worker Metrics dashboard. |
| **Cloudflare DNS** | Query Analytics | **Active** | Free | Total DNS queries, geographic origin, record types. |
| **Health Checks** | Cloudflare Edge Health Checks | **Unavailable** | Paid ($5/mo per 10 checks) | Automated synthetic edge probes with incident alerts. |

---

## 2. Worker Observability & Telemetry (Step 2)

### What Is Recorded Today
1. **Aggregated HTTP Request Telemetry:** Cloudflare automatically aggregates request counts, 2xx, 3xx, 4xx, and 5xx response codes, CPU time, and total duration.
2. **Unhandled Worker Exceptions:** Trapped in `worker/src/index.js` catch block:
   ```javascript
   console.error("Worker unhandled error:", err);
   ```
   Emits HTTP 500 with generic JSON `{ "error": "Internal Server Error", "message": err.message }` and logs the error to the Worker log stream.
3. **Cron Execution Audit:** `worker/src/monitor.js` records structured execution data to D1 table `monitor_runs`:
   - `run_id`, `started_at`, `completed_at`, `status`
   - `sources_checked`, `sources_changed`, `changes_detected`, `reviews_created`, `errors`, `error_message`
4. **Data Quality Telemetry:** `GET /api/admin/data-quality` returns real-time database state (country status distribution, active version, pending review counts, latest monitor run).

### What Is Missing (Gaps)
- **429 Rate-Limit Metric Segregation:** Rate-limited requests are returned by the Worker as HTTP 429. In the Cloudflare free dashboard, these are lumped into generic "4xx Client Errors" rather than tracked as a distinct rate-limit metric.
- **Persistent Error Log Storage:** Logs emitted via `console.error` are only retained during an active `wrangler tail` session or for short retention windows; historical stack traces are not persisted unless written to a table or external sink.

---

## 3. Application Failure Visibility (Step 3)

| Failure Event | Current Visibility | Log Destination | Gap Severity |
|---|---|---|---|
| **D1 Unavailable** | Trapped by global catch block → 500 response | Worker console log | **Low** (Visible in 5xx metric) |
| **D1 Query Failure** | Trapped by global catch block → 500 response | Worker console log | **Low** (Visible in 5xx metric) |
| **Malformed Fee Request** | Returns HTTP 404 with clean JSON error | Client response | **None** (Intended 404 behavior) |
| **Version Mismatch** | Client throws `FeeClientVersionMismatchError` | Browser console | **Medium** (Silent to server) |
| **Unexpected Worker Exception** | Global catch block logs error object | Worker console log | **Low** |
| **Rate-Limit Rejection** | Returns HTTP 429 `{ "error": "rate_limited" }` | Client response | **Medium** (No server counter) |
| **Cron Execution Failure** | Written to D1 `monitor_runs` with `status: 'failed'` | D1 `monitor_runs` | **Medium** (No push alert) |

---

## 4. Frontend Observability (Step 4)

### Current Architecture
The frontend is built on a **zero-tracking, privacy-first architecture**:
- **Zero Third-Party SDKs:** No Google Analytics, no Datadog, no Sentry, no cookies.
- **Fail-Safe UI States:** If the Worker API is unreachable or returns a version mismatch, `src/app.js` catches the error, calls `showErrorState()`, displays a user-facing retry banner, and disables calculator controls.

### Observability Gaps
1. **Client-Side Runtime Errors:** If a user encounters an unexpected browser exception (e.g., an obsolete browser engine failing to parse an ES module), the error is logged solely to the user's local browser console (`console.error`).
2. **CSP Violations:** Browsers enforce CSP directives locally. Currently, `_headers` does not declare a `report-to` or `report-uri` directive, so blocked resources or policy violations are not sent to any endpoint.
3. **Client Network Failures:** Failed `fetch()` calls are caught locally to render the retry banner, but the incident frequency is invisible to server maintainers.

---

## 5. Fee-Integrity Monitoring (Step 5)

### Current Baseline Guarantees
- **Frontend Version Lock:** `FeeIntelligenceClient` strictly validates `EXPECTED_VERSION_ID === 'v1.1.1'`. Any unapproved version change immediately halts calculation.
- **Automated Verification Scripts:**
  - `npm run check:launch`: Validates fee rules across all 12 baseline markets.
  - `npm run check:etsy`: Compares live official Etsy policy articles against stored content hashes.
  - `npm test`: Runs 306 deterministic tests verifying schema, version immutability, and calculation output.

### Monitoring Gaps
- **Continuous Production Drift Alert:** Verification scripts run at build time or manually. There is currently no automated background worker or external cron that pings `GET /v1/version` every hour and triggers an email alert if `version_id !== 'v1.1.1'` or `status !== 'active'`.
- **Review Queue Push Alerts:** When the daily Cron detects an Etsy policy change, it queues a review item in D1 `review_queue`, but does not dispatch a webhook (e.g., Discord/Slack/Email).

---

## 6. Cron Observability (Step 6)

### Existing Cron Implementation (`0 8 * * *`)
- **Trigger:** Cloudflare invokes `scheduled(event, env, ctx)` daily at 08:00 UTC.
- **Execution Tracking:**
  - `monitor_runs` table logs every run: start time, finish time, sources checked, changes detected, reviews created, and error messages.
  - Cloudflare Worker dashboard logs Cron trigger success/failure.
- **Observability Gaps:**
  - If a Cron run fails due to a network timeout with Etsy Help Center, the error is safely recorded in D1 `monitor_runs`, but no notification is sent to operators.
  - No dashboard widget displays "Time until next run" or "Last run status" outside of the authenticated `/api/admin/data-quality` API.

---

## 7. Alerting Gap Analysis (Step 7)

| Signal / Failure Event | Currently Monitored? | Current Mechanism | Observability Gap | Implementation Classification | Recommended Future Action |
|---|---|---|---|---|---|
| **Worker 5xx Errors** | Partial | Cloudflare aggregate dashboard | No proactive alert sent to maintainer | **2. Requires configuration only** | Configure Cloudflare Dashboard Notification for Worker errors (> 1% error rate). |
| **Worker 429 Spike** | No | In-memory limiter returns 429 | Invisible in aggregate 4xx dashboard | **3. Requires code change** | Add `console.warn('[RateLimit] Limit tripped')` for wrangler tail or log counter. |
| **API Latency Degradation** | Partial | Cloudflare p50/p99 CPU & duration metrics | No alert on latency > 1500ms | **4. Requires paid Cloudflare capability** | Configure Cloudflare Health Check ($5/mo) or free external synthetic monitor (UptimeRobot). |
| **Worker Edge Availability** | Partial | `/health` route returns 200 | No external synthetic probe pinging `/health` | **1. Available now** | Set up free GitHub Actions scheduled health check or UptimeRobot probe. |
| **D1 Query / Connection Failure** | Partial | Caught by try/catch; returns 500 | No direct database connection alert | **2. Requires configuration only** | Monitor 5xx spike in Cloudflare notifications. |
| **Cron Execution Failure** | Partial | Logged to D1 `monitor_runs` table | No push notification on `status: 'failed'` | **3. Requires code change** | Add webhook dispatch (Discord/Slack/Email) inside `executeMonitorRun` error catch. |
| **Fee-Version Drift** | Partial | Client-side strict version lock | No automated external canary alert | **1. Available now** | Add a scheduled GitHub Action checking `/v1/version` equals `v1.1.1` and `active`. |
| **Source-Hash Drift** | Yes | Daily Cron + `npm run check:etsy` | Review item created, but no notification sent | **3. Requires code change** | Add webhook notification when `reviewsCreated > 0`. |
| **Unexpected Fee Mutation** | Yes | 306 automated tests + baseline verify | Runs on commit/build, not continuous canary | **1. Available now** | Run synthetic canary tests against live `/v1/fees` on a scheduled workflow. |
| **Frontend Runtime Errors** | No | Logged locally to user's browser console | Zero visibility into real-user browser errors | **3. Requires code change** | Add lightweight CSP `report-to` endpoint or privacy-preserving error beacon. |

---

## 8. Security & Privacy Guarantees (Step 8)

All recommended future observability actions strictly adhere to the following privacy invariants:
- **Zero IP Logging:** Client IP addresses must never be stored in persistent tables or logs.
- **Zero PII Collection:** No user input data (item prices, shipping, profit targets) is logged or transmitted.
- **Zero Secret Exposure:** `ADMIN_API_KEY`, Bearer tokens, and database credentials must never be included in log messages.
- **No Third-Party Trackers:** Observability is achieved through native Cloudflare metrics, self-hosted webhooks, and GitHub Actions synthetic probes rather than intrusive user-tracking platforms.

---

## 9. Performance & Resource Impact Assessment (Step 9)

Estimates for future observability implementation:
- **Worker Latency Overhead:** **< 0.5 ms** (using native asynchronous logging and `ctx.waitUntil()`).
- **D1 Write Overhead:** **Zero additional writes** during normal traffic; writes restricted exclusively to Cron run summaries and review item creation.
- **D1 Read Overhead:** **Zero additional reads** during normal public API queries.
- **Frontend Payload Overhead:** **0 KB** (no external tracking SDKs).

---

## 10. Production Baseline Verification (Step 10)

The live production state was audited and verified against canonical values:
- **Cloudflare Pages Deployment:** `681f4e6b`
- **Cloudflare Worker Deployment:** `73858135-0a40-4eef-befa-4187e65534d0`
- **Active Fee Version:** `v1.1.1` (`active`)
- **Total Supported Markets:** `62` (61 sovereign + 1 `OTHER`)
- **Canonical Source Hash:** `44526eef75082b7751e59f32eff9bfaf27ad22f2cdc83446ea18a34f012adf54` (100% Match)

---

## 11. Prioritized Observability Recommendations

1. **Priority 1 (Zero-Cost / Config Only):**
   - Enable Cloudflare Dashboard Notifications for Worker 5xx error spikes.
   - Configure a free external synthetic health probe (e.g., UptimeRobot or GitHub Actions workflow) pinging `https://shopprofitcalculator.com/` and `https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev/health` every 15 minutes.
2. **Priority 2 (Lightweight Code Enhancement):**
   - In `worker/src/monitor.js`: Add an outbound webhook notification (Discord/Slack/Email) when `reviewsCreated > 0` or when `runStatus === 'failed'`.
   - In `_headers`: Add a privacy-preserving CSP `report-to` directive pointing to a lightweight Worker telemetry sink to detect browser-level CSP violations.
3. **Priority 3 (Enterprise Hardening):**
   - If traffic scales significantly, evaluate Cloudflare Paid Health Checks or Workers Analytics Engine for sub-second telemetry without database overhead.

---

## Final Status

**STEP 19 STATUS: OBSERVABILITY GAP AUDIT PASSED**
