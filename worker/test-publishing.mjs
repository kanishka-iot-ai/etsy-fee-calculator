import assert from "node:assert/strict";
import test from "node:test";
import {
  canAutoPublish,
  CLASSIFICATIONS,
  PRIORITIES,
  groupChangesByRelease
} from "./src/governance.js";
import {
  computeNextVersion,
  publishApprovedChanges,
  rollbackVersion,
  getDataQualityReport
} from "./src/publisher.js";
import {
  handleApproveChange,
  handleRejectChange,
  handleGetReviews,
  handleGetReviewDetail,
  handleGetDataQuality
} from "./src/admin.js";
import { handleGetFees } from "./src/api.js";

// Helper to create a comprehensive mock D1 with batch transaction support
function createPublishingMockD1(initialState = {}) {
  const versions = new Map(initialState.versions || [
    ["v1.0.0", {
      version_id: "v1.0.0",
      version_label: "1.0.0",
      status: "active",
      created_at: "2026-10-06T00:00:00Z",
      published_at: "2026-10-06T00:00:00Z",
      source_hash: "hash_initial_1.0.0",
      notes: "Initial baseline"
    }]
  ]);

  const rules = (initialState.rules || [
    { version_id: "v1.0.0", country_code: "US", transaction_rate: 0.065, listing_fee_amount: 0.20, listing_fee_currency: "USD", processing_rate: 0.03, processing_fixed_amount: 0.25, processing_fixed_currency: "USD", regulatory_rate: 0, sort_order: 1 },
    { version_id: "v1.0.0", country_code: "UK", transaction_rate: 0.065, listing_fee_amount: 0.16, listing_fee_currency: "GBP", processing_rate: 0.04, processing_fixed_amount: 0.20, processing_fixed_currency: "GBP", regulatory_rate: 0.0048, sort_order: 2 },
    { version_id: "v1.0.0", country_code: "CA", transaction_rate: 0.065, listing_fee_amount: 0.25, listing_fee_currency: "CAD", processing_rate: 0.03, processing_fixed_amount: 0.25, processing_fixed_currency: "CAD", regulatory_rate: 0, sort_order: 3 },
    { version_id: "v1.0.0", country_code: "AU", transaction_rate: 0.065, listing_fee_amount: 0.25, listing_fee_currency: "AUD", processing_rate: 0.03, processing_fixed_amount: 0.25, processing_fixed_currency: "AUD", regulatory_rate: 0, sort_order: 4 },
    { version_id: "v1.0.0", country_code: "DE", transaction_rate: 0.065, listing_fee_amount: 0.20, listing_fee_currency: "EUR", processing_rate: 0.04, processing_fixed_amount: 0.30, processing_fixed_currency: "EUR", regulatory_rate: 0, sort_order: 5 }
  ]).map(r => ({ ...r }));

  const countries = new Map(initialState.countries || [
    ["US", { country_code: "US", country_name: "United States", currency_code: "USD", currency_symbol: "$", locale: "en-US", status: "active", sort_order: 1 }],
    ["UK", { country_code: "UK", country_name: "United Kingdom", currency_code: "GBP", currency_symbol: "£", locale: "en-GB", status: "active", sort_order: 2 }],
    ["CA", { country_code: "CA", country_name: "Canada", currency_code: "CAD", currency_symbol: "CA$", locale: "en-CA", status: "active", sort_order: 3 }],
    ["AU", { country_code: "AU", country_name: "Australia", currency_code: "AUD", currency_symbol: "A$", locale: "en-AU", status: "active", sort_order: 4 }],
    ["DE", { country_code: "DE", country_name: "Germany", currency_code: "EUR", currency_symbol: "€", locale: "de-DE", status: "active", sort_order: 5 }],
    ["SG", { country_code: "SG", country_name: "Singapore", currency_code: "SGD", currency_symbol: "S$", locale: "en-SG", status: "pending_review", sort_order: 999 }]
  ]);

  const detectedChanges = (initialState.detectedChanges || []).map(c => ({ ...c }));
  const reviewQueue = (initialState.reviewQueue || []).map(r => ({ ...r }));
  const monitorRuns = (initialState.monitorRuns || []).map(m => ({ ...m }));

  function executeStatement(sql, params) {
    if (sql.includes("FROM fee_versions") && sql.includes("status = 'active'")) {
      for (const v of versions.values()) {
        if (v.status === "active") return { ...v };
      }
      return null;
    }

    if (sql.includes("FROM fee_versions") && sql.includes("version_id = ? OR version_label = ?")) {
      const p1 = params[0];
      const p2 = params[1];
      for (const v of versions.values()) {
        if ((v.version_id === p1 || v.version_label === p2) && v.status !== "draft") {
          return { ...v };
        }
      }
      return null;
    }

    if (sql.includes("FROM fee_versions") && sql.includes("status = 'archived'")) {
      const archived = Array.from(versions.values()).filter(v => v.status === "archived");
      return archived.length > 0 ? archived[archived.length - 1] : null;
    }

    if (sql.includes("FROM fee_versions") && sql.includes("version_id = ?")) {
      return versions.get(params[0]) || null;
    }

    if (sql.includes("count(*)") && sql.includes("fee_rules")) {
      const vid = params[0];
      return [{ count: rules.filter(r => r.version_id === vid).length }];
    }

    if (sql.includes("JOIN countries") || (sql.includes("FROM countries") && sql.includes("fee_rules"))) {
      const vid = params[0];
      const res = [];
      for (const r of rules.filter(rule => rule.version_id === vid)) {
        const c = countries.get(r.country_code) || {
          country_code: r.country_code,
          country_name: r.country_code,
          currency_code: "USD",
          currency_symbol: "$",
          locale: "en",
          sort_order: 999
        };
        res.push({
          ...c,
          ...r,
          version_label: versions.get(vid)?.version_label || "1.0.0",
          published_at: versions.get(vid)?.published_at || "2026-10-06T00:00:00Z"
        });
      }
      res.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999));
      return res;
    }

    if (sql.includes("FROM fee_rules") && sql.includes("version_id = ?")) {
      const vid = params[0];
      return rules.filter(r => r.version_id === vid);
    }

    if (sql.includes("FROM detected_changes")) {
      if (sql.includes("status = 'approved'")) {
        if (sql.includes("IN (")) {
          return detectedChanges.filter(c => params.includes(c.change_id) && c.status === "approved");
        }
        return detectedChanges.filter(c => c.status === "approved");
      }
      return detectedChanges;
    }

    if (sql.includes("FROM review_queue") && (sql.includes("review_id = ?") || sql.includes("change_id = ?"))) {
      const id = params[0];
      return reviewQueue.find(r => r.review_id === id || r.change_id === id) || null;
    }

    if (sql.includes("FROM source_registry")) {
      return [
        { source_id: "115015628847", source_name: "Payment Processing Fees", source_url: "https://help.etsy.com/hc/en-us/articles/115015628847", latest_hash: "hash_115015628847" },
        { source_id: "1500011073202", source_name: "Regulatory Operating Fee", source_url: "https://help.etsy.com/hc/en-us/articles/1500011073202", latest_hash: "hash_1500011073202" },
        { source_id: "115014483627", source_name: "Fees and Taxes", source_url: "https://help.etsy.com/hc/en-us/articles/115014483627", latest_hash: "hash_115014483627" },
        { source_id: "360000338367", source_name: "Offsite Ads", source_url: "https://help.etsy.com/hc/en-us/articles/360000338367", latest_hash: "hash_360000338367" },
        { source_id: "360001589928", source_name: "Etsy Plus", source_url: "https://help.etsy.com/hc/en-us/articles/360001589928", latest_hash: "hash_360001589928" },
        { source_id: "360000344668", source_name: "Currency Conversion", source_url: "https://help.etsy.com/hc/en-us/articles/360000344668", latest_hash: "hash_360000344668" },
        { source_id: "360040584433", source_name: "VAT on Seller Fees", source_url: "https://help.etsy.com/hc/en-us/articles/360040584433", latest_hash: "hash_360040584433" },
        { source_id: "115015710408", source_name: "Eligible Countries", source_url: "https://help.etsy.com/hc/en-us/articles/115015710408", latest_hash: "hash_115015710408" }
      ];
    }

    if (sql.includes("INSERT INTO fee_versions")) {
      const vid = params[0];
      const vlabel = params[1];
      const stat = params[2];
      const cr = params[3];
      const pub = params[4];
      const hash = params[5];
      const manifestHash = params.length > 7 ? params[6] : null;
      const appBy = params.length > 8 ? params[7] : null;
      const notes = params[params.length - 1];
      versions.set(vid, { version_id: vid, version_label: vlabel, status: stat, created_at: cr, published_at: pub, source_hash: hash, source_manifest_hash: manifestHash, approved_by: appBy, notes });
      return { success: true };
    }

    if (sql.includes("INSERT INTO fee_rules")) {
      const [vid, code, tr, lfa, lfc, pr, pfa, pfc, dpr, dpfa, dpfc, ipr, ipfa, ipfc, rr, ccr, orbt, orat, oca, occ, ota, otc, pma, pc, dma, dmc, dta, dtc, dfa, dfc, sfa, sfc, tn, sr, sid, surl, ef, vs, cr] = params;
      rules.push({ version_id: vid, country_code: code, transaction_rate: tr, listing_fee_amount: lfa, listing_fee_currency: lfc, processing_rate: pr, processing_fixed_amount: pfa, processing_fixed_currency: pfc, regulatory_rate: rr });
      return { success: true };
    }

    if (sql.includes("UPDATE fee_versions SET status = 'archived' WHERE status = 'active'")) {
      for (const v of versions.values()) {
        if (v.status === "active") v.status = "archived";
      }
      return { success: true };
    }

    if (sql.includes("UPDATE fee_versions SET status = 'archived' WHERE version_id = ?")) {
      const v = versions.get(params[0]);
      if (v) v.status = "archived";
      return { success: true };
    }

    if (sql.includes("UPDATE fee_versions SET status = 'active'")) {
      const pub = params.length > 1 ? params[0] : new Date().toISOString();
      const vid = params.length > 1 ? params[1] : params[0];
      const v = versions.get(vid);
      if (v) {
        v.status = "active";
        v.published_at = pub;
      }
      return { success: true };
    }

    if (sql.includes("UPDATE countries SET status =")) {
      const match = sql.match(/status\s*=\s*'([^']+)'/i);
      const targetCode = params[params.length - 1];
      const c = countries.get(targetCode);
      if (c && match) {
        c.status = match[1];
      } else if (c && params.length >= 2) {
        c.status = params[0];
      }
      return { success: true };
    }

    if (sql.includes("UPDATE detected_changes SET status = 'published'")) {
      const chg = detectedChanges.find(c => c.change_id === params[0]);
      if (chg) chg.status = "published";
      return { success: true };
    }

    if (sql.includes("UPDATE review_queue") && sql.includes("status = 'approved'")) {
      const targetId = params[params.length - 1];
      const rev = reviewQueue.find(r => r.review_id === targetId || r.change_id === targetId);
      if (rev) {
        rev.status = "approved";
        rev.reviewed_at = params[0];
        rev.reviewer_note = params[1];
        if (params.length > 3) {
          rev.reviewed_by = params[2];
        }
      }
      return { success: true };
    }

    if (sql.includes("UPDATE review_queue") && sql.includes("status = 'rejected'")) {
      const targetId = params[2];
      const rev = reviewQueue.find(r => r.review_id === targetId || r.change_id === targetId);
      if (rev) {
        rev.status = "rejected";
        rev.reviewed_at = params[0];
        rev.reviewer_note = params[1];
      }
      return { success: true };
    }

    if (sql.includes("UPDATE detected_changes SET status = 'approved'")) {
      const chg = detectedChanges.find(c => c.change_id === params[0]);
      if (chg) chg.status = "approved";
      return { success: true };
    }

    if (sql.includes("UPDATE detected_changes SET status = 'rejected'")) {
      const chg = detectedChanges.find(c => c.change_id === params[0]);
      if (chg) chg.status = "rejected";
      return { success: true };
    }

    return { success: true };
  }

  return {
    versions,
    rules,
    countries,
    detectedChanges,
    reviewQueue,
    monitorRuns,
    shouldFailBatch: false, // Flag to simulate batch failure
    prepare(sql) {
      return {
        _params: [],
        bind(...p) {
          this._params = p;
          return this;
        },
        async first() {
          const res = executeStatement(sql, this._params);
          return Array.isArray(res) ? res[0] : res;
        },
        async all() {
          const res = executeStatement(sql, this._params);
          return { results: Array.isArray(res) ? res : (res ? [res] : []) };
        },
        async run() {
          return executeStatement(sql, this._params);
        }
      };
    },
    async batch(statements) {
      if (this.shouldFailBatch) {
        throw new Error("D1_BATCH_EXECUTION_ERROR: Transaction rolled back due to simulated failure");
      }

      // Snapshot state for atomic rollback simulation
      const versionsBackup = new Map(Array.from(versions.entries()).map(([k, v]) => [k, { ...v }]));
      const rulesBackup = rules.map(r => ({ ...r }));
      const countriesBackup = new Map(Array.from(countries.entries()).map(([k, c]) => [k, { ...c }]));

      try {
        for (const stmt of statements) {
          await stmt.run();
        }

        // Verify single active version invariant
        let activeCount = 0;
        for (const v of versions.values()) {
          if (v.status === "active") activeCount++;
        }
        if (activeCount > 1) {
          throw new Error("D1 UNIQUE CONSTRAINT VIOLATION: Exactly one version allowed to be active");
        }
      } catch (err) {
        // Rollback
        versions.clear();
        for (const [k, v] of versionsBackup.entries()) versions.set(k, v);
        rules.length = 0;
        for (const r of rulesBackup) rules.push(r);
        countries.clear();
        for (const [k, c] of countriesBackup.entries()) countries.set(k, c);
        throw err;
      }
      return { success: true };
    }
  };
}

