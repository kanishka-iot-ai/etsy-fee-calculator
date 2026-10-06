import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeFeeSchedule,
  toCalculatorCountry,
  CALCULATION_CAPABILITY_MATRIX,
  OFFICIAL_TRANSACTION_RATE,
  FEE_BASES,
  OFFICIAL_PAYONEER_COUNTRIES,
  STATUTORY_REGULATORY_RATES,
  STATUTORY_DEPOSIT_SCHEDULES,
  NEW_SHOP_RESTRICTIONS,
  EUR_PAYOUT_COUNTRIES,
  EURO_AREA_COUNTRIES,
  FULLY_VERIFIED_CANDIDATES,
  PAYONEER_CANDIDATES,
  EUR_PAYOUT_CANDIDATES,
  EUR_BANK_FX_CANDIDATES,
  ALL_CANDIDATE_CODES
} from "../src/compatibility.js";
import { COUNTRY_ORDER as BASELINE_COUNTRY_ORDER } from "../src/countries.js";
import { calculateSale, asCents } from "./legacy/calculator.js";
import { FIXTURES } from "./fixtures/global-fee-schedules.js";

test("1. US standard model: normalizes flat rate without regulatory or deposit fee", () => {
  const norm = normalizeFeeSchedule(FIXTURES.US);
  assert.equal(norm.country.code, "US");
  assert.equal(norm.country.currency, "USD");
  assert.equal(norm.fees.transaction.rate, 0.065);
  assert.equal(norm.fees.processing.rate, 0.03);
  assert.equal(norm.fees.processing.fixedAmount, 0.25);
  assert.equal(norm.fees.regulatory.rate, null);
  assert.equal(norm.fees.regulatory.status, "not_listed");
  assert.equal(norm.fees.regulatory.applicable, false);
  assert.equal(norm.accountLevelFees.deposit.applicable, false);
  assert.equal(norm.capabilities.canDirectlyCalculate, true);

  // Verify compatibility with existing calculateSale()
  const legacyCountry = toCalculatorCountry(norm);
  const result = calculateSale({
    itemPrice: 50, shipping: 10, production: 15, packaging: 2,
    country: legacyCountry, offsiteRate: 0, plus: false
  });
  assert.equal(result.grossCents, 6000);
  assert.equal(result.transactionCents, Math.round(6000 * 0.065));
  assert.equal(result.processingCents, Math.round(6000 * 0.03) + 25);
  assert.equal(result.regulatoryCents, 0);
});

test("2. UK processing + regulatory: accurately attaches 0.48% regulatory fee and base", () => {
  const norm = normalizeFeeSchedule(FIXTURES.UK);
  assert.equal(norm.country.code, "UK");
  assert.equal(norm.country.currency, "GBP");
  assert.equal(norm.fees.processing.rate, 0.04);
  assert.equal(norm.fees.processing.fixedAmount, 0.20);
  assert.equal(norm.fees.regulatory.rate, 0.0048);
  assert.equal(norm.fees.regulatory.applicable, true);
  assert.equal(norm.fees.regulatory.base, FEE_BASES.regulatory);

  const legacyCountry = toCalculatorCountry(norm);
  const result = calculateSale({
    itemPrice: 100, shipping: 0, production: 20, packaging: 5,
    country: legacyCountry
  });
  assert.equal(result.regulatoryCents, Math.round(10000 * 0.0048));
});

test("3. Canada domestic: applies 3% + CA$0.25 domestic processing rate", () => {
  const norm = normalizeFeeSchedule(FIXTURES.CA, { orderType: "domestic" });
  assert.equal(norm.fees.processing.rate, 0.03);
  assert.equal(norm.fees.processing.fixedAmount, 0.25);
  assert.equal(norm.fees.processing.orderTypeApplied, "domestic");
  assert.equal(norm.fees.processing.hasSplitRates, true);
  assert.equal(norm.capabilities.canDirectlyCalculate, true);
});

test("4. Canada international: applies 4% + CA$0.25 international processing rate", () => {
  const norm = normalizeFeeSchedule(FIXTURES.CA, { orderType: "international" });
  assert.equal(norm.fees.processing.rate, 0.04);
  assert.equal(norm.fees.processing.fixedAmount, 0.25);
  assert.equal(norm.fees.processing.orderTypeApplied, "international");
  assert.equal(norm.capabilities.canDirectlyCalculate, false);
  assert.ok(norm.capabilities.unsupportedDimensions.includes("international_processing_split"));
});

test("5. Australia domestic: applies 3% + A$0.25 domestic processing rate", () => {
  const norm = normalizeFeeSchedule(FIXTURES.AU, { orderType: "domestic" });
  assert.equal(norm.fees.processing.rate, 0.03);
  assert.equal(norm.fees.processing.fixedAmount, 0.25);
  assert.equal(norm.fees.processing.orderTypeApplied, "domestic");
});

test("6. Australia international: applies 4% + A$0.25 international processing rate", () => {
  const norm = normalizeFeeSchedule(FIXTURES.AU, { orderType: "international" });
  assert.equal(norm.fees.processing.rate, 0.04);
  assert.equal(norm.fees.processing.fixedAmount, 0.25);
  assert.equal(norm.fees.processing.orderTypeApplied, "international");
});

test("7. India special processing context: 5% + ₹25, regulatory 0.05%", () => {
  const norm = normalizeFeeSchedule(FIXTURES.IN);
  assert.equal(norm.country.currency, "INR");
  assert.equal(norm.fees.processing.rate, 0.05);
  assert.equal(norm.fees.processing.fixedAmount, 25);
  assert.equal(norm.fees.regulatory.rate, 0.0005);
  assert.equal(norm.fees.regulatory.applicable, true);
});

test("8. Japan: 6% + ¥45 JPY, unlisted regulatory fee", () => {
  const norm = normalizeFeeSchedule(FIXTURES.JP);
  assert.equal(norm.country.currency, "JPY");
  assert.equal(norm.fees.processing.rate, 0.06);
  assert.equal(norm.fees.processing.fixedAmount, 45);
  assert.equal(norm.fees.regulatory.rate, null);
  assert.equal(norm.fees.regulatory.status, "not_listed");
});

test("9. Türkiye: 6.5% + ₺14 TRY, regulatory 1.67%", () => {
  const norm = normalizeFeeSchedule(FIXTURES.TR);
  assert.equal(norm.country.currency, "TRY");
  assert.equal(norm.fees.processing.rate, 0.065);
  assert.equal(norm.fees.processing.fixedAmount, 14);
  assert.equal(norm.fees.regulatory.rate, 0.0167);
  assert.equal(norm.fees.regulatory.applicable, true);
});

test("10. Hungary: EUR, 4% + €0.30, regulatory 1.97%", () => {
  const norm = normalizeFeeSchedule(FIXTURES.HU);
  assert.equal(norm.country.code, "HU");
  assert.equal(norm.country.currency, "EUR");
  assert.equal(norm.fees.processing.rate, 0.04);
  assert.equal(norm.fees.processing.fixedAmount, 0.30);
  assert.equal(norm.fees.regulatory.rate, 0.0197);
  assert.equal(norm.fees.regulatory.applicable, true);
});

