/**
 * ShopProfit — Phase 7A: Deterministic Advisor Tool Layer
 *
 * Implements the allowlisted deterministic tools and missing-input detector for the
 * conversational Etsy Pricing Advisor, backed exclusively by:
 *   - src/fee-engine.js (calculateOrderFees, solveRequiredPrice, resolveCountryFeeRule, calculateDepositFee)
 *   - src/bulk-analyzer.js (calculateBulkProducts, summarizeBulkResults, BULK_LIMITS)
 *   - worker/src/advisor.js (computeDeterministicAnalysis)
 *
 * SECURITY & PRODUCTION INVARIANTS:
 * - Zero fee-math duplication: 100% of calculations delegate to src/fee-engine.js and src/bulk-analyzer.js.
 * - Strict tool allowlist: Only the 5 registered tools may be invoked.
 * - Strict argument schemas with additionalProperties: false and recursive prototype-pollution rejection.
 * - Bounded execution: Maximum 2 deterministic tool executions per request, zero recursive loops.
 * - Zero D1 access, zero secret access, zero network calls, zero dynamic code execution, zero financial input logging.
 * - All user-facing strings validated for safe text rendering (no HTML/script markup or control characters).
 */

import {
  calculateOrderFees,
  solveRequiredPrice,
  resolveCountryFeeRule,
  calculateDepositFee,
  GLOBAL_COUNTRY_RULES,
  STATUTORY_OFFSITE_ADS_CAP,
  getCurrencyMinorUnitDigits,
  toMinorUnits,
  fromMinorUnits
} from "../../src/fee-engine.js";
import {
  calculateBulkProducts,
  summarizeBulkResults,
  BULK_LIMITS
} from "../../src/bulk-analyzer.js";
import {
  computeDeterministicAnalysis,
  verifyContentPolicy
} from "./advisor.js";

export const MAX_TOOL_CALLS_PER_REQUEST = 2;
export const MIN_SCENARIO_COUNT = 2;
export const MAX_SCENARIO_COUNT = 4;
export const MAX_ADVISOR_CATALOG_PRODUCTS = 10;
export const MAX_TOOL_INPUT_BYTES = 4096;
export const MAX_TOOL_OUTPUT_BYTES = 32768;

const MAX_MONETARY_VALUE = 10_000_000;
const MAX_SALES_PER_MONTH = 10_000;
const VALID_ORDER_TYPES = new Set(["domestic", "international"]);
const VALID_OFFSITE_RATES = new Set([0, 0.12, 0.15, 12, 15]);
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;
const UNSAFE_TEXT_RE = /<\s*\/?\s*[a-z!]|javascript\s*:|data\s*:\s*text\/html|on[a-z]+\s*=|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/i;
const FORBIDDEN_PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const ALLOWED_ADVISOR_TOOLS = Object.freeze([
  "calculate_profit",
  "find_target_price",
  "compare_price_scenarios",
  "analyze_offsite_ads",
  "analyze_product_catalog"
]);

const ALLOWED_TOOL_SET = new Set(ALLOWED_ADVISOR_TOOLS);

// ─── Explicit JSON Schemas (additionalProperties: false) ──────────────────────

const BASE_SINGLE_ORDER_PROPERTIES = Object.freeze({
  country: {
    type: "string",
    description: "2-letter ISO country code in ShopProfit's 62-market registry (e.g. US, UK, CA, DE, AU, IN, JP, TR, VN). Default to US if $ USD is used without another country."
  },
  itemPrice: {
    type: "number",
    minimum: 0.01,
    maximum: MAX_MONETARY_VALUE,
    description: "Item listing price charged to the buyer in major currency units."
  },
  shipping: {
    type: "number",
    minimum: 0,
    maximum: MAX_MONETARY_VALUE,
    description: "Shipping or postage amount charged to the buyer (0 if free shipping or not charged to buyer)."
  },
  production: {
    type: "number",
    minimum: 0,
    maximum: MAX_MONETARY_VALUE,
    description: "Seller's unit production, material, or cost of goods sold (COGS)."
  },
  packaging: {
    type: "number",
    minimum: 0,
    maximum: MAX_MONETARY_VALUE,
    description: "Seller's unit packaging cost."
  },
  shippingCost: {
    type: "number",
    minimum: 0,
    maximum: MAX_MONETARY_VALUE,
    description: "Seller's actual out-of-pocket shipping label/postage cost (e.g. 'shipping costs me $4' or 'costs £3.80 to post')."
  },
  giftWrap: {
    type: "number",
    minimum: 0,
    maximum: MAX_MONETARY_VALUE,
    description: "Gift wrap charge paid by buyer."
  },
  buyerSalesTax: {
    type: "number",
    minimum: 0,
    maximum: MAX_MONETARY_VALUE,
    description: "Buyer sales tax collected on the order."
  },
  orderType: {
    type: "string",
    enum: ["domestic", "international"],
    description: "Whether the order is domestic or international."
  },
  offsiteAds: {
    type: "boolean",
    description: "Whether the order is attributed to Etsy Offsite Ads."
  },
  offsiteRate: {
    type: "number",
    enum: [0, 0.12, 0.15, 12, 15],
    description: "Offsite Ads fee tier rate (0, 0.12, or 0.15)."
  },
  plusEnabled: {
    type: "boolean",
    description: "Whether Etsy Plus subscription amortization is enabled."
  },
  salesPerMonth: {
    type: "integer",
    minimum: 1,
    maximum: MAX_SALES_PER_MONTH,
    description: "Estimated monthly order volume for Etsy Plus amortization."
  },
  targetProfit: {
    type: "number",
    minimum: 0,
    maximum: MAX_MONETARY_VALUE,
    description: "Desired target net profit per order in major currency units."
  },
  listingCurrency: {
    type: "string",
    minLength: 3,
    maxLength: 3,
    description: "3-letter uppercase ISO currency code for the listing."
  },
  paymentAccountCurrency: {
    type: "string",
    minLength: 3,
    maxLength: 3,
    description: "3-letter uppercase ISO currency code for the seller's payout account."
  },
  payoutBalance: {
    type: "number",
    minimum: 0,
    maximum: MAX_MONETARY_VALUE,
    description: "Payout balance for statutory deposit fee evaluation."
  },
  usdExchangeRate: {
    type: "number",
    exclusiveMinimum: 0,
    maximum: 1_000_000,
    description: "Live USD exchange rate for local-currency Offsite Ads cap conversion."
  },
  isDigital: {
    type: "boolean",
    description: "True if the product is a digital download with zero physical production or shipping."
  },
  freeShipping: {
    type: "boolean",
    description: "True if the seller offers free shipping (shipping charged to buyer is 0)."
  },
  confirmZeroProduction: {
    type: "boolean",
    description: "True if the seller explicitly confirmed zero production cost."
  },
  confirmZeroShipping: {
    type: "boolean",
    description: "True if the seller explicitly confirmed zero shipping charge."
  }
});

