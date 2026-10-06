import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateOrderFees,
  calculateDepositFee,
  toMinorUnits,
  fromMinorUnits,
  getCurrencyMinorUnitDigits,
  resolveCountryFeeRule,
  GLOBAL_COUNTRY_RULES,
  OFFICIAL_TRANSACTION_RATE,
  DEFAULT_CURRENCY_CONVERSION_RATE,
  STATUTORY_OFFSITE_ADS_CAP
} from "../src/fee-engine.js";
import { LEGACY_CALCULATOR_CASES } from "./fixtures/legacy-calculator-cases.js";

// ============================================================================
// SUITE 1: REQUIRED COUNTRY COVERAGE (15 REQUIRED MARKETS)
// US, UK, CA dom/intl, AU dom/intl, NZ dom/intl, IN, JP, TR, VN, BG, DE, OTHER
// ============================================================================

test("Step 11B.1: US Fee Calculation (Baseline & Invariants)", () => {
  const result = calculateOrderFees({
    country: "US",
    itemPrice: 50,
    shipping: 10,
    itemCost: 15,
    packagingCost: 2
  });

  // Bases
  assert.equal(result.bases.transactionBase, 60);
  assert.equal(result.bases.processingBase, 60);
  assert.equal(result.bases.regulatoryBase, 60);
  assert.equal(result.bases.offsiteAdsBase, 60);
  assert.equal(result.bases.currencyConversionBase, 60);

  // Fees: 6.5% transaction ($3.90), 3% + $0.25 processing ($2.05), $0.20 listing
  assert.equal(result.feeBreakdown.transaction, 3.90);
  assert.equal(result.feeBreakdown.processing, 2.05);
  assert.equal(result.feeBreakdown.listing, 0.20);
  assert.equal(result.feeBreakdown.regulatory, 0);
  assert.equal(result.feeBreakdown.offsiteAds, 0);
  assert.equal(result.feeBreakdown.currencyConversion, 0);
  assert.equal(result.feeBreakdown.etsyPlusAmortized, 0);

  // Totals
  assert.equal(result.totals.totalEtsyFees, 6.15);
  assert.equal(result.totals.totalAccountLevelCosts, 0);
  assert.equal(result.totals.totalProfit, 36.85);

  // Regulatory null invariant
  assert.equal(result.metadata.regulatory.rate, null);
  assert.equal(result.metadata.regulatory.status, "not_listed");
  assert.equal(result.metadata.regulatory.isListedByEtsy, false);

  // Informational
  assert.equal(result.informational.payoneer, false);
  assert.equal(result.informational.bankFxPossibility, false);
  assert.equal(result.informational.depositSchedule.mode, "not_listed");

  // Offsite Ads Cap metadata
  assert.deepEqual(result.metadata.offsiteAdsCap, { amount: 100, currency: "USD", type: "usd_equivalent" });
  assert.deepEqual(result.informational.offsiteAdsCap, { amount: 100, currency: "USD", type: "usd_equivalent" });
});

test("Step 11B.2: UK Fee Calculation (Regulatory 0.48% + Amortized Plus)", () => {
  const result = calculateOrderFees({
    country: "UK",
    itemPrice: 40,
    shipping: 5,
    itemCost: 10,
    packagingCost: 1.5,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15,
    plusEnabled: true,
    salesPerMonth: 30
  });

  // Bases: 45 GBP
  assert.equal(result.bases.transactionBase, 45);
  assert.equal(result.bases.currencyConversionBase, 45);

  // Fees: 6.5% trans (2.93), 4% + 0.20 proc (2.00), 0.48% reg (0.22), 15% offsite (6.75), 0.16 listing
  assert.equal(result.feeBreakdown.listing, 0.16);
  assert.equal(result.feeBreakdown.transaction, 2.93);
  assert.equal(result.feeBreakdown.processing, 2.00);
  assert.equal(result.feeBreakdown.regulatory, 0.22);
  assert.equal(result.feeBreakdown.offsiteAds, 6.75);
  assert.equal(result.feeBreakdown.etsyPlusAmortized, 0.27); // 8 GBP / 30 sales = 0.27

  // Regulatory metadata
  assert.equal(result.metadata.regulatory.rate, 0.0048);
  assert.equal(result.metadata.regulatory.status, "applicable");
  assert.equal(result.metadata.regulatory.isListedByEtsy, true);

  // Totals: totalEtsyFees (12.06), accountCosts (0.27), netProfit (21.17)
  assert.equal(result.totals.totalEtsyFees, 12.06);
  assert.equal(result.totals.totalAccountLevelCosts, 0.27);
  assert.equal(result.totals.totalProfit, 21.17);
});

