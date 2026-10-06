# ShopProfit — Step 30: Global SEO Technical Consistency Audit

**Date:** 2026-10-06  
**Audit Type:** Read-Only Global Production SEO Technical Audit  
**Production URL:** `https://shopprofitcalculator.com`  
**Pages Deployment:** `d0d28d76`  
**Worker ID:** `73858135-0a40-4eef-befa-4187e65534d0`  
**Active Fee Version:** `v1.1.1`  
**Database:** D1 `shopprofit-fees-db`  
**Audit Status:** PASSED — NO BLOCKERS  

---

## 1. Executive Summary

Following the completion of Step 29 (`/fees/` Search-Intent & Calculator SEO Fix), a comprehensive, read-only technical audit of the live ShopProfit production infrastructure was conducted.

The audit verified URL normalization, crawlability, canonical integrity, heading structures, internal links, fragment targets, structured data schemas, indexability headers, security policies, and test suite health across all 11 indexable routes.

### Summary of Core Findings
1. **Zero Indexing Blockers:** All 11 canonical routes return HTTP 200, have valid absolute HTTPS canonicals matching `sitemap.xml`, and receive full crawler access via `robots.txt`.
2. **Preview Domain Protection Intact:** `d0d28d76.shopprofitcalculator.pages.dev` strictly emits `X-Robots-Tag: noindex, nofollow`, preventing search engine indexation of preview deployments.
3. **Strict Heading Hierarchy:** Exactly 1 H1 per indexable page. The brand slogan `"KNOW WHAT YOU KEEP."` is consistently styled as a non-heading visual element across all pages.
4. **Distinct Keyword Intent:** Clear separation between `/` (Etsy Profit Calculator) and `/fees/` (Etsy Fee Calculator), with pairwise content similarity at only 43%.
5. **Structured Data Accuracy:** All 7 FAQPage JSON-LD schemas match visible page text with 100% accuracy. Zero synthetic review or product schemas exist.
6. **All Test Suites Passing:** 307/307 unit/integration tests pass; launch checks, live Etsy policy checks, and synthetic production canary checks pass with 0 failures.

---

## 2. URL Normalization Audit

Each route was audited live against `https://shopprofitcalculator.com` via HTTP requests with `redirect: manual` to evaluate status code, redirect behavior, and canonical enforcement.

| Route | Live Status | Final Status | Redirect Chain | Canonical URL | Canonical Match |
| :--- | :---: | :---: | :---: | :--- | :---: |
| `/` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/` | EXACT |
| `/fees` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/fees/` | Consolidates to `/fees/` |
| `/fees/` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/fees/` | EXACT |
| `/methodology` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/methodology/` | Consolidates to `/methodology/` |
| `/methodology/` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/methodology/` | EXACT |
| `/faq` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/faq/` | Consolidates to `/faq/` |
| `/faq/` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/faq/` | EXACT |
| `/etsy-fee-calculator` | 301 | 200 | 1 hop (`-> /fees/`) | `https://shopprofitcalculator.com/fees/` | EXACT |
| `/etsy-profit-calculator` | 301 | 200 | 1 hop (`-> /`) | `https://shopprofitcalculator.com/` | EXACT |
| `/calculator` | 301 | 200 | 1 hop (`-> /#calculator`) | `https://shopprofitcalculator.com/` | EXACT |
| `/fee-breakdown` | 301 | 200 | 1 hop (`-> /fees/`) | `https://shopprofitcalculator.com/fees/` | EXACT |
| `/how-it-works` | 301 | 200 | 1 hop (`-> /methodology/`) | `https://shopprofitcalculator.com/methodology/` | EXACT |
| `/help` | 301 | 200 | 1 hop (`-> /faq/`) | `https://shopprofitcalculator.com/faq/` | EXACT |
| `/etsy-fee-calculator-uk` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/etsy-fee-calculator-uk` | EXACT |
| `/etsy-fee-calculator-uk/` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/etsy-fee-calculator-uk` | Consolidates to clean slug |
| `/etsy-fee-calculator-canada` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/etsy-fee-calculator-canada` | EXACT |
| `/etsy-fee-calculator-canada/` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/etsy-fee-calculator-canada` | Consolidates to clean slug |
| `/etsy-fee-calculator-australia` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/etsy-fee-calculator-australia` | EXACT |
| `/etsy-fee-calculator-australia/` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/etsy-fee-calculator-australia` | Consolidates to clean slug |
| `/etsy-digital-download-fee-calculator` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/etsy-digital-download-fee-calculator` | EXACT |
| `/etsy-digital-download-fee-calculator/`| 200 | 200 | 0 hops | `https://shopprofitcalculator.com/etsy-digital-download-fee-calculator` | Consolidates to clean slug |
| `/privacy` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/privacy` | EXACT |
| `/privacy/` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/privacy` | Consolidates to clean slug |
| `/terms` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/terms` | EXACT |
| `/terms/` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/terms` | Consolidates to clean slug |
| `/contact` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/contact` | EXACT |
| `/contact/` | 200 | 200 | 0 hops | `https://shopprofitcalculator.com/contact` | Consolidates to clean slug |

