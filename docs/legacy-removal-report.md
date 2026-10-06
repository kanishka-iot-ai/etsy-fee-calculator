# ShopProfit — Legacy Model Dependency Audit & Removal Report

**Date:** October 2026  
**Status:** Legacy Model Successfully Removed  
**Target Milestone:** Step 11E (Legacy Model Dependency Audit + Safe Removal)

---

## 1. Executive Summary

As part of the migration to the global Etsy Fee Intelligence API (`v1.1.1`), the obsolete static fee calculation module (`src/calculator.js`) and static fee database (`src/countries.js`) were audited and safely removed from the production frontend runtime.

The repository now operates with exactly **ONE** authoritative fee source:
```
v1.1.1 Fee Intelligence API
          ↓
src/fee-intelligence-client.js
          ↓
src/compatibility.js
          ↓
src/fee-engine.js
          ↓
Calculator UI (src/app.js)
```

---

## 2. Complete Repository Dependency Scan & Classification

Every repository reference to the legacy candidates and associated symbols was scanned and classified into:
* **A. Production Runtime Dependency**
* **B. Test-Only Dependency**
* **C. Documentation/Comment Dependency**
* **D. Dead / Unused Reference**

### 2.1 File References: `src/calculator.js`
1. `index.html` (`<link rel="modulepreload" href="/src/calculator.js">`) — **A. Production Runtime** → Removed & replaced with `/src/fee-engine.js`, `/src/compatibility.js`, `/src/fee-intelligence-client.js`.
2. Regional HTML pages (`etsy-fee-calculator-uk.html`, `canada`, `australia`, `digital-download`) — **A. Production Runtime** → Removed & replaced with active module preloads.
3. `src/app.js` (`import ... from "./calculator.js"`) — **A. Production Runtime** → Completely removed.
4. `scripts/generate-seo-pages.mjs` (`import { formatMoney, TRANSACTION_RATE }`) — **A. Build Dependency** → Updated to import `formatMoney` and `OFFICIAL_TRANSACTION_RATE` from `src/fee-engine.js`.
5. `scripts/verify-etsy-fees.mjs` (`import { TRANSACTION_RATE, OFFSITE_CAP }`) — **A. Script Dependency** → Updated to verify `src/fee-engine.js`.
6. `tests/calculator.test.js` — **B. Test-Only** → Migrated to `tests/legacy/legacy-calculator.test.js` importing from `tests/legacy/calculator.js`.
7. `tests/fee-integrity.test.js` — **B. Test-Only** → Migrated legacy verification to `tests/legacy/legacy-fee-integrity.test.js`; root test repurposed to verify active engine invariants.
8. `tests/i18n.test.js` — **B. Test-Only** → Re-pointed to verify `calculateOrderFees` and `solveRequiredPrice` from `src/fee-engine.js`.
9. `tests/legacy-calculator-freeze.test.js` — **B. Test-Only** → Moved to `tests/legacy/legacy-calculator-freeze.test.js`.
10. `tests/ui-fee-engine-integration.test.js` — **B. Test-Only** → Re-pointed legacy comparison fixture imports to `tests/legacy/`.
11. `tests/compatibility.test.js` — **B. Test-Only** → Re-pointed legacy calculation bridge imports to `tests/legacy/calculator.js`.

### 2.2 File References: `src/countries.js`
1. `index.html` and regional HTML pages (`<link rel="modulepreload" href="/src/countries.js">`) — **A. Production Runtime** → Removed & replaced with active module preloads.
2. `src/app.js` (`import { COUNTRIES, COUNTRY_ORDER, countryFromTimeZone }`) — **A. Production Runtime** → Completely removed. Production UI now imports `countryFromTimeZone` from `src/fee-engine.js` and resolves all country metadata through `resolveCountryFeeRule` or `activeFeeSchedules`.
3. `src/fee-engine.js` (`import { COUNTRIES as BASELINE_COUNTRIES }`) — **D. Dead / Redundant Reference** → Removed. `GLOBAL_COUNTRY_RULES` already contains all 62 markets.
4. `scripts/generate-seo-pages.mjs` (`import { COUNTRIES, COUNTRY_ORDER }`) — **A. Build Dependency** → Updated to pull display rules from `GLOBAL_COUNTRY_RULES` / `src/fee-engine.js` and `STATUTORY_REGULATORY_RATES` from `src/compatibility.js`.
5. `scripts/verify-etsy-fees.mjs` (`import { COUNTRIES }`) — **A. Script Dependency** → Updated to verify rules in `src/fee-engine.js`.
6. `src/countries.js` static fee database — **A. Production Legacy** → All numeric fee rates removed. Retained only non-fee timezone and order utility logic.
7. `tests/seo.test.js` (`import { COUNTRY_ORDER }`) — **B. Test-Only** → Retained, importing clean `COUNTRY_ORDER` array.
8. `tests/release-simulation.test.js` (`import { COUNTRIES as BASELINE_COUNTRIES }`) — **B. Test-Only** → Re-pointed to `tests/legacy/countries.js`.
9. `.github/workflows/etsy-fee-monitor.yml`, `scripts/etsy-fee-monitor.workflow.yml`, `README.md` — **C. Documentation / CI Comment** → Historical reference.