// ============================================================================
// THE 22 STEP 7 GOVERNANCE & PUBLISHING TESTS
// ============================================================================

test("1. safe auto-publish: evaluates true when all deterministic conditions pass", () => {
  const change = {
    sourceId: "115015628847",
    countryCode: "US",
    fieldName: "processing_rate",
    oldValue: "0.03",
    newValue: "0.032",
    changeType: "processing_rate_changed"
  };
  const candidate = {
    processingRate: 0.032,
    processingFixed: 0.25,
    currency: "USD"
  };
  const context = {
    allowFeeUpdateAutoPublish: true,
    hasSourceConflict: false
  };

  const decision = canAutoPublish(change, candidate, context);
  assert.equal(decision.canPublish, true);
  assert.equal(decision.classification, CLASSIFICATIONS.SAFE_AUTO_PUBLISH);
});

test("2. incomplete data blocked: rejects candidate missing required fields", () => {
  const change = {
    sourceId: "115015628847",
    countryCode: "SG",
    changeType: "new_country"
  };
  const candidate = {
    processingRate: null, // Missing processing rate
    currency: "SGD"
  };

  const decision = canAutoPublish(change, candidate);
  assert.equal(decision.canPublish, false);
  assert.equal(decision.classification, CLASSIFICATIONS.BLOCKED);
  assert.ok(decision.reason.includes("Incomplete"));
});

