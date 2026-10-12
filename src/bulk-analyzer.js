/**
 * ShopProfit Bulk Etsy Profit Analyzer (Browser-Side Deterministic Module)
 *
 * SAFETY & PRIVACY INVARIANTS:
 * - 100% client-side execution: Zero network requests, zero Worker uploads, zero AI calls, zero telemetry.
 * - Zero calculation duplication: Every fee, profit, margin, break-even, and target price
 *   is computed strictly through src/fee-engine.js (calculateOrderFees & solveRequiredPrice).
 * - Untrusted CSV defense:
 *   1. Pre-parse limits: Max 1 MiB (1,048,576 bytes), max 500 data rows, max 20 columns, max 1,000 chars/line.
 *   2. Encoding & binary guard: Rejects null bytes, binary control chars, invalid UTF-8 sequences, and lone surrogates.
 *   3. RFC 4180 compliance: Handles UTF-8 BOM, CRLF/LF, quoted fields, commas inside quotes, and escaped quotes ("").
 *   4. Spreadsheet formula injection defense: Prefixes untrusted text fields starting with =, +, -, @, \t, \r
 *      (including after leading whitespace or embedded newlines) with a single quote (') before RFC 4180 quoting.
 */

import {
  calculateOrderFees,
  solveRequiredPrice,
  resolveCountryFeeRule,
  getCurrencyMinorUnitDigits,
  formatMoney,
  GLOBAL_COUNTRY_RULES,
  STATUTORY_OFFSITE_ADS_CAP
} from "./fee-engine.js";

export const BULK_LIMITS = Object.freeze({
  MAX_FILE_BYTES: 1_048_576, // 1 MiB
  MAX_DATA_ROWS: 500,
  MAX_COLUMNS: 20,
  MAX_LINE_LENGTH: 1_000,
  MAX_PRODUCT_NAME_LENGTH: 120,
  MAX_AMOUNT: 99_999_999,
  THIN_MARGIN_THRESHOLD: 0.15 // 15.0% profit margin threshold for positive-profit items
});

/**
 * Canonical input column definitions and supported header aliases.
 * Normalization strips spaces, hyphens, and underscores and lowercases headers.
 */
export const CSV_HEADER_ALIASES = Object.freeze({
  product_name: ["productname", "product", "name", "title", "sku", "itemname", "listingtitle", "productorsku"],
  item_price: ["itemprice", "price", "sellingprice", "saleprice", "listingprice", "unitprice"],
  shipping_charged: ["shippingcharged", "shipping", "buyershipping", "shippingprice", "postagecharged", "postage"],
  production_cost: ["productioncost", "production", "itemcost", "cogs", "materialcost", "cost", "materials"],
  packaging_cost: ["packagingcost", "packaging", "fulfillmentcost", "packcost", "packagingandshippingcost"],
  shipping_cost: ["shippingcost", "sellershippingcost", "labelcost", "postagecost", "carrierlabelcost"],
  gift_wrap: ["giftwrap", "giftwrapprice", "giftwrapping"],
  buyer_sales_tax: ["buyersalestax", "salestax", "tax", "buyertax"],
  country: ["country", "countrycode", "sellercountry", "market", "location"],
  order_origin: ["orderorigin", "ordertype", "destination", "origin"],
  offsite_ads: ["offsiteads", "offsiteadstier", "offsiterate", "offsite"],
  target_profit: ["targetprofit", "desiredprofit", "targettakehome", "profitgoal"],
  listing_currency: ["listingcurrency", "currency"],
  payment_account_currency: ["paymentaccountcurrency", "payoutcurrency", "bankcurrency"]
});

export const REQUIRED_CSV_COLUMNS = Object.freeze(["product_name", "item_price"]);

export const EXPORT_CSV_HEADERS = Object.freeze([
  "product_name",
  "country",
  "currency",
  "order_origin",
  "item_price",
  "shipping_charged",
  "gift_wrap",
  "production_cost",
  "packaging_cost",
  "shipping_cost",
  "offsite_ads_tier",
  "gross_revenue",
  "listing_fee",
  "transaction_fee",
  "payment_processing_fee",
  "regulatory_fee",
  "offsite_ads_fee",
  "currency_conversion_fee",
  "etsy_plus_allocation",
  "total_etsy_fees",
  "total_seller_costs",
  "net_profit",
  "profit_margin_pct",
  "break_even_price",
  "target_profit",
  "required_price_for_target",
  "net_profit_no_offsite_ads",
  "net_profit_offsite_12pct",
  "net_profit_offsite_15pct",
  "offsite_15pct_unprofitable_risk",
  "profit_status"
]);

/**
 * Built-in demo product catalog for one-click exploration and sample CSV generation.
 */
export const DEMO_PRODUCTS = Object.freeze([
  Object.freeze({
    product_name: "Handmade Ceramic Mug 12oz",
    item_price: "35.00",
    shipping_charged: "5.00",
    production_cost: "7.00",
    packaging_cost: "4.00",
    offsite_ads: "none",
    target_profit: "25.00"
  }),
  Object.freeze({
    product_name: "Digital Wedding Planner PDF",
    item_price: "12.00",
    shipping_charged: "0.00",
    production_cost: "0.00",
    packaging_cost: "0.00",
    offsite_ads: "15",
    target_profit: "10.00"
  }),
  Object.freeze({
    product_name: "POD Vintage Graphic Tee",
    item_price: "24.99",
    shipping_charged: "4.99",
    production_cost: "18.50",
    packaging_cost: "5.25",
    offsite_ads: "none",
    target_profit: "8.00"
  }),
  Object.freeze({
    product_name: "Enamel Lapel Pin (Clearance)",
    item_price: "6.50",
    shipping_charged: "3.50",
    production_cost: "5.80",
    packaging_cost: "3.90",
    offsite_ads: "15",
    target_profit: "3.00"
  }),
  Object.freeze({
    product_name: "Custom Leather Weekender Bag",
    item_price: "850.00",
    shipping_charged: "25.00",
    production_cost: "310.00",
    packaging_cost: "28.00",
    offsite_ads: "12",
    target_profit: "450.00"
  })
]);

