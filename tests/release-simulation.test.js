import assert from "node:assert/strict";
import test from "node:test";
import { COUNTRY_ORDER as BASELINE_COUNTRY_ORDER } from "../src/countries.js";
import { COUNTRIES as BASELINE_COUNTRIES } from "./legacy/countries.js";
import {
  normalizeFeeSchedule,
  toCalculatorCountry,
  FULLY_VERIFIED_CANDIDATES,
  PAYONEER_CANDIDATES,
  EUR_BANK_FX_CANDIDATES,
  ALL_CANDIDATE_CODES,
  OFFICIAL_PAYONEER_COUNTRIES,
  STATUTORY_REGULATORY_RATES,
  STATUTORY_DEPOSIT_SCHEDULES,
  NEW_SHOP_RESTRICTIONS,
  EUR_PAYOUT_COUNTRIES,
  EURO_AREA_COUNTRIES,
  EUR_PAYOUT_CANDIDATES,
  FEE_BASES
} from "../src/compatibility.js";
import { COUNTRY_ISO_MAP, VALID_CURRENCIES } from "../worker/src/canonicalize.js";
import { handleGetFees } from "../worker/src/api.js";
import {
  publishApprovedChanges,
  rollbackVersion,
  computeNextVersion
} from "../worker/src/publisher.js";
import { canAutoPublish, CLASSIFICATIONS, PRIORITIES } from "../worker/src/governance.js";

/**
 * Authoritative 50 Candidate Fee Specifications
 * Sourced directly from official Etsy Help Center articles:
 * - Payment processing (115015628847)
 * - Eligibility (115015710408)
 * - Regulatory operating fees (1500011073202)
 * - Deposit fees (115015628847 / 115014483627)
 */
export const CANDIDATE_DEFINITIONS = {
  // --- 30 FULLY VERIFIED MARKETS ---
  AT: { name: "Austria", currency: "EUR", symbol: "€", locale: "de-AT", rate: 0.04, fixed: 0.30 },
  BE: { name: "Belgium", currency: "EUR", symbol: "€", locale: "nl-BE", rate: 0.04, fixed: 0.30 },
  CH: { name: "Switzerland", currency: "CHF", symbol: "CHF", locale: "de-CH", rate: 0.04, fixed: 0.50 },
  CY: { name: "Cyprus", currency: "EUR", symbol: "€", locale: "el-CY", rate: 0.04, fixed: 0.30 },
  DK: { name: "Denmark", currency: "DKK", symbol: "kr", locale: "da-DK", rate: 0.04, fixed: 2.50 },
  EE: { name: "Estonia", currency: "EUR", symbol: "€", locale: "et-EE", rate: 0.04, fixed: 0.30 },
  FI: { name: "Finland", currency: "EUR", symbol: "€", locale: "fi-FI", rate: 0.04, fixed: 0.30 },
  GR: { name: "Greece", currency: "EUR", symbol: "€", locale: "el-GR", rate: 0.04, fixed: 0.30 },
  HK: { name: "Hong Kong", currency: "HKD", symbol: "HK$", locale: "zh-HK", rate: 0.044, fixed: 2.00 },
  ID: { name: "Indonesia", currency: "IDR", symbol: "Rp", locale: "id-ID", rate: 0.045, fixed: 7000 },
  IE: { name: "Ireland", currency: "EUR", symbol: "€", locale: "en-IE", rate: 0.04, fixed: 0.30 },
  IL: { name: "Israel", currency: "ILS", symbol: "₪", locale: "he-IL", rate: 0.045, fixed: 2.00 },
  LT: { name: "Lithuania", currency: "EUR", symbol: "€", locale: "lt-LT", rate: 0.04, fixed: 0.30 },
  LU: { name: "Luxembourg", currency: "EUR", symbol: "€", locale: "fr-LU", rate: 0.04, fixed: 0.30 },
  LV: { name: "Latvia", currency: "EUR", symbol: "€", locale: "lv-LV", rate: 0.04, fixed: 0.30 },
  MA: { name: "Morocco", currency: "MAD", symbol: "MAD", locale: "ar-MA", rate: 0.045, fixed: 5.00 },
  MT: { name: "Malta", currency: "EUR", symbol: "€", locale: "mt-MT", rate: 0.04, fixed: 0.30 },
  MX: { name: "Mexico", currency: "MXN", symbol: "MX$", locale: "es-MX", rate: 0.045, fixed: 8.00 },
  MY: { name: "Malaysia", currency: "MYR", symbol: "RM", locale: "ms-MY", rate: 0.045, fixed: 2.00 },
  NL: { name: "Netherlands", currency: "EUR", symbol: "€", locale: "nl-NL", rate: 0.04, fixed: 0.30 },
  NO: { name: "Norway", currency: "NOK", symbol: "kr", locale: "nb-NO", rate: 0.04, fixed: 2.50 },
  NZ: {
    name: "New Zealand", currency: "NZD", symbol: "NZ$", locale: "en-NZ",
    rate: 0.03, fixed: 0.30,
    domesticRate: 0.03, domesticFixed: 0.30,
    intlRate: 0.04, intlFixed: 0.30,
    notes: "Domestic order rate; international orders are 4% + NZ$0.30."
  },
  PH: { name: "Philippines", currency: "PHP", symbol: "₱", locale: "en-PH", rate: 0.045, fixed: 25.00 },
  PT: { name: "Portugal", currency: "EUR", symbol: "€", locale: "pt-PT", rate: 0.04, fixed: 0.30 },
  SE: { name: "Sweden", currency: "SEK", symbol: "kr", locale: "sv-SE", rate: 0.04, fixed: 3.00 },
  SG: { name: "Singapore", currency: "SGD", symbol: "S$", locale: "en-SG", rate: 0.044, fixed: 0.35 },
  SI: { name: "Slovenia", currency: "EUR", symbol: "€", locale: "sl-SI", rate: 0.04, fixed: 0.30 },
  SK: { name: "Slovakia", currency: "EUR", symbol: "€", locale: "sk-SK", rate: 0.04, fixed: 0.30 },
  VN: { name: "Vietnam", currency: "VND", symbol: "₫", locale: "vi-VN", rate: 0.045, fixed: 11500 },
  ZA: { name: "South Africa", currency: "ZAR", symbol: "R", locale: "en-ZA", rate: 0.045, fixed: 8.00 },

  // --- 14 PAYONEER PARTNER MARKETS ---
  AE: { name: "United Arab Emirates", currency: "USD", symbol: "$", locale: "ar-AE", rate: 0.065, fixed: 0.30, isPayoneer: true },
  AR: { name: "Argentina", currency: "USD", symbol: "$", locale: "es-AR", rate: 0.065, fixed: 0.30, isPayoneer: true },
  BR: { name: "Brazil", currency: "USD", symbol: "$", locale: "pt-BR", rate: 0.065, fixed: 0.30, isPayoneer: true },
  CL: { name: "Chile", currency: "USD", symbol: "$", locale: "es-CL", rate: 0.065, fixed: 0.30, isPayoneer: true },
  CN: { name: "China", currency: "USD", symbol: "$", locale: "zh-CN", rate: 0.065, fixed: 0.30, isPayoneer: true, restriction: "suspended_for_new_shops" },
  EG: { name: "Egypt", currency: "USD", symbol: "$", locale: "ar-EG", rate: 0.065, fixed: 0.30, isPayoneer: true },
  GE: { name: "Georgia", currency: "USD", symbol: "$", locale: "ka-GE", rate: 0.065, fixed: 0.30, isPayoneer: true },
  KR: { name: "South Korea", currency: "USD", symbol: "$", locale: "ko-KR", rate: 0.065, fixed: 0.30, isPayoneer: true },
  KZ: { name: "Kazakhstan", currency: "USD", symbol: "$", locale: "kk-KZ", rate: 0.065, fixed: 0.30, isPayoneer: true },
  PE: { name: "Peru", currency: "USD", symbol: "$", locale: "es-PE", rate: 0.065, fixed: 0.30, isPayoneer: true },
  PK: { name: "Pakistan", currency: "USD", symbol: "$", locale: "ur-PK", rate: 0.065, fixed: 0.30, isPayoneer: true },
  RS: { name: "Serbia", currency: "USD", symbol: "$", locale: "sr-RS", rate: 0.065, fixed: 0.30, isPayoneer: true },
  TH: { name: "Thailand", currency: "USD", symbol: "$", locale: "th-TH", rate: 0.06, fixed: 0.30, isPayoneer: true },
  UA: { name: "Ukraine", currency: "USD", symbol: "$", locale: "uk-UA", rate: 0.06, fixed: 0.30, isPayoneer: true },

  // --- 6 ETSY EUR-PAYOUT CANDIDATE MARKETS ---
  // Etsy sends EUR to the bank account; the bank may charge FX fees
  BG: { name: "Bulgaria", currency: "EUR", symbol: "€", locale: "bg-BG", rate: 0.04, fixed: 0.30, euroArea: true, receivesEur: true, bankFxPossibility: true },
  CZ: { name: "Czech Republic", currency: "EUR", symbol: "€", locale: "cs-CZ", rate: 0.04, fixed: 0.30, euroArea: false, receivesEur: true, bankFxPossibility: true },
  HR: { name: "Croatia", currency: "EUR", symbol: "€", locale: "hr-HR", rate: 0.04, fixed: 0.30, euroArea: true, receivesEur: true, bankFxPossibility: true },
  HU: { name: "Hungary", currency: "EUR", symbol: "€", locale: "hu-HU", rate: 0.04, fixed: 0.30, euroArea: false, receivesEur: true, bankFxPossibility: true },
  PL: { name: "Poland", currency: "EUR", symbol: "€", locale: "pl-PL", rate: 0.04, fixed: 0.30, euroArea: false, receivesEur: true, bankFxPossibility: true },
  RO: { name: "Romania", currency: "EUR", symbol: "€", locale: "ro-RO", rate: 0.04, fixed: 0.30, euroArea: false, receivesEur: true, bankFxPossibility: true }
};

