/**
 * ShopProfit Phase 1 & 2 — Isolated Backend Profit Advisor Module
 *
 * SAFETY & ARCHITECTURAL INVARIANTS:
 * 1. Source of Truth: Imports pure calculation functions directly from ../../src/fee-engine.js.
 *    Never duplicates fee formulas or allows an AI model to calculate fees, margins, or prices.
 * 2. Zero Prompt Injection: Accepts strictly validated numeric and enum inputs via an explicit
 *    key allowlist. Free-form text prompts and unknown fields are rejected with HTTP 400.
 * 3. Explicit AI Gate: Invokes env.AI.run() ONLY when env.ENABLE_AI_ADVISOR === true and env.AI is bound.
 * 4. Numerical & Contextual Traceability:
 *    - Every number appearing in AI-generated text is checked against precomputed deterministic values.
 *    - Contextual metric-to-number binding verifies that numbers associated with net profit, Etsy fees,
 *      margin, break-even price, target price, or deposit fees match that specific metric (preventing
 *      swapped or misattributed figures).
 *    - Unsupported claims (demand, conversion rates, competitors, or "guaranteed" profit) are rejected.
 * 5. Resilient Fallback: If AI is disabled, unbound, times out, exhausts quota, or returns
 *    invalid/unverified output, returns a 100% deterministic rule-based advisor report.
 * 6. Zero Production Mutation: Does not write to D1, does not log secrets/IPs/financial inputs,
 *    and is not mounted as a public route.
 */

import {
  calculateOrderFees,
  solveRequiredPrice,
  resolveCountryFeeRule,
  calculateDepositFee,
  GLOBAL_COUNTRY_RULES,
  OFFICIAL_TRANSACTION_RATE,
  DEFAULT_CURRENCY_CONVERSION_RATE
} from "../../src/fee-engine.js";
import { PUBLIC_SECURITY_HEADERS } from "./api.js";
import {
  checkRateLimit,
  createRateLimitResponse,
  DEFAULT_WINDOW_MS,
  DEFAULT_ADVISOR_MAX_REQUESTS
} from "./rate-limiter.js";

export { DEFAULT_ADVISOR_MAX_REQUESTS };
export const MAX_ADVISOR_BODY_BYTES = 2048;     // 2 KB hard cap on request payload
export const DEFAULT_AI_TIMEOUT_MS = 4000;      // 4s max execution window for AI inference
export const DEFAULT_AI_MODEL = "@cf/meta/llama-3.2-3b-instruct";

export const APPROVED_AI_MODELS = Object.freeze(new Set([
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/meta/llama-3.2-1b-instruct",
  "@cf/meta/llama-3.1-8b-instruct-fp8"
]));

export const ADVISOR_RESPONSE_HEADERS = Object.freeze({
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  ...PUBLIC_SECURITY_HEADERS
});

const COUNTRY_CODE_RE = /^(?:[A-Z]{2}|OTHER)$/;
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;
const ALLOWED_ORDER_TYPES = new Set(["domestic", "international"]);
const ALLOWED_OFFSITE_RATES = new Set([0, 0.12, 0.15, 12, 15]);
const MAX_MONETARY_VALUE = 99_999_999;
const MAX_SALES_PER_MONTH = 10_000;

const ALLOWED_INPUT_KEYS = Object.freeze(new Set([
  "country",
  "itemPrice",
  "shipping",
  "production",
  "packaging",
  "shippingCost",
  "giftWrap",
  "buyerSalesTax",
  "orderType",
  "offsiteAds",
  "offsiteRate",
  "plusEnabled",
  "salesPerMonth",
  "targetProfit",
  "listingCurrency",
  "paymentAccountCurrency",
  "payoutBalance"
]));

const FORBIDDEN_PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Validates raw advisor input object against strict schema and range constraints.
 * Rejects any unexpected or free-form text fields to prevent prompt injection.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, data: Object } | { ok: false, error: string }}
 */
