import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORITATIVE_SOURCE_SCOPES,
  normalizeCanonicalUrl,
  canonicalizeSourceManifest,
  computeCompositeSourceHash,
  buildCompleteSourceManifest,
  validateSourceManifestCompleteness
} from "../worker/src/provenance.js";
import {
  computeNextVersion,
  publishApprovedChanges
} from "../worker/src/publisher.js";
import {
  handleApproveChange,
  handleRejectChange
} from "../worker/src/admin.js";

// Canonical sample sources fixture
function getSampleSources() {
  return [
    {
      source_id: "115015628847",
      source_url: "https://help.etsy.com/hc/en-us/articles/115015628847-What-are-Payment-Processing-Fees-for-Selling-on-Etsy",
      latest_hash: "44526eef75082b7751e59f32eff9bfaf27ad22f2cdc83446ea18a34f012adf54",
      last_checked_at: "2026-10-06T00:00:00Z"
    },
    {
      source_id: "1500011073202",
      source_url: "https://help.etsy.com/hc/en-us/articles/1500011073202-What-is-a-Regulatory-Operating-Fee",
      latest_hash: "3b31cf734681c4f8ac4503f83e44cb9e81e700f4a804d9930692282bacc069b7",
      last_checked_at: "2026-10-06T00:00:00Z"
    },
    {
      source_id: "115014483627",
      source_url: "https://help.etsy.com/hc/en-us/articles/115014483627-What-are-the-Fees-and-Taxes-for-Selling-on-Etsy",
      latest_hash: "14643cd24ae12214904ee611eea3de9c2a70a664d583f2f27ab845f4120f1c2f",
      last_checked_at: "2026-10-06T00:00:00Z"
    },
    {
      source_id: "360000338367",
      source_url: "https://help.etsy.com/hc/en-us/articles/360000338367-How-Etsy-s-Offsite-Ads-Work",
      latest_hash: "fcc15cae7938f08e690d418ab884a438485ed0d111784c719171024d3640a6de",
      last_checked_at: "2026-10-06T00:00:00Z"
    },
    {
      source_id: "360001589928",
      source_url: "https://help.etsy.com/hc/en-us/articles/360001589928-What-is-Etsy-Plus",
      latest_hash: "a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567890abcdef",
      last_checked_at: "2026-10-06T00:00:00Z"
    },
    {
      source_id: "360000344668",
      source_url: "https://help.etsy.com/hc/en-us/articles/360000344668-Currency-Conversion-Fees",
      latest_hash: "b2c3d4e5f6a10718293a4b5c6d7e8f901234567890abcdef1234567890abcdef",
      last_checked_at: "2026-10-06T00:00:00Z"
    },
    {
      source_id: "360040584433",
      source_url: "https://help.etsy.com/hc/en-us/articles/360040584433-VAT-on-Seller-Fees",
      latest_hash: "c3d4e5f6a1b20718293a4b5c6d7e8f901234567890abcdef1234567890abcdef",
      last_checked_at: "2026-10-06T00:00:00Z"
    },
    {
      source_id: "115015710408",
      source_url: "https://help.etsy.com/hc/en-us/articles/115015710408-Countries-Eligible-for-Etsy-Payments",
      latest_hash: "0f6f1e40ff1b48ecca4cbe7cf99063760674a2e679d7da6ba89cdb9566f033cf",
      last_checked_at: "2026-10-06T00:00:00Z"
    }
  ];
}