test("Step 11B.3: Canada Domestic vs International Split (CA)", () => {
  // CA Domestic: 3% + CA$0.25
  const domResult = calculateOrderFees({
    country: "CA",
    itemPrice: 60,
    shipping: 12,
    orderType: "domestic",
    itemCost: 20,
    packagingCost: 3,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.12
  });

  assert.equal(domResult.bases.transactionBase, 72);
  assert.equal(domResult.bases.currencyConversionBase, 72);
  assert.equal(domResult.feeBreakdown.listing, 0.27);
  assert.equal(domResult.feeBreakdown.transaction, 4.68); // 72 * 6.5%
  assert.equal(domResult.feeBreakdown.processing, 2.41); // 72 * 3% + 0.25 = 2.41
  assert.equal(domResult.feeBreakdown.regulatory, 0.36); // 72 * 0.5% = 0.36
  assert.equal(domResult.feeBreakdown.offsiteAds, 8.64); // 72 * 12% = 8.64
  assert.equal(domResult.totals.totalEtsyFees, 16.36);
  assert.equal(domResult.totals.totalProfit, 32.64);

  // CA International: 4% + CA$0.25
  const intlResult = calculateOrderFees({
    country: "CA",
    itemPrice: 60,
    shipping: 12,
    orderType: "international",
    itemCost: 20,
    packagingCost: 3,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.12
  });

  assert.equal(intlResult.feeBreakdown.processing, 3.13); // 72 * 4% + 0.25 = 3.13
  assert.equal(intlResult.totals.totalEtsyFees, 17.08); // 16.36 + (3.13 - 2.41) = 17.08
  assert.equal(intlResult.totals.totalProfit, 31.92);
  assert.ok(intlResult.feeBreakdown.processing > domResult.feeBreakdown.processing);
});

test("Step 11B.4: Australia Domestic vs International Split (AU)", () => {
  // AU Domestic: 3% + A$0.25
  const domResult = calculateOrderFees({
    country: "AU",
    itemPrice: 75,
    shipping: 15,
    orderType: "domestic",
    itemCost: 25,
    packagingCost: 4
  });

  assert.equal(domResult.bases.transactionBase, 90);
  assert.equal(domResult.bases.currencyConversionBase, 90);
  assert.equal(domResult.feeBreakdown.listing, 0.28);
  assert.equal(domResult.feeBreakdown.transaction, 5.85); // 90 * 6.5% = 5.85
  assert.equal(domResult.feeBreakdown.processing, 2.95); // 90 * 3% + 0.25 = 2.95
  assert.equal(domResult.feeBreakdown.regulatory, 0); // Unlisted regulatory
  assert.equal(domResult.metadata.regulatory.rate, null);
  assert.equal(domResult.totals.totalEtsyFees, 9.08);

  // AU International: 4% + A$0.25
  const intlResult = calculateOrderFees({
    country: "AU",
    itemPrice: 75,
    shipping: 15,
    orderType: "international",
    itemCost: 25,
    packagingCost: 4
  });

  assert.equal(intlResult.feeBreakdown.processing, 3.85); // 90 * 4% + 0.25 = 3.85
  assert.equal(intlResult.totals.totalEtsyFees, 9.98);
  assert.ok(intlResult.feeBreakdown.processing > domResult.feeBreakdown.processing);
});