/**
 * Normalizes a header token for alias matching.
 */
export function normalizeHeaderName(rawHeader) {
  return String(rawHeader ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, "");
}

/**
 * Maps raw CSV header strings to canonical column keys.
 */
export function mapCsvHeaders(rawHeaders = []) {
  const columnMap = new Map();
  const unknownHeaders = [];
  const duplicateHeaders = [];
  const seenCanonical = new Set();

  rawHeaders.forEach((raw, index) => {
    const norm = normalizeHeaderName(raw);
    let matchedCanonical = null;
    for (const [canonical, aliases] of Object.entries(CSV_HEADER_ALIASES)) {
      if (aliases.includes(norm)) {
        matchedCanonical = canonical;
        break;
      }
    }
    if (matchedCanonical) {
      if (seenCanonical.has(matchedCanonical)) {
        duplicateHeaders.push(String(raw).trim());
      } else {
        seenCanonical.add(matchedCanonical);
        columnMap.set(matchedCanonical, index);
      }
    } else if (norm !== "") {
      unknownHeaders.push(String(raw).trim());
    }
  });

  const missingRequired = REQUIRED_CSV_COLUMNS.filter((req) => !columnMap.has(req));

  return {
    columnMap,
    missingRequired,
    unknownHeaders,
    duplicateHeaders,
    isValid: missingRequired.length === 0 && duplicateHeaders.length === 0
  };
}

/**
 * Inspects raw bytes or string for binary content, invalid UTF-8, or size violations.
 *
 * @param {string|Uint8Array|ArrayBuffer} input
 * @returns {{ ok: boolean, text?: string, byteLength: number, error?: string }}
 */
export function decodeAndValidateCsvText(input) {
  if (input == null) {
    return { ok: false, byteLength: 0, error: "CSV input is empty." };
  }

  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    const bytes = input instanceof Uint8Array
      ? input
      : new Uint8Array(input.buffer || input, input.byteOffset || 0, input.byteLength ?? input.length);

    if (bytes.byteLength > BULK_LIMITS.MAX_FILE_BYTES) {
      return {
        ok: false,
        byteLength: bytes.byteLength,
        error: `CSV file size (${bytes.byteLength.toLocaleString("en-US")} bytes) exceeds the maximum allowed 1 MiB (${BULK_LIMITS.MAX_FILE_BYTES.toLocaleString("en-US")} bytes).`
      };
    }

    // Binary content check: reject null bytes or non-whitespace control characters
    for (let i = 0; i < bytes.byteLength; i++) {
      const b = bytes[i];
      if (b === 0x00 || (b < 0x09) || (b >= 0x0b && b <= 0x0c) || (b >= 0x0e && b <= 0x1f)) {
        return {
          ok: false,
          byteLength: bytes.byteLength,
          error: "File contains binary data or unsupported control characters and cannot be parsed as CSV."
        };
      }
    }

    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const text = decoder.decode(bytes);
      return { ok: true, text, byteLength: bytes.byteLength };
    } catch {
      return {
        ok: false,
        byteLength: bytes.byteLength,
        error: "File contains invalid UTF-8 character encoding."
      };
    }
  }

  if (typeof input === "string") {
    // Fast pre-check before encoding
    if (input.length > BULK_LIMITS.MAX_FILE_BYTES) {
      return {
        ok: false,
        byteLength: input.length,
        error: `CSV content exceeds the maximum allowed 1 MiB (${BULK_LIMITS.MAX_FILE_BYTES.toLocaleString("en-US")} bytes).`
      };
    }

    // Check for lone UTF-16 surrogates, replacement characters (\uFFFD), or binary control chars
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (
        code === 0x0000 ||
        code === 0xfffd ||
        (code < 0x0009) ||
        (code >= 0x000b && code <= 0x000c) ||
        (code >= 0x000e && code <= 0x001f)
      ) {
        return {
          ok: false,
          byteLength: input.length,
          error: "CSV contains binary data, replacement characters, or invalid control characters."
        };
      }
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
        if (next < 0xdc00 || next > 0xdfff) {
          return {
            ok: false,
            byteLength: input.length,
            error: "CSV contains malformed UTF-16 surrogate characters."
          };
        }
        i++; // skip valid low surrogate
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return {
          ok: false,
          byteLength: input.length,
          error: "CSV contains malformed UTF-16 surrogate characters."
        };
      }
    }

    const byteLength = new TextEncoder().encode(input).byteLength;
    if (byteLength > BULK_LIMITS.MAX_FILE_BYTES) {
      return {
        ok: false,
        byteLength,
        error: `CSV file size (${byteLength.toLocaleString("en-US")} bytes) exceeds the maximum allowed 1 MiB (${BULK_LIMITS.MAX_FILE_BYTES.toLocaleString("en-US")} bytes).`
      };
    }

    return { ok: true, text: input, byteLength };
  }

  return { ok: false, byteLength: 0, error: "Unsupported CSV input type." };
}

/**
 * Bounded RFC 4180-compatible CSV parser.
 * Enforces file size, line length, column count, and row count limits during parsing.
 *
 * @param {string|Uint8Array|ArrayBuffer} rawInput
 * @returns {{
 *   ok: boolean,
 *   error?: string,
 *   headers?: string[],
 *   rows?: Array<{ rowNumber: number, values: string[] }>,
 *   byteLength?: number
 * }}
 */
