/**
 * ShopProfit Fee Version Publisher & Rollback Engine
 *
 * Provides transactional, atomic fee version creation, promotion, rollback,
 * and data quality telemetry using Cloudflare D1 batch operations.
 */

import { computeCompositeSourceHash, validateSourceManifestCompleteness } from "./provenance.js";
import { OFFICIAL_SOURCES } from "./governance.js";

function generateId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Computes next semantic version string
 */
export function computeNextVersion(currentLabel = "1.0.0", isMinorBump = false) {
  const clean = currentLabel.replace(/^v/i, "");
  const parts = clean.split(".").map(n => parseInt(n, 10));
  let [major = 1, minor = 0, patch = 0] = parts;

  if (isMinorBump) {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `v${major}.${minor}.${patch}`;
}

/**
 * Atomically publishes a set of approved changes into a new active fee version
 */
export async function publishApprovedChanges(env, options = {}) {
  const now = new Date().toISOString();

  // 1. Get current active version
  const activeVersion = await env.DB.prepare(`
    SELECT version_id, version_label, source_hash
    FROM fee_versions
    WHERE status = 'active'
    LIMIT 1;
  `).first();

  if (!activeVersion) {
    throw new Error("Cannot publish: No current active fee version found");
  }

  // 2. Fetch approved changes that have not yet been published
  let approvedChanges = [];
  if (options.changeIds && options.changeIds.length > 0) {
    const placeholders = options.changeIds.map(() => "?").join(", ");
    const { results } = await env.DB.prepare(`
      SELECT c.*, r.proposed_value, r.reason
      FROM detected_changes c
      LEFT JOIN review_queue r ON c.change_id = r.change_id
      WHERE c.change_id IN (${placeholders}) AND c.status IN ('approved', 'published');
    `).bind(...options.changeIds).all();
    approvedChanges = results;
  } else if (options.includePublished) {
    const { results } = await env.DB.prepare(`
      SELECT c.*, r.proposed_value, r.reason
      FROM detected_changes c
      LEFT JOIN review_queue r ON c.change_id = r.change_id
      WHERE c.status IN ('approved', 'published') AND c.change_type = 'new_country';
    `).all();
    approvedChanges = results;
  } else {
    const { results } = await env.DB.prepare(`
      SELECT c.*, r.proposed_value, r.reason
      FROM detected_changes c
      LEFT JOIN review_queue r ON c.change_id = r.change_id
      WHERE c.status = 'approved';
    `).all();
    approvedChanges = results;
  }

  if (approvedChanges.length === 0 && !options.forceRelease && !options.allowEmptyChanges) {
    return {
      success: false,
      message: "No approved changes found to publish",
      publishedVersion: null,
      activeVersion: activeVersion.version_id
    };
  }

  // Validate source evidence for each approved change
  for (const chg of approvedChanges) {
    if (chg.source_id && !OFFICIAL_SOURCES.has(String(chg.source_id))) {
      throw new Error(`Publication blocked: Missing or invalid source evidence for change '${chg.change_id}'`);
    }
  }

  // Build and validate composite source manifest
  let compositeManifestHash = null;
  let sourcesForManifest = options.sourceManifest || null;
  if (!sourcesForManifest) {
    try {
      const { results: regSources } = await env.DB.prepare(`
        SELECT source_id, source_name, source_url, latest_hash, last_checked_at
        FROM source_registry
        WHERE enabled = 1;
      `).all();
      sourcesForManifest = regSources || [];
    } catch {
      sourcesForManifest = [];
    }
  }

  if (sourcesForManifest && sourcesForManifest.length > 0) {
    if (options.requireCompleteProvenance) {
      validateSourceManifestCompleteness(sourcesForManifest);
    }
    compositeManifestHash = await computeCompositeSourceHash(sourcesForManifest);
  } else if (options.requireCompleteProvenance) {
    throw new Error("Publication blocked: Incomplete source provenance — no authoritative sources found");
  }

  // 3. Determine next version ID and label
  const hasNewMarkets = approvedChanges.some(c => c.change_type === "new_country");
  const nextLabel = options.version_label || computeNextVersion(activeVersion.version_label, hasNewMarkets);
  const nextVersionId = nextLabel.startsWith("v") ? nextLabel : `v${nextLabel}`;

  // 4. Fetch all active fee rules from current active version to clone
  const { results: currentRules } = await env.DB.prepare(`
    SELECT * FROM fee_rules WHERE version_id = ?;
  `).bind(activeVersion.version_id).all();

  const STATUTORY_REGULATORY_RATES = {
    CA: 0.0050,
    FR: 0.0114,
    HU: 0.0197,
    IT: 0.0080,
    IN: 0.0005,
    ES: 0.0088,
    TR: 0.0167,
    UK: 0.0048,
    VN: 0.0124
  };

  const STATUTORY_DEPOSIT_SCHEDULES = {
    ID: { min: 28000, thresh: 1400000, fee: 28000, cur: "IDR" },
    IL: { min: 7, thresh: 350, fee: 7, cur: "ILS" },
    MY: { min: 9, thresh: 400, fee: 8, cur: "MYR" },
    MX: { min: 40, thresh: 2000, fee: 40, cur: "MXN" },
    MA: { min: 20, thresh: 1000, fee: 20, cur: "MAD" },
    PH: { min: 100, thresh: 5000, fee: 100, cur: "PHP" },
    ZA: { min: 35, thresh: 1500, fee: 30, cur: "ZAR" },
    TR: { min: 50, thresh: 600, fee: 42, cur: "TRY" },
    VN: { min: 45000, thresh: 2300000, fee: 45000, cur: "VND" }
  };

  // Create working map of rules for next version: country_code -> rule
  const nextRulesMap = new Map();
  for (const r of currentRules) {
    const regRate = STATUTORY_REGULATORY_RATES[r.country_code] !== undefined 
      ? STATUTORY_REGULATORY_RATES[r.country_code] 
      : null;
    const depSched = STATUTORY_DEPOSIT_SCHEDULES[r.country_code];
    nextRulesMap.set(r.country_code, { 
      ...r, 
      version_id: nextVersionId,
      regulatory_rate: regRate,
      deposit_minimum_amount: depSched ? depSched.min : null,
      deposit_minimum_currency: depSched ? depSched.cur : null,
      deposit_threshold_amount: depSched ? depSched.thresh : null,
      deposit_threshold_currency: depSched ? depSched.cur : null,
      deposit_fee_amount: depSched ? depSched.fee : null,
      deposit_fee_currency: depSched ? depSched.cur : null
    });
  }

  const countriesToActivate = [];
  const countriesToDeactivate = [];

  // 5. Apply approved changes to working set
  for (const chg of approvedChanges) {
    const code = chg.country_code;

    if (chg.change_type === "new_country") {
      countriesToActivate.push(code);

      // Parse candidate data from proposed_value
      let candidate = {};
      try {
        candidate = JSON.parse(chg.proposed_value || "{}");
      } catch {}

      const regRate = STATUTORY_REGULATORY_RATES[code] !== undefined 
        ? STATUTORY_REGULATORY_RATES[code] 
        : (candidate.regulatoryRate !== undefined && candidate.regulatoryRate !== null ? candidate.regulatoryRate : null);

      const newRule = {
        version_id: nextVersionId,
        country_code: code,
        transaction_rate: 0.065,
        listing_fee_amount: 0.20,
        listing_fee_currency: candidate.currency || "USD",
        processing_rate: candidate.processingRate !== undefined ? candidate.processingRate : 0.04,
        processing_fixed_amount: candidate.processingFixed !== undefined ? candidate.processingFixed : 0.25,
        processing_fixed_currency: candidate.currency || "USD",
        domestic_processing_rate: candidate.domesticProcessingRate || null,
        domestic_processing_fixed_amount: candidate.domesticProcessingFixed || null,
        domestic_processing_fixed_currency: candidate.currency || null,
        international_processing_rate: candidate.internationalProcessingRate || null,
        international_processing_fixed_amount: candidate.internationalProcessingFixed || null,
        international_processing_fixed_currency: candidate.currency || null,
        regulatory_rate: regRate,
        currency_conversion_rate: 0.025,
        offsite_rate_below_threshold: 0.15,
        offsite_rate_above_threshold: 0.12,
        offsite_cap_amount: 100,
        offsite_cap_currency: "USD",
        offsite_threshold_amount: 10000,
        offsite_threshold_currency: "USD",
        plus_monthly_amount: 10,
        plus_currency: "USD",
        deposit_minimum_amount: candidate.depositMinimumAmount || null,
        deposit_minimum_currency: candidate.currency || null,
        deposit_threshold_amount: candidate.depositThresholdAmount || null,
        deposit_threshold_currency: candidate.currency || null,
        deposit_fee_amount: candidate.depositFeeAmount || null,
        deposit_fee_currency: candidate.currency || null,
        setup_fee_amount: 15,
        setup_fee_currency: "USD",
        tax_notes: null,
        special_rules: null,
        source_id: chg.source_id,
        source_url: "https://help.etsy.com/hc/en-us/articles/115015628847",
        effective_from: now,
        verification_status: "verified",
        created_at: now
      };
      nextRulesMap.set(code, newRule);

    } else if (chg.change_type === "processing_rate_changed") {
      const existing = nextRulesMap.get(code);
      if (existing) {
        existing.processing_rate = parseFloat(chg.new_value);
        existing.effective_from = now;
      }
    } else if (chg.change_type === "regulatory_rate_changed") {
      const existing = nextRulesMap.get(code);
      if (existing) {
        existing.regulatory_rate = parseFloat(chg.new_value);
        existing.effective_from = now;
      }
    } else if (chg.change_type === "currency_changed") {
      const existing = nextRulesMap.get(code);
      if (existing) {
        existing.processing_fixed_currency = chg.new_value;
        existing.listing_fee_currency = chg.new_value;
      }
    } else if (chg.change_type === "deposit_schedule_changed" || chg.change_type === "deposit_fee_changed") {
      const existing = nextRulesMap.get(code);
      if (existing) {
        let val = {};
        try { val = JSON.parse(chg.new_value || "{}"); } catch {}
        if (val.minimum !== undefined) existing.deposit_minimum_amount = val.minimum;
        if (val.threshold !== undefined) existing.deposit_threshold_amount = val.threshold;
        if (val.fee !== undefined) existing.deposit_fee_amount = val.fee;
        if (val.currency !== undefined) {
          existing.deposit_minimum_currency = val.currency;
          existing.deposit_threshold_currency = val.currency;
          existing.deposit_fee_currency = val.currency;
        }
        existing.effective_from = now;
      }
    } else if (chg.change_type === "removed_country") {
      countriesToDeactivate.push(code);
    }
  }

  // 6. Build atomic D1 batch operations
  const batchStatements = [];

  // Clean any previous draft/archived rules if re-releasing the version label
  batchStatements.push(
    env.DB.prepare(`DELETE FROM fee_rules WHERE version_id = ?;`).bind(nextVersionId)
  );
  batchStatements.push(
    env.DB.prepare(`DELETE FROM fee_versions WHERE version_id = ?;`).bind(nextVersionId)
  );

  const approvedBy = options.approved_by || options.reviewed_by || null;

  // A. Create the new fee_version record
  batchStatements.push(
    env.DB.prepare(`
      INSERT INTO fee_versions (
        version_id, version_label, status, created_at, published_at, source_hash, source_manifest_hash, approved_by, notes
      ) VALUES (?, ?, 'draft', ?, NULL, ?, ?, ?, ?);
    `).bind(
      nextVersionId,
      nextLabel.replace(/^v/i, ""),
      now,
      activeVersion.source_hash || "hash_auto",
      compositeManifestHash,
      approvedBy,
      options.notes || `Published release including ${approvedChanges.length} verified change(s).`
    )
  );

  // B. Insert all fee_rules for the new version
  for (const rule of nextRulesMap.values()) {
    batchStatements.push(
      env.DB.prepare(`
        INSERT INTO fee_rules (
          version_id, country_code, transaction_rate,
          listing_fee_amount, listing_fee_currency,
          processing_rate, processing_fixed_amount, processing_fixed_currency,
          domestic_processing_rate, domestic_processing_fixed_amount, domestic_processing_fixed_currency,
          international_processing_rate, international_processing_fixed_amount, international_processing_fixed_currency,
          regulatory_rate, currency_conversion_rate,
          offsite_rate_below_threshold, offsite_rate_above_threshold,
          offsite_cap_amount, offsite_cap_currency,
          offsite_threshold_amount, offsite_threshold_currency,
          plus_monthly_amount, plus_currency,
          deposit_minimum_amount, deposit_minimum_currency,
          deposit_threshold_amount, deposit_threshold_currency,
          deposit_fee_amount, deposit_fee_currency,
          setup_fee_amount, setup_fee_currency,
          tax_notes, special_rules, source_id, source_url,
          effective_from, verification_status, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        );
      `).bind(
        nextVersionId, rule.country_code, rule.transaction_rate,
        rule.listing_fee_amount, rule.listing_fee_currency,
        rule.processing_rate, rule.processing_fixed_amount, rule.processing_fixed_currency,
        rule.domestic_processing_rate, rule.domestic_processing_fixed_amount, rule.domestic_processing_fixed_currency,
        rule.international_processing_rate, rule.international_processing_fixed_amount, rule.international_processing_fixed_currency,
        rule.regulatory_rate, rule.currency_conversion_rate,
        rule.offsite_rate_below_threshold, rule.offsite_rate_above_threshold,
        rule.offsite_cap_amount, rule.offsite_cap_currency,
        rule.offsite_threshold_amount, rule.offsite_threshold_currency,
        rule.plus_monthly_amount, rule.plus_currency,
        rule.deposit_minimum_amount, rule.deposit_minimum_currency,
        rule.deposit_threshold_amount, rule.deposit_threshold_currency,
        rule.deposit_fee_amount, rule.deposit_fee_currency,
        rule.setup_fee_amount, rule.setup_fee_currency,
        rule.tax_notes, rule.special_rules, rule.source_id, rule.source_url,
        rule.effective_from, rule.verification_status, now
      )
    );
  }

  // C. Update countries status for newly activated countries
  for (const c of countriesToActivate) {
    batchStatements.push(
      env.DB.prepare(`
        UPDATE countries SET status = 'active', updated_at = ? WHERE country_code = ?;
      `).bind(now, c)
    );
  }

  // D. Update countries status for deactivated countries
  for (const c of countriesToDeactivate) {
    batchStatements.push(
      env.DB.prepare(`
        UPDATE countries SET status = 'inactive', updated_at = ? WHERE country_code = ?;
      `).bind(now, c)
    );
  }

  // E. Atomic version status swap (archives old active, activates new version)
  batchStatements.push(
    env.DB.prepare(`UPDATE fee_versions SET status = 'archived' WHERE status = 'active';`)
  );
  batchStatements.push(
    env.DB.prepare(`UPDATE fee_versions SET status = 'active', published_at = ? WHERE version_id = ?;`).bind(now, nextVersionId)
  );

  // F. Mark changes and reviews as published
  for (const chg of approvedChanges) {
    batchStatements.push(
      env.DB.prepare(`UPDATE detected_changes SET status = 'published' WHERE change_id = ?;`).bind(chg.change_id)
    );
    batchStatements.push(
      env.DB.prepare(`UPDATE review_queue SET status = 'published', reviewed_at = ? WHERE change_id = ?;`).bind(now, chg.change_id)
    );
  }

  // 7. Execute the transaction via D1 batch
  await env.DB.batch(batchStatements);

  return {
    success: true,
    previousVersion: activeVersion.version_id,
    publishedVersion: nextVersionId,
    versionLabel: nextLabel,
    totalRules: nextRulesMap.size,
    changesPublished: approvedChanges.length,
    publishedAt: now,
    sourceManifestHash: compositeManifestHash,
    approvedBy
  };
}

/**
 * Atomically rolls back to a previous archived fee version
 */
export async function rollbackVersion(env, targetVersionId = null, reason = "Admin rollback requested") {
  const now = new Date().toISOString();

  // 1. Get current active version
  const currentActive = await env.DB.prepare(`
    SELECT version_id, version_label FROM fee_versions WHERE status = 'active' LIMIT 1;
  `).first();

  if (!currentActive) {
    throw new Error("Rollback failed: No current active version found");
  }

  // 2. Identify target version
  let target = null;
  if (targetVersionId) {
    target = await env.DB.prepare(`
      SELECT version_id, version_label, status FROM fee_versions WHERE version_id = ?;
    `).bind(targetVersionId).first();
  } else {
    // Pick the most recently archived version
    target = await env.DB.prepare(`
      SELECT version_id, version_label, status
      FROM fee_versions
      WHERE status = 'archived'
      ORDER BY published_at DESC
      LIMIT 1;
    `).first();
  }

  if (!target) {
    throw new Error(`Rollback failed: Target version ${targetVersionId || "latest archived"} not found`);
  }

  if (target.version_id === currentActive.version_id) {
    throw new Error("Rollback failed: Target version is already the active version");
  }

  // 3. Verify target version has complete fee rules
  const { results: targetRules } = await env.DB.prepare(`
    SELECT count(*) as count FROM fee_rules WHERE version_id = ?;
  `).bind(target.version_id).all();

  const ruleCount = targetRules?.[0]?.count || 0;
  if (ruleCount < 5) {
    throw new Error(`Rollback failed: Target version ${target.version_id} has insufficient rules (${ruleCount})`);
  }

  // 4. Execute atomic rollback transaction via D1 batch
  await env.DB.batch([
    env.DB.prepare(`UPDATE fee_versions SET status = 'archived' WHERE version_id = ?;`).bind(currentActive.version_id),
    env.DB.prepare(`UPDATE fee_versions SET status = 'active', published_at = ? WHERE version_id = ?;`).bind(now, target.version_id),
    env.DB.prepare(`UPDATE countries SET status = 'pending_review' WHERE country_code NOT IN ('US', 'UK', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'IN', 'JP', 'TR', 'OTHER');`),
    env.DB.prepare(`UPDATE countries SET status = 'active' WHERE country_code IN ('US', 'UK', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'IN', 'JP', 'TR');`),
    env.DB.prepare(`UPDATE countries SET status = 'partial' WHERE country_code = 'OTHER';`)
  ]);

  return {
    success: true,
    rolledBackFrom: currentActive.version_id,
    activeVersion: target.version_id,
    targetRuleCount: ruleCount,
    rolledBackAt: now,
    reason
  };
}

/**
 * Compiles a complete data quality and governance diagnostic report
 */
export async function getDataQualityReport(env) {
  // 1. Country status distribution
  const { results: countryStatusRows } = await env.DB.prepare(`
    SELECT status, count(*) as count FROM countries GROUP BY status;
  `).all();

  const countryStatus = {};
  let totalCountries = 0;
  for (const r of countryStatusRows || []) {
    countryStatus[r.status] = r.count;
    totalCountries += r.count;
  }

  // 2. Sovereign vs fallback markets
  const { results: sovereignRows } = await env.DB.prepare(`
    SELECT count(*) as count FROM countries WHERE country_code != 'OTHER';
  `).all();
  const sovereignMarkets = sovereignRows?.[0]?.count || 0;

  // 3. Versions overview
  const { results: versions } = await env.DB.prepare(`
    SELECT version_id, version_label, status, published_at FROM fee_versions ORDER BY created_at DESC;
  `).all();

  const activeVersion = versions?.find(v => v.status === "active") || null;

  // 4. Pending reviews by priority
  const { results: reviewPriorityRows } = await env.DB.prepare(`
    SELECT priority, count(*) as count FROM review_queue WHERE status = 'pending' GROUP BY priority;
  `).all();

  const pendingByPriority = {};
  let totalPendingReviews = 0;
  for (const r of reviewPriorityRows || []) {
    pendingByPriority[r.priority] = r.count;
    totalPendingReviews += r.count;
  }

  // 5. Incomplete fee data (active countries missing processing rates)
  const { results: incompleteRows } = await env.DB.prepare(`
    SELECT c.country_code, c.country_name
    FROM countries c
    LEFT JOIN fee_rules r ON c.country_code = r.country_code AND r.version_id = ?
    WHERE c.status = 'active' AND (r.processing_rate IS NULL OR r.processing_fixed_amount IS NULL);
  `).bind(activeVersion ? activeVersion.version_id : "v1.0.0").all();

  // 6. Latest monitor run
  const latestRun = await env.DB.prepare(`
    SELECT run_id, status, started_at, completed_at, sources_checked, changes_detected, errors
    FROM monitor_runs
    ORDER BY started_at DESC
    LIMIT 1;
  `).first();

  return {
    timestamp: new Date().toISOString(),
    totalCountryRows: totalCountries,
    sovereignMarkets,
    fallbackMarketCount: totalCountries - sovereignMarkets,
    countriesByStatus: {
      active: countryStatus.active || 0,
      partial: countryStatus.partial || 0,
      pending_review: countryStatus.pending_review || 0,
      inactive: countryStatus.inactive || 0,
      unsupported: countryStatus.unsupported || 0
    },
    incompleteCountriesCount: (incompleteRows || []).length,
    incompleteCountries: incompleteRows || [],
    conflictingSourcesCount: 0,
    activeVersion: activeVersion ? activeVersion.version_id : null,
    totalVersions: (versions || []).length,
    versions: versions || [],
    totalPendingReviews,
    pendingReviewsByPriority: {
      critical: pendingByPriority.critical || 0,
      high: pendingByPriority.high || 0,
      medium: pendingByPriority.medium || 0,
      low: pendingByPriority.low || 0
    },
    latestMonitorRun: latestRun || null
  };
}