test("Step 11B.5: New Zealand Domestic vs International Split (NZ)", () => {
  // NZ Domestic: 3% + NZ$0.30
  const dom = calculateOrderFees({
    country: "NZ",
    itemPrice: 100,
    shipping: 20,
    orderType: "domestic"
  });
  assert.equal(dom.bases.transactionBase, 120);
  assert.equal(dom.bases.currencyConversionBase, 120);
  assert.equal(dom.feeBreakdown.listing, 0.30);
  assert.equal(dom.feeBreakdown.transaction, 7.80); // 120 * 6.5% = 7.80
  assert.equal(dom.feeBreakdown.processing, 3.90); // 120 * 3% + 0.30 = 3.90
  assert.equal(dom.totals.totalEtsyFees, 12.00);

  // NZ International: 4% + NZ$0.30
  const intl = calculateOrderFees({
    country: "NZ",
    itemPrice: 100,
    shipping: 20,
    orderType: "international"
  });
  assert.equal(intl.feeBreakdown.processing, 5.10); // 120 * 4% + 0.30 = 5.10
  assert.equal(intl.totals.totalEtsyFees, 13.20);
  assert.ok(intl.feeBreakdown.processing > dom.feeBreakdown.processing);
});

test("Step 11B.6: India (IN) — Payoneer, Regulatory 0.05%, Setup Fee $10 USD", () => {
  const result = calculateOrderFees({
    country: "IN",
    itemPrice: 1500,
    shipping: 200,
    itemCost: 500,
    packagingCost: 50,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15,
    plusEnabled: true,
    salesPerMonth: 30
  });

  assert.equal(result.bases.transactionBase, 1700);
  assert.equal(result.bases.currencyConversionBase, 1700);
  assert.equal(result.feeBreakdown.listing, 16.50);
  assert.equal(result.feeBreakdown.transaction, 110.50); // 1700 * 6.5%
  assert.equal(result.feeBreakdown.processing, 110.00); // 1700 * 5% + 25 = 110.00
  assert.equal(result.feeBreakdown.regulatory, 0.85); // 1700 * 0.05% = 0.85
  assert.equal(result.feeBreakdown.offsiteAds, 255.00); // 1700 * 15% = 255.00
  assert.equal(result.feeBreakdown.etsyPlusAmortized, 27.67); // 830 / 30 = 27.67

  // Setup fee and Payoneer
  assert.equal(result.informational.payoneer, true);
  assert.equal(result.informational.payoneerContext, "payoneer");
  assert.deepEqual(result.informational.setupFee, { amount: 10, currency: "USD", status: "applicable" });
  assert.equal(result.metadata.regulatory.rate, 0.0005);
});

test("Step 11B.7: Japan (JP) — Zero-Decimal JPY Precision & Payoneer Context", () => {
  const result = calculateOrderFees({
    country: "JP",
    itemPrice: 5000,
    shipping: 800,
    itemCost: 1500,
    packagingCost: 200
  });

  // Zero-decimal currency handling
  assert.equal(getCurrencyMinorUnitDigits("JPY"), 0);
  assert.equal(result.bases.transactionBase, 5800);
  assert.equal(result.bases.currencyConversionBase, 5800);
  assert.equal(result.feeBreakdown.listing, 30);
  assert.equal(result.feeBreakdown.transaction, 377); // 5800 * 6.5% = 377
  assert.equal(result.feeBreakdown.processing, 393); // 5800 * 6% + 45 = 393
  assert.equal(result.feeBreakdown.regulatory, 0);
  assert.equal(result.totals.totalEtsyFees, 800);
  assert.equal(result.totals.totalProfit, 3300); // 5800 - 800 - 1700 = 3300

  // Payoneer flag
  assert.equal(result.informational.payoneer, true);
  assert.equal(result.informational.bankFxPossibility, false);
});

