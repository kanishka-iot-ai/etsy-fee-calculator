/**
 * ShopProfit Fee Governance & Classification Engine
 *
 * Implements deterministic policy evaluation for candidate fee changes:
 * - Classifies changes as safe_auto_publish, needs_review, blocked, or no_change
 * - Enforces data completeness, boundary validation, and anomaly detection
 * - Handles new market, removed market, and contradictory source rules
 */

import { VALID_CURRENCIES, COUNTRY_ISO_MAP } from "./canonicalize.js";

export const CLASSIFICATIONS = {
  SAFE_AUTO_PUBLISH: "safe_auto_publish",
  NEEDS_REVIEW: "needs_review",
  BLOCKED: "blocked",
  NO_CHANGE: "no_change"
};

export const PRIORITIES = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low"
};

/**
 * Known official Etsy source IDs
 */
export const OFFICIAL_SOURCES = new Set([
  "115015628847", // Payment Processing
  "1500011073202", // Regulatory Operating Fee
  "115014483627", // Fees and Taxes Overview
  "360000338367", // Offsite Ads
  "360001589928", // Etsy Plus
  "360000344668", // Currency Conversion
  "360040584433", // VAT on Seller Fees
  "115015710408"  // Countries Eligible for Etsy Payments
]);

/**
 * Deterministically evaluates whether a detected change can be automatically published
 * or must be routed to the human review queue or blocked.
 *
 * @param {Object} change - Detected change record
 * @param {Object} candidate - Normalized market candidate data
 * @param {Object} context - Execution context (baseline, flags, conflicts)
 * @returns {Object} { canPublish: boolean, classification: string, priority: string, reason: string }
 */
