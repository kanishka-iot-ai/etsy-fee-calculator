/**
 * ShopProfit Global Etsy Fee Compatibility Layer
 * Normalizes rich D1 / official Etsy fee intelligence records into a deterministic,
 * versioned calculation model for the ShopProfit calculator ecosystem.
 *
 * SAFETY INVARIANT: Pure functional module. Zero database writes, zero network calls,
 * zero secrets. Does NOT alter core calculator math or frontend code.
 */

export const OFFICIAL_TRANSACTION_RATE = 0.065;
export const DEFAULT_OFFSITE_THRESHOLD = 10000;
export const DEFAULT_OFFSITE_CAP = 100;
export const DEFAULT_CURRENCY_CONVERSION_RATE = 0.025;

export const FEE_BASES = {
  transaction: "order_total_excluding_exempt_tax",
  processing: "processing_order_total",
  regulatory: "order_total_excluding_etsy_collected_tax",
  offsiteAds: "attributed_order_total",
  currencyConversion: "converted_payout_amount"
};

export const FLAGS = {
  US: "🇺🇸", UK: "🇬🇧", CA: "🇨🇦", AU: "🇦🇺", DE: "🇩🇪",
  FR: "🇫🇷", IT: "🇮🇹", ES: "🇪🇸", IN: "🇮🇳", JP: "🇯🇵",
  TR: "🇹🇷", NL: "🇳🇱", NZ: "🇳🇿", SG: "🇸🇬", MX: "🇲🇽",
  HU: "🇭🇺", VN: "🇻🇳", ID: "🇮🇩", ZA: "🇿🇦", OTHER: "🌐"
};

export const CURRENCY_SYMBOLS = {
  USD: "$", GBP: "£", CAD: "CA$", AUD: "A$", EUR: "€",
  INR: "₹", JPY: "¥", TRY: "₺", NZD: "NZ$", SGD: "S$",
  MXN: "MX$", HUF: "Ft", VND: "₫", IDR: "Rp", ZAR: "R"
};

export const KNOWN_LOCALES = {
  US: "en-US", UK: "en-GB", CA: "en-CA", AU: "en-AU", DE: "de-DE",
  FR: "fr-FR", IT: "it-IT", ES: "es-ES", IN: "en-IN", JP: "ja-JP",
  TR: "tr-TR", NL: "nl-NL", NZ: "en-NZ", SG: "en-SG", MX: "es-MX",
  HU: "hu-HU", VN: "vi-VN", ID: "id-ID", ZA: "en-ZA", OTHER: "en-US"
};

/**
 * Statutory 9-country Regulatory Operating Fee schedule from official Etsy Help Center
 * article 1500011073202. All other jurisdictions are officially unlisted (rate = null).
 */
export const STATUTORY_REGULATORY_RATES = Object.freeze({
  CA: 0.0050,
  FR: 0.0114,
  HU: 0.0197,
  IT: 0.0080,
  IN: 0.0005,
  ES: 0.0088,
  TR: 0.0167,
  UK: 0.0048,
  VN: 0.0124
});

/**
 * Statutory 9-country Deposit Fee schedule from official Etsy Help Center
 * article 115015628847 Table 2. All other jurisdictions are officially unlisted.
 */
export const STATUTORY_DEPOSIT_SCHEDULES = Object.freeze({
  ID: Object.freeze({ min: 28000, threshold: 1400000, fee: 28000, currency: "IDR" }),
  IL: Object.freeze({ min: 7, threshold: 350, fee: 7, currency: "ILS" }),
  MY: Object.freeze({ min: 9, threshold: 400, fee: 8, currency: "MYR" }),
  MX: Object.freeze({ min: 40, threshold: 2000, fee: 40, currency: "MXN" }),
  MA: Object.freeze({ min: 20, threshold: 1000, fee: 20, currency: "MAD" }),
  PH: Object.freeze({ min: 100, threshold: 5000, fee: 100, currency: "PHP" }),
  ZA: Object.freeze({ min: 35, threshold: 1500, fee: 30, currency: "ZAR" }),
  TR: Object.freeze({ min: 50, threshold: 600, fee: 42, currency: "TRY" }),
  VN: Object.freeze({ min: 45000, threshold: 2300000, fee: 45000, currency: "VND" })
});