export const ADVISOR_TOOL_SCHEMAS = Object.freeze({
  calculate_profit: Object.freeze({
    name: "calculate_profit",
    description: "Calculates exact per-order Etsy fees, seller costs, net profit, profit margin, break-even price, and optional target price for a single product order.",
    parameters: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["country", "itemPrice"],
      properties: BASE_SINGLE_ORDER_PROPERTIES
    })
  }),

  find_target_price: Object.freeze({
    name: "find_target_price",
    description: "Finds the exact minimum item listing price required to achieve a target net profit (targetProfit) or target net profit margin percentage (targetMarginPct).",
    parameters: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["country"],
      properties: Object.freeze({
        ...BASE_SINGLE_ORDER_PROPERTIES,
        itemPrice: {
          type: "number",
          minimum: 0,
          maximum: MAX_MONETARY_VALUE,
          description: "Optional current item listing price for delta comparison."
        },
        targetProfit: {
          type: "number",
          minimum: 0.01,
          maximum: MAX_MONETARY_VALUE,
          description: "Target net profit per order in major currency units (e.g. 15 for $15 profit)."
        },
        targetMarginPct: {
          type: "number",
          minimum: 0.1,
          maximum: 85,
          description: "Target net profit margin percentage (e.g. 25 for 25% margin)."
        }
      })
    })
  }),

  compare_price_scenarios: Object.freeze({
    name: "compare_price_scenarios",
    description: "Compares 2 to 4 pricing or shipping scenarios side-by-side (for example paid shipping vs free shipping at a higher item price).",
    parameters: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["country", "scenarios"],
      properties: Object.freeze({
        ...BASE_SINGLE_ORDER_PROPERTIES,
        itemPrice: {
          type: "number",
          minimum: 0,
          maximum: MAX_MONETARY_VALUE,
          description: "Optional default item price."
        },
        scenarios: Object.freeze({
          type: "array",
          description: "Array of 2 to 4 pricing/shipping scenarios to compare.",
          minItems: MIN_SCENARIO_COUNT,
          maxItems: MAX_SCENARIO_COUNT,
          items: Object.freeze({
            type: "object",
            additionalProperties: false,
            required: ["label", "itemPrice"],
            properties: Object.freeze({
              label: {
                type: "string",
                minLength: 1,
                maxLength: 80,
                description: "Short descriptive label for the scenario."
              },
              ...BASE_SINGLE_ORDER_PROPERTIES
            })
          })
        })
      })
    })
  }),

  analyze_offsite_ads: Object.freeze({
    name: "analyze_offsite_ads",
    description: "Analyzes how Etsy Offsite Ads (0%, 12% mandatory tier, and 15% optional tier, including the $100 USD fee cap) affect order profit and calculates exact price buffers.",
    parameters: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["country", "itemPrice"],
      properties: BASE_SINGLE_ORDER_PROPERTIES
    })
  }),

  analyze_product_catalog: Object.freeze({
    name: "analyze_product_catalog",
    description: "Evaluates 1 to 10 products in a catalog excerpt to rank margins, detect losses, and compare Offsite Ads impact.",
    parameters: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: ["country", "products"],
      properties: Object.freeze({
        country: {
          type: "string",
          description: "2-letter ISO seller country code."
        },
        orderType: {
          type: "string",
          enum: ["domestic", "international"],
          description: "Default order type for the catalog."
        },
        offsiteAds: {
          type: "boolean",
          description: "Default Offsite Ads attribution flag."
        },
        offsiteRate: {
          type: "number",
          enum: [0, 0.12, 0.15, 12, 15],
          description: "Default Offsite Ads rate."
        },
        plusEnabled: {
          type: "boolean",
          description: "Whether Etsy Plus is enabled."
        },
        salesPerMonth: {
          type: "integer",
          minimum: 1,
          maximum: MAX_SALES_PER_MONTH,
          description: "Monthly sales volume."
        },
        listingCurrency: {
          type: "string",
          minLength: 3,
          maxLength: 3,
          description: "3-letter ISO listing currency."
        },
        paymentAccountCurrency: {
          type: "string",
          minLength: 3,
          maxLength: 3,
          description: "3-letter ISO payout currency."
        },
        products: Object.freeze({
          type: "array",
          description: "Array of 1 to 10 products to evaluate.",
          minItems: 1,
          maxItems: MAX_ADVISOR_CATALOG_PRODUCTS,
          items: Object.freeze({
            type: "object",
            additionalProperties: false,
            required: ["name", "itemPrice"],
            properties: Object.freeze({
              name: { type: "string", minLength: 1, maxLength: 120, description: "Product name." },
              sku: { type: "string", minLength: 0, maxLength: 64, description: "Optional SKU." },
              quantity: { type: "integer", minimum: 1, maximum: 10_000, description: "Order quantity." },
              itemPrice: { type: "number", minimum: 0.01, maximum: MAX_MONETARY_VALUE, description: "Unit listing price." },
              shipping: { type: "number", minimum: 0, maximum: MAX_MONETARY_VALUE, description: "Shipping charged to buyer." },
              production: { type: "number", minimum: 0, maximum: MAX_MONETARY_VALUE, description: "Unit production cost." },
              packaging: { type: "number", minimum: 0, maximum: MAX_MONETARY_VALUE, description: "Unit packaging cost." },
              shippingCost: { type: "number", minimum: 0, maximum: MAX_MONETARY_VALUE, description: "Seller shipping cost." },
              giftWrap: { type: "number", minimum: 0, maximum: MAX_MONETARY_VALUE, description: "Gift wrap charge." },
              buyerSalesTax: { type: "number", minimum: 0, maximum: MAX_MONETARY_VALUE, description: "Buyer sales tax." },
              targetProfit: { type: "number", minimum: 0, maximum: MAX_MONETARY_VALUE, description: "Target unit profit." },
              offsiteAds: { type: "boolean", description: "Offsite Ads enabled." },
              offsiteRate: { type: "number", enum: [0, 0.12, 0.15, 12, 15], description: "Offsite Ads rate." },
              orderType: { type: "string", enum: ["domestic", "international"], description: "Order type." }
            })
          })
        })
      })
    })
  })
});

// ─── Security & Validation Helpers ────────────────────────────────────────────

/**
 * Checks whether a value is a plain JSON object without prototype modification.
 */
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

/**
 * Recursively scans any value for prototype-pollution keys (__proto__, constructor, prototype).
 */
export function hasPrototypePollutionAttempt(value, depth = 0) {
  if (depth > 8) return true;
  if (!value || typeof value !== "object") return false;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (hasPrototypePollutionAttempt(item, depth + 1)) return true;
    }
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return true;
  }

  const ownNames = Object.getOwnPropertyNames(value);
  for (const key of ownNames) {
    if (FORBIDDEN_PROTO_KEYS.has(key)) {
      return true;
    }
    if (hasPrototypePollutionAttempt(value[key], depth + 1)) {
      return true;
    }
  }
  return false;
}

/**
 * Ensures text strings are safe to render as plain text without HTML/script markup or control chars.
 */
export function isSafePlainText(value, maxLength = 240) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || value.length > maxLength) return false;
  if (UNSAFE_TEXT_RE.test(value)) return false;
  return true;
}

function validateNumberField(value, fieldName, { min = 0, max = MAX_MONETARY_VALUE, allowZero = true, integer = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: `Invalid numeric value for '${fieldName}': must be a finite number` };
  }
  if (integer && !Number.isInteger(value)) {
    return { ok: false, error: `Invalid value for '${fieldName}': must be an integer` };
  }
  if (!allowZero && value <= 0) {
    return { ok: false, error: `Invalid value for '${fieldName}': must be greater than 0` };
  }
  if (value < min || value > max) {
    return { ok: false, error: `Value out of range for '${fieldName}': must be between ${min} and ${max}` };
  }
  return { ok: true, value };
}

function normalizeOffsiteRate(rawRate, offsiteAdsFlag) {
  if (rawRate === undefined) {
    return offsiteAdsFlag ? 0.15 : 0;
  }
  if (typeof rawRate !== "number" || !Number.isFinite(rawRate) || !VALID_OFFSITE_RATES.has(rawRate)) {
    return null;
  }
  if (rawRate > 1) return rawRate / 100;
  return rawRate;
}

const SINGLE_ORDER_ALLOWED_KEYS = new Set(Object.keys(BASE_SINGLE_ORDER_PROPERTIES));

/**
 * Validates and normalizes common single-order tool fields against BASE_SINGLE_ORDER_PROPERTIES.
 */
function validateSingleOrderParams(raw, { requireItemPrice = true, allowExtraKeys = null } = {}) {
  if (!isPlainSafeObject(raw) || hasPrototypePollutionAttempt(raw)) {
    return { ok: false, error: "Invalid arguments: expected a plain JSON object without prototype pollution keys" };
  }

  const allowedSet = allowExtraKeys || SINGLE_ORDER_ALLOWED_KEYS;
  const keys = Object.keys(raw);
  for (const key of keys) {
    if (!allowedSet.has(key)) {
      return { ok: false, error: `Unexpected field '${key}' is not permitted by tool schema` };
    }
  }

  if (typeof raw.country !== "string" || raw.country.trim() === "") {
    return { ok: false, error: "Missing or invalid required field 'country'" };
  }
  const country = raw.country.trim();
  if (!Object.prototype.hasOwnProperty.call(GLOBAL_COUNTRY_RULES, country)) {
    return { ok: false, error: `Unsupported country code '${country}'` };
  }

  let itemPrice = 0;
  if (requireItemPrice || raw.itemPrice !== undefined) {
    const check = validateNumberField(raw.itemPrice, "itemPrice", {
      min: requireItemPrice ? 0.0001 : 0,
      max: MAX_MONETARY_VALUE,
      allowZero: !requireItemPrice
    });
    if (!check.ok) return check;
    itemPrice = check.value;
  }

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
      normalizedMoney[field] = field === "payoutBalance" ? null : 0;
      continue;
    }
    const check = validateNumberField(raw[field], field, {
      min: 0,
      max: MAX_MONETARY_VALUE,
      allowZero: true
    });
    if (!check.ok) return check;
    normalizedMoney[field] = check.value;
  }

  let usdExchangeRate = undefined;
  if (raw.usdExchangeRate !== undefined) {
    const fxCheck = validateNumberField(raw.usdExchangeRate, "usdExchangeRate", {
      min: 0.000001,
      max: 1_000_000,
      allowZero: false
    });
    if (!fxCheck.ok) return fxCheck;
    usdExchangeRate = fxCheck.value;
  }

  let orderType = "domestic";
  if (raw.orderType !== undefined) {
    if (typeof raw.orderType !== "string" || !VALID_ORDER_TYPES.has(raw.orderType)) {
      return { ok: false, error: "Invalid 'orderType': must be 'domestic' or 'international'" };
    }
    orderType = raw.orderType;
  }

  const booleanFields = ["offsiteAds", "plusEnabled", "isDigital", "freeShipping", "confirmZeroProduction", "confirmZeroShipping"];
  const normalizedBooleans = {};
  for (const bField of booleanFields) {
    if (raw[bField] === undefined) {
      normalizedBooleans[bField] = false;
      continue;
    }
    if (typeof raw[bField] !== "boolean") {
      return { ok: false, error: `Invalid '${bField}': must be a boolean` };
    }
    normalizedBooleans[bField] = raw[bField];
  }

  const normalizedRate = normalizeOffsiteRate(raw.offsiteRate, normalizedBooleans.offsiteAds);
  if (normalizedRate === null) {
    return { ok: false, error: "Invalid 'offsiteRate': must be 0, 0.12, 0.15, 12, or 15" };
  }
  const offsiteAds = normalizedBooleans.offsiteAds || normalizedRate > 0;
  const offsiteRate = offsiteAds ? (normalizedRate > 0 ? normalizedRate : 0.15) : 0;

  let salesPerMonth = 30;
  if (raw.salesPerMonth !== undefined) {
    const spmCheck = validateNumberField(raw.salesPerMonth, "salesPerMonth", {
      min: 1,
      max: MAX_SALES_PER_MONTH,
      allowZero: false,
      integer: true
    });
    if (!spmCheck.ok) return spmCheck;
    salesPerMonth = spmCheck.value;
  }

  let listingCurrency = undefined;
  if (raw.listingCurrency !== undefined) {
    if (typeof raw.listingCurrency !== "string" || !CURRENCY_CODE_RE.test(raw.listingCurrency)) {
      return { ok: false, error: "Invalid 'listingCurrency': must be a 3-letter uppercase ISO currency code" };
    }
    listingCurrency = raw.listingCurrency;
  }

  let paymentAccountCurrency = undefined;
  if (raw.paymentAccountCurrency !== undefined) {
    if (typeof raw.paymentAccountCurrency !== "string" || !CURRENCY_CODE_RE.test(raw.paymentAccountCurrency)) {
      return { ok: false, error: "Invalid 'paymentAccountCurrency': must be a 3-letter uppercase ISO currency code" };
    }
    paymentAccountCurrency = raw.paymentAccountCurrency;
  }

  return {
    ok: true,
    data: Object.freeze({
      country,
      itemPrice,
      shipping: normalizedMoney.shipping,
      production: normalizedMoney.production,
      packaging: normalizedMoney.packaging,
      shippingCost: normalizedMoney.shippingCost,
      giftWrap: normalizedMoney.giftWrap,
      buyerSalesTax: normalizedMoney.buyerSalesTax,
      orderType,
      offsiteAds,
      offsiteRate,
      plusEnabled: normalizedBooleans.plusEnabled,
      salesPerMonth,
      targetProfit: normalizedMoney.targetProfit,
      listingCurrency,
      paymentAccountCurrency,
      payoutBalance: normalizedMoney.payoutBalance,
      usdExchangeRate,
      isDigital: normalizedBooleans.isDigital,
      freeShipping: normalizedBooleans.freeShipping,
      confirmZeroProduction: normalizedBooleans.confirmZeroProduction,
      confirmZeroShipping: normalizedBooleans.confirmZeroShipping
    })
  };
}

