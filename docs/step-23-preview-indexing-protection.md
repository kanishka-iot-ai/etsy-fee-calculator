# Step 23 — Preview Domain Indexing Protection Report

**Hardening Mode:** Cloudflare Pages Preview Subdomain Indexing Mitigation  
**Execution Date:** 2026-10-06  
**Auditor / Engineer:** Senior SEO & Cloudflare Systems Architect  
**Production Targets:**
- **Custom Production Domain:** `https://shopprofitcalculator.com/` (Active, fully indexable)
- **Pages Preview Subdomains:** `https://shopprofitcalculator.pages.dev/` & `https://*.shopprofitcalculator.pages.dev/` (`noindex, nofollow`)
- **Pages Deployment ID:** `cde5a9be` (updated from `681f4e6b`)
- **Cloudflare Worker:** `https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev` (`73858135-0a40-4eef-befa-4187e65534d0`) — **UNCHANGED**
- **Cloudflare D1 Database:** `shopprofit-fees-db` — **UNCHANGED** (zero writes)
- **Active Release:** `v1.1.1` (62 markets) — **UNCHANGED**

---

## 1. Previous Behavior & SEO Risk Identified

During the Step 22 SEO audit, the Cloudflare Pages default deployment hostname was inspected:
- **URL:** `https://shopprofitcalculator.pages.dev/`
- **Previous Response:** HTTP 200 OK without any `X-Robots-Tag` header.
- **Risk:** Although `<link rel="canonical" href="https://shopprofitcalculator.com/">` was present in the HTML, search engines (Googlebot, Bingbot) can still discover and crawl `*.pages.dev` URLs, potentially causing duplicate content confusion, crawl budget waste, or split ranking equity.

---

## 2. Header Implementation in `_headers`

In accordance with official Cloudflare Pages URL-matching specifications, rules were added to `_headers`:

```http
https://:project.pages.dev/*
  X-Robots-Tag: noindex, nofollow

https://:version.:project.pages.dev/*
  X-Robots-Tag: noindex, nofollow
```

### Mechanics:
- `:project.pages.dev/*`: Targets the canonical project preview subdomain (`https://shopprofitcalculator.pages.dev/*`).
- `:version.:project.pages.dev/*`: Targets all unique deployment previews and branch previews (`https://cde5a9be.shopprofitcalculator.pages.dev/*`, `https://staging.shopprofitcalculator.pages.dev/*`, etc.).
- **Preservation of Custom Domain:** The rule is host-scoped to `.pages.dev`. The custom production domain (`https://shopprofitcalculator.com/*`) does not match the rule and receives **zero** `X-Robots-Tag`, remaining 100% indexable.

---

## 3. Live Verification & Header Inspection

Live edge requests were verified across production hosts:

### A. Custom Production Domain (`https://shopprofitcalculator.com/`)
- `HTTP Status`: `200 OK`
- `X-Robots-Tag`: `null` (Absent — **Completely Indexable**)
- `Strict-Transport-Security`: `max-age=31536000; includeSubDomains` (Active)
- `Content-Security-Policy`: Active (`default-src 'self' ...`)
- `X-Frame-Options`: `DENY` (Active)
- `X-Content-Type-Options`: `nosniff` (Active)

### B. Project Preview Domain (`https://shopprofitcalculator.pages.dev/`)
- `HTTP Status`: `200 OK`
- `X-Robots-Tag`: `noindex, nofollow` (Active)
- `Strict-Transport-Security`: `max-age=31536000; includeSubDomains` (Active)

### C. Unique Deployment Preview (`https://cde5a9be.shopprofitcalculator.pages.dev/`)
- `HTTP Status`: `200 OK`
- `X-Robots-Tag`: `noindex, nofollow` (Active)

### D. Subpaths (`/fees/`)
- `https://shopprofitcalculator.com/fees/`: `X-Robots-Tag: null`
- `https://shopprofitcalculator.pages.dev/fees/`: `X-Robots-Tag: noindex, nofollow`

---

## 4. SEO & Crawlability Regression Check

- **sitemap.xml:** Verified at `https://shopprofitcalculator.com/sitemap.xml`. Contains 0 references to `pages.dev`; all 11 URLs reference the canonical apex domain.
- **robots.txt:** Verified unchanged (`Allow: /`, pointing to apex sitemap).
- **Canonical Tags:** Production HTML continues to serve `<link rel="canonical" href="https://shopprofitcalculator.com/">`.
- **Zero Accidental Blocking:** No `noindex` or `nofollow` directives exist on any apex domain responses.

---

## 5. Automated Test & Application Regression

- Added automated test in `tests/seo.test.js`:
  - `pages.dev deployments receive X-Robots-Tag: noindex, nofollow while apex domain remains indexable`
- Full regression suite execution:
  - `npm.cmd test`: **307/307 passed** (100% green)
  - `npm.cmd run build`: Passed
  - `npm.cmd run build:seo`: Passed
  - `npm.cmd run check:launch`: Passed (fees integrity + contact check)
  - `npm.cmd run check:etsy`: Passed (live official policy hashes)
  - `node worker/test-discovery.mjs`: **20/20 passed**
  - `node worker/test-publishing.mjs`: **29/29 passed**
  - `node worker/test-worker-unit.mjs`: **9/9 passed**
  - `node scripts/production-canary.mjs`: **PASS** (hourly synthetic canary verified healthy)

---

## 6. Cloudflare State Ledger

| Component | State | Details |
|---|---|---|
| **Pages** | `CHANGED` | `_headers` updated with preview indexing rules; deployed to `cde5a9be` |
| **Worker** | `UNCHANGED` | `73858135-0a40-4eef-befa-4187e65534d0` active |
| **D1** | `UNCHANGED` | `shopprofit-fees-db` intact; zero database mutations |
| **DNS** | `UNCHANGED` | Custom domain apex routing untouched |
| **Cron** | `UNCHANGED` | `0 8 * * *` scheduled policy sync active |
| **Active Version** | `UNCHANGED` | `v1.1.1` active across all 62 markets |
| **Fee Rules & Logic** | `UNCHANGED` | Source hash `44526eef...` 100% identical |