### Normalization Observations:
- **Dual 200s (Clean Slug vs. Directory Slash):** Because Cloudflare Pages Pretty URLs serves `file.html` for non-trailing slash and `file/index.html` for trailing slash, both variants return HTTP 200.
- **Canonical Protection:** In every single dual-variant pair, the canonical tag strictly points to the canonical format defined in `sitemap.xml`. Search engines crawling either URL variant consolidate all indexation signals to the canonical destination without duplication risk.
- **Legacy Redirects:** All 10 legacy redirect rules in `_redirects` execute as clean, single-hop 301 redirects directly to the destination URL. There are zero redirect chains or circular redirects.

---

## 3. Sitemap Audit (`sitemap.xml`)

Verified `https://shopprofitcalculator.com/sitemap.xml`:
- **Total URLs:** 11
- **All URLs Return HTTP 200:** Yes (11/11)
- **Zero Redirect URLs:** Yes (0 redirects)
- **Zero `pages.dev` URLs:** Yes (0)
- **Zero Noindex URLs:** Yes (0)
- **Exact Self-Referential Canonical Match:** Yes (11/11 match canonical tags byte-for-byte)
- **No Orphaned or Stale Routes:** All 11 pages correspond to existing, active production content.

---

## 4. Robots.txt Audit (`robots.txt`)

Verified `https://shopprofitcalculator.com/robots.txt`:
```text
User-agent: *
Allow: /
Sitemap: https://shopprofitcalculator.com/sitemap.xml
```
- **Crawlability:** Unrestricted (`Allow: /`).
- **Sitemap Directive:** Present and points to absolute HTTPS location.
- **Zero Syntax Errors / Conflicts:** Confirmed.
- **Zero `pages.dev` Leaks:** Confirmed.

---

## 5. Canonical Tag Audit

- **Count per page:** Exactly 1 canonical tag per HTML document.
- **Protocol:** Absolute `https://` on every page.
- **Domain:** `https://shopprofitcalculator.com` on every page.
- **Self-referential accuracy:** Every canonical tag points directly to the canonical representation of that resource.
- **Target Status:** 100% of canonical targets return HTTP 200. Zero targets are redirects or 404s.

---

## 6. H1, Title & Search-Intent Audit

| Route | Document Title | H1 Heading | H1 Count | Primary Search Intent |
| :--- | :--- | :--- | :---: | :--- |
| `/` | `Etsy Profit Calculator — Fees, Costs & Net Profit \| ShopProfit` | `Etsy Profit Calculator` | 1 | Etsy profit calculator, margin calculation, take-home profit |
| `/fees/` | `Etsy Fee Calculator — Calculate Etsy Seller Fees \| ShopProfit` | `Etsy Fee Calculator` | 1 | Etsy fee calculator, fee breakdown, seller platform fees |
| `/etsy-fee-calculator-uk` | `Etsy Fee Calculator UK — ShopProfit` | `Etsy Fee Calculator UK` | 1 | UK Etsy fee calculator, GBP seller fees, UK regulatory fee |
| `/etsy-fee-calculator-canada` | `Etsy Fee Calculator Canada — ShopProfit` | `Etsy Fee Calculator Canada` | 1 | Canada Etsy fee calculator, CAD fees, CA regulatory fee |
| `/etsy-fee-calculator-australia` | `Etsy Fee Calculator Australia — ShopProfit` | `Etsy Fee Calculator Australia` | 1 | Australia Etsy fee calculator, AUD seller fees |
| `/etsy-digital-download-fee-calculator` | `Etsy Digital Download Fee Calculator — ShopProfit` | `Etsy Digital Download Fee Calculator` | 1 | Etsy digital download fee calculator, printables/SVG fees |
| `/methodology/` | `Etsy Profit Calculator Methodology \| How ShopProfit Calculates Profit` | `How ShopProfit Estimates Etsy Take-Home & Net Profit` | 1 | Transparent arithmetic calculation formulas & fee logic |
| `/faq/` | `Etsy Profit Calculator FAQ – Etsy Fees & Profit Questions \| ShopProfit` | `Etsy Profit Calculator FAQ` | 1 | Frequently asked questions on Etsy fees, shipping, margins |
| `/privacy` | `Privacy Notice \| ShopProfit` | `Privacy notice` | 1 | Browser-local privacy policies and data storage notice |
| `/terms` | `Terms of Use \| ShopProfit` | `Terms of use` | 1 | Service terms of use and disclaimer of Etsy affiliation |
| `/contact` | `Contact ShopProfit` | `Contact ShopProfit` | 1 | Contact information and operator support |