// ─── STEP 3: Deterministic Missing-Input Detection ────────────────────────────

const CLARIFICATION_PROMPTS = Object.freeze({
  country: "Which seller country applies to your shop (for example US, UK, CA, DE, AU, IN, JP, TR, or VN)?",
  orderType: "Is this a domestic order or an international order?",
  itemPrice: "What is your item listing price?",
  production: "What is your unit production or material cost (or confirm if it is genuinely 0 or a digital download)?",
  shipping: "Do you charge the buyer for shipping or offer free shipping (and what is your actual shipping cost)?",
  targetProfit: "What target net profit per order (or target profit margin %) would you like to achieve?",
  scenarios: "Which 2 to 4 pricing or shipping scenarios would you like to compare?",
  products: "Please provide between 1 and 10 products (each with a name and item price) to analyze."
});

/**
 * Deterministic pre-flight check that identifies missing or unconfirmed material inputs
 * before running advisor recommendations or pricing tools.
 *
 * Rules:
 * - Missing country -> ask which seller country applies.
 * - Missing item price (on tools that evaluate a current listing price) -> ask for the price.
 * - Physical product with unspecified production cost -> ask whether the cost is unknown or genuinely zero.
 * - Missing target profit when a target-price request requires it -> ask for the target.
 * - Ambiguous shipping assumptions -> ask whether the seller charges shipping or offers free shipping.
 *
 * Never treats an omitted material cost as zero without explicit confirmation.
 *
 * @param {Object} rawInput - Raw user/tool input parameters
 * @param {Object} [options] - Optional context: { toolName, requireConfirmedCosts }
 * @returns {Object} Structured clarification status
 */
export function detectMissingAdvisorInputs(rawInput, options = {}) {
  const toolName = options.toolName || "calculate_profit";
  const requireConfirmedCosts = options.requireConfirmedCosts !== false;

  if (!isPlainSafeObject(rawInput) || hasPrototypePollutionAttempt(rawInput)) {
    return Object.freeze({
      needsClarification: true,
      status: "needs_clarification",
      missingFields: Object.freeze(["country", "itemPrice"]),
      fieldPrompts: Object.freeze({
        country: CLARIFICATION_PROMPTS.country,
        itemPrice: CLARIFICATION_PROMPTS.itemPrice
      }),
      clarificationQuestion: `${CLARIFICATION_PROMPTS.country} ${CLARIFICATION_PROMPTS.itemPrice}`
    });
  }

  const missingFields = [];
  const fieldPrompts = {};

  const addMissing = (field, customPrompt) => {
    if (!missingFields.includes(field)) {
      missingFields.push(field);
      fieldPrompts[field] = customPrompt || CLARIFICATION_PROMPTS[field];
    }
  };

  // 1. Country check
  const normalizedCountryCode =
    typeof rawInput.country === "string" ? rawInput.country.trim().toUpperCase() : "";
  const hasValidCountry =
    normalizedCountryCode.length > 0 &&
    Object.prototype.hasOwnProperty.call(GLOBAL_COUNTRY_RULES, normalizedCountryCode);

  if (!hasValidCountry) {
    addMissing("country");
  } else if (options.requireExplicitOrderTypeWhenMaterial === true) {
    const domRule = resolveCountryFeeRule(normalizedCountryCode, { orderType: "domestic" });
    const intlRule = resolveCountryFeeRule(normalizedCountryCode, { orderType: "international" });
    const orderTypeMaterial =
      domRule.processingRate !== intlRule.processingRate ||
      domRule.processingFixed !== intlRule.processingFixed;
    if (orderTypeMaterial && !VALID_ORDER_TYPES.has(rawInput.orderType)) {
      addMissing("orderType");
    }
  }

  // Tool-specific required input checks
  if (toolName === "analyze_product_catalog") {
    if (!Array.isArray(rawInput.products) || rawInput.products.length === 0) {
      addMissing("products");
    } else {
      const missingProductPrice = rawInput.products.some(
        (p) => !p || typeof p !== "object" || typeof p.itemPrice !== "number" || !Number.isFinite(p.itemPrice) || p.itemPrice <= 0
      );
      if (missingProductPrice) {
        addMissing("itemPrice", "Every product in your catalog excerpt needs a positive item listing price.");
      }
    }
  } else if (toolName === "compare_price_scenarios") {
    if (!Array.isArray(rawInput.scenarios) || rawInput.scenarios.length < MIN_SCENARIO_COUNT) {
      addMissing("scenarios");
    }
  } else if (toolName === "find_target_price") {
    const hasTargetProfit =
      typeof rawInput.targetProfit === "number" &&
      Number.isFinite(rawInput.targetProfit) &&
      rawInput.targetProfit > 0;
    const hasTargetMargin =
      typeof rawInput.targetMarginPct === "number" &&
      Number.isFinite(rawInput.targetMarginPct) &&
      rawInput.targetMarginPct > 0;

    if (!hasTargetProfit && !hasTargetMargin) {
      addMissing("targetProfit");
    }
  } else {
    // calculate_profit or analyze_offsite_ads
    const hasItemPrice =
      typeof rawInput.itemPrice === "number" &&
      Number.isFinite(rawInput.itemPrice) &&
      rawInput.itemPrice > 0;

    if (!hasItemPrice) {
      addMissing("itemPrice");
    }
  }

  // Material cost & shipping confirmation checks for single-product tools
  if (requireConfirmedCosts && toolName !== "analyze_product_catalog" && toolName !== "compare_price_scenarios") {
    const isDigital = rawInput.isDigital === true;

    // Physical product with unspecified production cost
    const productionSpecified =
      typeof rawInput.production === "number" && Number.isFinite(rawInput.production) && rawInput.production >= 0;
    const confirmZeroProduction = rawInput.confirmZeroProduction === true;

    if (!isDigital && !productionSpecified && !confirmZeroProduction) {
      addMissing("production");
    }

    // Ambiguous shipping assumptions on physical products:
    // Verify whether shipping charged to buyer (or freeShipping confirmation) was provided
    const shippingSpecified =
      typeof rawInput.shipping === "number" && Number.isFinite(rawInput.shipping) && rawInput.shipping >= 0;
    const freeShippingConfirmed = rawInput.freeShipping === true || rawInput.confirmZeroShipping === true;
    const ambiguousFreeShippingWithoutCost =
      rawInput.freeShipping === true &&
      rawInput.shipping !== undefined &&
      rawInput.shipping > 0;

    if (!isDigital && ((!shippingSpecified && !freeShippingConfirmed) || ambiguousFreeShippingWithoutCost)) {
      addMissing(
        "shipping",
        ambiguousFreeShippingWithoutCost
          ? "You marked free shipping but also included a buyer shipping charge. Do you charge the buyer for shipping, or offer free shipping and absorb the shipping cost yourself?"
          : CLARIFICATION_PROMPTS.shipping
      );
    }
  }

  if (missingFields.length === 0) {
    return Object.freeze({
      needsClarification: false,
      status: "complete",
      missingFields: Object.freeze([]),
      fieldPrompts: Object.freeze({}),
      clarificationQuestion: null
    });
  }

  const questions = missingFields.map((f) => fieldPrompts[f]).filter(Boolean);
  const clarificationQuestion = questions.join(" ");

  return Object.freeze({
    needsClarification: true,
    status: "needs_clarification",
    missingFields: Object.freeze(missingFields),
    fieldPrompts: Object.freeze(fieldPrompts),
    clarificationQuestion
  });
}

// ─── Helper to Map Normalized Params to Fee Engine Input ──────────────────────

function toFeeEngineParams(d, overrides = {}) {
  const merged = { ...d, ...overrides };
  return {
    country: merged.country,
    itemPrice: merged.itemPrice,
    shipping: merged.shipping,
    giftWrap: merged.giftWrap,
    buyerSalesTax: merged.buyerSalesTax,
    orderType: merged.orderType,
    offsiteAds: merged.offsiteAds,
    shopOffsiteAdsTier: merged.offsiteRate || 0.15,
    offsiteRate: merged.offsiteRate,
    listingCurrency: merged.listingCurrency,
    paymentAccountCurrency: merged.paymentAccountCurrency,
    usdExchangeRate: merged.usdExchangeRate,
    salesPerMonth: merged.salesPerMonth,
    plusEnabled: merged.plusEnabled,
    itemCost: merged.production,
    packagingCost: merged.packaging,
    shippingCost: merged.shippingCost
  };
}