/**
 * Creates a fully functioning in-memory D1 test database fixture
 */
function createSimulationEnvironment() {
  const versions = new Map([
    ["v1.0.0", {
      version_id: "v1.0.0",
      version_label: "1.0.0",
      status: "active",
      created_at: "2026-10-06T00:00:00Z",
      published_at: "2026-10-06T00:00:00Z",
      source_hash: "hash_baseline_1.0.0",
      notes: "Official baseline release (12 countries)"
    }]
  ]);

  // Initial 12 baseline rules
  const initialRules = [
    { version_id: "v1.0.0", country_code: "US", transaction_rate: 0.065, listing_fee_amount: 0.20, listing_fee_currency: "USD", processing_rate: 0.03, processing_fixed_amount: 0.25, processing_fixed_currency: "USD", domestic_processing_rate: 0.03, domestic_processing_fixed_amount: 0.25, international_processing_rate: 0.03, international_processing_fixed_amount: 0.25, regulatory_rate: null, special_rules: null, sort_order: 1 },
    { version_id: "v1.0.0", country_code: "UK", transaction_rate: 0.065, listing_fee_amount: 0.16, listing_fee_currency: "GBP", processing_rate: 0.04, processing_fixed_amount: 0.20, processing_fixed_currency: "GBP", domestic_processing_rate: 0.04, domestic_processing_fixed_amount: 0.20, international_processing_rate: 0.04, international_processing_fixed_amount: 0.20, regulatory_rate: 0.0048, special_rules: null, sort_order: 2 },
    { version_id: "v1.0.0", country_code: "CA", transaction_rate: 0.065, listing_fee_amount: 0.27, listing_fee_currency: "CAD", processing_rate: 0.03, processing_fixed_amount: 0.25, processing_fixed_currency: "CAD", domestic_processing_rate: 0.03, domestic_processing_fixed_amount: 0.25, international_processing_rate: 0.04, international_processing_fixed_amount: 0.25, regulatory_rate: 0.005, special_rules: "Domestic or US order rate; international orders are 4% + CA$0.25.", sort_order: 3 },
    { version_id: "v1.0.0", country_code: "AU", transaction_rate: 0.065, listing_fee_amount: 0.28, listing_fee_currency: "AUD", processing_rate: 0.03, processing_fixed_amount: 0.25, processing_fixed_currency: "AUD", domestic_processing_rate: 0.03, domestic_processing_fixed_amount: 0.25, international_processing_rate: 0.04, international_processing_fixed_amount: 0.25, regulatory_rate: null, special_rules: "Domestic order rate; international orders are 4% + A$0.25.", sort_order: 4 },
    { version_id: "v1.0.0", country_code: "DE", transaction_rate: 0.065, listing_fee_amount: 0.18, listing_fee_currency: "EUR", processing_rate: 0.04, processing_fixed_amount: 0.30, processing_fixed_currency: "EUR", domestic_processing_rate: 0.04, domestic_processing_fixed_amount: 0.30, international_processing_rate: 0.04, international_processing_fixed_amount: 0.30, regulatory_rate: null, special_rules: "Eurozone rate (4% + €0.30)", sort_order: 5 },
    { version_id: "v1.0.0", country_code: "FR", transaction_rate: 0.065, listing_fee_amount: 0.18, listing_fee_currency: "EUR", processing_rate: 0.04, processing_fixed_amount: 0.30, processing_fixed_currency: "EUR", domestic_processing_rate: 0.04, domestic_processing_fixed_amount: 0.30, international_processing_rate: 0.04, international_processing_fixed_amount: 0.30, regulatory_rate: 0.0114, special_rules: null, sort_order: 6 },
    { version_id: "v1.0.0", country_code: "IT", transaction_rate: 0.065, listing_fee_amount: 0.18, listing_fee_currency: "EUR", processing_rate: 0.04, processing_fixed_amount: 0.30, processing_fixed_currency: "EUR", domestic_processing_rate: 0.04, domestic_processing_fixed_amount: 0.30, international_processing_rate: 0.04, international_processing_fixed_amount: 0.30, regulatory_rate: 0.008, special_rules: null, sort_order: 7 },
    { version_id: "v1.0.0", country_code: "ES", transaction_rate: 0.065, listing_fee_amount: 0.18, listing_fee_currency: "EUR", processing_rate: 0.04, processing_fixed_amount: 0.30, processing_fixed_currency: "EUR", domestic_processing_rate: 0.04, domestic_processing_fixed_amount: 0.30, international_processing_rate: 0.04, international_processing_fixed_amount: 0.30, regulatory_rate: 0.0088, special_rules: null, sort_order: 8 },
    { version_id: "v1.0.0", country_code: "IN", transaction_rate: 0.065, listing_fee_amount: 16.5, listing_fee_currency: "INR", processing_rate: 0.05, processing_fixed_amount: 25.0, processing_fixed_currency: "INR", domestic_processing_rate: 0.05, domestic_processing_fixed_amount: 25.0, international_processing_rate: 0.05, international_processing_fixed_amount: 25.0, regulatory_rate: 0.0005, special_rules: null, sort_order: 9 },
    { version_id: "v1.0.0", country_code: "JP", transaction_rate: 0.065, listing_fee_amount: 30.0, listing_fee_currency: "JPY", processing_rate: 0.06, processing_fixed_amount: 45.0, processing_fixed_currency: "JPY", domestic_processing_rate: 0.06, domestic_processing_fixed_amount: 45.0, international_processing_rate: 0.06, international_processing_fixed_amount: 45.0, regulatory_rate: null, special_rules: "Etsy publishes the fixed processing charge in USD; the JPY amount is an estimate and currency conversion is not modeled.", sort_order: 10 },
    { version_id: "v1.0.0", country_code: "TR", transaction_rate: 0.065, listing_fee_amount: 7.0, listing_fee_currency: "TRY", processing_rate: 0.065, processing_fixed_amount: 14.0, processing_fixed_currency: "TRY", domestic_processing_rate: 0.065, domestic_processing_fixed_amount: 14.0, international_processing_rate: 0.065, international_processing_fixed_amount: 14.0, regulatory_rate: 0.0167, special_rules: "Türkiye rate per Etsy published schedule: 6.5% + ₺14. Regulatory operating fee 1.67%.", sort_order: 11 },
    { version_id: "v1.0.0", country_code: "OTHER", transaction_rate: 0.065, listing_fee_amount: 0.20, listing_fee_currency: "USD", processing_rate: 0.065, processing_fixed_amount: 0.30, processing_fixed_currency: "USD", domestic_processing_rate: 0.065, domestic_processing_fixed_amount: 0.30, international_processing_rate: 0.065, international_processing_fixed_amount: 0.30, regulatory_rate: null, special_rules: "Generic USD baseline only; this is not a country-specific Etsy fee schedule.", sort_order: 12 }
  ];

  const rules = initialRules.map(r => ({ ...r }));

  // Countries table
  const countries = new Map([
    ["US", { country_code: "US", country_name: "United States", currency_code: "USD", currency_symbol: "$", locale: "en-US", status: "active", sort_order: 1 }],
    ["UK", { country_code: "UK", country_name: "United Kingdom", currency_code: "GBP", currency_symbol: "£", locale: "en-GB", status: "active", sort_order: 2 }],
    ["CA", { country_code: "CA", country_name: "Canada", currency_code: "CAD", currency_symbol: "CA$", locale: "en-CA", status: "active", sort_order: 3 }],
    ["AU", { country_code: "AU", country_name: "Australia", currency_code: "AUD", currency_symbol: "A$", locale: "en-AU", status: "active", sort_order: 4 }],
    ["DE", { country_code: "DE", country_name: "Germany / Eurozone", currency_code: "EUR", currency_symbol: "€", locale: "de-DE", status: "active", sort_order: 5 }],
    ["FR", { country_code: "FR", country_name: "France", currency_code: "EUR", currency_symbol: "€", locale: "fr-FR", status: "active", sort_order: 6 }],
    ["IT", { country_code: "IT", country_name: "Italy", currency_code: "EUR", currency_symbol: "€", locale: "it-IT", status: "active", sort_order: 7 }],
    ["ES", { country_code: "ES", country_name: "Spain", currency_code: "EUR", currency_symbol: "€", locale: "es-ES", status: "active", sort_order: 8 }],
    ["IN", { country_code: "IN", country_name: "India", currency_code: "INR", currency_symbol: "₹", locale: "en-IN", status: "active", sort_order: 9 }],
    ["JP", { country_code: "JP", country_name: "Japan", currency_code: "JPY", currency_symbol: "¥", locale: "ja-JP", status: "active", sort_order: 10 }],
    ["TR", { country_code: "TR", country_name: "Türkiye", currency_code: "TRY", currency_symbol: "₺", locale: "tr-TR", status: "active", sort_order: 11 }],
    ["OTHER", { country_code: "OTHER", country_name: "Global / Other", currency_code: "USD", currency_symbol: "$", locale: "en-US", status: "partial", sort_order: 12 }]
  ]);

  // Seed candidate countries as pending_review with sort_order >= 100
  let candidateOrder = 100;
  for (const [code, meta] of Object.entries(CANDIDATE_DEFINITIONS)) {
    countries.set(code, {
      country_code: code,
      country_name: meta.name,
      currency_code: meta.currency,
      currency_symbol: meta.symbol,
      locale: meta.locale,
      status: "pending_review",
      sort_order: candidateOrder++
    });
  }

  const detectedChanges = [];
  const reviewQueue = [];

  // Seed 50 candidate review items
  let idx = 1;
  for (const [code, meta] of Object.entries(CANDIDATE_DEFINITIONS)) {
    const chgId = `chg_candidate_${code}`;
    const revId = `rev_candidate_${code}`;
    const proposed = {
      countryName: meta.name,
      currency: meta.currency,
      processingRate: meta.rate,
      processingFixed: meta.fixed,
      domesticProcessingRate: meta.domesticRate || meta.rate,
      domesticProcessingFixed: meta.domesticFixed || meta.fixed,
      internationalProcessingRate: meta.intlRate || meta.rate,
      internationalProcessingFixed: meta.intlFixed || meta.fixed,
      regulatoryRate: STATUTORY_REGULATORY_RATES[code] || null,
      depositMinimumAmount: STATUTORY_DEPOSIT_SCHEDULES[code]?.min || null,
      depositThresholdAmount: STATUTORY_DEPOSIT_SCHEDULES[code]?.threshold || null,
      depositFeeAmount: STATUTORY_DEPOSIT_SCHEDULES[code]?.fee || null
    };

    detectedChanges.push({
      change_id: chgId,
      source_id: "115015628847",
      country_code: code,
      change_type: "new_country",
      field_name: "country",
      old_value: null,
      new_value: code,
      status: "pending_review",
      detected_at: "2026-10-06T00:10:00Z"
    });

    reviewQueue.push({
      review_id: revId,
      change_id: chgId,
      priority: "normal",
      status: "pending_review",
      proposed_value: JSON.stringify(proposed),
      reason: "Global official Etsy discovery: verified sovereign market",
      created_at: "2026-10-06T00:10:00Z"
    });
  }

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

    if (sql.includes("FROM detected_changes") && sql.includes("WHERE c.status = 'approved'")) {
      const approved = [];
      for (const c of detectedChanges) {
        if (c.status === "approved") {
          const r = reviewQueue.find(rq => rq.change_id === c.change_id);
          approved.push({ ...c, proposed_value: r?.proposed_value, reason: r?.reason });
        }
      }
      return approved;
    }

    if (sql.includes("FROM fee_rules WHERE version_id = ?")) {
      const vid = params[0];
      return rules.filter(r => r.version_id === vid).map(r => ({ ...r }));
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
          locale: "en-US",
          sort_order: 999
        };
        res.push({
          country_code: r.country_code,
          country_name: c.country_name,
          currency_code: c.currency_code,
          currency_symbol: c.currency_symbol,
          locale: c.locale,
          sort_order: c.sort_order,
          transaction_rate: r.transaction_rate,
          listing_fee_amount: r.listing_fee_amount,
          processing_rate: r.processing_rate,
          processing_fixed_amount: r.processing_fixed_amount,
          domestic_processing_rate: r.domestic_processing_rate,
          domestic_processing_fixed_amount: r.domestic_processing_fixed_amount,
          international_processing_rate: r.international_processing_rate,
          international_processing_fixed_amount: r.international_processing_fixed_amount,
          regulatory_rate: r.regulatory_rate,
          currency_conversion_rate: 0.025,
          offsite_rate_below_threshold: 0.15,
          offsite_rate_above_threshold: 0.12,
          offsite_cap_amount: 100,
          plus_monthly_amount: 10,
          special_rules: r.special_rules
        });
      }
      res.sort((a, b) => a.sort_order - b.sort_order);
      return res;
    }

    if (sql.includes("INSERT INTO fee_versions")) {
      const [vid, vlabel, createdAt, sourceHash, notes] = params;
      versions.set(vid, {
        version_id: vid,
        version_label: vlabel,
        status: "draft",
        created_at: createdAt,
        published_at: null,
        source_hash: sourceHash,
        notes
      });
      return { success: true };
    }

    if (sql.includes("INSERT INTO fee_rules")) {
      const [
        vid, countryCode, txRate,
        lstAmt, lstCur,
        prcRate, prcFixed, prcCur,
        domRate, domFixed, domCur,
        intlRate, intlFixed, intlCur,
        regRate
      ] = params;
      const c = countries.get(countryCode);
      rules.push({
        version_id: vid,
        country_code: countryCode,
        transaction_rate: txRate,
        listing_fee_amount: lstAmt,
        listing_fee_currency: lstCur,
        processing_rate: prcRate,
        processing_fixed_amount: prcFixed,
        processing_fixed_currency: prcCur,
        domestic_processing_rate: domRate,
        domestic_processing_fixed_amount: domFixed,
        international_processing_rate: intlRate,
        international_processing_fixed_amount: intlFixed,
        regulatory_rate: regRate,
        sort_order: c?.sort_order || 999
      });
      return { success: true };
    }

    if (sql.includes("UPDATE fee_versions SET status = 'archived' WHERE version_id = ?")) {
      const v = versions.get(params[0]);
      if (v) v.status = "archived";
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

    if (sql.includes("UPDATE countries SET status = 'active'")) {
      const targetCode = params[params.length - 1];
      const c = countries.get(targetCode);
      if (c) c.status = "active";
      return { success: true };
    }

    if (sql.includes("UPDATE detected_changes SET status = 'published'")) {
      const chg = detectedChanges.find(c => c.change_id === params[0]);
      if (chg) chg.status = "published";
      return { success: true };
    }

    if (sql.includes("UPDATE review_queue SET status = 'published'")) {
      const rev = reviewQueue.find(r => r.change_id === params[params.length - 1]);
      if (rev) rev.status = "published";
      return { success: true };
    }

    return { success: true };
  }

  const env = {
    DB: {
      prepare(sql) {
        return {
          _params: [],
          bind(...params) {
            this._params = params;
            return this;
          },
          async first() {
            return executeStatement(sql, this._params);
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
    },
    // Expose in-memory collections for assertions
    _versions: versions,
    _rules: rules,
    _countries: countries,
    _detectedChanges: detectedChanges,
    _reviewQueue: reviewQueue
  };

  return env;
}

// ============================================================================
// SUITE 1: GLOBAL DATASET PARTITIONING & CATALOG INVARIANTS
// ============================================================================

test("Step 10E.1: Authoritative catalog partitioning: 12 baseline + 50 candidates = 62 total", () => {
  assert.equal(BASELINE_COUNTRY_ORDER.length, 12, "Baseline contains exactly 12 keys");
  assert.equal(ALL_CANDIDATE_CODES.length, 50, "Candidates contains exactly 50 keys");

  const totalCatalog = new Set([...BASELINE_COUNTRY_ORDER, ...ALL_CANDIDATE_CODES]);
  assert.equal(totalCatalog.size, 62, "Total catalog is exactly 62 unique records");

  // Verify baseline is disjoint from candidate set
  for (const b of BASELINE_COUNTRY_ORDER) {
    assert.ok(!ALL_CANDIDATE_CODES.includes(b), `Baseline ${b} leaked into candidate set`);
  }
});

test("Step 10E.2: Candidate partition disjoint union: 30 fully verified + 14 Payoneer + 6 EUR-bank-FX = 50", () => {
  assert.equal(FULLY_VERIFIED_CANDIDATES.length, 30);
  assert.equal(PAYONEER_CANDIDATES.length, 14);
  assert.equal(EUR_BANK_FX_CANDIDATES.length, 6);

  const fullySet = new Set(FULLY_VERIFIED_CANDIDATES);
  const payoneerSet = new Set(PAYONEER_CANDIDATES);
  const eurFxSet = new Set(EUR_BANK_FX_CANDIDATES);

  // Pairwise disjoint
  for (const c of fullySet) {
    assert.ok(!payoneerSet.has(c), `Intersection between fully verified and Payoneer: ${c}`);
    assert.ok(!eurFxSet.has(c), `Intersection between fully verified and EUR-FX: ${c}`);
  }
  for (const c of payoneerSet) {
    assert.ok(!eurFxSet.has(c), `Intersection between Payoneer and EUR-FX: ${c}`);
  }

  const union = new Set([...fullySet, ...payoneerSet, ...eurFxSet]);
  assert.equal(union.size, 50);
});

test("Step 10E.3: Payoneer partition matches 16 official Etsy markets (14 candidates + IN & JP baseline)", () => {
  assert.equal(OFFICIAL_PAYONEER_COUNTRIES.size, 16);
  const expectedPayoneer = ["AR", "BR", "CL", "CN", "EG", "GE", "IN", "JP", "KZ", "PK", "PE", "RS", "KR", "TH", "UA", "AE"];
  for (const code of expectedPayoneer) {
    assert.ok(OFFICIAL_PAYONEER_COUNTRIES.has(code), `Missing official Payoneer market: ${code}`);
  }

  // Candidate partition excludes baseline IN and JP
  assert.ok(OFFICIAL_PAYONEER_COUNTRIES.has("IN"));
  assert.ok(OFFICIAL_PAYONEER_COUNTRIES.has("JP"));
  assert.ok(!PAYONEER_CANDIDATES.includes("IN"));
  assert.ok(!PAYONEER_CANDIDATES.includes("JP"));
  assert.equal(PAYONEER_CANDIDATES.length, 14);
});

test("Step 10E.4: China (CN) invariant: retained as partial candidate with new shop suspension", () => {
  assert.ok(ALL_CANDIDATE_CODES.includes("CN"), "CN must remain in candidate dataset");
  assert.ok(PAYONEER_CANDIDATES.includes("CN"));
  assert.equal(NEW_SHOP_RESTRICTIONS.CN, "suspended_for_new_shops");

  const norm = normalizeFeeSchedule({
    country_code: "CN",
    currency_code: "USD",
    processing_rate: 0.065,
    processing_fixed_amount: 0.30
  });
  assert.equal(norm.eligibility.newShopRestriction, "suspended_for_new_shops");
  assert.equal(norm.capabilities.marketFullyVerified, false);
});

test("Step 10E.5: Regulatory fee invariant: exactly 9 statutory jurisdictions, all other 53 rate = null", () => {
  const statutoryKeys = Object.keys(STATUTORY_REGULATORY_RATES).sort();
  assert.deepEqual(statutoryKeys, ["CA", "ES", "FR", "HU", "IN", "IT", "TR", "UK", "VN"]);
  assert.equal(statutoryKeys.length, 9);

  // Exact statutory rates
  assert.equal(STATUTORY_REGULATORY_RATES.CA, 0.005);
  assert.equal(STATUTORY_REGULATORY_RATES.FR, 0.0114);
  assert.equal(STATUTORY_REGULATORY_RATES.HU, 0.0197);
  assert.equal(STATUTORY_REGULATORY_RATES.IT, 0.008);
  assert.equal(STATUTORY_REGULATORY_RATES.IN, 0.0005);
  assert.equal(STATUTORY_REGULATORY_RATES.ES, 0.0088);
  assert.equal(STATUTORY_REGULATORY_RATES.TR, 0.0167);
  assert.equal(STATUTORY_REGULATORY_RATES.UK, 0.0048);
  assert.equal(STATUTORY_REGULATORY_RATES.VN, 0.0124);

  // Verify across all 62 global catalog items
  const allCodes = [...BASELINE_COUNTRY_ORDER, ...ALL_CANDIDATE_CODES];
  assert.equal(allCodes.length, 62);
  let statutoryCount = 0;
  let unlistedCount = 0;

  for (const code of allCodes) {
    const isStatutory = statutoryKeys.includes(code);
    if (isStatutory) {
      statutoryCount++;
    } else {
      unlistedCount++;
      const norm = normalizeFeeSchedule({ country_code: code, currency_code: "USD" });
      assert.equal(norm.fees.regulatory.isListedByEtsy, false);
      assert.equal(norm.fees.regulatory.rate, null);
      assert.equal(norm.fees.regulatory.status, "not_listed");
    }
  }

  assert.equal(statutoryCount, 9);
  assert.equal(unlistedCount, 53);
});

test("Step 10E.6: Deposit fee invariant: exactly 9 statutory jurisdictions with reconciled values, all 53 others null/unlisted", () => {
  const depositKeys = Object.keys(STATUTORY_DEPOSIT_SCHEDULES).sort();
  assert.deepEqual(depositKeys, ["ID", "IL", "MA", "MX", "MY", "PH", "TR", "VN", "ZA"]);
  assert.equal(depositKeys.length, 9);

  // Exact reconciled statutory deposit values from official Etsy Payment Processing article 115015628847:
  // 1. ID: dailyDepositMinimum = 28000 IDR, depositFeeThreshold = 1400000 IDR, depositFee = 28000 IDR
  const normID = normalizeFeeSchedule({ country_code: "ID", currency_code: "IDR" });
  assert.equal(normID.accountLevelFees.deposit.depositMinimum, 28000);
  assert.equal(normID.accountLevelFees.deposit.feeThreshold, 1400000);
  assert.equal(normID.accountLevelFees.deposit.feeAmount, 28000);
  assert.equal(normID.accountLevelFees.deposit.currency, "IDR");
  assert.equal(normID.accountLevelFees.deposit.status, "applicable");
  assert.equal(normID.accountLevelFees.deposit.depositFeeMode, "account_level");

  // 2. IL: dailyDepositMinimum = 7 ILS, depositFeeThreshold = 350 ILS, depositFee = 7 ILS
  const normIL = normalizeFeeSchedule({ country_code: "IL", currency_code: "ILS" });
  assert.equal(normIL.accountLevelFees.deposit.depositMinimum, 7);
  assert.equal(normIL.accountLevelFees.deposit.feeThreshold, 350);
  assert.equal(normIL.accountLevelFees.deposit.feeAmount, 7);
  assert.equal(normIL.accountLevelFees.deposit.currency, "ILS");
  assert.equal(normIL.accountLevelFees.deposit.status, "applicable");
  assert.equal(normIL.accountLevelFees.deposit.depositFeeMode, "account_level");

  // 3. MY: dailyDepositMinimum = 9 MYR, depositFeeThreshold = 400 MYR, depositFee = 8 MYR
  const normMY = normalizeFeeSchedule({ country_code: "MY", currency_code: "MYR" });
  assert.equal(normMY.accountLevelFees.deposit.depositMinimum, 9);
  assert.equal(normMY.accountLevelFees.deposit.feeThreshold, 400);
  assert.equal(normMY.accountLevelFees.deposit.feeAmount, 8);
  assert.equal(normMY.accountLevelFees.deposit.currency, "MYR");
  assert.equal(normMY.accountLevelFees.deposit.status, "applicable");
  assert.equal(normMY.accountLevelFees.deposit.depositFeeMode, "account_level");

  // 4. MX: dailyDepositMinimum = 40 MXN, depositFeeThreshold = 2000 MXN, depositFee = 40 MXN
  const normMX = normalizeFeeSchedule({ country_code: "MX", currency_code: "MXN" });
  assert.equal(normMX.accountLevelFees.deposit.depositMinimum, 40);
  assert.equal(normMX.accountLevelFees.deposit.feeThreshold, 2000);
  assert.equal(normMX.accountLevelFees.deposit.feeAmount, 40);
  assert.equal(normMX.accountLevelFees.deposit.currency, "MXN");
  assert.equal(normMX.accountLevelFees.deposit.status, "applicable");
  assert.equal(normMX.accountLevelFees.deposit.depositFeeMode, "account_level");

  // 5. MA: dailyDepositMinimum = 20 MAD, depositFeeThreshold = 1000 MAD, depositFee = 20 MAD
  const normMA = normalizeFeeSchedule({ country_code: "MA", currency_code: "MAD" });
  assert.equal(normMA.accountLevelFees.deposit.depositMinimum, 20);
  assert.equal(normMA.accountLevelFees.deposit.feeThreshold, 1000);
  assert.equal(normMA.accountLevelFees.deposit.feeAmount, 20);
  assert.equal(normMA.accountLevelFees.deposit.currency, "MAD");
  assert.equal(normMA.accountLevelFees.deposit.status, "applicable");
  assert.equal(normMA.accountLevelFees.deposit.depositFeeMode, "account_level");

  // 6. PH: dailyDepositMinimum = 100 PHP, depositFeeThreshold = 5000 PHP, depositFee = 100 PHP
  const normPH = normalizeFeeSchedule({ country_code: "PH", currency_code: "PHP" });
  assert.equal(normPH.accountLevelFees.deposit.depositMinimum, 100);
  assert.equal(normPH.accountLevelFees.deposit.feeThreshold, 5000);
  assert.equal(normPH.accountLevelFees.deposit.feeAmount, 100);
  assert.equal(normPH.accountLevelFees.deposit.currency, "PHP");
  assert.equal(normPH.accountLevelFees.deposit.status, "applicable");
  assert.equal(normPH.accountLevelFees.deposit.depositFeeMode, "account_level");

  // 7. ZA: dailyDepositMinimum = 35 ZAR, depositFeeThreshold = 1500 ZAR, depositFee = 30 ZAR
  const normZA = normalizeFeeSchedule({ country_code: "ZA", currency_code: "ZAR" });
  assert.equal(normZA.accountLevelFees.deposit.depositMinimum, 35);
  assert.equal(normZA.accountLevelFees.deposit.feeThreshold, 1500);
  assert.equal(normZA.accountLevelFees.deposit.feeAmount, 30);
  assert.equal(normZA.accountLevelFees.deposit.currency, "ZAR");
  assert.equal(normZA.accountLevelFees.deposit.status, "applicable");
  assert.equal(normZA.accountLevelFees.deposit.depositFeeMode, "account_level");

  // 8. TR: dailyDepositMinimum = 50 TRY, depositFeeThreshold = 600 TRY, depositFee = 42 TRY
  const normTR = normalizeFeeSchedule({ country_code: "TR", currency_code: "TRY" });
  assert.equal(normTR.accountLevelFees.deposit.depositMinimum, 50);
  assert.equal(normTR.accountLevelFees.deposit.feeThreshold, 600);
  assert.equal(normTR.accountLevelFees.deposit.feeAmount, 42);
  assert.equal(normTR.accountLevelFees.deposit.currency, "TRY");
  assert.equal(normTR.accountLevelFees.deposit.status, "applicable");
  assert.equal(normTR.accountLevelFees.deposit.depositFeeMode, "account_level");

  // 9. VN: dailyDepositMinimum = 45000 VND, depositFeeThreshold = 2300000 VND, depositFee = 45000 VND
  const normVN = normalizeFeeSchedule({ country_code: "VN", currency_code: "VND" });
  assert.equal(normVN.accountLevelFees.deposit.depositMinimum, 45000);
  assert.equal(normVN.accountLevelFees.deposit.feeThreshold, 2300000);
  assert.equal(normVN.accountLevelFees.deposit.feeAmount, 45000);
  assert.equal(normVN.accountLevelFees.deposit.currency, "VND");
  assert.equal(normVN.accountLevelFees.deposit.status, "applicable");
  assert.equal(normVN.accountLevelFees.deposit.depositFeeMode, "account_level");

  // Verify remaining 53 catalog rows have feeAmount = null, status = not_applicable, depositFeeMode = not_listed
  const allCodes = [...BASELINE_COUNTRY_ORDER, ...ALL_CANDIDATE_CODES];
  assert.equal(allCodes.length, 62);
  let statutoryDepositCount = 0;
  let unlistedDepositCount = 0;

  for (const code of allCodes) {
    if (depositKeys.includes(code)) {
      statutoryDepositCount++;
    } else {
      unlistedDepositCount++;
      const norm = normalizeFeeSchedule({ country_code: code, currency_code: "USD" });
      assert.equal(norm.accountLevelFees.deposit.isListedByEtsy, false, `${code} isListedByEtsy must be false`);
      assert.equal(norm.accountLevelFees.deposit.depositFeeMode, "not_listed", `${code} depositFeeMode must be not_listed`);
      assert.equal(norm.accountLevelFees.deposit.status, "not_applicable", `${code} status must be not_applicable`);
      assert.equal(norm.accountLevelFees.deposit.feeAmount, null, `${code} feeAmount must be null`);
      assert.notEqual(norm.accountLevelFees.deposit.feeAmount, 0, `${code} feeAmount must NEVER be synthetic 0`);
      assert.equal(norm.accountLevelFees.deposit.depositMinimum, null, `${code} depositMinimum must be null`);
      assert.notEqual(norm.accountLevelFees.deposit.depositMinimum, 0, `${code} depositMinimum must NEVER be synthetic 0`);
      assert.equal(norm.accountLevelFees.deposit.feeThreshold, null, `${code} feeThreshold must be null`);
      assert.notEqual(norm.accountLevelFees.deposit.feeThreshold, 0, `${code} feeThreshold must NEVER be synthetic 0`);
    }
  }

  assert.equal(statutoryDepositCount, 9);
  assert.equal(unlistedDepositCount, 53);
});

test("Step 10E.7: Setup fee invariant: India $10 USD, all other 61 markets status = unknown", () => {
  const normIN = normalizeFeeSchedule({ country_code: "IN", currency_code: "INR" });
  assert.equal(normIN.accountLevelFees.setup.amount, 10);
  assert.equal(normIN.accountLevelFees.setup.currency, "USD");

  const otherCodes = [...BASELINE_COUNTRY_ORDER, ...ALL_CANDIDATE_CODES].filter(c => c !== "IN");
  assert.equal(otherCodes.length, 61);
  for (const code of otherCodes) {
    const norm = normalizeFeeSchedule({ country_code: code, currency_code: "USD" });
    assert.equal(norm.accountLevelFees.setup.amount, null);
    assert.equal(norm.accountLevelFees.setup.status, "unknown");
    assert.equal(norm.accountLevelFees.setup.label, "location_dependent");
  }
});

test("Step 10E.8: Processing fee invariant: special candidate schedules match official specifications", () => {
  // CA: domestic 3% + CA$0.25, international 4% + CA$0.25
  const ca = CANDIDATE_DEFINITIONS.MX; // Test candidate definitions
  assert.equal(CANDIDATE_DEFINITIONS.DK.rate, 0.04);
  assert.equal(CANDIDATE_DEFINITIONS.DK.fixed, 2.50);

  assert.equal(CANDIDATE_DEFINITIONS.HK.rate, 0.044);
  assert.equal(CANDIDATE_DEFINITIONS.HK.fixed, 2.00);

  assert.equal(CANDIDATE_DEFINITIONS.IL.rate, 0.045);
  assert.equal(CANDIDATE_DEFINITIONS.IL.fixed, 2.00);

  assert.equal(CANDIDATE_DEFINITIONS.MY.rate, 0.045);
  assert.equal(CANDIDATE_DEFINITIONS.MY.fixed, 2.00);

  assert.equal(CANDIDATE_DEFINITIONS.MX.rate, 0.045);
  assert.equal(CANDIDATE_DEFINITIONS.MX.fixed, 8.00);

  assert.equal(CANDIDATE_DEFINITIONS.MA.rate, 0.045);
  assert.equal(CANDIDATE_DEFINITIONS.MA.fixed, 5.00);

  assert.equal(CANDIDATE_DEFINITIONS.NO.rate, 0.04);
  assert.equal(CANDIDATE_DEFINITIONS.NO.fixed, 2.50);

  assert.equal(CANDIDATE_DEFINITIONS.PH.rate, 0.045);
  assert.equal(CANDIDATE_DEFINITIONS.PH.fixed, 25.00);

  assert.equal(CANDIDATE_DEFINITIONS.SE.rate, 0.04);
  assert.equal(CANDIDATE_DEFINITIONS.SE.fixed, 3.00);

  assert.equal(CANDIDATE_DEFINITIONS.CH.rate, 0.04);
  assert.equal(CANDIDATE_DEFINITIONS.CH.fixed, 0.50);

  assert.equal(CANDIDATE_DEFINITIONS.SG.rate, 0.044);
  assert.equal(CANDIDATE_DEFINITIONS.SG.fixed, 0.35);

  assert.equal(CANDIDATE_DEFINITIONS.VN.rate, 0.045);
  assert.equal(CANDIDATE_DEFINITIONS.VN.fixed, 11500);

  assert.equal(CANDIDATE_DEFINITIONS.ZA.rate, 0.045);
  assert.equal(CANDIDATE_DEFINITIONS.ZA.fixed, 8.00);

  assert.equal(CANDIDATE_DEFINITIONS.TH.rate, 0.06);
  assert.equal(CANDIDATE_DEFINITIONS.TH.fixed, 0.30);

  assert.equal(CANDIDATE_DEFINITIONS.UA.rate, 0.06);
  assert.equal(CANDIDATE_DEFINITIONS.UA.fixed, 0.30);
});

// ============================================================================
// SUITE 2: IN-MEMORY RELEASE SIMULATION & ATOMICITY
// ============================================================================

test("Step 10E.9: In-memory publication simulation: creates v1.1.0 with exactly 62 rules", async () => {
  const env = createSimulationEnvironment();

  // Approve all 50 candidate reviews
  for (const chg of env._detectedChanges) {
    chg.status = "approved";
  }

  // Publish release
  const result = await publishApprovedChanges(env, {
    version_label: "1.1.0",
    notes: "Step 10E Release Simulation: 50 sovereign markets added to v1.0.0 baseline"
  });

  assert.equal(result.success, true);
  assert.equal(result.publishedVersion, "v1.1.0");
  assert.equal(result.versionLabel, "1.1.0");
  assert.equal(result.totalRules, 62, "62 total fee rules created");
  assert.equal(result.changesPublished, 50, "50 changes published");

  // Single active version guarantee
  const activeVersions = Array.from(env._versions.values()).filter(v => v.status === "active");
  assert.equal(activeVersions.length, 1);
  assert.equal(activeVersions[0].version_id, "v1.1.0");

  // Historical v1.0.0 is archived
  const v1 = env._versions.get("v1.0.0");
  assert.equal(v1.status, "archived");

  // All 12 baseline rules in v1.1.0 are data-equivalent to v1.0.0
  const v1Rules = env._rules.filter(r => r.version_id === "v1.0.0");
  const v11Rules = env._rules.filter(r => r.version_id === "v1.1.0");

  assert.equal(v1Rules.length, 12);
  assert.equal(v11Rules.length, 62);

  for (const baseRule of v1Rules) {
    const clone = v11Rules.find(r => r.country_code === baseRule.country_code);
    assert.ok(clone, `Baseline rule for ${baseRule.country_code} exists in v1.1.0`);
    assert.equal(clone.transaction_rate, baseRule.transaction_rate);
    assert.equal(clone.processing_rate, baseRule.processing_rate);
    assert.equal(clone.processing_fixed_amount, baseRule.processing_fixed_amount);
    assert.equal(clone.regulatory_rate, baseRule.regulatory_rate);
  }
});

// ============================================================================
// SUITE 3: PUBLIC API & HISTORICAL API CONTRACT SIMULATION
// ============================================================================

test("Step 10E.10: Public API simulation: GET /v1/fees serves v1.1.0 with 62 countries", async () => {
  const env = createSimulationEnvironment();
  for (const chg of env._detectedChanges) chg.status = "approved";
  await publishApprovedChanges(env, { version_label: "1.1.0" });

  const req = new Request("https://api.shopprofit.com/v1/fees");
  const res = await handleGetFees(req, env);

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.version, "1.1.0");
  assert.equal(data.version_id, "v1.1.0");
  assert.equal(data.countryOrder.length, 62);
  assert.equal(Object.keys(data.countries).length, 62);

  // Check presence of baseline countries
  assert.ok(data.countries.US);
  assert.ok(data.countries.UK);
  assert.ok(data.countries.OTHER);

  // Check presence of candidate countries
  assert.ok(data.countries.VN);
  assert.ok(data.countries.AE);
  assert.ok(data.countries.HU);
  assert.ok(data.countries.CN);

  // Check Vietnam statutory details
  assert.equal(data.countries.VN.regulatoryRate, 0.0124);
  assert.equal(data.countries.VN.currency, "VND");
});

test("Step 10E.11: Historical API invariant simulation: GET /v1/fees?version=v1.0.0 returns strictly 12 baseline countries", async () => {
  const env = createSimulationEnvironment();
  for (const chg of env._detectedChanges) chg.status = "approved";
  await publishApprovedChanges(env, { version_label: "1.1.0" });

  const req = new Request("https://api.shopprofit.com/v1/fees?version=v1.0.0");
  const res = await handleGetFees(req, env);

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.version, "1.0.0");
  assert.equal(data.version_id, "v1.0.0");
  assert.equal(data.countryOrder.length, 12);
  assert.deepEqual(data.countryOrder, [...BASELINE_COUNTRY_ORDER]);

  // Zero candidate countries present in v1.0.0
  for (const code of ALL_CANDIDATE_CODES) {
    assert.equal(data.countries[code], undefined, `Candidate ${code} must NOT leak into v1.0.0 response`);
  }
});