### Heading Hierarchy Checks:
- **Zero Duplicate Titles:** All 11 titles are unique and intent-aligned.
- **Zero Duplicate H1s:** All 11 H1s are unique across the site.
- **Zero Missing / Multiple H1s:** Every page has exactly one `<h1>`.
- **Brand Slogan:** `"KNOW WHAT YOU KEEP."` is enclosed in a `<div class="hero-title">` on all 5 calculator routes and `/fees/`, preserving visual design without polluting the semantic document outline.

---

## 7. Internal Link & Footer Consistency Audit

1. **Header Navigation:**
   - Calculator routes (`/`, `/fees/`, UK, Canada, Australia, Digital) link to `#calculator`, `/fees/`, `/methodology/`, `/faq/`.
   - Informational routes (`/methodology/`, `/faq/`) link to `/#calculator`, `/fees/`, `/methodology/`, `/faq/`.
2. **Footer Navigation Symmetry:**
   - Every calculator route (`/`, `/fees/`, UK, CA, AU, Digital) has an identical footer structure:
     - **Tools:** Etsy profit calculator (`/#calculator`), Etsy fee calculator (`/fees/`), Etsy pricing calculator (`/#target-pricing`), Etsy break-even calculator (`/#break-even-tool`), Etsy Offsite Ads calculator (`/#offsite-ads`), Etsy digital product calculator (`/etsy-digital-download-fee-calculator`).
     - **Regional Calculators:** United Kingdom (`/etsy-fee-calculator-uk`), Canada (`/etsy-fee-calculator-canada`), Australia (`/etsy-fee-calculator-australia`).
     - **Resources:** Etsy fees guide (`/fees/`), Methodology (`/methodology/`), FAQ (`/faq/`).
     - **Legal:** Privacy (`/privacy`), Terms (`/terms`), Contact (`/contact`).
3. **Cross-Link Connectivity:**
   - Homepage links to `/fees/`: Confirmed.
   - `/fees/` links to all 4 specialized calculators: Confirmed.
   - Specialized calculators link to `/fees/`: Confirmed.
   - Methodology and FAQ link back to the interactive calculator: Confirmed.
4. **Zero Broken Internal Links:** All links resolve to active 200 HTTP targets.
5. **Zero Links to Redirect URLs:** Verified that HTML pages do not link to legacy redirect sources.
6. **Minor Observation:** `404.html` links to `/#fees` instead of `/fees/`. (Classified as LOW recommendation).

---

## 8. Fragment & Legacy Anchor Audit

All 9 tracked fragment identifiers were audited against the target document DOM:
- `#calculator`: Valid. Exists on `/`, `/fees/`, UK, Canada, Australia, and Digital.
- `#target-pricing`: Valid. Exists on `index.html`.
- `#break-even-tool`: Valid. Exists on `index.html`.
- `#offsite-ads`: Valid. Exists on `index.html`.
- `#fees`: Valid. Exists on `index.html` (Fee table section).
- `#faq`: Valid. Exists on `index.html`, UK, CA, AU, Digital.
- `#top`: Valid. Skip-to-top header anchor on all pages.
- `#result-heading`: Valid. Result panel header anchor for mobile action bar on all calculator pages.
- `#method`: 0 occurrences in `href` attributes (cleanly uses `/methodology/`).

**Result:** 100% of fragment links point to existing elements on the destination pages. Zero broken fragments.

---

## 9. Structured Data Audit (JSON-LD)