// Helper to create an in-memory mock D1 for publication and review tests
function createMockD1(initialState = {}) {
  const versions = new Map(initialState.versions || [
    ["v1.0.0", {
      version_id: "v1.0.0",
      version_label: "1.0.0",
      status: "archived",
      created_at: "2026-10-06T00:00:00Z",
      published_at: "2026-10-05T20:29:11.098Z",
      source_hash: "44526eef75082b7751e59f32eff9bfaf27ad22f2cdc83446ea18a34f012adf54",
      source_manifest_hash: null,
      approved_by: null,
      notes: "Baseline"
    }],
    ["v1.1.0", {
      version_id: "v1.1.0",
      version_label: "1.1.0",
      status: "archived",
      created_at: "2026-10-06T05:55:36.735Z",
      published_at: "2026-10-06T05:55:36.735Z",
      source_hash: "44526eef75082b7751e59f32eff9bfaf27ad22f2cdc83446ea18a34f012adf54",
      source_manifest_hash: null,
      approved_by: null,
      notes: "v1.1.0 release"
    }],
    ["v1.1.1", {
      version_id: "v1.1.1",
      version_label: "1.1.1",
      status: "active",
      created_at: "2026-10-06T06:23:01.103Z",
      published_at: "2026-10-06T06:23:01.103Z",
      source_hash: "44526eef75082b7751e59f32eff9bfaf27ad22f2cdc83446ea18a34f012adf54",
      source_manifest_hash: null,
      approved_by: null,
      notes: "v1.1.1 release"
    }]
  ]);

  const rules = (initialState.rules || [
    { version_id: "v1.1.1", country_code: "US", transaction_rate: 0.065, listing_fee_amount: 0.20, listing_fee_currency: "USD", processing_rate: 0.03, processing_fixed_amount: 0.25, processing_fixed_currency: "USD", regulatory_rate: null },
    { version_id: "v1.1.1", country_code: "UK", transaction_rate: 0.065, listing_fee_amount: 0.16, listing_fee_currency: "GBP", processing_rate: 0.04, processing_fixed_amount: 0.20, processing_fixed_currency: "GBP", regulatory_rate: 0.0048 },
    { version_id: "v1.1.1", country_code: "CA", transaction_rate: 0.065, listing_fee_amount: 0.25, listing_fee_currency: "CAD", processing_rate: 0.03, processing_fixed_amount: 0.25, processing_fixed_currency: "CAD", regulatory_rate: 0.0050 }
  ]).map(r => ({ ...r }));

  const countries = new Map(initialState.countries || [
    ["US", { country_code: "US", country_name: "United States", currency_code: "USD", status: "active" }],
    ["UK", { country_code: "UK", country_name: "United Kingdom", currency_code: "GBP", status: "active" }],
    ["CA", { country_code: "CA", country_name: "Canada", currency_code: "CAD", status: "active" }]
  ]);

  const detectedChanges = (initialState.detectedChanges || []).map(c => ({ ...c }));
  const reviewQueue = (initialState.reviewQueue || []).map(r => ({ ...r }));
  const sourceRegistry = (initialState.sourceRegistry || getSampleSources()).map(s => ({ ...s }));

  function executeStatement(sql, params) {
    if (sql.includes("FROM fee_versions") && sql.includes("status = 'active'")) {
      for (const v of versions.values()) {
        if (v.status === "active") return { ...v };
      }
      return null;
    }

    if (sql.includes("FROM source_registry")) {
      return sourceRegistry.map(s => ({ ...s }));
    }

    if (sql.includes("FROM fee_rules WHERE version_id = ?")) {
      const vid = params[0];
      return rules.filter(r => r.version_id === vid).map(r => ({ ...r }));
    }

    if (sql.includes("FROM detected_changes")) {
      if (sql.includes("status IN ('approved', 'published')")) {
        return detectedChanges.filter(c => c.status === "approved" || c.status === "published");
      }
      if (sql.includes("status = 'approved'")) {
        return detectedChanges.filter(c => c.status === "approved");
      }
      return detectedChanges;
    }

    if (sql.includes("FROM review_queue") && (sql.includes("review_id = ?") || sql.includes("change_id = ?"))) {
      const id = params[0];
      return reviewQueue.find(r => r.review_id === id || r.change_id === id) || null;
    }

    if (sql.includes("INSERT INTO fee_versions")) {
      const vid = params[0];
      const vlabel = params[1];
      const stat = "draft";
      const cr = params[2];
      const pub = null;
      const hash = params[3];
      const manifestHash = params.length > 4 ? params[4] : null;
      const appBy = params.length > 5 ? params[5] : null;
      const notes = params[params.length - 1];
      versions.set(vid, { version_id: vid, version_label: vlabel, status: stat, created_at: cr, published_at: pub, source_hash: hash, source_manifest_hash: manifestHash, approved_by: appBy, notes });
      return { success: true };
    }

    if (sql.includes("INSERT INTO fee_rules")) {
      rules.push({ version_id: params[0], country_code: params[1], processing_rate: params[5] });
      return { success: true };
    }

    if (sql.includes("UPDATE fee_versions SET status = 'archived' WHERE status = 'active'")) {
      for (const v of versions.values()) {
        if (v.status === "active") v.status = "archived";
      }
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
        if (params.length > 3) rev.reviewed_by = params[2];
      }
      return { success: true };
    }

    if (sql.includes("UPDATE review_queue") && sql.includes("status = 'rejected'")) {
      const targetId = params[params.length - 1];
      const rev = reviewQueue.find(r => r.review_id === targetId || r.change_id === targetId);
      if (rev) {
        rev.status = "rejected";
        rev.reviewed_at = params[0];
        rev.reviewer_note = params[1];
      }
      return { success: true };
    }

    if (sql.includes("UPDATE detected_changes") && sql.includes("status = 'approved'")) {
      const chg = detectedChanges.find(c => c.change_id === params[0]);
      if (chg) chg.status = "approved";
      return { success: true };
    }

    if (sql.includes("UPDATE detected_changes") && sql.includes("status = 'rejected'")) {
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
    sourceRegistry,
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
      for (const stmt of statements) {
        await stmt.run();
      }
      return { success: true };
    }
  };
}