test("Step 11B.8: Türkiye (TR) — 6.5% + ₺14, Regulatory 1.67%, Deposit Schedule 50/600/42 TRY", () => {
  const result = calculateOrderFees({
    country: "TR",
    itemPrice: 800,
    shipping: 150,
    itemCost: 250,
    packagingCost: 30,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.12,
    plusEnabled: true,
    salesPerMonth: 30
  });

  assert.equal(result.bases.transactionBase, 950);
  assert.equal(result.bases.currencyConversionBase, 950);
  assert.equal(result.feeBreakdown.listing, 7.00);
  assert.equal(result.feeBreakdown.transaction, 61.75); // 950 * 6.5%
  assert.equal(result.feeBreakdown.processing, 75.75); // 950 * 6.5% + 14 = 75.75
  assert.equal(result.feeBreakdown.regulatory, 15.87); // 950 * 1.67% = 15.865 -> 15.87
  assert.equal(result.feeBreakdown.offsiteAds, 114.00); // 950 * 12% = 114.00
  assert.equal(result.feeBreakdown.etsyPlusAmortized, 11.33); // 340 / 30 = 11.33

  // Deposit schedule
  const dep = result.informational.depositSchedule;
  assert.equal(dep.mode, "listed");
  assert.deepEqual(dep.dailyDepositMinimum, { amount: 50, currency: "TRY" });
  assert.deepEqual(dep.feeThreshold, { amount: 600, currency: "TRY" });
  assert.deepEqual(dep.fee, { amount: 42, currency: "TRY" });

  // Separate deposit helper testing
  assert.equal(calculateDepositFee(40, dep), 0); // <= min
  assert.equal(calculateDepositFee(50, dep), 0); // == min
  assert.equal(calculateDepositFee(51, dep), 42); // > min && < threshold
  assert.equal(calculateDepositFee(599, dep), 42);
  assert.equal(calculateDepositFee(600, dep), 0); // >= threshold
  assert.equal(calculateDepositFee(1000, dep), 0);
});

test("Step 11B.9: Vietnam (VN) — 4.5% + 11500 VND, Regulatory 1.24%, Deposit Schedule 45k/2.3M/45k VND", () => {
  const result = calculateOrderFees({
    country: "VN",
    itemPrice: 500000,
    shipping: 100000
  });

  assert.equal(result.bases.transactionBase, 600000);
  assert.equal(result.bases.currencyConversionBase, 600000);
  assert.equal(result.feeBreakdown.listing, 5000);
  assert.equal(result.feeBreakdown.transaction, 39000); // 600000 * 6.5% = 39000
  assert.equal(result.feeBreakdown.processing, 38500); // 600000 * 4.5% + 11500 = 27000 + 11500 = 38500
  assert.equal(result.feeBreakdown.regulatory, 7440); // 600000 * 1.24% = 7440

  const dep = result.informational.depositSchedule;
  assert.equal(dep.mode, "listed");
  assert.deepEqual(dep.dailyDepositMinimum, { amount: 45000, currency: "VND" });
  assert.deepEqual(dep.feeThreshold, { amount: 2300000, currency: "VND" });
  assert.deepEqual(dep.fee, { amount: 45000, currency: "VND" });

  assert.equal(calculateDepositFee(40000, dep), 0);
  assert.equal(calculateDepositFee(500000, dep), 45000);
  assert.equal(calculateDepositFee(2500000, dep), 0);
});

