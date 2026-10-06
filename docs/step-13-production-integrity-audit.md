# ShopProfit — Step 13: Production Integrity & Global Fee Coverage Audit

**Date:** October 6, 2026  
**Audit Mode:** READ-ONLY PRODUCTION AUDIT  
**Environment Baseline:**  
- **Production Domain:** `https://shopprofitcalculator.com/`  
- **Pages Project:** `shopprofitcalculator`  
- **Active Deployment:** `https://00dea2ce.shopprofitcalculator.pages.dev`  
- **Fee Intelligence API:** `https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev`  
- **Active Fee Release Version:** `v1.1.1`  
- **D1 Database:** `shopprofit-fees-db` (ID: `758e36ac-4d94-45a7-9c0d-d6a18d32780e`)  

---

## 1. Executive Summary

This comprehensive, read-only production audit evaluated the live ShopProfit deployment across all 14 inspection domains: live API contract, full 62-market data coverage, regulatory fee invariants, deposit fee schedules, Payoneer integration classifications, EUR-payout and Eurozone monetary rules, codebase fee-source integrity, numerical calculation precision, frontend UI reactivity, SEO routing and metadata, security/credential safety, and Cloudflare infrastructure mutation state.

**Overall Audit Result:** **100% PASS across all 14 evaluation domains.** Zero blockers, zero warnings, and zero integrity defects were found.

---

## 2. Detailed Findings by Evaluation Domain

### 2.1 Live API Integrity (Step 1) — `PASS`
- **GET `/v1/version`:** Returned HTTP 200 with `version_id: "v1.1.1"`, `status: "active"`, `notes: "Official v1.1.1 Release: Corrected TR deposit schedule to 50/600/42 TRY per official Etsy Payment processing policy."`.
- **GET `/v1/fees`:** Returned HTTP 200 with `version_id: "v1.1.1"` and `countryOrder` containing exactly 62 unique records.
- **Record Uniqueness:** Exactly 62 sovereign and fallback markets in `countries` object; exactly 62 keys in `countryOrder`; zero duplicate entries.
- **Fallback Invariant:** `OTHER` is present exactly once with global default fallback rates ($0.20 listing, 6.5% + $0.30 processing, USD currency).

### 2.2 Global Country Coverage (Step 2) — `PASS`
Every market in the 62-country active registry was validated against the authoritative domain model:
- **Country Code:** 62/62 `VALID` (ISO2 + `OTHER`).
- **Country Name:** 62/62 `VALID`.
- **Listing Currency:** 62/62 `VALID`.
- **Transaction Fee Rule:** 62/62 `VALID` (6.5% base).
- **Payment Processing Rule:** 62/62 `VALID` (percentage + fixed fee).
- **Regulatory Status:** 62/62 `VALID` (Statutory rates for 9 jurisdictions; `null` for 53 unlisted jurisdictions).
- **Offsite Ads Rule:** 62/62 `VALID` (15%/12% tier structure with $100 USD-equivalent cap).
- **Deposit Schedule:** 62/62 `VALID` (Statutory 3-tier schedules for 9 markets; `not_listed` for 53 markets).
- **Classification Distribution:** All mandatory fields classified as `VALID` or `NULL-BY-DESIGN`. Zero fields were `MISSING` or `CONTRADICTORY`.

### 2.3 Regulatory Invariant (Step 3) — `PASS`
Verified against official Etsy Help Center Policy 1500011073202:
- Exactly 9 statutory jurisdictions possess non-null regulatory operating fee rates:
  1. **CA (Canada):** 0.50% (`0.005`)
  2. **FR (France):** 1.14% (`0.0114`)
  3. **HU (Hungary):** 1.97% (`0.0197`)
  4. **IT (Italy):** 0.80% (`0.008`)
  5. **IN (India):** 0.05% (`0.0005`)
  6. **ES (Spain):** 0.88% (`0.0088`)
  7. **TR (Türkiye):** 1.67% (`0.0167`)
  8. **UK (United Kingdom):** 0.48% (`0.0048`)
  9. **VN (Vietnam):** 1.24% (`0.0124`)
- All other 53 markets have `rate: null`, `status: "not_listed"`, and `isListedByEtsy: false`. Zero synthetic 0% rates exist in the API or normalized output.

### 2.4 Deposit Invariant (Step 4) — `PASS`
Verified against official Etsy Payment Processing Policy 115015628847 (Table 2):
- Exactly 9 statutory deposit fee schedules exist in production `v1.1.1`:
  1. **ID (Indonesia):** Daily Minimum 28,000 IDR | Fee Threshold 1,400,000 IDR | Fee 28,000 IDR
  2. **IL (Israel):** Daily Minimum 7 ILS | Fee Threshold 350 ILS | Fee 7 ILS
  3. **MY (Malaysia):** Daily Minimum 9 MYR | Fee Threshold 400 MYR | Fee 8 MYR
  4. **MX (Mexico):** Daily Minimum 40 MXN | Fee Threshold 2,000 MXN | Fee 40 MXN
  5. **MA (Morocco):** Daily Minimum 20 MAD | Fee Threshold 1,000 MAD | Fee 20 MAD
  6. **PH (Philippines):** Daily Minimum 100 PHP | Fee Threshold 5,000 PHP | Fee 100 PHP
  7. **ZA (South Africa):** Daily Minimum 35 ZAR | Fee Threshold 1,500 ZAR | Fee 30 ZAR
  8. **TR (Türkiye):** Daily Minimum 50 TRY | Fee Threshold 600 TRY | Fee 42 TRY (`v1.1.1` verified)
  9. **VN (Vietnam):** Daily Minimum 45,000 VND | Fee Threshold 2,300,000 VND | Fee 45,000 VND