### 2.3 Legacy Calculation Symbols
* `calculateSale`:
  * Removed from production entirely.
  * Preserved in `tests/legacy/calculator.js` for historical regression comparison.
* `calculateRequiredPrice`:
  * Removed from production entirely. Production solver is `solveRequiredPrice` in `src/fee-engine.js`.
  * Preserved in `tests/legacy/calculator.js`.
* `solveMinimumItemPrice`:
  * Deleted with `src/calculator.js`. Replaced by binary search in `src/fee-engine.js`.
* `countryFromTimeZone`:
  * Moved to `src/fee-engine.js` as an authoritative pure utility function.
  * Re-exported from `src/countries.js` for backwards compatibility.
* `COUNTRIES`:
  * Obsolete static fee dictionary deleted from `src/countries.js`.
  * Preserved in `tests/legacy/countries.js` for historical test parity checks.
* `listingFee`, `processingRate`, `processingFixed`, `regulatoryRate`, `offsiteCap`, `plusMonthly`:
  * Zero static fee percentages or fixed fee amounts remain duplicated in `src/countries.js`.
  * Single source of truth is `v1.1.1` dynamic dataset, normalized by `src/compatibility.js` and calculated by `src/fee-engine.js`.

---

## 3. Exact File Actions

### 3.1 Files Deleted
* [`src/calculator.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/src/calculator.js) — Permanently deleted.

### 3.2 Files Modified
* [`src/app.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/src/app.js):
  * Removed imports from `./calculator.js` and `./countries.js`.
  * Imported utilities from `./fee-engine.js` (`calculateOrderFees`, `solveRequiredPrice`, `resolveCountryFeeRule`, `countryFromTimeZone`, `formatMoney`, `asCents`, `OFFICIAL_TRANSACTION_RATE`).
  * Removed test-only comparison helper `compareLegacyVsNewCalculation`.
  * Replaced all `COUNTRIES[...]` fallbacks with `resolveCountryFeeRule(...)`.
* [`src/countries.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/src/countries.js):
  * Removed the static `COUNTRIES` fee database.
  * Retained `COUNTRY_ORDER` and re-exported `countryFromTimeZone`.
* [`src/fee-engine.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/src/fee-engine.js):
  * Removed import from `./countries.js`.
  * Exported `countryFromTimeZone`, `formatMoney`, and `asCents`.
* [`index.html`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/index.html) and generated SEO routes:
  * Replaced preloads of `/src/calculator.js` and `/src/countries.js` with active modules (`/src/fee-intelligence-client.js`, `/src/compatibility.js`, `/src/fee-engine.js`).
* [`scripts/generate-seo-pages.mjs`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/scripts/generate-seo-pages.mjs):
  * Re-pointed fee table and country selector generation to `GLOBAL_COUNTRY_RULES` and `STATUTORY_REGULATORY_RATES`.
* [`scripts/verify-etsy-fees.mjs`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/scripts/verify-etsy-fees.mjs):
  * Re-pointed validation to `GLOBAL_COUNTRY_RULES` and `STATUTORY_REGULATORY_RATES`.
* [`scripts/check-etsy-fee-updates.mjs`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/scripts/check-etsy-fee-updates.mjs):
  * Updated notification text.
* [`tests/fee-integrity.test.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/tests/fee-integrity.test.js):
  * Updated to verify active engine rules.
* [`tests/i18n.test.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/tests/i18n.test.js):
  * Updated to test `calculateOrderFees` and `solveRequiredPrice` directly.
* [`tests/ui-fee-engine-integration.test.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/tests/ui-fee-engine-integration.test.js):
  * Re-pointed legacy comparison imports to `tests/legacy/`.
* [`tests/compatibility.test.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/tests/compatibility.test.js) & [`tests/release-simulation.test.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/tests/release-simulation.test.js):
  * Re-pointed legacy comparison fixtures to `tests/legacy/`.

### 3.3 Test Archive Files Created
* [`tests/legacy/calculator.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/tests/legacy/calculator.js) — Frozen legacy calculation engine.
* [`tests/legacy/countries.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/tests/legacy/countries.js) — Frozen legacy 12-country fee database.
* [`tests/legacy/legacy-calculator.test.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/tests/legacy/legacy-calculator.test.js) — Historical unit test suite.
* [`tests/legacy/legacy-fee-integrity.test.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/tests/legacy/legacy-fee-integrity.test.js) — Historical fee integrity test suite.
* [`tests/legacy/legacy-calculator-freeze.test.js`](file:///c:/Users/KANISHKA%20GIRI/Desktop/kanishka/tests/legacy/legacy-calculator-freeze.test.js) — Historical freeze verification suite.

---

## 4. Verification and Regression Audit

* **`npm.cmd test`**: **283 / 283 tests passed** (0 failures).
* **`npm.cmd run build`**: 4 static SEO routes + static fee table generated cleanly.
* **`npm.cmd run build:seo`**: Succeeded with 0 errors.
* **`npm.cmd run check:launch`**: Fee integrity and contact configuration verified.
* **`npm.cmd run check:etsy`**: Official policy monitoring verified.
* **Cloudflare Worker test suites**: 56 / 56 tests passed (`test-discovery.mjs`, `test-publishing.mjs`, `test-worker-unit.mjs`).
* **Zero Production Mutations**: Cloudflare Worker, D1, Pages, DNS, Cron remain 100% untouched.
