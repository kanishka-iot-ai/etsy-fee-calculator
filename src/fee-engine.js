/**
 * ShopProfit Global Etsy Fee Calculation Engine (v1.1.1 Normalized Model)
 *
 * SAFETY INVARIANTS:
 * - Pure calculation module: Zero DOM access, zero localStorage, zero network fetching, zero global state.
 * - Explicit fee bases: transactionBase, processingBase, regulatoryBase, offsiteAdsBase, currencyConversionBase.
 * - Domestic vs International payment processing splits for CA, AU, NZ.
 * - Statutory regulatory operating fee schedule (9 countries only; null metadata for unlisted markets).
 * - Offsite Ads: Authoritative $100 USD-equivalent cap metadata ({ amount: 100, currency: "USD", type: "usd_equivalent" });
 *   zero hard-coded local currency caps; zero invented foreign exchange rates.
 * - Currency conversion (2.5%) applied strictly when listingCurrency !== paymentAccountCurrency based on explicit currencyConversionBase.
 * - Account-level costs (Etsy Plus, deposit schedules, setup fees) strictly separated from per-order Etsy fees.
 * - Integer minor-unit precision preventing floating-point rounding errors.
 */

import {
  STATUTORY_REGULATORY_RATES,
  STATUTORY_DEPOSIT_SCHEDULES,
  OFFICIAL_PAYONEER_COUNTRIES,
  EUR_PAYOUT_COUNTRIES,
  EURO_AREA_COUNTRIES,
  FLAGS,
  CURRENCY_SYMBOLS,
  KNOWN_LOCALES
} from "./compatibility.js";

export const OFFICIAL_TRANSACTION_RATE = 0.065;
export const DEFAULT_CURRENCY_CONVERSION_RATE = 0.025;

/**
 * Authoritative statutory Offsite Ads cap per Etsy Help Center policy:
 * Sellers never pay more than $100 USD in Offsite Ads fees on a single order.
 * Local currency amounts are USD-equivalents converted at the time of fee assessment.
 * The engine does NOT hard-code approximate local currency amounts (£80, CA$135, €95, etc.)
 * or invent ungrounded foreign exchange rates.
 */
export const STATUTORY_OFFSITE_ADS_CAP = Object.freeze({
  amount: 100,
  currency: "USD",
  type: "usd_equivalent"
});

const MAX_MINOR_UNITS = 9_999_999_999;

/**
 * Currency minor-unit decimal digits (ISO 4217 standard).
 * JPY, VND, KRW, etc. have 0 decimals.
 */
export function getCurrencyMinorUnitDigits(currency = "USD") {
  const code = String(currency || "USD").toUpperCase();
  switch (code) {
    case "JPY":
    case "VND":
    case "KRW":
    case "CLP":
    case "PYG":
    case "UGX":
    case "RWF":
      return 0;
    case "BHD":
    case "JOD":
    case "KWD":
    case "OMR":
    case "TND":
      return 3;
    default:
      return 2;
  }
}

/**
 * Converts a major currency value (e.g. 50.25) to integer minor units (e.g. 5025 cents).
 */
export function toMinorUnits(value, currency = "USD") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  const digits = getCurrencyMinorUnitDigits(currency);
  const factor = 10 ** digits;
  return Math.min(MAX_MINOR_UNITS, Math.max(0, Math.round((amount + Number.EPSILON) * factor)));
}

/**
 * Converts integer minor units back to a major currency value.
 */
export function fromMinorUnits(minorUnits, currency = "USD") {
  const amount = Number(minorUnits);
  if (!Number.isFinite(amount)) return 0;
  const digits = getCurrencyMinorUnitDigits(currency);
  const factor = 10 ** digits;
  return Math.round(amount) / factor;
}

/**
 * Legacy cents converter (always uses multiplier 100).
 */
const toLegacyCents = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.min(MAX_MINOR_UNITS, Math.max(0, Math.round((amount + Number.EPSILON) * 100)));
};

/**
 * Global 62-market rule registry covering all 12 baseline countries + 50 candidate countries.
 * NOTE: Contains ZERO hard-coded local-currency Offsite Ads caps.
 */
