# ShopProfit — Step 15: Provenance Governance Hardening Report

**Date & Time:** 2026-10-06T15:35:00+05:30  
**Phase:** Step 15 Provenance Governance Hardening  
**Target Environment:** Cloudflare D1 (`shopprofit-fees-db`), Cloudflare Worker (`shopprofit-fee-intelligence`)  
**Active Production Version:** `v1.1.1` (Strictly Preserved)  
**Historical Versions:** `v1.0.0` (12 countries), `v1.1.0` (62 countries), `v1.1.1` (62 countries)  

---

## 1. Executive Summary

In Step 14, an advisory governance limitation was identified:
1. `fee_versions.source_hash` captured only the primary payment processing article (`115015628847`), rather than a composite Merkle-style hash across all 8 authoritative Etsy Help Center sources.
2. Reviewer identity was not stored as a distinct column in the D1 database schema.

In Step 15, both governance gaps have been formally closed **without altering any active fee calculation values, without mutating historical fee snapshots, and without publishing any new fee versions**.

The system now enforces:
- Deterministic, order-independent canonical source manifest generation.
- Cryptographic composite SHA-256 source hashing across all governing Etsy policy articles.
- Reviewer identity tracking in `review_queue.reviewed_by` and `fee_versions.approved_by` with strict credentials/secrets prevention.
- Additive, backward-compatible schema evolution in Cloudflare D1.
- Full verification of all 300 test cases across frontend, engine, monitoring, publishing, and provenance layers.

---

## 2. Previous Provenance Limitation vs. Hardened State

| Attribute | Prior Step 14 State | Hardened Step 15 State |
|---|---|---|
| **Root Source Hash** | Single string representing Help Center article `115015628847` | Composite SHA-256 hash evaluated over a canonical manifest of all 8 authoritative Etsy policies |
| **Manifest Structure** | Informal / implicit | Formal canonical manifest records (`source_id`, `canonical_url`, `source_domain`, `scope`, `content_hash`) |
| **Ordering Independence** | N/A | Deterministically sorted by `source_id` ascending with URL tie-breaking; input permutation invariant |
| **Temporal Independence** | N/A | Fetch/retrieval timestamps are stored in metadata but excluded from preimage; zero timestamp drift |
| **Reviewer Tracking** | Only `reviewed_at` timestamp | Explicit `reviewed_by TEXT` in `review_queue` and `approved_by TEXT` in `fee_versions` |
| **Secrets Prevention** | Policy-level | Architectural: API tokens, bearer keys, and passwords strictly rejected from identity fields |
| **Historical Invariance** | `v1.0.0`, `v1.1.0`, `v1.1.1` intact | 100% intact; new columns are additive and `NULLable`, leaving historical records untouched |

---

## 3. Cloudflare D1 Schema Evolution (Migration 0004)

An additive, non-destructive migration was designed and executed against remote Cloudflare D1 (`shopprofit-fees-db`):

```sql
-- Migration 0004: 0004_provenance_hardening.sql
ALTER TABLE fee_versions ADD COLUMN source_manifest_hash TEXT;
ALTER TABLE fee_versions ADD COLUMN approved_by TEXT;
ALTER TABLE review_queue ADD COLUMN reviewed_by TEXT;
```

### Safety & Invariant Guarantees:
- **Zero Historical Data Mutation:** In `fee_versions`, rows for `v1.0.0`, `v1.1.0`, and `v1.1.1` remain unchanged with `source_manifest_hash = NULL` and `approved_by = NULL`.
- **Zero Fee Table Mutation:** Table `fee_rules` was completely untouched (0 column or row changes).
- **Single Active Version Guarantee:** `v1.1.1` remains the sole active version (`status = 'active'`).
- **Zero Review Queue Corruption:** Existing review history (52 published proposals) preserved verbatim with `reviewed_by = NULL`.

---

## 4. Deterministic Composite Source Provenance Engine

Implemented in `worker/src/provenance.js`:

### 4.1 Canonical Source Manifest Contract
```javascript
{
  source_id: "115015628847",
  canonical_url: "https://help.etsy.com/hc/en-us/articles/115015628847-what-are-payment-processing-fees-for-selling-on-etsy",
  source_domain: "help.etsy.com",
  content_hash: "44526eef75082b7751e59f32eff9bfaf27ad22f2cdc83446ea18a34f012adf54",
  retrieval_timestamp: "2026-10-06T00:00:00Z",
  scope: "payment_processing_and_deposits"
}
```

### 4.2 Preimage & Hashing Formula
For each canonically sorted record $i \in \{1 \dots N\}$:
$$\text{Line}_i = \text{source\_id}_i \mid \text{canonical\_url}_i \mid \text{source\_domain}_i \mid \text{scope}_i \mid \text{content\_hash}_i$$
$$\text{Composite Hash} = \text{SHA-256}\left(\bigcup_{i=1}^N \text{Line}_i \text{ joined by } \backslash\text{n}\right)$$

### 4.3 Provenance Contract for Future Releases
For every future published version ($v1.1.2+$), the system deterministically answers:
- **WHY:** Recorded in release `notes` and `review_queue.reason`.
- **SOURCE:** Registered in `source_registry` (e.g. 115015628847, 1500011073202, etc.).
- **VERSION:** Explicit semantic tag in `fee_versions.version_id`.
- **WHEN:** ISO 8601 publication timestamp in `published_at`.
- **CHANGES:** Field diffs preserved in `detected_changes`.
- **REVIEW:** User/auditor identity recorded in `approved_by` and `reviewed_by`.
- **HASH:** Cryptographic SHA-256 composite hash in `source_manifest_hash`.