- All other 53 markets have `mode: "not_listed"`, `fee: null`, and `threshold: null`. Deposit fees are kept strictly separate from per-order calculations.

### 2.5 Payoneer Invariant (Step 5) — `PASS`
Verified against official Etsy Help Center Articles 115015710408 and 16999319005207:
- Exactly 16 Payoneer-partnered sovereign markets identified in compatibility schedule:
  `AR`, `BR`, `CL`, `CN`, `EG`, `GE`, `IN`, `JP`, `KZ`, `PK`, `PE`, `RS`, `KR`, `TH`, `UA`, `AE`.
- Both `IN` (India) and `JP` (Japan) are included.
- Normalized context correctly flags `paymentProviderContext = "payoneer"`, `payoutMethodContext = "payoneer_account"`, and `payoutCurrencyContext = "usd_to_payoneer"`.

### 2.6 EUR Payout & Eurozone Monetary Invariant (Step 6) — `PASS`
Verified against official Etsy Help Center Article 115015710408:
- Six European candidate markets verified: `BG`, `HR`, `CZ`, `HU`, `RO`, `PL`.
- All six have `payoutCurrency = "EUR"`, `bankFxPossibility = true` (bank may charge FX fees).
- **Bulgaria (BG):**
  - Currency in API: `EUR` (zero legacy BGN data remains).
  - `euroArea = true` (monetary accession verified).
  - `bankFxPossibility = true`.
- **Croatia (HR):**
  - Currency in API: `EUR`.
  - `euroArea = true` (adopted EUR Jan 1, 2023).
  - `bankFxPossibility = true`.
- **Non-Eurozone EU Candidates (CZ, HU, RO, PL):**
  - `euroArea = false`.
  - `bankFxPossibility = true`.

### 2.7 Fee-Engine Source Integrity (Step 7) — `PASS`
A full AST/content scan across production source code (`src/*.js`, `index.html`) evaluated all statutory fee constants:
- `6.5` / `0.065`: Authoritative platform transaction rate (`OFFICIAL_TRANSACTION_RATE` in `src/fee-engine.js`) [Class A] + explanatory UI copy [Class B].
- `12` / `15` / `0.12` / `0.15`: Authoritative Offsite Ads tiers in `src/fee-engine.js` [Class A] + explanatory copy in `src/translations.js` [Class B].
- `2.5` / `0.025`: Authoritative currency conversion rate in `src/fee-engine.js` [Class A].
- `0.005`, `0.0114`, `0.0197`, `0.008`, `0.0005`, `0.0088`, `0.0167`, `0.0048`, `0.0124`: Authoritative statutory regulatory rates in `src/compatibility.js` [Class A].
- **Class E (Suspicious duplicate fee database):** **ZERO occurrences found.** No redundant or divergent fee tables exist.

### 2.8 Frontend → API Data Flow (Step 8) — `PASS`
- The unidirectional data pipeline operates strictly as designed:
  $$\text{Worker API (/v1/fees)} \longrightarrow \text{FeeIntelligenceClient} \longrightarrow \text{compatibility.js} \longrightarrow \text{fee-engine.js} \longrightarrow \text{app.js}$$
- Version lock is strictly pinned to `v1.1.1`.
- API failure produces an explicit visible error status banner and disables controls (`aria-busy="true"`). Zero silent fallback to stale fee data occurs.

### 2.9 Calculation Precision Audit (Step 9) — `PASS`
Deterministic unit calculations executed across 12 diverse market profiles (`US`, `UK`, `CA`, `AU`, `DE`, `FR`, `IT`, `ES`, `IN`, `JP`, `TR`, `OTHER`):
- All calculations execute in integer minor units (cents / sen / yen).
- Floating-point fee drift: **0.00%**.
- `NaN`, `Infinity`, `undefined`, or negative fee results: **ZERO**.
- Target-profit binary search solver (`solveRequiredPrice`) terminated within $\le 30$ iterations across all markets.
- Break-even solver (`solveBreakEvenPrice`) terminated cleanly and matched exact zero-profit bounds.

