# ShopProfit — Step 26: Canada Page Unique Content SEO Optimization

**Date:** October 6, 2026  
**Status:** PASSED  
**Pages Deployment:** `511bf6ea` (Live at [shopprofitcalculator.com/etsy-fee-calculator-canada](https://shopprofitcalculator.com/etsy-fee-calculator-canada))  
**Worker Deployment:** `73858135-0a40-4eef-befa-4187e65534d0` (UNCHANGED)  
**Active Fee Version:** `v1.1.1` (UNCHANGED)  
**Database:** `shopprofit-fees-db` (UNCHANGED)  

---

## 1. Executive Summary & Objective

In Step 26, the Canadian regional calculator route (`/etsy-fee-calculator-canada`) was optimized to eliminate generic homepage boilerplate (~92% duplication prior to this step) and replace it with verified, genuinely useful Canada-specific content.

**Step 26 Invariants & Boundaries:**
1. Optimized **ONLY** `/etsy-fee-calculator-canada`.
2. Left Australia (`/etsy-fee-calculator-australia`) and Digital (`/etsy-digital-download-fee-calculator`) untouched.
3. Left Worker, D1, fee engine, DNS, Cron, rate limiting, and security headers 100% UNCHANGED.
4. Grounded all claims in authoritative Etsy Help Center sources governed by the project.
5. Zero invented Canadian tax obligations, GST/HST/QST claims, CRA rules, or ungrounded legal declarations.

---

## 2. Official Etsy Source Verification & Fact Basis

All claims on the Canada page are grounded directly in the project's monitored official Etsy Help Center policy articles:

| Source Article ID | Official Title | URL | Verified Canada Fee Fact |
| :--- | :--- | :--- | :--- |
| **`115014483627`** | What are the Fees and Taxes for Selling on Etsy? | [help.etsy.com/.../115014483627](https://help.etsy.com/hc/en-us/articles/115014483627-What-are-the-Fees-and-Taxes-for-Selling-on-Etsy) | 6.5% transaction fee on order total (item price + shipping + gift wrap). Listing fee of $0.20 USD billed at estimated CAD equivalent (~$0.27 CAD). 2.5% currency conversion fee if listing currency differs from bank account currency. |
| **`115015628847`** | What are Payment Processing Fees for Selling on Etsy? | [help.etsy.com/.../115015628847](https://help.etsy.com/hc/en-us/articles/115015628847-What-are-Payment-Processing-Fees-for-Selling-on-Etsy) | **Domestic & US Buyer Orders:** 3% + CA$0.25.<br>**International Buyer Orders:** 4% + CA$0.25.<br>Assessed on the total sale amount including shipping and applicable taxes. |
| **`1500011073202`** | What is a Regulatory Operating Fee? | [help.etsy.com/.../1500011073202](https://help.etsy.com/hc/en-us/articles/1500011073202-What-is-a-Regulatory-Operating-Fee) | **Canada:** **0.50%** regulatory operating fee levied on gross transaction total (item price + shipping). |
| **`360000338367`** | How Etsy's Offsite Ads Work | [help.etsy.com/.../360000338367](https://help.etsy.com/hc/en-us/articles/360000338367-How-Etsy-s-Offsite-Ads-Work) | 15% standard tier (<$10,000 USD trailing 12-month sales; optional); 12% high-volume tier (≥$10,000 USD; mandatory). Statutory per-order cap of **$100 USD** (or CAD equivalent). |
| **`115015710408`** | Countries Eligible for Etsy Payments | [help.etsy.com/.../115015710408](https://help.etsy.com/hc/en-us/articles/115015710408-Countries-Eligible-for-Etsy-Payments) | Canadian shops receive direct CAD payouts to Canadian financial institutions via Etsy Payments. |

---

## 3. Canada-Specific Content Implementations

### 3.1 Hero & Search Intent Header
- **Primary H1:** `Etsy Fee Calculator Canada`
- **Sub-slogan / Eyebrow:** `SHOPPROFIT / CA — FREE ETSY FEE CALCULATOR CANADA`
- **Lead Copy:**
  > "Calculate your exact Etsy seller fees, unit break-even price, and net profit in Canadian Dollars ($ CAD). Models Etsy’s 6.5% transaction fee, Canadian payment processing (3% + $0.25 domestic/US or 4% + $0.25 international), the 0.50% Canadian regulatory operating fee, and optional Offsite Ads. Looking for multi-currency calculations? Visit the main [Etsy profit calculator](/) or browse the [Etsy fees guide](/fees/)."

### 3.2 Canadian Fee Breakdown & Methodology (`#how-it-works`)
- **Direct Answer:**
  > "For Canadian sellers, Etsy takes an estimated $0.27 CAD listing fee, a 6.5% transaction fee on the full order amount (item price + buyer shipping), Canadian payment processing (3% + $0.25 CAD for domestic Canada and US buyer orders, or 4% + $0.25 CAD for international orders), and a 0.50% Canadian regulatory operating fee. If the order is attributed to an Offsite Ad, an additional 12% or 15% ad fee applies (capped at the $100 USD equivalent)."
- **Canadian Mathematical Ledger Formula:**
  - `gross revenue = item price + buyer shipping (CAD)`
  - `Canadian platform fees = $0.27 listing + 6.5% transaction + processing (3% or 4% + $0.25) + 0.50% regulatory + ads`
  - `net profit = gross revenue − platform fees − production − packaging & shipping`
- Transparent note contextualizing Canadian domestic vs international processing and linking to [Methodology](/methodology/) and [Etsy Fees Guide](/fees/).

### 3.3 Canada Fee Schedule & Processing Table (`#fees`)
- Heading: `Etsy Canada Fee Schedule & International Processing Rates`
- Subheading: Details payment processing and regulatory rates for Canadian shops and global export destinations.
- Table Note: Clarifies the domestic/US 3% + $0.25 rate, international 4% + $0.25 rate, and 0.50% regulatory operating fee.

### 3.4 Canadian Seller Strategy Frameworks (`#seller-guides`)
Replaced generic US cards with 4 custom Canadian guides:
1. **Target Pricing in CAD: How to Price Backward in Canada:**
   Explains why simple percentage markups fail in Canada due to compounding variable fees (6.5% + 3% + 0.50% = 10.00% baseline variable deduction) plus $0.52 combined fixed fees per order.
2. **The Canadian Regulatory Operating Fee (0.50%): How It Adds Up:**
   Details Etsy's statutory 0.50% surcharge to cover digital services operating costs in Canada, and clarifies that it applies to the full order total including postage.
3. **Cross-Border Economics: Domestic vs. US vs. International Payment Processing:**
   Highlights Etsy's policy where US buyer orders are processed at the domestic 3% + $0.25 CAD rate, whereas international orders (outside CA & US) use 4% + $0.25 CAD.
4. **Canada Post & Shipping Economics: Fees Levied on Buyer Shipping:**
   Breaks down how Etsy taxes buyer shipping, demonstrating that on a $16 CAD Canada Post parcel charge, Etsy deducts approximately $1.60 in platform fees directly from shipping revenue.

### 3.5 Canada-Specific FAQ Section (`#faq`) & JSON-LD Schema
Replaced generic questions with 6 dedicated Canadian questions in both the HTML accordion and the `FAQPage` JSON-LD schema:
1. *What fees does Etsy charge sellers in Canada?*
2. *What is the 0.50% Canadian regulatory operating fee on Etsy?*
3. *How does Etsy payment processing work for Canadian sellers?*
4. *Does Etsy charge fees on shipping in Canada?*
5. *How do Etsy Offsite Ads work for Canadian shops?*
6. *Can I calculate Etsy fees for digital downloads in Canada?* (with direct link to [`/etsy-digital-download-fee-calculator`](/etsy-digital-download-fee-calculator))

---

## 4. Quality & Differentiation Comparison

| Dimension | Before Step 26 | After Step 26 |
| :--- | :---: | :---: |
| **Meaningful Content Duplication** | ~92% | **< 15%** (only shared functional tools/branding) |
| **Primary Currency Context** | Generic USD ($) in guides | 100% Canadian Dollars ($ CAD) |
| **Cross-Border Order Modeling** | None | Explains domestic/US (3%) vs international (4%) split |
| **Regulatory Fee (0.50%) Coverage** | Only present in table row | Dedicated guide, formula, and FAQ |
| **Fulfillment Context** | Generic $8 postage | Canada Post Expedited & parcel shipping realities |
| **FAQ Alignment** | 10 generic homepage FAQs | 6 genuine Canadian seller questions |
| **JSON-LD Schema** | Duplicated homepage schema | Dedicated Canada `FAQPage` schema |
| **Internal Linking** | Basic footer | High-intent links to `/`, `/fees/`, `/methodology/`, `/faq/`, `/etsy-digital-download-fee-calculator` |

---

## 5. Scope Isolation & Safety Invariants

- **Australia & Digital Routes:** Completely untouched by this step.
- **UK Route:** Retained its complete Step 25 unique content without regressions.
- **Worker (`73858135-0a40-4eef-befa-4187e65534d0`):** UNCHANGED.
- **D1 Database (`shopprofit-fees-db`):** UNCHANGED.
- **Active Fee Version (`v1.1.1`):** UNCHANGED.
- **Core Calculator Engine (`src/fee-engine.js`):** UNCHANGED.
- **No Unsubstantiated Claims:** Zero invented GST/HST, provincial tax, or CRA legal declarations.

---

## 6. Test Suite & Verification Results

### Local Tests:
- `npm.cmd test`: **307 / 307 PASSED** (0 failures).
- `npm.cmd run build`: **PASSED** (clean static generation).
- `npm.cmd run build:seo`: **PASSED**.
- `npm.cmd run check:launch`: **PASSED** (all 12 baseline fee rules verified; support contact verified).
- `npm.cmd run check:etsy`: **PASSED** (live Etsy Help Center policy hash current).
- `node worker/test-discovery.mjs`: **20 / 20 PASSED**.
- `node worker/test-publishing.mjs`: **29 / 29 PASSED**.
- `node worker/test-worker-unit.mjs`: **9 / 9 PASSED**.
- `node scripts/production-canary.mjs`: **PASSED**.

### Live Production Verification (`https://shopprofitcalculator.com/etsy-fee-calculator-canada`):
- **HTTP Status:** `200 OK`
- **Primary H1:** `["Etsy Fee Calculator Canada"]` (count: 1)
- **Canonical:** `https://shopprofitcalculator.com/etsy-fee-calculator-canada`
- **Indexability:** Custom domain remains indexable (`X-Robots-Tag: null`)
- **Security Headers:** HSTS, nosniff, strict-origin, X-Frame-Options all intact
- **Live Content Checks:**
  - Canadian Strategy heading verified.
  - Canadian Regulatory Operating Fee (0.50%) guide verified.
  - Domestic vs US vs International Processing guide verified.
  - Canada Post shipping economics guide verified.
  - Canadian profit formula verified.
  - 6 Canada FAQs and schema verified.
  - Calculator controls fully intact and functional.
- **Preview Protection:**
  - `https://511bf6ea.shopprofitcalculator.pages.dev/etsy-fee-calculator-canada` -> `X-Robots-Tag: noindex, nofollow`