test("3. invalid country blocked: rejects unrecognized country code", () => {
  const change = {
    sourceId: "115015628847",
    countryCode: "INVALID_CODE",
    changeType: "processing_rate_changed"
  };

  const decision = canAutoPublish(change, {});
  assert.equal(decision.canPublish, false);
  assert.equal(decision.classification, CLASSIFICATIONS.BLOCKED);
  assert.ok(decision.reason.includes("Invalid or unrecognized ISO country code"));
});

test("4. invalid currency blocked: rejects unwhitelisted currency", () => {
  const change = {
    sourceId: "115015628847",
    countryCode: "US",
    changeType: "processing_rate_changed"
  };
  const candidate = {
    currency: "FAKE_MONEY"
  };

  const decision = canAutoPublish(change, candidate);
  assert.equal(decision.canPublish, false);
  assert.equal(decision.classification, CLASSIFICATIONS.BLOCKED);
  assert.ok(decision.reason.includes("Invalid or unrecognized currency"));
});

test("5. suspicious fee change requires review: flags delta >= 5% as critical priority", () => {
  const change = {
    sourceId: "115015628847",
    countryCode: "US",
    fieldName: "processing_rate",
    oldValue: "0.03",
    newValue: "0.09", // Jump of 6% >= 5%
    changeType: "processing_rate_changed"
  };
  const candidate = {
    processingRate: 0.09,
    processingFixed: 0.25,
    currency: "USD"
  };

  const decision = canAutoPublish(change, candidate);
  assert.equal(decision.canPublish, false);
  assert.equal(decision.classification, CLASSIFICATIONS.NEEDS_REVIEW);
  assert.equal(decision.priority, PRIORITIES.CRITICAL);
  assert.ok(decision.reason.includes("SUSPICIOUS"));
});