### 2.10 Special Fee Handling (Step 10) — `PASS`
- **Transaction Fee:** Exactly 6.50% on item + shipping + gift wrap.
- **Offsite Ads:** 15% (standard) and 12% (high volume); strictly capped at $100 USD-equivalent on $1,000 orders.
- **Currency Conversion:** Exactly 2.50% charged strictly when listing currency differs from payment account currency.
- **Etsy Plus:** $10.00/mo amortized across monthly sales ($0.50/order at 20 sales/mo).
- **Deposit Fees:** Verified strictly separate from order-level fees.

### 2.11 DOM & UI Reactivity (Step 11) — `PASS`
- Dropdown selector populates all 62 markets dynamically from `/v1/fees`.
- Currency symbol and ISO suffix update immediately upon country change.
- Processing fees reflect domestic vs. international rates cleanly.
- Regulatory fee row displays only for the 9 statutory jurisdictions; hidden/em-dash for unlisted countries.
- Offsite Ads radio inputs (0%, 15%, 12%) toggle calculations reactively.
- Digital product mode preset removes shipping and production costs cleanly.
- Anchor targets (`#calculator`, `#target-pricing`, `#break-even-tool`, `#offsite-ads`) navigate and scroll seamlessly.

### 2.12 Live Route & SEO Integrity (Step 12) — `PASS`
- **Canonical Routes (HTTP 200):** `/`, `/fees/`, `/methodology/`, `/faq/`, `/etsy-fee-calculator-uk`, `/etsy-fee-calculator-canada`, `/etsy-fee-calculator-australia`, `/etsy-digital-download-fee-calculator`, `/privacy`, `/terms`, `/contact`, `/404.html`.
- **Permanent Redirects (HTTP 301):**
  - `/etsy-fee-calculator` $\rightarrow$ `/fees/`
  - `/etsy-profit-calculator` $\rightarrow$ `/`
  - `/calculator` $\rightarrow$ `/#calculator`
  - `/fee-breakdown` $\rightarrow$ `/fees/`
  - `/how-it-works` $\rightarrow$ `/methodology/`
  - `/help` $\rightarrow$ `/faq/`
- **Sitemap & Robots:** `https://shopprofitcalculator.com/sitemap.xml` lists all canonical routes. Zero references to `pages.dev`. `robots.txt` is fully crawlable.

### 2.13 Security & Configuration Audit (Step 13) — `PASS`
- Comprehensive repository scan detected **zero exposed credentials**:
  - No Cloudflare API tokens.
  - No Worker admin bearer tokens or secrets in client scripts or HTML.
  - No database passwords.
  - `database_id` in `worker/wrangler.toml` is the public resource UUID.

### 2.14 Cloudflare Infrastructure Read-Only State (Step 14) — `PASS`
- **Pages:** Deployed version `00dea2ce.shopprofitcalculator.pages.dev` remained unchanged during audit.
- **Worker:** `shopprofit-fee-intelligence` remained untouched (last deployed `2026-10-06T06:19:56.567Z`).
- **D1 Database:** Exactly 1 active version: `v1.1.1` (`changes: 0`, 0 mutations).
- **Cron Triggers & DNS:** Unchanged.

---

## 3. Summary of Findings

| Step | Inspection Domain | Result | Notes |
| :---: | :--- | :---: | :--- |
| **1** | Live API Contract & Version Lock | **PASS** | `v1.1.1`, active, exactly 62 records, `OTHER` fallback present |
| **2** | Global 62-Market Data Coverage | **PASS** | All fields `VALID` or `NULL-BY-DESIGN` |
| **3** | Regulatory Operating Fee Invariants | **PASS** | Exactly 9 statutory jurisdictions; zero synthetic 0% rates |
| **4** | Statutory Deposit Fee Schedules | **PASS** | All 9 official schedules verified; TR at 50/600/42 TRY |
| **5** | Payoneer Market Classifications | **PASS** | Exactly 16 markets (IN, JP included) with USD disbursement context |
| **6** | EUR Payout & Eurozone Monetary Rules | **PASS** | BG, HR, CZ, HU, RO, PL verified; Bulgaria EUR / euroArea=true |
| **7** | Fee-Engine Source Integrity | **PASS** | Zero duplicate fee databases (Class E: 0) |
| **8** | Frontend Unidirectional API Pipeline | **PASS** | Pinned to `v1.1.1`; explicit error states |
| **9** | Numerical Calculation Precision | **PASS** | Integer minor-unit math; zero drift, NaN, or solver hangs |
| **10** | Special Fee Handling | **PASS** | 6.5% transaction, $100 offsite cap, 2.5% FX, separate deposits |
| **11** | DOM & UI Global Coverage | **PASS** | 62 markets rendered; instant reactive calculations and presets |
| **12** | Live SEO & Routing Integrity | **PASS** | All 12 routes HTTP 200, all 6 redirects HTTP 301, sitemap valid |
| **13** | Security & Credential Hygiene | **PASS** | Zero secrets or tokens exposed in repository |
| **14** | Cloudflare Read-Only State | **PASS** | Worker, D1, Cron, DNS completely unchanged |

---

## 4. Final Audit Determination

```text
STEP 13 STATUS: PRODUCTION INTEGRITY AUDIT PASSED
```