export function validateAdvisorInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Invalid input: body must be a JSON object" };
  }

  const keys = Object.keys(raw);
  if (keys.length === 0) {
    return { ok: false, error: "Invalid input: empty payload" };
  }

  for (const key of keys) {
    if (FORBIDDEN_PROTOTYPE_KEYS.has(key) || !ALLOWED_INPUT_KEYS.has(key)) {
      return { ok: false, error: `Invalid input: unexpected field '${String(key).slice(0, 40)}'` };
    }
  }

  // 1. Validate country
  if (typeof raw.country !== "string" || !COUNTRY_CODE_RE.test(raw.country)) {
    return { ok: false, error: "Invalid input: 'country' must be a valid ISO alpha-2 code or 'OTHER'" };
  }
  const country = raw.country;
  if (!Object.prototype.hasOwnProperty.call(GLOBAL_COUNTRY_RULES, country)) {
    return { ok: false, error: `Invalid input: unsupported country '${country}'` };
  }

  // 2. Validate required itemPrice
  if (typeof raw.itemPrice !== "number" || !Number.isFinite(raw.itemPrice) || raw.itemPrice <= 0 || raw.itemPrice > MAX_MONETARY_VALUE) {
    return { ok: false, error: "Invalid input: 'itemPrice' must be a finite number between 0.01 and 99,999,999" };
  }

  // 3. Validate optional monetary numbers
  const optionalMoneyFields = [
    "shipping",
    "production",
    "packaging",
    "shippingCost",
    "giftWrap",
    "buyerSalesTax",
    "targetProfit",
    "payoutBalance"
  ];

  const normalizedMoney = {};
  for (const field of optionalMoneyFields) {
    if (raw[field] === undefined) {
      normalizedMoney[field] = 0;
      continue;
    }
    if (typeof raw[field] !== "number" || !Number.isFinite(raw[field]) || raw[field] < 0 || raw[field] > MAX_MONETARY_VALUE) {
      return { ok: false, error: `Invalid input: '${field}' must be a finite number between 0 and 99,999,999` };
    }
    normalizedMoney[field] = raw[field];
  }

  // 4. Validate orderType enum
  let orderType = "domestic";
  if (raw.orderType !== undefined) {
    if (typeof raw.orderType !== "string" || !ALLOWED_ORDER_TYPES.has(raw.orderType)) {
      return { ok: false, error: "Invalid input: 'orderType' must be 'domestic' or 'international'" };
    }
    orderType = raw.orderType;
  }

  // 5. Validate offsiteAds boolean & offsiteRate enum
  let offsiteAds = false;
  if (raw.offsiteAds !== undefined) {
    if (typeof raw.offsiteAds !== "boolean") {
      return { ok: false, error: "Invalid input: 'offsiteAds' must be a boolean" };
    }
    offsiteAds = raw.offsiteAds;
  }

  let offsiteRate = offsiteAds ? 0.15 : 0;
  if (raw.offsiteRate !== undefined) {
    if (typeof raw.offsiteRate !== "number" || !ALLOWED_OFFSITE_RATES.has(raw.offsiteRate)) {
      return { ok: false, error: "Invalid input: 'offsiteRate' must be one of 0, 0.12, 0.15, 12, 15" };
    }
    offsiteRate = raw.offsiteRate > 1 ? raw.offsiteRate / 100 : raw.offsiteRate;
    if (offsiteRate > 0) offsiteAds = true;
    else offsiteAds = false;
  }

  // 6. Validate plusEnabled & salesPerMonth
  let plusEnabled = false;
  if (raw.plusEnabled !== undefined) {
    if (typeof raw.plusEnabled !== "boolean") {
      return { ok: false, error: "Invalid input: 'plusEnabled' must be a boolean" };
    }
    plusEnabled = raw.plusEnabled;
  }

  let salesPerMonth = 30;
  if (raw.salesPerMonth !== undefined) {
    if (
      typeof raw.salesPerMonth !== "number" ||
      !Number.isFinite(raw.salesPerMonth) ||
      !Number.isInteger(raw.salesPerMonth) ||
      raw.salesPerMonth < 1 ||
      raw.salesPerMonth > MAX_SALES_PER_MONTH
    ) {
      return { ok: false, error: "Invalid input: 'salesPerMonth' must be an integer between 1 and 10,000" };
    }
    salesPerMonth = raw.salesPerMonth;
  }

  // 7. Validate optional currency codes
  const rule = resolveCountryFeeRule(country, { orderType });
  let listingCurrency = rule.currency;
  if (raw.listingCurrency !== undefined) {
    if (typeof raw.listingCurrency !== "string" || !CURRENCY_CODE_RE.test(raw.listingCurrency)) {
      return { ok: false, error: "Invalid input: 'listingCurrency' must be a 3-letter uppercase ISO currency code" };
    }
    listingCurrency = raw.listingCurrency;
  }

  let paymentAccountCurrency = listingCurrency;
  if (raw.paymentAccountCurrency !== undefined) {
    if (typeof raw.paymentAccountCurrency !== "string" || !CURRENCY_CODE_RE.test(raw.paymentAccountCurrency)) {
      return { ok: false, error: "Invalid input: 'paymentAccountCurrency' must be a 3-letter uppercase ISO currency code" };
    }
    paymentAccountCurrency = raw.paymentAccountCurrency;
  }

  return {
    ok: true,
    data: Object.freeze({
      country,
      itemPrice: raw.itemPrice,
      shipping: normalizedMoney.shipping,
      production: normalizedMoney.production,
      packaging: normalizedMoney.packaging,
      shippingCost: normalizedMoney.shippingCost,
      giftWrap: normalizedMoney.giftWrap,
      buyerSalesTax: normalizedMoney.buyerSalesTax,
      orderType,
      offsiteAds,
      offsiteRate,
      plusEnabled,
      salesPerMonth,
      targetProfit: normalizedMoney.targetProfit,
      listingCurrency,
      paymentAccountCurrency,
      payoutBalance: raw.payoutBalance !== undefined ? normalizedMoney.payoutBalance : null
    })
  };
}

/**
 * Identifies the single largest deduction category for this order.
 */
function resolveLargestDeduction(validInput, current) {
  const candidates = [
    {
      category: "production_cost",
      label: "production cost",
      amount: validInput.production
    },
    {
      category: "fulfillment_shipping_cost",
      label: "packaging and shipping cost",
      amount: Math.round((validInput.packaging + validInput.shippingCost) * 100) / 100
    },
    {
      category: "offsite_ads_fee",
      label: "Offsite Ads fee",
      amount: current.feeBreakdown.offsiteAds
    },
    {
      category: "core_etsy_fees",
      label: "core Etsy transaction and processing fees",
      amount: Math.round((
        current.feeBreakdown.listing +
        current.feeBreakdown.transaction +
        current.feeBreakdown.processing +
        current.feeBreakdown.regulatory +
        current.feeBreakdown.currencyConversion
      ) * 100) / 100
    },
    {
      category: "etsy_plus_allocation",
      label: "Etsy Plus monthly allocation",
      amount: current.feeBreakdown.etsyPlusAmortized
    }
  ];

  let top = candidates[3]; // default to core Etsy fees
  for (const item of candidates) {
    if (item.amount > top.amount) {
      top = item;
    }
  }

  const gross = current.bases.transactionBase;
  const sharePct = gross > 0 ? Number(((top.amount / gross) * 100).toFixed(2)) : 0;

  return Object.freeze({
    category: top.category,
    label: top.label,
    amount: top.amount,
    sharePct
  });
}