function roundTo(val, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(val) + Number.EPSILON) * factor) / factor;
}

// ─── TOOL 1: calculate_profit ─────────────────────────────────────────────────

export function runCalculateProfitTool(rawArgs) {
  const validated = validateSingleOrderParams(rawArgs, { requireItemPrice: true });
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const d = validated.data;
  const orderResult = calculateOrderFees(toFeeEngineParams(d));
  const analysis = computeDeterministicAnalysis(d);
  const currency = orderResult.metadata.currency;
  const minorUnitDigits = getCurrencyMinorUnitDigits(currency);

  return {
    ok: true,
    tool: "calculate_profit",
    result: Object.freeze({
      country: orderResult.metadata.country,
      countryName: orderResult.metadata.countryName,
      currency,
      payoutCurrency: orderResult.metadata.payoutCurrency,
      minorUnitDigits,
      unit: "major_currency",
      orderType: orderResult.metadata.orderType,
      profitStatus: analysis.metrics.netProfit < 0
        ? "loss"
        : Math.abs(analysis.metrics.netProfit) < 0.005
          ? "break_even"
          : analysis.metrics.marginPct < 20
            ? "thin_margin"
            : "profitable",
      inputs: Object.freeze({
        itemPrice: d.itemPrice,
        shipping: d.shipping,
        production: d.production,
        packaging: d.packaging,
        shippingCost: d.shippingCost,
        giftWrap: d.giftWrap,
        buyerSalesTax: d.buyerSalesTax,
        offsiteAds: d.offsiteAds,
        offsiteRate: d.offsiteRate,
        plusEnabled: d.plusEnabled,
        salesPerMonth: d.salesPerMonth
      }),
      feeBreakdown: orderResult.feeBreakdown,
      totals: Object.freeze({
        grossRevenue: analysis.metrics.grossRevenue,
        totalEtsyFees: orderResult.totals.totalEtsyFees,
        totalAccountLevelCosts: orderResult.totals.totalAccountLevelCosts,
        totalSellerCosts: analysis.metrics.totalCosts,
        netProfit: orderResult.totals.totalProfit,
        margin: orderResult.totals.margin,
        marginPct: analysis.metrics.marginPct,
        feeSharePct: analysis.metrics.feeSharePct,
        costSharePct: analysis.metrics.costSharePct,
        breakEvenPrice: orderResult.totals.breakEvenPrice,
        requiredPriceForTarget: analysis.metrics.requiredPriceForTarget,
        depositFee: analysis.metrics.depositFee
      }),
      largestDeduction: analysis.metrics.largestDeduction,
      bases: orderResult.bases,
      minorUnits: orderResult.minorUnits,
      metadata: orderResult.metadata
    })
  };
}

// ─── TOOL 2: find_target_price ────────────────────────────────────────────────

const FIND_TARGET_PRICE_KEYS = new Set([
  ...Object.keys(BASE_SINGLE_ORDER_PROPERTIES),
  "targetMarginPct"
]);

/**
 * Exact binary search in minor units to find minimum item price that achieves targetMarginPct.
 * Delegates all fee math to calculateOrderFees().
 */
function solveRequiredPriceForMarginPct(targetMarginPct, baseFeeInputs, currency) {
  const targetRatio = Number(targetMarginPct) / 100;
  const digits = getCurrencyMinorUnitDigits(currency);
  const factor = 10 ** digits;

  let high = Math.max(100, toMinorUnits(baseFeeInputs.itemCost + baseFeeInputs.packagingCost + baseFeeInputs.shippingCost + 10, currency) * 4);
  let safetyIterations = 0;
  while (safetyIterations < 64) {
    safetyIterations += 1;
    const probe = calculateOrderFees({ ...baseFeeInputs, itemPrice: high / factor });
    if (probe.totals.margin >= targetRatio && probe.totals.totalProfit >= 0) {
      break;
    }
    high = Math.max(high + 10 * factor, high * 2);
    if (high > 9_999_999_999) {
      return null;
    }
  }

  let low = 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const probe = calculateOrderFees({ ...baseFeeInputs, itemPrice: mid / factor });
    if (probe.totals.margin >= targetRatio && probe.totals.totalProfit >= 0) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  const finalPrice = fromMinorUnits(low, currency);
  const verification = calculateOrderFees({ ...baseFeeInputs, itemPrice: finalPrice });
  if (verification.totals.margin + 1e-6 < targetRatio) {
    return null;
  }
  return finalPrice;
}

export function runFindTargetPriceTool(rawArgs) {
  const validated = validateSingleOrderParams(rawArgs, {
    requireItemPrice: false,
    allowExtraKeys: FIND_TARGET_PRICE_KEYS
  });
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  let targetMarginPct = null;
  if (rawArgs.targetMarginPct !== undefined) {
    const marginCheck = validateNumberField(rawArgs.targetMarginPct, "targetMarginPct", {
      min: 0.1,
      max: 85,
      allowZero: false
    });
    if (!marginCheck.ok) return marginCheck;
    targetMarginPct = marginCheck.value;
  }

  const d = validated.data;
  const hasTargetProfit = d.targetProfit > 0;
  const hasTargetMargin = targetMarginPct !== null && targetMarginPct > 0;

  if (!hasTargetProfit && !hasTargetMargin) {
    return {
      ok: false,
      error: "Missing required target: provide a positive 'targetProfit' or 'targetMarginPct' (0.1 to 85)"
    };
  }

  const baseEngineInputs = toFeeEngineParams(d);
  const baseOrder = calculateOrderFees({ ...baseEngineInputs, itemPrice: d.itemPrice > 0 ? d.itemPrice : 1 });
  const currency = baseOrder.metadata.currency;
  const minorUnitDigits = getCurrencyMinorUnitDigits(currency);

  let requiredPrice;
  let solveMode;
  if (hasTargetProfit) {
    solveMode = "target_profit";
    requiredPrice = solveRequiredPrice(d.targetProfit, baseEngineInputs) / 100;
  } else {
    solveMode = "target_margin_pct";
    requiredPrice = solveRequiredPriceForMarginPct(targetMarginPct, baseEngineInputs, currency);
    if (requiredPrice === null) {
      return {
        ok: false,
        error: `Target margin of ${targetMarginPct}% is mathematically unreachable given Etsy fee rates and fixed costs`
      };
    }
  }

  const verifiedAtTarget = calculateOrderFees({ ...baseEngineInputs, itemPrice: requiredPrice });

  // Also compute required prices under 0%, 12%, and 15% Offsite Ads for the same target profit
  const effectiveTargetProfit = hasTargetProfit ? d.targetProfit : verifiedAtTarget.totals.totalProfit;
  const requiredPriceNoOffsite = solveRequiredPrice(effectiveTargetProfit, {
    ...baseEngineInputs,
    offsiteAds: false,
    offsiteRate: 0
  }) / 100;
  const requiredPriceOffsite12 = solveRequiredPrice(effectiveTargetProfit, {
    ...baseEngineInputs,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.12,
    offsiteRate: 0.12
  }) / 100;
  const requiredPriceOffsite15 = solveRequiredPrice(effectiveTargetProfit, {
    ...baseEngineInputs,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15,
    offsiteRate: 0.15
  }) / 100;

  return {
    ok: true,
    tool: "find_target_price",
    result: Object.freeze({
      country: verifiedAtTarget.metadata.country,
      countryName: verifiedAtTarget.metadata.countryName,
      currency,
      payoutCurrency: verifiedAtTarget.metadata.payoutCurrency,
      minorUnitDigits,
      unit: "major_currency",
      solveMode,
      targetProfit: roundTo(effectiveTargetProfit, minorUnitDigits),
      targetMarginPct: targetMarginPct !== null ? targetMarginPct : roundTo(verifiedAtTarget.totals.margin * 100, 2),
      requiredItemPrice: requiredPrice,
      requiredItemPriceCents: Math.round((requiredPrice + Number.EPSILON) * 100),
      breakEvenPrice: verifiedAtTarget.totals.breakEvenPrice,
      priceDeltaFromCurrent: d.itemPrice > 0 ? roundTo(requiredPrice - d.itemPrice, minorUnitDigits) : null,
      verifiedOutcomeAtTargetPrice: Object.freeze({
        grossRevenue: verifiedAtTarget.bases.transactionBase,
        totalEtsyFees: verifiedAtTarget.totals.totalEtsyFees,
        totalSellerCosts: fromMinorUnits(verifiedAtTarget.minorUnits.totalCosts, currency),
        netProfit: verifiedAtTarget.totals.totalProfit,
        marginPct: roundTo(verifiedAtTarget.totals.margin * 100, 2),
        feeBreakdown: verifiedAtTarget.feeBreakdown,
        minorUnits: verifiedAtTarget.minorUnits
      }),
      offsiteAdsTargetPrices: Object.freeze({
        noOffsiteAds: requiredPriceNoOffsite,
        offsiteAds12Pct: requiredPriceOffsite12,
        offsiteAds15Pct: requiredPriceOffsite15
      })
    })
  };
}

// ─── TOOL 3: compare_price_scenarios ──────────────────────────────────────────

const COMPARE_SCENARIOS_TOP_KEYS = new Set([
  ...Object.keys(BASE_SINGLE_ORDER_PROPERTIES),
  "scenarios"
]);

const SCENARIO_ITEM_KEYS = new Set([
  ...Object.keys(BASE_SINGLE_ORDER_PROPERTIES),
  "label"
]);

