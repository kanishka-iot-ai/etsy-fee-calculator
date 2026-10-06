# ShopProfit — Global Etsy Fee Intelligence Worker & D1 Database

This directory houses the standalone **Cloudflare Worker** and **Cloudflare D1 Database** migrations for the **ShopProfit Global Etsy Fee Intelligence System**.

---

## 1. Purpose & Architecture Overview

The purpose of this subsystem is to provide an automated, verified, and versioned intelligence layer for global Etsy seller fee policies without modifying or risking the live ShopProfit production calculator.

```
┌────────────────────────────────────────────────────────┐
│                   Cloudflare Pages                     │
│         (shopprofitcalculator.com - Frontend)          │
│                                                        │
│  • Pure static HTML5 / CSS3 / Vanilla JS               │
│  • Instant client-side math (<1ms) via src/countries.js│
│  • 100% resilient standalone fallback                   │
└───────────────────────────┬────────────────────────────┘
                            │ Non-blocking background fetch
                            ▼
┌────────────────────────────────────────────────────────┐
│                  Cloudflare Worker                     │
│           (shopprofit-fee-intelligence)                │
│                                                        │
│  • Public Read API (/v1/fees, /v1/fees/:country)       │
│  • Automated Etsy Help Center policy monitor           │
│  • Semantic change detection & diff engine             │
│  • Protected admin review & versioning endpoints       │
└───────────────────────────┬────────────────────────────┘
                            │ D1 Binding (env.DB)
                            ▼
┌────────────────────────────────────────────────────────┐
│                Cloudflare D1 Database                  │
│                 (shopprofit-fees-db)                   │
│                                                        │
│  • 8 Normalized Relational Tables                      │
│  • Single-active version constraint                    │
│  • Complete historical snapshot & review audit trail   │
└────────────────────────────────────────────────────────┘
```

> **IMPORTANT:** The production website at `https://shopprofitcalculator.com` currently relies on its bundled, immutable `src/countries.js` dataset. It does **not** depend on this database yet. Zero changes have been made to the live frontend or calculator math.

---

## 2. D1 Schema Overview (8 Tables)

The schema is defined in `migrations/0001_initial_schema.sql`:

1. **`countries`**: Master list of sovereign regions, currency codes, symbols, locales, and support statuses (`active`, `inactive`, `partial`, `pending_review`, `unsupported`).
2. **`fee_versions`**: Release-governed fee version records (`draft`, `active`, `archived`). Enforces that **exactly one version can be active** in production via a partial unique index (`idx_fee_versions_single_active`).
3. **`fee_rules`**: Discrete, itemized fee parameters per country and version (listing fee, transaction rate, domestic/international processing, regulatory operating fees, Offsite Ads caps, Etsy Plus monthly allocations, and official notes).
4. **`source_registry`**: Catalog of monitored official Etsy Help Center articles with last-checked timestamps and baseline SHA-256 hashes.
5. **`snapshots`**: Historical capture repository for raw HTML and normalized text snapshots with audit timestamps.
6. **`detected_changes`**: Field-level diffs detected by automated scrapers, queued for human verification before release.
7. **`review_queue`**: Governance queue where proposed rate adjustments require administrative approval before being promoted.
8. **`monitor_runs`**: Health execution logs for automated scheduled scraper jobs.

---

## 3. Local Development & Testing

Wrangler simulates Cloudflare D1 locally using an embedded SQLite engine.

### Prerequisites
- Node.js $\ge 20$
- Wrangler $\ge 4.147.0$

### Local D1 Commands

Run these commands from within the `worker/` directory:

1. **List local migrations:**
   ```powershell
   npx wrangler d1 migrations list shopprofit-fees-db --local
   ```

2. **Apply migrations to local SQLite:**
   ```powershell
   npx wrangler d1 migrations apply shopprofit-fees-db --local
   ```

3. **Verify tables in local database:**
   ```powershell
   npx wrangler d1 execute shopprofit-fees-db --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
   ```

4. **Verify seeded countries:**
   ```powershell
   npx wrangler d1 execute shopprofit-fees-db --local --command "SELECT country_code, country_name, currency_code, processing_rate FROM countries JOIN fee_rules USING (country_code);"
   ```

5. **Verify active version constraint:**
   ```powershell
   npx wrangler d1 execute shopprofit-fees-db --local --command "SELECT version_id, version_label, status, published_at FROM fee_versions;"
   ```

---

## 4. Configuring `database_id` for Cloudflare Remote

In `worker/wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "shopprofit-fees-db"
database_id = "<INSERT_CLOUDFLARE_D1_DATABASE_ID_HERE>"
```

### How to Retrieve Your Real Cloudflare D1 Database ID:
1. Log in to your Cloudflare Dashboard: [dash.cloudflare.com](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages** $\to$ **D1 SQL Database**.
3. Click on `shopprofit-fees-db`.
4. Copy the **Database ID** (UUID format, e.g., `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
5. Replace `<INSERT_CLOUDFLARE_D1_DATABASE_ID_HERE>` in `worker/wrangler.toml`.

Alternatively, if authenticated via Wrangler CLI:
```powershell
npx wrangler d1 info shopprofit-fees-db
```

---

## 5. Remote Production Deployment Warnings

> ⚠️ **CRITICAL PRODUCTION SAFETY RULE:**  
> Never apply remote migrations or deploy the Worker without completing local verification and obtaining explicit authorization.  
>  
> Applying migrations to `--remote` is a permanent cloud database operation:  
> `npx wrangler d1 migrations apply shopprofit-fees-db --remote`  
>  
> This operation will be executed strictly in future, approved deployment phases.