test("6. new country review: default policy routes new market to needs_review", () => {
  const change = {
    sourceId: "115015628847",
    countryCode: "SG",
    changeType: "new_country"
  };
  const candidate = {
    processingRate: 0.044,
    processingFixed: 0.35,
    currency: "SGD"
  };

  const decision = canAutoPublish(change, candidate, { allowNewCountryAutoPublish: false });
  assert.equal(decision.canPublish, false);
  assert.equal(decision.classification, CLASSIFICATIONS.NEEDS_REVIEW);
  assert.equal(decision.priority, PRIORITIES.HIGH);
});

test("7. safe new country auto-publish: allows deterministic publication when flag and checks pass", () => {
  const change = {
    sourceId: "115015628847",
    countryCode: "SG",
    changeType: "new_country"
  };
  const candidate = {
    processingRate: 0.044,
    processingFixed: 0.35,
    currency: "SGD"
  };

  const decision = canAutoPublish(change, candidate, { allowNewCountryAutoPublish: true });
  assert.equal(decision.canPublish, true);
  assert.equal(decision.classification, CLASSIFICATIONS.SAFE_AUTO_PUBLISH);
});

test("8. removed country review: preserves historical market and marks needs_review", () => {
  const change = {
    sourceId: "115015628847",
    countryCode: "DE",
    changeType: "removed_country"
  };

  const decision = canAutoPublish(change);
  assert.equal(decision.canPublish, false);
  assert.equal(decision.classification, CLASSIFICATIONS.NEEDS_REVIEW);
  assert.equal(decision.priority, PRIORITIES.HIGH);
});

test("9. source conflict review: marks needs_review with critical priority upon contradiction", () => {
  const change = {
    sourceId: "115015628847",
    countryCode: "UK",
    fieldName: "regulatory_rate",
    changeType: "regulatory_rate_changed"
  };
  const context = {
    hasSourceConflict: true,
    conflictDetails: "Article 1500011073202 reports 0.48% but Article 115014483627 mentions 0.50%"
  };

  const decision = canAutoPublish(change, {}, context);
  assert.equal(decision.canPublish, false);
  assert.equal(decision.classification, CLASSIFICATIONS.NEEDS_REVIEW);
  assert.equal(decision.priority, PRIORITIES.CRITICAL);
  assert.ok(decision.reason.includes("Contradictory official Etsy sources"));
});