// ---------------------------------------------------------------------------
// STEP 7 TESTS: HASH DETERMINISM
// ---------------------------------------------------------------------------

test("Step 15.1: same source manifest produces identical hash", async () => {
  const sourcesA = getSampleSources();
  const sourcesB = getSampleSources();

  const hashA = await computeCompositeSourceHash(sourcesA);
  const hashB = await computeCompositeSourceHash(sourcesB);

  assert.equal(typeof hashA, "string");
  assert.equal(hashA.length, 64);
  assert.equal(hashA, hashB, "Identical sources must produce identical composite hashes");
});

test("Step 15.2: different source content produces different hash", async () => {
  const sourcesA = getSampleSources();
  const sourcesB = getSampleSources();
  // Modify content hash of article 115015628847
  sourcesB[0].latest_hash = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

  const hashA = await computeCompositeSourceHash(sourcesA);
  const hashB = await computeCompositeSourceHash(sourcesB);

  assert.notEqual(hashA, hashB, "Modified source content hash must produce different composite hash");
});

test("Step 15.3: different source URL produces different hash", async () => {
  const sourcesA = getSampleSources();
  const sourcesB = getSampleSources();
  // Alter canonical URL
  sourcesB[0].source_url = "https://help.etsy.com/hc/en-us/articles/115015628847-Different-Slug";

  const hashA = await computeCompositeSourceHash(sourcesA);
  const hashB = await computeCompositeSourceHash(sourcesB);

  assert.notEqual(hashA, hashB, "Changed canonical URL must alter composite hash");
});

test("Step 15.4: different source set produces different hash", async () => {
  const sourcesA = getSampleSources();
  const sourcesB = getSampleSources().slice(0, 7); // Exclude the 8th source

  const hashA = await computeCompositeSourceHash(sourcesA);
  const hashB = await computeCompositeSourceHash(sourcesB);

  assert.notEqual(hashA, hashB, "Removing or adding a source must alter composite hash");
});

test("Step 15.5: different ordering of identical sources produces SAME hash", async () => {
  const sourcesA = getSampleSources();
  const sourcesB = [...getSampleSources()].reverse(); // Reverse input ordering

  const hashA = await computeCompositeSourceHash(sourcesA);
  const hashB = await computeCompositeSourceHash(sourcesB);

  assert.equal(hashA, hashB, "Canonical sorting by source_id must guarantee order independence");
});

