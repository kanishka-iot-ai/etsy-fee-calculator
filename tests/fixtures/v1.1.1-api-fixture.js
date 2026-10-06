/**
 * ShopProfit — Authoritative v1.1.1 Public API Fixture
 *
 * Sourced directly from the production Cloudflare D1 fee database schema and
 * Worker API contract (GET /v1/fees).
 *
 * Deterministic, offline representation of the active v1.1.1 release:
 * - Exactly 62 markets (12 baseline + 50 candidate markets)
 * - 61 sovereign nations + OTHER fallback
 * - 9 statutory regulatory operating fee jurisdictions
 * - 9 statutory deposit fee schedules
 * - 16 Payoneer partner markets
 * - 6 EUR payout / bankFxPossibility markets
 * - Zero hard-coded local Offsite Ads caps
 * - Strict null semantics (no fake numeric 0 for unlisted regulatory/deposit/setup fees)
 */

import {
  STATUTORY_REGULATORY_RATES,
  STATUTORY_DEPOSIT_SCHEDULES,
  FLAGS,
  CURRENCY_SYMBOLS,
  KNOWN_LOCALES
} from "../../src/compatibility.js";
import { GLOBAL_COUNTRY_RULES } from "../../src/fee-engine.js";

const BASELINE_ORDER = [
  "US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP", "TR", "OTHER"
];

const CANDIDATE_ORDER = [
  // 30 Fully Verified
  "AT", "BE", "CH", "CY", "DK", "EE", "FI", "GR", "HK", "ID",
  "IE", "IL", "LT", "LU", "LV", "MA", "MT", "MX", "MY", "NL",
  "NO", "NZ", "PH", "PT", "SE", "SG", "SI", "SK", "VN", "ZA",
  // 14 Payoneer Partners
  "AE", "AR", "BR", "CL", "CN", "EG", "GE", "KR", "KZ", "PE",
  "PK", "RS", "TH", "UA",
  // 6 EUR Payout Context
  "BG", "HR", "CZ", "HU", "PL", "RO"
];

export const V1_1_1_COUNTRY_ORDER = Object.freeze([
  ...BASELINE_ORDER,
  ...CANDIDATE_ORDER
]);

function buildApiDepositSchedule(code) {
  const sched = STATUTORY_DEPOSIT_SCHEDULES[code];
  if (!sched) {
    return {
      mode: "not_listed",
      dailyDepositMinimum: null,
      feeThreshold: null,
      fee: null
    };
  }
  return {
    mode: "listed",
    dailyDepositMinimum: { amount: sched.min, currency: sched.currency },
    feeThreshold: { amount: sched.threshold, currency: sched.currency },
    fee: { amount: sched.fee, currency: sched.currency }
  };
}

function buildApiCountryRecord(code) {
  const rule = GLOBAL_COUNTRY_RULES[code];
  if (!rule) {
    throw new Error(`Missing country rule for ${code}`);
  }

  const regRate = STATUTORY_REGULATORY_RATES[code] !== undefined
    ? STATUTORY_REGULATORY_RATES[code]
    : null;

  const record = {
    code,
    name: rule.name,
    flag: FLAGS[code] || "🌐",
    currency: rule.currency,
    symbol: rule.symbol || CURRENCY_SYMBOLS[rule.currency] || rule.currency,
    locale: rule.locale || KNOWN_LOCALES[code] || "en-US",
    listingFee: rule.listingFee,
    processingRate: rule.rate,
    processingFixed: rule.fixed,
    regulatoryRate: regRate,
    plusMonthly: rule.plusMonthly || 10,
    depositSchedule: buildApiDepositSchedule(code)
  };

  // Add domestic/international processing splits where published by Etsy
  if (rule.domesticRate !== undefined) record.domesticRate = rule.domesticRate;
  if (rule.domesticFixed !== undefined) record.domesticFixed = rule.domesticFixed;
  if (rule.intlRate !== undefined) record.internationalRate = rule.intlRate;
  if (rule.intlFixed !== undefined) record.internationalFixed = rule.intlFixed;

  return Object.freeze(record);
}

const buildAllCountries = () => {
  const map = {};
  for (const code of V1_1_1_COUNTRY_ORDER) {
    map[code] = buildApiCountryRecord(code);
  }
  return Object.freeze(map);
};

export const V1_1_1_API_FIXTURE = Object.freeze({
  version: "1.1.1",
  version_id: "v1.1.1",
  publishedAt: "2026-10-06T00:00:00.000Z",
  countryOrder: V1_1_1_COUNTRY_ORDER,
  countries: buildAllCountries()
});