export function parseCsvRecords(rawInput, { maxColumns = BULK_LIMITS.MAX_COLUMNS } = {}) {
  const decoded = decodeAndValidateCsvText(rawInput);
  if (!decoded.ok) {
    return { ok: false, error: decoded.error, byteLength: decoded.byteLength };
  }

  let text = decoded.text;
  // Strip UTF-8 BOM if present at start of file
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  if (text.trim().length === 0) {
    return { ok: false, error: "CSV file is empty.", byteLength: decoded.byteLength };
  }

  const records = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;
  let afterClosingQuote = false;
  let currentLineLength = 0;
  let physicalLineNumber = 1;
  let recordStartLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    currentLineLength++;

    if (currentLineLength > BULK_LIMITS.MAX_LINE_LENGTH) {
      return {
        ok: false,
        byteLength: decoded.byteLength,
        error: `Line ${recordStartLine} exceeds the maximum allowed length of ${BULK_LIMITS.MAX_LINE_LENGTH.toLocaleString("en-US")} characters.`
      };
    }

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i++;
          currentLineLength++;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
      } else {
        if (ch === "\n") {
          physicalLineNumber++;
        } else if (ch === "\r") {
          if (i + 1 < text.length && text[i + 1] === "\n") {
            currentField += "\n";
            i++;
          } else {
            currentField += "\n";
          }
          physicalLineNumber++;
          continue;
        }
        currentField += ch;
      }
      continue;
    }

    if (afterClosingQuote) {
      if (ch === " " || ch === "\t") {
        continue;
      }
      if (ch !== "," && ch !== "\r" && ch !== "\n") {
        return {
          ok: false,
          byteLength: decoded.byteLength,
          error: `Malformed CSV quote at line ${physicalLineNumber}: unexpected character after closing quote.`
        };
      }
      afterClosingQuote = false;
    }

    if (ch === '"') {
      if (currentField.trim() !== "") {
        return {
          ok: false,
          byteLength: decoded.byteLength,
          error: `Malformed CSV quote at line ${physicalLineNumber}: quote appeared inside an unquoted field.`
        };
      }
      currentField = "";
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      currentRow.push(currentField);
      if (currentRow.length > maxColumns) {
        return {
          ok: false,
          byteLength: decoded.byteLength,
          error: `Row at line ${recordStartLine} exceeds the maximum limit of ${maxColumns} columns.`
        };
      }
      currentField = "";
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && i + 1 < text.length && text[i + 1] === "\n") {
        i++;
      }
      currentRow.push(currentField);
      if (currentRow.length > maxColumns) {
        return {
          ok: false,
          byteLength: decoded.byteLength,
          error: `Row at line ${recordStartLine} exceeds the maximum limit of ${maxColumns} columns.`
        };
      }

      const isBlankRow = currentRow.length === 1 && currentRow[0].trim() === "";
      if (!isBlankRow) {
        records.push({ rowNumber: recordStartLine, values: currentRow });
        // Header is records[0]; data rows start at records[1]
        if (records.length - 1 > BULK_LIMITS.MAX_DATA_ROWS) {
          return {
            ok: false,
            byteLength: decoded.byteLength,
            error: `CSV exceeds the maximum limit of ${BULK_LIMITS.MAX_DATA_ROWS} product rows.`
          };
        }
      }

      currentRow = [];
      currentField = "";
      currentLineLength = 0;
      physicalLineNumber++;
      recordStartLine = physicalLineNumber;
      continue;
    }

    currentField += ch;
  }

  if (inQuotes) {
    return {
      ok: false,
      byteLength: decoded.byteLength,
      error: `Malformed CSV: unclosed quoted field starting on line ${recordStartLine}.`
    };
  }

  if (currentRow.length > 0 || currentField !== "") {
    currentRow.push(currentField);
    if (currentRow.length > maxColumns) {
      return {
        ok: false,
        byteLength: decoded.byteLength,
        error: `Row at line ${recordStartLine} exceeds the maximum limit of ${maxColumns} columns.`
      };
    }
    const isBlankRow = currentRow.length === 1 && currentRow[0].trim() === "";
    if (!isBlankRow) {
      records.push({ rowNumber: recordStartLine, values: currentRow });
      if (records.length - 1 > BULK_LIMITS.MAX_DATA_ROWS) {
        return {
          ok: false,
          byteLength: decoded.byteLength,
          error: `CSV exceeds the maximum limit of ${BULK_LIMITS.MAX_DATA_ROWS} product rows.`
        };
      }
    }
  }

  if (records.length === 0) {
    return { ok: false, byteLength: decoded.byteLength, error: "CSV file contains no header row." };
  }

  const headers = records[0].values;
  const rows = records.slice(1);

  if (rows.length === 0) {
    return {
      ok: false,
      byteLength: decoded.byteLength,
      headers,
      rows: [],
      error: "CSV file contains headers but no product rows."
    };
  }

  return {
    ok: true,
    byteLength: decoded.byteLength,
    headers,
    rows
  };
}

/**
 * Parses and validates a non-negative (or strictly positive) finite numeric field.
 */
