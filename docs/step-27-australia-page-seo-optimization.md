# ShopProfit — Step 27: Australia Page Unique Content SEO Optimization Report

**Date:** 2026-10-06  
**Status:** PASSED  
**Pages Deployment:** `03b47a39` (previous: `511bf6ea`)  
**Worker Deployment:** `73858135-0a40-4eef-befa-4187e65534d0` (UNTOUCHED)  
**Active Fee Version:** `v1.1.1` (UNTOUCHED)  
**Database:** `shopprofit-fees-db` (D1, UNTOUCHED)  
**Route Optimized:** `/etsy-fee-calculator-australia`

---

## 1. Executive Summary

In Step 22 (SEO & Keyword Audit), the Australian regional calculator page (`/etsy-fee-calculator-australia`) was flagged with **~92% content duplication** against the homepage. The page previously displayed generic US-centric explanatory copy, missing crucial Australian fee nuances such as the domestic vs. international payment processing split (3% vs 4% + A$0.25), the complete absence of a regulatory operating fee (0.00% in Australia vs. 0.48% UK / 0.50% Canada), and Australia Post fulfillment economics.

In Step 27, following the verified methodology established in Steps 25 (UK) and 26 (Canada), `/etsy-fee-calculator-australia` was transformed into a authoritative, Australia-specialized resource with zero generic boilerplate, while strictly preserving core calculator functionality, security headers, and edge performance.

---

## 2. Official Etsy Fee Policy Verification (Australia)

All content was verified against current official Etsy Help Center specifications:

| Fee Parameter | Official Etsy Specification | Verification Source | ShopProfit Implementation |
|---|---|---|---|
| **Transaction Fee** | **6.5%** on order total (item price + buyer postage) | Etsy Help Center Article `115014483627` | Modeled dynamically in fee engine and copy |
| **Listing Fee** | **$0.20 USD** converted (~**$0.28 AUD**) | Etsy Help Center Article `115014483627` | Modeled as $0.28 AUD fixed per listing/renewal |
| **Payment Processing (Domestic)** | **3.0% + A$0.25** for sales to buyers in Australia | Etsy Help Center Article `115015628847`, `GLOBAL_COUNTRY_RULES.AU` | Default domestic assumption on AU route |
| **Payment Processing (International)** | **4.0% + A$0.25** for sales to overseas buyers | Etsy Help Center Article `115015628847`, `GLOBAL_COUNTRY_RULES.AU` | Documented in strategy guides and FAQs |
| **Regulatory Operating Fee** | **0.00% / None** | Etsy Help Center Article `1500011073202`, `STATUTORY_REGULATORY_RATES` | Explicitly clarified (contrasted with UK 0.48% & CA 0.50%) |
| **Offsite Ads** | **15%** (<$10k USD, optional) or **12%** (≥$10k USD, mandatory) | Etsy Help Center Article `360000338367` | Modeled with exact **$100 USD equivalent cap** |
| **Currency Conversion** | **2.5%** when listing currency differs from bank payout | Etsy Legal - Payment Policy | Documented in seller strategy guide |
| **Shipping Fee Deduction** | Transaction (6.5%) & processing fees apply to buyer shipping | Etsy Help Center Article `115014483627` | Modeled in gross revenue and net profit formulas |

---

## 3. Implemented Content Enhancements

### 3.1 Metadata & Heading Hierarchy
- **Title Tag:** `Etsy Fee Calculator Australia — ShopProfit`
- **Meta Description:** `Calculate Etsy seller fees and take-home profit in AUD. Accurate Australian fee calculator modeling 6.5% transaction, domestic 3% + A$0.25 processing, and export rates.`
- **Primary H1:** `<h1 id="calculator-heading">Etsy Fee Calculator Australia</h1>` (single H1 per page, brand slogan kept as decorative `div.hero-title`)
- **Canonical URL:** `https://shopprofitcalculator.com/etsy-fee-calculator-australia`

### 3.2 Australian Direct Answer & Formula Section (`#how-it-works`)
- **Direct Answer:** Details exact AUD deductions: $0.28 listing fee, 6.5% transaction fee on total order, 3% + A$0.25 domestic processing (or 4% + A$0.25 export), and 0% regulatory fee.
- **Formulas:**
  - `gross revenue = item price + buyer shipping (AUD)`
  - `Australian platform fees = $0.28 listing + 6.5% transaction + processing (3% or 4% + A$0.25) + ads`
  - `net profit = gross revenue − platform fees − production − packaging & shipping`