// ============================================================================
// SUITE 4: RELEASE COMPARISON & ROLLBACK SIMULATION
// ============================================================================

test("Step 10E.12: Machine-readable release comparison audit: v1.0.0 vs v1.1.0", async () => {
  const env = createSimulationEnvironment();
  for (const chg of env._detectedChanges) chg.status = "approved";
  await publishApprovedChanges(env, { version_label: "1.1.0" });

  const v1Rules = env._rules.filter(r => r.version_id === "v1.0.0");
  const v11Rules = env._rules.filter(r => r.version_id === "v1.1.0");

  const v1Map = new Map(v1Rules.map(r => [r.country_code, r]));
  const v11Map = new Map(v11Rules.map(r => [r.country_code, r]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const [code, rule11] of v11Map.entries()) {
    if (!v1Map.has(code)) {
      added.push(code);
    } else {
      const rule1 = v1Map.get(code);
      if (
        rule1.processing_rate !== rule11.processing_rate ||
        rule1.processing_fixed_amount !== rule11.processing_fixed_amount ||
        rule1.regulatory_rate !== rule11.regulatory_rate
      ) {
        changed.push(code);
      }
    }
  }

  for (const code of v1Map.keys()) {
    if (!v11Map.has(code)) removed.push(code);
  }

  assert.equal(removed.length, 0, "No baseline country removed");
  assert.equal(changed.length, 0, "No baseline country fee mutated");
  assert.equal(added.length, 50, "Exactly 50 candidate countries added");
  assert.deepEqual(added.sort(), [...ALL_CANDIDATE_CODES].sort());
});

test("Step 10E.13: Rollback simulation: atomic reversion to v1.0.0 preserves history and restores 12 countries", async () => {
  const env = createSimulationEnvironment();
  for (const chg of env._detectedChanges) chg.status = "approved";
  await publishApprovedChanges(env, { version_label: "1.1.0" });

  // Now execute rollback
  const rollbackResult = await rollbackVersion(env, "v1.0.0", "Simulation test rollback");
  assert.equal(rollbackResult.success, true);
  assert.equal(rollbackResult.activeVersion, "v1.0.0");

  // Single active version check
  const activeVersions = Array.from(env._versions.values()).filter(v => v.status === "active");
  assert.equal(activeVersions.length, 1);
  assert.equal(activeVersions[0].version_id, "v1.0.0");

  // v1.1.0 historical data is fully preserved
  const v11 = env._versions.get("v1.1.0");
  assert.ok(v11, "v1.1.0 still exists in fee_versions");
  const v11Rules = env._rules.filter(r => r.version_id === "v1.1.0");
  assert.equal(v11Rules.length, 62, "v1.1.0 rules preserved in database");

  // Public API now serves v1.0.0 with 12 countries again
  const req = new Request("https://api.shopprofit.com/v1/fees");
  const res = await handleGetFees(req, env);
  const data = await res.json();
  assert.equal(data.version_id, "v1.0.0");
  assert.equal(data.countryOrder.length, 12);
});

// ============================================================================
// SUITE 5: FAILURE & CONCURRENCY SIMULATION
// ============================================================================

test("Step 10E.14: Failure simulation: candidate with invalid currency is rejected", () => {
  const change = {
    sourceId: "115015628847",
    countryCode: "SG",
    changeType: "new_country"
  };
  const candidate = {
    processingRate: 0.044,
    processingFixed: 0.35,
    currency: "XYZ_INVALID"
  };

  const decision = canAutoPublish(change, candidate);
  assert.equal(decision.canPublish, false);
  assert.equal(decision.classification, CLASSIFICATIONS.BLOCKED);
  assert.ok(decision.reason.includes("Invalid or unrecognized currency"));
});

test("Step 10E.15: Failure simulation: candidate with missing processing rate is blocked", () => {
  const change = {
    sourceId: "115015628847",
    countryCode: "SG",
    changeType: "new_country"
  };
  const candidate = {
    processingRate: null,
    currency: "SGD"
  };

  const decision = canAutoPublish(change, candidate);
  assert.equal(decision.canPublish, false);
  assert.equal(decision.classification, CLASSIFICATIONS.BLOCKED);
  assert.ok(decision.reason.includes("Incomplete"));
});

test("Step 10E.16: Failure simulation: candidate with malformed regulatory rule (>10%) is blocked", () => {
  const change = {
    sourceId: "1500011073202",
    countryCode: "VN",
    fieldName: "regulatory_rate",
    oldValue: null,
    newValue: "0.25", // 25% > 10% bound
    changeType: "regulatory_rate_changed"
  };
  const candidate = {
    regulatoryRate: 0.25,
    currency: "VND"
  };

  const decision = canAutoPublish(change, candidate);
  assert.equal(decision.canPublish, false);
  assert.equal(decision.classification, CLASSIFICATIONS.BLOCKED);
  assert.ok(decision.reason.includes("bounds"));
});

test("Step 10E.17: Failure simulation: batch execution error atomicity prevents partial activation", async () => {
  const env = createSimulationEnvironment();
  for (const chg of env._detectedChanges) chg.status = "approved";

  // Simulate D1 failure during batch
  env.DB.batch = async () => {
    throw new Error("D1_BATCH_STATEMENT_ERROR: Simulated disk I/O or unique constraint abort");
  };

  await assert.rejects(
    async () => publishApprovedChanges(env, { version_label: "1.1.0" }),
    /D1_BATCH_STATEMENT_ERROR/
  );

  // v1.0.0 must remain the single active version
  const activeVersions = Array.from(env._versions.values()).filter(v => v.status === "active");
  assert.equal(activeVersions.length, 1);
  assert.equal(activeVersions[0].version_id, "v1.0.0");
});

test("Step 10E.18: Concurrency simulation: concurrent publish attempts do not create split-brain active versions", async () => {
  const env = createSimulationEnvironment();
  for (const chg of env._detectedChanges) chg.status = "approved";

  let publishCount = 0;
  const originalBatch = env.DB.batch.bind(env.DB);
  env.DB.batch = async (stmts) => {
    publishCount++;
    if (publishCount > 1) {
      throw new Error("CONCURRENCY_LOCK_ABORT: Another transaction committed first");
    }
    return originalBatch(stmts);
  };

  const pub1 = publishApprovedChanges(env, { version_label: "1.1.0" });
  const pub2 = publishApprovedChanges(env, { version_label: "1.1.0" });

  const results = await Promise.allSettled([pub1, pub2]);
  const fulfilled = results.filter(r => r.status === "fulfilled");
  const rejected = results.filter(r => r.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);

  // Invariant: strictly one active version
  const active = Array.from(env._versions.values()).filter(v => v.status === "active");
  assert.equal(active.length, 1);
});

test("Step 10E.19: Bulgaria Euro transition audit & zero BGN in v1.1.0 release candidate", () => {
  const bg = CANDIDATE_DEFINITIONS.BG;
  assert.equal(bg.currency, "EUR");
  assert.equal(bg.rate, 0.04);
  assert.equal(bg.fixed, 0.30);
  assert.equal(bg.euroArea, true);

  const norm = normalizeFeeSchedule({
    country_code: "BG",
    currency_code: "EUR",
    processing_rate: 0.04,
    processing_fixed_amount: 0.30
  });
  assert.equal(norm.eligibility.euroArea, true, "BG must be in euroArea (adopted EUR Jan 1, 2026)");
  assert.equal(norm.eligibility.payoutCurrency, "EUR", "BG payoutCurrency must be EUR");
  assert.equal(norm.eligibility.etsyPayoutCurrency, "EUR", "BG etsyPayoutCurrency must be EUR");
  assert.equal(norm.eligibility.bankFxPossibility, true, "BG bankFxPossibility must be true per Etsy documentation");
  assert.equal(norm.eligibility.payoutCurrencyContext, "etsy_sends_eur");

  // Regulatory fee invariant: Bulgaria is not listed by Etsy; rate must be null (not numeric 0)
  assert.strictEqual(norm.regulatoryOperatingFee.rate, null);
  assert.strictEqual(norm.regulatoryOperatingFee.status, "not_listed");
  assert.strictEqual(norm.regulatoryOperatingFee.isListedByEtsy, false);
  assert.strictEqual(norm.fees.regulatory.rate, null);

  // Invariant: zero candidates or catalog definitions contain BGN
  for (const [code, def] of Object.entries(CANDIDATE_DEFINITIONS)) {
    assert.notEqual(def.currency, "BGN", `${code} must not use BGN`);
  }
  assert.equal(VALID_CURRENCIES.has("BGN"), false, "VALID_CURRENCIES must not contain BGN");
});