test("Step 11B.10: Bulgaria (BG) — 2026 Euro Adoption, bankFxPossibility=true, Null Regulatory Invariant", () => {
  const result = calculateOrderFees({
    country: "BG",
    itemPrice: 50,
    shipping: 10
  });

  assert.equal(result.metadata.currency, "EUR");
  assert.equal(result.metadata.payoutCurrency, "EUR");
  assert.equal(result.feeBreakdown.listing, 0.18);
  assert.equal(result.feeBreakdown.transaction, 3.90); // 60 * 6.5%
  assert.equal(result.feeBreakdown.processing, 2.70); // 60 * 4% + 0.30 = 2.70
  assert.equal(result.feeBreakdown.regulatory, 0);

  // Regulatory null invariant
  assert.equal(result.metadata.regulatory.rate, null);
  assert.equal(result.metadata.regulatory.status, "not_listed");
  assert.equal(result.metadata.regulatory.isListedByEtsy, false);

  // Bank FX possibility true
  assert.equal(result.informational.bankFxPossibility, true);
  assert.equal(result.informational.payoneer, false);
});

test("Step 11B.11: Germany (DE) — 4% + €0.30, Null Regulatory Metadata", () => {
  const result = calculateOrderFees({
    country: "DE",
    itemPrice: 45,
    shipping: 8,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15
  });

  assert.equal(result.bases.transactionBase, 53);
  assert.equal(result.bases.currencyConversionBase, 53);
  assert.equal(result.feeBreakdown.listing, 0.18);
  assert.equal(result.feeBreakdown.transaction, 3.45); // 53 * 6.5% = 3.445 -> 3.45
  assert.equal(result.feeBreakdown.processing, 2.42); // 53 * 4% + 0.30 = 2.42
  assert.equal(result.feeBreakdown.regulatory, 0);
  assert.equal(result.feeBreakdown.offsiteAds, 7.95); // 53 * 15% = 7.95
  assert.equal(result.metadata.regulatory.rate, null);
  assert.equal(result.metadata.regulatory.status, "not_listed");
  assert.equal(result.totals.totalEtsyFees, 14.00);
});

test("Step 11B.12: OTHER Fallback — Generic USD Schedule", () => {
  const result = calculateOrderFees({
    country: "OTHER",
    itemPrice: 100,
    shipping: 20,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15
  });

  assert.equal(result.bases.transactionBase, 120);
  assert.equal(result.bases.currencyConversionBase, 120);
  assert.equal(result.feeBreakdown.listing, 0.20);
  assert.equal(result.feeBreakdown.transaction, 7.80); // 120 * 6.5% = 7.80
  assert.equal(result.feeBreakdown.processing, 8.10); // 120 * 6.5% + 0.30 = 8.10
  assert.equal(result.feeBreakdown.regulatory, 0);
  assert.equal(result.feeBreakdown.offsiteAds, 18.00); // 120 * 15% = 18.00
  assert.equal(result.metadata.regulatory.rate, null);
  assert.equal(result.totals.totalEtsyFees, 34.10);
});

// ============================================================================
// SUITE 2: SPECIFIC FEATURE TESTING
// Bases, Buyer Sales Tax, Currency Conversion, Offsite Ads Cap, Deposit Fee Helper
// ============================================================================

test("Step 11B.13: Explicit Fee Bases & Buyer Sales Tax Independence", () => {
  // $100 item + $20 shipping + $5 gift wrap + $10 buyer sales tax
  const res = calculateOrderFees({
    country: "US",
    itemPrice: 100,
    shipping: 20,
    giftWrap: 5,
    buyerSalesTax: 10
  });

  // transactionBase: 100 + 20 + 5 = 125
  assert.equal(res.bases.transactionBase, 125);
  // processingBase includes buyer sales tax: 100 + 20 + 5 + 10 = 135
  assert.equal(res.bases.processingBase, 135);
  // regulatoryBase excludes buyer sales tax: 100 + 20 + 5 = 125
  assert.equal(res.bases.regulatoryBase, 125);
  // offsiteAdsBase: 125
  assert.equal(res.bases.offsiteAdsBase, 125);
  // currencyConversionBase: 125
  assert.equal(res.bases.currencyConversionBase, 125);

  // Processing is charged on 135: 135 * 3% + 0.25 = 4.05 + 0.25 = 4.30
  assert.equal(res.feeBreakdown.processing, 4.30);
  // Transaction is charged on 125: 125 * 6.5% = 8.125 -> 8.13
  assert.equal(res.feeBreakdown.transaction, 8.13);
});