/**
 * Computes all deterministic metrics and comparison scenarios using src/fee-engine.js.
 * The AI model is never allowed to compute any of these values.
 *
 * @param {Object} validInput - Validated input from validateAdvisorInput()
 * @returns {Object} Complete deterministic calculation & scenario package
 */
export function computeDeterministicAnalysis(validInput) {
  const baseParams = {
    country: validInput.country,
    itemPrice: validInput.itemPrice,
    shipping: validInput.shipping,
    giftWrap: validInput.giftWrap,
    buyerSalesTax: validInput.buyerSalesTax,
    orderType: validInput.orderType,
    offsiteAds: validInput.offsiteAds,
    shopOffsiteAdsTier: validInput.offsiteRate || 0.15,
    offsiteRate: validInput.offsiteRate,
    listingCurrency: validInput.listingCurrency,
    paymentAccountCurrency: validInput.paymentAccountCurrency,
    salesPerMonth: validInput.salesPerMonth,
    plusEnabled: validInput.plusEnabled,
    itemCost: validInput.production,
    packagingCost: validInput.packaging,
    shippingCost: validInput.shippingCost
  };

  const current = calculateOrderFees(baseParams);
  const rule = resolveCountryFeeRule(validInput.country, { orderType: validInput.orderType });

  const requiredPriceCents = validInput.targetProfit > 0
    ? solveRequiredPrice(validInput.targetProfit, baseParams)
    : current.legacy.breakEvenCents;
  const requiredPrice = Math.round(requiredPriceCents) / 100;

  // Scenario comparisons computed strictly by fee-engine.js
  const noOffsiteCalc = calculateOrderFees({
    ...baseParams,
    offsiteAds: false,
    offsiteRate: 0,
    shopOffsiteAdsTier: 0
  });
  const offsite15Calc = calculateOrderFees({
    ...baseParams,
    offsiteAds: true,
    offsiteRate: 0.15,
    shopOffsiteAdsTier: 0.15
  });
  const offsite12Calc = calculateOrderFees({
    ...baseParams,
    offsiteAds: true,
    offsiteRate: 0.12,
    shopOffsiteAdsTier: 0.12
  });
  const intlCalc = calculateOrderFees({
    ...baseParams,
    orderType: "international"
  });

  const grossRevenue = current.bases.transactionBase;
  const totalCosts = Math.round((validInput.production + validInput.packaging + validInput.shippingCost + current.feeBreakdown.etsyPlusAmortized) * 100) / 100;
  const marginPct = Number((current.totals.margin * 100).toFixed(2));
  const feeSharePct = grossRevenue > 0
    ? Number(((current.totals.totalEtsyFees / grossRevenue) * 100).toFixed(2))
    : 0;
  const costSharePct = grossRevenue > 0
    ? Number(((totalCosts / grossRevenue) * 100).toFixed(2))
    : 0;

  // Deposit fee evaluation via calculateDepositFee()
  const depositEvalAmount = validInput.payoutBalance !== null
    ? validInput.payoutBalance
    : Math.max(0, current.totals.totalProfit);
  const depositFee = calculateDepositFee(depositEvalAmount, current.informational.depositSchedule);

  const largestDeduction = resolveLargestDeduction(validInput, current);

  const scenarios = Object.freeze({
    noOffsiteAds: Object.freeze({
      totalEtsyFees: noOffsiteCalc.totals.totalEtsyFees,
      netProfit: noOffsiteCalc.totals.totalProfit,
      marginPct: Number((noOffsiteCalc.totals.margin * 100).toFixed(2))
    }),
    offsiteAds15: Object.freeze({
      offsiteAdsFee: offsite15Calc.feeBreakdown.offsiteAds,
      totalEtsyFees: offsite15Calc.totals.totalEtsyFees,
      netProfit: offsite15Calc.totals.totalProfit,
      marginPct: Number((offsite15Calc.totals.margin * 100).toFixed(2))
    }),
    offsiteAds12: Object.freeze({
      offsiteAdsFee: offsite12Calc.feeBreakdown.offsiteAds,
      totalEtsyFees: offsite12Calc.totals.totalEtsyFees,
      netProfit: offsite12Calc.totals.totalProfit,
      marginPct: Number((offsite12Calc.totals.margin * 100).toFixed(2))
    }),
    internationalOrder: Object.freeze({
      processingFee: intlCalc.feeBreakdown.processing,
      totalEtsyFees: intlCalc.totals.totalEtsyFees,
      netProfit: intlCalc.totals.totalProfit,
      marginPct: Number((intlCalc.totals.margin * 100).toFixed(2))
    })
  });

  const metrics = Object.freeze({
    country: current.metadata.country,
    countryName: current.metadata.countryName,
    currency: current.metadata.currency,
    payoutCurrency: current.metadata.payoutCurrency,
    orderType: current.metadata.orderType,
    grossRevenue,
    feeBreakdown: current.feeBreakdown,
    totalEtsyFees: current.totals.totalEtsyFees,
    totalCosts,
    netProfit: current.totals.totalProfit,
    marginPct,
    feeSharePct,
    costSharePct,
    largestDeduction,
    breakEvenPrice: current.totals.breakEvenPrice,
    targetProfit: validInput.targetProfit,
    requiredPriceForTarget: requiredPrice,
    depositFee,
    depositSchedule: current.informational.depositSchedule,
    payoneer: current.informational.payoneer,
    bankFxPossibility: current.informational.bankFxPossibility
  });

  const allowedNumbers = buildAllowedNumberSet(validInput, metrics, scenarios, rule);

  return Object.freeze({
    inputs: validInput,
    metrics,
    scenarios,
    allowedNumbers
  });
}

