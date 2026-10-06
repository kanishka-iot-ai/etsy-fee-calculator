# ShopProfit — Step 29: /fees/ Search-Intent & Calculator SEO Fix

**Date:** 2026-10-06  
**Status:** COMPLETE & VERIFIED  
**Pages Deployment:** `d0d28d76` (Previous: `c707772f`)  
**Worker ID:** `73858135-0a40-4eef-befa-4187e65534d0` (Unchanged)  
**Active Fee Version:** `v1.1.1` (Unchanged)  
**Database:** D1 `shopprofit-fees-db` (Unchanged)  

---

## 1. Executive Summary

In Step 22 (SEO Audit), `/fees/` was identified as having a search-intent mismatch: the high-volume search query `"Etsy fee calculator"` was targeting a purely educational/informational guide without an interactive calculation tool, while the legacy route `/etsy-fee-calculator` was 301-redirected to `/fees/`. Users searching for an Etsy fee calculator expect immediate computation capability.

In Step 29, we executed a controlled search-intent resolution:
1. **Audited architecture & chose Option A:** Converted `/fees/` into the definitive **"Etsy Fee Calculator"** landing page by embedding the responsive calculator interface and fee ledger, backed by the existing production client architecture (`src/app.js`), while retaining the deep educational fee guide and FAQ schema below the fold.
2. **Prevented keyword cannibalization:**
   - Homepage (`/`) is strictly dedicated to **"Etsy Profit Calculator"** (focus: unit profitability, margin %, target pricing, break-even analysis).
   - `/fees/` is dedicated to **"Etsy Fee Calculator"** (focus: exact platform fee breakdown, 6.5% transaction, payment processing rates across 62 countries, regulatory surcharges, Offsite Ads).
3. **Preserved single primary H1 hierarchy:** Single `<h1>Etsy Fee Calculator</h1>` with the brand slogan `"KNOW WHAT YOU KEEP."` styled as a non-H1 visual element (`<div class="hero-title">`).
4. **Verified live production:** Cloudflare Pages deployment `d0d28d76` is live with HTTP 200, clean indexability (`X-Robots-Tag: null`), legacy 301 redirect intact, preview domain protection intact, and zero regressions across all routes.

---

## 2. Architectural Decision Analysis

### Option A vs. Option B Comparison
- **Option A (Embed Calculator on `/fees/`):**
  - Satisfies immediate search intent for searchers typing `"Etsy fee calculator"`.
  - Harmonizes with the legacy redirect rule (`/etsy-fee-calculator 301 -> /fees/`), ensuring users following old backlinks receive an interactive tool immediately.
  - Distinguishes clearly from the homepage (`/`), creating two distinct, non-competing intent clusters:
    - `/` = Profit & Margins (`Etsy Profit Calculator`)
    - `/fees/` = Fee Breakdown & Deductions (`Etsy Fee Calculator`)
  - Leverages the existing isomorphic fee engine client (`src/app.js`) without introducing duplicate calculation models or altering API contracts.
- **Option B (Separate Canonical URL + Informational `/fees/`):**
  - Would fracture authority between `/fees/` and another route.
  - Would break user expectations arriving from `/etsy-fee-calculator`.

**Decision:** Option A was unanimously selected and implemented.

---

## 3. Implementation Details

### A. Landing Page Transformation (`fees.html` & `fees/index.html`)
- **Metadata:**
  - `<title>Etsy Fee Calculator — Calculate Etsy Seller Fees | ShopProfit</title>`
  - `<meta name="description" content="Calculate your exact Etsy seller fees with ShopProfit. Accurate Etsy fee calculator modeling the 6.5% transaction fee, payment processing, listing fees, and Offsite Ads.">`
  - Canonical: `https://shopprofitcalculator.com/fees/`
- **Heading Hierarchy:**
  - Brand slogan: `<div class="hero-title" id="hero-title" aria-label="Know what you keep.">` (non-heading styling)
  - Single primary H1: `<h1 id="calculator-heading">Etsy Fee Calculator</h1>`
- **Interactive Calculator Interface:**
  - Form `#sale-form` with item price, shipping charged, item cost, packaging cost, seller country selector (62 markets), Etsy Plus toggle, and Offsite Ads tiers (None, 15%, 12%).
  - Real-time result panel (`aside.result-panel`) showing gross profit, margin %, fee total, itemized fee breakdown ledger, break-even price, and target pricing solver.
  - Client script: `<script type="module" src="/src/app.js"></script>`.