function parseNumericCell(rawCell, fieldLabel, { required = false, allowZero = true, defaultValue = 0 } = {}) {
  const trimmed = String(rawCell ?? "").trim();
  if (trimmed === "") {
    if (required) {
      return { ok: false, omitted: true, error: `${fieldLabel} is required.` };
    }
    return { ok: true, omitted: true, value: defaultValue };
  }

  // Reject non-standard number formats like hex (0x), binary (0b), octal (0o), or trailing garbage
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return { ok: false, omitted: false, error: `${fieldLabel} ("${trimmed.slice(0, 32)}") must be a valid finite number.` };
  }

  const num = Number(trimmed);
  if (!Number.isFinite(num)) {
    return { ok: false, omitted: false, error: `${fieldLabel} must be a finite number.` };
  }

  if (allowZero ? num < 0 : num <= 0) {
    return {
      ok: false,
      omitted: false,
      error: allowZero
        ? `${fieldLabel} cannot be negative.`
        : `${fieldLabel} must be greater than 0.`
    };
  }

  if (num > BULK_LIMITS.MAX_AMOUNT) {
    return {
      ok: false,
      omitted: false,
      error: `${fieldLabel} cannot exceed ${BULK_LIMITS.MAX_AMOUNT.toLocaleString("en-US")}.`
    };
  }

  return { ok: true, omitted: false, value: num };
}

/**
 * Parses and validates the optional Offsite Ads tier column.
 */
function parseOffsiteAdsCell(rawCell, defaultRate = 0) {
  const trimmed = String(rawCell ?? "").trim().toLowerCase();
  if (trimmed === "") {
    return { ok: true, omitted: true, rate: Number(defaultRate) || 0 };
  }
  if (trimmed === "none" || trimmed === "0" || trimmed === "0%" || trimmed === "false" || trimmed === "no") {
    return { ok: true, omitted: false, rate: 0 };
  }
  if (trimmed === "12" || trimmed === "12%" || trimmed === "0.12") {
    return { ok: true, omitted: false, rate: 0.12 };
  }
  if (trimmed === "15" || trimmed === "15%" || trimmed === "0.15") {
    return { ok: true, omitted: false, rate: 0.15 };
  }
  return {
    ok: false,
    omitted: false,
    error: `Offsite Ads tier ("${trimmed.slice(0, 24)}") must be "none", "12", or "15".`
  };
}

/**
 * Parses and validates the optional order_origin column.
 */
function parseOrderOriginCell(rawCell, defaultOrigin = "domestic") {
  const trimmed = String(rawCell ?? "").trim().toLowerCase();
  if (trimmed === "") {
    return { ok: true, omitted: true, value: defaultOrigin === "international" ? "international" : "domestic" };
  }
  if (trimmed === "domestic" || trimmed === "dom") {
    return { ok: true, omitted: false, value: "domestic" };
  }
  if (trimmed === "international" || trimmed === "intl") {
    return { ok: true, omitted: false, value: "international" };
  }
  return {
    ok: false,
    omitted: false,
    error: `Order origin ("${trimmed.slice(0, 24)}") must be "domestic" or "international".`
  };
}

/**
 * Parses and validates the optional country column against supported markets.
 */
function parseCountryCell(rawCell, defaultCountryCode = "US", activeFeeSchedules = null) {
  const trimmed = String(rawCell ?? "").trim().toUpperCase();
  if (trimmed === "") {
    return { ok: true, omitted: true, code: String(defaultCountryCode || "US").toUpperCase() };
  }
  const isKnown = Boolean(
    GLOBAL_COUNTRY_RULES[trimmed] ||
    (activeFeeSchedules instanceof Map && activeFeeSchedules.has(trimmed))
  );
  if (!isKnown) {
    return {
      ok: false,
      omitted: false,
      error: `Unsupported country code "${trimmed.slice(0, 16)}". Use a supported ISO code (e.g. US, UK, CA, AU, DE, IN, JP) or OTHER.`
    };
  }
  return { ok: true, omitted: false, code: trimmed };
}

/**
 * Parses and validates a 3-letter ISO currency code if provided.
 */
function parseCurrencyCell(rawCell, fieldLabel) {
  const trimmed = String(rawCell ?? "").trim().toUpperCase();
  if (trimmed === "") {
    return { ok: true, omitted: true, value: null };
  }
  if (!/^[A-Z]{3}$/.test(trimmed)) {
    return {
      ok: false,
      omitted: false,
      error: `${fieldLabel} ("${trimmed.slice(0, 12)}") must be a 3-letter ISO currency code (e.g. USD, GBP, EUR, JPY).`
    };
  }
  return { ok: true, omitted: false, value: trimmed };
}

/**
 * Produces a structured import preview (headers, valid rows, invalid rows with individual errors)
 * without silently discarding any invalid row.
 *
 * @param {string|Uint8Array|ArrayBuffer} rawInput
 * @param {Object} defaults
 * @returns {Object} Structured preview object
 */