/**
 * Collects every verified number (rounded to 0, 1, and 2 decimals) from the deterministic
 * calculation so that any numerical claim in AI output can be strictly verified.
 */
function buildAllowedNumberSet(validInput, metrics, scenarios, rule) {
  const rawNumbers = [
    0, 1, 4, 12, 15, 30, 100, 10000,
    OFFICIAL_TRANSACTION_RATE * 100, // 6.5
    DEFAULT_CURRENCY_CONVERSION_RATE * 100, // 2.5
    (rule.processingRate || 0) * 100,
    rule.processingFixed || 0,
    rule.regulatoryRate ? Number((rule.regulatoryRate * 100).toFixed(2)) : 0,
    validInput.itemPrice,
    validInput.shipping,
    validInput.production,
    validInput.packaging,
    validInput.shippingCost,
    validInput.giftWrap,
    validInput.buyerSalesTax,
    validInput.salesPerMonth,
    validInput.targetProfit,
    metrics.grossRevenue,
    metrics.feeBreakdown.listing,
    metrics.feeBreakdown.transaction,
    metrics.feeBreakdown.processing,
    metrics.feeBreakdown.regulatory,
    metrics.feeBreakdown.offsiteAds,
    metrics.feeBreakdown.currencyConversion,
    metrics.feeBreakdown.etsyPlusAmortized,
    metrics.totalEtsyFees,
    metrics.totalCosts,
    metrics.netProfit,
    Math.abs(metrics.netProfit),
    metrics.marginPct,
    Math.abs(metrics.marginPct),
    metrics.feeSharePct,
    metrics.costSharePct,
    metrics.largestDeduction.amount,
    metrics.largestDeduction.sharePct,
    metrics.breakEvenPrice,
    metrics.requiredPriceForTarget,
    metrics.depositFee,
    scenarios.noOffsiteAds.totalEtsyFees,
    scenarios.noOffsiteAds.netProfit,
    scenarios.noOffsiteAds.marginPct,
    scenarios.offsiteAds15.offsiteAdsFee,
    scenarios.offsiteAds15.totalEtsyFees,
    scenarios.offsiteAds15.netProfit,
    scenarios.offsiteAds15.marginPct,
    scenarios.offsiteAds12.offsiteAdsFee,
    scenarios.offsiteAds12.totalEtsyFees,
    scenarios.offsiteAds12.netProfit,
    scenarios.offsiteAds12.marginPct,
    scenarios.internationalOrder.processingFee,
    scenarios.internationalOrder.totalEtsyFees,
    scenarios.internationalOrder.netProfit,
    scenarios.internationalOrder.marginPct
  ];

  if (metrics.depositSchedule?.mode === "listed") {
    rawNumbers.push(
      metrics.depositSchedule.dailyDepositMinimum?.amount ?? 0,
      metrics.depositSchedule.feeThreshold?.amount ?? 0,
      metrics.depositSchedule.fee?.amount ?? 0
    );
  }

  const allowed = new Set();
  for (const val of rawNumbers) {
    if (typeof val === "number" && Number.isFinite(val)) {
      allowed.add(Number(val.toFixed(4)));
      allowed.add(Number(val.toFixed(2)));
      allowed.add(Number(val.toFixed(1)));
      allowed.add(Math.round(val));
    }
  }
  return allowed;
}

/**
 * Extracts all numeric literals from a text string and checks that every single number
 * matches a verified value in allowedNumbers.
 *
 * @param {string} text
 * @param {Set<number>} allowedNumbers
 * @returns {{ valid: boolean, unverifiedNumber?: number }}
 */
export function verifyNoInventedNumbers(text, allowedNumbers) {
  if (typeof text !== "string") {
    return { valid: false };
  }
  const normalized = text.replace(/(\d),(?=\d{3}\b)/g, "$1");
  const matches = normalized.match(/-?\d+(?:\.\d+)?/g);
  if (!matches) {
    return { valid: true };
  }

  for (const token of matches) {
    const num = Number(token);
    if (!Number.isFinite(num)) {
      return { valid: false, unverifiedNumber: NaN };
    }
    const absNum = Math.abs(num);
    const isAllowed =
      allowedNumbers.has(Number(num.toFixed(4))) ||
      allowedNumbers.has(Number(num.toFixed(2))) ||
      allowedNumbers.has(Number(absNum.toFixed(4))) ||
      allowedNumbers.has(Number(absNum.toFixed(2)));
    if (!isAllowed) {
      return { valid: false, unverifiedNumber: num };
    }
  }
  return { valid: true };
}