export function runComparePriceScenariosTool(rawArgs) {
  const baseValidated = validateSingleOrderParams(rawArgs, {
    requireItemPrice: false,
    allowExtraKeys: COMPARE_SCENARIOS_TOP_KEYS
  });
  if (!baseValidated.ok) {
    return { ok: false, error: baseValidated.error };
  }

  if (!Array.isArray(rawArgs.scenarios)) {
    return { ok: false, error: "Missing or invalid 'scenarios': must be an array of 2 to 4 scenarios" };
  }
  if (rawArgs.scenarios.length < MIN_SCENARIO_COUNT || rawArgs.scenarios.length > MAX_SCENARIO_COUNT) {
    return {
      ok: false,
      error: `Scenario count out of bounds: must provide between ${MIN_SCENARIO_COUNT} and ${MAX_SCENARIO_COUNT} scenarios (got ${rawArgs.scenarios.length})`
    };
  }

  const baseData = baseValidated.data;
  const evaluatedScenarios = [];

  for (let i = 0; i < rawArgs.scenarios.length; i++) {
    const rawScenario = rawArgs.scenarios[i];
    if (!isPlainSafeObject(rawScenario) || hasPrototypePollutionAttempt(rawScenario)) {
      return { ok: false, error: `Scenario at index ${i} must be a plain JSON object` };
    }

    for (const k of Object.keys(rawScenario)) {
      if (!SCENARIO_ITEM_KEYS.has(k)) {
        return { ok: false, error: `Unexpected field '${k}' in scenario at index ${i}` };
      }
    }

    if (!isSafePlainText(rawScenario.label, 80)) {
      return {
        ok: false,
        error: `Scenario at index ${i} has an invalid or unsafe 'label' (must be 1–80 safe text characters)`
      };
    }

    const mergedRaw = {
      country: rawScenario.country ?? rawArgs.country,
      itemPrice: rawScenario.itemPrice,
      shipping: rawScenario.shipping ?? rawArgs.shipping,
      production: rawScenario.production ?? rawArgs.production,
      packaging: rawScenario.packaging ?? rawArgs.packaging,
      shippingCost: rawScenario.shippingCost ?? rawArgs.shippingCost,
      giftWrap: rawScenario.giftWrap ?? rawArgs.giftWrap,
      buyerSalesTax: rawScenario.buyerSalesTax ?? rawArgs.buyerSalesTax,
      orderType: rawScenario.orderType ?? rawArgs.orderType,
      offsiteAds: rawScenario.offsiteAds ?? rawArgs.offsiteAds,
      offsiteRate: rawScenario.offsiteRate ?? rawArgs.offsiteRate,
      plusEnabled: rawScenario.plusEnabled ?? rawArgs.plusEnabled,
      salesPerMonth: rawScenario.salesPerMonth ?? rawArgs.salesPerMonth,
      targetProfit: rawScenario.targetProfit ?? rawArgs.targetProfit,
      listingCurrency: rawScenario.listingCurrency ?? rawArgs.listingCurrency,
      paymentAccountCurrency: rawScenario.paymentAccountCurrency ?? rawArgs.paymentAccountCurrency,
      payoutBalance: rawScenario.payoutBalance ?? rawArgs.payoutBalance,
      usdExchangeRate: rawScenario.usdExchangeRate ?? rawArgs.usdExchangeRate
    };

    // Strip undefined keys before validation
    const cleanedMerged = {};
    for (const [k, v] of Object.entries(mergedRaw)) {
      if (v !== undefined) cleanedMerged[k] = v;
    }

    const scenarioCheck = validateSingleOrderParams(cleanedMerged, { requireItemPrice: true });
    if (!scenarioCheck.ok) {
      return { ok: false, error: `Scenario '${rawScenario.label}' (index ${i}): ${scenarioCheck.error}` };
    }

    const sd = scenarioCheck.data;
    const orderRes = calculateOrderFees(toFeeEngineParams(sd));
    const currency = orderRes.metadata.currency;
    const digits = getCurrencyMinorUnitDigits(currency);
    const sellerCosts = fromMinorUnits(orderRes.minorUnits.totalCosts, currency);
    const marginPct = roundTo(orderRes.totals.margin * 100, 2);

    evaluatedScenarios.push({
      index: i,
      label: rawScenario.label.trim(),
      country: orderRes.metadata.country,
      currency,
      orderType: orderRes.metadata.orderType,
      inputs: Object.freeze({
        itemPrice: sd.itemPrice,
        shipping: sd.shipping,
        production: sd.production,
        packaging: sd.packaging,
        shippingCost: sd.shippingCost,
        offsiteAds: sd.offsiteAds,
        offsiteRate: sd.offsiteRate
      }),
      grossRevenue: orderRes.bases.transactionBase,
      totalEtsyFees: orderRes.totals.totalEtsyFees,
      totalSellerCosts: sellerCosts,
      netProfit: orderRes.totals.totalProfit,
      marginPct,
      breakEvenPrice: orderRes.totals.breakEvenPrice,
      feeBreakdown: orderRes.feeBreakdown,
      minorUnits: orderRes.minorUnits,
      minorUnitDigits: digits
    });
  }

  const baseline = evaluatedScenarios[0];
  const digits = baseline.minorUnitDigits;

  const scenariosWithDeltas = evaluatedScenarios.map((sc) =>
    Object.freeze({
      ...sc,
      deltaFromBaseline: Object.freeze({
        netProfitDelta: roundTo(sc.netProfit - baseline.netProfit, digits),
        marginPctDelta: roundTo(sc.marginPct - baseline.marginPct, 2),
        totalEtsyFeesDelta: roundTo(sc.totalEtsyFees - baseline.totalEtsyFees, digits),
        grossRevenueDelta: roundTo(sc.grossRevenue - baseline.grossRevenue, digits)
      })
    })
  );

  let bestByNetProfit = scenariosWithDeltas[0];
  let bestByMargin = scenariosWithDeltas[0];
  for (const sc of scenariosWithDeltas) {
    if (sc.netProfit > bestByNetProfit.netProfit) bestByNetProfit = sc;
    if (sc.marginPct > bestByMargin.marginPct) bestByMargin = sc;
  }

  return {
    ok: true,
    tool: "compare_price_scenarios",
    result: Object.freeze({
      country: baseData.country,
      currency: baseline.currency,
      minorUnitDigits: digits,
      unit: "major_currency",
      scenarioCount: scenariosWithDeltas.length,
      baselineLabel: baseline.label,
      bestScenarioByNetProfit: Object.freeze({
        index: bestByNetProfit.index,
        label: bestByNetProfit.label,
        netProfit: bestByNetProfit.netProfit,
        marginPct: bestByNetProfit.marginPct
      }),
      bestScenarioByMargin: Object.freeze({
        index: bestByMargin.index,
        label: bestByMargin.label,
        netProfit: bestByMargin.netProfit,
        marginPct: bestByMargin.marginPct
      }),
      scenarios: Object.freeze(scenariosWithDeltas)
    })
  };
}

// ─── TOOL 4: analyze_offsite_ads ──────────────────────────────────────────────

export function runAnalyzeOffsiteAdsTool(rawArgs) {
  const validated = validateSingleOrderParams(rawArgs, { requireItemPrice: true });
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const d = validated.data;
  const baseParams = toFeeEngineParams(d, { offsiteAds: false, offsiteRate: 0 });
  const order0 = calculateOrderFees(baseParams);
  const order12 = calculateOrderFees(toFeeEngineParams(d, {
    offsiteAds: true,
    shopOffsiteAdsTier: 0.12,
    offsiteRate: 0.12
  }));
  const order15 = calculateOrderFees(toFeeEngineParams(d, {
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15,
    offsiteRate: 0.15
  }));

  const currency = order0.metadata.currency;
  const digits = getCurrencyMinorUnitDigits(currency);
  const baselineNetProfit = order0.totals.totalProfit;
  const targetToPreserve = Math.max(0, baselineNetProfit);

  // Use existing reverse-pricing solver solveRequiredPrice() to compute exact Offsite Ads price buffers
  const requiredPrice12 = baselineNetProfit > 0
    ? solveRequiredPrice(targetToPreserve, toFeeEngineParams(d, {
        offsiteAds: true,
        shopOffsiteAdsTier: 0.12,
        offsiteRate: 0.12
      })) / 100
    : order12.totals.breakEvenPrice;

  const requiredPrice15 = baselineNetProfit > 0
    ? solveRequiredPrice(targetToPreserve, toFeeEngineParams(d, {
        offsiteAds: true,
        shopOffsiteAdsTier: 0.15,
        offsiteRate: 0.15
      })) / 100
    : order15.totals.breakEvenPrice;

  const uncapped12Minor = Math.round(order12.minorUnits.offsiteAdsBase * 0.12);
  const uncapped15Minor = Math.round(order15.minorUnits.offsiteAdsBase * 0.15);
  const capApplied12 = order12.minorUnits.offsiteAdsFee < uncapped12Minor;
  const capApplied15 = order15.minorUnits.offsiteAdsFee < uncapped15Minor;

  return {
    ok: true,
    tool: "analyze_offsite_ads",
    result: Object.freeze({
      country: order0.metadata.country,
      countryName: order0.metadata.countryName,
      currency,
      payoutCurrency: order0.metadata.payoutCurrency,
      minorUnitDigits: digits,
      unit: "major_currency",
      itemPrice: d.itemPrice,
      shipping: d.shipping,
      offsiteAdsBase: order0.bases.offsiteAdsBase,
      statutoryCap: STATUTORY_OFFSITE_ADS_CAP,
      tiers: Object.freeze({
        noOffsiteAds: Object.freeze({
          rate: 0,
          offsiteAdsFee: 0,
          totalEtsyFees: order0.totals.totalEtsyFees,
          netProfit: order0.totals.totalProfit,
          marginPct: roundTo(order0.totals.margin * 100, 2),
          breakEvenPrice: order0.totals.breakEvenPrice,
          minorUnits: order0.minorUnits
        }),
        mandatory12Pct: Object.freeze({
          rate: 0.12,
          offsiteAdsFee: order12.feeBreakdown.offsiteAds,
          capApplied: capApplied12,
          totalEtsyFees: order12.totals.totalEtsyFees,
          netProfit: order12.totals.totalProfit,
          marginPct: roundTo(order12.totals.margin * 100, 2),
          profitDropFromBaseline: roundTo(order0.totals.totalProfit - order12.totals.totalProfit, digits),
          breakEvenPrice: order12.totals.breakEvenPrice,
          requiredPriceToPreserveBaselineProfit: requiredPrice12,
          priceBufferNeeded: roundTo(requiredPrice12 - d.itemPrice, digits),
          minorUnits: order12.minorUnits
        }),
        optional15Pct: Object.freeze({
          rate: 0.15,
          offsiteAdsFee: order15.feeBreakdown.offsiteAds,
          capApplied: capApplied15,
          totalEtsyFees: order15.totals.totalEtsyFees,
          netProfit: order15.totals.totalProfit,
          marginPct: roundTo(order15.totals.margin * 100, 2),
          profitDropFromBaseline: roundTo(order0.totals.totalProfit - order15.totals.totalProfit, digits),
          breakEvenPrice: order15.totals.breakEvenPrice,
          requiredPriceToPreserveBaselineProfit: requiredPrice15,
          priceBufferNeeded: roundTo(requiredPrice15 - d.itemPrice, digits),
          minorUnits: order15.minorUnits
        })
      })
    })
  };
}