export const GLOBAL_COUNTRY_RULES = Object.freeze({
  // Baseline 12
  US: { name: "United States", currency: "USD", symbol: "$", locale: "en-US", listingFee: 0.20, rate: 0.03, fixed: 0.25, plusMonthly: 10 },
  UK: { name: "United Kingdom", currency: "GBP", symbol: "£", locale: "en-GB", listingFee: 0.16, rate: 0.04, fixed: 0.20, plusMonthly: 8 },
  CA: {
    name: "Canada", currency: "CAD", symbol: "CA$", locale: "en-CA", listingFee: 0.27,
    rate: 0.03, fixed: 0.25, domesticRate: 0.03, domesticFixed: 0.25, intlRate: 0.04, intlFixed: 0.25,
    plusMonthly: 13.5
  },
  AU: {
    name: "Australia", currency: "AUD", symbol: "A$", locale: "en-AU", listingFee: 0.28,
    rate: 0.03, fixed: 0.25, domesticRate: 0.03, domesticFixed: 0.25, intlRate: 0.04, intlFixed: 0.25,
    plusMonthly: 15
  },
  DE: { name: "Germany / Eurozone", currency: "EUR", symbol: "€", locale: "de-DE", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  FR: { name: "France", currency: "EUR", symbol: "€", locale: "fr-FR", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  IT: { name: "Italy", currency: "EUR", symbol: "€", locale: "it-IT", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  ES: { name: "Spain", currency: "EUR", symbol: "€", locale: "es-ES", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  IN: { name: "India", currency: "INR", symbol: "₹", locale: "en-IN", listingFee: 16.5, rate: 0.05, fixed: 25, plusMonthly: 830 },
  JP: { name: "Japan", currency: "JPY", symbol: "¥", locale: "ja-JP", listingFee: 30, rate: 0.06, fixed: 45, plusMonthly: 1500 },
  TR: { name: "Türkiye", currency: "TRY", symbol: "₺", locale: "tr-TR", listingFee: 7, rate: 0.065, fixed: 14, plusMonthly: 340 },
  OTHER: { name: "Global / Other", currency: "USD", symbol: "$", locale: "en-US", listingFee: 0.20, rate: 0.065, fixed: 0.30, plusMonthly: 10 },

  // 30 Fully Verified Candidates
  AT: { name: "Austria", currency: "EUR", symbol: "€", locale: "de-AT", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  BE: { name: "Belgium", currency: "EUR", symbol: "€", locale: "nl-BE", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  CH: { name: "Switzerland", currency: "CHF", symbol: "CHF", locale: "de-CH", listingFee: 0.20, rate: 0.04, fixed: 0.50, plusMonthly: 10 },
  CY: { name: "Cyprus", currency: "EUR", symbol: "€", locale: "el-CY", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  DK: { name: "Denmark", currency: "DKK", symbol: "kr", locale: "da-DK", listingFee: 1.40, rate: 0.04, fixed: 2.50, plusMonthly: 70 },
  EE: { name: "Estonia", currency: "EUR", symbol: "€", locale: "et-EE", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  FI: { name: "Finland", currency: "EUR", symbol: "€", locale: "fi-FI", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  GR: { name: "Greece", currency: "EUR", symbol: "€", locale: "el-GR", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  HK: { name: "Hong Kong", currency: "HKD", symbol: "HK$", locale: "zh-HK", listingFee: 1.60, rate: 0.044, fixed: 2.00, plusMonthly: 80 },
  ID: { name: "Indonesia", currency: "IDR", symbol: "Rp", locale: "id-ID", listingFee: 3000, rate: 0.045, fixed: 7000, plusMonthly: 150000 },
  IE: { name: "Ireland", currency: "EUR", symbol: "€", locale: "en-IE", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  IL: { name: "Israel", currency: "ILS", symbol: "₪", locale: "he-IL", listingFee: 0.70, rate: 0.045, fixed: 2.00, plusMonthly: 35 },
  LT: { name: "Lithuania", currency: "EUR", symbol: "€", locale: "lt-LT", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  LU: { name: "Luxembourg", currency: "EUR", symbol: "€", locale: "fr-LU", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  LV: { name: "Latvia", currency: "EUR", symbol: "€", locale: "lv-LV", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  MA: { name: "Morocco", currency: "MAD", symbol: "MAD", locale: "ar-MA", listingFee: 2.00, rate: 0.045, fixed: 5.00, plusMonthly: 100 },
  MT: { name: "Malta", currency: "EUR", symbol: "€", locale: "mt-MT", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  MX: { name: "Mexico", currency: "MXN", symbol: "MX$", locale: "es-MX", listingFee: 4.00, rate: 0.045, fixed: 8.00, plusMonthly: 200 },
  MY: { name: "Malaysia", currency: "MYR", symbol: "RM", locale: "ms-MY", listingFee: 0.90, rate: 0.045, fixed: 2.00, plusMonthly: 45 },
  NL: { name: "Netherlands", currency: "EUR", symbol: "€", locale: "nl-NL", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  NO: { name: "Norway", currency: "NOK", symbol: "kr", locale: "nb-NO", listingFee: 2.00, rate: 0.04, fixed: 2.50, plusMonthly: 100 },
  NZ: {
    name: "New Zealand", currency: "NZD", symbol: "NZ$", locale: "en-NZ", listingFee: 0.30,
    rate: 0.03, fixed: 0.30, domesticRate: 0.03, domesticFixed: 0.30, intlRate: 0.04, intlFixed: 0.30,
    plusMonthly: 16
  },
  PH: { name: "Philippines", currency: "PHP", symbol: "₱", locale: "en-PH", listingFee: 11.00, rate: 0.045, fixed: 25.00, plusMonthly: 550 },
  PT: { name: "Portugal", currency: "EUR", symbol: "€", locale: "pt-PT", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  SE: { name: "Sweden", currency: "SEK", symbol: "kr", locale: "sv-SE", listingFee: 2.00, rate: 0.04, fixed: 3.00, plusMonthly: 100 },
  SG: { name: "Singapore", currency: "SGD", symbol: "S$", locale: "en-SG", listingFee: 0.28, rate: 0.044, fixed: 0.35, plusMonthly: 14 },
  SI: { name: "Slovenia", currency: "EUR", symbol: "€", locale: "sl-SI", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  SK: { name: "Slovakia", currency: "EUR", symbol: "€", locale: "sk-SK", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  VN: { name: "Vietnam", currency: "VND", symbol: "₫", locale: "vi-VN", listingFee: 5000, rate: 0.045, fixed: 11500, plusMonthly: 240000 },
  ZA: { name: "South Africa", currency: "ZAR", symbol: "R", locale: "en-ZA", listingFee: 3.50, rate: 0.045, fixed: 8.00, plusMonthly: 175 },

  // 14 Payoneer Candidates (USD listing and payout)
  AE: { name: "United Arab Emirates", currency: "USD", symbol: "$", locale: "ar-AE", listingFee: 0.20, rate: 0.065, fixed: 0.30, plusMonthly: 10 },
  AR: { name: "Argentina", currency: "USD", symbol: "$", locale: "es-AR", listingFee: 0.20, rate: 0.065, fixed: 0.30, plusMonthly: 10 },
  BR: { name: "Brazil", currency: "USD", symbol: "$", locale: "pt-BR", listingFee: 0.20, rate: 0.065, fixed: 0.30, plusMonthly: 10 },
  CL: { name: "Chile", currency: "USD", symbol: "$", locale: "es-CL", listingFee: 0.20, rate: 0.065, fixed: 0.30, plusMonthly: 10 },
  CN: { name: "China", currency: "USD", symbol: "$", locale: "zh-CN", listingFee: 0.20, rate: 0.065, fixed: 0.30, plusMonthly: 10 },
  EG: { name: "Egypt", currency: "USD", symbol: "$", locale: "ar-EG", listingFee: 0.20, rate: 0.065, fixed: 0.30, plusMonthly: 10 },
  GE: { name: "Georgia", currency: "USD", symbol: "$", locale: "ka-GE", listingFee: 0.20, rate: 0.065, fixed: 0.30, plusMonthly: 10 },
  KR: { name: "South Korea", currency: "USD", symbol: "$", locale: "ko-KR", listingFee: 0.20, rate: 0.065, fixed: 0.30, plusMonthly: 10 },
  KZ: { name: "Kazakhstan", currency: "USD", symbol: "$", locale: "kk-KZ", listingFee: 0.20, rate: 0.065, fixed: 0.30, plusMonthly: 10 },
  PE: { name: "Peru", currency: "USD", symbol: "$", locale: "es-PE", listingFee: 0.20, rate: 0.065, fixed: 0.30, plusMonthly: 10 },
  PK: { name: "Pakistan", currency: "USD", symbol: "$", locale: "ur-PK", listingFee: 0.20, rate: 0.065, fixed: 0.30, plusMonthly: 10 },
  RS: { name: "Serbia", currency: "USD", symbol: "$", locale: "sr-RS", listingFee: 0.20, rate: 0.065, fixed: 0.30, plusMonthly: 10 },
  TH: { name: "Thailand", currency: "USD", symbol: "$", locale: "th-TH", listingFee: 0.20, rate: 0.06, fixed: 0.30, plusMonthly: 10 },
  UA: { name: "Ukraine", currency: "USD", symbol: "$", locale: "uk-UA", listingFee: 0.20, rate: 0.06, fixed: 0.30, plusMonthly: 10 },

  // 6 EUR Payout Candidates
  BG: { name: "Bulgaria", currency: "EUR", symbol: "€", locale: "bg-BG", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  HR: { name: "Croatia", currency: "EUR", symbol: "€", locale: "hr-HR", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  CZ: { name: "Czech Republic", currency: "EUR", symbol: "€", locale: "cs-CZ", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  HU: { name: "Hungary", currency: "EUR", symbol: "€", locale: "hu-HU", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  PL: { name: "Poland", currency: "EUR", symbol: "€", locale: "pl-PL", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 },
  RO: { name: "Romania", currency: "EUR", symbol: "€", locale: "ro-RO", listingFee: 0.18, rate: 0.04, fixed: 0.30, plusMonthly: 9.5 }
});

/**
 * Resolves country code, currency, rates, and statutory metadata.
 */
export function resolveCountryFeeRule(countryInput, options = {}) {
  let code = "OTHER";
  let customSchedule = null;

  if (typeof countryInput === "string") {
    code = countryInput.toUpperCase();
  } else if (countryInput && typeof countryInput === "object") {
    if (countryInput.country && countryInput.fees) {
      // Normalized schedule from normalizeFeeSchedule()
      customSchedule = countryInput;
      code = countryInput.country.code || "OTHER";
    } else if (countryInput.code || countryInput.countryCode) {
      code = (countryInput.code || countryInput.countryCode).toUpperCase();
      customSchedule = countryInput;
    } else {
      customSchedule = countryInput;
    }
  }

  const registered = GLOBAL_COUNTRY_RULES[code] || GLOBAL_COUNTRY_RULES.OTHER;
  const currency = String(
    customSchedule?.fees?.processing?.currency ||
    customSchedule?.currency ||
    registered.currency ||
    "USD"
  ).toUpperCase();

  // Processing rates resolution (accounting for domestic vs international splits)
  const orderType = options.orderType === "international" ? "international" : "domestic";
  let processingRate = registered.rate ?? 0.065;
  let processingFixed = registered.fixed ?? 0.30;

  if (customSchedule?.fees?.processing) {
    const p = customSchedule.fees.processing;
    if (orderType === "international" && p.internationalRate != null) {
      processingRate = p.internationalRate;
      processingFixed = p.internationalFixed ?? p.fixedAmount;
    } else if (orderType === "domestic" && p.domesticRate != null) {
      processingRate = p.domesticRate;
      processingFixed = p.domesticFixed ?? p.fixedAmount;
    } else {
      processingRate = p.rate ?? processingRate;
      processingFixed = p.fixedAmount ?? processingFixed;
    }
  } else {
    if (orderType === "international") {
      if (registered.intlRate != null) processingRate = registered.intlRate;
      if (registered.intlFixed != null) processingFixed = registered.intlFixed;
    } else {
      if (registered.domesticRate != null) processingRate = registered.domesticRate;
      if (registered.domesticFixed != null) processingFixed = registered.domesticFixed;
    }
  }

  // Listing fee
  const listingFee = customSchedule?.fees?.listing?.amount ?? registered.listingFee ?? 0.20;

  // Regulatory fee (Statutory 9 markets; null for unlisted)
  const isRegulatoryListed = STATUTORY_REGULATORY_RATES[code] !== undefined;
  const statutoryRegRate = STATUTORY_REGULATORY_RATES[code] ?? null;
  const regulatoryRate = isRegulatoryListed ? statutoryRegRate : null;

  // Plus monthly
  const plusMonthly = customSchedule?.fees?.etsyPlus?.monthlyAmount ?? registered.plusMonthly ?? 10;

  // Payment / Payout Context
  const isPayoneer = OFFICIAL_PAYONEER_COUNTRIES.has(code);
  const isEurPayout = EUR_PAYOUT_COUNTRIES.has(code);
  const isEuroArea = EURO_AREA_COUNTRIES.has(code);
  const bankFxPossibility = isEurPayout;

  let payoutCurrency;
  if (isPayoneer) payoutCurrency = "USD";
  else if (isEurPayout || isEuroArea) payoutCurrency = "EUR";
  else payoutCurrency = currency;

  // Statutory Deposit schedule
  const statutoryDeposit = STATUTORY_DEPOSIT_SCHEDULES[code] || null;
  const depositSchedule = statutoryDeposit
    ? {
        mode: "listed",
        dailyDepositMinimum: { amount: statutoryDeposit.min, currency: statutoryDeposit.currency },
        feeThreshold: { amount: statutoryDeposit.threshold, currency: statutoryDeposit.currency },
        fee: { amount: statutoryDeposit.fee, currency: statutoryDeposit.currency }
      }
    : {
        mode: "not_listed",
        dailyDepositMinimum: null,
        feeThreshold: null,
        fee: null
      };

  // Setup fee (India $10 USD)
  const setupFee = code === "IN"
    ? { amount: 10, currency: "USD", status: "applicable" }
    : { amount: null, currency: null, status: "unknown" };

  return {
    code,
    name: registered.name || code,
    currency,
    payoutCurrency,
    symbol: registered.symbol || CURRENCY_SYMBOLS[currency] || currency,
    locale: registered.locale || KNOWN_LOCALES[code] || "en-US",
    orderType,
    listingFee,
    processingRate,
    processingFixed,
    regulatoryRate,
    isRegulatoryListed,
    plusMonthly,
    isPayoneer,
    isEurPayout,
    isEuroArea,
    bankFxPossibility,
    depositSchedule,
    setupFee,
    offsiteAdsCap: STATUTORY_OFFSITE_ADS_CAP
  };
}

/**
 * Calculates deposit fee on a seller payout/balance event.
 * Strictly separate from per-order calculations.
 *
 * Rules:
 * if mode !== "listed" -> fee = 0
 * if depositAmount <= dailyDepositMinimum -> fee = 0
 * if depositAmount > dailyDepositMinimum && depositAmount < feeThreshold -> fee = depositFee
 * if depositAmount >= feeThreshold -> fee = 0
 *
 * @param {number} depositAmount - Payout balance to deposit
 * @param {Object} depositSchedule - Market deposit schedule
 * @returns {number} Deducted deposit fee in payout currency
 */
export function calculateDepositFee(depositAmount, depositSchedule) {
  if (!depositSchedule || typeof depositSchedule !== "object") return 0;

  const mode = depositSchedule.mode ?? (depositSchedule.fee || depositSchedule.feeAmount ? "listed" : "not_listed");
  if (mode !== "listed") return 0;

  const min = typeof depositSchedule.dailyDepositMinimum === "object" && depositSchedule.dailyDepositMinimum !== null
    ? depositSchedule.dailyDepositMinimum.amount
    : (depositSchedule.dailyDepositMinimum ?? depositSchedule.min ?? depositSchedule.depositMinimum ?? 0);

  const threshold = typeof depositSchedule.feeThreshold === "object" && depositSchedule.feeThreshold !== null
    ? depositSchedule.feeThreshold.amount
    : (depositSchedule.feeThreshold ?? depositSchedule.threshold ?? depositSchedule.feeThresholdAmount ?? 0);

  const fee = typeof depositSchedule.fee === "object" && depositSchedule.fee !== null
    ? depositSchedule.fee.amount
    : (depositSchedule.fee ?? depositSchedule.depositFee ?? depositSchedule.feeAmount ?? 0);

  const amount = Number(depositAmount);
  if (!Number.isFinite(amount) || amount <= min) return 0;
  if (amount > min && amount < threshold) return fee;
  if (amount >= threshold) return 0;
  return 0;
}

/**
 * Exact binary search solver to find break-even price in integer minor units / cents.
 */
function solveBreakEvenPrice({
  targetProfitMinor,
  shippingMinor,
  listingFeeMinor,
  processingFixedMinor,
  processingRate,
  regulatoryRate,
  offsiteRate,
  conversionRate,
  etsyPlusAmortizedMinor,
  productionMinor,
  packagingMinor,
  shippingCostMinor
}) {
  function netAtPrice(itemMinor) {
    const gross = itemMinor + shippingMinor;
    const fees = listingFeeMinor +
      Math.round(gross * OFFICIAL_TRANSACTION_RATE) +
      Math.round(gross * processingRate) + processingFixedMinor +
      Math.round(gross * regulatoryRate) +
      Math.round(gross * offsiteRate) +
      Math.round(gross * conversionRate);
    return gross - fees - etsyPlusAmortizedMinor - productionMinor - packagingMinor - shippingCostMinor;
  }

  const rateSum = OFFICIAL_TRANSACTION_RATE + processingRate + regulatoryRate + offsiteRate + conversionRate;
  const fixedSum = listingFeeMinor + processingFixedMinor + etsyPlusAmortizedMinor +
    productionMinor + packagingMinor + shippingCostMinor + targetProfitMinor;

  let high = Math.max(0, Math.ceil(fixedSum / Math.max(0.000001, 1 - rateSum) - shippingMinor));
  while (netAtPrice(high) < targetProfitMinor) {
    high = Math.max(high + 100, high * 2);
  }
  let low = 0;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (netAtPrice(mid) >= targetProfitMinor) high = mid;
    else low = mid + 1;
  }
  return low;
}

export { solveBreakEvenPrice };

/**
 * Exact binary search solver that calculates required item price to achieve a desired target profit.
 * Repeatedly invokes calculateOrderFees() to avoid duplicating fee equations and guarantee 100% mathematical consistency.
 *
 * @param {number} targetProfit - Desired target profit in major currency units (e.g. 25.00)
 * @param {Object} inputs - Base calculation inputs (shipping, country, costs, offsiteAds, plus, etc.)
 * @returns {number} Minimum required item price in integer minor units / cents
 */
export function solveRequiredPrice(targetProfit = 0, inputs = {}) {
  const targetMajor = Math.max(0, Number(targetProfit) || 0);
  const targetCents = Math.min(9_999_999_999, Math.max(0, Math.round((targetMajor + Number.EPSILON) * 100)));

  if (targetCents <= 0) {
    const atZero = calculateOrderFees({ ...inputs, itemPrice: 0 });
    return atZero.legacy.breakEvenCents;
  }

  // Find upper bound
  let high = Math.max(100, targetCents * 3);
  while (calculateOrderFees({ ...inputs, itemPrice: high / 100 }).legacy.netCents < targetCents) {
    high = Math.max(high + 1000, high * 2);
    if (high > 99_999_999_00) break;
  }

  let low = 0;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const res = calculateOrderFees({ ...inputs, itemPrice: mid / 100 });
    if (res.legacy.netCents >= targetCents) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return low;
}

/**
 * Calculates per-order Etsy seller fees and net profit.
 *
 * PURE FUNCTION: Does NOT access DOM, localStorage, network, or mutable state.
 *
 * @param {Object} inputs - Explicit calculation parameters
 * @returns {Object} Structured calculation result contract
 */
export function calculateOrderFees(inputs = {}) {
  const {
    country,
    itemPrice = 0,
    shipping = 0,
    giftWrap = 0,
    buyerSalesTax = 0,
    orderType = "domestic",
    offsiteAds = false,
    shopOffsiteAdsTier = 0.15,
    listingCurrency,
    paymentAccountCurrency,
    usdExchangeRate,
    currencyConversionBase: customConversionBase,
    salesPerMonth = 30,
    plusEnabled = false,
    itemCost = 0,
    packagingCost = 0,
    shippingCost = 0,
    // Compatibility aliases
    production = 0,
    packaging = 0,
    plus = false,
    offsiteRate = 0,
    tax = 0
  } = inputs;

  // 1. Resolve country fee rule and currency context
  const rule = resolveCountryFeeRule(country, { orderType });
  const activeCurrency = String(listingCurrency || rule.currency).toUpperCase();
  // DO NOT automatically assume currencies differ unless caller explicitly passed paymentAccountCurrency
  const activePayoutCurrency = paymentAccountCurrency
    ? String(paymentAccountCurrency).toUpperCase()
    : activeCurrency;

  // 2. Discrete minor-unit input conversions
  const itemMinor = toMinorUnits(itemPrice, activeCurrency);
  const shippingMinor = toMinorUnits(shipping, activeCurrency);
  const giftWrapMinor = toMinorUnits(giftWrap, activeCurrency);
  const effectiveBuyerTax = Number(buyerSalesTax || tax || 0);
  const taxMinor = toMinorUnits(effectiveBuyerTax, activeCurrency);

  const effectiveProduction = Number(itemCost || production || 0);
  const effectivePackaging = Number(packagingCost || packaging || 0);
  const effectiveShippingCost = Number(shippingCost || 0);
  const productionMinor = toMinorUnits(effectiveProduction, activeCurrency);
  const packagingMinor = toMinorUnits(effectivePackaging, activeCurrency);
  const shippingCostMinor = toMinorUnits(effectiveShippingCost, activeCurrency);

  // 3. Explicit Fee Bases
  // Transaction Base: Item + Shipping + Gift Wrap
  const transactionBaseMinor = itemMinor + shippingMinor + giftWrapMinor;
  // Processing Base: Item + Shipping + Gift Wrap + Buyer Sales Tax
  const processingBaseMinor = itemMinor + shippingMinor + giftWrapMinor + taxMinor;
  // Regulatory Base: Item + Shipping + Gift Wrap (tax collected by Etsy excluded)
  const regulatoryBaseMinor = itemMinor + shippingMinor + giftWrapMinor;
  // Offsite Ads Base: Attributed Order Total (Item + Shipping + Gift Wrap)
  const offsiteAdsBaseMinor = itemMinor + shippingMinor + giftWrapMinor;

  // Currency Conversion Base:
  // Per official Etsy Help Center policy (Articles 360000337767 and 115015628847),
  // Etsy charges a 2.5% currency conversion fee on the "sale amount" in the listing currency
  // when converting disbursements to the seller's payment account currency.
  // The sale amount comprises item price + shipping + gift wrap (excluding marketplace-collected tax).
  // Caller may explicitly override via inputs.currencyConversionBase if modeling custom conversion events.
  const currencyConversionBaseMinor = customConversionBase !== undefined
    ? toMinorUnits(customConversionBase, activeCurrency)
    : (itemMinor + shippingMinor + giftWrapMinor);

  // 4. Calculate Platform Fees
  // A. Listing fee
  const listingFeeMinor = toMinorUnits(rule.listingFee, activeCurrency);

  // B. Transaction fee (6.5%)
  const transactionFeeMinor = Math.round(transactionBaseMinor * OFFICIAL_TRANSACTION_RATE);

  // C. Payment Processing fee (percentage + fixed)
  const processingPercentMinor = Math.round(processingBaseMinor * rule.processingRate);
  const processingFixedMinor = toMinorUnits(rule.processingFixed, activeCurrency);
  const processingFeeMinor = processingPercentMinor + processingFixedMinor;

  // D. Regulatory Operating fee (statutory percentage where listed; 0 where unlisted)
  const isRegListed = rule.isRegulatoryListed && rule.regulatoryRate !== null;
  const regulatoryFeeMinor = isRegListed
    ? Math.round(regulatoryBaseMinor * rule.regulatoryRate)
    : 0;

  // E. Offsite Ads fee (tier percentage subject to $100 USD-equivalent cap)
  const isOffsiteEnabled = Boolean(offsiteAds || (Number(offsiteRate) > 0));
  let effectiveTier = 0;
  let offsiteAdsFeeMinor = 0;
  if (isOffsiteEnabled) {
    effectiveTier = Number(offsiteRate) > 0 ? Number(offsiteRate) : Number(shopOffsiteAdsTier);
    if (effectiveTier > 1) effectiveTier /= 100; // Allow 12 or 15
    const uncappedMinor = Math.round(offsiteAdsBaseMinor * effectiveTier);

    if (activeCurrency === "USD") {
      // In USD, statutory cap is exactly $100 USD
      const capMinor = toMinorUnits(STATUTORY_OFFSITE_ADS_CAP.amount, "USD");
      offsiteAdsFeeMinor = Math.min(uncappedMinor, capMinor);
    } else if (usdExchangeRate != null && Number.isFinite(Number(usdExchangeRate))) {
      // If caller explicitly provides the live USD exchange rate, apply the converted cap:
      const localCap = STATUTORY_OFFSITE_ADS_CAP.amount * Number(usdExchangeRate);
      const capMinor = toMinorUnits(localCap, activeCurrency);
      offsiteAdsFeeMinor = Math.min(uncappedMinor, capMinor);
    } else {
      // Per Step 11B.1 requirements: Do NOT hard-code approximate local currency caps
      // (£80, CA$135, €95, ₹8,300, ¥15,000, etc.).
      // If an FX rate is unavailable, return the USD-equivalent cap as metadata
      // and do NOT invent an FX rate.
      offsiteAdsFeeMinor = uncappedMinor;
    }
  }

  // F. Currency Conversion fee (2.5% strictly when listingCurrency !== paymentAccountCurrency)
  const isConversionRequired = activeCurrency !== activePayoutCurrency;
  const currencyConversionFeeMinor = isConversionRequired
    ? Math.round(currencyConversionBaseMinor * DEFAULT_CURRENCY_CONVERSION_RATE)
    : 0;

  // G. Etsy Plus amortized cost (account-level cost; optional)
  const isPlusActive = Boolean(plusEnabled || plus);
  const plusMonthlyMinor = toMinorUnits(rule.plusMonthly, activeCurrency);
  const safeSalesPerMonth = Math.max(1, Number(salesPerMonth) || 30);
  const etsyPlusAmortizedMinor = isPlusActive
    ? Math.round(plusMonthlyMinor / safeSalesPerMonth)
    : 0;

  // 5. Totals & Profit Calculations
  // Total direct Etsy platform fees charged on this order
  const totalEtsyFeesMinor = listingFeeMinor + transactionFeeMinor + processingFeeMinor +
    regulatoryFeeMinor + offsiteAdsFeeMinor + currencyConversionFeeMinor;

  // Account-level amortized costs
  const totalAccountLevelCostsMinor = etsyPlusAmortizedMinor;

  // Direct seller costs
  const totalSellerCostsMinor = productionMinor + packagingMinor + shippingCostMinor + totalAccountLevelCostsMinor;

  // Gross revenue earned by seller (excluding buyer tax remitted directly to tax authorities)
  const grossRevenueMinor = transactionBaseMinor;

  // Net Profit
  const netProfitMinor = grossRevenueMinor - totalEtsyFeesMinor - totalSellerCostsMinor;
  const margin = grossRevenueMinor > 0 ? (netProfitMinor / grossRevenueMinor) : 0;

  // Major unit outputs
  const transaction = fromMinorUnits(transactionFeeMinor, activeCurrency);
  const processing = fromMinorUnits(processingFeeMinor, activeCurrency);
  const regulatory = fromMinorUnits(regulatoryFeeMinor, activeCurrency);
  const offsiteAdsAmount = fromMinorUnits(offsiteAdsFeeMinor, activeCurrency);
  const currencyConversion = fromMinorUnits(currencyConversionFeeMinor, activeCurrency);
  const listing = fromMinorUnits(listingFeeMinor, activeCurrency);
  const etsyPlusAmortized = fromMinorUnits(etsyPlusAmortizedMinor, activeCurrency);

  const totalEtsyFees = fromMinorUnits(totalEtsyFeesMinor, activeCurrency);
  const totalAccountLevelCosts = fromMinorUnits(totalAccountLevelCostsMinor, activeCurrency);
  const totalProfit = fromMinorUnits(netProfitMinor, activeCurrency);

  const transactionBase = fromMinorUnits(transactionBaseMinor, activeCurrency);
  const processingBase = fromMinorUnits(processingBaseMinor, activeCurrency);
  const regulatoryBase = fromMinorUnits(regulatoryBaseMinor, activeCurrency);
  const offsiteAdsBase = fromMinorUnits(offsiteAdsBaseMinor, activeCurrency);
  const currencyConversionBase = fromMinorUnits(currencyConversionBaseMinor, activeCurrency);

  // Regulatory metadata preservation invariant
  const regulatoryMetadata = Object.freeze({
    rate: isRegListed ? rule.regulatoryRate : null,
    status: isRegListed ? "applicable" : "not_listed",
    isListedByEtsy: isRegListed
  });

  // Calculate break-even price in minor units
  const breakEvenMinor = solveBreakEvenPrice({
    targetProfitMinor: 0,
    shippingMinor,
    listingFeeMinor,
    processingFixedMinor,
    processingRate: rule.processingRate,
    regulatoryRate: isRegListed ? rule.regulatoryRate : 0,
    offsiteRate: effectiveTier,
    conversionRate: isConversionRequired ? DEFAULT_CURRENCY_CONVERSION_RATE : 0,
    etsyPlusAmortizedMinor,
    productionMinor,
    packagingMinor,
    shippingCostMinor
  });

  // 6. Legacy calculation parity representations (in cents: 100 multiplier)
  const legacyGrossCents = toLegacyCents(itemPrice) + toLegacyCents(shipping);
  const legacyListingCents = toLegacyCents(rule.listingFee);
  const legacyTransactionCents = Math.round(legacyGrossCents * OFFICIAL_TRANSACTION_RATE);
  const legacyProcessingCents = Math.round(legacyGrossCents * rule.processingRate) + toLegacyCents(rule.processingFixed);
  const legacyRegulatoryCents = Math.round(legacyGrossCents * (rule.regulatoryRate || 0));
  const legacyOffsiteCents = isOffsiteEnabled
    ? (activeCurrency === "USD"
        ? Math.min(Math.round(legacyGrossCents * effectiveTier), 10000)
        : Math.round(legacyGrossCents * effectiveTier))
    : 0;
  const legacyConversionCents = isConversionRequired
    ? Math.round(legacyGrossCents * DEFAULT_CURRENCY_CONVERSION_RATE)
    : 0;
  const legacyPlusCents = isPlusActive
    ? Math.round(toLegacyCents(rule.plusMonthly) / safeSalesPerMonth)
    : 0;
  const legacyProductionCents = toLegacyCents(effectiveProduction);
  const legacyPackagingCents = toLegacyCents(effectivePackaging);
  const legacyShippingCostCents = toLegacyCents(effectiveShippingCost);

  const legacyFeesCents = legacyListingCents + legacyTransactionCents + legacyProcessingCents +
    legacyRegulatoryCents + legacyOffsiteCents + legacyConversionCents;
  const legacyCostsCents = legacyProductionCents + legacyPackagingCents + legacyShippingCostCents + legacyPlusCents;
  const legacyNetCents = legacyGrossCents - legacyFeesCents - legacyCostsCents;
  const legacyMargin = legacyGrossCents > 0 ? (legacyNetCents / legacyGrossCents) : 0;

  const legacyBreakEvenCents = solveBreakEvenPrice({
    targetProfitMinor: 0,
    shippingMinor: toLegacyCents(shipping),
    listingFeeMinor: legacyListingCents,
    processingFixedMinor: toLegacyCents(rule.processingFixed),
    processingRate: rule.processingRate,
    regulatoryRate: rule.regulatoryRate || 0,
    offsiteRate: effectiveTier,
    conversionRate: isConversionRequired ? DEFAULT_CURRENCY_CONVERSION_RATE : 0,
    etsyPlusAmortizedMinor: legacyPlusCents,
    productionMinor: legacyProductionCents,
    packagingMinor: legacyPackagingCents,
    shippingCostMinor: legacyShippingCostCents
  });

  return Object.freeze({
    feeBreakdown: Object.freeze({
      transaction,
      processing,
      regulatory,
      offsiteAds: offsiteAdsAmount,
      currencyConversion,
      listing,
      etsyPlusAmortized
    }),

    totals: Object.freeze({
      totalEtsyFees,
      totalAccountLevelCosts,
      totalProfit,
      breakEvenPrice: fromMinorUnits(breakEvenMinor, activeCurrency),
      margin
    }),

    bases: Object.freeze({
      transactionBase,
      processingBase,
      regulatoryBase,
      offsiteAdsBase,
      currencyConversionBase
    }),

    metadata: Object.freeze({
      country: rule.code,
      countryName: rule.name,
      currency: activeCurrency,
      payoutCurrency: activePayoutCurrency,
      orderType: rule.orderType,
      regulatoryFee: regulatoryMetadata,
      regulatoryOperatingFee: regulatoryMetadata,
      regulatory: regulatoryMetadata,
      offsiteAdsCap: STATUTORY_OFFSITE_ADS_CAP
    }),

    informational: Object.freeze({
      depositSchedule: Object.freeze(rule.depositSchedule),
      setupFee: Object.freeze(rule.setupFee),
      payoneer: rule.isPayoneer,
      payoneerContext: rule.isPayoneer ? "payoneer" : "direct_etsy_payments",
      bankFxPossibility: rule.bankFxPossibility,
      regulatory: regulatoryMetadata,
      offsiteAdsCap: STATUTORY_OFFSITE_ADS_CAP
    }),

    // Minor-unit representations matching currency digits
    minorUnits: Object.freeze({
      gross: grossRevenueMinor,
      transactionBase: transactionBaseMinor,
      processingBase: processingBaseMinor,
      regulatoryBase: regulatoryBaseMinor,
      offsiteAdsBase: offsiteAdsBaseMinor,
      currencyConversionBase: currencyConversionBaseMinor,
      transactionFee: transactionFeeMinor,
      processingFee: processingFeeMinor,
      regulatoryFee: regulatoryFeeMinor,
      offsiteAdsFee: offsiteAdsFeeMinor,
      currencyConversionFee: currencyConversionFeeMinor,
      listingFee: listingFeeMinor,
      etsyPlusAmortized: etsyPlusAmortizedMinor,
      totalEtsyFees: totalEtsyFeesMinor,
      totalCosts: totalSellerCostsMinor,
      netProfit: netProfitMinor,
      breakEven: breakEvenMinor
    }),

    // Exact parity bridge for legacy fixtures
    legacy: Object.freeze({
      grossCents: legacyGrossCents,
      listingCents: legacyListingCents,
      transactionCents: legacyTransactionCents,
      processingCents: legacyProcessingCents,
      regulatoryCents: legacyRegulatoryCents,
      offsiteCents: legacyOffsiteCents,
      productionCents: legacyProductionCents,
      packagingCents: legacyPackagingCents,
      plusCents: legacyPlusCents,
      feesCents: legacyFeesCents,
      costsCents: legacyCostsCents,
      netCents: legacyNetCents,
      margin: legacyMargin,
      breakEvenCents: legacyBreakEvenCents,
      platformRate: legacyGrossCents ? (legacyFeesCents / legacyGrossCents) : 0,
      costsRate: legacyGrossCents ? (legacyCostsCents / legacyGrossCents) : 0,
      keptPer100Cents: Math.round(legacyMargin * 10000)
    })
  });
}

/**
 * Resolves standard seller country code from client time zone string.
 */
export function countryFromTimeZone(timeZone = "") {
  const zone = String(timeZone || "").toLowerCase();
  if (zone.startsWith("america/toronto") || zone.startsWith("america/vancouver") || zone.startsWith("america/edmonton") || zone.startsWith("america/winnipeg") || zone.startsWith("america/halifax")) return "CA";
  if (zone.startsWith("america/")) return "US";
  if (zone.startsWith("europe/london")) return "UK";
  if (zone.startsWith("europe/paris")) return "FR";
  if (zone.startsWith("europe/rome")) return "IT";
  if (zone.startsWith("europe/madrid")) return "ES";
  if (zone.startsWith("europe/berlin") || zone.startsWith("europe/amsterdam") || zone.startsWith("europe/vienna")) return "DE";
  if (zone.startsWith("australia/")) return "AU";
  if (zone.startsWith("asia/kolkata") || zone.startsWith("asia/calcutta")) return "IN";
  if (zone.startsWith("asia/tokyo")) return "JP";
  if (zone.startsWith("europe/istanbul")) return "TR";
  return "OTHER";
}

/**
 * Formats minor units (cents) into localized currency string.
 */
export function formatMoney(minorUnits, country = {}, { currency = country?.currency || "USD" } = {}) {
  const value = (Number(minorUnits) || 0) / 100;
  const locale = country?.locale || "en-US";
  const curr = currency || country?.currency || "USD";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: curr }).format(value);
  } catch {
    const symbol = country?.symbol || "$";
    return `${symbol}${value.toFixed(curr === "JPY" ? 0 : 2)}`;
  }
}

export const asCents = (value) => Math.min(MAX_MINOR_UNITS, Math.max(0, Math.round((Number(value) + Number.EPSILON) * 100)));