function matchesAnyMetricValue(num, expectedValues) {
  const n = Math.abs(Number(num));
  for (const exp of expectedValues) {
    if (typeof exp !== "number" || !Number.isFinite(exp)) continue;
    const e = Math.abs(exp);
    if (
      Math.abs(n - e) < 0.015 ||
      Math.abs(n - Number(e.toFixed(1))) < 0.015 ||
      Math.abs(n - Math.round(e)) < 0.015
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Verifies that numerical claims in text are accurately associated with the specific metric
 * they describe (preventing swapped or misattributed figures that happen to be in the allowlist).
 *
 * @param {string} text
 * @param {Object} analysis - Result from computeDeterministicAnalysis()
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyContextualClaims(text, analysis) {
  if (typeof text !== "string") {
    return { valid: false, reason: "invalid_text" };
  }
  const { metrics, scenarios } = analysis;
  const normalized = text.replace(/(\d),(?=\d{3}\b)/g, "$1");

  // 1. Check explicit percentage margin claims: e.g. "61.88% margin" or "margin of 61.88%" or "margin is 61.88%"
  const validMargins = [
    metrics.marginPct,
    scenarios.noOffsiteAds.marginPct,
    scenarios.offsiteAds15.marginPct,
    scenarios.offsiteAds12.marginPct,
    scenarios.internationalOrder.marginPct
  ];
  const marginBeforePatterns = [...normalized.matchAll(/(-?\d+(?:\.\d+)?)\s*%\s*(?:profit\s+|net\s+)?margin/gi)];
  const marginAfterPatterns = [...normalized.matchAll(/margin\s+(?:of|is|at|becomes|reaches|drops\s+to|rises\s+to)\s+(-?\d+(?:\.\d+)?)\s*%/gi)];
  for (const match of [...marginBeforePatterns, ...marginAfterPatterns]) {
    const claimedMargin = Number(match[1]);
    if (!matchesAnyMetricValue(claimedMargin, validMargins)) {
      return { valid: false, reason: "misattributed_margin_claim" };
    }
  }

  // 2. Check break-even price claims: e.g. "break-even price of 7.65" or "break-even floor is 7.65"
  const breakEvenPatterns = [
    ...normalized.matchAll(/break-even(?:\s+item)?(?:\s+price|\s+floor)?\s+(?:is|of|at|to(?:\s+at\s+least)?)\s+(?:[A-Z]{2,3}\s*)?(-?\d+(?:\.\d+)?)/gi),
    ...normalized.matchAll(/(-?\d+(?:\.\d+)?)\s+(?:[A-Z]{3}\s+)?break-even/gi)
  ];
  for (const match of breakEvenPatterns) {
    const claimedBreakEven = Number(match[1]);
    if (!matchesAnyMetricValue(claimedBreakEven, [metrics.breakEvenPrice])) {
      return { valid: false, reason: "misattributed_breakeven_claim" };
    }
  }

  // 3. Check gross revenue claims: e.g. "At 40.00 USD gross revenue" or "gross revenue of 40.00"
  const grossPatterns = [
    ...normalized.matchAll(/(-?\d+(?:\.\d+)?)\s+(?:[A-Z]{3}\s+)?gross\s+revenue/gi),
    ...normalized.matchAll(/gross\s+revenue\s+(?:is|of|at)\s+(?:[A-Z]{2,3}\s*)?(-?\d+(?:\.\d+)?)/gi)
  ];
  for (const match of grossPatterns) {
    const claimedGross = Number(match[1]);
    if (!matchesAnyMetricValue(claimedGross, [metrics.grossRevenue])) {
      return { valid: false, reason: "misattributed_gross_revenue_claim" };
    }
  }

  // 4. Check net profit / net loss claims
  const validNetProfits = [
    metrics.netProfit,
    scenarios.noOffsiteAds.netProfit,
    scenarios.offsiteAds15.netProfit,
    scenarios.offsiteAds12.netProfit,
    scenarios.internationalOrder.netProfit
  ];
  const netPatterns = [
    ...normalized.matchAll(/(-?\d+(?:\.\d+)?)\s+(?:[A-Z]{3}\s+)?(?:estimated\s+)?net\s+(?:profit|loss)/gi),
    ...normalized.matchAll(/net\s+(?:profit|loss)\s+(?:is|of|at|becomes|to)\s+(?:[A-Z]{2,3}\s*)?(-?\d+(?:\.\d+)?)/gi)
  ];
  for (const match of netPatterns) {
    const claimedNet = Number(match[1]);
    if (!matchesAnyMetricValue(claimedNet, validNetProfits)) {
      return { valid: false, reason: "misattributed_net_profit_claim" };
    }
  }

  // 5. Check total Etsy fees claims: e.g. "4.25 USD in Etsy fees" or "Etsy fees of 4.25"
  const validTotalFees = [
    metrics.totalEtsyFees,
    scenarios.noOffsiteAds.totalEtsyFees,
    scenarios.offsiteAds15.totalEtsyFees,
    scenarios.offsiteAds12.totalEtsyFees,
    scenarios.internationalOrder.totalEtsyFees,
    metrics.feeBreakdown.offsiteAds
  ];
  const feePatterns = [
    ...normalized.matchAll(/(-?\d+(?:\.\d+)?)\s+(?:[A-Z]{3}\s+)?in\s+Etsy\s+fees/gi),
    ...normalized.matchAll(/(?:total\s+)?Etsy\s+fees\s+(?:are|is|of|rise\s+to)\s+(?:[A-Z]{2,3}\s*)?(-?\d+(?:\.\d+)?)/gi)
  ];
  for (const match of feePatterns) {
    const claimedFee = Number(match[1]);
    if (!matchesAnyMetricValue(claimedFee, validTotalFees)) {
      return { valid: false, reason: "misattributed_etsy_fee_claim" };
    }
  }

  return { valid: true };
}

const UNSUPPORTED_CONTENT_RE = /\b(?:guaranteed|guarantee|will\s+definitely\s+sell|competitors?|market\s+demand|search\s+volume|conversion\s+rate|best-selling|bestseller|rank\s*#?\s*1)\b/i;

/**
 * Ensures text does not make unsupported claims about market demand, conversion rates,
 * competitors, or guaranteed profits.
 */
export function verifyContentPolicy(text) {
  if (typeof text !== "string") {
    return { valid: false, reason: "invalid_text" };
  }
  if (UNSUPPORTED_CONTENT_RE.test(text)) {
    return { valid: false, reason: "unsupported_market_or_guarantee_claim" };
  }
  return { valid: true };
}

/**
 * Generates a 100% deterministic, rule-based explanation and recommendation report
 * from the verified fee-engine calculation.
 *
 * @param {Object} analysis - Result from computeDeterministicAnalysis()
 * @returns {Object} Structured advisor explanation
 */
export function buildDeterministicExplanation(analysis) {
  const { metrics, scenarios } = analysis;
  const curr = metrics.currency;
  const fmt = (n) => `${Number(n).toFixed(2)} ${curr}`;

  const profitStatus = metrics.netProfit < 0
    ? "loss"
    : (metrics.netProfit === 0 ? "break_even" : (metrics.marginPct < 20 ? "thin_margin" : "profitable"));

  const largestDriverText = metrics.largestDeduction.amount > 0
    ? ` Largest deduction: ${metrics.largestDeduction.label} (${fmt(metrics.largestDeduction.amount)}, ${metrics.largestDeduction.sharePct}% of revenue).`
    : "";

  const summary = metrics.netProfit < 0
    ? `At ${fmt(metrics.grossRevenue)} gross revenue, this order has an estimated net loss of ${fmt(Math.abs(metrics.netProfit))} (${metrics.marginPct}% margin) after ${fmt(metrics.totalEtsyFees)} in Etsy fees and ${fmt(metrics.totalCosts)} in seller costs.${largestDriverText}`
    : `At ${fmt(metrics.grossRevenue)} gross revenue, your estimated net profit is ${fmt(metrics.netProfit)} (${metrics.marginPct}% margin) after ${fmt(metrics.totalEtsyFees)} in Etsy fees (${metrics.feeSharePct}%) and ${fmt(metrics.totalCosts)} in seller costs (${metrics.costSharePct}%).${largestDriverText}`;

  const recommendations = [];

  if (metrics.netProfit <= 0) {
    recommendations.push(
      `Raise item price to at least ${fmt(metrics.breakEvenPrice)} to reach the unit break-even floor.`
    );
  } else {
    recommendations.push(
      `Your unit break-even floor is ${fmt(metrics.breakEvenPrice)}; pricing below ${fmt(metrics.breakEvenPrice)} results in an estimated loss per order.`
    );
  }

  if (metrics.targetProfit > 0) {
    recommendations.push(
      `To target ${fmt(metrics.targetProfit)} in estimated profit per sale, set the item price to ${fmt(metrics.requiredPriceForTarget)}.`
    );
  }

  if (metrics.feeBreakdown.offsiteAds > 0) {
    recommendations.push(
      `Offsite Ads adds ${fmt(metrics.feeBreakdown.offsiteAds)} in fees on this order; without Offsite Ads, estimated net profit is ${fmt(scenarios.noOffsiteAds.netProfit)} (${scenarios.noOffsiteAds.marginPct}% margin).`
    );
  } else {
    recommendations.push(
      `If an order is attributed to 15% Offsite Ads, Etsy fees rise to ${fmt(scenarios.offsiteAds15.totalEtsyFees)} and estimated net profit becomes ${fmt(scenarios.offsiteAds15.netProfit)} (${scenarios.offsiteAds15.marginPct}% margin).`
    );
  }

  if (metrics.feeBreakdown.currencyConversion > 0) {
    recommendations.push(
      `Listing in ${metrics.currency} while receiving payouts in ${metrics.payoutCurrency} adds a 2.5% currency conversion fee of ${fmt(metrics.feeBreakdown.currencyConversion)}.`
    );
  } else if (metrics.depositSchedule?.mode === "listed" && metrics.depositSchedule.feeThreshold?.amount != null) {
    recommendations.push(
      `In ${metrics.countryName}, payouts below ${metrics.depositSchedule.feeThreshold.amount} ${metrics.depositSchedule.feeThreshold.currency} incur a ${metrics.depositSchedule.fee.amount} ${metrics.depositSchedule.fee.currency} deposit fee.`
    );
  } else if (scenarios.internationalOrder.processingFee > metrics.feeBreakdown.processing) {
    recommendations.push(
      `For international buyers, payment processing rises to ${fmt(scenarios.internationalOrder.processingFee)}, leaving ${fmt(scenarios.internationalOrder.netProfit)} estimated net profit (${scenarios.internationalOrder.marginPct}% margin).`
    );
  }

  return Object.freeze({
    profitStatus,
    summary,
    recommendations: Object.freeze(recommendations.slice(0, 4))
  });
}

const UNSAFE_MARKUP_RE = /[<>]|javascript:|data:text\/html|on\w+\s*=/i;

/**
 * Validates raw output from Workers AI against schema, XSS safety, length bounds,
 * content policy, allowlist numbers, and contextual metric-to-number attribution.
 *
 * @param {unknown} rawAiResult
 * @param {Set<number>} allowedNumbers
 * @param {Object} [analysis] - Optional full deterministic analysis for contextual claim verification
 * @returns {{ ok: true, advice: { summary: string, recommendations: string[] } } | { ok: false, reason: string }}
 */
export function validateAiOutput(rawAiResult, allowedNumbers, analysis = null) {
  if (!rawAiResult) {
    return { ok: false, reason: "empty_ai_response" };
  }

  let parsed = rawAiResult;
  if (typeof rawAiResult === "object" && typeof rawAiResult.response === "string") {
    try {
      parsed = JSON.parse(rawAiResult.response);
    } catch {
      return { ok: false, reason: "invalid_ai_json" };
    }
  } else if (typeof rawAiResult === "string") {
    try {
      parsed = JSON.parse(rawAiResult);
    } catch {
      return { ok: false, reason: "invalid_ai_json" };
    }
  } else if (typeof rawAiResult === "object" && rawAiResult.response && typeof rawAiResult.response === "object") {
    parsed = rawAiResult.response;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "invalid_ai_schema" };
  }

  const { summary, recommendations } = parsed;
  if (typeof summary !== "string" || summary.trim().length < 10 || summary.length > 400) {
    return { ok: false, reason: "invalid_ai_summary" };
  }

  if (UNSAFE_MARKUP_RE.test(summary)) {
    return { ok: false, reason: "unsafe_ai_markup" };
  }

  const summaryPolicy = verifyContentPolicy(summary);
  if (!summaryPolicy.valid) {
    return { ok: false, reason: summaryPolicy.reason };
  }

  const summaryCheck = verifyNoInventedNumbers(summary, allowedNumbers);
  if (!summaryCheck.valid) {
    return { ok: false, reason: "unverified_numerical_claim" };
  }

  if (analysis) {
    const summaryContext = verifyContextualClaims(summary, analysis);
    if (!summaryContext.valid) {
      return { ok: false, reason: summaryContext.reason };
    }
  }

  if (!Array.isArray(recommendations) || recommendations.length < 1 || recommendations.length > 4) {
    return { ok: false, reason: "invalid_ai_recommendations" };
  }

  const cleanRecs = [];
  for (const item of recommendations) {
    if (typeof item !== "string" || item.trim().length < 5 || item.length > 240) {
      return { ok: false, reason: "invalid_ai_recommendation_item" };
    }
    if (UNSAFE_MARKUP_RE.test(item)) {
      return { ok: false, reason: "unsafe_ai_markup" };
    }
    const recPolicy = verifyContentPolicy(item);
    if (!recPolicy.valid) {
      return { ok: false, reason: recPolicy.reason };
    }
    const recCheck = verifyNoInventedNumbers(item, allowedNumbers);
    if (!recCheck.valid) {
      return { ok: false, reason: "unverified_numerical_claim" };
    }
    if (analysis) {
      const recContext = verifyContextualClaims(item, analysis);
      if (!recContext.valid) {
        return { ok: false, reason: recContext.reason };
      }
    }
    cleanRecs.push(item.trim());
  }

  return {
    ok: true,
    advice: Object.freeze({
      summary: summary.trim(),
      recommendations: Object.freeze(cleanRecs)
    })
  };
}

/**
 * Generates a grounded profit advisor report.
 * Uses Workers AI ONLY when env.ENABLE_AI_ADVISOR === true and env.AI.run is available.
 * Otherwise, or on any error/timeout/quota/validation failure, returns deterministic advice.
 *
 * @param {unknown} rawInput
 * @param {Object} [env]
 * @returns {Promise<{ ok: boolean, status: number, body: Object }>}
 */
export async function generateAdvisorReport(rawInput, env = {}) {
  const validation = validateAdvisorInput(rawInput);
  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      body: { error: validation.error }
    };
  }

  const analysis = computeDeterministicAnalysis(validation.data);
  const deterministic = buildDeterministicExplanation(analysis);

  const isAiEnabled = Boolean(env?.ENABLE_AI_ADVISOR === true && env?.AI && typeof env.AI.run === "function");
  if (!isAiEnabled) {
    return {
      ok: true,
      status: 200,
      body: {
        source: "deterministic",
        fallbackReason: env?.ENABLE_AI_ADVISOR === true ? "ai_binding_unavailable" : "ai_disabled",
        profitStatus: deterministic.profitStatus,
        summary: deterministic.summary,
        recommendations: deterministic.recommendations,
        metrics: analysis.metrics,
        scenarios: analysis.scenarios
      }
    };
  }

  const requestedModel = env?.AI_ADVISOR_MODEL || DEFAULT_AI_MODEL;
  const model = APPROVED_AI_MODELS.has(requestedModel) ? requestedModel : DEFAULT_AI_MODEL;
  const timeoutMs = Number.isFinite(Number(env?.AI_TIMEOUT_MS)) && Number(env.AI_TIMEOUT_MS) > 0
    ? Number(env.AI_TIMEOUT_MS)
    : DEFAULT_AI_TIMEOUT_MS;

  const systemPrompt = [
    "You are the ShopProfit Etsy Fee & Profit Advisor.",
    "STRICT RULES:",
    "1. Do NOT calculate, round, or invent any numbers. Use ONLY the exact numbers provided in the JSON facts and pair each number with its exact metric name.",
    "2. Identify the largestDeduction driver accurately.",
    "3. Never make claims about market demand, conversion rates, competitors, or guaranteed profits. Frame figures as estimated per-order outcomes.",
    "4. Respond ONLY with a valid JSON object matching: {\"summary\": \"string\", \"recommendations\": [\"string\"]}.",
    "5. Keep 'summary' under 320 characters and provide 2 to 3 concise 'recommendations' under 200 characters each.",
    "6. Never output HTML tags or markdown code fences."
  ].join("\n");

  const structuredFacts = JSON.stringify({
    country: analysis.metrics.countryName,
    currency: analysis.metrics.currency,
    grossRevenue: analysis.metrics.grossRevenue,
    totalEtsyFees: analysis.metrics.totalEtsyFees,
    totalCosts: analysis.metrics.totalCosts,
    largestDeduction: analysis.metrics.largestDeduction,
    netProfit: analysis.metrics.netProfit,
    marginPct: analysis.metrics.marginPct,
    breakEvenPrice: analysis.metrics.breakEvenPrice,
    requiredPriceForTarget: analysis.metrics.requiredPriceForTarget,
    offsiteAds15NetProfit: analysis.scenarios.offsiteAds15.netProfit,
    offsiteAds15MarginPct: analysis.scenarios.offsiteAds15.marginPct
  });

  try {
    const aiPromise = env.AI.run(model, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: structuredFacts }
      ],
      max_tokens: 220,
      temperature: 0.1
    });

    let timerId;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        const err = new Error("AI inference timed out");
        err.code = "AI_TIMEOUT";
        reject(err);
      }, timeoutMs);
    });

    let rawAiResult;
    try {
      rawAiResult = await Promise.race([aiPromise, timeoutPromise]);
    } finally {
      clearTimeout(timerId);
    }

    const validatedAi = validateAiOutput(rawAiResult, analysis.allowedNumbers, analysis);
    if (!validatedAi.ok) {
      return {
        ok: true,
        status: 200,
        body: {
          source: "deterministic_fallback",
          fallbackReason: validatedAi.reason,
          profitStatus: deterministic.profitStatus,
          summary: deterministic.summary,
          recommendations: deterministic.recommendations,
          metrics: analysis.metrics,
          scenarios: analysis.scenarios
        }
      };
    }

    return {
      ok: true,
      status: 200,
      body: {
        source: "workers_ai",
        model,
        usage: rawAiResult?.usage || null,
        profitStatus: deterministic.profitStatus,
        summary: validatedAi.advice.summary,
        recommendations: validatedAi.advice.recommendations,
        metrics: analysis.metrics,
        scenarios: analysis.scenarios
      }
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    let fallbackReason = "ai_inference_error";
    if (err?.code === "AI_TIMEOUT" || msg.includes("timed out") || msg.includes("timeout")) {
      fallbackReason = "ai_timeout";
    } else if (msg.includes("quota") || msg.includes("429") || msg.includes("neuron") || msg.includes("rate limit") || msg.includes("exhausted")) {
      fallbackReason = "ai_quota_exhausted";
    }

    return {
      ok: true,
      status: 200,
      body: {
        source: "deterministic_fallback",
        fallbackReason,
        profitStatus: deterministic.profitStatus,
        summary: deterministic.summary,
        recommendations: deterministic.recommendations,
        metrics: analysis.metrics,
        scenarios: analysis.scenarios
      }
    };
  }
}

