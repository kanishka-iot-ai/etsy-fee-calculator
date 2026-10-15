/**
 * ShopProfit — Phase 7D: Deterministic AI Input-Integrity Guard
 *
 * Prevents incorrect, ambiguous, or invented AI-extracted financial inputs from reaching
 * ShopProfit's deterministic fee engine (src/fee-engine.js) and tool layer (worker/src/advisor-tools.js).
 *
 * ARCHITECTURAL & SECURITY INVARIANTS:
 * 1. 100% Deterministic Validation: Never uses an LLM to validate another LLM's financial inputs.
 * 2. Five-Way Input Classification:
 *    - "explicit_value": Explicitly stated in the seller message or confirmed by the seller.
 *    - "confirmed_zero": Explicitly confirmed zero (e.g. "free shipping", "$0 production", confirmZeroProduction, freeShipping, isDigital).
 *    - "missing_value": Omitted (null / undefined) when required.
 *    - "ambiguous_value": Conflicting or scale-ambiguous extraction (e.g. 0.25 vs 25% margin, seller shipping cost confused with buyer shipping, conflicting country/currency, or € without Eurozone country).
 *    - "model_assumption": Unbacked value invented by the model (e.g. silent 0 buyer shipping, invented packaging cost, invented orderType="international", or dropped explicit cost).
 *    - "deterministic_default": Non-material optional field defaulted per explicit product rules.
 * 3. Application-Verified Provenance:
 *    - Tracks provenance ("explicit_message", "seller_confirmed", "deterministic_default", "unresolved_or_ambiguous")
 *      in application code without trusting model-claimed provenance.
 * 4. Confirmation Workflow Boundary:
 *    - If any required/material input is missing, ambiguous, or a model assumption, returns action: "clarify",
 *      identifies the fields, asks a concise question, and executes ZERO financial tools.
 *    - Only when all required inputs are valid and provenance-verified does it execute the allowlisted deterministic tool.
 * 5. Production Invariants:
 *    - Zero D1 access, zero network calls, zero dynamic code execution, zero financial input logging, zero stack-trace exposure.
 */

import {
  GLOBAL_COUNTRY_RULES,
  resolveCountryFeeRule,
  getCurrencyMinorUnitDigits
} from "../../src/fee-engine.js";
import {
  ALLOWED_ADVISOR_TOOLS,
  MIN_SCENARIO_COUNT,
  MAX_SCENARIO_COUNT,
  MAX_ADVISOR_CATALOG_PRODUCTS,
  executeAdvisorTool,
  hasPrototypePollutionAttempt,
  isSafePlainText
} from "./advisor-tools.js";
import { verifyContentPolicy } from "./advisor.js";

export const MAX_GUARD_INPUT_BYTES = 8192;
export const MAX_SELLER_MESSAGE_LENGTH = 2000;
export const MAX_CLARIFICATION_LENGTH = 300;
const MAX_MONETARY_VALUE = 10_000_000;
const MAX_SALES_PER_MONTH = 10_000;

export const INPUT_CLASSIFICATIONS = Object.freeze({
  EXPLICIT_VALUE: "explicit_value",
  CONFIRMED_ZERO: "confirmed_zero",
  MISSING_VALUE: "missing_value",
  AMBIGUOUS_VALUE: "ambiguous_value",
  MODEL_ASSUMPTION: "model_assumption",
  DETERMINISTIC_DEFAULT: "deterministic_default"
});

export const PROVENANCE_SOURCES = Object.freeze({
  EXPLICIT_MESSAGE: "explicit_message",
  SELLER_CONFIRMED: "seller_confirmed",
  DETERMINISTIC_DEFAULT: "deterministic_default",
  UNRESOLVED_OR_AMBIGUOUS: "unresolved_or_ambiguous"
});

export const CANONICAL_UNITS = Object.freeze({
  targetMarginPct: "percentage_points_0.1_to_85",
  offsiteRate: "decimal_rate_0_0.12_0.15",
  itemPrice: "major_currency_units",
  shipping: "major_currency_units",
  production: "major_currency_units",
  packaging: "major_currency_units",
  shippingCost: "major_currency_units",
  targetProfit: "major_currency_units"
});

const ALLOWED_ACTIONS = new Set(["call_tool", "clarify", "refuse"]);
const ALLOWED_TOOLS_SET = new Set(ALLOWED_ADVISOR_TOOLS);
const VALID_ORDER_TYPES = new Set(["domestic", "international"]);
const VALID_CANONICAL_OFFSITE_RATES = new Set([0, 0.12, 0.15]);
const VALID_RAW_OFFSITE_RATES = new Set([0, 0.12, 0.15, 12, 15]);
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;
const COUNTRY_CODE_RE = /^(?:[A-Z]{2}|OTHER)$/;
const FORBIDDEN_PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const SUPPORTED_CURRENCIES = new Set(
  Object.values(GLOBAL_COUNTRY_RULES).map((r) => String(r.currency).toUpperCase())
);

const ALLOWED_TOP_LEVEL_EXTRACTION_KEYS = new Set([
  "action",
  "tool",
  "name",
  "arguments",
  "missingFields",
  "clarificationQuestion"
]);

const ALLOWED_EXTRACTION_ARGUMENT_KEYS = new Set([
  "country",
  "itemPrice",
  "shipping",
  "production",
  "packaging",
  "shippingCost",
  "giftWrap",
  "buyerSalesTax",
  "targetProfit",
  "targetMarginPct",
  "offsiteAds",
  "offsiteRate",
  "orderType",
  "plusEnabled",
  "salesPerMonth",
  "listingCurrency",
  "paymentAccountCurrency",
  "payoutBalance",
  "usdExchangeRate",
  "isDigital",
  "freeShipping",
  "confirmZeroProduction",
  "confirmZeroShipping",
  "scenarios",
  "products"
]);

const ALLOWED_SCENARIO_KEYS = new Set([
  "label",
  "country",
  "itemPrice",
  "shipping",
  "production",
  "packaging",
  "shippingCost",
  "giftWrap",
  "buyerSalesTax",
  "targetProfit",
  "offsiteAds",
  "offsiteRate",
  "orderType"
]);

const ALLOWED_PRODUCT_KEYS = new Set([
  "name",
  "sku",
  "quantity",
  "itemPrice",
  "shipping",
  "production",
  "packaging",
  "shippingCost",
  "giftWrap",
  "buyerSalesTax",
  "targetProfit",
  "offsiteAds",
  "offsiteRate",
  "orderType"
]);

const ALLOWED_CONFIRMED_INPUT_KEYS = new Set([
  ...ALLOWED_EXTRACTION_ARGUMENT_KEYS,
  "confirmSubOnePercentMargin",
  "confirmCrossCurrency"
]);

const ALLOWED_MISSING_FIELD_NAMES = new Set([
  "country",
  "itemPrice",
  "shipping",
  "production",
  "packaging",
  "shippingCost",
  "targetProfit",
  "targetMarginPct",
  "offsiteAds",
  "offsiteRate",
  "orderType",
  "listingCurrency",
  "paymentAccountCurrency",
  "scenarios",
  "products"
]);

const FIELD_CLARIFICATION_QUESTIONS = Object.freeze({
  country: "Which seller country applies to your shop (for example US, UK, CA, DE, AU, IN, JP, TR, or VN)?",
  itemPrice: "What is your item listing price?",
  production: "What is your unit production or material cost (or confirm if it is $0 / a digital download)?",
  shipping: "Do you charge the buyer for shipping or offer free shipping (and what is your actual shipping cost if any)?",
  shippingCost: "What is your actual out-of-pocket shipping cost?",
  packaging: "What is your unit packaging cost?",
  targetProfit: "What target net profit per order (or target profit margin %) would you like to achieve?",
  targetMarginPct: "Please confirm your target net profit margin percentage in percentage points (for example, 25 for a 25% margin).",
  orderType: "Is this a domestic order or an international order?",
  offsiteAds: "Should Offsite Ads (12% or 15%) be applied to this calculation?",
  offsiteRate: "Which Offsite Ads tier rate applies (0%, 12%, or 15%)?",
  listingCurrency: "Which 3-letter ISO currency code applies to your listing and seller country?",
  scenarios: "Which 2 to 4 pricing or shipping scenarios would you like to compare?",
  products: "Please provide between 1 and 10 products (each with a name and positive item price) to analyze."
});

// ─── Safe Plain Object Check ──────────────────────────────────────────────────

function isPlainSafeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return false;
  }
  const ownNames = Object.getOwnPropertyNames(value);
  for (const key of ownNames) {
    if (FORBIDDEN_PROTO_KEYS.has(key)) {
      return false;
    }
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }
  return true;
}

// ─── Deterministic Seller-Message Evidence Extractor (Zero LLM) ───────────────

const MALICIOUS_INJECTION_RE = /\b(?:ignore\s+(?:all\s+|your\s+|previous\s+|prior\s+)?(?:instructions|rules|prompts|system)|do\s+not\s+calculate\s+anything|tell\s+me\s+my\s+profit\s+is|say\s+my\s+profit\s+is|pretend\s+my\s+profit\s+is|bypass\s+(?:validation|security|rules)|system\s+prompt)\b|<\s*\/?\s*script\b|javascript\s*:|data\s*:\s*text\/html/i;

const COUNTRY_NAME_PATTERNS = Object.freeze([
  { code: "US", re: /\b(?:in\s+(?:the\s+)?us|in\s+usa|united\s+states|u\.s\.a?\.|us\s+market|us\s+seller|sell\s+in\s+us)\b/i },
  { code: "UK", re: /\b(?:in\s+(?:the\s+)?uk|united\s+kingdom|great\s+britain|britain|england|uk\s+seller|sell\s+in\s+uk)\b/i },
  { code: "CA", re: /\b(?:canada|canadian|in\s+ca)\b/i },
  { code: "AU", re: /\b(?:australia|australian|in\s+au)\b/i },
  { code: "DE", re: /\b(?:germany|german|deutschland|in\s+de)\b/i },
  { code: "FR", re: /\b(?:france|french)\b/i },
  { code: "IT", re: /\b(?:italy|italian)\b/i },
  { code: "ES", re: /\b(?:spain|spanish)\b/i },
  { code: "NL", re: /\b(?:netherlands|dutch)\b/i },
  { code: "IE", re: /\b(?:ireland|irish)\b/i },
  { code: "AT", re: /\b(?:austria|austrian)\b/i },
  { code: "BE", re: /\b(?:belgium|belgian)\b/i },
  { code: "FI", re: /\b(?:finland|finnish)\b/i },
  { code: "PT", re: /\b(?:portugal|portuguese)\b/i },
  { code: "GR", re: /\b(?:greece|greek)\b/i },
  { code: "IN", re: /\b(?:india|indian)\b/i },
  { code: "JP", re: /\b(?:japan|japanese)\b/i },
  { code: "TR", re: /\b(?:türkiye|turkiye|turkey|turkish)\b/i },
  { code: "VN", re: /\b(?:vietnam|vietnamese)\b/i },
  { code: "NZ", re: /\b(?:new\s+zealand|in\s+nz)\b/i },
  { code: "SG", re: /\b(?:singapore)\b/i },
  { code: "HK", re: /\b(?:hong\s+kong)\b/i },
  { code: "MX", re: /\b(?:mexico|mexican)\b/i },
  { code: "CH", re: /\b(?:switzerland|swiss)\b/i },
  { code: "SE", re: /\b(?:sweden|swedish)\b/i },
  { code: "NO", re: /\b(?:norway|norwegian)\b/i },
  { code: "DK", re: /\b(?:denmark|danish)\b/i },
  { code: "PL", re: /\b(?:poland|polish)\b/i }
]);