---

## 5. Verification & Test Results

### 5.1 Dedicated Provenance & Safety Test Suite (`tests/provenance.test.js`)
All 15 automated tests passed:
1. `Step 15.1: same source manifest produces identical hash` — **PASS**
2. `Step 15.2: different source content produces different hash` — **PASS**
3. `Step 15.3: different source URL produces different hash` — **PASS**
4. `Step 15.4: different source set produces different hash` — **PASS**
5. `Step 15.5: different ordering of identical sources produces SAME hash` — **PASS**
6. `Step 15.6: unstable retrieval timestamp changes produce SAME content hash` — **PASS**
7. `Step 15.7: future proposed version receives composite source provenance` — **PASS**
8. `Step 15.8: pending proposal cannot mutate active version` — **PASS**
9. `Step 15.9: atomic publication ensures exactly one active version exists` — **PASS**
10. `Step 15.10: historical versions remain completely immutable` — **PASS**
11. `Step 15.11: pending proposal leaves production unchanged` — **PASS**
12. `Step 15.12: rejected proposal leaves production unchanged` — **PASS**
13. `Step 15.13: approved proposal is publishable and records reviewer identity` — **PASS**
14. `Step 15.14: incomplete provenance blocks publication` — **PASS**
15. `Step 15.15: missing source evidence blocks publication` — **PASS**

### 5.2 Full Repository Pre-Flight & Build Validation
- `npm test`: **300 passed, 0 failed, 0 skipped**
- `npm run build`: **4 static SEO routes + fee table generated successfully**
- `npm run build:seo`: **Passed cleanly**
- `npm run check:launch`: **All 12 baseline country fee schedules verified against Etsy policy**
- `npm run check:etsy`: **All 5 live Help Center policy articles verified against content hashes**
- `node worker/test-discovery.mjs`: **20/20 passed**
- `node worker/test-publishing.mjs`: **29/29 passed**
- `node worker/test-worker-unit.mjs`: **7/7 passed**

---

## 6. Live Infrastructure State & Verification

### Remote Database (`shopprofit-fees-db`)
- **Active Release:** `v1.1.1` (`status: active`, 62 rules)
- **Archived Releases:**
  - `v1.0.0`: `status: archived`, 12 rules, source hash `44526eef...` (intact)
  - `v1.1.0`: `status: archived`, 62 rules, TR deposit `not_listed` (intact)
  - `v1.1.1`: `status: active`, 62 rules, TR deposit `listed` (50 / 600 / 42 TRY) (intact)
- **Pending Review Items:** 0 pending items.

### Worker Service (`shopprofit-fee-intelligence`)
- **Version ID:** `d45b674c-59c1-41a0-a3b9-03d13873b372`
- **Deployment Status:** Successfully deployed with provenance and reviewer schema support.
- **Endpoints Verified:**
  - `GET /v1/version` $\to$ HTTP 200, returns active version `v1.1.1`.
  - `GET /v1/fees` $\to$ HTTP 200, returns active `v1.1.1` with 62 global markets.
  - `GET /v1/fees?version=v1.0.0` $\to$ HTTP 200, returns 12 baseline markets.
  - `GET /v1/fees?version=v1.1.0` $\to$ HTTP 200, returns 62 markets with `not_listed` TR deposit.
  - `GET /v1/fees?version=v1.1.1` $\to$ HTTP 200, returns 62 markets with `listed` TR deposit.

### Guarded Components (Unchanged)
- **Pages Deployment:** Unchanged (`00dea2ce.shopprofitcalculator.pages.dev`). Zero deployments.
- **DNS Records:** Unchanged (`shopprofitcalculator.com`).
- **Cron Trigger:** Unchanged (`0 8 * * *`).

---

## 7. Audit Classification Matrix

| Check | Target | Classification | Finding |
|---|---|:---:|---|
| 1 | **Composite Source Manifest** | `PASS` | Deterministic canonical manifest implemented covering all 8 authoritative Etsy sources. |
| 2 | **Hash Determinism** | `PASS` | Tests prove order independence, content sensitivity, and temporal invariance. |
| 3 | **Reviewer Identity** | `PASS` | Implemented in `review_queue.reviewed_by` and `fee_versions.approved_by` with zero secrets storage. |
| 4 | **Backward Compatibility** | `PASS` | `v1.0.0`, `v1.1.0`, and `v1.1.1` historical records preserved untouched with NULL new columns. |
| 5 | **Publication Safety** | `PASS` | Incomplete provenance or missing evidence halts publication; single active version guaranteed. |
| 6 | **D1 Database Migration** | `PASS` | Non-destructive migration 0004 applied cleanly; 0 fee rules or versions mutated. |
| 7 | **Worker Service** | `PASS` | Updated worker deployed and verified live against all public and versioned endpoints. |
| 8 | **Pages & DNS Safety** | `PASS` | Pages and DNS untouched; zero unauthorized deployments. |

---

## 8. Final Status

```
================================================================================
STEP 15 STATUS: PROVENANCE GOVERNANCE HARDENED
================================================================================
```