export function canAutoPublish(change, candidate = {}, context = {}) {
  const {
    sourceId,
    countryCode,
    fieldName,
    oldValue,
    newValue,
    changeType
  } = change;

  // 1. Source verification: Must be from a registered official Etsy source
  if (!sourceId || !OFFICIAL_SOURCES.has(String(sourceId))) {
    return {
      canPublish: false,
      classification: CLASSIFICATIONS.BLOCKED,
      priority: PRIORITIES.CRITICAL,
      reason: `Unknown or unverified source ID: ${sourceId}`
    };
  }

  // 2. Parser status check
  if (context.parserFailed || context.incompleteTable) {
    return {
      canPublish: false,
      classification: CLASSIFICATIONS.BLOCKED,
      priority: PRIORITIES.CRITICAL,
      reason: "Parser confidence check failed or table incomplete"
    };
  }

  // 3. Contradictory official sources check
  if (context.hasSourceConflict) {
    return {
      canPublish: false,
      classification: CLASSIFICATIONS.NEEDS_REVIEW,
      priority: PRIORITIES.CRITICAL,
      reason: `Contradictory official Etsy sources detected for ${countryCode}: ${context.conflictDetails || "conflicting values"}`
    };
  }

  // 4. Country code validation
  const validCountryCodes = new Set(Object.values(COUNTRY_ISO_MAP));
  validCountryCodes.add("OTHER");
  if (!countryCode || !validCountryCodes.has(countryCode)) {
    return {
      canPublish: false,
      classification: CLASSIFICATIONS.BLOCKED,
      priority: PRIORITIES.CRITICAL,
      reason: `Invalid or unrecognized ISO country code: ${countryCode}`
    };
  }

  // 5. Currency validation
  if (candidate.currency && !VALID_CURRENCIES.has(candidate.currency)) {
    return {
      canPublish: false,
      classification: CLASSIFICATIONS.BLOCKED,
      priority: PRIORITIES.CRITICAL,
      reason: `Invalid or unrecognized currency code: ${candidate.currency}`
    };
  }

  // 6. Currency change anomaly detection (Currency changes require human review)
  if (changeType === "currency_changed" || (context.oldCurrency && candidate.currency && context.oldCurrency !== candidate.currency)) {
    return {
      canPublish: false,
      classification: CLASSIFICATIONS.NEEDS_REVIEW,
      priority: PRIORITIES.CRITICAL,
      reason: `Currency change from ${oldValue || context.oldCurrency} to ${newValue || candidate.currency} requires verification`
    };
  }

  // 7. Numerical boundary validations
  if (candidate.processingRate !== undefined && candidate.processingRate !== null) {
    if (isNaN(candidate.processingRate) || candidate.processingRate < 0 || candidate.processingRate > 1.0) {
      return {
        canPublish: false,
        classification: CLASSIFICATIONS.BLOCKED,
        priority: PRIORITIES.CRITICAL,
        reason: `Processing rate out of valid bounds (0.00 to 1.00): ${candidate.processingRate}`
      };
    }
  }

  if (candidate.processingFixed !== undefined && candidate.processingFixed !== null) {
    if (isNaN(candidate.processingFixed) || candidate.processingFixed < 0) {
      return {
        canPublish: false,
        classification: CLASSIFICATIONS.BLOCKED,
        priority: PRIORITIES.CRITICAL,
        reason: `Negative fixed fee amount: ${candidate.processingFixed}`
      };
    }
  }

  if (candidate.regulatoryRate !== undefined && candidate.regulatoryRate !== null) {
    if (isNaN(candidate.regulatoryRate) || candidate.regulatoryRate < 0 || candidate.regulatoryRate > 0.10) {
      return {
        canPublish: false,
        classification: CLASSIFICATIONS.BLOCKED,
        priority: PRIORITIES.CRITICAL,
        reason: `Regulatory operating fee out of bounds (0.00 to 0.10): ${candidate.regulatoryRate}`
      };
    }
  }

  // 8. Suspicious fee change anomaly detection (Rate jump >= 5 percentage points)
  if (fieldName === "processing_rate" || changeType === "processing_rate_changed") {
    const oldRate = parseFloat(oldValue);
    const newRate = parseFloat(newValue !== undefined ? newValue : candidate.processingRate);
    if (!isNaN(oldRate) && !isNaN(newRate)) {
      const delta = Math.abs(newRate - oldRate);
      if (delta >= 0.05 || newRate > 0.25) {
        return {
          canPublish: false,
          classification: CLASSIFICATIONS.NEEDS_REVIEW,
          priority: PRIORITIES.CRITICAL,
          reason: `SUSPICIOUS: Fee rate delta (${(delta * 100).toFixed(2)}%) exceeds safety threshold (5%)`
        };
      }
    }
  }

  // 9. Removed country policy: Never deleted, always needs review
  if (changeType === "removed_country") {
    return {
      canPublish: false,
      classification: CLASSIFICATIONS.NEEDS_REVIEW,
      priority: PRIORITIES.HIGH,
      reason: `Country ${countryCode} absent from published official table; preserve history and mark inactive upon confirmation`
    };
  }

  // 10. New country policy
  if (changeType === "new_country") {
    // Check required fields for a complete new market
    const hasRate = candidate.processingRate !== undefined && candidate.processingRate !== null;
    const hasFixed = candidate.processingFixed !== undefined && candidate.processingFixed !== null;
    const hasCurrency = Boolean(candidate.currency);

    if (!hasRate || !hasFixed || !hasCurrency) {
      return {
        canPublish: false,
        classification: CLASSIFICATIONS.BLOCKED,
        priority: PRIORITIES.HIGH,
        reason: "Incomplete candidate data: missing processing rate, fixed amount, or currency"
      };
    }

    // New country auto-publish is allowed ONLY if explicit flag is passed and all checks passed
    if (context.allowNewCountryAutoPublish === true) {
      return {
        canPublish: true,
        classification: CLASSIFICATIONS.SAFE_AUTO_PUBLISH,
        priority: PRIORITIES.HIGH,
        reason: "All deterministic safety checks passed for new official market"
      };
    }

    // Default policy for new countries: requires human governance review
    return {
      canPublish: false,
      classification: CLASSIFICATIONS.NEEDS_REVIEW,
      priority: PRIORITIES.HIGH,
      reason: "New sovereign market discovered: requires governance approval before production activation"
    };
  }

  // 11. Regulatory fee change policy
  if (changeType === "regulatory_rate_changed") {
    return {
      canPublish: false,
      classification: CLASSIFICATIONS.NEEDS_REVIEW,
      priority: PRIORITIES.HIGH,
      reason: `Official regulatory fee changed to ${(parseFloat(newValue) * 100).toFixed(2)}%; requires review`
    };
  }

  // 12. Standard fee adjustment policy (small processing rate adjustments under threshold)
  if (changeType === "processing_rate_changed") {
    if (context.allowFeeUpdateAutoPublish === true) {
      return {
        canPublish: true,
        classification: CLASSIFICATIONS.SAFE_AUTO_PUBLISH,
        priority: PRIORITIES.HIGH,
        reason: "Minor verified processing fee adjustment within safety threshold"
      };
    }
    return {
      canPublish: false,
      classification: CLASSIFICATIONS.NEEDS_REVIEW,
      priority: PRIORITIES.HIGH,
      reason: "Official processing fee adjustment pending review"
    };
  }

  // 13. Default fallback
  return {
    canPublish: false,
    classification: CLASSIFICATIONS.NEEDS_REVIEW,
    priority: PRIORITIES.MEDIUM,
    reason: `Change type ${changeType} requires review`
  };
}

/**
 * Groups multiple field-level detected changes into coherent release packages
 * (e.g. all changes resulting from a single official Etsy table update).
 */
export function groupChangesByRelease(changes = []) {
  const groups = new Map();
  for (const chg of changes) {
    const key = `${chg.source_id}_${chg.snapshot_id || "snap"}`;
    if (!groups.has(key)) {
      groups.set(key, {
        sourceId: chg.source_id,
        snapshotId: chg.snapshot_id,
        changes: [],
        countryCodes: new Set(),
        detectedAt: chg.detected_at
      });
    }
    const group = groups.get(key);
    group.changes.push(chg);
    if (chg.country_code) group.countryCodes.add(chg.country_code);
  }

  return Array.from(groups.values()).map(g => ({
    ...g,
    countryCodes: Array.from(g.countryCodes),
    totalChanges: g.changes.length
  }));
}