/**
 * Official 16 Payoneer-partnered countries marked with an asterisk (*) on Etsy's
 * authoritative eligibility article 115015710408 and Payoneer guide 16999319005207.
 */
export const OFFICIAL_PAYONEER_COUNTRIES = Object.freeze(new Set([
  "AR", "BR", "CL", "CN", "EG", "GE", "IN", "JP", "KZ", "PK", "PE", "RS", "KR", "TH", "UA", "AE"
]));

/**
 * Official Eurozone (Euro Area) member states as of 2026.
 * Note: Croatia (HR) adopted the euro on Jan 1, 2023, and Bulgaria (BG) on Jan 1, 2026.
 */
export const EURO_AREA_COUNTRIES = Object.freeze(new Set([
  "AT", "BE", "BG", "CY", "DE", "EE", "ES", "FI", "FR", "GR",
  "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"
]));

/**
 * Six European candidate markets explicitly enumerated in official Etsy Help Center
 * article 115015710408 where Etsy Payments operates by depositing EUR into seller bank accounts:
 * BG, HR, CZ, HU, RO, PL.
 *
 * Current Etsy documentation explicitly states:
 * "Etsy sends EUR to the bank account on file, and the bank may charge foreign-exchange fees to deposit those funds into the account."
 *
 * IMPORTANT SEMANTIC RULE:
 * bankFxPossibility = true MUST mean:
 * "Etsy states that the seller's bank may charge foreign-exchange fees."
 * It must NOT mean:
 * "A foreign-exchange fee is always charged."
 *
 * Euro Area Membership (Monetary Status):
 * - BG: Eurozone member state (adopted EUR Jan 1, 2026; euroArea = true, bankFxPossibility = true)
 * - HR: Eurozone member state (adopted EUR Jan 1, 2023; euroArea = true, bankFxPossibility = true)
 * - CZ: Non-Eurozone EU member (CZK; euroArea = false, bankFxPossibility = true)
 * - HU: Non-Eurozone EU member (HUF; euroArea = false, bankFxPossibility = true)
 * - RO: Non-Eurozone EU member (RON; euroArea = false, bankFxPossibility = true)
 * - PL: Non-Eurozone EU member (PLN; euroArea = false, bankFxPossibility = true)
 */
export const EUR_PAYOUT_COUNTRIES = Object.freeze(new Set([
  "BG", "HR", "CZ", "HU", "RO", "PL"
]));

/**
 * Statutory new-shop restrictions defined on official Etsy Help Center pages.
 */
export const NEW_SHOP_RESTRICTIONS = Object.freeze({
  CN: "suspended_for_new_shops",
  IN: "international_only"
});

/**
 * Authoritative Global Release Candidate Classification
 * 30 Fully Verified + 14 Payoneer Partial + 6 Etsy EUR-Payout Partial = 50 Candidates
 */

/**
 * Fully verified candidate markets/locations (exactly 30 countries):
 * Native Direct Etsy Payments, local bank currency deposits, and zero new-shop restrictions.
 * Vietnam (VN) is fully verified (local VND, non-Payoneer, statutory fees verified).
 */
export const FULLY_VERIFIED_CANDIDATES = Object.freeze([
  "AT", "BE", "CH", "CY", "DK", "EE", "FI", "GR", "HK", "ID",
  "IE", "IL", "LT", "LU", "LV", "MA", "MT", "MX", "MY", "NL",
  "NO", "NZ", "PH", "PT", "SE", "SG", "SI", "SK", "VN", "ZA"
]);

/**
 * Payoneer partial candidate markets/locations (exactly 14 countries):
 * Official Payoneer partner asterisk countries requiring Payoneer USD deposits & bank withdrawal.
 * Note: IN and JP are baseline v1.0.0 markets, excluded from candidate set.
 */
export const PAYONEER_CANDIDATES = Object.freeze([
  "AE", "AR", "BR", "CL", "CN", "EG", "GE", "KR", "KZ", "PK",
  "PE", "RS", "TH", "UA"
]);

/**
 * Six Etsy EUR-payout candidate markets/locations (exactly 6 countries):
 * Etsy sends EUR to the bank account; the bank may charge FX fees.
 * (BG, HR, CZ, HU, RO, PL).
 * BG and HR have euroArea = true; CZ, HU, RO, PL have euroArea = false.
 * For all six markets, bankFxPossibility = true per official Etsy documentation.
 */