// ─── TOOL 5: analyze_product_catalog ──────────────────────────────────────────

const CATALOG_TOP_KEYS = new Set([
  "country",
  "orderType",
  "offsiteAds",
  "offsiteRate",
  "plusEnabled",
  "salesPerMonth",
  "listingCurrency",
  "paymentAccountCurrency",
  "products"
]);

const CATALOG_PRODUCT_KEYS = new Set([
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

export function runAnalyzeProductCatalogTool(rawArgs) {
  if (!isPlainSafeObject(rawArgs) || hasPrototypePollutionAttempt(rawArgs)) {
    return { ok: false, error: "Invalid arguments: expected a plain JSON object without prototype pollution keys" };
  }

  for (const key of Object.keys(rawArgs)) {
    if (!CATALOG_TOP_KEYS.has(key)) {
      return { ok: false, error: `Unexpected field '${key}' is not permitted in analyze_product_catalog` };
    }
  }

  const baseValidated = validateSingleOrderParams(
    {
      country: rawArgs.country,
      orderType: rawArgs.orderType,
      offsiteAds: rawArgs.offsiteAds,
      offsiteRate: rawArgs.offsiteRate,
      plusEnabled: rawArgs.plusEnabled,
      salesPerMonth: rawArgs.salesPerMonth,
      listingCurrency: rawArgs.listingCurrency,
      paymentAccountCurrency: rawArgs.paymentAccountCurrency
    },
    { requireItemPrice: false }
  );
  if (!baseValidated.ok) {
    return { ok: false, error: baseValidated.error };
  }

  if (!Array.isArray(rawArgs.products)) {
    return { ok: false, error: "Missing or invalid 'products': must be an array of 1 to 10 products" };
  }
  if (rawArgs.products.length < 1 || rawArgs.products.length > MAX_ADVISOR_CATALOG_PRODUCTS) {
    return {
      ok: false,
      error: `Catalog size out of bounds: advisor catalog analysis accepts 1 to ${MAX_ADVISOR_CATALOG_PRODUCTS} products per call (got ${rawArgs.products.length}). Use the browser Bulk Profit Analyzer for up to ${BULK_LIMITS.MAX_DATA_ROWS} rows.`
    };
  }

  const d = baseValidated.data;
  const normalizedRows = [];

  for (let i = 0; i < rawArgs.products.length; i++) {
    const item = rawArgs.products[i];
    if (!isPlainSafeObject(item) || hasPrototypePollutionAttempt(item)) {
      return { ok: false, error: `Product at index ${i} must be a plain JSON object` };
    }

    for (const k of Object.keys(item)) {
      if (!CATALOG_PRODUCT_KEYS.has(k)) {
        return { ok: false, error: `Unexpected field '${k}' in product at index ${i}` };
      }
    }

    if (!isSafePlainText(item.name, 120)) {
      return { ok: false, error: `Product at index ${i} has an invalid or unsafe 'name'` };
    }

    let sku = "";
    if (item.sku !== undefined && item.sku !== "") {
      if (!isSafePlainText(item.sku, 64)) {
        return { ok: false, error: `Product at index ${i} has an invalid or unsafe 'sku'` };
      }
      sku = item.sku.trim();
    }

    let quantity = 1;
    if (item.quantity !== undefined) {
      const qCheck = validateNumberField(item.quantity, `products[${i}].quantity`, {
        min: 1,
        max: 10_000,
        allowZero: false,
        integer: true
      });
      if (!qCheck.ok) return qCheck;
      quantity = qCheck.value;
    }

    const itemMerged = {
      country: d.country,
      itemPrice: item.itemPrice,
      shipping: item.shipping,
      production: item.production,
      packaging: item.packaging,
      shippingCost: item.shippingCost,
      giftWrap: item.giftWrap,
      buyerSalesTax: item.buyerSalesTax,
      targetProfit: item.targetProfit,
      offsiteAds: item.offsiteAds ?? d.offsiteAds,
      offsiteRate: item.offsiteRate ?? d.offsiteRate,
      orderType: item.orderType ?? d.orderType
    };
    const cleanedItem = {};
    for (const [k, v] of Object.entries(itemMerged)) {
      if (v !== undefined) cleanedItem[k] = v;
    }

    const itemValidated = validateSingleOrderParams(cleanedItem, { requireItemPrice: true });
    if (!itemValidated.ok) {
      return { ok: false, error: `Product '${item.name}' (index ${i}): ${itemValidated.error}` };
    }

    const idata = itemValidated.data;
    normalizedRows.push({
      rowNumber: i + 1,
      productName: item.name.trim(),
      sku,
      quantity,
      itemPrice: idata.itemPrice,
      shippingCharged: idata.shipping,
      productionCost: idata.production,
      packagingCost: idata.packaging,
      shippingCost: idata.shippingCost,
      giftWrap: idata.giftWrap,
      buyerSalesTax: idata.buyerSalesTax,
      targetProfit: idata.targetProfit > 0 ? idata.targetProfit : null,
      countryCode: idata.country,
      orderOrigin: idata.orderType,
      offsiteAdsRate: idata.offsiteAds ? idata.offsiteRate : 0,
      listingCurrency: d.listingCurrency || null,
      paymentAccountCurrency: d.paymentAccountCurrency || null,
      omittedFields: []
    });
  }

  const rule = resolveCountryFeeRule(d.country, { orderType: d.orderType });
  const activeCurrency = String(d.listingCurrency || rule.currency).toUpperCase();
  const activePayoutCurrency = d.paymentAccountCurrency
    ? String(d.paymentAccountCurrency).toUpperCase()
    : activeCurrency;

  const digits = getCurrencyMinorUnitDigits(activeCurrency);
  const bulkOptions = {
    plusEnabled: d.plusEnabled,
    salesPerMonth: d.salesPerMonth
  };

  // Delegate directly to src/bulk-analyzer.js without duplicating any catalog calculation logic
  const { results: calculatedRows, summary } = calculateBulkProducts(normalizedRows, bulkOptions);

  let totalQuantity = 0;
  let totalRevenue = 0;
  let totalNetProfit = 0;
  let highestMarginProduct = null;
  let lowestMarginProduct = null;

  const mappedProducts = calculatedRows.map((row, idx) => {
    const qty = normalizedRows[idx].quantity;
    const sku = normalizedRows[idx].sku;
    const netProfit = row.totals.totalProfit;
    const totalRowProfit = roundTo(netProfit * qty, digits);
    const totalSellerCosts = roundTo(row.totalDirectSellerCosts + row.totals.totalAccountLevelCosts, digits);
    const marginPct = roundTo(row.totals.margin * 100, 2);

    totalQuantity += qty;
    totalRevenue = roundTo(totalRevenue + row.grossRevenue * qty, digits);
    totalNetProfit = roundTo(totalNetProfit + totalRowProfit, digits);

    const entry = Object.freeze({
      rowNumber: row.rowNumber,
      name: row.productName,
      sku,
      quantity: qty,
      itemPrice: row.itemPrice,
      grossRevenue: row.grossRevenue,
      totalEtsyFees: row.totals.totalEtsyFees,
      totalSellerCosts,
      netProfit,
      totalRowProfit,
      marginPct,
      breakEvenPrice: row.totals.breakEvenPrice,
      targetPrice: row.requiredPriceForTarget,
      status: row.profitStatus,
      offsiteAds12NetProfit: row.scenarios.offsiteAds12.totals.totalProfit,
      offsiteAds12MarginPct: roundTo(row.scenarios.offsiteAds12.totals.margin * 100, 2),
      offsiteAds15NetProfit: row.scenarios.offsiteAds15.totals.totalProfit,
      offsiteAds15MarginPct: roundTo(row.scenarios.offsiteAds15.totals.margin * 100, 2),
      turnsUnprofitableWithOffsite15: row.becomesUnprofitableAt15Pct,
      minorUnits: row.minorUnits
    });

    if (!highestMarginProduct || entry.marginPct > highestMarginProduct.marginPct) {
      highestMarginProduct = { name: entry.name, marginPct: entry.marginPct, netProfit: entry.netProfit };
    }
    if (!lowestMarginProduct || entry.marginPct < lowestMarginProduct.marginPct) {
      lowestMarginProduct = { name: entry.name, marginPct: entry.marginPct, netProfit: entry.netProfit };
    }

    return entry;
  });

  return {
    ok: true,
    tool: "analyze_product_catalog",
    result: Object.freeze({
      country: rule.code,
      countryName: rule.name,
      currency: activeCurrency,
      payoutCurrency: activePayoutCurrency,
      minorUnitDigits: digits,
      unit: "major_currency",
      advisorCatalogLimit: MAX_ADVISOR_CATALOG_PRODUCTS,
      browserBulkMaxRows: BULK_LIMITS.MAX_DATA_ROWS,
      summary: Object.freeze({
        totalProducts: summary.productsAnalyzed,
        profitableCount: summary.profitableCount,
        lowMarginCount: summary.thinMarginCount,
        lossCount: summary.lossMakingCount,
        breakEvenCount: summary.breakEvenCount,
        offsiteAdsRiskCount: summary.offsiteAds15RiskCount,
        totalQuantity,
        totalRevenue,
        totalNetProfit,
        averageMarginPct: roundTo(summary.averageMargin * 100, 2),
        highestMarginProduct: highestMarginProduct ? Object.freeze(highestMarginProduct) : null,
        lowestMarginProduct: lowestMarginProduct ? Object.freeze(lowestMarginProduct) : null
      }),
      products: Object.freeze(mappedProducts)
    })
  };
}

// ─── Single & Batch Tool Dispatchers (Max 2 Executions Per Request) ───────────

const TOOL_HANDLERS = Object.freeze({
  calculate_profit: runCalculateProfitTool,
  find_target_price: runFindTargetPriceTool,
  compare_price_scenarios: runComparePriceScenariosTool,
  analyze_offsite_ads: runAnalyzeOffsiteAdsTool,
  analyze_product_catalog: runAnalyzeProductCatalogTool
});

/**
 * Validates and executes a single allowlisted deterministic tool call.
 * Never accesses D1, secrets, network, or dynamic code.
 *
 * @param {Object} toolCall - { name: string, arguments: Object }
 * @returns {Object} Structured tool result or safe error
 */
export function executeAdvisorTool(toolCall) {
  if (!isPlainSafeObject(toolCall) || hasPrototypePollutionAttempt(toolCall)) {
    return {
      ok: false,
      error: "invalid_tool_call",
      message: "Tool call must be a plain JSON object without prototype pollution keys"
    };
  }

  const allowedCallKeys = new Set(["name", "arguments"]);
  for (const k of Object.keys(toolCall)) {
    if (!allowedCallKeys.has(k)) {
      return {
        ok: false,
        error: "unexpected_tool_call_property",
        message: `Unexpected property '${k}' on tool call object`
      };
    }
  }

  const toolName = toolCall.name;
  if (typeof toolName !== "string" || !ALLOWED_TOOL_SET.has(toolName)) {
    return {
      ok: false,
      error: "unknown_tool",
      message: `Tool '${String(toolName)}' is not in the allowlisted ShopProfit advisor tools`
    };
  }

  const rawArgs = toolCall.arguments;
  if (!isPlainSafeObject(rawArgs) || hasPrototypePollutionAttempt(rawArgs)) {
    return {
      ok: false,
      error: "invalid_tool_arguments",
      message: "Tool arguments must be a plain JSON object without prototype pollution keys"
    };
  }

  let serializedInput;
  try {
    serializedInput = JSON.stringify(rawArgs);
  } catch {
    return {
      ok: false,
      error: "invalid_tool_arguments",
      message: "Tool arguments could not be serialized"
    };
  }

  const inputBytes = new TextEncoder().encode(serializedInput).byteLength;
  if (inputBytes > MAX_TOOL_INPUT_BYTES) {
    return {
      ok: false,
      error: "tool_input_too_large",
      message: `Tool arguments exceed maximum size of ${MAX_TOOL_INPUT_BYTES} bytes`
    };
  }

  const handler = TOOL_HANDLERS[toolName];
  const outcome = handler(rawArgs);
  if (!outcome.ok) {
    return {
      ok: false,
      tool: toolName,
      error: "invalid_tool_arguments",
      message: outcome.error
    };
  }

  const serializedOutput = JSON.stringify(outcome.result);
  const outputBytes = new TextEncoder().encode(serializedOutput).byteLength;
  if (outputBytes > MAX_TOOL_OUTPUT_BYTES) {
    return {
      ok: false,
      tool: toolName,
      error: "tool_output_too_large",
      message: "Tool output exceeded bounded size limit"
    };
  }

  // Verify no unsafe markup in serialized output
  if (UNSAFE_TEXT_RE.test(serializedOutput) || !verifyContentPolicy(serializedOutput).valid) {
    return {
      ok: false,
      tool: toolName,
      error: "unsafe_tool_output",
      message: "Tool output failed safety verification"
    };
  }

  return outcome;
}

/**
 * Executes a bounded batch of allowlisted deterministic tool calls.
 * Enforces a strict maximum of MAX_TOOL_CALLS_PER_REQUEST (2) executions per request,
 * with zero recursion and zero side effects.
 *
 * @param {Array<Object>} toolCalls - Array of { name, arguments }
 * @returns {Object} Batch execution result
 */
export function executeAdvisorToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return {
      ok: false,
      error: "invalid_tool_calls_payload",
      message: "Expected a non-empty array of tool calls"
    };
  }

  if (toolCalls.length > MAX_TOOL_CALLS_PER_REQUEST) {
    return {
      ok: false,
      error: "tool_execution_limit_exceeded",
      message: `Maximum ${MAX_TOOL_CALLS_PER_REQUEST} deterministic tool executions permitted per request (received ${toolCalls.length})`
    };
  }

  const results = [];
  for (let i = 0; i < toolCalls.length; i++) {
    const res = executeAdvisorTool(toolCalls[i]);
    if (!res.ok) {
      return {
        ok: false,
        failedIndex: i,
        error: res.error,
        message: res.message
      };
    }
    results.push(res);
  }

  return {
    ok: true,
    executionCount: results.length,
    results: Object.freeze(results)
  };
}