test("10. version creation: bumps version atomically and associates all fee rules", async () => {
  const mockD1 = createPublishingMockD1({
    detectedChanges: [
      { change_id: "chg_uk", source_id: "115015628847", country_code: "UK", field_name: "processing_rate", new_value: "0.042", change_type: "processing_rate_changed", status: "approved" }
    ]
  });

  const res = await publishApprovedChanges({ DB: mockD1 });
  assert.equal(res.success, true);
  assert.equal(res.previousVersion, "v1.0.0");
  assert.equal(res.publishedVersion, "v1.0.1");

  const v101 = mockD1.versions.get("v1.0.1");
  assert.ok(v101);
  assert.equal(v101.status, "active");

  const v100 = mockD1.versions.get("v1.0.0");
  assert.equal(v100.status, "archived");
});

test("11. one-active-version guarantee: ensures exactly one active version exists after publication", async () => {
  const mockD1 = createPublishingMockD1({
    detectedChanges: [
      { change_id: "chg_1", source_id: "115015628847", country_code: "US", field_name: "processing_rate", new_value: "0.031", change_type: "processing_rate_changed", status: "approved" }
    ]
  });

  await publishApprovedChanges({ DB: mockD1 });

  let activeCount = 0;
  for (const v of mockD1.versions.values()) {
    if (v.status === "active") activeCount++;
  }
  assert.equal(activeCount, 1);
});

test("12. atomic publication failure rollback: reverts all mutations if a batch statement fails", async () => {
  const mockD1 = createPublishingMockD1({
    detectedChanges: [
      { change_id: "chg_fail", source_id: "115015628847", country_code: "US", field_name: "processing_rate", new_value: "0.035", change_type: "processing_rate_changed", status: "approved" }
    ]
  });

  mockD1.shouldFailBatch = true; // Simulate batch failure

  await assert.rejects(async () => {
    await publishApprovedChanges({ DB: mockD1 });
  }, /Transaction rolled back/);

  // Original version remains active and uncorrupted
  assert.equal(mockD1.versions.get("v1.0.0").status, "active");
  assert.equal(mockD1.versions.has("v1.0.1"), false);
});

test("13. approval idempotency: repeated approvals do not duplicate actions or fail", async () => {
  const mockD1 = createPublishingMockD1({
    reviewQueue: [{ review_id: "rev_1", change_id: "chg_1", status: "pending" }],
    detectedChanges: [{ change_id: "chg_1", status: "pending_review" }]
  });

  const req1 = new Request("https://api.shopprofitcalculator.com/api/admin/approve-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ review_id: "rev_1" })
  });

  // Call 1
  const res1 = await handleApproveChange(req1, { DB: mockD1 });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  assert.equal(data1.status, "approved");

  // Call 2: Exact same request
  const req2 = new Request("https://api.shopprofitcalculator.com/api/admin/approve-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ review_id: "rev_1" })
  });
  const res2 = await handleApproveChange(req2, { DB: mockD1 });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  assert.equal(data2.status, "approved");
  assert.ok(data2.message.includes("idempotent"));
});

test("14. rejection idempotency: repeated rejections are handled safely without duplication", async () => {
  const mockD1 = createPublishingMockD1({
    reviewQueue: [{ review_id: "rev_2", change_id: "chg_2", status: "pending" }],
    detectedChanges: [{ change_id: "chg_2", status: "pending_review" }]
  });

  const req = new Request("https://api.shopprofitcalculator.com/api/admin/reject-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ review_id: "rev_2", reason: "Invalid test data" })
  });

  // Call 1
  const res1 = await handleRejectChange(req, { DB: mockD1 });
  assert.equal(res1.status, 200);
  const d1 = await res1.json();
  assert.equal(d1.status, "rejected");

  // Call 2 with fresh request body
  const req2 = new Request("https://api.shopprofitcalculator.com/api/admin/reject-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ review_id: "rev_2", reason: "Invalid test data" })
  });
  const res2 = await handleRejectChange(req2, { DB: mockD1 });
  assert.equal(res2.status, 200);
  const d2 = await res2.json();
  assert.equal(d2.status, "rejected");
  assert.ok(d2.message.includes("idempotent"));
});

test("15. stale approval rejection: rejects approval if review state changed unexpectedly", async () => {
  const mockD1 = createPublishingMockD1({
    reviewQueue: [{ review_id: "rev_3", change_id: "chg_3", status: "rejected" }], // Already rejected
    detectedChanges: [{ change_id: "chg_3", status: "rejected" }]
  });

  const req = new Request("https://api.shopprofitcalculator.com/api/admin/approve-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ review_id: "rev_3", expected_change_status: "pending" })
  });

  const res = await handleApproveChange(req, { DB: mockD1 });
  assert.equal(res.status, 409); // Conflict
  const data = await res.json();
  assert.ok(data.error.includes("Stale approval rejected"));
});