export function previewBulkCsv(rawInput, defaults = {}) {
  const parsed = parseCsvRecords(rawInput);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      byteLength: parsed.byteLength || 0,
      headers: parsed.headers || [],
      validRows: [],
      invalidRows: [],
      unknownHeaders: []
    };
  }

  const headerInfo = mapCsvHeaders(parsed.headers);
  if (!headerInfo.isValid) {
    const reasons = [];
    if (headerInfo.missingRequired.length > 0) {
      reasons.push(`Missing required CSV column(s): ${headerInfo.missingRequired.join(", ")}.`);
    }
    if (headerInfo.duplicateHeaders.length > 0) {
      reasons.push(`Duplicate CSV column(s): ${headerInfo.duplicateHeaders.join(", ")}.`);
    }
    return {
      ok: false,
      error: reasons.join(" "),
      byteLength: parsed.byteLength,
      headers: parsed.headers,
      missingRequired: headerInfo.missingRequired,
      duplicateHeaders: headerInfo.duplicateHeaders,
      unknownHeaders: headerInfo.unknownHeaders,
      validRows: [],
      invalidRows: []
    };
  }

  const defaultCountry = String(defaults.countryCode || "US").toUpperCase();
  const defaultOrigin = defaults.orderOrigin === "international" ? "international" : "domestic";
  const defaultOffsiteRate = Number(defaults.offsiteAdsRate) || 0;
  const activeFeeSchedules = defaults.activeFeeSchedules || null;

  const validRows = [];
  const invalidRows = [];
  const col = (values, key) => {
    const idx = headerInfo.columnMap.get(key);
    return idx !== undefined && idx < values.length ? values[idx] : "";
  };

  for (const row of parsed.rows) {
    const errors = [];
    const omittedFields = [];

    // 1. Product Name
    const rawName = String(col(row.values, "product_name") ?? "").trim();
    if (rawName === "") {
      errors.push("product_name is required.");
    } else if (rawName.length > BULK_LIMITS.MAX_PRODUCT_NAME_LENGTH) {
      errors.push(`product_name exceeds ${BULK_LIMITS.MAX_PRODUCT_NAME_LENGTH} characters.`);
    }

    // 2. Item Price (Required, > 0)
    const itemPriceRes = parseNumericCell(col(row.values, "item_price"), "item_price", {
      required: true,
      allowZero: false
    });
    if (!itemPriceRes.ok) errors.push(itemPriceRes.error);

    // 3. Optional numeric costs & charges
    const shippingChargedRes = parseNumericCell(col(row.values, "shipping_charged"), "shipping_charged", {
      required: false,
      allowZero: true,
      defaultValue: 0
    });
    if (!shippingChargedRes.ok) errors.push(shippingChargedRes.error);
    else if (shippingChargedRes.omitted) omittedFields.push("shipping_charged");

    const productionCostRes = parseNumericCell(col(row.values, "production_cost"), "production_cost", {
      required: false,
      allowZero: true,
      defaultValue: 0
    });
    if (!productionCostRes.ok) errors.push(productionCostRes.error);
    else if (productionCostRes.omitted) omittedFields.push("production_cost");

    const packagingCostRes = parseNumericCell(col(row.values, "packaging_cost"), "packaging_cost", {
      required: false,
      allowZero: true,
      defaultValue: 0
    });
    if (!packagingCostRes.ok) errors.push(packagingCostRes.error);
    else if (packagingCostRes.omitted) omittedFields.push("packaging_cost");

    const shippingCostRes = parseNumericCell(col(row.values, "shipping_cost"), "shipping_cost", {
      required: false,
      allowZero: true,
      defaultValue: 0
    });
    if (!shippingCostRes.ok) errors.push(shippingCostRes.error);
    else if (shippingCostRes.omitted) omittedFields.push("shipping_cost");

    const giftWrapRes = parseNumericCell(col(row.values, "gift_wrap"), "gift_wrap", {
      required: false,
      allowZero: true,
      defaultValue: 0
    });
    if (!giftWrapRes.ok) errors.push(giftWrapRes.error);
    else if (giftWrapRes.omitted) omittedFields.push("gift_wrap");

    const buyerSalesTaxRes = parseNumericCell(col(row.values, "buyer_sales_tax"), "buyer_sales_tax", {
      required: false,
      allowZero: true,
      defaultValue: 0
    });
    if (!buyerSalesTaxRes.ok) errors.push(buyerSalesTaxRes.error);
    else if (buyerSalesTaxRes.omitted) omittedFields.push("buyer_sales_tax");

    // 4. Optional target_profit (distinguish omitted -> null vs explicit 0 -> 0)
    const targetProfitRes = parseNumericCell(col(row.values, "target_profit"), "target_profit", {
      required: false,
      allowZero: true,
      defaultValue: null
    });
    if (!targetProfitRes.ok) errors.push(targetProfitRes.error);
    else if (targetProfitRes.omitted) omittedFields.push("target_profit");

    // 5. Optional country, order_origin, offsite_ads, currencies
    const countryRes = parseCountryCell(col(row.values, "country"), defaultCountry, activeFeeSchedules);
    if (!countryRes.ok) errors.push(countryRes.error);
    else if (countryRes.omitted) omittedFields.push("country");

    const originRes = parseOrderOriginCell(col(row.values, "order_origin"), defaultOrigin);
    if (!originRes.ok) errors.push(originRes.error);
    else if (originRes.omitted) omittedFields.push("order_origin");

    const offsiteRes = parseOffsiteAdsCell(col(row.values, "offsite_ads"), defaultOffsiteRate);
    if (!offsiteRes.ok) errors.push(offsiteRes.error);
    else if (offsiteRes.omitted) omittedFields.push("offsite_ads");

    const listingCurrRes = parseCurrencyCell(col(row.values, "listing_currency"), "listing_currency");
    if (!listingCurrRes.ok) errors.push(listingCurrRes.error);
    else if (listingCurrRes.omitted) omittedFields.push("listing_currency");

    const payoutCurrRes = parseCurrencyCell(col(row.values, "payment_account_currency"), "payment_account_currency");
    if (!payoutCurrRes.ok) errors.push(payoutCurrRes.error);
    else if (payoutCurrRes.omitted) omittedFields.push("payment_account_currency");

    if (errors.length > 0) {
      invalidRows.push({
        rowNumber: row.rowNumber,
        productName: rawName || `(Row ${row.rowNumber})`,
        errors
      });
    } else {
      validRows.push({
        rowNumber: row.rowNumber,
        productName: rawName,
        itemPrice: itemPriceRes.value,
        shippingCharged: shippingChargedRes.value,
        productionCost: productionCostRes.value,
        packagingCost: packagingCostRes.value,
        shippingCost: shippingCostRes.value,
        giftWrap: giftWrapRes.value,
        buyerSalesTax: buyerSalesTaxRes.value,
        targetProfit: targetProfitRes.omitted ? null : targetProfitRes.value,
        countryCode: countryRes.code,
        orderOrigin: originRes.value,
        offsiteAdsRate: offsiteRes.rate,
        listingCurrency: listingCurrRes.value,
        paymentAccountCurrency: payoutCurrRes.value,
        omittedFields
      });
    }
  }

  return {
    ok: true,
    byteLength: parsed.byteLength,
    headers: parsed.headers,
    unknownHeaders: headerInfo.unknownHeaders,
    totalRows: parsed.rows.length,
    validCount: validRows.length,
    invalidCount: invalidRows.length,
    validRows,
    invalidRows
  };
}