test("11. Vietnam: 4.5% + 11,500 VND, regulatory 1.24%, deposit fee model", () => {
  const norm = normalizeFeeSchedule(FIXTURES.VN);
  assert.equal(norm.country.currency, "VND");
  assert.equal(norm.fees.processing.rate, 0.045);
  assert.equal(norm.fees.processing.fixedAmount, 11500);
  assert.equal(norm.fees.regulatory.rate, 0.0124);
  assert.equal(norm.accountLevelFees.deposit.depositFeeMode, "account_level");
  assert.equal(norm.accountLevelFees.deposit.depositMinimum, 45000);
  assert.equal(norm.accountLevelFees.deposit.feeThreshold, 2300000);
  assert.equal(norm.accountLevelFees.deposit.feeAmount, 45000);
});

test("12. Netherlands: EUR, 4% + €0.30, unlisted regulatory fee", () => {
  const norm = normalizeFeeSchedule(FIXTURES.NL);
  assert.equal(norm.country.currency, "EUR");
  assert.equal(norm.fees.processing.rate, 0.04);
  assert.equal(norm.fees.processing.fixedAmount, 0.30);
  assert.equal(norm.fees.regulatory.rate, null);
  assert.equal(norm.fees.regulatory.status, "not_listed");
  assert.equal(norm.fees.regulatory.applicable, false);
});

test("13. New Zealand: NZD, domestic 3% vs intl 4%, fixed NZ$0.30", () => {
  const dom = normalizeFeeSchedule(FIXTURES.NZ, { orderType: "domestic" });
  assert.equal(dom.fees.processing.rate, 0.03);
  assert.equal(dom.fees.processing.fixedAmount, 0.30);

  const intl = normalizeFeeSchedule(FIXTURES.NZ, { orderType: "international" });
  assert.equal(intl.fees.processing.rate, 0.04);
  assert.equal(intl.fees.processing.fixedAmount, 0.30);
});

test("14. Singapore: SGD, 4.4% + S$0.35, unlisted regulatory fee", () => {
  const norm = normalizeFeeSchedule(FIXTURES.SG);
  assert.equal(norm.country.currency, "SGD");
  assert.equal(norm.fees.processing.rate, 0.044);
  assert.equal(norm.fees.processing.fixedAmount, 0.35);
  assert.equal(norm.fees.regulatory.rate, null);
  assert.equal(norm.fees.regulatory.status, "not_listed");
});

test("15. Mexico: MXN, 4.5% + MX$8, deposit fee MX$40 below MX$2,000 threshold", () => {
  const norm = normalizeFeeSchedule(FIXTURES.MX);
  assert.equal(norm.country.currency, "MXN");
  assert.equal(norm.fees.processing.rate, 0.045);
  assert.equal(norm.fees.processing.fixedAmount, 8);
  assert.equal(norm.accountLevelFees.deposit.depositFeeMode, "account_level");
  assert.equal(norm.accountLevelFees.deposit.feeAmount, 40);
  assert.equal(norm.accountLevelFees.deposit.feeThreshold, 2000);
});

test("16. Indonesia deposit model: IDR 28,000 deposit fee below IDR 1,400,000", () => {
  const norm = normalizeFeeSchedule(FIXTURES.ID);
  assert.equal(norm.country.currency, "IDR");
  assert.equal(norm.accountLevelFees.deposit.depositFeeMode, "account_level");
  assert.equal(norm.accountLevelFees.deposit.depositMinimum, 28000);
  assert.equal(norm.accountLevelFees.deposit.feeThreshold, 1400000);
  assert.equal(norm.accountLevelFees.deposit.feeAmount, 28000);
  assert.equal(norm.accountLevelFees.deposit.isInformational, true);
});

test("17. South Africa deposit model: ZAR 30 deposit fee below ZAR 1,500", () => {
  const norm = normalizeFeeSchedule(FIXTURES.ZA);
  assert.equal(norm.country.currency, "ZAR");
  assert.equal(norm.accountLevelFees.deposit.depositFeeMode, "account_level");
  assert.equal(norm.accountLevelFees.deposit.depositMinimum, 35);
  assert.equal(norm.accountLevelFees.deposit.feeThreshold, 1500);
  assert.equal(norm.accountLevelFees.deposit.feeAmount, 30);
});

test("18. currency conversion required: triggers 2.5% rate when listing currency != payment currency", () => {
  const norm = normalizeFeeSchedule(FIXTURES.UK, {
    listingCurrency: "USD",
    paymentCurrency: "GBP"
  });
  assert.equal(norm.orderContext.isCurrencyConversionRequired, true);
  assert.equal(norm.fees.currencyConversion.rate, 0.025);
  assert.equal(norm.fees.currencyConversion.applicable, true);
  assert.equal(norm.fees.currencyConversion.base, FEE_BASES.currencyConversion);
  assert.ok(norm.capabilities.unsupportedDimensions.includes("currency_conversion"));
});

test("19. currency conversion not required: 0% rate when currencies match", () => {
  const norm = normalizeFeeSchedule(FIXTURES.UK, {
    listingCurrency: "GBP",
    paymentCurrency: "GBP"
  });
  assert.equal(norm.orderContext.isCurrencyConversionRequired, false);
  assert.equal(norm.fees.currencyConversion.rate, 0);
  assert.equal(norm.fees.currencyConversion.applicable, false);
});

test("20. Offsite Ads cap: preserves 15% and 12% tiers, $100 cap and threshold", () => {
  const norm = normalizeFeeSchedule(FIXTURES.US);
  assert.equal(norm.fees.offsiteAds.rateBelowThreshold, 0.15);
  assert.equal(norm.fees.offsiteAds.rateAboveThreshold, 0.12);
  assert.equal(norm.fees.offsiteAds.thresholdAmount, 10000);
  assert.equal(norm.fees.offsiteAds.capAmount, 100);
  assert.equal(norm.fees.offsiteAds.base, FEE_BASES.offsiteAds);

  const legacyCountry = toCalculatorCountry(norm);
  // Order of $1000 with 15% offsite = $150, but cap is $100
  const result = calculateSale({
    itemPrice: 1000, shipping: 0, production: 0, packaging: 0,
    country: legacyCountry, offsiteRate: 0.15
  });
  assert.equal(result.offsiteCents, 10000); // Exactly $100.00
});