test("16. rollback: reverts to archived version atomically without deleting history", async () => {
  const mockD1 = createPublishingMockD1({
    versions: [
      ["v1.0.0", { version_id: "v1.0.0", version_label: "1.0.0", status: "archived", published_at: "2026-10-06T00:00:00Z" }],
      ["v1.0.1", { version_id: "v1.0.1", version_label: "1.0.1", status: "active", published_at: "2026-10-06T01:00:00Z" }]
    ],
    rules: [
      { version_id: "v1.0.0", country_code: "US", processing_rate: 0.03, processing_fixed_amount: 0.25 },
      { version_id: "v1.0.0", country_code: "UK", processing_rate: 0.04, processing_fixed_amount: 0.20 },
      { version_id: "v1.0.0", country_code: "CA", processing_rate: 0.03, processing_fixed_amount: 0.25 },
      { version_id: "v1.0.0", country_code: "AU", processing_rate: 0.03, processing_fixed_amount: 0.25 },
      { version_id: "v1.0.0", country_code: "DE", processing_rate: 0.04, processing_fixed_amount: 0.30 },
      { version_id: "v1.0.1", country_code: "US", processing_rate: 0.032, processing_fixed_amount: 0.25 },
      { version_id: "v1.0.1", country_code: "UK", processing_rate: 0.04, processing_fixed_amount: 0.20 },
      { version_id: "v1.0.1", country_code: "CA", processing_rate: 0.03, processing_fixed_amount: 0.25 },
      { version_id: "v1.0.1", country_code: "AU", processing_rate: 0.03, processing_fixed_amount: 0.25 },
      { version_id: "v1.0.1", country_code: "DE", processing_rate: 0.04, processing_fixed_amount: 0.30 }
    ]
  });

  const res = await rollbackVersion({ DB: mockD1 }, "v1.0.0", "Reverting rate bump");
  assert.equal(res.success, true);
  assert.equal(res.activeVersion, "v1.0.0");
  assert.equal(mockD1.versions.get("v1.0.0").status, "active");
  assert.equal(mockD1.versions.get("v1.0.1").status, "archived");
});

test("17. grouped changes: groups multiple field changes by snapshot/release package", () => {
  const changes = [
    { change_id: "c1", source_id: "115015628847", snapshot_id: "snap_1", country_code: "US" },
    { change_id: "c2", source_id: "115015628847", snapshot_id: "snap_1", country_code: "UK" },
    { change_id: "c3", source_id: "1500011073202", snapshot_id: "snap_2", country_code: "FR" }
  ];

  const packages = groupChangesByRelease(changes);
  assert.equal(packages.length, 2);
  const pkg1 = packages.find(p => p.sourceId === "115015628847");
  assert.equal(pkg1.totalChanges, 2);
  assert.deepEqual(pkg1.countryCodes.sort(), ["UK", "US"]);
});

test("18. public API hides drafts: draft versions are never served through /v1/fees", async () => {
  const mockD1 = createPublishingMockD1({
    versions: [
      ["v1.0.0", { version_id: "v1.0.0", version_label: "1.0.0", status: "active", published_at: "2026-10-06T00:00:00Z" }],
      ["v1.1.0-draft", { version_id: "v1.1.0-draft", version_label: "1.1.0-draft", status: "draft" }]
    ]
  });

  const req = new Request("https://api.shopprofitcalculator.com/v1/fees?version=v1.1.0-draft");
  const res = await handleGetFees(req, { DB: mockD1 });
  assert.equal(res.status, 404);
});

test("19. public API hides pending review: candidate countries with pending_review are excluded", async () => {
  const mockD1 = createPublishingMockD1({
    countries: [
      ["US", { country_code: "US", country_name: "United States", currency_code: "USD", currency_symbol: "$", locale: "en-US", status: "active" }],
      ["SG", { country_code: "SG", country_name: "Singapore", currency_code: "SGD", currency_symbol: "S$", locale: "en-SG", status: "pending_review" }]
    ],
    rules: [
      { version_id: "v1.0.0", country_code: "US", transaction_rate: 0.065, processing_rate: 0.03, processing_fixed_amount: 0.25 }
      // SG is pending review and has no published rule in v1.0.0
    ]
  });

  const req = new Request("https://api.shopprofitcalculator.com/v1/fees");
  const res = await handleGetFees(req, { DB: mockD1 });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.countries.US);
  assert.equal(data.countries.SG, undefined); // Quarantined: never in published fee_rules
});

test("20. historical version lookup: serves archived versions via ?version=v1.0.0", async () => {
  const mockD1 = createPublishingMockD1({
    versions: [
      ["v1.0.0", { version_id: "v1.0.0", version_label: "1.0.0", status: "archived", published_at: "2026-10-06T00:00:00Z" }],
      ["v1.0.1", { version_id: "v1.0.1", version_label: "1.0.1", status: "active", published_at: "2026-10-06T02:00:00Z" }]
    ],
    rules: [
      { version_id: "v1.0.0", country_code: "US", transaction_rate: 0.065, processing_rate: 0.03, processing_fixed_amount: 0.25 },
      { version_id: "v1.0.1", country_code: "US", transaction_rate: 0.065, processing_rate: 0.032, processing_fixed_amount: 0.25 }
    ]
  });

  const req = new Request("https://api.shopprofitcalculator.com/v1/fees?version=v1.0.0");
  const res = await handleGetFees(req, { DB: mockD1 });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.version, "1.0.0");
  assert.equal(data.version_id, "v1.0.0");
  assert.equal(data.countries.US.processingRate, 0.03); // Historical rate served accurately
});