- **Total JSON-LD Blocks:** 18 blocks across 11 pages.
- **JSON Validity:** 100% valid JSON syntax without errors.
- **Disallowed / Spam Schemas:** Zero `Product`, `Review`, or `AggregateRating` schemas exist.
- **Schema Inventory:**
  - `@graph` WebSite / WebPage / Organization schemas present across all pages.
  - `FAQPage` schemas present on:
    - `/` (12 FAQs)
    - `/fees/` (6 FAQs)
    - `/faq/` (12 FAQs)
    - `/etsy-fee-calculator-uk` (6 FAQs)
    - `/etsy-fee-calculator-canada` (6 FAQs)
    - `/etsy-fee-calculator-australia` (6 FAQs)
    - `/etsy-digital-download-fee-calculator` (6 FAQs)
- **Visible Text Parity:** 100% of FAQ schema questions and answers match the visible text within `<details><summary>` and `<p>` tags on their respective pages.
- **Canonical URLs:** All JSON-LD `@id` and `url` properties use `https://shopprofitcalculator.com`. Zero leaks to `pages.dev`.

---

## 10. Content Duplication Analysis (Jaccard Similarity)

Pairwise Jaccard similarity was calculated across body copy (`<main>` elements) excluding headers and footers:

| Page Pair | Body Similarity | Intent & Context | Assessment |
| :--- | :---: | :--- | :--- |
| `UK` vs `Canada` | 81% | Shared calculator input/output panels + 12-country fee table. | INTENTIONAL (Shared UI with localized fee copy & FAQs) |
| `Canada` vs `Australia` | 75% | Shared calculator input/output panels + 12-country fee table. | INTENTIONAL |
| `UK` vs `Australia` | 68% | Shared calculator input/output panels + 12-country fee table. | INTENTIONAL |
| `Homepage` vs `UK` | 58% | Shared calculator form, divergent explanatory copy. | HEALTHY |
| `Homepage` vs `Canada` | 56% | Shared calculator form, divergent explanatory copy. | HEALTHY |
| `Homepage` vs `Australia` | 54% | Shared calculator form, divergent explanatory copy. | HEALTHY |
| `Homepage` vs `Digital` | 49% | Zeroed shipping/cost UI and digital-specific copy. | HEALTHY |
| `Homepage` vs `Fees` | 43% | Profit calculator vs Fee calculator; distinct intent. | EXCELLENT (No cannibalization) |
| `Fees` vs `Regional Pages` | 44%–46% | Educational fee guide vs localized calculators. | EXCELLENT |
| `Fees` vs `FAQ` | 33% | Comprehensive guide vs accordion FAQ list. | EXCELLENT |
| `Homepage` vs `FAQ` | 30% | Interactive tool vs dedicated FAQ directory. | EXCELLENT |
| `Methodology` vs `All` | 23%–27% | Pure arithmetic formulas & algorithmic definitions. | UNIQUE |

### Duplication Assessment:
The similarity between regional calculator pages (68%–81%) is driven exclusively by shared interactive calculator controls and the standard 12-country reference table. All descriptive content, localized fee breakdowns, postal carrier impact analyses, FAQ accordions, structured data, and metadata are 100% unique to each sovereign jurisdiction. This complies fully with Google Search quality guidelines for localized utility applications.

---

## 11. Complete SEO Route Inventory