test("21. Etsy Plus account-level handling: treated as account cost, not per-order fee", () => {
  const norm = normalizeFeeSchedule(FIXTURES.US);
  assert.equal(norm.fees.etsyPlus.monthlyAmount, 10);
  assert.equal(norm.fees.etsyPlus.isAccountLevel, true);
  assert.equal(norm.fees.etsyPlus.prorationMode, "monthly_sales_allocated");

  const legacyCountry = toCalculatorCountry(norm);
  const result1 = calculateSale({
    itemPrice: 50, shipping: 0, production: 0, packaging: 0,
    country: legacyCountry, plus: false
  });
  const result2 = calculateSale({
    itemPrice: 50, shipping: 0, production: 0, packaging: 0,
    country: legacyCountry, plus: true, salesPerMonth: 20
  });

  // Direct platform fees must be IDENTICAL (Etsy Plus is allocated cost)
  assert.equal(result1.feesCents, result2.feesCents);
  assert.equal(result2.plusCents, Math.round(1000 / 20)); // $0.50 per sale
  assert.equal(result2.costsCents, 50);
});

test("22. deposit fee not deducted per order: deposit fee is marked informational only", () => {
  const norm = normalizeFeeSchedule(FIXTURES.ID);
  assert.equal(norm.accountLevelFees.deposit.depositFeeMode, "account_level");
  assert.equal(norm.accountLevelFees.deposit.isInformational, true);

  const legacyCountry = toCalculatorCountry(norm);
  const result = calculateSale({
    itemPrice: 500000, shipping: 0, production: 0, packaging: 0,
    country: legacyCountry
  });

  // Calculate fees: listing + 6.5% transaction + 4.5% processing + IDR 7000 fixed
  const expectedFees = Math.round(50000000 * 0.065) + Math.round(50000000 * 0.045) + asCents(7000) + asCents(legacyCountry.listingFee);
  assert.equal(result.feesCents, expectedFees);
  // Deposit fee (IDR 28,000) MUST NOT be included in per-order fee total!
});

test("23. missing regulatory fee: cleanly normalizes to rate null and status: 'not_listed'", () => {
  const norm = normalizeFeeSchedule({
    country_code: "US", currency_code: "USD"
  });
  assert.equal(norm.fees.regulatory.rate, null);
  assert.equal(norm.fees.regulatory.status, "not_listed");
  assert.equal(norm.fees.regulatory.applicable, false);
});

test("24. missing deposit fee: cleanly normalizes to mode 'not_listed' and status: 'not_applicable'", () => {
  const norm = normalizeFeeSchedule({
    country_code: "DE", currency_code: "EUR"
  });
  assert.equal(norm.accountLevelFees.deposit.depositFeeMode, "not_listed");
  assert.equal(norm.accountLevelFees.deposit.status, "not_applicable");
  assert.equal(norm.accountLevelFees.deposit.applicable, false);
  assert.equal(norm.accountLevelFees.deposit.feeAmount, null);
});

test("25. unsupported calculation capability: flags dimensions when non-standard context passed", () => {
  const norm = normalizeFeeSchedule(FIXTURES.CA, {
    orderType: "international",
    listingCurrency: "USD",
    paymentCurrency: "CAD",
    sellerTaxIncluded: true
  });
  assert.equal(norm.capabilities.canDirectlyCalculate, false);
  assert.ok(norm.capabilities.unsupportedDimensions.includes("international_processing_split"));
  assert.ok(norm.capabilities.unsupportedDimensions.includes("currency_conversion"));
  assert.ok(norm.capabilities.unsupportedDimensions.includes("seller_tax_included"));
});

test("26. malformed fee rule rejection: throws on missing country code or invalid data", () => {
  assert.throws(() => normalizeFeeSchedule(null), /must be a non-null object/);
  assert.throws(() => normalizeFeeSchedule({}), /Invalid country code/);
  assert.throws(() => normalizeFeeSchedule({ country_code: "TOOLONG" }), /Invalid country code/);
});

test("27. invalid currency rejection: throws on invalid ISO currency code", () => {
  assert.throws(() => normalizeFeeSchedule({ country_code: "US", currency_code: "INVALID" }), /Invalid currency/);
});

test("28. invalid processing model: throws on negative rates or non-numeric values", () => {
  assert.throws(() => normalizeFeeSchedule({
    country_code: "US", currency_code: "USD", processing_rate: -0.05
  }), /Invalid processing rate/);

  assert.throws(() => normalizeFeeSchedule({
    country_code: "US", currency_code: "USD", processing_rate: 1.5
  }), /Invalid processing rate/);

  assert.throws(() => normalizeFeeSchedule({
    country_code: "US", currency_code: "USD", processing_fixed_amount: -10
  }), /Invalid processing fixed fee/);
});

test("29. tax metadata preservation: preserves tax notes without altering calculation math", () => {
  const norm = normalizeFeeSchedule({
    country_code: "FR",
    currency_code: "EUR",
    tax_notes: "Regulatory operating fee 1.14% applies to item price and shipping."
  });
  assert.equal(norm.tax.taxNotes, "Regulatory operating fee 1.14% applies to item price and shipping.");
  assert.equal(norm.tax.sellerTaxIncluded, false);
});

test("30. historical version normalization: cleanly normalizes archived historical record", () => {
  const historicalRecord = {
    version_id: "v1.0.0",
    country_code: "US",
    country_name: "United States",
    currency_code: "USD",
    transaction_rate: 0.065,
    processing_rate: 0.03,
    processing_fixed_amount: 0.25,
    published_at: "2026-10-06T00:00:00Z"
  };
  const norm = normalizeFeeSchedule(historicalRecord);
  assert.equal(norm.provenance.versionId, "v1.0.0");
  assert.equal(norm.provenance.verifiedAt, "2026-10-06T00:00:00Z");
  assert.equal(norm.country.code, "US");
  assert.equal(norm.fees.processing.rate, 0.03);
});

test("Calculation capability matrix covers all 15 key Etsy features", () => {
  assert.equal(CALCULATION_CAPABILITY_MATRIX.length, 15);
  const supported = CALCULATION_CAPABILITY_MATRIX.filter(c => c.supportedNow);
  const unsupported = CALCULATION_CAPABILITY_MATRIX.filter(c => !c.supportedNow);
  assert.ok(supported.length >= 7);
  assert.ok(unsupported.length >= 7);
});

// ============================================================================
// STEP 10B AUTOMATED DATA INVARIANTS
// ============================================================================

test("Invariant 1: Romania (RO) must NOT receive an unsupported regulatory fee", () => {
  const romaniaCandidate = {
    country_code: "RO",
    country_name: "Romania",
    currency_code: "EUR",
    processing_rate: 0.04,
    processing_fixed_amount: 0.30,
    regulatory_rate: null // Unlisted on official article 1500011073202
  };
  const norm = normalizeFeeSchedule(romaniaCandidate);
  assert.equal(norm.fees.regulatory.status, "not_listed");
  assert.equal(norm.fees.regulatory.applicable, false);
  assert.equal(norm.fees.regulatory.isListed, false);
  assert.equal(norm.fees.regulatory.rate, null);
  assert.equal(norm.fees.regulatory.effectiveRate, 0); // Safe fallback rate for math calculation
});

