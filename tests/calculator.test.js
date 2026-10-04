import test from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, COUNTRY_ORDER, countryFromTimeZone } from "../src/countries.js";
import { asCents, calculateGrossRevenue, calculateRequiredPrice, calculateSale, formatMoney } from "../src/calculator.js";
import { languageForRegion } from "../src/translations.js";

const sale = (overrides = {}) => calculateSale({ itemPrice: 35, shipping: 5, production: 7, packaging: 4, country: COUNTRIES.US, ...overrides });

test("default US sale calculates each fee in integer cents", () => {
  const result = sale();
  assert.equal(result.grossCents, 4000);
  assert.equal(result.listingCents, 20);
  assert.equal(result.transactionCents, 260);
  assert.equal(result.processingCents, 145);
  assert.equal(result.regulatoryCents, 0);
  assert.equal(result.feesCents, 425);
  assert.equal(result.netCents, 2475);
  assert.equal(result.costsCents, 1100);
  assert.equal(result.margin, 2475 / 4000);
});

test("low-value, zero-shipping, zero-cost and digital-style sales remain consistent", () => {
  const penny = calculateSale({ itemPrice: 0.01, shipping: 0, production: 0, packaging: 0, country: COUNTRIES.US });
  assert.equal(penny.grossCents, 1);
  assert.equal(penny.netCents, -44);
  const digital = calculateSale({ itemPrice: 25, shipping: 0, production: 0, packaging: 0, country: COUNTRIES.US });
  assert.equal(digital.grossCents, 2500);
  assert.equal(digital.productionCents + digital.packagingCents, 0);
  assert.equal(digital.netCents, digital.grossCents - digital.feesCents - digital.costsCents);
});

test("empty and zero sales never produce NaN or Infinity", () => {
  assert.equal(calculateGrossRevenue("", ""), 0);
  assert.equal(calculateGrossRevenue(Infinity, NaN), 9_999_999_999);
  assert.equal(calculateGrossRevenue(-10, -2), 0);
  const result = sale({ itemPrice: 0, shipping: 0, production: 0, packaging: 0 });
  for (const value of Object.values(result)) assert.ok(Number.isFinite(value));
  assert.equal(result.margin, 0);
});

test("large values remain finite and round safely", () => {
  const result = sale({ itemPrice: 99_999_999, shipping: 99_999_999, production: 99_999_999, packaging: 99_999_999 });
  for (const value of Object.values(result)) assert.ok(Number.isFinite(value));
});

test("decimal currency inputs round predictably and format without false JPY decimals", () => {
  assert.equal(asCents(1.005), 101);
  assert.equal(asCents(1.01), 101);
  assert.match(formatMoney(123_500, COUNTRIES.JP), /￥?1,235|¥1,235/);
  assert.doesNotMatch(formatMoney(123_500, COUNTRIES.JP), /\.00/);
  assert.match(formatMoney(123_450, COUNTRIES.US), /1,234\.50/);
});

test("Offsite Ads rate is charged on the order and capped per country", () => {
  const result = sale({ offsiteRate: 0.15, itemPrice: 1000, shipping: 0, production: 0, packaging: 0 });
  assert.equal(result.offsiteCents, 10000);
  assert.equal(sale({ offsiteRate: 0.12 }).offsiteCents, 480);
});

test("regulatory fee changes with seller country", () => {
  const france = calculateSale({ itemPrice: 100, shipping: 0, production: 0, packaging: 0, country: COUNTRIES.FR });
  assert.equal(france.regulatoryCents, 114);
  const us = sale({ itemPrice: 100, shipping: 0, production: 0, packaging: 0 });
  assert.equal(us.regulatoryCents, 0);
});

test("Etsy Plus is prorated by estimated monthly sale count", () => {
  const once = sale({ plus: true, salesPerMonth: 10 });
  const twice = sale({ plus: true, salesPerMonth: 20 });
  assert.equal(once.plusCents, 100);
  assert.equal(twice.plusCents, 50);
});

test("country settings retain configured currency and fee assumptions", () => {
  const expected = {
    US: ["USD", 0.20, 0.03, 0.25, 0], UK: ["GBP", 0.16, 0.04, 0.20, 0.0048],
    CA: ["CAD", 0.27, 0.03, 0.25, 0.005], AU: ["AUD", 0.28, 0.03, 0.25, 0],
    DE: ["EUR", 0.18, 0.04, 0.30, 0], FR: ["EUR", 0.18, 0.04, 0.30, 0.0114],
    IT: ["EUR", 0.18, 0.04, 0.30, 0.008], ES: ["EUR", 0.18, 0.04, 0.30, 0.0088],
    IN: ["INR", 16.5, 0.05, 25, 0.0005], JP: ["JPY", 30, 0.06, 45, 0],
    TR: ["TRY", 7, 0.065, 14, 0.0167], OTHER: ["USD", 0.20, 0.065, 0.30, 0],
  };
  for (const [code, [currency, listing, rate, fixed, regulatory]] of Object.entries(expected)) {
    const country = COUNTRIES[code];
    assert.equal(country.currency, currency, `${code} currency`);
    assert.equal(country.listingFee, listing, `${code} listing fee`);
    assert.equal(country.processingRate, rate, `${code} processing rate`);
    assert.equal(country.processingFixed, fixed, `${code} processing fixed fee`);
    assert.equal(country.regulatoryRate, regulatory, `${code} regulatory rate`);
    const result = calculateSale({ itemPrice: 100, shipping: 0, production: 0, packaging: 0, country });
    assert.equal(result.feesCents, result.listingCents + result.transactionCents + result.processingCents + result.regulatoryCents + result.offsiteCents);
    assert.equal(result.netCents, result.grossCents - result.feesCents - result.costsCents);
  }
});