/**
 * Resolves the schedule or rule for a given country code.
 */
function resolveScheduleForCountry(countryCode, activeFeeSchedules = null) {
  const code = String(countryCode || "US").toUpperCase();
  if (activeFeeSchedules instanceof Map && activeFeeSchedules.has(code)) {
    return activeFeeSchedules.get(code);
  }
  return resolveCountryFeeRule(code);
}

/**
 * Runs deterministic fee-engine calculations across all valid rows in a preview.
 *
 * @param {Array} validRows - Validated product rows from previewBulkCsv()
 * @param {Object} options - Calculator defaults (countryCode, orderOrigin, offsiteAdsRate, plusEnabled, salesPerMonth, activeFeeSchedules, usdExchangeRate)
 * @returns {{ results: Array, summary: Object }}
 */
export function calculateBulkProducts(validRows = [], options = {}) {
  const plusEnabled = Boolean(options.plusEnabled);
  const salesPerMonth = Math.max(1, Math.min(10_000, Number(options.salesPerMonth) || 30));
  const activeFeeSchedules = options.activeFeeSchedules || null;
  const usdExchangeRate = options.usdExchangeRate;

  const results = validRows.map((row, index) => {
    const schedule = resolveScheduleForCountry(row.countryCode, activeFeeSchedules);
    const rule = resolveCountryFeeRule(schedule, { orderType: row.orderOrigin });
    const activeCurrency = String(row.listingCurrency || rule.currency || "USD").toUpperCase();
    const activePayoutCurrency = String(row.paymentAccountCurrency || activeCurrency).toUpperCase();

    const baseInputs = {
      country: schedule,
      itemPrice: row.itemPrice,
      shipping: row.shippingCharged,
      giftWrap: row.giftWrap,
      buyerSalesTax: row.buyerSalesTax,
      production: row.productionCost,
      packaging: row.packagingCost,
      shippingCost: row.shippingCost,
      orderType: row.orderOrigin,
      plusEnabled,
      salesPerMonth,
      listingCurrency: activeCurrency,
      paymentAccountCurrency: activePayoutCurrency,
      ...(usdExchangeRate !== undefined ? { usdExchangeRate } : {})
    };

    // 1. Selected scenario calculation
    const selectedCalc = calculateOrderFees({
      ...baseInputs,
      offsiteAds: row.offsiteAdsRate > 0,
      shopOffsiteAdsTier: row.offsiteAdsRate
    });

    // 2. 0% Offsite Ads scenario
    const noAdsCalc = row.offsiteAdsRate === 0
      ? selectedCalc
      : calculateOrderFees({
          ...baseInputs,
          offsiteAds: false,
          shopOffsiteAdsTier: 0
        });

    // 3. 12% Offsite Ads scenario
    const offsite12Calc = row.offsiteAdsRate === 0.12
      ? selectedCalc
      : calculateOrderFees({
          ...baseInputs,
          offsiteAds: true,
          shopOffsiteAdsTier: 0.12
        });

    // 4. 15% Offsite Ads scenario
    const offsite15Calc = row.offsiteAdsRate === 0.15
      ? selectedCalc
      : calculateOrderFees({
          ...baseInputs,
          offsiteAds: true,
          shopOffsiteAdsTier: 0.15
        });

    // 5. Optional Target Price calculation (strictly when targetProfit is provided)
    let requiredPriceCents = null;
    let requiredPriceForTarget = null;
    if (row.targetProfit !== null && row.targetProfit !== undefined) {
      requiredPriceCents = solveRequiredPrice(row.targetProfit, {
        ...baseInputs,
        offsiteAds: row.offsiteAdsRate > 0,
        shopOffsiteAdsTier: row.offsiteAdsRate
      });
      const digits = getCurrencyMinorUnitDigits(activeCurrency);
      const rawMajor = requiredPriceCents / 100;
      requiredPriceForTarget = digits === 0 ? Math.round(rawMajor) : rawMajor;
    }

    // Status classification using documented thresholds:
    // - "loss": netProfit < 0
    // - "break_even": netProfit === 0
    // - "thin_margin": netProfit > 0 and margin < 15% (0.15)
    // - "profitable": netProfit > 0 and margin >= 15% (0.15)
    const netMinor = selectedCalc.minorUnits.netProfit;
    const margin = selectedCalc.totals.margin;
    let profitStatus;
    let profitStatusLabel;
    if (netMinor < 0) {
      profitStatus = "loss";
      profitStatusLabel = "Loss-making";
    } else if (netMinor === 0) {
      profitStatus = "break_even";
      profitStatusLabel = "Break-even";
    } else if (margin < BULK_LIMITS.THIN_MARGIN_THRESHOLD) {
      profitStatus = "thin_margin";
      profitStatusLabel = "Thin margin (<15%)";
    } else {
      profitStatus = "profitable";
      profitStatusLabel = "Profitable (≥15%)";
    }

    // Offsite Ads 15% risk: profitable without Offsite Ads (or in selected scenario),
    // but becomes unprofitable (netProfit <= 0) under the 15% Offsite Ads scenario.
    const becomesUnprofitableAt15Pct =
      (noAdsCalc.minorUnits.netProfit > 0 || selectedCalc.minorUnits.netProfit > 0) &&
      offsite15Calc.minorUnits.netProfit <= 0;

    const totalDirectSellerCosts = row.productionCost + row.packagingCost + row.shippingCost;

    return Object.freeze({
      index,
      rowNumber: row.rowNumber,
      productName: row.productName,
      countryCode: rule.code,
      countryName: rule.name,
      currency: activeCurrency,
      payoutCurrency: activePayoutCurrency,
      locale: rule.locale,
      symbol: rule.symbol,
      orderOrigin: row.orderOrigin,
      offsiteAdsRate: row.offsiteAdsRate,
      itemPrice: row.itemPrice,
      shippingCharged: row.shippingCharged,
      giftWrap: row.giftWrap,
      buyerSalesTax: row.buyerSalesTax,
      productionCost: row.productionCost,
      packagingCost: row.packagingCost,
      shippingCost: row.shippingCost,
      totalDirectSellerCosts,
      targetProfit: row.targetProfit,
      requiredPriceCents,
      requiredPriceForTarget,
      grossRevenue: selectedCalc.bases.transactionBase,
      feeBreakdown: selectedCalc.feeBreakdown,
      totals: selectedCalc.totals,
      minorUnits: selectedCalc.minorUnits,
      legacy: selectedCalc.legacy,
      informational: selectedCalc.informational,
      metadata: selectedCalc.metadata,
      scenarios: Object.freeze({
        selected: selectedCalc,
        noOffsiteAds: noAdsCalc,
        offsiteAds12: offsite12Calc,
        offsiteAds15: offsite15Calc
      }),
      profitStatus,
      profitStatusLabel,
      becomesUnprofitableAt15Pct,
      omittedFields: row.omittedFields
    });
  });

  const summary = summarizeBulkResults(results);
  return { results, summary };
}