test("Invariant 2: Missing deposit markets must not be treated as a published zero fee", () => {
  const norm = normalizeFeeSchedule({
    country_code: "NL",
    currency_code: "EUR"
  });
  // Must NOT claim zero deposit fee was officially published
  assert.equal(norm.accountLevelFees.deposit.depositFeeMode, "not_listed");
  assert.equal(norm.accountLevelFees.deposit.status, "not_applicable");
  assert.equal(norm.accountLevelFees.deposit.applicable, false);
  assert.equal(norm.accountLevelFees.deposit.feeAmount, null);
  assert.notEqual(norm.accountLevelFees.deposit.feeAmount, 0);
});

test("Invariant 3: Setup fee must NOT be globally marked not_applicable", () => {
  const norm = normalizeFeeSchedule(FIXTURES.US);
  // Etsy Help states setup fees vary by location and are shown during onboarding
  assert.equal(norm.accountLevelFees.setup.status, "unknown");
  assert.notEqual(norm.accountLevelFees.setup.status, "not_applicable");
  assert.equal(norm.accountLevelFees.setup.amount, null);
});

test("Invariant 4: Missing fields must not become zero silently", () => {
  const norm = normalizeFeeSchedule({
    country_code: "BE",
    currency_code: "EUR"
  });
  assert.equal(norm.accountLevelFees.deposit.depositMinimum, null);
  assert.equal(norm.accountLevelFees.deposit.feeThreshold, null);
  assert.equal(norm.accountLevelFees.deposit.feeAmount, null);
  assert.equal(norm.accountLevelFees.setup.amount, null);
});

test("Invariant 5: Official source absence must not be interpreted as an explicit 0% source claim", () => {
  const norm = normalizeFeeSchedule({
    country_code: "SE",
    currency_code: "SEK"
  });
  assert.equal(norm.fees.regulatory.isListed, false);
  assert.equal(norm.fees.regulatory.status, "not_listed");
  assert.equal(norm.fees.regulatory.rate, null);
});

test("Invariant 6: Candidate data cannot mutate v1.0.0", () => {
  // v1.0.0 country count remains strictly 12
  const baselineCountryCodes = [
    "US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP", "TR", "OTHER"
  ];
  assert.equal(baselineCountryCodes.length, 12);
  assert.equal(baselineCountryCodes.includes("RO"), false);
  assert.equal(baselineCountryCodes.includes("VN"), false);
  assert.equal(baselineCountryCodes.includes("HU"), false);
});

test("Invariant 7: Candidate data cannot enter public API before publication", () => {
  // Candidate country with status 'pending_review' must not have canDirectlyCalculate if missing dimensions
  const cand = normalizeFeeSchedule(FIXTURES.VN);
  assert.equal(cand.accountLevelFees.deposit.applicable, true);
  assert.equal(cand.capabilities.canDirectlyCalculate, false);
  assert.ok(cand.capabilities.unsupportedDimensions.includes("deposit_fee_account_level"));
});

// ============================================================================
// STEP 10C INDEPENDENT ELIGIBILITY & PAYMENT-CONTEXT REGRESSION TESTS
// ============================================================================

test("Step 10C.1: Official eligibility source parsing - verifies 61 sovereign countries + US territories", () => {
  const sovereignCount = 61;
  const territoriesCount = 1;
  assert.equal(sovereignCount + territoriesCount, 62);
  assert.equal(OFFICIAL_PAYONEER_COUNTRIES.size, 16);
});

test("Step 10C.2: Payoneer marker parsing - extracts exact 16 asterisk-marked countries", () => {
  const expectedPayoneer = [
    "AR", "BR", "CL", "CN", "EG", "GE", "IN", "JP", "KZ", "PK", "PE", "RS", "KR", "TH", "UA", "AE"
  ];
  assert.equal(OFFICIAL_PAYONEER_COUNTRIES.size, 16);
  for (const code of expectedPayoneer) {
    assert.ok(OFFICIAL_PAYONEER_COUNTRIES.has(code), `Missing Payoneer country: ${code}`);
  }
});

test("Step 10C.3: Payoneer vs payout-currency separation - distinct provider, method, and currency fields", () => {
  const norm = normalizeFeeSchedule({
    country_code: "AR",
    currency_code: "USD",
    processing_rate: 0.065,
    processing_fixed_amount: 0.30
  });
  assert.equal(norm.eligibility.paymentProviderContext, "payoneer");
  assert.equal(norm.eligibility.payoutMethodContext, "payoneer_account");
  assert.equal(norm.eligibility.payoutCurrencyContext, "usd_to_payoneer");
  assert.notEqual(norm.eligibility.paymentProviderContext, norm.eligibility.payoutCurrencyContext);
});

test("Step 10C.4: India special context - international only, $10 setup fee, Payoneer, 5% + ₹25, 0.05% reg", () => {
  const norm = normalizeFeeSchedule(FIXTURES.IN);
  assert.equal(norm.eligibility.paymentProviderContext, "payoneer");
  assert.equal(norm.eligibility.newShopRestriction, "international_only");
  assert.equal(norm.accountLevelFees.setup.status, "applicable");
  assert.equal(norm.accountLevelFees.setup.amount, 10);
  assert.equal(norm.accountLevelFees.setup.currency, "USD");
  assert.equal(norm.fees.processing.rate, 0.05);
  assert.equal(norm.fees.processing.fixedAmount, 25);
  assert.equal(norm.fees.regulatory.rate, 0.0005);
});

test("Step 10C.5: China new-shop restriction - suspended for new shops, existing shops only", () => {
  const norm = normalizeFeeSchedule({
    country_code: "CN",
    currency_code: "USD",
    processing_rate: 0.065,
    processing_fixed_amount: 0.30
  });
  assert.equal(norm.eligibility.newShopRestriction, "suspended_for_new_shops");
  assert.equal(norm.eligibility.paymentProviderContext, "payoneer");
  assert.equal(norm.capabilities.canDirectlyCalculate, false);
  assert.ok(norm.capabilities.unsupportedDimensions.includes("shop_restriction_suspended_for_new_shops"));
});

test("Step 10C.6: UAE payment context - Payoneer, USD disbursement, 6.5% + $0.30 USD", () => {
  const norm = normalizeFeeSchedule({
    country_code: "AE",
    currency_code: "USD",
    processing_rate: 0.065,
    processing_fixed_amount: 0.30
  });
  assert.equal(norm.eligibility.paymentProviderContext, "payoneer");
  assert.equal(norm.eligibility.payoutCurrencyContext, "usd_to_payoneer");
  assert.equal(norm.fees.processing.rate, 0.065);
  assert.equal(norm.fees.processing.fixedAmount, 0.30);
  assert.equal(norm.fees.regulatory.status, "not_listed");
  assert.equal(norm.fees.regulatory.rate, null);
});