test("21. release with multiple country changes: updates multiple countries in a single version release", async () => {
  const mockD1 = createPublishingMockD1({
    detectedChanges: [
      { change_id: "c_us", country_code: "US", field_name: "processing_rate", new_value: "0.031", change_type: "processing_rate_changed", status: "approved" },
      { change_id: "c_uk", country_code: "UK", field_name: "processing_rate", new_value: "0.041", change_type: "processing_rate_changed", status: "approved" }
    ]
  });

  const res = await publishApprovedChanges({ DB: mockD1 });
  assert.equal(res.success, true);
  assert.equal(res.changesPublished, 2);

  const newRules = mockD1.rules.filter(r => r.version_id === res.publishedVersion);
  const usRule = newRules.find(r => r.country_code === "US");
  const ukRule = newRules.find(r => r.country_code === "UK");
  assert.equal(usRule.processing_rate, 0.031);
  assert.equal(ukRule.processing_rate, 0.041);
});

test("22. failed publication leaves old version active: state remains completely intact after error", async () => {
  const mockD1 = createPublishingMockD1({
    detectedChanges: [
      { change_id: "c_err", country_code: "US", field_name: "processing_rate", new_value: "0.035", change_type: "processing_rate_changed", status: "approved" }
    ]
  });

  mockD1.shouldFailBatch = true;

  try {
    await publishApprovedChanges({ DB: mockD1 });
  } catch {}

  const active = mockD1.versions.get("v1.0.0");
  assert.equal(active.status, "active");
  const unappliedChange = mockD1.detectedChanges.find(c => c.change_id === "c_err");
  assert.equal(unappliedChange.status, "approved"); // Not marked published
});

test("23. historical immutability: changing country status in countries table does NOT remove it from GET /v1/fees?version=v1.0.0", async () => {
  const mockD1 = createPublishingMockD1({
    countries: [
      ["US", { country_code: "US", country_name: "United States", currency_code: "USD", currency_symbol: "$", locale: "en-US", status: "active" }],
      ["JP", { country_code: "JP", country_name: "Japan", currency_code: "JPY", currency_symbol: "¥", locale: "ja-JP", status: "active" }]
    ],
    rules: [
      { version_id: "v1.0.0", country_code: "US", transaction_rate: 0.065, processing_rate: 0.03, processing_fixed_amount: 0.25 },
      { version_id: "v1.0.0", country_code: "JP", transaction_rate: 0.065, processing_rate: 0.06, processing_fixed_amount: 45 }
    ]
  });

  // Verify initial state
  const req1 = new Request("https://api.shopprofitcalculator.com/v1/fees?version=v1.0.0");
  const res1 = await handleGetFees(req1, { DB: mockD1 });
  const data1 = await res1.json();
  assert.ok(data1.countries.JP);
  assert.equal(data1.countries.JP.processingRate, 0.06);

  // Mutate mutable country status in countries table to 'inactive'
  mockD1.countries.get("JP").status = "inactive";

  // Re-request historical version v1.0.0
  const req2 = new Request("https://api.shopprofitcalculator.com/v1/fees?version=v1.0.0");
  const res2 = await handleGetFees(req2, { DB: mockD1 });
  const data2 = await res2.json();

  // Country MUST STILL BE PRESENT and rate identical
  assert.ok(data2.countries.JP, "JP must remain present in historical v1.0.0 despite status=inactive");
  assert.equal(data2.countries.JP.processingRate, 0.06);
  assert.deepEqual(data1, data2, "Historical version payload must remain 100% identical");
});

test("24. historical immutability: country status 'unsupported' does not alter historical version query", async () => {
  const mockD1 = createPublishingMockD1({
    countries: [
      ["TR", { country_code: "TR", country_name: "Türkiye", currency_code: "TRY", currency_symbol: "₺", locale: "tr-TR", status: "unsupported" }]
    ],
    rules: [
      { version_id: "v1.0.0", country_code: "TR", transaction_rate: 0.065, processing_rate: 0.065, processing_fixed_amount: 14 }
    ]
  });

  const req = new Request("https://api.shopprofitcalculator.com/v1/fees?version=v1.0.0");
  const res = await handleGetFees(req, { DB: mockD1 });
  const data = await res.json();
  assert.ok(data.countries.TR);
  assert.equal(data.countries.TR.processingFixed, 14);
});