### 3.3 Four Comprehensive Australian Seller Strategy Guides (`#seller-guides`)
1. **Target Pricing in AUD: How to Price Backward in Australia:** Explains why linear markups fail due to compounding 9.5% baseline deductions and how ShopProfit's binary search solver computes exact target pricing.
2. **Regulatory Operating Fees: Why Australia Pays 0% on Etsy:** Details the statutory contrast between Australia (0.00%) and European/UK/Canadian markets, eliminating confusion around platform surcharges.
3. **Domestic vs. International Payment Processing (3% vs 4%):** Breaks down the 100 bps difference between domestic Australian sales (3% + A$0.25) and exports (4% + A$0.25), plus 2.5% FX considerations when listing in USD.
4. **Australia Post & Shipping Economics: Fees Deducted from Shipping:** Analyzes how Etsy's fee deduction on buyer postage (~9.5% domestic, 10.5% export) affects Parcel Post margins and high-cost international delivery.

### 3.4 Six Dedicated Australian FAQs & Schema (`#faq`)
1. *What fees does Etsy charge sellers in Australia?*
2. *Does Etsy charge a regulatory operating fee in Australia?* (Explicitly explains the 0.00% rate)
3. *How does Etsy payment processing work for Australian sellers?* (3% domestic vs 4% export + 2.5% FX note)
4. *Does Etsy charge fees on shipping in Australia?* (Explains fee impact on Australia Post postage)
5. *How do Etsy Offsite Ads work for Australian shops?* (15% vs 12%, $100 USD cap)
6. *Can I calculate Etsy fees for digital downloads in Australia?* (Links to `/etsy-digital-download-fee-calculator`)

All 6 questions and answers are mirrored identically in JSON-LD `FAQPage` structured data.

---

## 4. Test Suite & Quality Verification

| Test Suite | Result | Details |
|---|---|---|
| **Unit & Integration Suite** | **PASS (307/307)** | `npm test` passed in 9.16s |
| **SEO Integrity Tests** | **PASS** | Validates H1, canonical, unique title/description, 6 Australia FAQs, guide headings, Australian profit formula |
| **Launch Readiness Check** | **PASS** | `npm run check:launch` verified Etsy fees and contact configuration |
| **Live Etsy Policy Monitor** | **PASS** | `npm run check:etsy` verified live policies unchanged |
| **Worker Discovery Tests** | **PASS (20/20)** | `node worker/test-discovery.mjs` passed |
| **Worker Publishing Tests** | **PASS (29/29)** | `node worker/test-publishing.mjs` passed |
| **Worker Unit Tests** | **PASS (9/9)** | `node worker/test-worker-unit.mjs` passed |
| **Hourly Production Canary** | **PASS** | `node scripts/production-canary.mjs` passed against live production |

---

## 5. Live Production Verification

### 5.1 Production Custom Domain (`https://shopprofitcalculator.com/etsy-fee-calculator-australia`)
- **HTTP Status:** `200 OK`
- **X-Robots-Tag:** `null` (Fully indexable, NO noindex tag on production custom domain)
- **Security Headers:** CSP, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` all intact
- **H1:** `Etsy Fee Calculator Australia`
- **Unique Australian Content:** Verified live (profit formula, 4 guides, 6 FAQs, Australian fee schedule)

### 5.2 Cloudflare Pages Preview Domain (`https://03b47a39.shopprofitcalculator.pages.dev/etsy-fee-calculator-australia`)
- **HTTP Status:** `200 OK`
- **X-Robots-Tag:** `noindex, nofollow` (Preview domain protection verified active)

### 5.3 Site-wide Regression Check
All other routes verified returning HTTP 200 with `X-Robots-Tag: null`:
- Homepage: `https://shopprofitcalculator.com/` (200 OK)
- UK Calculator: `https://shopprofitcalculator.com/etsy-fee-calculator-uk` (200 OK)
- Canada Calculator: `https://shopprofitcalculator.com/etsy-fee-calculator-canada` (200 OK)
- Digital Calculator: `https://shopprofitcalculator.com/etsy-digital-download-fee-calculator` (200 OK)
- Fees Guide: `https://shopprofitcalculator.com/fees/` (200 OK)
- Methodology: `https://shopprofitcalculator.com/methodology/` (200 OK)
- FAQ: `https://shopprofitcalculator.com/faq/` (200 OK)