export const EUR_PAYOUT_CANDIDATES = Object.freeze([
  "BG", "HR", "CZ", "HU", "RO", "PL"
]);

// Retain alias for backward compatibility
export const EUR_BANK_FX_CANDIDATES = EUR_PAYOUT_CANDIDATES;

/**
 * Complete set of all 50 quarantined candidate markets in D1 (disjoint union of 30 + 14 + 6).
 */
export const ALL_CANDIDATE_CODES = Object.freeze([
  ...FULLY_VERIFIED_CANDIDATES,
  ...PAYONEER_CANDIDATES,
  ...EUR_PAYOUT_CANDIDATES
].sort());

/**
 * Global calculation capability matrix comparing current calculator capabilities
 * with the richer global Etsy fee dimensions discovered in D1.
 */
export const CALCULATION_CAPABILITY_MATRIX = [
  {
    feature: "Basic transaction fee (6.5%)",
    supportedNow: true,
    currentMechanism: "TRANSACTION_RATE = 0.065 applied to item + shipping",
    futureRequirement: "Configurable fee rule per version release"
  },
  {
    feature: "Listing fee ($0.20 or local)",
    supportedNow: true,
    currentMechanism: "country.listingFee in local currency",
    futureRequirement: "Live currency conversion if listing currency != local currency"
  },
  {
    feature: "Standard payment processing",
    supportedNow: true,
    currentMechanism: "country.processingRate * gross + country.processingFixed",
    futureRequirement: "Supports single flat processing fee schedules"
  },
  {
    feature: "Domestic processing",
    supportedNow: true,
    currentMechanism: "Default baseline in src/countries.js",
    futureRequirement: "Explicit orderType: 'domestic' selection"
  },
  {
    feature: "International processing",
    supportedNow: false,
    currentMechanism: "Not supported in src/calculator.js (no orderType input)",
    futureRequirement: "Requires UI toggle for domestic vs international buyer destination"
  },
  {
    feature: "Regulatory operating fee",
    supportedNow: true,
    currentMechanism: "country.regulatoryRate * gross",
    futureRequirement: "Base must exclude Etsy-collected marketplace taxes"
  },
  {
    feature: "Offsite Ads percentage (12% / 15%)",
    supportedNow: true,
    currentMechanism: "User chooses offsiteRate (0, 0.12, 0.15)",
    futureRequirement: "Automated tier selection based on rolling $10k USD trailing sales"
  },
  {
    feature: "Offsite Ads cap ($100 USD)",
    supportedNow: true,
    currentMechanism: "Math.min(rateFee, cents(country.offsiteCap ?? 100))",
    futureRequirement: "Dynamic currency conversion from $100 USD to seller currency"
  },
  {
    feature: "Currency conversion fee (2.5%)",
    supportedNow: false,
    currentMechanism: "Not modeled in src/calculator.js",
    futureRequirement: "Requires listing vs payout currency selector & 2.5% fee line"
  },
  {
    feature: "Different fee currencies",
    supportedNow: false,
    currentMechanism: "Assumes all fixed fees are denominated in seller display currency",
    futureRequirement: "Multi-currency foreign exchange conversion pipeline"
  },
  {
    feature: "Deposit fee (Account-level)",
    supportedNow: false,
    currentMechanism: "Not modeled; deposit fees are account/event level, not per-order",
    futureRequirement: "Monthly account cashflow & deposit fee warning panel"
  },
  {
    feature: "Etsy Plus account cost",
    supportedNow: true,
    currentMechanism: "Prorated per sale: plusMonthly / salesPerMonth",
    futureRequirement: "Preserve as allocated cost; separate from direct order fees"
  },
  {
    feature: "Account-level setup fee",
    supportedNow: false,
    currentMechanism: "Not modeled in per-order calculator",
    futureRequirement: "One-time onboarding / startup cost analyzer"
  },
  {
    feature: "Tax exclusions (VAT/GST/Sales Tax)",
    supportedNow: false,
    currentMechanism: "Gross assumes tax-exclusive or tax-inclusive without VAT separation",
    futureRequirement: "Configurable tax mode: seller tax-inclusive vs Etsy-collected"
  },
  {
    feature: "Buyer / Seller geography",
    supportedNow: false,
    currentMechanism: "Only seller country is modeled",
    futureRequirement: "Buyer country selector for tax & international processing rates"
  }
];