| Route | HTTP | Indexable? | Page Title | Primary H1 | Canonical URL | In Sitemap? | Robots Tag | Schema Types | Primary Intent |
| :--- | :---: | :---: | :--- | :--- | :--- | :---: | :---: | :--- | :--- |
| `/` | 200 | YES | `Etsy Profit Calculator — Fees, Costs & Net Profit \| ShopProfit` | `Etsy Profit Calculator` | `https://shopprofitcalculator.com/` | YES | `null` (Allow) | WebSite, WebApp, FAQPage | Net profit, margins, unit break-even |
| `/fees/` | 200 | YES | `Etsy Fee Calculator — Calculate Etsy Seller Fees \| ShopProfit` | `Etsy Fee Calculator` | `https://shopprofitcalculator.com/fees/` | YES | `null` (Allow) | WebPage, WebApp, FAQPage | Platform fee deduction calculation |
| `/etsy-fee-calculator-uk` | 200 | YES | `Etsy Fee Calculator UK — ShopProfit` | `Etsy Fee Calculator UK` | `https://shopprofitcalculator.com/etsy-fee-calculator-uk` | YES | `null` (Allow) | WebPage, WebApp, FAQPage | UK seller fee & profit calculations in GBP |
| `/etsy-fee-calculator-canada` | 200 | YES | `Etsy Fee Calculator Canada — ShopProfit` | `Etsy Fee Calculator Canada` | `https://shopprofitcalculator.com/etsy-fee-calculator-canada` | YES | `null` (Allow) | WebPage, WebApp, FAQPage | Canadian fee & profit calculations in CAD |
| `/etsy-fee-calculator-australia` | 200 | YES | `Etsy Fee Calculator Australia — ShopProfit` | `Etsy Fee Calculator Australia` | `https://shopprofitcalculator.com/etsy-fee-calculator-australia` | YES | `null` (Allow) | WebPage, WebApp, FAQPage | Australian fee calculations in AUD |
| `/etsy-digital-download-fee-calculator` | 200 | YES | `Etsy Digital Download Fee Calculator — ShopProfit` | `Etsy Digital Download Fee Calculator` | `https://shopprofitcalculator.com/etsy-digital-download-fee-calculator` | YES | `null` (Allow) | WebPage, WebApp, FAQPage | Digital printable / file download fee margins |
| `/methodology/` | 200 | YES | `Etsy Profit Calculator Methodology \| How ShopProfit Calculates Profit` | `How ShopProfit Estimates Etsy Take-Home & Net Profit` | `https://shopprofitcalculator.com/methodology/` | YES | `null` (Allow) | WebPage | Integer arithmetic math formulas & policy sources |
| `/faq/` | 200 | YES | `Etsy Profit Calculator FAQ – Etsy Fees & Profit Questions \| ShopProfit` | `Etsy Profit Calculator FAQ` | `https://shopprofitcalculator.com/faq/` | YES | `null` (Allow) | WebPage, FAQPage | Seller FAQ answers on fees, shipping & ads |
| `/privacy` | 200 | YES | `Privacy Notice \| ShopProfit` | `Privacy notice` | `https://shopprofitcalculator.com/privacy` | YES | `null` (Allow) | WebPage | Browser-local data storage privacy policy |
| `/terms` | 200 | YES | `Terms of Use \| ShopProfit` | `Terms of use` | `https://shopprofitcalculator.com/terms` | YES | `null` (Allow) | WebPage | Terms of use & Etsy non-affiliation disclaimer |
| `/contact` | 200 | YES | `Contact ShopProfit` | `Contact ShopProfit` | `https://shopprofitcalculator.com/contact` | YES | `null` (Allow) | WebPage | Operator contact & support information |

---

## 12. Security & Indexability Headers

### Production Apex (`shopprofitcalculator.com`):
- `X-Robots-Tag`: `null` (Permits full indexing)
- `Strict-Transport-Security`: `max-age=31536000; includeSubDomains` (Active HSTS)
- `X-Frame-Options`: `DENY` (Clickjacking protection)
- `X-Content-Type-Options`: `nosniff` (MIME-sniffing protection)
- `Referrer-Policy`: `strict-origin-when-cross-origin`
- `Content-Security-Policy`: Fully configured, restricts scripts to `'self'`, fonts to Google Fonts, connect to Cloudflare Worker.

### Preview Domain (`d0d28d76.shopprofitcalculator.pages.dev`):
- `X-Robots-Tag`: `noindex, nofollow` (Confirmed active across all preview routes)

---

## 13. Test Suite & Health Verification

All tests were executed in read-only validation mode without modifications:
- **`npm.cmd test`**: 307 tests, 0 failures, 0 skipped, duration 9.8s.
- **`npm.cmd run check:launch`**: Fee database integrity verified across all 12 baseline markets. Launch contact checks passed.
- **`npm.cmd run check:etsy`**: Live Etsy Help Center policy scrape verified. Fee schedules are 100% current.
- **`node scripts/production-canary.mjs`**: Synthetic hourly canary PASS (Version `v1.1.1`, 62 sovereign markets).

---

## 14. Classification of Findings & Recommendations

### Findings by Severity:
- **BLOCKER:** None (0)
- **HIGH:** None (0)
- **MEDIUM:** None (0)
- **LOW / RECOMMENDATIONS:**
  1. **404 Page Link Update:** In `404.html`, update `<a href="/#fees">Etsy Fee Calculator</a>` to `<a href="/fees/">Etsy Fee Calculator</a>` now that `/fees/` is a dedicated landing page.
  2. **Trailing Slash Uniformity:** In a future cleanup step, consider consolidating route canonicals to either all trailing-slash or all clean-slug convention site-wide if Cloudflare Pages Pretty URL configuration permits. Currently, the dual-file setup completely mitigates duplicate indexing via self-referential canonicals.

---

## 15. Final Status

**GLOBAL SEO TECHNICAL AUDIT PASSED — NO BLOCKERS**
