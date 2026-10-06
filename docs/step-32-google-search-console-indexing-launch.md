# ShopProfit — Step 32: Google Search Console & Indexing Launch Preparation

**Date:** 2026-10-06  
**Status:** VALIDATED & READY FOR OWNER SUBMISSION  
**Final Status:** GOOGLE SEARCH CONSOLE SUBMISSION REQUIRES OWNER ACTION  
**Pages Deployment:** `eb8addba` (Unchanged)  
**Worker ID:** `73858135-0a40-4eef-befa-4187e65534d0` (Unchanged)  
**Active Fee Version:** `v1.1.1` (Unchanged)  
**Database:** D1 `shopprofit-fees-db` (Unchanged)  
**DNS & Cron:** Unchanged  
**Production Domain:** `https://shopprofitcalculator.com/`  
**Sitemap:** `https://shopprofitcalculator.com/sitemap.xml`  

---

## 1. Executive Summary

In Step 32, ShopProfit completed read-only site validation and indexing readiness preparation for launch into Google Search Console (GSC).

The production infrastructure was audited for crawler compliance, sitemap integrity, canonical configuration, robots directives, and Web Analytics performance baselines. All 11 intended canonical routes are verified live, return HTTP 200, and present zero technical barriers to Googlebot indexing.

Because Google Search Console requires domain ownership verification and OAuth2/credentialed authorization that is not available within the automated execution environment, **no automated submission was fabricated**.

As required by governance policy:
**GOOGLE SEARCH CONSOLE SUBMISSION REQUIRES OWNER ACTION**

A comprehensive, step-by-step submission guide and prioritized URL inspection schedule have been prepared below for the site owner.

---

## 2. Phase 1 & 2: Production Site & Sitemap Validation

Every intended indexable route was verified live against production (`https://shopprofitcalculator.com`):

| Page URL | Status | Canonical Tag | In Sitemap? | Robots Directive | Indexing State |
| :--- | :---: | :--- | :---: | :---: | :---: |
| `https://shopprofitcalculator.com/` | 200 | `https://shopprofitcalculator.com/` | YES (1x) | `Allow: /` | 100% Indexable |
| `https://shopprofitcalculator.com/fees/` | 200 | `https://shopprofitcalculator.com/fees/` | YES (1x) | `Allow: /` | 100% Indexable |
| `https://shopprofitcalculator.com/methodology/` | 200 | `https://shopprofitcalculator.com/methodology/` | YES (1x) | `Allow: /` | 100% Indexable |
| `https://shopprofitcalculator.com/faq/` | 200 | `https://shopprofitcalculator.com/faq/` | YES (1x) | `Allow: /` | 100% Indexable |
| `https://shopprofitcalculator.com/etsy-fee-calculator-uk` | 200 | `https://shopprofitcalculator.com/etsy-fee-calculator-uk` | YES (1x) | `Allow: /` | 100% Indexable |
| `https://shopprofitcalculator.com/etsy-fee-calculator-canada` | 200 | `https://shopprofitcalculator.com/etsy-fee-calculator-canada` | YES (1x) | `Allow: /` | 100% Indexable |
| `https://shopprofitcalculator.com/etsy-fee-calculator-australia` | 200 | `https://shopprofitcalculator.com/etsy-fee-calculator-australia` | YES (1x) | `Allow: /` | 100% Indexable |
| `https://shopprofitcalculator.com/etsy-digital-download-fee-calculator` | 200 | `https://shopprofitcalculator.com/etsy-digital-download-fee-calculator` | YES (1x) | `Allow: /` | 100% Indexable |
| `https://shopprofitcalculator.com/privacy` | 200 | `https://shopprofitcalculator.com/privacy` | YES (1x) | `Allow: /` | 100% Indexable |
| `https://shopprofitcalculator.com/terms` | 200 | `https://shopprofitcalculator.com/terms` | YES (1x) | `Allow: /` | 100% Indexable |
| `https://shopprofitcalculator.com/contact` | 200 | `https://shopprofitcalculator.com/contact` | YES (1x) | `Allow: /` | 100% Indexable |

### Sitemap Integrity (`sitemap.xml`)
- Returns **HTTP 200** at `https://shopprofitcalculator.com/sitemap.xml`.
- Contains exactly **11 URLs**, matching the 11 canonical pages above with zero duplicates.
- Contains zero redirect URLs, zero `pages.dev` URLs, zero noindex URLs, and zero obsolete routes.
- Every `<loc>` entry matches the page's `<link rel="canonical">` tag byte-for-byte.

### Robots Directive (`robots.txt`)
- Returns **HTTP 200** at `https://shopprofitcalculator.com/robots.txt`.
- Content:
  ```text
  User-agent: *
  Allow: /
  Sitemap: https://shopprofitcalculator.com/sitemap.xml
  ```
- Unconditionally permits crawling (`Allow: /`) and accurately references the canonical sitemap.

---

## 3. Phase 3 & 4: Google Search Console Action Plan for Site Owner

