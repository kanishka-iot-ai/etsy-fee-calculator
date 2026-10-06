/**
 * ShopProfit Structured Table Parser & Validation Engine
 * Extracts, normalizes, and deterministically validates official Etsy fee tables.
 */

import { canonicalizeCountry, VALID_CURRENCIES } from "./canonicalize.js";

/**
 * Strips HTML tags and normalizes whitespace
 */
export function cleanCellText(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

/**
 * Parses payment processing fee table from Article 115015628847
 */
export function parsePaymentProcessingTable(html) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  if (tables.length === 0) {
    throw new Error("Missing table: No <table> found in article body");
  }

  // Find the table containing "Fees for Etsy Payments" or "Location of Bank Account"
  const processingTable = tables.find(t => 
    /Fees for Etsy Payments/i.test(t) || /Location of Bank Account/i.test(t)
  );

  if (!processingTable) {
    throw new Error("Missing required table columns: Payment processing table header not recognized");
  }

  let rows = processingTable.match(/<tr[\s\S]*?<\/tr>/gi);
  if (!rows || rows.length < 2) {
    rows = processingTable.match(/<tr[^>]*>[\s\S]*?(?=<tr|<\/table|$)/gi) || [];
  }
  if (rows.length < 5) {
    throw new Error("Partial extraction: Table has fewer rows than expected");
  }

  const marketMap = new Map();
  const validationErrors = [];

  for (let i = 1; i < rows.length; i++) {
    let cells = (rows[i].match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(cleanCellText);
    if (cells.length < 2) {
      cells = (rows[i].match(/<t[hd][^>]*>[\s\S]*?(?=<\/t[hd]>|<t[hd]|$)/gi) || []).map(cleanCellText).filter(Boolean);
    }
    if (cells.length < 2) continue;

    const rawCountry = cells[0];
    const rawFee = cells[1];

    if (!rawCountry || !rawFee) continue;

    const countryInfo = canonicalizeCountry(rawCountry);
    if (!countryInfo || !countryInfo.isoCode) {
      validationErrors.push({
        rawCountry,
        error: "Unmapped or ambiguous country name"
      });
      continue;
    }

    // Match e.g. "4% + 0.30 EUR" or "6.5% + 0.30 USD" or "4.5% + 11500 VND"
    const feeMatch = rawFee.match(/([-\d.]+)%\s*\+\s*([-\d,.]+)\s*([A-Z]{3})/i);
    if (!feeMatch) {
      validationErrors.push({
        country: countryInfo.isoCode,
        rawFee,
        error: "Malformed fee format"
      });
      continue;
    }

    const ratePct = parseFloat(feeMatch[1]);
    const fixedAmount = parseFloat(feeMatch[2].replace(/,/g, ""));
    const currency = feeMatch[3].toUpperCase();

    // Deterministic Validation Rules
    if (isNaN(ratePct) || ratePct < 0 || ratePct > 100) {
      validationErrors.push({ country: countryInfo.isoCode, ratePct, error: "Invalid percentage out of bounds (0-100)" });
      continue;
    }
    if (isNaN(fixedAmount) || fixedAmount < 0) {
      validationErrors.push({ country: countryInfo.isoCode, fixedAmount, error: "Negative or malformed fixed fee amount" });
      continue;
    }
    if (!VALID_CURRENCIES.has(currency)) {
      validationErrors.push({ country: countryInfo.isoCode, currency, error: "Invalid or unrecognized currency code" });
      continue;
    }

    const rate = ratePct / 100;
    const iso = countryInfo.isoCode;

    let existing = marketMap.get(iso);
    if (!existing) {
      existing = {
        countryCode: iso,
        countryName: countryInfo.cleanName,
        currency,
        processingRate: rate,
        processingFixed: fixedAmount,
        domesticProcessingRate: null,
        domesticProcessingFixed: null,
        internationalProcessingRate: null,
        internationalProcessingFixed: null,
        notes: null
      };
      marketMap.set(iso, existing);
    }

    // Handle domestic vs international order splits
    if (countryInfo.orderScope === "domestic") {
      existing.domesticProcessingRate = rate;
      existing.domesticProcessingFixed = fixedAmount;
      existing.processingRate = rate; // Default to domestic for primary rate
      existing.processingFixed = fixedAmount;
    } else if (countryInfo.orderScope === "international") {
      existing.internationalProcessingRate = rate;
      existing.internationalProcessingFixed = fixedAmount;
      if (!existing.domesticProcessingRate) {
        existing.processingRate = rate;
        existing.processingFixed = fixedAmount;
      }
    } else {
      existing.processingRate = rate;
      existing.processingFixed = fixedAmount;
    }
  }

  return {
    markets: Array.from(marketMap.values()),
    validationErrors,
    totalParsedRows: rows.length - 1
  };
}

/**
 * Parses deposit fees table from Article 115015628847
 */
export function parseDepositFeesTable(html) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  const depositTable = tables.find(t => 
    /Deposit Minimum/i.test(t) && /Fee threshold/i.test(t) && /Deposit fee/i.test(t)
  );

  if (!depositTable) return [];

  const rows = depositTable.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const depositRules = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = (rows[i].match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(cleanCellText);
    if (cells.length < 4) continue;

    const countryInfo = canonicalizeCountry(cells[0]);
    if (!countryInfo || !countryInfo.isoCode) continue;

    const parseMoney = (str) => {
      const match = str.match(/([\d,.]+)\s*([A-Z]{3})/i);
      if (!match) return { amount: null, currency: null };
      return {
        amount: parseFloat(match[1].replace(/,/g, "")),
        currency: match[2].toUpperCase()
      };
    };

    const min = parseMoney(cells[1]);
    const threshold = parseMoney(cells[2]);
    const fee = parseMoney(cells[3]);

    depositRules.push({
      countryCode: countryInfo.isoCode,
      depositMinimumAmount: min.amount,
      depositMinimumCurrency: min.currency,
      depositThresholdAmount: threshold.amount,
      depositThresholdCurrency: threshold.currency,
      depositFeeAmount: fee.amount,
      depositFeeCurrency: fee.currency
    });
  }

  return depositRules;
}

/**
 * Parses regulatory operating fee table from Article 1500011073202
 */
export function parseRegulatoryFeesTable(html) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  if (tables.length === 0) return [];

  const regTable = tables.find(t => /0\.\d+%/i.test(t) || /1\.\d+%/i.test(t)) || tables[0];
  const rows = regTable.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const regulatoryRules = [];

  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i].match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(cleanCellText);
    if (cells.length < 2) continue;

    const countryInfo = canonicalizeCountry(cells[0]);
    if (!countryInfo || !countryInfo.isoCode) continue;

    const pctMatch = cells[1].match(/([\d.]+)%/);
    if (!pctMatch) continue;

    const rate = parseFloat(pctMatch[1]) / 100;
    if (isNaN(rate) || rate < 0 || rate > 0.10) continue; // Boundary: 0% to 10%

    regulatoryRules.push({
      countryCode: countryInfo.isoCode,
      countryName: countryInfo.cleanName,
      regulatoryRate: rate
    });
  }

  return regulatoryRules;
}