/**
 * Computes aggregate metrics across calculated bulk product rows.
 */
export function summarizeBulkResults(results = []) {
  const count = results.length;
  if (count === 0) {
    return Object.freeze({
      productsAnalyzed: 0,
      profitableCount: 0,
      lossMakingCount: 0,
      breakEvenCount: 0,
      thinMarginCount: 0,
      offsiteAds15RiskCount: 0,
      averageMargin: 0,
      thinMarginThreshold: BULK_LIMITS.THIN_MARGIN_THRESHOLD
    });
  }

  let profitableCount = 0;
  let lossMakingCount = 0;
  let breakEvenCount = 0;
  let thinMarginCount = 0;
  let offsiteAds15RiskCount = 0;
  let marginSum = 0;

  for (const item of results) {
    if (item.minorUnits.netProfit > 0) {
      profitableCount++;
      if (item.totals.margin < BULK_LIMITS.THIN_MARGIN_THRESHOLD) {
        thinMarginCount++;
      }
    } else if (item.minorUnits.netProfit < 0) {
      lossMakingCount++;
    } else {
      breakEvenCount++;
    }

    if (item.becomesUnprofitableAt15Pct) {
      offsiteAds15RiskCount++;
    }

    marginSum += item.totals.margin;
  }

  return Object.freeze({
    productsAnalyzed: count,
    profitableCount,
    lossMakingCount,
    breakEvenCount,
    thinMarginCount,
    offsiteAds15RiskCount,
    averageMargin: marginSum / count,
    thinMarginThreshold: BULK_LIMITS.THIN_MARGIN_THRESHOLD
  });
}

/**
 * Filters and sorts calculated bulk product rows.
 *
 * @param {Array} results
 * @param {{ filter?: string, sortBy?: string, sortDir?: "asc"|"desc" }} options
 */
export function filterAndSortBulkResults(results = [], { filter = "all", sortBy = "rowNumber", sortDir = "asc" } = {}) {
  const filtered = results.filter((item) => {
    switch (filter) {
      case "losses":
        return item.minorUnits.netProfit < 0;
      case "thin_margin":
        return item.minorUnits.netProfit > 0 && item.totals.margin < BULK_LIMITS.THIN_MARGIN_THRESHOLD;
      case "offsite_risk":
        return item.becomesUnprofitableAt15Pct;
      case "all":
      default:
        return true;
    }
  });

  const dir = sortDir === "desc" ? -1 : 1;
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "productName":
        cmp = a.productName.localeCompare(b.productName, undefined, { sensitivity: "base" });
        break;
      case "itemPrice":
        cmp = a.itemPrice - b.itemPrice;
        break;
      case "totalEtsyFees":
        cmp = a.totals.totalEtsyFees - b.totals.totalEtsyFees;
        break;
      case "totalCosts":
        cmp = (a.totalDirectSellerCosts + a.totals.totalAccountLevelCosts) -
              (b.totalDirectSellerCosts + b.totals.totalAccountLevelCosts);
        break;
      case "netProfit":
        cmp = a.totals.totalProfit - b.totals.totalProfit;
        break;
      case "margin":
        cmp = a.totals.margin - b.totals.margin;
        break;
      case "breakEvenPrice":
        cmp = a.totals.breakEvenPrice - b.totals.breakEvenPrice;
        break;
      case "offsite15Profit":
        cmp = a.scenarios.offsiteAds15.totals.totalProfit - b.scenarios.offsiteAds15.totals.totalProfit;
        break;
      case "rowNumber":
      default:
        cmp = a.rowNumber - b.rowNumber;
        break;
    }
    if (cmp !== 0) return cmp * dir;
    return a.rowNumber - b.rowNumber;
  });

  return sorted;
}