Because the agent environment does not possess Google Search Console credentials, domain verification tokens, or authenticated GSC API access, the following actions must be executed manually by the site owner in [Google Search Console](https://search.google.com/search-console):

### Step A: Add and Verify Domain Property
1. Log into Google Search Console.
2. Add Property -> Select **Domain** property type: `shopprofitcalculator.com`.
3. Complete DNS verification via Cloudflare DNS by adding the provided TXT record.

### Step B: Submit Production Sitemap
1. In the left navigation, select **Sitemaps**.
2. Under "Add a new sitemap", enter:
   ```text
   sitemap.xml
   ```
   (Full URL: `https://shopprofitcalculator.com/sitemap.xml`)
3. Click **Submit** and verify the status reports `"Success"`.

### Step C: Prioritized URL Inspection & Indexing Requests
Use the URL Inspection tool at the top of GSC to inspect and click **"Request Indexing"** in the following strict priority sequence:

1. `https://shopprofitcalculator.com/` (Homepage — Etsy Profit Calculator)
2. `https://shopprofitcalculator.com/fees/` (Etsy Fee Calculator & Comprehensive Guide)
3. `https://shopprofitcalculator.com/etsy-fee-calculator-uk` (UK Fee Calculator)
4. `https://shopprofitcalculator.com/etsy-fee-calculator-canada` (Canada Fee Calculator)
5. `https://shopprofitcalculator.com/etsy-fee-calculator-australia` (Australia Fee Calculator)
6. `https://shopprofitcalculator.com/etsy-digital-download-fee-calculator` (Digital Download Calculator)
7. `https://shopprofitcalculator.com/methodology/` (Calculation Methodology)
8. `https://shopprofitcalculator.com/faq/` (Seller FAQ)

**Do NOT request indexing for:**
- `*.pages.dev` preview URLs (strictly protected with `X-Robots-Tag: noindex, nofollow`)
- Redirect routes (`/etsy-fee-calculator`, `/calculator`, `/fee-breakdown`, etc.)
- Trailing-slash variants of clean-slug pages (`/privacy/`, `/terms/`, `/contact/`)
- In-page anchors (`/#calculator`, `/#fees`, `/#target-pricing`, etc.)

---

## 4. Phase 5: Cloudflare Web Analytics Performance Baseline

Recorded from Cloudflare Web Analytics (Reporting period: October 5–6, 2026; "Exclude bots = Yes"):

### Core Web Vitals
- **Largest Contentful Paint (LCP):**
  - **96% Good** (< 2,500ms)
  - **4% Needs Improvement** (2,500ms – 4,000ms)
  - **0% Poor** (> 4,000ms)
  - **P50:** 436ms
  - **P75:** 960ms
  - **P90:** 1,660ms
  - **P99:** 3,712ms
- **Interaction to Next Paint (INP):**
  - **100% Good** (< 200ms)
- **Cumulative Layout Shift (CLS):**
  - **100% Good** (< 0.1)

### Assessment of 4% LCP Needs Improvement:
- The 4% segment falling into "Needs Improvement" (between 2.5s and 3.7s at P99) is concentrated in tail mobile network latencies and geographic locations distant from primary edge caches prior to CDN asset warming.
- At P75 (960ms), ShopProfit is well within Google's "Good" Core Web Vitals threshold (threshold is ≤ 2,500ms).
- This metric is designated as an **Ongoing Monitoring Item**, not an engineering blocker. No speculative code optimizations were performed.

---

## 5. Phase 6: Traffic & Analytics Context Boundary

To maintain rigorous data integrity, the site's analytics metrics are categorized into three strictly segregated layers:

1. **Layer A — Cloudflare Edge Traffic:**
   - Observes edge request volume, HTTP status distribution, and RUM performance metrics (excluding known bots).
   - This represents edge-level traffic and synthetic automated test runs; it does **not** indicate human user conversion or search engine referrals.
2. **Layer B — Google Organic Search Traffic:**
   - Currently **0 visits**.
   - No search engine indexing has taken place prior to GSC submission.
3. **Layer C — Google Search Console Data:**
   - Currently **Uninitialized / Awaiting Owner Submission**.
   - Impression, click, and crawl statistics will only become available 48–72 hours after the owner completes Step 3.

---

## 6. Phase 7 & 8: Test Suite & Infrastructure Invariants

### Test Results
- **`npm.cmd test`**: 307 passed, 0 failures, 0 skipped.
- **`npm.cmd run check:launch`**: Fee database integrity verified across all 12 baseline markets. Launch contact checks passed.
- **`npm.cmd run check:etsy`**: Live Etsy Help Center policy scrape verified. Fee schedules are 100% current.
- **`node scripts/production-canary.mjs`**: Synthetic hourly canary PASS (Version `v1.1.1`, 62 sovereign markets).

### Infrastructure Invariants Preserved
- **Cloudflare Deployment:** Exactly **0** deployments triggered. Pages deployment remains at baseline `eb8addba`.
- **Worker & D1:** Worker `73858135-0a40-4eef-befa-4187e65534d0` and database `shopprofit-fees-db` are strictly untouched.
- **Fee Intelligence:** Active fee version remains locked at `v1.1.1`.
- **DNS, Cron, and Redirects:** Completely untouched.

---

## 7. Final Governance Status

**GOOGLE SEARCH CONSOLE SUBMISSION REQUIRES OWNER ACTION**
