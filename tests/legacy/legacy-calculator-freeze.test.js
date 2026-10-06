import assert from "node:assert/strict";
import test from "node:test";
import { COUNTRIES, COUNTRY_ORDER, countryFromTimeZone } from "./countries.js";
import { calculateSale, asCents, formatMoney, calculateRequiredPrice, TRANSACTION_RATE } from "./calculator.js";
import { LEGACY_CALCULATOR_CASES } from "../fixtures/legacy-calculator-cases.js";

test("Step 11A.1: Legacy model inventory: Exactly 12 countries in COUNTRY_ORDER", () => {
  assert.equal(COUNTRY_ORDER.length, 12);
  assert.deepEqual(COUNTRY_ORDER, [
    "US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP", "TR", "OTHER"
  ]);
});

test("Step 11A.2: Legacy model timezone resolution & fallback to OTHER", () => {
  assert.equal(countryFromTimeZone("America/New_York"), "US");
  assert.equal(countryFromTimeZone("Europe/London"), "UK");
  assert.equal(countryFromTimeZone("America/Toronto"), "CA");
  assert.equal(countryFromTimeZone("Australia/Sydney"), "AU");
  assert.equal(countryFromTimeZone("Europe/Berlin"), "DE");
  assert.equal(countryFromTimeZone("Europe/Paris"), "FR");
  assert.equal(countryFromTimeZone("Europe/Rome"), "IT");
  assert.equal(countryFromTimeZone("Europe/Madrid"), "ES");
  assert.equal(countryFromTimeZone("Asia/Kolkata"), "IN");
  assert.equal(countryFromTimeZone("Asia/Tokyo"), "JP");
  assert.equal(countryFromTimeZone("Europe/Istanbul"), "TR");
  assert.equal(countryFromTimeZone("Africa/Cairo"), "OTHER");
  assert.equal(countryFromTimeZone("Unknown/Zone"), "OTHER");
  assert.equal(countryFromTimeZone(""), "OTHER");
});

test("Step 11A.3: All 12 baseline legacy calculator test fixtures match calculateSale() 100%", () => {
  for (const [code, testCase] of Object.entries(LEGACY_CALCULATOR_CASES)) {
    const country = COUNTRIES[code];
    assert.ok(country, `Missing country definition for ${code}`);
    
    const result = calculateSale({
      ...testCase.inputs,
      country
    });

    const exp = testCase.expected;
    assert.equal(result.grossCents, exp.grossCents, `${code} grossCents mismatch`);
    assert.equal(result.listingCents, exp.listingCents, `${code} listingCents mismatch`);
    assert.equal(result.transactionCents, exp.transactionCents, `${code} transactionCents mismatch`);
    assert.equal(result.processingCents, exp.processingCents, `${code} processingCents mismatch`);
    assert.equal(result.regulatoryCents, exp.regulatoryCents, `${code} regulatoryCents mismatch`);
    assert.equal(result.offsiteCents, exp.offsiteCents, `${code} offsiteCents mismatch`);
    assert.equal(result.productionCents, exp.productionCents, `${code} productionCents mismatch`);
    assert.equal(result.packagingCents, exp.packagingCents, `${code} packagingCents mismatch`);
    assert.equal(result.plusCents, exp.plusCents, `${code} plusCents mismatch`);
    assert.equal(result.feesCents, exp.feesCents, `${code} feesCents mismatch`);
    assert.equal(result.costsCents, exp.costsCents, `${code} costsCents mismatch`);
    assert.equal(result.netCents, exp.netCents, `${code} netCents mismatch`);
    assert.equal(result.margin, exp.margin, `${code} margin mismatch`);
    assert.equal(result.breakEvenCents, exp.breakEvenCents, `${code} breakEvenCents mismatch`);
  }
});

test("Step 11A.4: Reverse required price calculation matches across all 12 baseline countries", () => {
  for (const [code, testCase] of Object.entries(LEGACY_CALCULATOR_CASES)) {
    const country = COUNTRIES[code];
    const targetProfit = 25; // standard target profit: 25 currency units
    const requiredCents = calculateRequiredPrice({
      ...testCase.inputs,
      targetProfit,
      country
    });

    const atRequired = calculateSale({
      ...testCase.inputs,
      itemPrice: requiredCents / 100,
      country
    });

    assert.ok(
      atRequired.netCents >= targetProfit * 100,
      `${code} required price must reach target profit`
    );
  }
});