/**
 * Neutralizes spreadsheet formula injection in untrusted string cells and applies RFC 4180 quoting.
 * Any text starting with =, +, -, @, \t, or \r (at start, after leading whitespace, or after a newline)
 * is prefixed with a single quote (').
 */
export function sanitizeCsvTextCell(rawText) {
  let str = String(rawText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const isFormulaTrigger = (s) => {
    if (!s) return false;
    const firstRaw = s[0];
    if (firstRaw === "=" || firstRaw === "+" || firstRaw === "-" || firstRaw === "@" || firstRaw === "\t" || firstRaw === "\r") {
      return true;
    }
    const trimmed = s.trimStart();
    if (!trimmed) return false;
    const firstTrimmed = trimmed[0];
    return firstTrimmed === "=" || firstTrimmed === "+" || firstTrimmed === "-" || firstTrimmed === "@";
  };

  // Check each line segment for formula triggers
  const lines = str.split("\n").map((line) => (isFormulaTrigger(line) ? `'${line}` : line));
  str = lines.join("\n");

  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.startsWith(" ") ||
    str.endsWith(" ")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats a validated numeric value for CSV export without exposing raw user strings.
 */
function formatCsvNumericCell(value, currency = "USD") {
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return "0.00";
  const digits = getCurrencyMinorUnitDigits(currency);
  return num.toFixed(digits);
}

/**
 * Generates a downloadable sample CSV string using DEMO_PRODUCTS.
 */
export function generateSampleCsv() {
  const headers = [
    "product_name",
    "item_price",
    "shipping_charged",
    "production_cost",
    "packaging_cost",
    "offsite_ads",
    "target_profit"
  ];
  const rows = DEMO_PRODUCTS.map((item) => [
    sanitizeCsvTextCell(item.product_name),
    item.item_price,
    item.shipping_charged,
    item.production_cost,
    item.packaging_cost,
    sanitizeCsvTextCell(item.offsite_ads),
    item.target_profit
  ].join(","));

  return [headers.join(","), ...rows].join("\r\n") + "\r\n";
}

/**
 * Serializes calculated bulk product results into a safe, formula-neutralized RFC 4180 CSV string.
 */
export function serializeBulkResultsToCsv(results = []) {
  const headerLine = EXPORT_CSV_HEADERS.join(",");
  const lines = results.map((item) => {
    const curr = item.currency;
    const offsiteLabel = item.offsiteAdsRate === 0.15
      ? "15%"
      : (item.offsiteAdsRate === 0.12 ? "12%" : "none");
    const totalSellerCosts = item.totalDirectSellerCosts + item.totals.totalAccountLevelCosts;

    const cells = [
      sanitizeCsvTextCell(item.productName),
      sanitizeCsvTextCell(item.countryCode),
      sanitizeCsvTextCell(curr),
      sanitizeCsvTextCell(item.orderOrigin),
      formatCsvNumericCell(item.itemPrice, curr),
      formatCsvNumericCell(item.shippingCharged, curr),
      formatCsvNumericCell(item.giftWrap, curr),
      formatCsvNumericCell(item.productionCost, curr),
      formatCsvNumericCell(item.packagingCost, curr),
      formatCsvNumericCell(item.shippingCost, curr),
      sanitizeCsvTextCell(offsiteLabel),
      formatCsvNumericCell(item.grossRevenue, curr),
      formatCsvNumericCell(item.feeBreakdown.listing, curr),
      formatCsvNumericCell(item.feeBreakdown.transaction, curr),
      formatCsvNumericCell(item.feeBreakdown.processing, curr),
      formatCsvNumericCell(item.feeBreakdown.regulatory, curr),
      formatCsvNumericCell(item.feeBreakdown.offsiteAds, curr),
      formatCsvNumericCell(item.feeBreakdown.currencyConversion, curr),
      formatCsvNumericCell(item.feeBreakdown.etsyPlusAmortized, curr),
      formatCsvNumericCell(item.totals.totalEtsyFees, curr),
      formatCsvNumericCell(totalSellerCosts, curr),
      formatCsvNumericCell(item.totals.totalProfit, curr),
      (item.totals.margin * 100).toFixed(2),
      formatCsvNumericCell(item.totals.breakEvenPrice, curr),
      item.targetProfit !== null ? formatCsvNumericCell(item.targetProfit, curr) : "",
      item.requiredPriceForTarget !== null ? formatCsvNumericCell(item.requiredPriceForTarget, curr) : "",
      formatCsvNumericCell(item.scenarios.noOffsiteAds.totals.totalProfit, curr),
      formatCsvNumericCell(item.scenarios.offsiteAds12.totals.totalProfit, curr),
      formatCsvNumericCell(item.scenarios.offsiteAds15.totals.totalProfit, curr),
      sanitizeCsvTextCell(item.becomesUnprofitableAt15Pct ? "YES" : "NO"),
      sanitizeCsvTextCell(item.profitStatusLabel)
    ];

    return cells.join(",");
  });

  return [headerLine, ...lines].join("\r\n") + "\r\n";
}

/**
 * Formats a major currency amount using the existing fee-engine formatMoney helper.
 */
export function formatBulkCurrency(majorAmount, itemOrRule) {
  const centsEquivalent = Math.round((Number(majorAmount) || 0) * 100);
  return formatMoney(centsEquivalent, itemOrRule, { currency: itemOrRule?.currency || "USD" });
}

export { STATUTORY_OFFSITE_ADS_CAP };
