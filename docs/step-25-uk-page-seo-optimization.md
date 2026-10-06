# ShopProfit — Step 25: UK Page Unique Content SEO Optimization

**Date:** October 6, 2026  
**Status:** PASSED  
**Pages Deployment:** `f3bafc98` (Live at [shopprofitcalculator.com/etsy-fee-calculator-uk](https://shopprofitcalculator.com/etsy-fee-calculator-uk))  
**Worker Deployment:** `73858135-0a40-4eef-befa-4187e65534d0` (UNCHANGED)  
**Active Fee Version:** `v1.1.1` (UNCHANGED)  
**Database:** `shopprofit-fees-db` (UNCHANGED)  

---

## 1. Executive Summary & Objective

Prior to Step 25, the UK regional calculator route (`/etsy-fee-calculator-uk`) relied on generic boilerplate inherited from the homepage. Although the calculator defaulted to the UK preset (GBP, £0.16 listing, 6.5% transaction, 4% + £0.20 processing, and 0.48% regulatory fee), the explanatory copy beneath the tool was ~92% duplicated from the homepage, presenting generic US dollar examples, generic formulas, and irrelevant questions.

**Step 25 Objective:**
1. Replace duplicated generic copy on `/etsy-fee-calculator-uk` with genuinely useful UK-specific content grounded in authoritative Etsy fee rules.
2. Maintain strict isolation: Modify **ONLY** `/etsy-fee-calculator-uk` (leave Canada, Australia, and Digital pages untouched for subsequent steps).
3. Ground all claims in existing project data and official Etsy Help Center sources (no invented tax/HMRC claims).
4. Tailor structured data and FAQs specifically to UK sellers.
5. Deploy strictly to Cloudflare Pages after 100% test pass.

---

## 2. Pre-Audit: Duplication Findings

Before optimization, an audit of `/etsy-fee-calculator-uk` revealed:
- **Duplicated Sections:**
  - `How Etsy fees vary by country` (`#fees`): Generic 12-country table without UK context.
  - `How much does Etsy take from a sale?` (`#how-it-works`): Generic answer referencing $0.20 USD listing fee and US formulas.
  - `Etsy Pricing, Break-Even & Fee Strategy` (`#seller-guides`): Explanations referenced $35 mugs, $0.25 US processing, and $8 US shipping.
  - `FAQ` (`#faq-list`): 10 of 11 FAQs were identical generic homepage FAQs.
  - `JSON-LD Schema` (`#faq-structured-data`): Ingested all 11 generic homepage FAQs.
- **Estimated Meaningful Duplication:** ~92%.
- **Search Intent Gap:** UK sellers seeking `"Etsy fee calculator UK"` or `"Etsy seller fees UK"` were presented with US-centric discussions instead of Royal Mail postage realities, the UK regulatory operating fee (0.48%), and target pricing in British Pounds (£).

---

## 3. UK-Specific Content Implementations

### 3.1 Hero & Search Intent Header
- **Primary H1:** `Etsy Fee Calculator UK`
- **Sub-slogan / Eyebrow:** `SHOPPROFIT / UK — FREE ETSY FEE CALCULATOR UK`
- **Lead Copy:**
  > "Calculate your exact Etsy seller fees, unit break-even price, and net profit in British Pounds (£ GBP). Models Etsy’s 6.5% transaction fee, UK payment processing (4% + £0.20), the 0.48% UK regulatory operating fee, and optional Offsite Ads. Looking for multi-currency calculations? Visit the main [Etsy profit calculator](/) or browse the [Etsy fees guide](/fees/)."

### 3.2 UK Fee Breakdown & Methodology (`#how-it-works`)
- **Direct Answer:**
  > "For UK sellers, Etsy takes an estimated £0.16 listing fee, a 6.5% transaction fee on the full order amount (item price + buyer postage), 4% + £0.20 UK payment processing, and a 0.48% regulatory operating fee. If the order is attributed to an Offsite Ad, an additional 12% or 15% ad fee applies (capped at the $100 USD equivalent)."
- **UK Mathematical Ledger Formula:**
  - `gross revenue = item price + buyer postage (GBP)`
  - `UK platform fees = £0.16 listing + 6.5% transaction + (4% + £0.20) processing + 0.48% regulatory + ads`
  - `net profit = gross revenue − platform fees − production − postage & packaging`
- Contextual link to [Methodology](/methodology/) and [Etsy Fees Guide](/fees/).

### 3.3 UK Fee Schedule & Comparison Table (`#fees`)
- Heading: `Etsy UK Fee Schedule & International Processing Rates`
- Subheading: Highlights UK rates and provides context for UK sellers exporting to international buyers.
- Table Note: Specific to UK sellers, clarifying that domestic UK processing is 4% + £0.20, regulatory fee is 0.48%, and linking to the [full 62-country directory](/fees/).

### 3.4 UK Seller Strategy Frameworks (`#seller-guides`)
Replaced generic US cards with 4 custom UK seller guides:
1. **Target Pricing in GBP: How to Price Backward in the UK:**
   Explains why simple percentage markups fail in the UK due to compounding variable fees (6.5% + 4% + 0.48% = 10.98% baseline variable deduction) plus £0.36 combined fixed fees per order.
2. **The UK Regulatory Operating Fee (0.48%): How It Adds Up:**
   Details Etsy's statutory 0.48% surcharge to cover the UK Digital Services Tax, and clarifies that it applies to the full order total including postage.
3. **Offsite Ads for UK Shops: 15% vs 12% & The $100 USD Cap:**
   Details the 15% (under $10,000 USD) and 12% (over $10,000 USD) tiers, and highlights the $100 USD equivalent maximum cap per order.
4. **Royal Mail & Postage Economics: Fees Deducted from Shipping:**
   Breaks down how Etsy taxes buyer shipping, demonstrating that on a £3.85 Royal Mail Tracked 48 postage charge, Etsy deducts ~£0.42 (10.98%) in fees.

### 3.5 UK-Specific FAQ Section (`#faq`) & JSON-LD Schema
Replaced generic questions with 6 dedicated UK questions in both the HTML accordion and the `FAQPage` JSON-LD schema:
1. *What Etsy fees do sellers pay in the United Kingdom?*
2. *What is the 0.48% UK regulatory operating fee on Etsy?*
3. *Does Etsy charge fees on shipping and postage in the UK?*
4. *How do Etsy Offsite Ads work for UK shops?*
5. *How do I calculate net profit for an Etsy sale in the UK?*
6. *Can I calculate Etsy fees for digital downloads sold in the UK?* (with direct link to [`/etsy-digital-download-fee-calculator`](/etsy-digital-download-fee-calculator))

---

## 4. Before & After Differentiation

| Dimension | Before Step 25 | After Step 25 |
| :--- | :---: | :---: |
| **Meaningful Content Duplication** | ~92% | **< 15%** (only shared functional tools/branding) |
| **Currency Context** | Generic USD ($) in guides | 100% British Pounds (£ GBP) & pence |
| **Regulatory Fee Coverage** | Mentioned only in table column | Dedicated guide & formula breakdown (0.48%) |
| **Fulfillment Context** | Generic $8 postage | Royal Mail Tracked & UK fulfillment economics |
| **FAQ Alignment** | 10 generic homepage FAQs | 6 genuine UK seller questions |
| **JSON-LD Schema** | 10 generic homepage FAQs | 6 genuine UK seller questions |
| **Internal Linking** | Basic footer | High-intent links to `/`, `/fees/`, `/methodology/`, `/faq/`, `/etsy-digital-download-fee-calculator` |

---

## 5. Scope Isolation & Safety Invariants

- **Canada, Australia, Digital Routes:** Untouched by this step (isolated in generator).
- **Worker (`73858135-0a40-4eef-befa-4187e65534d0`):** UNCHANGED.
- **D1 Database (`shopprofit-fees-db`):** UNCHANGED.
- **Active Fee Version (`v1.1.1`):** UNCHANGED.
- **Core Calculator Engine (`src/fee-engine.js`):** UNCHANGED.
- **No Unsubstantiated Claims:** Zero invented HMRC, VAT, or legal declarations.

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

### Live Production Verification (`https://shopprofitcalculator.com/etsy-fee-calculator-uk`):
- **HTTP Status:** `200 OK`
- **Primary H1:** `["Etsy Fee Calculator UK"]` (count: 1)
- **Canonical:** `https://shopprofitcalculator.com/etsy-fee-calculator-uk`
- **Indexing:** `X-Robots-Tag: null` (Custom domain remains 100% indexable)
- **Security Headers:**
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-Frame-Options: DENY`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- **Preview Domain Protection:**
  - `https://f3bafc98.shopprofitcalculator.pages.dev/etsy-fee-calculator-uk` -> `X-Robots-Tag: noindex, nofollow`
- **Content Verification:**
  - UK Strategy heading present.
  - UK Regulatory guide present.
  - Royal Mail postage economics present.
  - UK profit formula present.
  - UK FAQ accordion & JSON-LD schema matching.
  - Calculator controls fully intact and functional.