/**
 * Isolated HTTP handler for future integration (not mounted on public router).
 * Enforces isolated 'advisor' rate-limit bucket, POST-only method check, Content-Type validation,
 * and 2 KB payload size bound before parsing JSON.
 *
 * @param {Request} request
 * @param {Object} [env]
 * @returns {Promise<Response>}
 */
export async function handleAdvisorRequest(request, env = {}) {
  const method = (request.method || "GET").toUpperCase();
  if (method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed: POST required" }), {
      status: 405,
      headers: {
        ...ADVISOR_RESPONSE_HEADERS,
        "Allow": "POST"
      }
    });
  }

  // Isolated 'advisor' rate-limit bucket (10 req / 60s per IP)
  const rl = checkRateLimit(request, "advisor", {
    windowMs: DEFAULT_WINDOW_MS,
    maxRequests: DEFAULT_ADVISOR_MAX_REQUESTS,
    ...env?.ADVISOR_RATE_LIMIT_OPTIONS
  });
  if (!rl.allowed) {
    return createRateLimitResponse(rl.retryAfter, ADVISOR_RESPONSE_HEADERS);
  }

  const ct = request.headers.get("Content-Type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    return new Response(JSON.stringify({ error: "Unsupported Media Type: Content-Type must be application/json" }), {
      status: 415,
      headers: ADVISOR_RESPONSE_HEADERS
    });
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_ADVISOR_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Payload Too Large: request body exceeds 2048 bytes" }), {
      status: 413,
      headers: ADVISOR_RESPONSE_HEADERS
    });
  }

  const rawText = await request.text();
  const byteLength = new TextEncoder().encode(rawText).byteLength;
  if (byteLength > MAX_ADVISOR_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Payload Too Large: request body exceeds 2048 bytes" }), {
      status: 413,
      headers: ADVISOR_RESPONSE_HEADERS
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return new Response(JSON.stringify({ error: "Bad Request: Malformed JSON body" }), {
      status: 400,
      headers: ADVISOR_RESPONSE_HEADERS
    });
  }

  const result = await generateAdvisorReport(parsed, env);
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: ADVISOR_RESPONSE_HEADERS
  });
}