- **Educational Guide & AEO/GEO Blocks:**
  - Direct Answer summary block for AI/search engine extraction.
  - Visual stat callout cards for key rates: 6.5% transaction fee, $0.20 listing fee, 3%–6.5% processing, 0.05%–1.97% regulatory operating fee.
  - 8 core fee topics explained in detail (listing fees, transaction fees, payment processing, regulatory fees, Offsite Ads, 2.5% FX conversion, shipping fee treatment, Etsy Plus).
  - 3 concrete worked scenario ledgers (digital download, ceramic mug, international sale with regulatory fee).
  - 6 FAQs with `FAQPage` JSON-LD structured data schema.
  - Internal links to homepage, methodology, FAQ, and regional calculators.

### B. Mirroring for Native Pages Serving
- Synchronized `fees/index.html` to match `fees.html` identically via `npm run build:seo` to prevent Cloudflare Pages 200-rewrite loops.

### C. Test Updates (`tests/seo.test.js`)
- Updated title expectation to `"Etsy Fee Calculator — Calculate Etsy Seller Fees | ShopProfit"`.
- Updated H1 assertion to verify single `<h1>Etsy Fee Calculator</h1>`.
- Added assertion verifying presence of `#sale-form` interactive calculator form and `#result-heading` ledger.

---

## 4. Preservation of Invariants

| Component | Status | Verification |
| :--- | :--- | :--- |
| **Cloudflare Worker** | UNTOUCHED | ID `73858135-0a40-4eef-befa-4187e65534d0` |
| **Worker Endpoints** | UNTOUCHED | Health: `healthy`, Version: `v1.1.1` |
| **D1 Database** | UNTOUCHED | `shopprofit-fees-db` intact |
| **Cloudflare Cron** | UNTOUCHED | `0 8 * * *` scheduled |
| **Active Fee Version** | UNTOUCHED | `v1.1.1` (62 markets) |
| **Fee Rules & Math** | UNTOUCHED | Exactly one calculation model |
| **DNS** | UNTOUCHED | Custom domain & subdomains unchanged |
| **Homepage (`/`)** | UNTOUCHED | Preserved as `Etsy Profit Calculator` |
| **Regional Pages** | UNTOUCHED | UK, Canada, Australia, Digital preserved |

---

## 5. Verification & Test Evidence

### Local Test Execution
- **`npm test`**: All 307 tests passed (0 failures, 0 skipped).
- **`npm run check:launch`**: Launch readiness and contact checks passed.
- **`npm run check:etsy`**: Live Etsy Help Center policy check passed.
- **Worker test suites**:
  - `node worker/test-discovery.mjs`: 20/20 passed.
  - `node worker/test-publishing.mjs`: 29/29 passed.
  - `node worker/test-worker-unit.mjs`: 9/9 passed.
- **Production canary (`scripts/production-canary.mjs`)**: PASS (Version `v1.1.1`, 62 markets).

### Live Production Deployment & Endpoints
- **Cloudflare Pages Deployment ID:** `d0d28d76`
- **Live Production URL Checks (`scripts/verify-step29-live.mjs`):**
  - `https://shopprofitcalculator.com/fees/`:
    - Status: HTTP 200
    - `X-Robots-Tag`: `null` (fully indexable)
    - Single H1: `"Etsy Fee Calculator"`
    - `#sale-form`: Present & active
    - `aside.result-panel`: Present & active
    - Script `/src/app.js`: Present
    - `FAQPage` JSON-LD: Present
  - `https://shopprofitcalculator.com/`:
    - Status: HTTP 200
    - Single H1: `"Etsy Profit Calculator"`
  - `https://shopprofitcalculator.com/etsy-fee-calculator`:
    - Status: HTTP 301
    - Location: `/fees/`
  - `https://d0d28d76.shopprofitcalculator.pages.dev/fees/`:
    - Status: HTTP 200
    - `X-Robots-Tag`: `noindex, nofollow` (preview indexing protection active)
  - `https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev/health`:
    - Status: HTTP 200 (`status: "healthy"`)
  - `https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev/v1/version`:
    - Status: HTTP 200 (`version_id: "v1.1.1"`)

All Step 29 objectives have been satisfied with zero regressions.