test("Canada and Australia expose only their published default domestic processing model", () => {
  assert.equal(COUNTRIES.CA.processingRate, 0.03);
  assert.equal(COUNTRIES.CA.processingFixed, 0.25);
  assert.match(COUNTRIES.CA.processingNote, /international orders are 4%/);
  assert.equal(COUNTRIES.AU.processingRate, 0.03);
  assert.equal(COUNTRIES.AU.processingFixed, 0.25);
  assert.match(COUNTRIES.AU.processingNote, /international orders are 4%/);
  assert.match(COUNTRIES.JP.processingNote, /USD.*estimate/);
  assert.match(COUNTRIES.OTHER.processingNote, /not a country-specific/);
});

test("locale formatting uses the country's currency and grouping conventions", () => {
  assert.match(formatMoney(123456, COUNTRIES.US), /\$1,234\.56/);
  assert.match(formatMoney(123456, COUNTRIES.IN), /₹1,234\.56/);
  assert.match(formatMoney(12345678, COUNTRIES.IN), /₹1,23,456\.78/);
  assert.match(formatMoney(123456, COUNTRIES.UK), /£1,234\.56/);
  assert.doesNotMatch(formatMoney(123500, COUNTRIES.JP), /\.00/);
});

test("break-even and target-profit helpers return finite cent values", () => {
  const result = sale();
  assert.equal(result.breakEvenCents, 765);
  assert.ok(result.breakEvenCents >= 0);
  const adBreakEvenCents = sale({ offsiteRate: 0.15 }).breakEvenCents;
  const breakEven = sale({ itemPrice: adBreakEvenCents / 100, offsiteRate: 0.15 });
  assert.ok(breakEven.netCents >= 0);
  assert.ok(sale({ itemPrice: (adBreakEvenCents - 1) / 100, offsiteRate: 0.15 }).netCents < 0);
  const required = calculateRequiredPrice({ targetProfit: 25, shipping: 5, country: COUNTRIES.US, production: 7, packaging: 4 });
  assert.equal(required, 3528);
  assert.ok(required > 0);
  const atRequired = calculateSale({ itemPrice: required / 100, shipping: 5, production: 7, packaging: 4, country: COUNTRIES.US });
  assert.ok(atRequired.netCents >= 2500);
  const adRequired = calculateRequiredPrice({ targetProfit: 25, shipping: 5, country: COUNTRIES.US, production: 7, packaging: 4, offsiteRate: 0.15 });
  assert.ok(sale({ itemPrice: adRequired / 100, offsiteRate: 0.15 }).netCents >= 2500);
});

test("country list and timezone detection have safe fallbacks", () => {
  assert.equal(COUNTRY_ORDER.length, 12);
  assert.equal(countryFromTimeZone("Asia/Calcutta"), "IN");
  assert.equal(countryFromTimeZone("unknown/zone"), "OTHER");
});

test("automatic language selection follows supported regions and browser preference", () => {
  assert.equal(languageForRegion("IN"), "hi-IN");
  assert.equal(languageForRegion("OTHER", "Asia/Shanghai"), "zh-CN");
  assert.equal(languageForRegion("US", "", "fr-CA"), "fr-FR");
  assert.equal(languageForRegion("JP", "Asia/Tokyo", "en-US"), "ja-JP");
  assert.equal(languageForRegion("US", "", "ja-JP"), "ja-JP");
  assert.equal(languageForRegion("US", "", "pt-BR"), "en");
});

test("all supported countries and Offsite Ads rates produce a reachable break-even price", () => {
  for (const code of COUNTRY_ORDER) {
    for (const offsiteRate of [0, 0.12, 0.15]) {
      const base = { itemPrice: 35, shipping: 5, production: 7, packaging: 4, country: COUNTRIES[code], offsiteRate };
      const breakEven = calculateSale(base).breakEvenCents;
      assert.ok(calculateSale({ ...base, itemPrice: breakEven / 100 }).netCents >= 0, `${code} break-even is profitable`);
      if (breakEven > 0) assert.ok(calculateSale({ ...base, itemPrice: (breakEven - 1) / 100 }).netCents < 0, `${code} one cent below break-even loses money`);
      const targetPrice = calculateRequiredPrice({ ...base, targetProfit: 25 });
      assert.ok(calculateSale({ ...base, itemPrice: targetPrice / 100 }).netCents >= 2500, `${code} can reach the target profit`);
    }
  }
});