test("25. historical immutability: country status 'partial' (OTHER fallback) is served in historical version", async () => {
  const mockD1 = createPublishingMockD1({
    countries: [
      ["OTHER", { country_code: "OTHER", country_name: "Global / Other", currency_code: "USD", currency_symbol: "$", locale: "en-US", status: "partial" }]
    ],
    rules: [
      { version_id: "v1.0.0", country_code: "OTHER", transaction_rate: 0.065, processing_rate: 0.065, processing_fixed_amount: 0.30 }
    ]
  });

  const req = new Request("https://api.shopprofitcalculator.com/v1/fees?version=v1.0.0");
  const res = await handleGetFees(req, { DB: mockD1 });
  const data = await res.json();
  assert.ok(data.countries.OTHER);
  assert.equal(data.countries.OTHER.name, "Global / Other");
});

test("26. active version retrieval includes both version and version_id in response contract", async () => {
  const mockD1 = createPublishingMockD1();
  const req = new Request("https://api.shopprofitcalculator.com/v1/fees");
  const res = await handleGetFees(req, { DB: mockD1 });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.version, "1.0.0");
  assert.equal(data.version_id, "v1.0.0");
  assert.ok(data.publishedAt);
  assert.ok(Array.isArray(data.countryOrder));
  assert.ok(typeof data.countries === "object");
});

test("27. explicit historical version retrieval includes both version and version_id", async () => {
  const mockD1 = createPublishingMockD1();
  const req = new Request("https://api.shopprofitcalculator.com/v1/fees?version=v1.0.0");
  const res = await handleGetFees(req, { DB: mockD1 });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.version, "1.0.0");
  assert.equal(data.version_id, "v1.0.0");
});

test("28. exact version country set: v1.0.0 contains 12 baseline countries, candidate markets absent", async () => {
  const baselineCountries = [
    ["US", { country_code: "US", country_name: "United States", currency_code: "USD", currency_symbol: "$", locale: "en-US", sort_order: 1 }],
    ["UK", { country_code: "UK", country_name: "United Kingdom", currency_code: "GBP", currency_symbol: "£", locale: "en-GB", sort_order: 2 }],
    ["CA", { country_code: "CA", country_name: "Canada", currency_code: "CAD", currency_symbol: "CA$", locale: "en-CA", sort_order: 3 }],
    ["AU", { country_code: "AU", country_name: "Australia", currency_code: "AUD", currency_symbol: "A$", locale: "en-AU", sort_order: 4 }],
    ["DE", { country_code: "DE", country_name: "Germany / Eurozone", currency_code: "EUR", currency_symbol: "€", locale: "de-DE", sort_order: 5 }],
    ["FR", { country_code: "FR", country_name: "France", currency_code: "EUR", currency_symbol: "€", locale: "fr-FR", sort_order: 6 }],
    ["IT", { country_code: "IT", country_name: "Italy", currency_code: "EUR", currency_symbol: "€", locale: "it-IT", sort_order: 7 }],
    ["ES", { country_code: "ES", country_name: "Spain", currency_code: "EUR", currency_symbol: "€", locale: "es-ES", sort_order: 8 }],
    ["IN", { country_code: "IN", country_name: "India", currency_code: "INR", currency_symbol: "₹", locale: "en-IN", sort_order: 9 }],
    ["JP", { country_code: "JP", country_name: "Japan", currency_code: "JPY", currency_symbol: "¥", locale: "ja-JP", sort_order: 10 }],
    ["TR", { country_code: "TR", country_name: "Türkiye", currency_code: "TRY", currency_symbol: "₺", locale: "tr-TR", sort_order: 11 }],
    ["OTHER", { country_code: "OTHER", country_name: "Global / Other", currency_code: "USD", currency_symbol: "$", locale: "en-US", sort_order: 12 }],
    ["SG", { country_code: "SG", country_name: "Singapore", currency_code: "SGD", currency_symbol: "S$", locale: "en-SG", status: "pending_review", sort_order: 999 }]
  ];

  const baselineRules = [
    "US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP", "TR", "OTHER"
  ].map(code => ({ version_id: "v1.0.0", country_code: code, transaction_rate: 0.065, processing_rate: 0.04, processing_fixed_amount: 0.25 }));

  const mockD1 = createPublishingMockD1({
    countries: baselineCountries,
    rules: baselineRules
  });

  const req = new Request("https://api.shopprofitcalculator.com/v1/fees?version=v1.0.0");
  const res = await handleGetFees(req, { DB: mockD1 });
  const data = await res.json();
  const keys = Object.keys(data.countries);
  assert.equal(keys.length, 12);
  assert.deepEqual(keys.sort(), ["AU", "CA", "DE", "ES", "FR", "IN", "IT", "JP", "OTHER", "TR", "UK", "US"].sort());
  assert.equal(data.countries.SG, undefined);
  assert.equal(data.countries.NL, undefined);
  assert.equal(data.countries.NZ, undefined);
});

test("29. unknown version returns 404 HTTP status", async () => {
  const mockD1 = createPublishingMockD1();
  const req = new Request("https://api.shopprofitcalculator.com/v1/fees?version=v9.9.9");
  const res = await handleGetFees(req, { DB: mockD1 });
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.ok(data.error.includes("not found"));
});