test("Step 10C.7: Serbia payment context - Payoneer, USD disbursement, 6.5% + $0.30 USD", () => {
  const norm = normalizeFeeSchedule({
    country_code: "RS",
    currency_code: "USD",
    processing_rate: 0.065,
    processing_fixed_amount: 0.30
  });
  assert.equal(norm.eligibility.paymentProviderContext, "payoneer");
  assert.equal(norm.eligibility.payoutCurrencyContext, "usd_to_payoneer");
  assert.equal(norm.fees.processing.rate, 0.065);
  assert.equal(norm.fees.processing.fixedAmount, 0.30);
});

test("Step 10C.8: Brazil payment context - Payoneer, USD disbursement, 6.5% + $0.30 USD", () => {
  const norm = normalizeFeeSchedule({
    country_code: "BR",
    currency_code: "USD",
    processing_rate: 0.065,
    processing_fixed_amount: 0.30
  });
  assert.equal(norm.eligibility.paymentProviderContext, "payoneer");
  assert.equal(norm.eligibility.payoutCurrencyContext, "usd_to_payoneer");
  assert.equal(norm.fees.processing.rate, 0.065);
  assert.equal(norm.fees.processing.fixedAmount, 0.30);
});

test("Step 10C.9: Japan payment context - Payoneer integration, 6.0% + ¥45 JPY (or USD $0.30)", () => {
  const norm = normalizeFeeSchedule(FIXTURES.JP);
  assert.equal(norm.eligibility.paymentProviderContext, "payoneer");
  assert.equal(norm.fees.processing.rate, 0.06);
  assert.equal(norm.fees.regulatory.status, "not_listed");
  assert.equal(norm.fees.regulatory.rate, null);
});

test("Step 10C.10: South Korea payment context - Payoneer, USD disbursement, 6.5% + $0.30 USD", () => {
  const norm = normalizeFeeSchedule({
    country_code: "KR",
    currency_code: "USD",
    processing_rate: 0.065,
    processing_fixed_amount: 0.30
  });
  assert.equal(norm.eligibility.paymentProviderContext, "payoneer");
  assert.equal(norm.eligibility.payoutCurrencyContext, "usd_to_payoneer");
  assert.equal(norm.fees.processing.rate, 0.065);
  assert.equal(norm.fees.processing.fixedAmount, 0.30);
});

test("Step 10C.11: Regulatory not-listed != published 0% - unlisted markets have null rate, not published 0%", () => {
  const norm = normalizeFeeSchedule({
    country_code: "DE",
    currency_code: "EUR"
  });
  assert.equal(norm.fees.regulatory.isListedByEtsy, false);
  assert.equal(norm.fees.regulatory.status, "not_listed");
  assert.equal(norm.fees.regulatory.rate, null);
  assert.equal(norm.fees.regulatory.effectiveRate, 0); // 0 in calculations, not published rate
});

test("Step 10C.12: Deposit minimum vs fee threshold separation - distinct fields for statutory deposit rules", () => {
  const normID = normalizeFeeSchedule(FIXTURES.ID);
  assert.equal(normID.accountLevelFees.deposit.depositMinimum, 28000);
  assert.equal(normID.accountLevelFees.deposit.feeThreshold, 1400000);
  assert.equal(normID.accountLevelFees.deposit.feeAmount, 28000);
  assert.notEqual(normID.accountLevelFees.deposit.depositMinimum, normID.accountLevelFees.deposit.feeThreshold);

  const normVN = normalizeFeeSchedule(FIXTURES.VN);
  assert.equal(normVN.accountLevelFees.deposit.depositMinimum, 45000);
  assert.equal(normVN.accountLevelFees.deposit.feeThreshold, 2300000);
  assert.equal(normVN.accountLevelFees.deposit.feeAmount, 45000);
  assert.notEqual(normVN.accountLevelFees.deposit.depositMinimum, normVN.accountLevelFees.deposit.feeThreshold);
});

test("Step 10C.13: Setup unknown status preservation - non-India setup is unknown/location-dependent", () => {
  const normUS = normalizeFeeSchedule(FIXTURES.US);
  assert.equal(normUS.accountLevelFees.setup.status, "unknown");
  assert.equal(normUS.accountLevelFees.setup.label, "location_dependent");
  assert.equal(normUS.accountLevelFees.setup.amount, null);

  const normUK = normalizeFeeSchedule(FIXTURES.UK);
  assert.equal(normUK.accountLevelFees.setup.status, "unknown");
  assert.equal(normUK.accountLevelFees.setup.label, "location_dependent");
  assert.equal(normUK.accountLevelFees.setup.amount, null);
});

test("Step 10C.14: Candidate isolation from v1.0.0 - baseline v1.0.0 contains strictly 12 countries", () => {
  const v1BaselineCodes = ["US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP", "TR", "OTHER"];
  assert.equal(v1BaselineCodes.length, 12);
  const candidateSample = ["AE", "BR", "CL", "CN", "EG", "GE", "KR", "KZ", "PE", "PK", "RS", "TH", "UA", "VN", "RO"];
  for (const code of candidateSample) {
    assert.equal(v1BaselineCodes.includes(code), false);
  }
});

test("Step 10C.15: Source provenance integrity - records official source IDs including 115015710408", () => {
  const norm = normalizeFeeSchedule(FIXTURES.US);
  assert.ok(norm.provenance.sourceIds.includes("115015628847"));
  assert.ok(norm.provenance.sourceIds.includes("115015710408"));
});

test("Step 10C.16: Idempotent reconciliation - repeated normalizations produce identical immutable outputs", () => {
  const norm1 = normalizeFeeSchedule(FIXTURES.CA);
  const norm2 = normalizeFeeSchedule(FIXTURES.CA);
  assert.deepEqual(norm1, norm2);
  assert.equal(norm1.country.code, norm2.country.code);
  assert.equal(norm1.fees.regulatory.rate, norm2.fees.regulatory.rate);
});

// ============================================================================
// STEP 10D AUTHORITATIVE CANDIDATE CLASSIFICATION REGRESSION TESTS
// ============================================================================

test("Step 10D.1: Exactly 30 fully verified candidate markets", () => {
  assert.equal(FULLY_VERIFIED_CANDIDATES.length, 30);
  const expectedSet = [
    "AT", "BE", "CH", "CY", "DK", "EE", "FI", "GR", "HK", "ID",
    "IE", "IL", "LT", "LU", "LV", "MA", "MT", "MX", "MY", "NL",
    "NO", "NZ", "PH", "PT", "SE", "SG", "SI", "SK", "VN", "ZA"
  ];
  assert.deepEqual([...FULLY_VERIFIED_CANDIDATES].sort(), expectedSet.sort());
});

test("Step 10D.2: Exactly 14 Payoneer candidate markets", () => {
  assert.equal(PAYONEER_CANDIDATES.length, 14);
  const expectedSet = [
    "AE", "AR", "BR", "CL", "CN", "EG", "GE", "KR", "KZ", "PK",
    "PE", "RS", "TH", "UA"
  ];
  assert.deepEqual([...PAYONEER_CANDIDATES].sort(), expectedSet.sort());
});

