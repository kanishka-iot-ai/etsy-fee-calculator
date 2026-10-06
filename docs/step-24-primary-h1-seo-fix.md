# ShopProfit — Step 24: Primary H1 + Page Topic SEO Fix

**Date:** October 6, 2026  
**Status:** PASSED  
**Pages Deployment:** `2c5f0dd9` (Live at [shopprofitcalculator.com](https://shopprofitcalculator.com/))  
**Worker Deployment:** `73858135-0a40-4eef-befa-4187e65534d0` (UNCHANGED)  
**Active Fee Version:** `v1.1.1` (UNCHANGED)  
**Database:** `shopprofit-fees-db` (UNCHANGED)  

---

## 1. Executive Summary & Objective

In the Step 22 SEO audit, a structural heading hierarchy problem was identified across all ShopProfit calculator pages:
- The brand slogan `"KNOW WHAT YOU KEEP."` was wrapped in an `<h1>` tag in the hero header.
- The actual calculator topic and primary search intent keyword (`"Etsy Profit Calculator"`, `"Etsy Fee Calculator UK"`, etc.) was enclosed in an `<h2>` tag inside the calculator card (`#calculator-heading`).

This diluted search engine crawl signals by establishing a generic brand slogan as the primary topic of every page rather than the high-intent keywords searchers use.

**Step 24 Objective:**
1. Demote the brand slogan `"KNOW WHAT YOU KEEP."` from an `<h1>` to a non-heading semantic container (`<div>`), retaining 100% visual appearance, styling, and accessibility.
2. Promote the descriptive calculator heading (`#calculator-heading`) to the single primary `<h1>` on each calculator page:
   - Homepage (`/`): `Etsy Profit Calculator`
   - UK Route (`/etsy-fee-calculator-uk`): `Etsy Fee Calculator UK`
   - Canada Route (`/etsy-fee-calculator-canada`): `Etsy Fee Calculator Canada`
   - Australia Route (`/etsy-fee-calculator-australia`): `Etsy Fee Calculator Australia`
   - Digital Download Route (`/etsy-digital-download-fee-calculator`): `Etsy Digital Download Fee Calculator`
3. Ensure strict heading hierarchy (exactly one `<h1>` per page, followed by logical `<h2>`/`<h3>` subsections).
4. Verify zero visual regressions across mobile and desktop.
5. Deploy strictly to Cloudflare Pages without altering Worker, D1, fee rules, DNS, or Cron.

---

## 2. Changes Implemented

### 2.1 CSS Styling Compatibility (`styles.css`)
To guarantee zero visual regression across desktop, tablet, and mobile breakpoints:
- Added `.hero .hero-title, .hero-title` and `.hero .hero-title .hero-line`, `.hero .hero-title .hero-word`, `.hero .hero-title .hero-keep` selectors alongside existing `.hero h1` rules.
- Added `.section-heading h1, #calculator .section-heading h1` selectors alongside `.section-heading h2` rules.
- Preserved identical Silkscreen font typography, lime green highlight on `"KEEP."`, flex alignment, font sizing (`clamp()`), and responsive margins.

### 2.2 Homepage (`index.html`)
- **Brand Slogan:** Changed `<h1 class="hero-title" id="hero-title" aria-label="Know what you keep.">` to `<div class="hero-title" id="hero-title" aria-label="Know what you keep.">`.
- **Primary H1:** Changed `<h2 id="calculator-heading">Etsy Profit Calculator</h2>` to `<h1 id="calculator-heading">Etsy Profit Calculator</h1>`.

### 2.3 Static SEO Route Generator (`scripts/generate-seo-pages.mjs`)
- Standardized route `h1` strings to concise, search-targeted topics:
  - `UK`: `"Etsy Fee Calculator UK"`
  - `CA`: `"Etsy Fee Calculator Canada"`
  - `AU`: `"Etsy Fee Calculator Australia"`
  - `OTHER`: `"Etsy Digital Download Fee Calculator"`
- Updated generator replacement regex from `/<h2 id="calculator-heading">[\s\S]*?<\/h2>/` to `/<h1 id="calculator-heading">[\s\S]*?<\/h1>/`.
- Re-generated all 4 regional/mode HTML files both at the root and in their canonical subdirectories (`slug/index.html`).

### 2.4 SEO Test Suite (`tests/seo.test.js`)
- Updated test assertions in `tests/seo.test.js` to strictly verify:
  1. Exactly 1 `<h1>` tag exists on every indexable page.
  2. The text content of `<h1>` exactly matches the designated page topic (`expectedH1s`).
  3. `<h1 class="hero-title">` is never present.
  4. `<div id="hero-title">` is present with full branding and accessibility preserved.

---

## 3. Verification & Test Results

### 3.1 Local Test Suite
- `npm.cmd test`: **307 / 307 PASSED** (0 failures).
- `npm.cmd run check:launch`: **PASSED** (all 12 baseline fee rules verified; support contact verified).
- `npm.cmd run check:etsy`: **PASSED** (Etsy policy hash verified current).
- `node worker/test-discovery.mjs`: **20 / 20 PASSED**.
- `node worker/test-publishing.mjs`: **29 / 29 PASSED**.
- `node worker/test-worker-unit.mjs`: **9 / 9 PASSED**.
- `node scripts/production-canary.mjs`: **PASSED** (hourly canary verified health, API, snapshots, fee integrity).

### 3.2 Heading Hierarchy Matrix
| Page Route | Element `<... id="hero-title">` | Primary `<h1>` Content | Total H1 Count |
| :--- | :---: | :--- | :---: |
| `/` | `<div>` | `Etsy Profit Calculator` | **1** |
| `/etsy-fee-calculator-uk` | `<div>` | `Etsy Fee Calculator UK` | **1** |
| `/etsy-fee-calculator-canada` | `<div>` | `Etsy Fee Calculator Canada` | **1** |
| `/etsy-fee-calculator-australia` | `<div>` | `Etsy Fee Calculator Australia` | **1** |
| `/etsy-digital-download-fee-calculator` | `<div>` | `Etsy Digital Download Fee Calculator` | **1** |
| `/fees/` | N/A | `Etsy Fees Calculator & Complete Etsy Seller Fees Guide` | **1** |
| `/methodology/` | N/A | `How ShopProfit Estimates Etsy Take-Home & Net Profit` | **1** |
| `/faq/` | N/A | `Etsy Profit Calculator FAQ` | **1** |
| `/privacy` | N/A | `Privacy notice` | **1** |
| `/terms` | N/A | `Terms of use` | **1** |
| `/contact` | N/A | `Contact ShopProfit` | **1** |

---

## 4. Live Production Verification

Deployed to Cloudflare Pages:
- **Deployment Hash:** `2c5f0dd9`
- **Preview URL:** `https://2c5f0dd9.shopprofitcalculator.pages.dev/`

Live checks executed against production:
1. `https://shopprofitcalculator.com/`:
   - HTTP: `200 OK`
   - H1: `["Etsy Profit Calculator"]` (count: 1)
   - Hero Title: `<div id="hero-title">`
   - `X-Robots-Tag`: `null` (Indexable)
2. `https://shopprofitcalculator.com/etsy-fee-calculator-uk`:
   - HTTP: `200 OK`
   - H1: `["Etsy Fee Calculator UK"]` (count: 1)
   - Hero Title: `<div id="hero-title">`
   - `X-Robots-Tag`: `null` (Indexable)
3. `https://shopprofitcalculator.com/etsy-fee-calculator-canada`:
   - HTTP: `200 OK`
   - H1: `["Etsy Fee Calculator Canada"]` (count: 1)
   - Hero Title: `<div id="hero-title">`
   - `X-Robots-Tag`: `null` (Indexable)
4. `https://shopprofitcalculator.com/etsy-fee-calculator-australia`:
   - HTTP: `200 OK`
   - H1: `["Etsy Fee Calculator Australia"]` (count: 1)
   - Hero Title: `<div id="hero-title">`
   - `X-Robots-Tag`: `null` (Indexable)
5. `https://shopprofitcalculator.com/etsy-digital-download-fee-calculator`:
   - HTTP: `200 OK`
   - H1: `["Etsy Digital Download Fee Calculator"]` (count: 1)
   - Hero Title: `<div id="hero-title">`
   - `X-Robots-Tag`: `null` (Indexable)
6. Preview Protection:
   - `https://2c5f0dd9.shopprofitcalculator.pages.dev/` -> `X-Robots-Tag: noindex, nofollow` (Protected)

---

## 5. Scope Safeguard Compliance

- **Worker:** Deployment `73858135-0a40-4eef-befa-4187e65534d0` untouched.
- **Database:** D1 `shopprofit-fees-db` untouched.
- **Fee Rules & Version:** `v1.1.1` untouched.
- **DNS & Cron:** Untouched.
- **Visuals:** Brand slogan "KNOW WHAT YOU KEEP." preserves exact visual typography, colors, layout, and pixel responsiveness across all device viewports.