const BUYER_COUNTRY_PATTERNS = Object.freeze([
  { code: "US", re: /\b(?:(?:buyer|customer)\s+(?:is\s+)?(?:in|from)\s+(?:the\s+)?(?:us|usa|united\s+states|u\.s\.a?\.)|(?:shipping|ship|selling|sold|sending|delivering)\s+to\s+(?:a\s+(?:buyer|customer)\s+(?:in|from)\s+)?(?:the\s+)?(?:us|usa|united\s+states|u\.s\.a?\.)|(?:to|for)\s+(?:a|an)\s+(?:us|american)\s+(?:buyer|customer))\b/gi },
  { code: "UK", re: /\b(?:(?:buyer|customer)\s+(?:is\s+)?(?:in|from)\s+(?:the\s+)?(?:uk|united\s+kingdom|great\s+britain|britain|england)|(?:shipping|ship|selling|sold|sending|delivering)\s+to\s+(?:a\s+(?:buyer|customer)\s+(?:in|from)\s+)?(?:the\s+)?(?:uk|united\s+kingdom|great\s+britain|britain|england)|(?:to|for)\s+(?:a|an)\s+(?:uk|british)\s+(?:buyer|customer))\b/gi },
  { code: "CA", re: /\b(?:(?:buyer|customer)\s+(?:is\s+)?(?:in|from)\s+canada|(?:shipping|ship|selling|sold|sending|delivering)\s+to\s+(?:a\s+(?:buyer|customer)\s+(?:in|from)\s+)?canada|(?:to|for)\s+(?:a|an)\s+canadian\s+(?:buyer|customer))\b/gi },
  { code: "AU", re: /\b(?:(?:buyer|customer)\s+(?:is\s+)?(?:in|from)\s+australia|(?:shipping|ship|selling|sold|sending|delivering)\s+to\s+(?:a\s+(?:buyer|customer)\s+(?:in|from)\s+)?australia|(?:to|for)\s+(?:a|an)\s+australian\s+(?:buyer|customer))\b/gi },
  { code: "NZ", re: /\b(?:(?:buyer|customer)\s+(?:is\s+)?(?:in|from)\s+new\s+zealand|(?:shipping|ship|selling|sold|sending|delivering)\s+to\s+(?:a\s+(?:buyer|customer)\s+(?:in|from)\s+)?new\s+zealand|(?:to|for)\s+(?:a|an)\s+new\s+zealand\s+(?:buyer|customer))\b/gi },
  { code: "DE", re: /\b(?:(?:buyer|customer)\s+(?:is\s+)?(?:in|from)\s+germany|(?:shipping|ship|selling|sold|sending|delivering)\s+to\s+(?:a\s+(?:buyer|customer)\s+(?:in|from)\s+)?germany|(?:to|for)\s+(?:a|an)\s+german\s+(?:buyer|customer))\b/gi },
  { code: "FR", re: /\b(?:(?:buyer|customer)\s+(?:is\s+)?(?:in|from)\s+france|(?:shipping|ship|selling|sold|sending|delivering)\s+to\s+(?:a\s+(?:buyer|customer)\s+(?:in|from)\s+)?france|(?:to|for)\s+(?:a|an)\s+french\s+(?:buyer|customer))\b/gi }
]);

/**
 * Deterministically evaluates whether transaction type (`orderType`: "domestic" vs "international")
 * materially changes any fee rate or fixed fee in `src/fee-engine.js` for the given seller country.
 *
 * Across ShopProfit's 62-market registry, only CA, AU, and NZ have distinct domestic vs.
 * international payment-processing schedules (3.0% domestic vs. 4.0% international).
 * In the other 59 markets (including US, UK, DE, FR, IT, ES, IN, JP, TR, VN), domestic and
 * international payment-processing schedules are identical.
 *
 * @param {string} countryCode
 * @param {string} [tool="calculate_profit"]
 * @returns {boolean}
 */
export function doesOrderTypeMateriallyAffectCalculation(countryCode, tool = "calculate_profit") {
  if (typeof countryCode !== "string" || !ALLOWED_TOOLS_SET.has(tool)) {
    return false;
  }
  const code = countryCode.trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(GLOBAL_COUNTRY_RULES, code)) {
    return false;
  }
  const domesticRule = resolveCountryFeeRule(code, { orderType: "domestic" });
  const internationalRule = resolveCountryFeeRule(code, { orderType: "international" });
  return (
    domesticRule.processingRate !== internationalRule.processingRate ||
    domesticRule.processingFixed !== internationalRule.processingFixed
  );
}

function parseNumericToken(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function collectRegexNumbers(text, regex) {
  const out = [];
  let match;
  const globalRe = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  while ((match = globalRe.exec(text)) !== null) {
    const n = parseNumericToken(match[1]);
    if (n !== null && !out.includes(n)) {
      out.push(n);
    }
  }
  return out;
}

/**
 * Deterministically extracts numeric, currency, country, shipping, and cost evidence
 * from the original seller message without using any AI model.
 *
 * @param {string} sellerMessage
 * @returns {Object} Structured message evidence
 */
export function extractMessageEvidence(sellerMessage) {
  if (typeof sellerMessage !== "string" || sellerMessage.trim().length === 0) {
    return Object.freeze({
      hasMessage: false,
      isMaliciousPrompt: false,
      numbersInMessage: Object.freeze([]),
      percentagesInMessage: Object.freeze([]),
      explicitCountries: Object.freeze([]),
      explicitBuyerCountries: Object.freeze([]),
      inferredCountriesFromCurrency: Object.freeze([]),
      explicitCurrencies: Object.freeze([]),
      hasAmbiguousEuroOnly: false,
      sellerShippingCostValues: Object.freeze([]),
      buyerShippingValues: Object.freeze([]),
      hasExplicitFreeShipping: false,
      admitsMissingShipping: false,
      productionCostValues: Object.freeze([]),
      hasExplicitZeroProduction: false,
      packagingCostValues: Object.freeze([]),
      hasExplicitInternational: false,
      hasExplicitDomestic: false,
      hasExplicitOffsiteAds: false
    });
  }

  const text = sellerMessage.slice(0, MAX_SELLER_MESSAGE_LENGTH);
  const isMaliciousPrompt = MALICIOUS_INJECTION_RE.test(text);

  // 1. All numbers in message
  const numbersInMessage = [];
  const numRe = /(?<![A-Za-z0-9_])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![A-Za-z0-9_])/g;
  let m;
  while ((m = numRe.exec(text)) !== null) {
    const val = parseNumericToken(m[1]);
    if (val !== null && !numbersInMessage.includes(val)) {
      numbersInMessage.push(val);
    }
  }

  // 2. Explicit percentages (e.g. "25%", "12%", "15%", "0.25 percent")
  const percentagesInMessage = collectRegexNumbers(
    text,
    /(?<![A-Za-z0-9_])(\d+(?:\.\d+)?)\s*(?:%|percent\b)/gi
  );

  // 3. Explicit buyer countries vs explicit seller countries (never equate buyer country with seller country)
  const explicitBuyerCountries = [];
  let sellerCountryScanText = text;
  for (const { code, re } of BUYER_COUNTRY_PATTERNS) {
    const globalBuyerRe = new RegExp(re.source, "gi");
    if (globalBuyerRe.test(text)) {
      if (!explicitBuyerCountries.includes(code)) {
        explicitBuyerCountries.push(code);
      }
      sellerCountryScanText = sellerCountryScanText.replace(new RegExp(re.source, "gi"), " ");
    }
  }

  const explicitCountries = [];
  for (const { code, re } of COUNTRY_NAME_PATTERNS) {
    if (re.test(sellerCountryScanText) && !explicitCountries.includes(code)) {
      explicitCountries.push(code);
    }
  }

  // 4. Explicit currencies & unambiguous currency-to-country mapping
  const explicitCurrencies = [];
  const inferredCountriesFromCurrency = [];
  const addCurrency = (curr, countryCode = null) => {
    if (!explicitCurrencies.includes(curr)) explicitCurrencies.push(curr);
    // Do not infer seller country from currency alone if the message only named a buyer country without a seller country
    const buyerOnlyWithoutSeller = explicitBuyerCountries.length > 0 && explicitCountries.length === 0;
    if (countryCode && !buyerOnlyWithoutSeller && !inferredCountriesFromCurrency.includes(countryCode)) {
      inferredCountriesFromCurrency.push(countryCode);
    }
  };

  if (/\bCA\$|\bCAD\b/i.test(text)) addCurrency("CAD", "CA");
  if (/\bA\$|\bAUD\b/i.test(text)) addCurrency("AUD", "AU");
  if (/\bNZ\$|\bNZD\b/i.test(text)) addCurrency("NZD", "NZ");
  if (/\bHK\$|\bHKD\b/i.test(text)) addCurrency("HKD", "HK");
  if (/\bS\$|\bSGD\b/i.test(text)) addCurrency("SGD", "SG");
  if (/\bMX\$|\bMXN\b/i.test(text)) addCurrency("MXN", "MX");
  if (/£|\bGBP\b/i.test(text)) addCurrency("GBP", "UK");
  if (/₹|\bINR\b/i.test(text)) addCurrency("INR", "IN");
  if (/¥|\bJPY\b/i.test(text)) addCurrency("JPY", "JP");
  if (/₺|\bTRY\b/i.test(text)) addCurrency("TRY", "TR");
  if (/₫|\bVND\b/i.test(text)) addCurrency("VND", "VN");
  if (/€|\bEUR\b/i.test(text)) addCurrency("EUR", null);

  // Match standalone '$' (not preceded by CA, A, NZ, HK, S, MX, US) or 'USD'
  if (/\bUS\$|\bUSD\b|(?<![A-Za-z])\$(?=\s*\d)/i.test(text)) {
    addCurrency("USD", "US");
  }

  const hasAmbiguousEuroOnly =
    explicitCurrencies.includes("EUR") &&
    explicitCurrencies.length === 1 &&
    explicitCountries.length === 0;

  // 5. Seller shipping cost vs Buyer-paid shipping
  const CURR_PREFIX = `(?:CA\\$|A\\$|NZ\\$|HK\\$|S\\$|MX\\$|US\\$|[£$€₹¥₺₫]|USD|GBP|CAD|EUR|AUD|INR|JPY|TRY|VND)?\\s*`;
  const NUM_CAP = `(\\d+(?:,\\d{3})*(?:\\.\\d+)?)`;

  const sellerShippingPatterns = [
    new RegExp(`(?:shipping|postage|delivery|label)\\s+costs?\\s+me\\s+${CURR_PREFIX}${NUM_CAP}`, "gi"),
    new RegExp(`my\\s+(?:actual\\s+)?(?:shipping|postage|label)\\s+costs?\\s+(?:is\\s+)?${CURR_PREFIX}${NUM_CAP}`, "gi"),
    new RegExp(`costs?\\s+(?:me\\s+)?${CURR_PREFIX}${NUM_CAP}\\s+to\\s+(?:ship|post|mail)`, "gi"),
    new RegExp(`(?:actual|seller|out[- ]of[- ]pocket)\\s+(?:shipping|postage)\\s+(?:cost\\s+)?(?:is\\s+|of\\s+)?${CURR_PREFIX}${NUM_CAP}`, "gi"),
    new RegExp(`${CURR_PREFIX}${NUM_CAP}\\s+(?:postage|shipping\\s+label)\\s+costs?`, "gi"),
    new RegExp(`(?:with|and)\\s+${CURR_PREFIX}${NUM_CAP}\\s+(?:in\\s+|for\\s+)?(?:postage|shipping\\s+cost|shipping\\s+label)`, "gi")
  ];
  const sellerShippingCostValues = [];
  for (const re of sellerShippingPatterns) {
    for (const v of collectRegexNumbers(text, re)) {
      if (!sellerShippingCostValues.includes(v)) sellerShippingCostValues.push(v);
    }
  }

  const buyerShippingPatterns = [
    new RegExp(`(?:plus|\\+)\\s*${CURR_PREFIX}${NUM_CAP}\\s+(?:shipping|postage|delivery)`, "gi"),
    new RegExp(`(?:ships|posted)\\s+for\\s+${CURR_PREFIX}${NUM_CAP}`, "gi"),
    new RegExp(`buyer\\s+pays\\s+${CURR_PREFIX}${NUM_CAP}\\s*(?:for\\s+)?(?:shipping|postage)?`, "gi"),
    new RegExp(`charge(?:s|d)?\\s+(?:the\\s+buyer\\s+)?${CURR_PREFIX}${NUM_CAP}\\s+(?:for\\s+)?(?:shipping|postage)`, "gi"),
    new RegExp(`${CURR_PREFIX}${NUM_CAP}\\s+(?:buyer\\s+)?(?:shipping|postage)\\s+charged`, "gi"),
    new RegExp(`${CURR_PREFIX}${NUM_CAP}\\s+buyer(?:[- ]paid)?\\s+(?:shipping|postage|delivery)`, "gi"),
    new RegExp(`buyer(?:[- ]paid)?\\s+(?:shipping|postage|delivery)\\s+(?:is\\s+|of\\s+)?${CURR_PREFIX}${NUM_CAP}`, "gi")
  ];
  const buyerShippingValues = [];
  for (const re of buyerShippingPatterns) {
    for (const v of collectRegexNumbers(text, re)) {
      if (!buyerShippingValues.includes(v)) buyerShippingValues.push(v);
    }
  }

  const hasExplicitFreeShipping =
    /\bfree\s+(?:shipping|postage|delivery)\b|\b(?:shipping|postage)\s+is\s+free\b|\bno\s+(?:buyer\s+)?(?:shipping|postage)\s+charge\b|\bcharge\s+\$?0(?:\.00)?\s+(?:for\s+)?(?:shipping|postage)\b|\b\$?0(?:\.00)?\s+(?:buyer\s+)?(?:shipping|postage)\b/i.test(
      text
    );

  const admitsMissingShipping =
    /\bforgot\s+to\s+mention\s+(?:my\s+)?(?:shipping|postage)\b|\bwhat\s+do\s+you\s+need\s+to\s+know\s+before\s+calculating\b/i.test(
      text
    );

  // 6. Production / materials cost & packaging cost
  const productionPatterns = [
    new RegExp(`(?:materials?|production|cogs|making)\\s+costs?\\s+(?:is\\s+|me\\s+)?${CURR_PREFIX}${NUM_CAP}`, "gi"),
    new RegExp(`my\\s+(?:unit\\s+|product\\s+|material\\s+|production\\s+)?costs?\\s+(?:is\\s+|are\\s+|me\\s+)?${CURR_PREFIX}${NUM_CAP}`, "gi"),
    new RegExp(`costs?\\s+(?:me\\s+)?${CURR_PREFIX}${NUM_CAP}\\s+to\\s+(?:make|produce|manufacture)`, "gi"),
    new RegExp(`${CURR_PREFIX}${NUM_CAP}\\s+to\\s+(?:make|produce)`, "gi"),
    new RegExp(`${CURR_PREFIX}${NUM_CAP}\\s+(?:production|materials?|manufacturing)(?:\\s+costs?)?`, "gi")
  ];
  const productionCostValues = [];
  for (const re of productionPatterns) {
    for (const v of collectRegexNumbers(text, re)) {
      if (!productionCostValues.includes(v)) productionCostValues.push(v);
    }
  }

  const hasExplicitZeroProduction =
    /\bdigital\s+(?:product|download|item|file|listing)\b|\bno\s+(?:production|material|making|manufacturing)\s+costs?\b|\bzero\s+(?:production|material)\s+costs?\b|\b(?:production|materials?)\s+costs?\s+(?:is\s+|me\s+)?\$?0(?:\.00)?\b|\bcosts?\s+\$?0(?:\.00)?\s+to\s+make\b/i.test(
      text
    );

  const packagingPatterns = [
    new RegExp(`packaging\\s+(?:costs?\\s+)?(?:is\\s+|me\\s+)?${CURR_PREFIX}${NUM_CAP}`, "gi"),
    new RegExp(`costs?\\s+(?:me\\s+)?${CURR_PREFIX}${NUM_CAP}\\s+to\\s+package`, "gi"),
    new RegExp(`${CURR_PREFIX}${NUM_CAP}\\s+to\\s+package`, "gi"),
    new RegExp(`${CURR_PREFIX}${NUM_CAP}\\s+packaging(?:\\s+costs?)?`, "gi")
  ];
  const packagingCostValues = [];
  for (const re of packagingPatterns) {
    for (const v of collectRegexNumbers(text, re)) {
      if (!packagingCostValues.includes(v)) packagingCostValues.push(v);
    }
  }

  const explicitCrossBorderPair =
    explicitCountries.length === 1 &&
    explicitBuyerCountries.length === 1 &&
    explicitCountries[0] !== explicitBuyerCountries[0];
  const explicitSameCountryPair =
    explicitCountries.length === 1 &&
    explicitBuyerCountries.length === 1 &&
    explicitCountries[0] === explicitBuyerCountries[0];

  const hasExplicitInternational =
    /\b(?:international|cross[- ]border|overseas|abroad|foreign\s+buyer)\b/i.test(text) ||
    explicitCrossBorderPair;
  const hasExplicitDomestic =
    /\b(?:domestic|domestically)\b/i.test(text) ||
    explicitSameCountryPair;
  const hasExplicitOffsiteAds = /\boffsite\s+ads?\b/i.test(text);

  return Object.freeze({
    hasMessage: true,
    isMaliciousPrompt,
    numbersInMessage: Object.freeze(numbersInMessage),
    percentagesInMessage: Object.freeze(percentagesInMessage),
    explicitCountries: Object.freeze(explicitCountries),
    explicitBuyerCountries: Object.freeze(explicitBuyerCountries),
    inferredCountriesFromCurrency: Object.freeze(inferredCountriesFromCurrency),
    explicitCurrencies: Object.freeze(explicitCurrencies),
    hasAmbiguousEuroOnly,
    sellerShippingCostValues: Object.freeze(sellerShippingCostValues),
    buyerShippingValues: Object.freeze(buyerShippingPatterns.length ? buyerShippingValues : []),
    hasExplicitFreeShipping,
    admitsMissingShipping,
    productionCostValues: Object.freeze(productionCostValues),
    hasExplicitZeroProduction,
    packagingCostValues: Object.freeze(packagingCostValues),
    hasExplicitInternational,
    hasExplicitDomestic,
    hasExplicitOffsiteAds
  });
}