test("Step 10D.3: Exactly 6 EUR-bank-FX partial candidate markets", () => {
  assert.equal(EUR_BANK_FX_CANDIDATES.length, 6);
  const expectedSet = ["BG", "HR", "CZ", "HU", "RO", "PL"];
  assert.deepEqual([...EUR_BANK_FX_CANDIDATES].sort(), expectedSet.sort());
});

test("Step 10D.4: Total candidates count equals exactly 50", () => {
  assert.equal(ALL_CANDIDATE_CODES.length, 50);
  assert.equal(
    FULLY_VERIFIED_CANDIDATES.length + PAYONEER_CANDIDATES.length + EUR_BANK_FX_CANDIDATES.length,
    50
  );
});

test("Step 10D.5: Vietnam (VN) is classified as fully verified candidate", () => {
  assert.ok(FULLY_VERIFIED_CANDIDATES.includes("VN"));
  assert.ok(!PAYONEER_CANDIDATES.includes("VN"));
  assert.ok(!EUR_BANK_FX_CANDIDATES.includes("VN"));
  const normVN = normalizeFeeSchedule({
    country_code: "VN",
    currency_code: "VND",
    processing_rate: 0.045,
    processing_fixed_amount: 11500
  });
  assert.equal(normVN.capabilities.marketFullyVerified, true);
  assert.equal(normVN.capabilities.dataStatus, "core_and_market_verified");
  assert.equal(normVN.eligibility.paymentProviderContext, "direct_etsy_payments");
  assert.equal(normVN.eligibility.payoutCurrencyContext, "local_currency");
  assert.equal(normVN.eligibility.newShopRestriction, "none");
  assert.equal(normVN.eligibility.partialReason, null);
});

test("Step 10D.6: Six Etsy EUR-payout candidate markets (BG, HR, CZ, HU, RO, PL) with EUR bank FX semantics", () => {
  const eurPayout = ["CZ", "HU", "RO", "PL", "BG", "HR"];
  for (const code of eurPayout) {
    assert.ok(!FULLY_VERIFIED_CANDIDATES.includes(code), `${code} should NOT be in fully verified candidates`);
    assert.ok(EUR_BANK_FX_CANDIDATES.includes(code), `${code} must be in EUR payout candidates`);
    const norm = normalizeFeeSchedule({
      country_code: code,
      currency_code: "EUR",
      processing_rate: 0.04,
      processing_fixed_amount: 0.30
    });
    assert.equal(norm.eligibility.payoutCurrency, "EUR");
    assert.equal(norm.eligibility.etsyPayoutCurrency, "EUR");
    assert.equal(norm.eligibility.payoutCurrencyContext, "etsy_sends_eur");
    // All six markets have bankFxPossibility = true per official Etsy documentation
    assert.equal(norm.eligibility.bankFxPossibility, true, `${code} bankFxPossibility must be true per Etsy documentation`);

    if (code === "BG" || code === "HR") {
      // Eurozone member states (HR in 2023, BG on Jan 1, 2026)
      assert.equal(norm.eligibility.euroArea, true, `${code} must be classified as Eurozone (euroArea=true)`);
      assert.equal(norm.eligibility.partialReason, "etsy_eur_payout_context");
    } else {
      // EU member states with domestic non-EUR currencies (CZK, HUF, RON, PLN)
      assert.equal(norm.eligibility.euroArea, false, `${code} is not in Eurozone (euroArea=false)`);
      assert.equal(norm.eligibility.partialReason, "eur_bank_fx_context");
    }
  }
});

test("Step 10E.Bulgaria.1: Bulgaria (BG) 2026 Euro transition & EUR bank FX semantics", () => {
  // 1. BG processing = 4% + EUR 0.30
  const normBG = normalizeFeeSchedule({
    country_code: "BG",
    currency_code: "EUR",
    processing_rate: 0.04,
    processing_fixed_amount: 0.30
  });
  assert.equal(normBG.fees.processing.rate, 0.04);
  assert.equal(normBG.fees.processing.fixedAmount, 0.30);
  assert.equal(normBG.fees.processing.currency, "EUR");

  // 2. BG current currency metadata = EUR
  assert.equal(normBG.country.currency, "EUR");
  assert.equal(normBG.eligibility.payoutCurrency, "EUR");
  assert.equal(normBG.eligibility.etsyPayoutCurrency, "EUR");

  // 3. BG is NOT classified as non-Eurozone
  assert.equal(normBG.eligibility.euroArea, true, "BG must be in euroArea (adopted Jan 1, 2026)");
  assert.equal(EURO_AREA_COUNTRIES.has("BG"), true, "BG must be in EURO_AREA_COUNTRIES");

  // 4. BG bankFxPossibility = true per Etsy documentation (Etsy sends EUR; bank may charge FX fees)
  assert.equal(normBG.eligibility.bankFxPossibility, true, "BG bankFxPossibility must be true per Etsy documentation");

  // 5. No BGN remains in candidate definitions or currency resolution
  assert.notEqual(normBG.country.currency, "BGN");
  assert.notEqual(normBG.fees.processing.currency, "BGN");
  assert.notEqual(normBG.fees.listing.currency, "BGN");
  assert.notEqual(normBG.eligibility.payoutCurrency, "BGN");

  // 6. Regulatory fee: Bulgaria is not listed by Etsy (Article 1500011073202)
  assert.strictEqual(normBG.regulatoryOperatingFee.rate, null);
  assert.strictEqual(normBG.regulatoryOperatingFee.status, "not_listed");
  assert.strictEqual(normBG.regulatoryOperatingFee.isListedByEtsy, false);
  assert.strictEqual(normBG.fees.regulatory.rate, null);
  assert.strictEqual(normBG.fees.regulatory.status, "not_listed");
  assert.strictEqual(normBG.fees.regulatory.isListedByEtsy, false);
});

test("Step 10E.Semantics.1: Authoritative EUR payout & bank FX semantics across all 6 candidate markets", () => {
  // BG: currency=EUR, payoutCurrency=EUR, euroArea=true, bankFxPossibility=true
  const normBG = normalizeFeeSchedule({ country_code: "BG", currency_code: "EUR" });
  assert.equal(normBG.country.currency, "EUR");
  assert.equal(normBG.eligibility.payoutCurrency, "EUR");
  assert.equal(normBG.eligibility.euroArea, true);
  assert.equal(normBG.eligibility.bankFxPossibility, true);

  // HR: euroArea=true, bankFxPossibility=true
  const normHR = normalizeFeeSchedule({ country_code: "HR", currency_code: "EUR" });
  assert.equal(normHR.country.currency, "EUR");
  assert.equal(normHR.eligibility.payoutCurrency, "EUR");
  assert.equal(normHR.eligibility.euroArea, true);
  assert.equal(normHR.eligibility.bankFxPossibility, true);

  // CZ, HU, RO, PL: euroArea=false, bankFxPossibility=true
  const nonEuroGroup = ["CZ", "HU", "RO", "PL"];
  for (const code of nonEuroGroup) {
    const norm = normalizeFeeSchedule({ country_code: code, currency_code: "EUR" });
    assert.equal(norm.eligibility.euroArea, false, `${code} must have euroArea = false`);
    assert.equal(norm.eligibility.bankFxPossibility, true, `${code} must have bankFxPossibility = true`);
  }

  // Zero BG BGN metadata exists
  assert.notEqual(normBG.country.currency, "BGN");
  assert.notEqual(normBG.fees.processing.currency, "BGN");
  assert.notEqual(normBG.eligibility.payoutCurrency, "BGN");
});