/**
 * Normalizes raw fee schedule from D1/API into an immutable, calculator-compatible contract.
 *
 * @param {Object} raw - Raw record from D1 fee_rules or API response
 * @param {Object} [options] - Calculation context options
 * @param {string} [options.orderType='domestic'] - 'domestic' | 'international'
 * @param {string} [options.listingCurrency] - Currency used for the product listing
 * @param {string} [options.paymentCurrency] - Currency of seller's bank account
 * @param {boolean} [options.sellerTaxIncluded=false] - Whether listing price includes seller VAT/tax
 * @param {boolean} [options.buyerTaxCollectedByEtsy=false] - Whether Etsy collects tax directly
 * @returns {Object} Normalized global fee schedule contract
 */
export function normalizeFeeSchedule(raw, options = {}) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid fee schedule: raw data must be a non-null object");
  }

  // 1. Resolve Country Code and Metadata
  const countryCode = String(raw.country_code || raw.countryCode || "").toUpperCase();
  if (!countryCode || (!/^[A-Z]{2}$/.test(countryCode) && countryCode !== "OTHER")) {
    throw new Error(`Invalid country code '${countryCode}': must be ISO 3166-1 alpha-2 or 'OTHER'`);
  }

  const currency = String(raw.currency_code || raw.currency || "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`Invalid currency '${currency}': must be ISO 4217 3-letter code`);
  }

  const name = raw.country_name || raw.countryName || countryCode;
  const flag = raw.flag || FLAGS[countryCode] || "🌐";
  const symbol = raw.currency_symbol || raw.symbol || CURRENCY_SYMBOLS[currency] || currency;
  const locale = raw.locale || KNOWN_LOCALES[countryCode] || "en-US";
  const status = raw.status || "active";

  // 2. Resolve Calculation Context
  const orderType = options.orderType === "international" ? "international" : "domestic";
  const listingCurrency = String(options.listingCurrency || currency).toUpperCase();
  const paymentCurrency = String(options.paymentCurrency || currency).toUpperCase();
  const isCurrencyConversionRequired = listingCurrency !== paymentCurrency;

  // 3. Validate and Parse Numeric Rates
  const transactionRate = raw.transaction_rate !== undefined ? Number(raw.transaction_rate) : OFFICIAL_TRANSACTION_RATE;
  if (!Number.isFinite(transactionRate) || transactionRate < 0 || transactionRate > 1.0) {
    throw new Error(`Invalid transaction rate: ${transactionRate}`);
  }

  const baseProcessingRate = raw.processing_rate !== undefined ? Number(raw.processing_rate) : 0.03;
  const baseProcessingFixed = raw.processing_fixed_amount !== undefined 
    ? Number(raw.processing_fixed_amount) 
    : (raw.processingFixed !== undefined ? Number(raw.processingFixed) : 0.25);

  if (!Number.isFinite(baseProcessingRate) || baseProcessingRate < 0 || baseProcessingRate > 1.0) {
    throw new Error(`Invalid processing rate: ${baseProcessingRate}`);
  }
  if (!Number.isFinite(baseProcessingFixed) || baseProcessingFixed < 0) {
    throw new Error(`Invalid processing fixed fee: ${baseProcessingFixed}`);
  }

  const domesticRate = raw.domestic_processing_rate !== undefined && raw.domestic_processing_rate !== null
    ? Number(raw.domestic_processing_rate)
    : (raw.domesticProcessingRate !== undefined && raw.domesticProcessingRate !== null ? Number(raw.domesticProcessingRate) : null);

  const domesticFixed = raw.domestic_processing_fixed_amount !== undefined && raw.domestic_processing_fixed_amount !== null
    ? Number(raw.domestic_processing_fixed_amount)
    : (raw.domesticProcessingFixed !== undefined && raw.domesticProcessingFixed !== null ? Number(raw.domesticProcessingFixed) : null);

  const internationalRate = raw.international_processing_rate !== undefined && raw.international_processing_rate !== null
    ? Number(raw.international_processing_rate)
    : (raw.internationalProcessingRate !== undefined && raw.internationalProcessingRate !== null ? Number(raw.internationalProcessingRate) : null);

  const internationalFixed = raw.international_processing_fixed_amount !== undefined && raw.international_processing_fixed_amount !== null
    ? Number(raw.international_processing_fixed_amount)
    : (raw.internationalProcessingFixed !== undefined && raw.internationalProcessingFixed !== null ? Number(raw.internationalProcessingFixed) : null);

  const hasSplitRates = internationalRate !== null || domesticRate !== null;

  // Select effective rate and fixed amount based on order context
  let effectiveProcessingRate = baseProcessingRate;
  let effectiveProcessingFixed = baseProcessingFixed;

  if (hasSplitRates) {
    if (orderType === "international") {
      effectiveProcessingRate = internationalRate !== null ? internationalRate : baseProcessingRate;
      effectiveProcessingFixed = internationalFixed !== null ? internationalFixed : baseProcessingFixed;
    } else {
      effectiveProcessingRate = domesticRate !== null ? domesticRate : baseProcessingRate;
      effectiveProcessingFixed = domesticFixed !== null ? domesticFixed : baseProcessingFixed;
    }
  }

  // 3. Resolve Statutory Regulatory Fee (Article 1500011073202)
  const isRegulatoryListed = STATUTORY_REGULATORY_RATES[countryCode] !== undefined;
  let parsedRegRate = raw.regulatory_rate !== undefined && raw.regulatory_rate !== null
    ? Number(raw.regulatory_rate)
    : (raw.regulatoryRate !== undefined && raw.regulatoryRate !== null ? Number(raw.regulatoryRate) : null);

  if (parsedRegRate !== null) {
    if (!Number.isFinite(parsedRegRate) || parsedRegRate < 0 || parsedRegRate > 1.0) {
      throw new Error(`Invalid regulatory rate: ${parsedRegRate}`);
    }
  }

  const effectiveRegulatoryRate = isRegulatoryListed 
    ? (parsedRegRate !== null ? parsedRegRate : STATUTORY_REGULATORY_RATES[countryCode])
    : 0;
  // Per official Etsy documentation, unlisted regulatory rates are NULL, not a published 0%
  const regulatoryRate = isRegulatoryListed ? effectiveRegulatoryRate : null;

  // 4. Resolve Payment, Payout and Eligibility Context (Articles 115015710408, 16999319005207, 6742925359255)
  const isEuroArea = EURO_AREA_COUNTRIES.has(countryCode);
  const isPayoneer = OFFICIAL_PAYONEER_COUNTRIES.has(countryCode);
  const isEurPayout = EUR_PAYOUT_COUNTRIES.has(countryCode);
  const paymentProviderContext = isPayoneer ? "payoneer" : "direct_etsy_payments";
  const payoutMethodContext = isPayoneer ? "payoneer_account" : "direct_bank_deposit";

  // Independent payout currency determination
  let payoutCurrency;
  if (isPayoneer) {
    payoutCurrency = "USD";
  } else if (isEurPayout || isEuroArea) {
    payoutCurrency = "EUR";
  } else {
    payoutCurrency = currency;
  }

  // Currency transmitted by Etsy Payments
  const etsyPayoutCurrency = isPayoneer ? "USD" : (isEurPayout || isEuroArea ? "EUR" : currency);

  // Bank FX possibility:
  // Current Etsy documentation (Help Center Article 115015710408) explicitly states
  // that for BG, HR, CZ, HU, RO, PL, Etsy sends EUR to the bank account on file,
  // and the bank may charge foreign-exchange fees to deposit those funds into the account.
  // SEMANTIC RULE:
  // bankFxPossibility = true MUST mean:
  // "Etsy states that the seller's bank may charge foreign-exchange fees."
  // It must NOT mean:
  // "A foreign-exchange fee is always charged."
  const bankFxPossibility = isEurPayout;

  // payoutCurrencyContext describes Etsy payout behavior, not geographic euro-area membership
  const payoutCurrencyContext = isPayoneer 
    ? "usd_to_payoneer" 
    : (isEurPayout ? "etsy_sends_eur" : "local_currency");

  const newShopRestriction = NEW_SHOP_RESTRICTIONS[countryCode] || "none";
  const paypalAvailable = countryCode !== "TR" && countryCode !== "IL";

  const contextNotes = [];
  if (isPayoneer) contextNotes.push("Etsy Payments disbursed via Payoneer in USD");
  if (isEurPayout) {
    contextNotes.push("Etsy sends EUR to the bank account; the bank may charge FX fees");
  }
  if (countryCode === "IL") contextNotes.push("PayPal unavailable for Israeli sellers on Etsy Payments");
  if (countryCode === "TR") contextNotes.push("PayPal unavailable in Türkiye");
  if (countryCode === "JP") contextNotes.push("Fixed fee charged in USD ($0.30) / estimated at 45 JPY; Payoneer integration");
  if (countryCode === "IN") contextNotes.push("Requires GSTIN and Payoneer; $10 setup fee; international sales only");
  if (countryCode === "CN") contextNotes.push("New shop opening suspended; existing shops only");

  // 5. Listing Fee & Etsy Plus
  const listingFeeAmount = raw.listing_fee_amount !== undefined 
    ? Number(raw.listing_fee_amount) 
    : (raw.listingFee !== undefined ? Number(raw.listingFee) : 0.20);
  const listingFeeCurrency = raw.listing_fee_currency || currency;

  const plusMonthlyAmount = raw.plus_monthly_amount !== undefined 
    ? Number(raw.plus_monthly_amount) 
    : (raw.plusMonthly !== undefined ? Number(raw.plusMonthly) : 10);
  const plusCurrency = raw.plus_currency || currency;

  // 6. Offsite Ads
  const offsiteRateBelow = raw.offsite_rate_below_threshold !== undefined ? Number(raw.offsite_rate_below_threshold) : 0.15;
  const offsiteRateAbove = raw.offsite_rate_above_threshold !== undefined ? Number(raw.offsite_rate_above_threshold) : 0.12;
  const offsiteCapAmount = raw.offsite_cap_amount !== undefined 
    ? Number(raw.offsite_cap_amount) 
    : (raw.offsiteCap !== undefined ? Number(raw.offsiteCap) : DEFAULT_OFFSITE_CAP);
  const offsiteCapCurrency = raw.offsite_cap_currency || (countryCode === "US" ? "USD" : currency);

  // 7. Statutory Deposit Fee Resolution (Article 115015628847 Table 2)
  const isDepositListed = STATUTORY_DEPOSIT_SCHEDULES[countryCode] !== undefined;
  const statutoryDeposit = isDepositListed ? STATUTORY_DEPOSIT_SCHEDULES[countryCode] : null;

  const depositMinimumAmount = raw.deposit_minimum_amount !== undefined && raw.deposit_minimum_amount !== null
    ? Number(raw.deposit_minimum_amount)
    : (raw.depositMinimumAmount !== undefined && raw.depositMinimumAmount !== null 
        ? Number(raw.depositMinimumAmount) 
        : (statutoryDeposit ? statutoryDeposit.min : null));

  const depositThresholdAmount = raw.deposit_threshold_amount !== undefined && raw.deposit_threshold_amount !== null
    ? Number(raw.deposit_threshold_amount)
    : (raw.depositThresholdAmount !== undefined && raw.depositThresholdAmount !== null 
        ? Number(raw.depositThresholdAmount) 
        : (statutoryDeposit ? statutoryDeposit.threshold : null));

  const depositFeeAmount = raw.deposit_fee_amount !== undefined && raw.deposit_fee_amount !== null
    ? Number(raw.deposit_fee_amount)
    : (raw.depositFeeAmount !== undefined && raw.depositFeeAmount !== null 
        ? Number(raw.depositFeeAmount) 
        : (statutoryDeposit ? statutoryDeposit.fee : null));

  const hasDepositFee = depositFeeAmount !== null && depositFeeAmount > 0;

  // 8. Setup / Onboarding Fee Resolution (Article 6742925359255 & 115014483627)
  const isIndia = countryCode === "IN";
  const setupFeeAmount = raw.setup_fee_amount !== undefined && raw.setup_fee_amount !== null
    ? Number(raw.setup_fee_amount)
    : (raw.setupFeeAmount !== undefined && raw.setupFeeAmount !== null 
        ? Number(raw.setupFeeAmount) 
        : (isIndia ? 10 : null));
  const setupFeeCurrency = raw.setup_fee_currency || (setupFeeAmount !== null ? "USD" : null);
  const setupFeeStatus = setupFeeAmount !== null ? "applicable" : (raw.setup_status || "unknown");

  // 9. Track Unsupported Dimensions for Current Calculator UI
  const unsupportedDimensions = [];
  if (hasSplitRates && orderType === "international") {
    unsupportedDimensions.push("international_processing_split");
  }
  if (isCurrencyConversionRequired) {
    unsupportedDimensions.push("currency_conversion");
  }
  if (hasDepositFee) {
    unsupportedDimensions.push("deposit_fee_account_level");
  }
  if (Boolean(options.sellerTaxIncluded)) {
    unsupportedDimensions.push("seller_tax_included");
  }
  if (setupFeeAmount !== null && setupFeeAmount > 0) {
    unsupportedDimensions.push("setup_fee_account_level");
  }
  if (isPayoneer) {
    unsupportedDimensions.push("payoneer_bank_withdrawal_conversion");
  }
  if (newShopRestriction !== "none") {
    unsupportedDimensions.push(`shop_restriction_${newShopRestriction}`);
  }

  // 10. Data Verification Hierarchy (Core-fee-ready vs Market-fully-verified)
  const coreFeeScheduleVerified = true;
  const marketFullyVerified = (
    paymentProviderContext === "direct_etsy_payments" &&
    payoutCurrencyContext === "local_currency" &&
    newShopRestriction === "none"
  );
  let partialReason = null;
  if (!marketFullyVerified) {
    if (isPayoneer) partialReason = "payoneer_usd_context";
    else if (isEurPayout) partialReason = isEuroArea ? "etsy_eur_payout_context" : "eur_bank_fx_context";
    else if (newShopRestriction !== "none") partialReason = `shop_restriction_${newShopRestriction}`;
  }
  const dataStatus = marketFullyVerified ? "core_and_market_verified" : "partial_context_required";

  // 11. Build Normalized Global Contract
  return Object.freeze({
    country: Object.freeze({
      code: countryCode,
      name,
      currency,
      symbol,
      locale,
      flag,
      status
    }),

    eligibility: Object.freeze({
      isEligible: true,
      euroArea: isEuroArea,
      payoutCurrency,
      etsyPayoutCurrency,
      bankFxPossibility,
      paymentProviderContext,
      payoutCurrencyContext,
      payoutMethodContext,
      newShopRestriction,
      paypalAvailable,
      partialReason,
      notes: Object.freeze(contextNotes)
    }),

    orderContext: Object.freeze({
      orderType,
      listingCurrency,
      paymentCurrency,
      isCurrencyConversionRequired
    }),

    bases: Object.freeze({ ...FEE_BASES }),

    fees: Object.freeze({
      listing: Object.freeze({
        amount: listingFeeAmount,
        currency: listingFeeCurrency,
        event: "per_listing_or_quantity_sold",
        renewalMonths: 4
      }),

      transaction: Object.freeze({
        rate: transactionRate,
        base: FEE_BASES.transaction
      }),

      processing: Object.freeze({
        rate: effectiveProcessingRate,
        fixedAmount: effectiveProcessingFixed,
        currency,
        orderTypeApplied: orderType,
        hasSplitRates,
        domesticRate,
        domesticFixed,
        internationalRate,
        internationalFixed,
        base: FEE_BASES.processing
      }),

      regulatory: Object.freeze({
        rate: regulatoryRate,
        effectiveRate: effectiveRegulatoryRate,
        applicable: isRegulatoryListed && effectiveRegulatoryRate > 0,
        status: isRegulatoryListed ? "applicable" : "not_listed",
        isListed: isRegulatoryListed,
        isListedByEtsy: isRegulatoryListed,
        base: FEE_BASES.regulatory
      }),

      regulatoryOperatingFee: Object.freeze({
        rate: regulatoryRate,
        effectiveRate: effectiveRegulatoryRate,
        applicable: isRegulatoryListed && effectiveRegulatoryRate > 0,
        status: isRegulatoryListed ? "applicable" : "not_listed",
        isListed: isRegulatoryListed,
        isListedByEtsy: isRegulatoryListed,
        base: FEE_BASES.regulatory
      }),

      offsiteAds: Object.freeze({
        rateBelowThreshold: offsiteRateBelow,
        rateAboveThreshold: offsiteRateAbove,
        thresholdAmount: raw.offsite_threshold_amount ?? DEFAULT_OFFSITE_THRESHOLD,
        thresholdCurrency: raw.offsite_threshold_currency ?? "USD",
        capAmount: offsiteCapAmount,
        capCurrency: offsiteCapCurrency,
        base: FEE_BASES.offsiteAds
      }),

      currencyConversion: Object.freeze({
        rate: isCurrencyConversionRequired ? (raw.currency_conversion_rate ?? DEFAULT_CURRENCY_CONVERSION_RATE) : 0,
        applicable: isCurrencyConversionRequired,
        base: FEE_BASES.currencyConversion
      }),

      etsyPlus: Object.freeze({
        monthlyAmount: plusMonthlyAmount,
        currency: plusCurrency,
        isAccountLevel: true,
        prorationMode: "monthly_sales_allocated"
      })
    }),

    accountLevelFees: Object.freeze({
      deposit: Object.freeze({
        depositFeeMode: hasDepositFee ? "account_level" : "not_listed",
        applicable: hasDepositFee,
        status: hasDepositFee ? "applicable" : "not_applicable",
        isListed: isDepositListed,
        isListedByEtsy: isDepositListed,
        depositMinimum: depositMinimumAmount,
        feeThreshold: depositThresholdAmount,
        feeAmount: depositFeeAmount,
        currency: hasDepositFee ? (raw.deposit_fee_currency || statutoryDeposit?.currency || currency) : null,
        isInformational: true
      }),

      setup: Object.freeze({
        applicable: setupFeeAmount !== null && setupFeeAmount > 0,
        status: setupFeeStatus,
        label: isIndia ? "one_time_onboarding" : "location_dependent",
        amount: setupFeeAmount,
        currency: setupFeeCurrency,
        isInformational: true
      })
    }),

    tax: Object.freeze({
      sellerTaxIncluded: Boolean(options.sellerTaxIncluded),
      buyerTaxCollectedByEtsy: options.buyerTaxCollectedByEtsy ?? "unknown",
      taxNotes: raw.tax_notes || raw.special_rules || raw.processingNote || ""
    }),

    regulatoryOperatingFee: Object.freeze({
      rate: regulatoryRate,
      effectiveRate: effectiveRegulatoryRate,
      applicable: isRegulatoryListed && effectiveRegulatoryRate > 0,
      status: isRegulatoryListed ? "applicable" : "not_listed",
      isListed: isRegulatoryListed,
      isListedByEtsy: isRegulatoryListed,
      base: FEE_BASES.regulatory
    }),

    provenance: Object.freeze({
      versionId: raw.version_id || raw.version || "v1.0.0",
      sourceIds: Object.freeze(raw.source_id ? [raw.source_id] : ["115015628847", "115015710408"]),
      verifiedAt: raw.verified_at || raw.published_at || new Date().toISOString()
    }),

    capabilities: Object.freeze({
      canDirectlyCalculate: unsupportedDimensions.length === 0,
      unsupportedDimensions: Object.freeze(unsupportedDimensions),
      coreFeeScheduleVerified,
      marketFullyVerified,
      dataStatus
    })
  });
}

/**
 * Bridges a normalized global fee schedule into the exact country object shape
 * expected by the existing ShopProfit calculator (src/calculator.js).
 *
 * @param {Object} normalized - Result from normalizeFeeSchedule()
 * @returns {Object} Country object compatible with calculateSale() and solveMinimumItemPrice()
 */
export function toCalculatorCountry(normalized) {
  if (!normalized || !normalized.country || !normalized.fees) {
    throw new Error("Invalid normalized fee schedule object");
  }

  return {
    name: normalized.country.name,
    flag: normalized.country.flag,
    currency: normalized.country.currency,
    symbol: normalized.country.symbol,
    locale: normalized.country.locale,
    listingFee: normalized.fees.listing.amount,
    processingRate: normalized.fees.processing.rate,
    processingFixed: normalized.fees.processing.fixedAmount,
    regulatoryRate: normalized.fees.regulatory.rate || 0,
    plusMonthly: normalized.fees.etsyPlus.monthlyAmount,
    offsiteCap: normalized.fees.offsiteAds.capAmount,
    processingNote: normalized.tax.taxNotes || undefined
  };
}
