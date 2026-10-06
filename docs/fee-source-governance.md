# ShopProfit — Fee Source Governance Architecture

## 1. Overview & Core Tenets

ShopProfit operates a mission-critical financial intelligence engine calculating Etsy marketplace fees across 62 global sovereign markets and standard fallback tiers. Because fee policies, regulatory levies, and payment processing structures are determined by Etsy and local statutory authorities, ShopProfit enforces a **strict, fail-closed, human-in-the-loop governance model**.

### Governance Principles
1. **Official Authority Only:** Only published, official Etsy Help Center policy articles and legal terms serve as authoritative sources. Third-party blogs, forums, and unverified assumptions are strictly prohibited.
2. **Zero Silent Mutations:** Neither automated scraping routines, scheduled Cloudflare Cron Triggers, nor background workers are permitted to directly alter active production fee data.
3. **Immutability of History:** Published fee versions (`v1.0.0`, `v1.1.0`, `v1.1.1`, etc.) are immutable snapshots. Historical versions remain reproducible and queryable forever.
4. **Single Active Version:** The system enforces an atomic, single-active-version paradigm. Exactly one version holds `status = 'active'` in Cloudflare D1.
5. **Fail-Closed Frontend Locking:** The client web application explicitly binds to an expected fee version (`EXPECTED_VERSION_ID = 'v1.1.1'`). Any API mismatch, schema corruption, or network breakdown immediately fails closed with an explicit user alert, preventing silent miscalculations.

---

## 2. Authoritative Etsy Source Registry

ShopProfit maintains an indexed registry in Cloudflare D1 (`source_registry`) and a local verification suite (`config/etsy-fee-sources.json`) mapping every calculated fee component to its governing Etsy Help Center policy article.