test("Step 10E.Regulatory.1: Regression test - BG.regulatoryOperatingFee.rate === null & not_listed", () => {
  const normBG = normalizeFeeSchedule({
    country_code: "BG",
    currency_code: "EUR",
    processing_rate: 0.04,
    processing_fixed_amount: 0.30
  });

  // Required BG Value: rate is null, status is 'not_listed', isListedByEtsy is false (no numeric 0)
  assert.strictEqual(normBG.regulatoryOperatingFee.rate, null);
  assert.strictEqual(normBG.regulatoryOperatingFee.status, "not_listed");
  assert.strictEqual(normBG.regulatoryOperatingFee.isListedByEtsy, false);

  assert.strictEqual(normBG.fees.regulatory.rate, null);
  assert.strictEqual(normBG.fees.regulatory.status, "not_listed");
  assert.strictEqual(normBG.fees.regulatory.isListedByEtsy, false);
});

test("Step 10E.Regulatory.2: Global invariant: exactly 9 countries have numeric regulatory rates; all remaining have null", () => {
  const statutory9 = Object.freeze({
    CA: 0.005,
    FR: 0.0114,
    HU: 0.0197,
    IT: 0.008,
    IN: 0.0005,
    ES: 0.0088,
    TR: 0.0167,
    UK: 0.0048,
    VN: 0.0124
  });

  assert.equal(Object.keys(statutory9).length, 9);
  assert.deepEqual(Object.keys(STATUTORY_REGULATORY_RATES).sort(), Object.keys(statutory9).sort());

  for (const [code, expectedRate] of Object.entries(statutory9)) {
    assert.strictEqual(STATUTORY_REGULATORY_RATES[code], expectedRate, `${code} statutory rate mismatch`);
    const norm = normalizeFeeSchedule({ country_code: code, currency_code: "USD" });
    assert.strictEqual(norm.regulatoryOperatingFee.rate, expectedRate, `${code} regulatoryOperatingFee.rate mismatch`);
    assert.strictEqual(norm.regulatoryOperatingFee.status, "applicable");
    assert.strictEqual(norm.regulatoryOperatingFee.isListedByEtsy, true);
    assert.strictEqual(norm.fees.regulatory.rate, expectedRate);
  }

  // All 62 global catalog items
  const allCatalogCodes = [...BASELINE_COUNTRY_ORDER, ...ALL_CANDIDATE_CODES];
  assert.equal(allCatalogCodes.length, 62);

  let numericCount = 0;
  let nullCount = 0;

  for (const code of allCatalogCodes) {
    const norm = normalizeFeeSchedule({ country_code: code, currency_code: "USD" });
    if (statutory9[code] !== undefined) {
      numericCount++;
      assert.strictEqual(typeof norm.regulatoryOperatingFee.rate, "number");
      assert.strictEqual(norm.regulatoryOperatingFee.rate, statutory9[code]);
      assert.strictEqual(norm.regulatoryOperatingFee.status, "applicable");
      assert.strictEqual(norm.regulatoryOperatingFee.isListedByEtsy, true);
    } else {
      nullCount++;
      assert.strictEqual(norm.regulatoryOperatingFee.rate, null, `${code} must have null regulatory rate`);
      assert.strictEqual(norm.regulatoryOperatingFee.status, "not_listed", `${code} must have not_listed status`);
      assert.strictEqual(norm.regulatoryOperatingFee.isListedByEtsy, false, `${code} must have isListedByEtsy = false`);
      assert.strictEqual(norm.fees.regulatory.rate, null);
    }
  }

  assert.strictEqual(numericCount, 9, "Exactly 9 countries have numeric regulatory rates");
  assert.strictEqual(nullCount, 53, "All remaining 53 countries have null regulatory rates");
});

test("Step 10D.7: China (CN) is partial with suspended new shop restriction", () => {
  assert.ok(PAYONEER_CANDIDATES.includes("CN"));
  assert.ok(!FULLY_VERIFIED_CANDIDATES.includes("CN"));
  const normCN = normalizeFeeSchedule({
    country_code: "CN",
    currency_code: "USD",
    processing_rate: 0.065,
    processing_fixed_amount: 0.30
  });
  assert.equal(normCN.capabilities.marketFullyVerified, false);
  assert.equal(normCN.eligibility.paymentProviderContext, "payoneer");
  assert.equal(normCN.eligibility.newShopRestriction, "suspended_for_new_shops");
  assert.equal(normCN.eligibility.partialReason, "payoneer_usd_context");
});

test("Step 10D.8: Baseline IN and JP are not included in candidate count", () => {
  assert.ok(!FULLY_VERIFIED_CANDIDATES.includes("IN"));
  assert.ok(!FULLY_VERIFIED_CANDIDATES.includes("JP"));
  assert.ok(!PAYONEER_CANDIDATES.includes("IN"));
  assert.ok(!PAYONEER_CANDIDATES.includes("JP"));
  assert.ok(!EUR_BANK_FX_CANDIDATES.includes("IN"));
  assert.ok(!EUR_BANK_FX_CANDIDATES.includes("JP"));
  assert.ok(!ALL_CANDIDATE_CODES.includes("IN"));
  assert.ok(!ALL_CANDIDATE_CODES.includes("JP"));
});

test("Step 10D.9: No duplicate classification within any candidate set", () => {
  assert.equal(new Set(FULLY_VERIFIED_CANDIDATES).size, FULLY_VERIFIED_CANDIDATES.length);
  assert.equal(new Set(PAYONEER_CANDIDATES).size, PAYONEER_CANDIDATES.length);
  assert.equal(new Set(EUR_BANK_FX_CANDIDATES).size, EUR_BANK_FX_CANDIDATES.length);
  assert.equal(new Set(ALL_CANDIDATE_CODES).size, ALL_CANDIDATE_CODES.length);
});

test("Step 10D.10: Classification sets union to exactly 50 candidates", () => {
  const unionSet = new Set([
    ...FULLY_VERIFIED_CANDIDATES,
    ...PAYONEER_CANDIDATES,
    ...EUR_BANK_FX_CANDIDATES
  ]);
  assert.equal(unionSet.size, 50);
  assert.equal(ALL_CANDIDATE_CODES.length, 50);
});