// ─── Helper to Build Concise Clarification Question ───────────────────────────

function buildClarificationQuestion(fields, customReasons = {}) {
  const parts = [];
  for (const field of fields) {
    const q = customReasons[field] || FIELD_CLARIFICATION_QUESTIONS[field];
    if (q && !parts.includes(q)) {
      parts.push(q);
    }
  }
  const joined = parts.join(" ").trim();
  if (!joined) {
    return FIELD_CLARIFICATION_QUESTIONS.shipping;
  }
  return joined.slice(0, MAX_CLARIFICATION_LENGTH);
}

function numberMatchesSet(val, numArray) {
  if (typeof val !== "number" || !Number.isFinite(val)) return false;
  return numArray.some((n) => Math.abs(n - val) < 1e-6);
}

// ─── Core Input-Integrity & Provenance Validator (Steps 2, 3, 4, 5, 6, 7) ─────

/**
 * Deterministically validates AI-extracted intent/arguments against strict schema, numeric types,
 * shipping semantics, percentage/currency canonical units, and seller-message provenance.
 *
 * Never uses an LLM and never coerces invalid string types into numbers.
 *
 * @param {string|Object} rawExtraction - Raw JSON string or object from the AI model
 * @param {Object} [context] - { sellerMessage?: string, confirmedInputs?: Object, requireConfirmedCosts?: boolean }
 * @returns {Object} Validation, provenance, and confirmation-boundary result
 */