// ─── Phase 8B: Research-Assisted Deterministic Pricing & Scenario Helpers ────

/**
 * Evaluates a single profit scenario deterministically via `calculate_profit` (`src/fee-engine.js`).
 */
export function calculateProfitScenario(params = {}) {
  return executeAdvisorTool({
    name: "calculate_profit",
    arguments: params
  });
}

/**
 * Solves for required selling price to achieve a target profit or target margin via `find_target_price` (`src/fee-engine.js`).
 */
export function solveTargetPricing(params = {}) {
  return executeAdvisorTool({
    name: "find_target_price",
    arguments: params
  });
}

/**
 * Compares 2 to 4 candidate selling price points side-by-side via `compare_price_scenarios` (`src/fee-engine.js`).
 */
export function comparePricePoints(params = {}) {
  if (!isPlainSafeObject(params) || hasPrototypePollutionAttempt(params)) {
    return {
      ok: false,
      error: "invalid_tool_arguments",
      message: "Parameters must be a plain safe object"
    };
  }

  if (Array.isArray(params.scenarios)) {
    return executeAdvisorTool({
      name: "compare_price_scenarios",
      arguments: params
    });
  }

  const rawPrices = Array.isArray(params.pricePoints) ? params.pricePoints : [];
  const validPrices = rawPrices
    .map((p) => Number(p))
    .filter((p) => Number.isFinite(p) && p > 0 && p <= MAX_MONETARY_VALUE)
    .slice(0, MAX_SCENARIO_COUNT);

  if (validPrices.length < MIN_SCENARIO_COUNT) {
    return {
      ok: false,
      error: "invalid_tool_arguments",
      message: `comparePricePoints requires at least ${MIN_SCENARIO_COUNT} valid price points`
    };
  }

  const country = typeof params.country === "string" && params.country.trim() ? params.country.trim().toUpperCase() : "US";
  const baseShipping = Number.isFinite(Number(params.shipping)) && Number(params.shipping) >= 0 ? Number(params.shipping) : 0;

  const scenarios = validPrices.map((price, idx) => {
    const label = Array.isArray(params.labels) && typeof params.labels[idx] === "string" && params.labels[idx].trim()
      ? params.labels[idx].trim().slice(0, 80)
      : `Price Point ${idx + 1} (${price.toFixed(2)})`;
    return {
      label,
      itemPrice: price,
      shipping: baseShipping
    };
  });

  const toolArgs = {
    country,
    production: Number.isFinite(Number(params.production)) && Number(params.production) >= 0 ? Number(params.production) : 0,
    packaging: Number.isFinite(Number(params.packaging)) && Number(params.packaging) >= 0 ? Number(params.packaging) : 0,
    shippingCost: Number.isFinite(Number(params.shippingCost)) && Number(params.shippingCost) >= 0 ? Number(params.shippingCost) : 0,
    ...(typeof params.orderType === "string" ? { orderType: params.orderType } : {}),
    ...(typeof params.offsiteAds === "boolean" ? { offsiteAds: params.offsiteAds } : {}),
    ...(params.offsiteRate !== undefined ? { offsiteRate: params.offsiteRate } : {}),
    ...(typeof params.isDigital === "boolean" ? { isDigital: params.isDigital } : {}),
    scenarios
  };

  return executeAdvisorTool({
    name: "compare_price_scenarios",
    arguments: toolArgs
  });
}