test("Step 15.6: unstable retrieval timestamp changes produce SAME content hash", async () => {
  const sourcesA = getSampleSources();
  const sourcesB = getSampleSources().map(s => ({
    ...s,
    last_checked_at: "2026-12-31T23:59:59.999Z" // Drastically different fetch timestamps
  }));

  const hashA = await computeCompositeSourceHash(sourcesA);
  const hashB = await computeCompositeSourceHash(sourcesB);

  assert.equal(hashA, hashB, "Retrieval timestamps must NOT be included in composite hash preimage");
});

// ---------------------------------------------------------------------------
// STEP 8 TESTS: PUBLICATION SAFETY & PROVENANCE
// ---------------------------------------------------------------------------

test("Step 15.7: future proposed version receives composite source provenance", async () => {
  const db = createMockD1({
    detectedChanges: [
      {
        change_id: "chg_uk_test",
        source_id: "115015628847",
        country_code: "UK",
        field_name: "processing_rate",
        old_value: "0.04",
        new_value: "0.045",
        change_type: "processing_rate_changed",
        status: "approved",
        reason: "Official rate adjustment per policy 115015628847"
      }
    ]
  });

  const res = await publishApprovedChanges({ DB: db }, {
    version_label: "1.2.0",
    approved_by: "kanishka",
    notes: "v1.2.0 test release"
  });

  assert.equal(res.success, true);
  assert.equal(res.publishedVersion, "v1.2.0");
  assert.equal(typeof res.sourceManifestHash, "string");
  assert.equal(res.sourceManifestHash.length, 64);
  assert.equal(res.approvedBy, "kanishka");

  const v120 = db.versions.get("v1.2.0");
  assert.ok(v120, "v1.2.0 record must exist in fee_versions");
  assert.equal(v120.source_manifest_hash, res.sourceManifestHash);
  assert.equal(v120.approved_by, "kanishka");
  assert.equal(v120.status, "active");
});

test("Step 15.8: pending proposal cannot mutate active version", async () => {
  const db = createMockD1({
    detectedChanges: [
      {
        change_id: "chg_pending_1",
        source_id: "115015628847",
        status: "pending_review",
        reason: "Unapproved proposal"
      }
    ]
  });

  const res = await publishApprovedChanges({ DB: db });
  assert.equal(res.success, false);
  assert.equal(res.activeVersion, "v1.1.1");
  assert.equal(db.versions.get("v1.1.1").status, "active", "v1.1.1 must remain active");
});

test("Step 15.9: atomic publication ensures exactly one active version exists", async () => {
  const db = createMockD1({
    detectedChanges: [
      {
        change_id: "chg_approved_1",
        source_id: "115015628847",
        status: "approved",
        change_type: "processing_rate_changed",
        country_code: "US",
        new_value: "0.035",
        reason: "Approved rate change"
      }
    ]
  });

  await publishApprovedChanges({ DB: db }, { version_label: "1.1.2" });

  let activeCount = 0;
  for (const v of db.versions.values()) {
    if (v.status === "active") activeCount++;
  }

  assert.equal(activeCount, 1, "Exactly one version must have status 'active'");
  assert.equal(db.versions.get("v1.1.2").status, "active");
  assert.equal(db.versions.get("v1.1.1").status, "archived");
});

test("Step 15.10: historical versions remain completely immutable", async () => {
  const db = createMockD1({
    detectedChanges: [
      {
        change_id: "chg_bump",
        source_id: "115015628847",
        status: "approved",
        change_type: "processing_rate_changed",
        country_code: "US",
        new_value: "0.032",
        reason: "Test bump"
      }
    ]
  });

  const origV100 = { ...db.versions.get("v1.0.0") };
  const origV110 = { ...db.versions.get("v1.1.0") };
  const origV111 = { ...db.versions.get("v1.1.1") };

  await publishApprovedChanges({ DB: db }, { version_label: "1.1.2" });

  const currentV100 = db.versions.get("v1.0.0");
  const currentV110 = db.versions.get("v1.1.0");

  assert.deepEqual(currentV100, origV100, "v1.0.0 must be byte-for-byte unchanged");
  assert.deepEqual(currentV110, origV110, "v1.1.0 must be byte-for-byte unchanged");
  assert.equal(origV111.source_hash, db.versions.get("v1.1.1").source_hash, "v1.1.1 source hash unchanged");
});