export function validateAiExtractedInput(rawExtraction, context = {}) {
  const sellerMessage = typeof context.sellerMessage === "string" ? context.sellerMessage : "";
  const requireConfirmedCosts = context.requireConfirmedCosts !== false;

  if (sellerMessage.length > MAX_SELLER_MESSAGE_LENGTH) {
    return Object.freeze({
      ok: false,
      status: "rejected",
      error: "seller_message_too_long",
      message: `Seller message exceeds maximum length of ${MAX_SELLER_MESSAGE_LENGTH} characters`,
      action: "refuse",
      tool: null,
      canExecuteTool: false
    });
  }

  // Validate confirmedInputs if provided
  const confirmedInputs = context.confirmedInputs ?? {};
  if (!isPlainSafeObject(confirmedInputs) || hasPrototypePollutionAttempt(confirmedInputs)) {
    return Object.freeze({
      ok: false,
      status: "rejected",
      error: "invalid_confirmed_inputs",
      message: "confirmedInputs must be a plain JSON object without prototype pollution keys",
      action: "refuse",
      tool: null,
      canExecuteTool: false
    });
  }
  for (const k of Object.keys(confirmedInputs)) {
    if (!ALLOWED_CONFIRMED_INPUT_KEYS.has(k)) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "unexpected_confirmed_input_field",
        message: `Unexpected field '${k}' in confirmedInputs`,
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
  }

  const evidence = extractMessageEvidence(sellerMessage);

  // Immediate prompt-injection refusal based on sellerMessage
  if (evidence.isMaliciousPrompt) {
    return Object.freeze({
      ok: true,
      status: "refused",
      action: "refuse",
      tool: null,
      canExecuteTool: false,
      missingFields: Object.freeze([]),
      ambiguousFields: Object.freeze([]),
      modelAssumptions: Object.freeze([]),
      clarificationQuestion: null,
      provenance: Object.freeze({}),
      verifiedArguments: null
    });
  }

  // Parse and bound rawExtraction
  let parsed;
  if (typeof rawExtraction === "string") {
    const byteLen = new TextEncoder().encode(rawExtraction).byteLength;
    if (byteLen > MAX_GUARD_INPUT_BYTES) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "payload_too_large",
        message: `AI extraction exceeds maximum size of ${MAX_GUARD_INPUT_BYTES} bytes`,
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
    try {
      parsed = JSON.parse(rawExtraction);
    } catch {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "invalid_json",
        message: "AI extraction is not valid JSON",
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
  } else if (isPlainSafeObject(rawExtraction)) {
    let serialized;
    try {
      serialized = JSON.stringify(rawExtraction);
    } catch {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "invalid_json",
        message: "AI extraction object could not be serialized",
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
    if (new TextEncoder().encode(serialized).byteLength > MAX_GUARD_INPUT_BYTES) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "payload_too_large",
        message: `AI extraction exceeds maximum size of ${MAX_GUARD_INPUT_BYTES} bytes`,
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
    parsed = rawExtraction;
  } else {
    return Object.freeze({
      ok: false,
      status: "rejected",
      error: "invalid_extraction_root",
      message: "AI extraction must be a JSON object or JSON string",
      action: "refuse",
      tool: null,
      canExecuteTool: false
    });
  }

  if (!isPlainSafeObject(parsed) || hasPrototypePollutionAttempt(parsed)) {
    return Object.freeze({
      ok: false,
      status: "rejected",
      error: "prototype_pollution_or_invalid_object",
      message: "AI extraction contains forbidden prototype keys or non-plain object structure",
      action: "refuse",
      tool: null,
      canExecuteTool: false
    });
  }

  for (const k of Object.keys(parsed)) {
    if (!ALLOWED_TOP_LEVEL_EXTRACTION_KEYS.has(k)) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "unexpected_top_level_property",
        message: `Unexpected top-level property '${k}' in AI extraction`,
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
  }

  // Support both flat routing envelope ({ action, tool, arguments }) and direct tool call ({ name, arguments })
  const action = parsed.action !== undefined ? parsed.action : "call_tool";
  let tool = parsed.tool !== undefined ? parsed.tool : (parsed.name ?? null);

  if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
    return Object.freeze({
      ok: false,
      status: "rejected",
      error: "invalid_action",
      message: `Invalid action '${String(action)}'`,
      action: "refuse",
      tool: null,
      canExecuteTool: false
    });
  }

  if (action === "refuse") {
    return Object.freeze({
      ok: true,
      status: "refused",
      action: "refuse",
      tool: null,
      canExecuteTool: false,
      missingFields: Object.freeze([]),
      ambiguousFields: Object.freeze([]),
      modelAssumptions: Object.freeze([]),
      clarificationQuestion: null,
      provenance: Object.freeze({}),
      verifiedArguments: null
    });
  }

  // Validate missingFields and clarificationQuestion if present on envelope
  if (parsed.missingFields !== undefined && parsed.missingFields !== null) {
    if (!Array.isArray(parsed.missingFields)) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "invalid_missing_fields",
        message: "missingFields must be an array",
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
    for (const mf of parsed.missingFields) {
      if (typeof mf !== "string" || !ALLOWED_MISSING_FIELD_NAMES.has(mf)) {
        return Object.freeze({
          ok: false,
          status: "rejected",
          error: "invalid_missing_field_name",
          message: `Invalid field name '${String(mf)}' in missingFields`,
          action: "refuse",
          tool: null,
          canExecuteTool: false
        });
      }
    }
  }

  if (parsed.clarificationQuestion !== undefined && parsed.clarificationQuestion !== null && parsed.clarificationQuestion !== "") {
    if (
      !isSafePlainText(parsed.clarificationQuestion, MAX_CLARIFICATION_LENGTH) ||
      !verifyContentPolicy(parsed.clarificationQuestion).valid
    ) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "unsafe_clarification_question",
        message: "clarificationQuestion failed safe plain-text or content-policy validation",
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
  }

  if (action === "clarify") {
    if (tool !== null) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "tool_must_be_null_on_clarify",
        message: "tool must be null when action is 'clarify'",
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
    const reportedMissing = Array.isArray(parsed.missingFields) && parsed.missingFields.length > 0
      ? parsed.missingFields
      : ["shipping"];
    const question =
      typeof parsed.clarificationQuestion === "string" && parsed.clarificationQuestion.trim().length > 0
        ? parsed.clarificationQuestion.trim()
        : buildClarificationQuestion(reportedMissing);

    return Object.freeze({
      ok: true,
      status: "needs_clarification",
      action: "clarify",
      tool: null,
      canExecuteTool: false,
      missingFields: Object.freeze([...reportedMissing]),
      ambiguousFields: Object.freeze([]),
      modelAssumptions: Object.freeze([]),
      clarificationQuestion: question,
      provenance: Object.freeze({}),
      verifiedArguments: null
    });
  }

  // From here, action === "call_tool": validate allowlisted tool name
  if (typeof tool !== "string" || !ALLOWED_TOOLS_SET.has(tool)) {
    return Object.freeze({
      ok: false,
      status: "rejected",
      error: "unauthorized_tool",
      message: `Tool '${String(tool)}' is not in the allowlisted ShopProfit advisor tools`,
      action: "refuse",
      tool: null,
      canExecuteTool: false
    });
  }

  // If the seller explicitly admitted missing shipping in the message (e.g. P07) and has not confirmed shipping,
  // force action: "clarify" even if a model attempted to call a tool.
  if (
    evidence.admitsMissingShipping &&
    confirmedInputs.shipping === undefined &&
    confirmedInputs.freeShipping !== true &&
    confirmedInputs.confirmZeroShipping !== true
  ) {
    return Object.freeze({
      ok: true,
      status: "needs_clarification",
      action: "clarify",
      tool: null,
      canExecuteTool: false,
      missingFields: Object.freeze(["shipping", "shippingCost"]),
      ambiguousFields: Object.freeze([]),
      modelAssumptions: Object.freeze([]),
      clarificationQuestion: FIELD_CLARIFICATION_QUESTIONS.shipping,
      provenance: Object.freeze({}),
      verifiedArguments: null
    });
  }

  const rawArgs = parsed.arguments;
  if (!isPlainSafeObject(rawArgs) || hasPrototypePollutionAttempt(rawArgs)) {
    return Object.freeze({
      ok: false,
      status: "rejected",
      error: "invalid_arguments_object",
      message: "arguments must be a plain JSON object without prototype pollution keys",
      action: "refuse",
      tool: null,
      canExecuteTool: false
    });
  }

  for (const k of Object.keys(rawArgs)) {
    if (!ALLOWED_EXTRACTION_ARGUMENT_KEYS.has(k)) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "unexpected_argument_field",
        message: `Unexpected field '${k}' in arguments`,
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
  }

  // Dynamic tool refinement: if the tool was calculate_profit but neither extracted args nor confirmedInputs have itemPrice,
  // and targetMarginPct or targetProfit is provided, route to find_target_price.
  if (
    (tool === "calculate_profit" || tool === "compare_price_scenarios") &&
    confirmedInputs.itemPrice === undefined &&
    (!Array.isArray(confirmedInputs.scenarios) || confirmedInputs.scenarios.length === 0) &&
    (rawArgs?.itemPrice === undefined || rawArgs?.itemPrice === null) &&
    (!Array.isArray(rawArgs?.scenarios) || rawArgs.scenarios.length === 0) &&
    (confirmedInputs.targetMarginPct !== undefined ||
      confirmedInputs.targetProfit !== undefined ||
      rawArgs?.targetMarginPct !== undefined ||
      rawArgs?.targetProfit !== undefined)
  ) {
    tool = "find_target_price";
  }

  // ─── Strict Type & Range Validation (ZERO String-to-Number Coercion) ─────────

  const numericArgFields = [
    "itemPrice",
    "shipping",
    "production",
    "packaging",
    "shippingCost",
    "giftWrap",
    "buyerSalesTax",
    "targetProfit",
    "targetMarginPct",
    "offsiteRate",
    "salesPerMonth",
    "payoutBalance",
    "usdExchangeRate"
  ];

  for (const field of numericArgFields) {
    for (const [sourceLabel, obj] of [["arguments", rawArgs], ["confirmedInputs", confirmedInputs]]) {
      const val = obj[field];
      if (val !== undefined && val !== null) {
        if (typeof val !== "number" || !Number.isFinite(val)) {
          return Object.freeze({
            ok: false,
            status: "rejected",
            error: "invalid_numeric_type",
            message: `Field '${sourceLabel}.${field}' must be a finite number or null (received ${typeof val})`,
            action: "refuse",
            tool: null,
            canExecuteTool: false
          });
        }
        if (val < 0 || val > MAX_MONETARY_VALUE) {
          return Object.freeze({
            ok: false,
            status: "rejected",
            error: "numeric_out_of_range",
            message: `Field '${sourceLabel}.${field}' is out of range (0 to ${MAX_MONETARY_VALUE})`,
            action: "refuse",
            tool: null,
            canExecuteTool: false
          });
        }
        if (field === "salesPerMonth" && (!Number.isInteger(val) || val < 1 || val > MAX_SALES_PER_MONTH)) {
          return Object.freeze({
            ok: false,
            status: "rejected",
            error: "numeric_out_of_range",
            message: "Field 'salesPerMonth' must be an integer between 1 and 10,000",
            action: "refuse",
            tool: null,
            canExecuteTool: false
          });
        }
      }
    }
  }

  const booleanArgFields = [
    "offsiteAds",
    "plusEnabled",
    "isDigital",
    "freeShipping",
    "confirmZeroProduction",
    "confirmZeroShipping"
  ];
  for (const bField of booleanArgFields) {
    for (const [sourceLabel, obj] of [["arguments", rawArgs], ["confirmedInputs", confirmedInputs]]) {
      const val = obj[bField];
      if (val !== undefined && val !== null && typeof val !== "boolean") {
        return Object.freeze({
          ok: false,
          status: "rejected",
          error: "invalid_boolean_type",
          message: `Field '${sourceLabel}.${bField}' must be a boolean or null (received ${typeof val})`,
          action: "refuse",
          tool: null,
          canExecuteTool: false
        });
      }
    }
  }

  // Validate scenarios array structure if present (reject stringified scenarios from Phase 7B!)
  if (rawArgs.scenarios !== undefined && rawArgs.scenarios !== null) {
    if (!Array.isArray(rawArgs.scenarios)) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "invalid_scenarios_type",
        message: "Field 'arguments.scenarios' must be a structured JSON array of objects, not a string",
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
    const isEmptyOnOtherTool = rawArgs.scenarios.length === 0 && tool !== "compare_price_scenarios";
    if (!isEmptyOnOtherTool && (rawArgs.scenarios.length < MIN_SCENARIO_COUNT || rawArgs.scenarios.length > MAX_SCENARIO_COUNT)) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "scenarios_count_out_of_bounds",
        message: `Field 'arguments.scenarios' must contain between ${MIN_SCENARIO_COUNT} and ${MAX_SCENARIO_COUNT} items`,
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
    for (let i = 0; i < rawArgs.scenarios.length; i++) {
      const sc = rawArgs.scenarios[i];
      if (!isPlainSafeObject(sc) || hasPrototypePollutionAttempt(sc)) {
        return Object.freeze({
          ok: false,
          status: "rejected",
          error: "invalid_scenario_item",
          message: `Scenario at index ${i} must be a plain JSON object`,
          action: "refuse",
          tool: null,
          canExecuteTool: false
        });
      }
      for (const sk of Object.keys(sc)) {
        if (!ALLOWED_SCENARIO_KEYS.has(sk)) {
          return Object.freeze({
            ok: false,
            status: "rejected",
            error: "unexpected_scenario_field",
            message: `Unexpected field '${sk}' in scenarios[${i}]`,
            action: "refuse",
            tool: null,
            canExecuteTool: false
          });
        }
      }
      if (!isSafePlainText(sc.label, 80) || !verifyContentPolicy(sc.label).valid) {
        return Object.freeze({
          ok: false,
          status: "rejected",
          error: "unsafe_scenario_label",
          message: `Scenario at index ${i} has an invalid or unsafe label`,
          action: "refuse",
          tool: null,
          canExecuteTool: false
        });
      }
      if (typeof sc.itemPrice !== "number" || !Number.isFinite(sc.itemPrice) || sc.itemPrice <= 0 || sc.itemPrice > MAX_MONETARY_VALUE) {
        return Object.freeze({
          ok: false,
          status: "rejected",
          error: "invalid_scenario_item_price",
          message: `Scenario at index ${i} must have a finite positive numeric itemPrice`,
          action: "refuse",
          tool: null,
          canExecuteTool: false
        });
      }
      for (const snf of ["shipping", "production", "packaging", "shippingCost", "giftWrap", "buyerSalesTax", "targetProfit", "offsiteRate"]) {
        if (sc[snf] !== undefined && sc[snf] !== null) {
          if (typeof sc[snf] !== "number" || !Number.isFinite(sc[snf]) || sc[snf] < 0 || sc[snf] > MAX_MONETARY_VALUE) {
            return Object.freeze({
              ok: false,
              status: "rejected",
              error: "invalid_scenario_numeric_field",
              message: `Scenario at index ${i} field '${snf}' must be a finite non-negative number`,
              action: "refuse",
              tool: null,
              canExecuteTool: false
            });
          }
        }
      }
    }
  }

  // Validate products array structure if present
  if (rawArgs.products !== undefined && rawArgs.products !== null) {
    const isEmptyProductsOnOtherTool =
      Array.isArray(rawArgs.products) && rawArgs.products.length === 0 && tool !== "analyze_product_catalog";
    if (!Array.isArray(rawArgs.products) || (!isEmptyProductsOnOtherTool && (rawArgs.products.length < 1 || rawArgs.products.length > MAX_ADVISOR_CATALOG_PRODUCTS))) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "invalid_products_array",
        message: `Field 'arguments.products' must be an array of 1 to ${MAX_ADVISOR_CATALOG_PRODUCTS} products`,
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
    for (let i = 0; i < rawArgs.products.length; i++) {
      const prod = rawArgs.products[i];
      if (!isPlainSafeObject(prod) || hasPrototypePollutionAttempt(prod)) {
        return Object.freeze({
          ok: false,
          status: "rejected",
          error: "invalid_product_item",
          message: `Product at index ${i} must be a plain JSON object`,
          action: "refuse",
          tool: null,
          canExecuteTool: false
        });
      }
      for (const pk of Object.keys(prod)) {
        if (!ALLOWED_PRODUCT_KEYS.has(pk)) {
          return Object.freeze({
            ok: false,
            status: "rejected",
            error: "unexpected_product_field",
            message: `Unexpected field '${pk}' in products[${i}]`,
            action: "refuse",
            tool: null,
            canExecuteTool: false
          });
        }
      }
      if (!isSafePlainText(prod.name, 120) || !verifyContentPolicy(prod.name).valid) {
        return Object.freeze({
          ok: false,
          status: "rejected",
          error: "unsafe_product_name",
          message: `Product at index ${i} has an invalid or unsafe name`,
          action: "refuse",
          tool: null,
          canExecuteTool: false
        });
      }
      if (typeof prod.itemPrice !== "number" || !Number.isFinite(prod.itemPrice) || prod.itemPrice <= 0 || prod.itemPrice > MAX_MONETARY_VALUE) {
        return Object.freeze({
          ok: false,
          status: "rejected",
          error: "invalid_product_item_price",
          message: `Product at index ${i} must have a finite positive numeric itemPrice`,
          action: "refuse",
          tool: null,
          canExecuteTool: false
        });
      }
    }
  }

  // ─── Provenance Tracking & Semantic Guards (Steps 2, 3, 4, 5) ──────────────

  const provenance = {};
  const missingFields = [];
  const ambiguousFields = [];
  const modelAssumptions = [];
  const customReasons = {};

  const flagMissing = (field, reason) => {
    if (!missingFields.includes(field)) missingFields.push(field);
    if (reason) customReasons[field] = reason;
  };
  const flagAmbiguous = (field, reason) => {
    if (!ambiguousFields.includes(field)) ambiguousFields.push(field);
    flagMissing(field, reason);
  };
  const flagAssumption = (field, reason) => {
    if (!modelAssumptions.includes(field)) modelAssumptions.push(field);
    flagMissing(field, reason);
  };

  const recordProvenance = (field, value, classification, source, reason = null) => {
    provenance[field] = Object.freeze({
      value,
      classification,
      provenance: source,
      ...(reason ? { reason } : {})
    });
  };

  // 1. Validate Country & Currency Consistency
  let verifiedCountry = null;
  const candidateCountry = confirmedInputs.country ?? rawArgs.country;

  if (candidateCountry !== undefined && candidateCountry !== null) {
    if (
      typeof candidateCountry !== "string" ||
      !COUNTRY_CODE_RE.test(candidateCountry) ||
      !Object.prototype.hasOwnProperty.call(GLOBAL_COUNTRY_RULES, candidateCountry)
    ) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "invalid_country",
        message: `Unsupported or invalid country code '${String(candidateCountry)}'`,
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }

    if (confirmedInputs.country !== undefined && confirmedInputs.country !== null) {
      verifiedCountry = candidateCountry;
      recordProvenance("country", verifiedCountry, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.SELLER_CONFIRMED);
    } else if (evidence.hasMessage) {
      if (evidence.hasAmbiguousEuroOnly) {
        recordProvenance(
          "country",
          candidateCountry,
          INPUT_CLASSIFICATIONS.AMBIGUOUS_VALUE,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          "Euro (€) applies to multiple Eurozone countries with different regulatory fee rules; please specify your seller country."
        );
        flagAmbiguous("country", FIELD_CLARIFICATION_QUESTIONS.country);
      } else if (
        evidence.explicitCountries.length === 0 &&
        evidence.inferredCountriesFromCurrency.length === 0
      ) {
        recordProvenance(
          "country",
          candidateCountry,
          INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          `Model assumed country '${candidateCountry}' without country or currency evidence in the seller message.`
        );
        flagAssumption("country", FIELD_CLARIFICATION_QUESTIONS.country);
      } else if (
        evidence.explicitCountries.length > 0 &&
        !evidence.explicitCountries.includes(candidateCountry)
      ) {
        recordProvenance(
          "country",
          candidateCountry,
          INPUT_CLASSIFICATIONS.AMBIGUOUS_VALUE,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          `Extracted country '${candidateCountry}' conflicts with country '${evidence.explicitCountries[0]}' in seller message.`
        );
        flagAmbiguous("country", FIELD_CLARIFICATION_QUESTIONS.country);
      } else {
        const expectedRule = resolveCountryFeeRule(candidateCountry);
        const hasConflictingSingleCurrency =
          evidence.explicitCurrencies.length > 0 &&
          !evidence.explicitCurrencies.includes(expectedRule.currency) &&
          confirmedInputs.confirmCrossCurrency !== true &&
          rawArgs.listingCurrency === undefined;

        if (hasConflictingSingleCurrency) {
          recordProvenance(
            "country",
            candidateCountry,
            INPUT_CLASSIFICATIONS.AMBIGUOUS_VALUE,
            PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
            `Country '${candidateCountry}' (${expectedRule.currency}) conflicts with currency (${evidence.explicitCurrencies.join(", ")}) in the seller message.`
          );
          flagAmbiguous(
            "country",
            `Your message mentions ${evidence.explicitCurrencies[0]} but country '${candidateCountry}' uses ${expectedRule.currency}. Which seller country and listing currency apply?`
          );
        } else {
          verifiedCountry = candidateCountry;
          recordProvenance("country", verifiedCountry, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
        }
      }
    } else {
      verifiedCountry = candidateCountry;
      recordProvenance("country", verifiedCountry, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
    }
  } else {
    recordProvenance("country", null, INPUT_CLASSIFICATIONS.MISSING_VALUE, PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS);
    flagMissing("country", FIELD_CLARIFICATION_QUESTIONS.country);
  }

  // Validate optional listingCurrency & paymentAccountCurrency
  for (const currField of ["listingCurrency", "paymentAccountCurrency"]) {
    const cVal = confirmedInputs[currField] ?? rawArgs[currField];
    if (cVal !== undefined && cVal !== null) {
      if (typeof cVal !== "string" || !CURRENCY_CODE_RE.test(cVal) || !SUPPORTED_CURRENCIES.has(cVal)) {
        return Object.freeze({
          ok: false,
          status: "rejected",
          error: "invalid_currency_code",
          message: `Invalid or unsupported currency code '${String(cVal)}' in '${currField}'`,
          action: "refuse",
          tool: null,
          canExecuteTool: false
        });
      }
      if (
        currField === "listingCurrency" &&
        verifiedCountry &&
        confirmedInputs.confirmCrossCurrency !== true
      ) {
        const rule = resolveCountryFeeRule(verifiedCountry);
        if (cVal !== rule.currency && (!evidence.hasMessage || !evidence.explicitCurrencies.includes(cVal))) {
          recordProvenance(
            currField,
            cVal,
            INPUT_CLASSIFICATIONS.AMBIGUOUS_VALUE,
            PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
            `Listing currency '${cVal}' does not match default currency '${rule.currency}' for '${verifiedCountry}' without confirmation.`
          );
          flagAmbiguous("listingCurrency", FIELD_CLARIFICATION_QUESTIONS.listingCurrency);
        }
      }
    }
  }

  // 2. Validate Order Type ("domestic" vs "international") — Phase 7H.1 Step 3
  // Never equate seller country, buyer country, domestic vs. international transaction, currency, or fee schedule.
  // Never automatically set orderType="domestic" in markets where orderType materially changes the fee schedule (CA, AU, NZ)
  // merely because the original message lacks the word "international".
  // Never ask for orderType in markets where domestic and international fee schedules are identical (e.g. US, UK, DE).
  // Never treat an AI-invented orderType as seller-confirmed.
  let verifiedOrderType = "domestic";
  const orderTypeMatters = verifiedCountry
    ? doesOrderTypeMateriallyAffectCalculation(verifiedCountry, tool)
    : false;

  if (confirmedInputs.orderType !== undefined && confirmedInputs.orderType !== null) {
    if (!VALID_ORDER_TYPES.has(confirmedInputs.orderType)) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "invalid_order_type",
        message: "orderType must be 'domestic' or 'international'",
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
    verifiedOrderType = confirmedInputs.orderType;
    recordProvenance("orderType", verifiedOrderType, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.SELLER_CONFIRMED);
  } else {
    if (rawArgs.orderType !== undefined && rawArgs.orderType !== null && !VALID_ORDER_TYPES.has(rawArgs.orderType)) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "invalid_order_type",
        message: "orderType must be 'domestic' or 'international'",
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }

    if (evidence.hasMessage && evidence.hasExplicitInternational && evidence.hasExplicitDomestic) {
      recordProvenance(
        "orderType",
        rawArgs.orderType ?? null,
        INPUT_CLASSIFICATIONS.AMBIGUOUS_VALUE,
        PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
        "Seller message contains conflicting domestic and international transaction indicators."
      );
      flagAmbiguous("orderType", FIELD_CLARIFICATION_QUESTIONS.orderType);
    } else if (evidence.hasMessage && evidence.hasExplicitInternational) {
      verifiedOrderType = "international";
      recordProvenance("orderType", "international", INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
    } else if (evidence.hasMessage && evidence.hasExplicitDomestic) {
      verifiedOrderType = "domestic";
      recordProvenance("orderType", "domestic", INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
    } else if (!evidence.hasMessage && rawArgs.orderType !== undefined && rawArgs.orderType !== null) {
      verifiedOrderType = rawArgs.orderType;
      recordProvenance("orderType", verifiedOrderType, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
    } else if (orderTypeMatters) {
      // In CA, AU, and NZ, domestic (3.0%) vs. international (4.0%) payment-processing rates materially change the result.
      if (rawArgs.orderType !== undefined && rawArgs.orderType !== null) {
        recordProvenance(
          "orderType",
          rawArgs.orderType,
          INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          `Model assumed orderType='${rawArgs.orderType}' in ${verifiedCountry} where domestic and international payment-processing rates differ, without explicit seller evidence.`
        );
        flagAssumption("orderType", FIELD_CLARIFICATION_QUESTIONS.orderType);
      } else {
        recordProvenance(
          "orderType",
          null,
          INPUT_CLASSIFICATIONS.MISSING_VALUE,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          `Transaction type (domestic vs. international) materially affects payment-processing fees in ${verifiedCountry} and was not specified.`
        );
        flagMissing("orderType", FIELD_CLARIFICATION_QUESTIONS.orderType);
      }
    } else {
      // Transaction type is irrelevant to the fee calculation in this market (domestic rate === international rate).
      // Do not ask for it, and never record an unconfirmed model orderType as seller-confirmed or explicit-message.
      verifiedOrderType = "domestic";
      recordProvenance(
        "orderType",
        "domestic",
        INPUT_CLASSIFICATIONS.DETERMINISTIC_DEFAULT,
        PROVENANCE_SOURCES.DETERMINISTIC_DEFAULT,
        rawArgs.orderType !== undefined && rawArgs.orderType !== null
          ? `Order type does not change fee calculation in ${verifiedCountry || "this market"}; unconfirmed model orderType='${rawArgs.orderType}' normalized to deterministic default.`
          : undefined
      );
    }
  }

  // 3. Validate Item Price
  const requiresTopItemPrice = tool === "calculate_profit" || tool === "analyze_offsite_ads";
  let verifiedItemPrice = undefined;
  const candidateItemPrice = confirmedInputs.itemPrice ?? rawArgs.itemPrice;

  if (candidateItemPrice !== undefined && candidateItemPrice !== null) {
    if (candidateItemPrice <= 0) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "invalid_item_price",
        message: "itemPrice must be greater than 0",
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
    if (confirmedInputs.itemPrice !== undefined && confirmedInputs.itemPrice !== null) {
      verifiedItemPrice = candidateItemPrice;
      recordProvenance("itemPrice", verifiedItemPrice, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.SELLER_CONFIRMED);
    } else if (evidence.hasMessage && !numberMatchesSet(candidateItemPrice, evidence.numbersInMessage)) {
      recordProvenance(
        "itemPrice",
        candidateItemPrice,
        INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
        PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
        `Model invented itemPrice=${candidateItemPrice} not present in the seller message.`
      );
      flagAssumption("itemPrice", FIELD_CLARIFICATION_QUESTIONS.itemPrice);
    } else {
      verifiedItemPrice = candidateItemPrice;
      recordProvenance("itemPrice", verifiedItemPrice, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
    }
  } else if (requiresTopItemPrice) {
    recordProvenance("itemPrice", null, INPUT_CLASSIFICATIONS.MISSING_VALUE, PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS);
    flagMissing("itemPrice", FIELD_CLARIFICATION_QUESTIONS.itemPrice);
  }

  const isDigital = Boolean(
    confirmedInputs.isDigital === true ||
    (rawArgs.isDigital === true && (!evidence.hasMessage || evidence.hasExplicitZeroProduction))
  );
  const confirmZeroProduction = Boolean(
    isDigital ||
    confirmedInputs.confirmZeroProduction === true ||
    confirmedInputs.production === 0 ||
    (rawArgs.confirmZeroProduction === true && (!evidence.hasMessage || evidence.hasExplicitZeroProduction)) ||
    evidence.hasExplicitZeroProduction
  );
  const confirmZeroShipping = Boolean(
    isDigital ||
    confirmedInputs.freeShipping === true ||
    confirmedInputs.confirmZeroShipping === true ||
    confirmedInputs.shipping === 0 ||
    (rawArgs.freeShipping === true && (!evidence.hasMessage || evidence.hasExplicitFreeShipping)) ||
    (rawArgs.confirmZeroShipping === true && (!evidence.hasMessage || evidence.hasExplicitFreeShipping)) ||
    evidence.hasExplicitFreeShipping
  );

  // 4. Validate Seller Shipping Cost (shippingCost) & Buyer Shipping (shipping) — Step 4
  let verifiedShippingCost = 0;
  const candidateShippingCost = confirmedInputs.shippingCost ?? rawArgs.shippingCost;

  if (confirmedInputs.shippingCost !== undefined && confirmedInputs.shippingCost !== null) {
    verifiedShippingCost = confirmedInputs.shippingCost;
    recordProvenance(
      "shippingCost",
      verifiedShippingCost,
      verifiedShippingCost === 0 ? INPUT_CLASSIFICATIONS.CONFIRMED_ZERO : INPUT_CLASSIFICATIONS.EXPLICIT_VALUE,
      PROVENANCE_SOURCES.SELLER_CONFIRMED
    );
  } else if (rawArgs.shippingCost !== undefined && rawArgs.shippingCost !== null) {
    if (rawArgs.shippingCost > 0) {
      if (evidence.hasMessage && !numberMatchesSet(rawArgs.shippingCost, evidence.numbersInMessage)) {
        recordProvenance(
          "shippingCost",
          rawArgs.shippingCost,
          INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          `Model invented shippingCost=${rawArgs.shippingCost} not present in the seller message.`
        );
        flagAssumption("shippingCost", FIELD_CLARIFICATION_QUESTIONS.shippingCost);
      } else {
        verifiedShippingCost = rawArgs.shippingCost;
        recordProvenance("shippingCost", verifiedShippingCost, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
      }
    } else {
      // rawArgs.shippingCost === 0
      if (evidence.hasMessage && evidence.sellerShippingCostValues.length > 0) {
        recordProvenance(
          "shippingCost",
          0,
          INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          `Seller stated shipping cost (${evidence.sellerShippingCostValues[0]}) but model set shippingCost=0.`
        );
        flagAssumption("shippingCost", FIELD_CLARIFICATION_QUESTIONS.shippingCost);
      } else {
        verifiedShippingCost = 0;
        recordProvenance("shippingCost", 0, INPUT_CLASSIFICATIONS.DETERMINISTIC_DEFAULT, PROVENANCE_SOURCES.DETERMINISTIC_DEFAULT);
      }
    }
  } else {
    // shippingCost is null/undefined: check if seller explicitly stated a shipping cost that the model dropped
    const scenariosHaveShippingCost =
      Array.isArray(rawArgs.scenarios) &&
      rawArgs.scenarios.some((s) => typeof s.shippingCost === "number" && s.shippingCost > 0);
    if (evidence.hasMessage && evidence.sellerShippingCostValues.length > 0 && !scenariosHaveShippingCost) {
      recordProvenance(
        "shippingCost",
        null,
        INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
        PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
        `Seller stated shipping cost (${evidence.sellerShippingCostValues[0]}) but model omitted shippingCost.`
      );
      flagAssumption("shippingCost", FIELD_CLARIFICATION_QUESTIONS.shippingCost);
    } else if (evidence.hasMessage && evidence.sellerShippingCostValues.length === 1 && scenariosHaveShippingCost) {
      verifiedShippingCost = evidence.sellerShippingCostValues[0];
      recordProvenance("shippingCost", verifiedShippingCost, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
    } else {
      verifiedShippingCost = 0;
      recordProvenance("shippingCost", 0, INPUT_CLASSIFICATIONS.DETERMINISTIC_DEFAULT, PROVENANCE_SOURCES.DETERMINISTIC_DEFAULT);
    }
  }

  // Buyer-paid shipping (shipping)
  const isSingleProductTool =
    tool === "calculate_profit" || tool === "find_target_price" || tool === "analyze_offsite_ads";
  let verifiedShipping = 0;

  if (confirmedInputs.shipping !== undefined && confirmedInputs.shipping !== null) {
    if (confirmedInputs.freeShipping === true && confirmedInputs.shipping > 0) {
      recordProvenance(
        "shipping",
        confirmedInputs.shipping,
        INPUT_CLASSIFICATIONS.AMBIGUOUS_VALUE,
        PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
        "freeShipping=true conflicts with positive buyer shipping charge."
      );
      flagAmbiguous("shipping", FIELD_CLARIFICATION_QUESTIONS.shipping);
    } else {
      verifiedShipping = confirmedInputs.shipping;
      recordProvenance(
        "shipping",
        verifiedShipping,
        verifiedShipping === 0 ? INPUT_CLASSIFICATIONS.CONFIRMED_ZERO : INPUT_CLASSIFICATIONS.EXPLICIT_VALUE,
        PROVENANCE_SOURCES.SELLER_CONFIRMED
      );
    }
  } else if (confirmedInputs.freeShipping === true || confirmedInputs.confirmZeroShipping === true || confirmedInputs.isDigital === true) {
    verifiedShipping = 0;
    recordProvenance("shipping", 0, INPUT_CLASSIFICATIONS.CONFIRMED_ZERO, PROVENANCE_SOURCES.SELLER_CONFIRMED);
  } else if (rawArgs.shipping !== undefined && rawArgs.shipping !== null) {
    if (rawArgs.shipping === 0) {
      // Model returned shipping: 0 -> Only valid if free shipping was explicitly confirmed or stated in sellerMessage
      if (confirmZeroShipping || !isSingleProductTool || !requireConfirmedCosts) {
        verifiedShipping = 0;
        recordProvenance(
          "shipping",
          0,
          confirmZeroShipping ? INPUT_CLASSIFICATIONS.CONFIRMED_ZERO : INPUT_CLASSIFICATIONS.DETERMINISTIC_DEFAULT,
          evidence.hasExplicitFreeShipping ? PROVENANCE_SOURCES.EXPLICIT_MESSAGE : PROVENANCE_SOURCES.DETERMINISTIC_DEFAULT
        );
      } else {
        // Exact Phase 7C P01 failure mode: model silently set shipping=0 when buyer shipping was never mentioned!
        recordProvenance(
          "shipping",
          0,
          INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          "Model silently set buyer shipping to 0 without an explicit free-shipping statement or confirmation."
        );
        flagAssumption("shipping", FIELD_CLARIFICATION_QUESTIONS.shipping);
      }
    } else {
      // rawArgs.shipping > 0
      if (rawArgs.freeShipping === true && isSingleProductTool) {
        recordProvenance(
          "shipping",
          rawArgs.shipping,
          INPUT_CLASSIFICATIONS.AMBIGUOUS_VALUE,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          "freeShipping=true conflicts with positive buyer shipping charge."
        );
        flagAmbiguous("shipping", FIELD_CLARIFICATION_QUESTIONS.shipping);
      } else if (evidence.hasMessage) {
        if (!numberMatchesSet(rawArgs.shipping, evidence.numbersInMessage)) {
          recordProvenance(
            "shipping",
            rawArgs.shipping,
            INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
            PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
            `Model invented buyer shipping=${rawArgs.shipping} not present in the seller message.`
          );
          flagAssumption("shipping", FIELD_CLARIFICATION_QUESTIONS.shipping);
        } else if (
          (numberMatchesSet(rawArgs.shipping, evidence.sellerShippingCostValues) &&
            !numberMatchesSet(rawArgs.shipping, evidence.buyerShippingValues)) ||
          (evidence.sellerShippingCostValues.length > 0 && evidence.buyerShippingValues.length === 0)
        ) {
          // Exact Phase 7B P01 failure mode: seller said "shipping costs me $4" and model put 4 into buyer shipping!
          recordProvenance(
            "shipping",
            rawArgs.shipping,
            INPUT_CLASSIFICATIONS.AMBIGUOUS_VALUE,
            PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
            `Seller shipping cost (${rawArgs.shipping}) does not establish whether the buyer pays shipping.`
          );
          flagAmbiguous("shipping", FIELD_CLARIFICATION_QUESTIONS.shipping);
        } else {
          verifiedShipping = rawArgs.shipping;
          recordProvenance("shipping", verifiedShipping, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
        }
      } else {
        verifiedShipping = rawArgs.shipping;
        recordProvenance("shipping", verifiedShipping, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
      }
    }
  } else {
    // rawArgs.shipping is null or undefined
    if (confirmZeroShipping && isSingleProductTool) {
      verifiedShipping = 0;
      recordProvenance(
        "shipping",
        0,
        INPUT_CLASSIFICATIONS.CONFIRMED_ZERO,
        evidence.hasExplicitFreeShipping ? PROVENANCE_SOURCES.EXPLICIT_MESSAGE : PROVENANCE_SOURCES.SELLER_CONFIRMED
      );
    } else if (
      evidence.hasMessage &&
      evidence.buyerShippingValues.length === 1 &&
      !evidence.hasExplicitFreeShipping &&
      !evidence.admitsMissingShipping
    ) {
      verifiedShipping = evidence.buyerShippingValues[0];
      recordProvenance(
        "shipping",
        verifiedShipping,
        INPUT_CLASSIFICATIONS.EXPLICIT_VALUE,
        PROVENANCE_SOURCES.EXPLICIT_MESSAGE
      );
    } else if (isSingleProductTool && requireConfirmedCosts) {
      recordProvenance(
        "shipping",
        null,
        INPUT_CLASSIFICATIONS.MISSING_VALUE,
        PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
        "Buyer shipping arrangement is unspecified."
      );
      flagMissing("shipping", FIELD_CLARIFICATION_QUESTIONS.shipping);
    } else {
      verifiedShipping = 0;
      recordProvenance("shipping", 0, INPUT_CLASSIFICATIONS.DETERMINISTIC_DEFAULT, PROVENANCE_SOURCES.DETERMINISTIC_DEFAULT);
    }
  }

  // 5. Validate Production Cost (production)
  let verifiedProduction = 0;
  if (confirmedInputs.production !== undefined && confirmedInputs.production !== null) {
    verifiedProduction = confirmedInputs.production;
    recordProvenance(
      "production",
      verifiedProduction,
      verifiedProduction === 0 ? INPUT_CLASSIFICATIONS.CONFIRMED_ZERO : INPUT_CLASSIFICATIONS.EXPLICIT_VALUE,
      PROVENANCE_SOURCES.SELLER_CONFIRMED
    );
  } else if (confirmedInputs.confirmZeroProduction === true || confirmedInputs.isDigital === true) {
    verifiedProduction = 0;
    recordProvenance("production", 0, INPUT_CLASSIFICATIONS.CONFIRMED_ZERO, PROVENANCE_SOURCES.SELLER_CONFIRMED);
  } else if (rawArgs.production !== undefined && rawArgs.production !== null) {
    if (rawArgs.production === 0) {
      if (confirmZeroProduction || !isSingleProductTool || !requireConfirmedCosts) {
        verifiedProduction = 0;
        recordProvenance(
          "production",
          0,
          confirmZeroProduction ? INPUT_CLASSIFICATIONS.CONFIRMED_ZERO : INPUT_CLASSIFICATIONS.DETERMINISTIC_DEFAULT,
          evidence.hasExplicitZeroProduction ? PROVENANCE_SOURCES.EXPLICIT_MESSAGE : PROVENANCE_SOURCES.DETERMINISTIC_DEFAULT
        );
      } else {
        // Phase 7B P04 failure mode: model silently set production=0 without confirmation
        recordProvenance(
          "production",
          0,
          INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          "Model silently set production cost to 0 without explicit zero-cost confirmation."
        );
        flagAssumption("production", FIELD_CLARIFICATION_QUESTIONS.production);
      }
    } else {
      if (evidence.hasMessage && !numberMatchesSet(rawArgs.production, evidence.numbersInMessage)) {
        recordProvenance(
          "production",
          rawArgs.production,
          INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          `Model invented production=${rawArgs.production} not present in the seller message.`
        );
        flagAssumption("production", FIELD_CLARIFICATION_QUESTIONS.production);
      } else {
        verifiedProduction = rawArgs.production;
        recordProvenance("production", verifiedProduction, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
      }
    }
  } else {
    // rawArgs.production is null/undefined
    const scenariosHaveProduction =
      Array.isArray(rawArgs.scenarios) &&
      rawArgs.scenarios.some((s) => typeof s.production === "number" && s.production > 0);

    if (evidence.hasMessage && evidence.productionCostValues.length > 0 && !scenariosHaveProduction) {
      // Phase 7B P03 & P09 failure mode: seller stated production cost ($12 or $200) and model dropped it!
      recordProvenance(
        "production",
        null,
        INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
        PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
        `Seller stated production cost (${evidence.productionCostValues[0]}) in message, but model omitted it.`
      );
      flagAssumption("production", FIELD_CLARIFICATION_QUESTIONS.production);
    } else if (evidence.hasMessage && evidence.productionCostValues.length === 1 && scenariosHaveProduction) {
      verifiedProduction = evidence.productionCostValues[0];
      recordProvenance("production", verifiedProduction, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
    } else if (confirmZeroProduction && isSingleProductTool) {
      verifiedProduction = 0;
      recordProvenance(
        "production",
        0,
        INPUT_CLASSIFICATIONS.CONFIRMED_ZERO,
        evidence.hasExplicitZeroProduction ? PROVENANCE_SOURCES.EXPLICIT_MESSAGE : PROVENANCE_SOURCES.SELLER_CONFIRMED
      );
    } else if (isSingleProductTool && requireConfirmedCosts) {
      recordProvenance(
        "production",
        null,
        INPUT_CLASSIFICATIONS.MISSING_VALUE,
        PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
        "Production or material cost is unspecified."
      );
      flagMissing("production", FIELD_CLARIFICATION_QUESTIONS.production);
    } else {
      verifiedProduction = 0;
      recordProvenance("production", 0, INPUT_CLASSIFICATIONS.DETERMINISTIC_DEFAULT, PROVENANCE_SOURCES.DETERMINISTIC_DEFAULT);
    }
  }

  // 6. Validate Packaging, GiftWrap, BuyerSalesTax (Optional fields, but must NEVER be invented!)
  let verifiedPackaging = 0;
  if (confirmedInputs.packaging !== undefined && confirmedInputs.packaging !== null) {
    verifiedPackaging = confirmedInputs.packaging;
    recordProvenance(
      "packaging",
      verifiedPackaging,
      verifiedPackaging === 0 ? INPUT_CLASSIFICATIONS.CONFIRMED_ZERO : INPUT_CLASSIFICATIONS.EXPLICIT_VALUE,
      PROVENANCE_SOURCES.SELLER_CONFIRMED
    );
  } else if (rawArgs.packaging !== undefined && rawArgs.packaging !== null) {
    if (rawArgs.packaging > 0) {
      if (evidence.hasMessage && !numberMatchesSet(rawArgs.packaging, evidence.numbersInMessage)) {
        // Exact Phase 7B P05 failure mode: model invented packaging=3 when 3 was not in the message!
        recordProvenance(
          "packaging",
          rawArgs.packaging,
          INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          `Model invented packaging=${rawArgs.packaging} not present in the seller message.`
        );
        flagAssumption("packaging", FIELD_CLARIFICATION_QUESTIONS.packaging);
      } else {
        verifiedPackaging = rawArgs.packaging;
        recordProvenance("packaging", verifiedPackaging, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
      }
    } else {
      if (evidence.hasMessage && evidence.packagingCostValues.length > 0) {
        recordProvenance(
          "packaging",
          0,
          INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          `Seller stated packaging cost (${evidence.packagingCostValues[0]}) but model set packaging=0.`
        );
        flagAssumption("packaging", FIELD_CLARIFICATION_QUESTIONS.packaging);
      } else {
        verifiedPackaging = 0;
        recordProvenance("packaging", 0, INPUT_CLASSIFICATIONS.DETERMINISTIC_DEFAULT, PROVENANCE_SOURCES.DETERMINISTIC_DEFAULT);
      }
    }
  } else {
    const scenariosHavePackaging =
      Array.isArray(rawArgs.scenarios) &&
      rawArgs.scenarios.some((s) => typeof s.packaging === "number" && s.packaging > 0);
    if (evidence.hasMessage && evidence.packagingCostValues.length > 0 && !scenariosHavePackaging) {
      recordProvenance(
        "packaging",
        null,
        INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
        PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
        `Seller stated packaging cost (${evidence.packagingCostValues[0]}) in message, but model omitted it.`
      );
      flagAssumption("packaging", FIELD_CLARIFICATION_QUESTIONS.packaging);
    } else if (evidence.hasMessage && evidence.packagingCostValues.length === 1 && scenariosHavePackaging) {
      verifiedPackaging = evidence.packagingCostValues[0];
      recordProvenance("packaging", verifiedPackaging, INPUT_CLASSIFICATIONS.EXPLICIT_VALUE, PROVENANCE_SOURCES.EXPLICIT_MESSAGE);
    } else {
      verifiedPackaging = 0;
      recordProvenance("packaging", 0, INPUT_CLASSIFICATIONS.DETERMINISTIC_DEFAULT, PROVENANCE_SOURCES.DETERMINISTIC_DEFAULT);
    }
  }

  let verifiedGiftWrap = 0;
  const candidateGiftWrap = confirmedInputs.giftWrap ?? rawArgs.giftWrap;
  if (candidateGiftWrap !== undefined && candidateGiftWrap !== null && candidateGiftWrap > 0) {
    if (confirmedInputs.giftWrap === undefined && evidence.hasMessage && !numberMatchesSet(candidateGiftWrap, evidence.numbersInMessage)) {
      recordProvenance("giftWrap", candidateGiftWrap, INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION, PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS);
      flagAssumption("giftWrap", "What gift wrap charge applies to this order?");
    } else {
      verifiedGiftWrap = candidateGiftWrap;
      recordProvenance(
        "giftWrap",
        verifiedGiftWrap,
        INPUT_CLASSIFICATIONS.EXPLICIT_VALUE,
        confirmedInputs.giftWrap !== undefined ? PROVENANCE_SOURCES.SELLER_CONFIRMED : PROVENANCE_SOURCES.EXPLICIT_MESSAGE
      );
    }
  }

  let verifiedBuyerSalesTax = 0;
  const candidateTax = confirmedInputs.buyerSalesTax ?? rawArgs.buyerSalesTax;
  if (candidateTax !== undefined && candidateTax !== null && candidateTax > 0) {
    if (confirmedInputs.buyerSalesTax === undefined && evidence.hasMessage && !numberMatchesSet(candidateTax, evidence.numbersInMessage)) {
      recordProvenance("buyerSalesTax", candidateTax, INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION, PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS);
      flagAssumption("buyerSalesTax", "What buyer sales tax amount applies to this order?");
    } else {
      verifiedBuyerSalesTax = candidateTax;
      recordProvenance(
        "buyerSalesTax",
        verifiedBuyerSalesTax,
        INPUT_CLASSIFICATIONS.EXPLICIT_VALUE,
        confirmedInputs.buyerSalesTax !== undefined ? PROVENANCE_SOURCES.SELLER_CONFIRMED : PROVENANCE_SOURCES.EXPLICIT_MESSAGE
      );
    }
  }

  // 7. Validate Target Profit & Target Margin Percentage (Step 5: 25% vs 0.25% Guard)
  let verifiedTargetProfit = 0;
  const candidateTargetProfit = confirmedInputs.targetProfit ?? rawArgs.targetProfit;
  if (candidateTargetProfit !== undefined && candidateTargetProfit !== null && candidateTargetProfit > 0) {
    if (
      confirmedInputs.targetProfit === undefined &&
      evidence.hasMessage &&
      !numberMatchesSet(candidateTargetProfit, evidence.numbersInMessage)
    ) {
      recordProvenance(
        "targetProfit",
        candidateTargetProfit,
        INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
        PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
        `Model invented targetProfit=${candidateTargetProfit} not present in the seller message.`
      );
      flagAssumption("targetProfit", FIELD_CLARIFICATION_QUESTIONS.targetProfit);
    } else {
      verifiedTargetProfit = candidateTargetProfit;
      recordProvenance(
        "targetProfit",
        verifiedTargetProfit,
        INPUT_CLASSIFICATIONS.EXPLICIT_VALUE,
        confirmedInputs.targetProfit !== undefined ? PROVENANCE_SOURCES.SELLER_CONFIRMED : PROVENANCE_SOURCES.EXPLICIT_MESSAGE
      );
    }
  }

  let verifiedTargetMarginPct = undefined;
  const candidateMarginPct = confirmedInputs.targetMarginPct ?? rawArgs.targetMarginPct;
  if (candidateMarginPct !== undefined && candidateMarginPct !== null) {
    if (candidateMarginPct <= 0 || candidateMarginPct > 85) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "invalid_target_margin_pct",
        message: "targetMarginPct must be in canonical percentage points between 0.1 and 85",
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }

    if (tool === "find_target_price") {
      // Check for decimal-vs-percentage ambiguity (e.g. Phase 7C P06: 0.25 emitted when seller said "25%")
      const messageHasHundredXPercentage =
        evidence.hasMessage &&
        numberMatchesSet(candidateMarginPct * 100, evidence.percentagesInMessage) &&
        !numberMatchesSet(candidateMarginPct, evidence.percentagesInMessage);

      const isUnconfirmedSubOnePercent =
        candidateMarginPct < 1 &&
        confirmedInputs.confirmSubOnePercentMargin !== true &&
        (!evidence.hasMessage || !numberMatchesSet(candidateMarginPct, evidence.percentagesInMessage));

      if (messageHasHundredXPercentage || isUnconfirmedSubOnePercent) {
        recordProvenance(
          "targetMarginPct",
          candidateMarginPct,
          INPUT_CLASSIFICATIONS.AMBIGUOUS_VALUE,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          `Ambiguous percentage scale '${candidateMarginPct}': canonical targetMarginPct expects percentage points (e.g. 25 for 25%), never an unverified decimal ratio.`
        );
        flagAmbiguous("targetMarginPct", FIELD_CLARIFICATION_QUESTIONS.targetMarginPct);
      } else if (
        confirmedInputs.targetMarginPct === undefined &&
        evidence.hasMessage &&
        !numberMatchesSet(candidateMarginPct, evidence.numbersInMessage)
      ) {
        recordProvenance(
          "targetMarginPct",
          candidateMarginPct,
          INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
          PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
          `Model invented targetMarginPct=${candidateMarginPct} not present in the seller message.`
        );
        flagAssumption("targetMarginPct", FIELD_CLARIFICATION_QUESTIONS.targetMarginPct);
      } else {
        verifiedTargetMarginPct = candidateMarginPct;
        recordProvenance(
          "targetMarginPct",
          verifiedTargetMarginPct,
          INPUT_CLASSIFICATIONS.EXPLICIT_VALUE,
          confirmedInputs.targetMarginPct !== undefined ? PROVENANCE_SOURCES.SELLER_CONFIRMED : PROVENANCE_SOURCES.EXPLICIT_MESSAGE
        );
      }
    }
  }

  if (tool === "find_target_price") {
    if (
      verifiedTargetProfit <= 0 &&
      verifiedTargetMarginPct === undefined &&
      !missingFields.includes("targetMarginPct") &&
      !missingFields.includes("targetProfit")
    ) {
      recordProvenance("targetProfit", null, INPUT_CLASSIFICATIONS.MISSING_VALUE, PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS);
      flagMissing("targetProfit", FIELD_CLARIFICATION_QUESTIONS.targetProfit);
    }
  }

  // 8. Validate Offsite Ads Rate & Flag (Step 5)
  let verifiedOffsiteAds = false;
  let verifiedOffsiteRate = 0;

  const candidateOffsiteRate = confirmedInputs.offsiteRate ?? rawArgs.offsiteRate;
  const candidateOffsiteAds = confirmedInputs.offsiteAds ?? rawArgs.offsiteAds;

  if (candidateOffsiteRate !== undefined && candidateOffsiteRate !== null) {
    if (!VALID_RAW_OFFSITE_RATES.has(candidateOffsiteRate)) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "invalid_offsite_rate",
        message: "offsiteRate must represent 0%, 12%, or 15% (canonical 0, 0.12, or 0.15)",
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
    const canonicalRate = candidateOffsiteRate > 1 ? candidateOffsiteRate / 100 : candidateOffsiteRate;
    if (!VALID_CANONICAL_OFFSITE_RATES.has(canonicalRate)) {
      return Object.freeze({
        ok: false,
        status: "rejected",
        error: "invalid_offsite_rate",
        message: "Canonical offsiteRate must be 0, 0.12, or 0.15",
        action: "refuse",
        tool: null,
        canExecuteTool: false
      });
    }
    if (tool === "analyze_offsite_ads") {
      // analyze_offsite_ads always evaluates all three tiers (0%, 12%, 15%) deterministically
      verifiedOffsiteRate = canonicalRate;
      verifiedOffsiteAds = canonicalRate > 0;
      recordProvenance(
        "offsiteRate",
        verifiedOffsiteRate,
        evidence.hasExplicitOffsiteAds ? INPUT_CLASSIFICATIONS.EXPLICIT_VALUE : INPUT_CLASSIFICATIONS.DETERMINISTIC_DEFAULT,
        confirmedInputs.offsiteRate !== undefined
          ? PROVENANCE_SOURCES.SELLER_CONFIRMED
          : evidence.hasExplicitOffsiteAds
            ? PROVENANCE_SOURCES.EXPLICIT_MESSAGE
            : PROVENANCE_SOURCES.DETERMINISTIC_DEFAULT
      );
    } else if (
      canonicalRate > 0 &&
      confirmedInputs.offsiteRate === undefined &&
      evidence.hasMessage &&
      !evidence.hasExplicitOffsiteAds
    ) {
      recordProvenance(
        "offsiteRate",
        canonicalRate,
        INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
        PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
        "Model enabled Offsite Ads rate when Offsite Ads was not mentioned in the seller message."
      );
      flagAssumption("offsiteRate", FIELD_CLARIFICATION_QUESTIONS.offsiteRate);
    } else {
      verifiedOffsiteRate = canonicalRate;
      verifiedOffsiteAds = canonicalRate > 0;
      recordProvenance(
        "offsiteRate",
        verifiedOffsiteRate,
        INPUT_CLASSIFICATIONS.EXPLICIT_VALUE,
        confirmedInputs.offsiteRate !== undefined ? PROVENANCE_SOURCES.SELLER_CONFIRMED : PROVENANCE_SOURCES.EXPLICIT_MESSAGE
      );
    }
  } else if (candidateOffsiteAds === true) {
    if (tool === "analyze_offsite_ads") {
      verifiedOffsiteAds = true;
      verifiedOffsiteRate = 0.15;
      recordProvenance(
        "offsiteAds",
        true,
        evidence.hasExplicitOffsiteAds ? INPUT_CLASSIFICATIONS.EXPLICIT_VALUE : INPUT_CLASSIFICATIONS.DETERMINISTIC_DEFAULT,
        confirmedInputs.offsiteAds !== undefined
          ? PROVENANCE_SOURCES.SELLER_CONFIRMED
          : evidence.hasExplicitOffsiteAds
            ? PROVENANCE_SOURCES.EXPLICIT_MESSAGE
            : PROVENANCE_SOURCES.DETERMINISTIC_DEFAULT
      );
    } else if (confirmedInputs.offsiteAds === undefined && evidence.hasMessage && !evidence.hasExplicitOffsiteAds) {
      recordProvenance(
        "offsiteAds",
        true,
        INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
        PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
        "Model enabled offsiteAds=true when Offsite Ads was not mentioned in the seller message."
      );
      flagAssumption("offsiteAds", FIELD_CLARIFICATION_QUESTIONS.offsiteAds);
    } else {
      verifiedOffsiteAds = true;
      verifiedOffsiteRate = 0.15;
      recordProvenance(
        "offsiteAds",
        true,
        INPUT_CLASSIFICATIONS.EXPLICIT_VALUE,
        confirmedInputs.offsiteAds !== undefined ? PROVENANCE_SOURCES.SELLER_CONFIRMED : PROVENANCE_SOURCES.EXPLICIT_MESSAGE
      );
    }
  } else {
    recordProvenance("offsiteAds", false, INPUT_CLASSIFICATIONS.DETERMINISTIC_DEFAULT, PROVENANCE_SOURCES.DETERMINISTIC_DEFAULT);
    recordProvenance("offsiteRate", 0, INPUT_CLASSIFICATIONS.DETERMINISTIC_DEFAULT, PROVENANCE_SOURCES.DETERMINISTIC_DEFAULT);
  }

  // 9. Validate Scenarios for compare_price_scenarios
  let verifiedScenarios = undefined;
  if (tool === "compare_price_scenarios") {
    const candidateScenarios = confirmedInputs.scenarios ?? rawArgs.scenarios;
    if (!Array.isArray(candidateScenarios) || candidateScenarios.length < MIN_SCENARIO_COUNT) {
      recordProvenance("scenarios", null, INPUT_CLASSIFICATIONS.MISSING_VALUE, PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS);
      flagMissing("scenarios", FIELD_CLARIFICATION_QUESTIONS.scenarios);
    } else {
      const cleanedScenarios = [];
      for (let i = 0; i < candidateScenarios.length; i++) {
        const sc = candidateScenarios[i];
        if (evidence.hasMessage && confirmedInputs.scenarios === undefined) {
          if (!numberMatchesSet(sc.itemPrice, evidence.numbersInMessage)) {
            recordProvenance(
              "scenarios",
              candidateScenarios,
              INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
              PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
              `Scenario '${sc.label}' invented itemPrice=${sc.itemPrice} not present in the seller message.`
            );
            flagAssumption("scenarios", FIELD_CLARIFICATION_QUESTIONS.scenarios);
            break;
          }
          if (sc.shipping !== undefined && sc.shipping !== null && sc.shipping > 0) {
            if (!numberMatchesSet(sc.shipping, evidence.numbersInMessage)) {
              recordProvenance(
                "scenarios",
                candidateScenarios,
                INPUT_CLASSIFICATIONS.MODEL_ASSUMPTION,
                PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS,
                `Scenario '${sc.label}' invented shipping=${sc.shipping} not present in the seller message.`
              );
              flagAssumption("scenarios", FIELD_CLARIFICATION_QUESTIONS.scenarios);
              break;
            }
          }
        }

        const labelIndicatesFreeShip = /\bfree\s+(?:shipping|postage|delivery|ship)\b/i.test(sc.label || "");
        const pricePairedWithFreeShipInMessage =
          typeof sc.itemPrice === "number" &&
          new RegExp(
            `(?:\\b|\\$|£|€)${String(sc.itemPrice).replace(".", "\\.")}(?:\\.00)?\\s*(?:with|plus|\\+|and)?\\s*free\\s+(?:shipping|postage|delivery)`,
            "i"
          ).test(sellerMessage);
        const anotherScenarioHasPaidShipping =
          evidence.hasExplicitFreeShipping &&
          candidateScenarios.some(
            (other) => other && other !== sc && typeof other.shipping === "number" && other.shipping > 0
          );
        const inferScenarioFreeShip =
          labelIndicatesFreeShip || pricePairedWithFreeShipInMessage || anotherScenarioHasPaidShipping;

        const scEntry = {
          label: sc.label.trim(),
          itemPrice: sc.itemPrice,
          shipping: sc.shipping ?? (inferScenarioFreeShip ? 0 : (verifiedShipping ?? 0))
        };
        if (
          sc.production !== undefined &&
          sc.production !== null &&
          (!evidence.hasMessage ||
            numberMatchesSet(sc.production, evidence.productionCostValues) ||
            (sc.production === 0 && evidence.hasExplicitZeroProduction))
        ) {
          scEntry.production = sc.production;
        }
        if (
          sc.packaging !== undefined &&
          sc.packaging !== null &&
          (!evidence.hasMessage || numberMatchesSet(sc.packaging, evidence.packagingCostValues))
        ) {
          scEntry.packaging = sc.packaging;
        }
        if (
          sc.shippingCost !== undefined &&
          sc.shippingCost !== null &&
          (!evidence.hasMessage || numberMatchesSet(sc.shippingCost, evidence.sellerShippingCostValues))
        ) {
          scEntry.shippingCost = sc.shippingCost;
        }
        if (sc.offsiteAds !== undefined && sc.offsiteAds !== null) scEntry.offsiteAds = sc.offsiteAds;
        if (sc.offsiteRate !== undefined && sc.offsiteRate !== null) {
          if (!VALID_RAW_OFFSITE_RATES.has(sc.offsiteRate)) {
            return Object.freeze({
              ok: false,
              status: "rejected",
              error: "invalid_scenario_offsite_rate",
              message: `Scenario '${sc.label}' has invalid offsiteRate`,
              action: "refuse",
              tool: null,
              canExecuteTool: false
            });
          }
          scEntry.offsiteRate = sc.offsiteRate > 1 ? sc.offsiteRate / 100 : sc.offsiteRate;
          if (scEntry.offsiteRate > 0) scEntry.offsiteAds = true;
        }
        cleanedScenarios.push(Object.freeze(scEntry));
      }
      if (!missingFields.includes("scenarios")) {
        verifiedScenarios = Object.freeze(cleanedScenarios);
        recordProvenance(
          "scenarios",
          verifiedScenarios,
          INPUT_CLASSIFICATIONS.EXPLICIT_VALUE,
          confirmedInputs.scenarios !== undefined ? PROVENANCE_SOURCES.SELLER_CONFIRMED : PROVENANCE_SOURCES.EXPLICIT_MESSAGE
        );
      }
    }
  }

  // 10. Validate Products for analyze_product_catalog
  let verifiedProducts = undefined;
  if (tool === "analyze_product_catalog") {
    const candidateProducts = confirmedInputs.products ?? rawArgs.products;
    if (!Array.isArray(candidateProducts) || candidateProducts.length < 1) {
      recordProvenance("products", null, INPUT_CLASSIFICATIONS.MISSING_VALUE, PROVENANCE_SOURCES.UNRESOLVED_OR_AMBIGUOUS);
      flagMissing("products", FIELD_CLARIFICATION_QUESTIONS.products);
    } else {
      verifiedProducts = Object.freeze(
        candidateProducts.map((p) => {
          const item = {
            name: p.name.trim(),
            itemPrice: p.itemPrice
          };
          if (p.sku !== undefined && p.sku !== null) item.sku = p.sku;
          if (p.quantity !== undefined && p.quantity !== null) item.quantity = p.quantity;
          if (p.shipping !== undefined && p.shipping !== null) item.shipping = p.shipping;
          if (p.production !== undefined && p.production !== null) item.production = p.production;
          if (p.packaging !== undefined && p.packaging !== null) item.packaging = p.packaging;
          if (p.shippingCost !== undefined && p.shippingCost !== null) item.shippingCost = p.shippingCost;
          if (p.targetProfit !== undefined && p.targetProfit !== null) item.targetProfit = p.targetProfit;
          if (p.offsiteAds !== undefined && p.offsiteAds !== null) item.offsiteAds = p.offsiteAds;
          if (p.offsiteRate !== undefined && p.offsiteRate !== null) {
            item.offsiteRate = p.offsiteRate > 1 ? p.offsiteRate / 100 : p.offsiteRate;
          }
          if (p.orderType !== undefined && p.orderType !== null) item.orderType = p.orderType;
          return Object.freeze(item);
        })
      );
      recordProvenance(
        "products",
        verifiedProducts,
        INPUT_CLASSIFICATIONS.EXPLICIT_VALUE,
        confirmedInputs.products !== undefined ? PROVENANCE_SOURCES.SELLER_CONFIRMED : PROVENANCE_SOURCES.EXPLICIT_MESSAGE
      );
    }
  }

  // ─── Confirmation Boundary Decision (Step 6) ─────────────────────────────────

  if (missingFields.length > 0 || ambiguousFields.length > 0 || modelAssumptions.length > 0) {
    const question = buildClarificationQuestion(missingFields, customReasons);
    return Object.freeze({
      ok: true,
      status: "needs_clarification",
      action: "clarify",
      tool: null,
      canExecuteTool: false,
      missingFields: Object.freeze([...missingFields]),
      ambiguousFields: Object.freeze([...ambiguousFields]),
      modelAssumptions: Object.freeze([...modelAssumptions]),
      clarificationQuestion: question,
      provenance: Object.freeze(provenance),
      verifiedArguments: null
    });
  }

  // Build clean, canonical verifiedArguments for the allowlisted deterministic tool
  const verifiedArgs = {
    country: verifiedCountry
  };

  if (tool === "analyze_product_catalog") {
    verifiedArgs.orderType = verifiedOrderType;
    verifiedArgs.offsiteAds = verifiedOffsiteAds;
    verifiedArgs.offsiteRate = verifiedOffsiteRate;
    if (confirmedInputs.plusEnabled !== undefined || rawArgs.plusEnabled !== undefined) {
      verifiedArgs.plusEnabled = Boolean(confirmedInputs.plusEnabled ?? rawArgs.plusEnabled);
    }
    if (confirmedInputs.salesPerMonth !== undefined || rawArgs.salesPerMonth !== undefined) {
      verifiedArgs.salesPerMonth = confirmedInputs.salesPerMonth ?? rawArgs.salesPerMonth;
    }
    if (confirmedInputs.listingCurrency || rawArgs.listingCurrency) {
      verifiedArgs.listingCurrency = confirmedInputs.listingCurrency ?? rawArgs.listingCurrency;
    }
    if (confirmedInputs.paymentAccountCurrency || rawArgs.paymentAccountCurrency) {
      verifiedArgs.paymentAccountCurrency = confirmedInputs.paymentAccountCurrency ?? rawArgs.paymentAccountCurrency;
    }
    verifiedArgs.products = verifiedProducts;
  } else {
    if (verifiedItemPrice !== undefined) verifiedArgs.itemPrice = verifiedItemPrice;
    verifiedArgs.shipping = verifiedShipping;
    verifiedArgs.production = verifiedProduction;
    verifiedArgs.packaging = verifiedPackaging;
    verifiedArgs.shippingCost = verifiedShippingCost;
    if (verifiedGiftWrap > 0) verifiedArgs.giftWrap = verifiedGiftWrap;
    if (verifiedBuyerSalesTax > 0) verifiedArgs.buyerSalesTax = verifiedBuyerSalesTax;
    verifiedArgs.orderType = verifiedOrderType;
    verifiedArgs.offsiteAds = verifiedOffsiteAds;
    verifiedArgs.offsiteRate = verifiedOffsiteRate;
    if (verifiedTargetProfit > 0) verifiedArgs.targetProfit = verifiedTargetProfit;
    if (tool === "find_target_price" && verifiedTargetMarginPct !== undefined) {
      verifiedArgs.targetMarginPct = verifiedTargetMarginPct;
    }
    if (tool === "compare_price_scenarios") {
      verifiedArgs.scenarios = verifiedScenarios;
    }
    if (confirmedInputs.plusEnabled !== undefined || rawArgs.plusEnabled !== undefined) {
      verifiedArgs.plusEnabled = Boolean(confirmedInputs.plusEnabled ?? rawArgs.plusEnabled);
    }
    if (confirmedInputs.salesPerMonth !== undefined || rawArgs.salesPerMonth !== undefined) {
      verifiedArgs.salesPerMonth = confirmedInputs.salesPerMonth ?? rawArgs.salesPerMonth;
    }
    if (confirmedInputs.listingCurrency || rawArgs.listingCurrency) {
      verifiedArgs.listingCurrency = confirmedInputs.listingCurrency ?? rawArgs.listingCurrency;
    }
    if (confirmedInputs.paymentAccountCurrency || rawArgs.paymentAccountCurrency) {
      verifiedArgs.paymentAccountCurrency = confirmedInputs.paymentAccountCurrency ?? rawArgs.paymentAccountCurrency;
    }
    if (confirmedInputs.payoutBalance !== undefined || rawArgs.payoutBalance !== undefined) {
      const pb = confirmedInputs.payoutBalance ?? rawArgs.payoutBalance;
      if (pb !== null) verifiedArgs.payoutBalance = pb;
    }
    if (confirmedInputs.usdExchangeRate !== undefined || rawArgs.usdExchangeRate !== undefined) {
      const fx = confirmedInputs.usdExchangeRate ?? rawArgs.usdExchangeRate;
      if (fx !== null) verifiedArgs.usdExchangeRate = fx;
    }
    if (isDigital) verifiedArgs.isDigital = true;
    if (confirmZeroShipping && verifiedShipping === 0) {
      verifiedArgs.freeShipping = true;
      verifiedArgs.confirmZeroShipping = true;
    }
    if (confirmZeroProduction && verifiedProduction === 0) {
      verifiedArgs.confirmZeroProduction = true;
    }
  }

  return Object.freeze({
    ok: true,
    status: "verified",
    action: "call_tool",
    tool,
    canExecuteTool: true,
    missingFields: Object.freeze([]),
    ambiguousFields: Object.freeze([]),
    modelAssumptions: Object.freeze([]),
    clarificationQuestion: null,
    provenance: Object.freeze(provenance),
    verifiedArguments: Object.freeze(verifiedArgs)
  });
}

/**
 * End-to-end deterministic confirmation workflow:
 * 1. Validates the AI extraction and checks provenance & semantic rules.
 * 2. If any required input is missing, ambiguous, or a model assumption, returns action: "clarify"
 *    and executes ZERO financial tools.
 * 3. If refused or rejected, executes ZERO financial tools.
 * 4. Only when all required inputs are valid and verified, executes the single allowlisted
 *    deterministic tool and returns the verified result.
 *
 * @param {string|Object} rawExtraction - AI-extracted payload
 * @param {Object} [context] - { sellerMessage?: string, confirmedInputs?: Object, requireConfirmedCosts?: boolean }
 * @returns {Object} Workflow result
 */
export function validateAndExecuteAdvisorExtraction(rawExtraction, context = {}) {
  const guardResult = validateAiExtractedInput(rawExtraction, context);

  if (!guardResult.ok) {
    return Object.freeze({
      ok: false,
      status: guardResult.status,
      error: guardResult.error,
      message: guardResult.message,
      action: guardResult.action,
      tool: null,
      executedTools: 0,
      missingFields: Object.freeze([]),
      ambiguousFields: Object.freeze([]),
      modelAssumptions: Object.freeze([]),
      clarificationQuestion: null,
      provenance: Object.freeze({}),
      toolResult: null
    });
  }

  if (guardResult.action !== "call_tool" || !guardResult.canExecuteTool) {
    return Object.freeze({
      ok: true,
      status: guardResult.status,
      action: guardResult.action,
      tool: null,
      executedTools: 0,
      missingFields: guardResult.missingFields,
      ambiguousFields: guardResult.ambiguousFields,
      modelAssumptions: guardResult.modelAssumptions,
      clarificationQuestion: guardResult.clarificationQuestion,
      provenance: guardResult.provenance,
      toolResult: null
    });
  }

  // Execute the single allowlisted deterministic tool (no recursion, no loops)
  const toolOutcome = executeAdvisorTool({
    name: guardResult.tool,
    arguments: guardResult.verifiedArguments
  });

  if (!toolOutcome.ok) {
    return Object.freeze({
      ok: false,
      status: "rejected",
      error: toolOutcome.error || "tool_execution_rejected",
      message: toolOutcome.message || "Tool arguments failed deterministic validation",
      action: "refuse",
      tool: null,
      executedTools: 0,
      missingFields: Object.freeze([]),
      ambiguousFields: Object.freeze([]),
      modelAssumptions: Object.freeze([]),
      clarificationQuestion: null,
      provenance: guardResult.provenance,
      toolResult: null
    });
  }

  return Object.freeze({
    ok: true,
    status: "executed",
    action: "call_tool",
    tool: guardResult.tool,
    executedTools: 1,
    missingFields: Object.freeze([]),
    ambiguousFields: Object.freeze([]),
    modelAssumptions: Object.freeze([]),
    clarificationQuestion: null,
    verifiedArguments: guardResult.verifiedArguments,
    provenance: guardResult.provenance,
    toolResult: toolOutcome.result
  });
}