test("Step 11B.14: Currency Conversion Fee (2.5%) — Strictly When Currencies Differ", () => {
  // Scenario A: Currencies match (USD listing, USD payment account) -> 0% fee
  const matchRes = calculateOrderFees({
    country: "US",
    itemPrice: 100,
    listingCurrency: "USD",
    paymentAccountCurrency: "USD"
  });
  assert.equal(matchRes.feeBreakdown.currencyConversion, 0);

  // Scenario B: Caller omits paymentAccountCurrency -> defaults to matching currency -> 0% fee
  const defaultRes = calculateOrderFees({
    country: "US",
    itemPrice: 100
  });
  assert.equal(defaultRes.feeBreakdown.currencyConversion, 0);

  // Scenario C: Currencies differ (USD listing, CAD payout account) -> 2.5% fee
  const diffRes = calculateOrderFees({
    country: "US",
    itemPrice: 100,
    shipping: 20,
    listingCurrency: "USD",
    paymentAccountCurrency: "CAD"
  });
  // 120 * 2.5% = 3.00
  assert.equal(diffRes.bases.currencyConversionBase, 120);
  assert.equal(diffRes.feeBreakdown.currencyConversion, 3.00);
  assert.equal(diffRes.totals.totalEtsyFees, 0.20 + 7.80 + 3.85 + 3.00); // listing + trans + proc + fx = 14.85
});

test("Step 11B.15: Offsite Ads Tiers (15% vs 12%) and $100 USD-Equivalent Cap", () => {
  // Scenario A: 15% tier below cap in USD
  const res15 = calculateOrderFees({
    country: "US",
    itemPrice: 200,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15
  });
  assert.equal(res15.feeBreakdown.offsiteAds, 30.00); // 200 * 15%

  // Scenario B: 12% tier below cap in USD
  const res12 = calculateOrderFees({
    country: "US",
    itemPrice: 200,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.12
  });
  assert.equal(res12.feeBreakdown.offsiteAds, 24.00); // 200 * 12%

  // Scenario C: High USD order hitting $100 USD statutory cap ($1,000 order * 15% = $150 -> capped at $100)
  const cappedRes = calculateOrderFees({
    country: "US",
    itemPrice: 1000,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15
  });
  assert.equal(cappedRes.feeBreakdown.offsiteAds, 100.00); // Capped at $100 USD

  // Scenario D: UK order (GBP) without caller-provided FX rate:
  // Must NOT invent an FX rate or pretend £80 is a statutory cap.
  // Returns uncapped 15% (150 GBP) and exposes authoritative USD 100 equivalent in metadata.
  const ukNoFx = calculateOrderFees({
    country: "UK",
    itemPrice: 1000,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15
  });
  assert.equal(ukNoFx.feeBreakdown.offsiteAds, 150.00); // Uncapped calculation when FX is unknown
  assert.deepEqual(ukNoFx.metadata.offsiteAdsCap, { amount: 100, currency: "USD", type: "usd_equivalent" });

  // Scenario E: UK order WITH explicit caller-supplied FX rate (e.g. 0.78 GBP per USD):
  // Caps at 100 * 0.78 = 78.00 GBP
  const ukWithFx = calculateOrderFees({
    country: "UK",
    itemPrice: 1000,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15,
    usdExchangeRate: 0.78
  });
  assert.equal(ukWithFx.feeBreakdown.offsiteAds, 78.00);
});