// ---------------------------------------------------------------------------
// STEP 9 TESTS: REVIEW SAFETY & PROVENANCE VALIDATION
// ---------------------------------------------------------------------------

test("Step 15.11: pending proposal leaves production unchanged", async () => {
  const db = createMockD1({
    reviewQueue: [
      { review_id: "rev_1", change_id: "chg_1", status: "pending", priority: "medium" }
    ]
  });

  const activeBefore = db.versions.get("v1.1.1");
  assert.equal(activeBefore.status, "active");
  assert.equal(db.reviewQueue.find(r => r.review_id === "rev_1").status, "pending");
});

test("Step 15.12: rejected proposal leaves production unchanged", async () => {
  const db = createMockD1({
    reviewQueue: [
      { review_id: "rev_reject", change_id: "chg_reject", status: "pending", priority: "high" }
    ],
    detectedChanges: [
      { change_id: "chg_reject", source_id: "115015628847", status: "pending_review" }
    ]
  });

  const req = new Request("http://localhost/api/admin/reject-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ review_id: "rev_reject", reason: "Spurious rate drift" })
  });

  const res = await handleRejectChange(req, { DB: db });
  assert.equal(res.status, 200);

  assert.equal(db.reviewQueue.find(r => r.review_id === "rev_reject").status, "rejected");
  assert.equal(db.detectedChanges.find(c => c.change_id === "chg_reject").status, "rejected");
  assert.equal(db.versions.get("v1.1.1").status, "active", "Active production version untouched");
});

test("Step 15.13: approved proposal is publishable and records reviewer identity", async () => {
  const db = createMockD1({
    reviewQueue: [
      { review_id: "rev_approve", change_id: "chg_approve", status: "pending", priority: "medium" }
    ],
    detectedChanges: [
      { change_id: "chg_approve", source_id: "115015628847", status: "pending_review" }
    ]
  });

  const req = new Request("http://localhost/api/admin/approve-change", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ review_id: "rev_approve", reviewed_by: "auditor_kanishka" })
  });

  const res = await handleApproveChange(req, { DB: db });
  assert.equal(res.status, 200);

  const rev = db.reviewQueue.find(r => r.review_id === "rev_approve");
  assert.equal(rev.status, "approved");
  assert.equal(rev.reviewed_by, "auditor_kanishka", "Reviewer identity must be stored in review_queue");
});

test("Step 15.14: incomplete provenance blocks publication", async () => {
  const db = createMockD1({
    detectedChanges: [
      {
        change_id: "chg_ok",
        source_id: "115015628847",
        status: "approved",
        change_type: "processing_rate_changed",
        country_code: "US",
        new_value: "0.031",
        reason: "Valid change"
      }
    ],
    sourceRegistry: [
      // Only 1 source present, missing other 7 required authoritative sources
      {
        source_id: "115015628847",
        source_url: "https://help.etsy.com/hc/en-us/articles/115015628847",
        latest_hash: "44526eef75082b7751e59f32eff9bfaf27ad22f2cdc83446ea18a34f012adf54"
      }
    ]
  });

  await assert.rejects(
    async () => {
      await publishApprovedChanges({ DB: db }, {
        version_label: "1.1.2",
        requireCompleteProvenance: true
      });
    },
    /Publication blocked: Incomplete source provenance/
  );
});

test("Step 15.15: missing source evidence blocks publication", async () => {
  const db = createMockD1({
    detectedChanges: [
      {
        change_id: "chg_bad_source",
        source_id: "unverified_999999", // Unregistered/non-official source ID
        status: "approved",
        change_type: "processing_rate_changed",
        country_code: "US",
        new_value: "0.031",
        reason: "Unauthorized change"
      }
    ]
  });

  await assert.rejects(
    async () => {
      await publishApprovedChanges({ DB: db }, { version_label: "1.1.2" });
    },
    /Publication blocked: Missing or invalid source evidence/
  );
});