| Source ID | Policy Title | Official URL | Fee Scope Governed | Validation Method |
|---|---|---|---|---|
| `115015628847` | Payment Processing Fees for Selling on Etsy | [help.etsy.com/.../115015628847](https://help.etsy.com/hc/en-us/articles/115015628847-What-are-Payment-Processing-Fees-for-Selling-on-Etsy) | Domestic/intl payment processing rates, fixed transaction fees, currency definitions, and statutory deposit fee schedules (ID, IL, MY, MX, MA, PH, ZA, TR, VN). | SHA-256 content hashing + Table 1 & Table 2 HTML parser |
| `1500011073202` | Regulatory Operating Fee | [help.etsy.com/.../1500011073202](https://help.etsy.com/hc/en-us/articles/1500011073202-What-is-a-Regulatory-Operating-Fee) | Statutory regulatory operating fee rates for CA (0.5%), FR (0.4%), HU (0.4%), IT (0.32%), IN (0.05%), ES (0.4%), TR (1.67%), UK (0.48%), VN (1.24%). | SHA-256 content hashing + regex extraction of country percentage rules |
| `115014483627` | Fees and Taxes for Selling on Etsy | [help.etsy.com/.../115014483627](https://help.etsy.com/hc/en-us/articles/115014483627-What-are-the-Fees-and-Taxes-for-Selling-on-Etsy) | Global listing fee ($0.20 USD / 4-month renewal), global transaction fee (6.5% of total sale amount including shipping and gift wrap). | SHA-256 content hashing + key phrase extraction |
| `360000338367` | How Etsy Offsite Ads Work | [help.etsy.com/.../360000338367](https://help.etsy.com/hc/en-us/articles/360000338367-How-Etsy-s-Offsite-Ads-Work) | Standard tier (15% optional < $10k USD trailing 12 mo), high-volume mandatory tier (12% >= $10k USD), and statutory $100 USD-equivalent fee cap per order. | SHA-256 content hashing + rule extraction |
| `360001589928` | What is Etsy Plus? | [help.etsy.com/.../360001589928](https://help.etsy.com/hc/en-us/articles/360001589928-What-is-Etsy-Plus) | Monthly subscription fee ($10 USD/mo), 15 monthly listing credits ($3 USD value), and $5 USD monthly Etsy Ads credit. | SHA-256 content hashing + subscription pricing extraction |
| `360000344668` | Currency Conversion Fees | [help.etsy.com/.../360000344668](https://help.etsy.com/hc/en-us/articles/360000344668-Currency-Conversion-Fees) | 2.5% currency conversion charge applied to the sale amount when listing currency differs from payment account disbursement currency. | Content inspection + 2.5% rate verification |
| `360040584433` | VAT on Seller Fees | [help.etsy.com/.../360040584433](https://help.etsy.com/hc/en-us/articles/360040584433-VAT-on-Seller-Fees) | Jurisdiction-based indirect tax/VAT applied to Etsy seller service fees based on seller tax registration and locality. | Content inspection + tax jurisdiction mapping |
| `115015710408` | Countries Eligible for Etsy Payments | [help.etsy.com/.../115015710408](https://help.etsy.com/hc/en-us/articles/115015710408-Countries-Eligible-for-Etsy-Payments) | 61 sovereign country eligibility list, 16 Payoneer payout markets, and 6 EUR payout markets subject to potential bank FX conversion. | SHA-256 content hashing + country list verification |
| `16999319005207` / `6742925359255` | Auxiliary India Onboarding Policies | [help.etsy.com/.../16999319005207](https://help.etsy.com/hc/en-us/articles/16999319005207-Opening-a-Shop-in-India) | Payoneer account payout requirements, INR local bank settlements, and new shop setup fee metadata ($10 USD). | Content verification |

---

## 3. Two-Tier Verification Architecture

ShopProfit deploys a two-tier verification mechanism ensuring both build-time deterministic integrity and continuous production drift detection.

```
                           +-------------------------------------+
                           |    Official Etsy Help Center API    |
                           +-------------------------------------+
                                      |                 |
                   Local / CI / Build |                 | Cloudflare Cron
                                      v                 v
            +---------------------------+     +-------------------------------+
            |  scripts/check-etsy-fees  |     |   worker/src/monitor.js       |
            |     (npm run check:etsy)  |     |   (executeMonitorRun)         |
            +---------------------------+     +-------------------------------+
                          |                                     |
              Pass / Block Deploy                               v
                                              +-------------------------------+
                                              | Computes Article SHA-256 Hash |
                                              +-------------------------------+
                                                                |
                                              Hash Matches? ----+----> Yes: 0 Changes, Finish
                                                                |
                                                                | No (Content Drift)
                                                                v
                                              +-------------------------------+
                                              | Parses HTML Tables & Rules    |
                                              +-------------------------------+
                                                                |
                                              Valid HTML Table? +----> No: Snapshot Parser Error (Fail Closed)
                                                                |
                                                                | Yes
                                                                v
                                              +-------------------------------+
                                              | Inserts into detected_changes |
                                              |  & review_queue (pending)     |
                                              |  changes_published = 0        |
                                              +-------------------------------+
```

### 1. Build & Release Gatekeeper (`scripts/check-etsy-fees.mjs`)
- Runs as a standard npm script: `npm run check:etsy`.
- Fetches all monitored Etsy Help Center articles over HTTPS.
- Normalizes DOM structure and computes SHA-256 hashes against `config/etsy-fee-sources.json`.
- Enforces semantic extraction: Verifies 6.5% transaction rate, $0.20 listing fee, 15% and 12% Offsite Ads rates, $10 Etsy Plus pricing, and 9 statutory deposit schedules.
- If any hash or parameter fails, the build halts immediately with exit code 1.

### 2. Scheduled Intelligence Discovery (`worker/src/monitor.js`)
- Executed on a schedule via Cloudflare Worker Cron Trigger (`0 */6 * * *`).
- Fetches registered sources and compares SHA-256 content hashes with `source_registry.latest_hash`.
- Extracts structured tables: Domestic/international payment rates, fixed fees, regulatory rates, and deposit thresholds.
- When drift is discovered, it evaluates policy rules and stages proposals into `detected_changes` and `review_queue`.
- **CRITICAL:** `changes_published = 0` is strictly enforced. The scheduled trigger has **no code path** to publish or mutate active fee rules.

---

## 4. Proposal & Review Governance Flow

All discovered changes must pass through a strict human-in-the-loop review queue before any production version is produced.

```
[Etsy Policy Drift]
        |
        v
[detected_changes] (status: pending_review)
        |
        v
[review_queue] (status: pending, priority: low|medium|high|critical)
        |
        +------> Admin rejects (status: rejected) --------> No production change
        |
        v
[Admin Review & Approval] (POST /admin/review-queue/:id/approve)
        |
        v
[Atomic Release Publication] (POST /admin/versions/publish)
        |
        +-- Step 1: Create new version in fee_versions (status: draft)
        +-- Step 2: Insert/snapshot all country rules in fee_rules
        +-- Step 3: Atomic Batch Flip:
        |           - Current active version -> archived
        |           - New version -> active
        |           - review_queue item -> published (reviewed_at timestamped)
        v
[Live D1 Production Active Version Bumped]
```

### Review Queue Mechanics
- **Priority Assignment:**
  - `critical`: Fee rate delta $\ge 5\%$ or currency removal.
  - `high`: Regulatory fee modification or statutory deposit fee change.
  - `medium`: New sovereign country discovery or domestic/international payment processing rate adjustment.
  - `low`: Editorial text or footnote adjustments.
- **Segregation:** The public API (`GET /v1/fees`) queries only `fee_versions WHERE status = 'active'`. Pending or draft proposals in `review_queue` are completely invisible to sellers and client applications.

---

## 5. Version Publication & Immutability Architecture

### Version Metadata Contract
Every published fee version records:
- `version_id`: Semantic identifier (e.g. `v1.0.0`, `v1.1.0`, `v1.1.1`).
- `version_label`: Display version string.
- `status`: Lifecycle state (`active` or `archived`).
- `source_hash`: Cryptographic SHA-256 hash of the governing primary Etsy Help Center source.
- `notes`: Human-readable release description documenting the exact changes and rationale.
- `published_at`: ISO 8601 publication timestamp.

### Atomic Publication Guarantee
Version promotion utilizes Cloudflare D1's atomic batch execution (`db.batch([ ... ])`):
```sql
UPDATE fee_versions SET status = 'archived' WHERE status = 'active';
UPDATE fee_versions SET status = 'active', published_at = CURRENT_TIMESTAMP WHERE version_id = ?;
UPDATE review_queue SET status = 'published', reviewed_at = CURRENT_TIMESTAMP WHERE review_id = ?;
```
If any individual statement in the batch fails, the entire transaction rolls back automatically. It is physically impossible for the database to enter a state with zero active versions or multiple active versions.

### Historical Immutability
Historical fee versions are permanent records. When queries request `GET /v1/fees?version=v1.0.0`, the system joins directly against `fee_rules WHERE version_id = 'v1.0.0'`.
- Deleting or updating records in the mutable working tables (`countries`) has zero impact on historical version responses.
- Tested and verified:
  - `v1.0.0` serves exactly 12 baseline countries.
  - `v1.1.0` serves 62 countries with TR deposit `not_listed`.
  - `v1.1.1` serves 62 countries with TR deposit `listed` (50 / 600 / 42 TRY).

---

## 6. Rollback Model

In the event of an operational anomaly or upstream policy clarification, ShopProfit supports instant, zero-loss rollback to any prior archived version.

### Rollback Workflow
1. Administrative trigger: `POST /admin/versions/:version_id/rollback` with Bearer authentication.
2. The endpoint verifies that `:version_id` exists in `fee_versions`.
3. Executes an atomic batch transaction:
   ```sql
   UPDATE fee_versions SET status = 'archived' WHERE status = 'active';
   UPDATE fee_versions SET status = 'active' WHERE version_id = ?;
   INSERT INTO audit_log (action, details, timestamp) VALUES ('rollback', ?, CURRENT_TIMESTAMP);
   ```
4. Prior fee rules are preserved verbatim; no snapshot recreation is required.
5. Production traffic immediately resolves to the reverted version snapshot upon cache TTL expiration.

---

## 7. Frontend Version Locking & Fail-Closed Guardrails

The frontend client application implements strict version pinning to eliminate the possibility of silent computation errors.

### Implementation Contract (`src/fee-intelligence-client.js`)
```javascript
const EXPECTED_VERSION_ID = 'v1.1.1';

export class FeeIntelligenceClient {
  validatePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Fee intelligence response must be an object');
    }
    if (payload.version_id !== EXPECTED_VERSION_ID) {
      throw new Error(`Fee intelligence version mismatch: expected ${EXPECTED_VERSION_ID}, got ${payload.version_id}`);
    }
    if (!Array.isArray(payload.countryOrder) || payload.countryOrder.length === 0) {
      throw new Error('Fee intelligence payload missing countryOrder array');
    }
    if (!payload.countries || typeof payload.countries !== 'object') {
      throw new Error('Fee intelligence payload missing countries object');
    }
    return true;
  }
}
```

### Client Error Handling
- **Version Mismatch:** If the backend serves an unexpected version (e.g., `v1.1.2` before frontend deployment), `FeeIntelligenceClient` throws an exception.
- **Fail-Closed Presentation:** `src/app.js` catches the client error and renders an explicit, user-visible warning banner:
  > *"Fee intelligence service temporarily unavailable. Please verify live rates directly with Etsy."*
- **No Stale Fallback:** The application strictly refrains from falling back to hardcoded legacy constants or stale cache files. A visible failure is preferred over an inaccurate financial calculation.

---

## 8. Cloudflare Cron Safety Architecture

The scheduled monitoring workflow in `worker/src/index.js` is isolated from the publishing pipeline:

```javascript
// worker/src/index.js
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      executeMonitorRun(env).catch(err => {
        console.error('Scheduled monitor run failed:', err);
      })
    );
  }
}
```

### Safety Guarantees
1. `executeMonitorRun(env)` only accesses `source_registry`, `scraper_snapshots`, `detected_changes`, and `review_queue`.
2. It possesses **no imports, references, or execution paths** to `publishVersion()`, `bumpVersion()`, or `fee_versions UPDATE`.
3. All discovered changes are written with `changes_published = 0` and status `pending_review`.
4. Even if an automated monitor run experiences a logic defect, it cannot mutate production fee calculations.

---

## 9. Failure Modes & Fail-Closed Responses

| Failure Mode | Detection Point | System Response | Production Fee Impact |
|---|---|---|---|
| **Etsy Help Center Down (HTTP 5xx / 404)** | `worker/src/monitor.js` fetch loop | Logs HTTP error snapshot in `scraper_snapshots`; aborts run. | Zero impact. Active `v1.1.1` continues serving. |
| **Etsy Page Redesign / Corrupted DOM** | HTML parser table extraction | Fails table column/row threshold check; logs parser error snapshot. | Zero impact. Zero changes queued. |
| **Malformed Rate Value (e.g. -5% or >100%)** | Change validation logic | Rejects candidate field; records validation anomaly. | Zero impact. Proposal blocked from queue. |
| **Source Hash Drift (Legitimate policy edit)** | SHA-256 hash comparison | Stages diff in `detected_changes` & `review_queue` (`pending`). | Zero impact. Awaits human administrator review. |
| **Incomplete Country Release Package** | `publishVersion` validation | Rejects publication if required country fields are missing. | Zero impact. Draft rejected; active version intact. |
| **API Backend Outage / Network Drop** | Frontend `FeeIntelligenceClient` | Catches network exception; renders UI alert banner. | Fail-closed. Client informs seller without bogus calculation. |
| **Unauthorized Admin Publication Attempt** | Worker Bearer token middleware | Returns HTTP 401 Unauthorized; logs security audit. | Zero impact. Changes rejected. |

---

## 10. Source Manifest Architecture & Composite Hashing (Step 15 Hardening)

To resolve single-source hash limitations and establish cryptographic provenance across all monitored policies, ShopProfit implements a deterministic composite source manifest engine (`worker/src/provenance.js`).

### 10.1 Canonical Source Manifest Structure
Every published release package evaluates a structured manifest array representing all 8 authoritative policy sources:
```json
{
  "source_id": "115015628847",
  "canonical_url": "https://help.etsy.com/hc/en-us/articles/115015628847-what-are-payment-processing-fees-for-selling-on-etsy",
  "source_domain": "help.etsy.com",
  "content_hash": "44526eef75082b7751e59f32eff9bfaf27ad22f2cdc83446ea18a34f012adf54",
  "retrieval_timestamp": "2026-10-06T00:00:00Z",
  "scope": "payment_processing_and_deposits"
}
```

### 10.2 Canonicalization & Ordering Rules
1. **URL Normalization:** Protocols and hosts are lowercased; query parameters, session tokens, and trailing slashes are stripped.
2. **Deterministic Sort:** Source records are sorted alphabetically by `source_id` ascending, with `canonical_url` as secondary tie-breaker.
3. **Temporal Invariance:** Unstable retrieval timestamps (`retrieval_timestamp`) are included in manifest metadata for auditing, but are **explicitly excluded** from the hashed preimage. Timestamp shifts produce zero composite hash drift.

### 10.3 Composite Hashing Algorithm
The composite source hash is computed via Web Crypto SHA-256 over a concatenated newline-delimited canonical preimage:
$$\text{Line}_i = \text{source\_id}_i \parallel \text{"\|"} \parallel \text{canonical\_url}_i \parallel \text{"\|"} \parallel \text{source\_domain}_i \parallel \text{"\|"} \parallel \text{scope}_i \parallel \text{"\|"} \parallel \text{content\_hash}_i$$
$$\text{Composite Hash} = \text{SHA-256}\left(\bigoplus_{i=1}^N \text{Line}_i\right)$$
- **Guarantees:**
  - Same sources + same content $\implies$ identical 64-char hex hash.
  - Different source content, URL, or scope $\implies$ different hash.
  - Different source set (addition/removal) $\implies$ different hash.
  - Input array ordering variations $\implies$ identical hash (order-independent).

### 10.4 Reviewer Provenance & Identity Policy
1. **Reviewer Attribution:** `review_queue` records `reviewed_by TEXT`, and `fee_versions` records `approved_by TEXT`.
2. **Zero Secret Storage:** The system strictly prohibits storing API tokens, passwords, bearer credentials, or private keys. If a reviewer identity is not explicitly supplied via admin payload or header, it defaults safely to `NULL`.

### 10.5 Backward Compatibility & Historical Version Policy
- Historical releases (`v1.0.0`, `v1.1.0`, `v1.1.1`) remain immutable.
- Existing `source_hash` columns are never rewritten.
- New provenance columns (`source_manifest_hash`, `approved_by`) in `fee_versions` are additive and `NULLable`.
- Historical releases retain `NULL` for manifest hash and reviewer identity, while all future releases (`v1.1.2+`) enforce complete composite provenance.

### 10.6 Future Publication Provenance Contract
Every future fee release satisfies the complete governance contract:
- **WHY:** Documented in release `notes` and `review_queue.reason`.
- **SOURCE:** Authoritative policy article IDs in `source_registry`.
- **VERSION:** Explicit semantic version ID in `fee_versions.version_id`.
- **WHEN:** ISO 8601 publication timestamp in `published_at`.
- **CHANGES:** Field-level diffs recorded in `detected_changes`.
- **REVIEW:** Reviewer / approver identity in `approved_by` and `reviewed_by`.
- **HASH:** Deterministic composite manifest hash in `source_manifest_hash`.

---

## 11. Summary

Through this architecture, ShopProfit achieves institutional-grade governance over its fee data:
- **Etsy Policy Alignment:** Authoritative Help Center URLs are continuously checked.
- **Human Accountability:** Every production fee change has an explicit human approval record, change ID, and release note.
- **Cryptographic Provenance:** Composite manifest hashes link every future version to immutable upstream policy states.
- **Mathematical & Historical Precision:** Historical calculations remain 100% reproducible across immutable version snapshots.
- **Fail-Safe Client:** The frontend guarantees that users only calculate with verified, approved fee schedules.