test("Step 11B.16: Deposit Fee Helper Standalone Verification", () => {
  // 1. Unlisted schedule returns 0
  assert.equal(calculateDepositFee(1000, { mode: "not_listed" }), 0);
  assert.equal(calculateDepositFee(1000, null), 0);

  // 2. Indonesia (min 28000, threshold 1400000, fee 28000 IDR)
  const idSched = { mode: "listed", dailyDepositMinimum: 28000, feeThreshold: 1400000, fee: 28000 };
  assert.equal(calculateDepositFee(20000, idSched), 0);
  assert.equal(calculateDepositFee(28000, idSched), 0);
  assert.equal(calculateDepositFee(500000, idSched), 28000);
  assert.equal(calculateDepositFee(1400000, idSched), 0);
  assert.equal(calculateDepositFee(2000000, idSched), 0);

  // 3. Israel (min 7, threshold 350, fee 7 ILS)
  const ilSched = { mode: "listed", dailyDepositMinimum: 7, feeThreshold: 350, fee: 7 };
  assert.equal(calculateDepositFee(5, ilSched), 0);
  assert.equal(calculateDepositFee(100, ilSched), 7);
  assert.equal(calculateDepositFee(400, ilSched), 0);

  // 4. Mexico (min 40, threshold 2000, fee 40 MXN)
  const mxSched = { mode: "listed", dailyDepositMinimum: 40, feeThreshold: 2000, fee: 40 };
  assert.equal(calculateDepositFee(30, mxSched), 0);
  assert.equal(calculateDepositFee(1000, mxSched), 40);
  assert.equal(calculateDepositFee(3000, mxSched), 0);

  // 5. South Africa (min 35, threshold 1500, fee 30 ZAR)
  const zaSched = { mode: "listed", dailyDepositMinimum: 35, feeThreshold: 1500, fee: 30 };
  assert.equal(calculateDepositFee(20, zaSched), 0);
  assert.equal(calculateDepositFee(500, zaSched), 30);
  assert.equal(calculateDepositFee(2000, zaSched), 0);

  // 6. Philippines (min 100, threshold 5000, fee 100 PHP)
  const phSched = { mode: "listed", dailyDepositMinimum: 100, feeThreshold: 5000, fee: 100 };
  assert.equal(calculateDepositFee(50, phSched), 0);
  assert.equal(calculateDepositFee(2000, phSched), 100);
  assert.equal(calculateDepositFee(6000, phSched), 0);
});

// ============================================================================
// SUITE 3: STEP 11B.1 SPECIFIC DETERMINISTIC PRECISION TESTS
// Proves Offsite Ads cap = USD 100 equivalent, no hard-coded local caps,
// no invented FX rate, and deterministic currencyConversionBase.
// ============================================================================

test("Step 11B.1.1: Offsite Ads Cap is Stored Authoritatively as USD 100 Equivalent", () => {
  assert.deepEqual(STATUTORY_OFFSITE_ADS_CAP, {
    amount: 100,
    currency: "USD",
    type: "usd_equivalent"
  });

  // Verify that ZERO countries in GLOBAL_COUNTRY_RULES contain a hard-coded offsiteCap
  for (const [code, rule] of Object.entries(GLOBAL_COUNTRY_RULES)) {
    assert.equal(rule.offsiteCap, undefined, `Country ${code} must NOT contain a hard-coded offsiteCap`);
  }

  // Verify across diverse markets that output metadata exposes the exact USD-equivalent structure
  for (const code of ["US", "UK", "CA", "DE", "IN", "JP", "TR", "OTHER", "BG", "VN"]) {
    const res = calculateOrderFees({ country: code, itemPrice: 50 });
    assert.deepEqual(res.metadata.offsiteAdsCap, STATUTORY_OFFSITE_ADS_CAP);
    assert.deepEqual(res.informational.offsiteAdsCap, STATUTORY_OFFSITE_ADS_CAP);
  }
});