/**
 * Compares buyer-paid shipping vs free shipping (either at same base price or shipping-rolled-in price)
 * deterministically via `compare_price_scenarios` (`src/fee-engine.js`).
 */
export function compareShippingStrategies(params = {}) {
  if (!isPlainSafeObject(params) || hasPrototypePollutionAttempt(params)) {
    return {
      ok: false,
      error: "invalid_tool_arguments",
      message: "Parameters must be a plain safe object"
    };
  }

  const country = typeof params.country === "string" && params.country.trim() ? params.country.trim().toUpperCase() : "US";
  const baseItemPrice = Number(params.itemPrice);
  if (!Number.isFinite(baseItemPrice) || baseItemPrice <= 0) {
    return {
      ok: false,
      error: "invalid_tool_arguments",
      message: "compareShippingStrategies requires a positive itemPrice"
    };
  }

  const shippingCost = Number.isFinite(Number(params.shippingCost)) && Number(params.shippingCost) >= 0
    ? Number(params.shippingCost)
    : 0;
  const buyerShippingCharge = Number.isFinite(Number(params.shipping)) && Number(params.shipping) > 0
    ? Number(params.shipping)
    : (shippingCost > 0 ? shippingCost : 5);
  const freeShippingItemPrice = Number.isFinite(Number(params.freeShippingItemPrice)) && Number(params.freeShippingItemPrice) > 0
    ? Number(params.freeShippingItemPrice)
    : Math.round((baseItemPrice + buyerShippingCharge) * 100) / 100;

  const scenarios = [
    {
      label: `Buyer-Paid Shipping (${baseItemPrice.toFixed(2)} + ${buyerShippingCharge.toFixed(2)} shipping)`,
      itemPrice: baseItemPrice,
      shipping: buyerShippingCharge
    },
    {
      label: `Free Shipping Rolled In (${freeShippingItemPrice.toFixed(2)} + Free Shipping)`,
      itemPrice: freeShippingItemPrice,
      shipping: 0,
      freeShipping: true
    }
  ];

  if (Math.abs(freeShippingItemPrice - baseItemPrice) > 0.005) {
    scenarios.push({
      label: `Free Shipping Absorbed (${baseItemPrice.toFixed(2)} + Free Shipping)`,
      itemPrice: baseItemPrice,
      shipping: 0,
      freeShipping: true
    });
  }

  return executeAdvisorTool({
    name: "compare_price_scenarios",
    arguments: {
      country,
      production: Number.isFinite(Number(params.production)) && Number(params.production) >= 0 ? Number(params.production) : 0,
      packaging: Number.isFinite(Number(params.packaging)) && Number(params.packaging) >= 0 ? Number(params.packaging) : 0,
      shippingCost,
      ...(typeof params.orderType === "string" ? { orderType: params.orderType } : {}),
      ...(typeof params.offsiteAds === "boolean" ? { offsiteAds: params.offsiteAds } : {}),
      ...(params.offsiteRate !== undefined ? { offsiteRate: params.offsiteRate } : {}),
      scenarios
    }
  });
}

/**
 * Evaluates Etsy Offsite Ads (0%, 12%, 15% with $100 cap) deterministically via `analyze_offsite_ads` (`src/fee-engine.js`).
 */
export function evaluateOffsiteAdsImpact(params = {}) {
  return executeAdvisorTool({
    name: "analyze_offsite_ads",
    arguments: params
  });
}

/**
 * Evaluates how matching or undercutting a publicly observed competitor price affects the seller's
 * unit economics, using `src/fee-engine.js` exclusively.
 */
export function evaluateCompetitorPriceGap(params = {}) {
  if (!isPlainSafeObject(params) || hasPrototypePollutionAttempt(params)) {
    return {
      ok: false,
      error: "invalid_tool_arguments",
      message: "Parameters must be a plain safe object"
    };
  }

  const country = typeof params.country === "string" && params.country.trim() ? params.country.trim().toUpperCase() : "US";
  const competitorPrice = Number(params.competitorPrice);
  if (!Number.isFinite(competitorPrice) || competitorPrice <= 0 || competitorPrice > MAX_MONETARY_VALUE) {
    return {
      ok: false,
      error: "invalid_tool_arguments",
      message: "evaluateCompetitorPriceGap requires a valid positive competitorPrice"
    };
  }

  const competitorShipping = Number.isFinite(Number(params.competitorShipping)) && Number(params.competitorShipping) >= 0
    ? Number(params.competitorShipping)
    : 0;
  const production = Number.isFinite(Number(params.production)) && Number(params.production) >= 0
    ? Number(params.production)
    : 0;
  const packaging = Number.isFinite(Number(params.packaging)) && Number(params.packaging) >= 0
    ? Number(params.packaging)
    : 0;
  const shippingCost = Number.isFinite(Number(params.shippingCost)) && Number(params.shippingCost) >= 0
    ? Number(params.shippingCost)
    : 0;

  const undercutPct = Number.isFinite(Number(params.undercutPct)) && Number(params.undercutPct) > 0 && Number(params.undercutPct) <= 50
    ? Number(params.undercutPct)
    : 5;
  const undercutPrice = Math.max(0.5, Math.round(competitorPrice * (1 - undercutPct / 100) * 100) / 100);
  const premiumPrice = Math.round(competitorPrice * 1.1 * 100) / 100;

  const scenarios = [
    {
      label: `Match Reference Price (${competitorPrice.toFixed(2)}${competitorShipping > 0 ? ` + ${competitorShipping.toFixed(2)} ship` : " Free Ship"})`,
      itemPrice: competitorPrice,
      shipping: competitorShipping
    },
    {
      label: `Undercut Reference by ${undercutPct}% (${undercutPrice.toFixed(2)}${competitorShipping > 0 ? ` + ${competitorShipping.toFixed(2)} ship` : " Free Ship"})`,
      itemPrice: undercutPrice,
      shipping: competitorShipping
    },
    {
      label: `Premium Differentiated +10% (${premiumPrice.toFixed(2)}${competitorShipping > 0 ? ` + ${competitorShipping.toFixed(2)} ship` : " Free Ship"})`,
      itemPrice: premiumPrice,
      shipping: competitorShipping
    }
  ];

  if (Number.isFinite(Number(params.sellerCurrentPrice)) && Number(params.sellerCurrentPrice) > 0) {
    const sellerShipping = Number.isFinite(Number(params.sellerShipping)) && Number(params.sellerShipping) >= 0
      ? Number(params.sellerShipping)
      : competitorShipping;
    scenarios.push({
      label: `Seller Current Price (${Number(params.sellerCurrentPrice).toFixed(2)}${sellerShipping > 0 ? ` + ${sellerShipping.toFixed(2)} ship` : " Free Ship"})`,
      itemPrice: Number(params.sellerCurrentPrice),
      shipping: sellerShipping
    });
  }

  const comparisonOutcome = executeAdvisorTool({
    name: "compare_price_scenarios",
    arguments: {
      country,
      production,
      packaging,
      shippingCost,
      ...(typeof params.orderType === "string" ? { orderType: params.orderType } : {}),
      ...(typeof params.offsiteAds === "boolean" ? { offsiteAds: params.offsiteAds } : {}),
      ...(params.offsiteRate !== undefined ? { offsiteRate: params.offsiteRate } : {}),
      scenarios
    }
  });

  if (!comparisonOutcome.ok) {
    return comparisonOutcome;
  }

  const targetMarginPct = Number.isFinite(Number(params.targetMarginPct)) && Number(params.targetMarginPct) > 0
    ? Number(params.targetMarginPct)
    : 25;
  const targetOutcome = executeAdvisorTool({
    name: "find_target_price",
    arguments: {
      country,
      itemPrice: competitorPrice,
      shipping: competitorShipping,
      production,
      packaging,
      shippingCost,
      targetMarginPct,
      ...(typeof params.orderType === "string" ? { orderType: params.orderType } : {}),
      ...(typeof params.offsiteAds === "boolean" ? { offsiteAds: params.offsiteAds } : {}),
      ...(params.offsiteRate !== undefined ? { offsiteRate: params.offsiteRate } : {})
    }
  });

  const matchScenario = comparisonOutcome.result.scenarios[0];
  const undercutScenario = comparisonOutcome.result.scenarios[1];
  const premiumScenario = comparisonOutcome.result.scenarios[2];

  const classifyViability = (scenario) => {
    if (!scenario || scenario.netProfit <= 0) return "loss_making";
    if (scenario.marginPct < 15) return "thin_margin";
    return "profitable";
  };

  const matchViability = classifyViability(matchScenario);
  const undercutViability = classifyViability(undercutScenario);
  const requiredPriceForTargetMargin = targetOutcome.ok ? targetOutcome.result.requiredItemPrice : matchScenario.breakEvenPrice;
  const priceGapVsTarget = Math.round((competitorPrice - requiredPriceForTargetMargin) * 100) / 100;

  return {
    ok: true,
    tool: "evaluate_competitor_price_gap",
    result: Object.freeze({
      country: comparisonOutcome.result.country,
      currency: comparisonOutcome.result.currency,
      competitorPrice,
      competitorShipping,
      competitorTotalBuyerPrice: Math.round((competitorPrice + competitorShipping) * 100) / 100,
      matchScenario,
      undercutScenario,
      premiumScenario,
      matchViability,
      undercutViability,
      breakEvenPrice: matchScenario.breakEvenPrice,
      targetMarginPct,
      requiredPriceForTargetMargin,
      priceGapVsTarget,
      canProfitablyMatch: matchViability === "profitable",
      canProfitablyUndercut: undercutViability === "profitable",
      comparison: comparisonOutcome.result
    })
  };
}