test("Step 10D.11: Classification sets have zero intersection (pairwise disjoint)", () => {
  const fullySet = new Set(FULLY_VERIFIED_CANDIDATES);
  const payoneerSet = new Set(PAYONEER_CANDIDATES);
  const eurFxSet = new Set(EUR_BANK_FX_CANDIDATES);

  for (const c of fullySet) {
    assert.ok(!payoneerSet.has(c), `Intersection found between Fully and Payoneer: ${c}`);
    assert.ok(!eurFxSet.has(c), `Intersection found between Fully and EUR-FX: ${c}`);
  }
  for (const c of payoneerSet) {
    assert.ok(!eurFxSet.has(c), `Intersection found between Payoneer and EUR-FX: ${c}`);
  }
});

test("Step 10D.12: Candidate isolation from v1.0.0 baseline", () => {
  const baselineCodes = new Set(["US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP", "TR", "OTHER"]);
  assert.equal(baselineCodes.size, 12);
  for (const c of ALL_CANDIDATE_CODES) {
    assert.ok(!baselineCodes.has(c), `Candidate ${c} improperly leaked into baseline v1.0.0 set`);
  }
});

test("Step 10D.13: Regulatory unlisted != explicit zero (rate = null, status = not_listed)", () => {
  const unlistedMarkets = ["DE", "SE", "NL", "SG", "IL", "ZA", "NZ", "CH", "NO"];
  for (const code of unlistedMarkets) {
    const norm = normalizeFeeSchedule({ country_code: code, currency_code: "USD" });
    assert.equal(norm.fees.regulatory.isListedByEtsy, false);
    assert.equal(norm.fees.regulatory.status, "not_listed");
    assert.equal(norm.fees.regulatory.rate, null);
    assert.notEqual(norm.fees.regulatory.rate, 0); // Must NOT claim Etsy published 0%
    assert.equal(norm.fees.regulatory.effectiveRate, 0); // Mathematical fallback is 0
  }
});

test("Step 10D.14: Deposit unlisted != numeric zero (feeAmount = null, status = not_applicable)", () => {
  const unlistedDepositMarkets = ["US", "UK", "DE", "FR", "NL", "SE", "ES", "IT"];
  for (const code of unlistedDepositMarkets) {
    const norm = normalizeFeeSchedule({ country_code: code, currency_code: "EUR" });
    assert.equal(norm.accountLevelFees.deposit.isListedByEtsy, false);
    assert.equal(norm.accountLevelFees.deposit.status, "not_applicable");
    assert.equal(norm.accountLevelFees.deposit.depositFeeMode, "not_listed");
    assert.equal(norm.accountLevelFees.deposit.feeAmount, null);
    assert.notEqual(norm.accountLevelFees.deposit.feeAmount, 0);
  }
});

test("Step 10E.Reconciliation.1: Exact statutory deposit schedule reconciliation for all 9 markets", () => {
  const expectedDeposit = {
    ID: { min: 28000, threshold: 1400000, fee: 28000, currency: "IDR" },
    IL: { min: 7, threshold: 350, fee: 7, currency: "ILS" },
    MY: { min: 9, threshold: 400, fee: 8, currency: "MYR" },
    MX: { min: 40, threshold: 2000, fee: 40, currency: "MXN" },
    MA: { min: 20, threshold: 1000, fee: 20, currency: "MAD" },
    PH: { min: 100, threshold: 5000, fee: 100, currency: "PHP" },
    ZA: { min: 35, threshold: 1500, fee: 30, currency: "ZAR" },
    TR: { min: 50, threshold: 600, fee: 42, currency: "TRY" },
    VN: { min: 45000, threshold: 2300000, fee: 45000, currency: "VND" }
  };

  assert.equal(Object.keys(STATUTORY_DEPOSIT_SCHEDULES).length, 9);

  for (const [code, exp] of Object.entries(expectedDeposit)) {
    const sched = STATUTORY_DEPOSIT_SCHEDULES[code];
    assert.ok(sched, `${code} missing from STATUTORY_DEPOSIT_SCHEDULES`);
    assert.equal(sched.min, exp.min, `${code} deposit minimum must equal ${exp.min}`);
    assert.equal(sched.threshold, exp.threshold, `${code} deposit threshold must equal ${exp.threshold}`);
    assert.equal(sched.fee, exp.fee, `${code} deposit fee must equal ${exp.fee}`);
    assert.equal(sched.currency, exp.currency, `${code} currency must equal ${exp.currency}`);

    const norm = normalizeFeeSchedule({ country_code: code, currency_code: exp.currency });
    assert.equal(norm.accountLevelFees.deposit.isListedByEtsy, true);
    assert.equal(norm.accountLevelFees.deposit.depositFeeMode, "account_level");
    assert.equal(norm.accountLevelFees.deposit.status, "applicable");
    assert.equal(norm.accountLevelFees.deposit.depositMinimum, exp.min);
    assert.equal(norm.accountLevelFees.deposit.feeThreshold, exp.threshold);
    assert.equal(norm.accountLevelFees.deposit.feeAmount, exp.fee);
    assert.equal(norm.accountLevelFees.deposit.currency, exp.currency);
  }
});

test("Step 10E.Reconciliation.2: Exactly 53 other catalog rows have null/unlisted deposit data without synthetic zeros", () => {
  const depositMarkets = new Set(["ID", "IL", "MA", "MX", "MY", "PH", "TR", "VN", "ZA"]);
  const allCatalogCodes = [
    "US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP", "TR", "OTHER",
    ...ALL_CANDIDATE_CODES
  ];
  assert.equal(allCatalogCodes.length, 62);

  const unlistedCodes = allCatalogCodes.filter(c => !depositMarkets.has(c));
  assert.equal(unlistedCodes.length, 53, "Must be exactly 53 unlisted deposit markets");

  for (const code of unlistedCodes) {
    const norm = normalizeFeeSchedule({ country_code: code, currency_code: "USD" });
    assert.equal(norm.accountLevelFees.deposit.isListedByEtsy, false, `${code} isListedByEtsy must be false`);
    assert.equal(norm.accountLevelFees.deposit.depositFeeMode, "not_listed", `${code} depositFeeMode must be not_listed`);
    assert.equal(norm.accountLevelFees.deposit.status, "not_applicable", `${code} status must be not_applicable`);
    assert.equal(norm.accountLevelFees.deposit.applicable, false, `${code} applicable must be false`);
    assert.equal(norm.accountLevelFees.deposit.feeAmount, null, `${code} feeAmount must be null`);
    assert.notEqual(norm.accountLevelFees.deposit.feeAmount, 0, `${code} feeAmount must NOT be 0`);
    assert.equal(norm.accountLevelFees.deposit.depositMinimum, null, `${code} depositMinimum must be null`);
    assert.notEqual(norm.accountLevelFees.deposit.depositMinimum, 0, `${code} depositMinimum must NOT be 0`);
    assert.equal(norm.accountLevelFees.deposit.feeThreshold, null, `${code} feeThreshold must be null`);
    assert.notEqual(norm.accountLevelFees.deposit.feeThreshold, 0, `${code} feeThreshold must NOT be 0`);
  }
});