test("Step 11B.1.2: Deterministic currencyConversionBase & 2.5% Conversion Isolation", () => {
  // Test explicit currencyConversionBase presence
  const res = calculateOrderFees({
    country: "US",
    itemPrice: 80,
    shipping: 15,
    giftWrap: 5
  });
  // currencyConversionBase = 80 + 15 + 5 = 100
  assert.equal(res.bases.currencyConversionBase, 100);
  assert.equal(res.bases.transactionBase, 100);
  // Matching currency -> conversion fee is strictly 0
  assert.equal(res.feeBreakdown.currencyConversion, 0);

  // Currency mismatch -> exactly 2.5% of currencyConversionBase
  const mismatchRes = calculateOrderFees({
    country: "US",
    itemPrice: 80,
    shipping: 15,
    giftWrap: 5,
    listingCurrency: "USD",
    paymentAccountCurrency: "EUR"
  });
  assert.equal(mismatchRes.bases.currencyConversionBase, 100);
  assert.equal(mismatchRes.feeBreakdown.currencyConversion, 2.50); // 100 * 2.5% = 2.50

  // Caller override of currencyConversionBase
  const overrideRes = calculateOrderFees({
    country: "US",
    itemPrice: 80,
    shipping: 15,
    giftWrap: 5,
    listingCurrency: "USD",
    paymentAccountCurrency: "EUR",
    currencyConversionBase: 200
  });
  assert.equal(overrideRes.bases.currencyConversionBase, 200);
  assert.equal(overrideRes.feeBreakdown.currencyConversion, 5.00); // 200 * 2.5% = 5.00
});

// ============================================================================
// SUITE 4: LEGACY PARITY COMPARISON & CATEGORIZATION
// Compares fee engine against all 12 frozen baseline fixtures
// ============================================================================

test("Step 11B.17: Legacy Fixture Parity Audit Across All 12 Baseline Countries", () => {
  const parityAudit = {};

  for (const [code, fixture] of Object.entries(LEGACY_CALCULATOR_CASES)) {
    const res = calculateOrderFees({
      country: code,
      ...fixture.inputs
    });

    const exp = fixture.expected;
    const leg = res.legacy;

    // Verify exact equality on all 15 discrete metrics
    assert.equal(leg.grossCents, exp.grossCents, `${code} gross mismatch`);
    assert.equal(leg.listingCents, exp.listingCents, `${code} listing mismatch`);
    assert.equal(leg.transactionCents, exp.transactionCents, `${code} transaction mismatch`);
    assert.equal(leg.processingCents, exp.processingCents, `${code} processing mismatch`);
    assert.equal(leg.regulatoryCents, exp.regulatoryCents, `${code} regulatory mismatch`);
    assert.equal(leg.offsiteCents, exp.offsiteCents, `${code} offsite mismatch`);
    assert.equal(leg.productionCents, exp.productionCents, `${code} production mismatch`);
    assert.equal(leg.packagingCents, exp.packagingCents, `${code} packaging mismatch`);
    assert.equal(leg.plusCents, exp.plusCents, `${code} plus mismatch`);
    assert.equal(leg.feesCents, exp.feesCents, `${code} fees mismatch`);
    assert.equal(leg.costsCents, exp.costsCents, `${code} costs mismatch`);
    assert.equal(leg.netCents, exp.netCents, `${code} net mismatch`);
    assert.equal(leg.margin, exp.margin, `${code} margin mismatch`);
    assert.equal(leg.breakEvenCents, exp.breakEvenCents, `${code} breakEven mismatch`);
    assert.equal(leg.keptPer100Cents, exp.keptPer100Cents, `${code} keptPer100 mismatch`);

    parityAudit[code] = {
      status: "MATCH",
      currency: res.metadata.currency,
      netCents: leg.netCents,
      feesCents: leg.feesCents
    };
  }

  // Exactly 12 markets audited and matched 100%
  assert.equal(Object.keys(parityAudit).length, 12);
});
