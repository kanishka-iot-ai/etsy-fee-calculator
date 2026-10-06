import assert from "node:assert/strict";
import test from "node:test";
import {
  FeeIntelligenceClient,
  EXPECTED_VERSION_ID,
  getCachedFees,
  setCachedFees,
  clearCachedFees,
  FEE_CACHE_KEY,
  FEE_CACHE_TTL_MS
} from "../src/fee-intelligence-client.js";
import {
  calculateOrderFees,
  solveRequiredPrice,
  resolveCountryFeeRule,
  STATUTORY_OFFSITE_ADS_CAP
} from "../src/fee-engine.js";
import { V1_1_1_API_FIXTURE, V1_1_1_COUNTRY_ORDER } from "./fixtures/v1.1.1-api-fixture.js";
import { LEGACY_CALCULATOR_CASES } from "./fixtures/legacy-calculator-cases.js";
import { COUNTRIES } from "./legacy/countries.js";
import { calculateSale, calculateRequiredPrice } from "./legacy/calculator.js";

function compareLegacyVsNewCalculation(countryCode, inputs = {}) {
  const code = (countryCode || "US").toUpperCase();
  const legacyCountry = COUNTRIES[code] || COUNTRIES.OTHER;
  const legacyState = {
    itemPrice: inputs.itemPrice ?? 35,
    shipping: inputs.shipping ?? 5,
    production: inputs.production ?? 7,
    packaging: inputs.packaging ?? 4,
    country: legacyCountry,
    offsiteRate: inputs.offsiteRate ?? 0,
    plus: inputs.plus ?? false,
    salesPerMonth: inputs.salesPerMonth ?? 30
  };
  const legacyResult = calculateSale(legacyState);
  const legacyReq = calculateRequiredPrice({ ...legacyState, targetProfit: inputs.targetProfit ?? 25 });

  const norm = resolveCountryFeeRule(code, { orderType: inputs.orderType });
  const newResult = calculateOrderFees({
    country: norm,
    itemPrice: inputs.itemPrice ?? 35,
    shipping: inputs.shipping ?? 5,
    production: inputs.production ?? 7,
    packaging: inputs.packaging ?? 4,
    offsiteAds: (inputs.offsiteRate ?? 0) > 0,
    shopOffsiteAdsTier: inputs.offsiteRate ?? 0,
    plusEnabled: inputs.plus ?? false,
    salesPerMonth: inputs.salesPerMonth ?? 30,
    orderType: inputs.orderType ?? "domestic",
    listingCurrency: norm.country ? norm.country.currency : norm.currency,
    paymentAccountCurrency: inputs.paymentAccountCurrency || (norm.country ? norm.country.currency : norm.currency)
  });
  const newReq = solveRequiredPrice(inputs.targetProfit ?? 25, {
    country: norm,
    shipping: inputs.shipping ?? 5,
    production: inputs.production ?? 7,
    packaging: inputs.packaging ?? 4,
    offsiteAds: (inputs.offsiteRate ?? 0) > 0,
    shopOffsiteAdsTier: inputs.offsiteRate ?? 0,
    plusEnabled: inputs.plus ?? false,
    salesPerMonth: inputs.salesPerMonth ?? 30,
    orderType: inputs.orderType ?? "domestic",
    listingCurrency: norm.country ? norm.country.currency : norm.currency,
    paymentAccountCurrency: inputs.paymentAccountCurrency || (norm.country ? norm.country.currency : norm.currency)
  });

  const leg = legacyResult;
  const nleg = newResult.legacy;

  let classification = "MATCH";
  if (inputs.orderType === "international" && ["CA", "AU", "NZ"].includes(code)) {
    classification = "INTENTIONAL IMPROVEMENT";
  } else if (inputs.paymentAccountCurrency && inputs.paymentAccountCurrency !== (norm.country ? norm.country.currency : norm.currency)) {
    classification = "NEWLY MODELED";
  } else if (!COUNTRIES[code]) {
    classification = "NEWLY MODELED";
  } else {
    const isExact = (
      leg.grossCents === nleg.grossCents &&
      leg.listingCents === nleg.listingCents &&
      leg.transactionCents === nleg.transactionCents &&
      leg.processingCents === nleg.processingCents &&
      leg.regulatoryCents === nleg.regulatoryCents &&
      leg.offsiteCents === nleg.offsiteCents &&
      leg.plusCents === nleg.plusCents &&
      leg.feesCents === nleg.feesCents &&
      leg.netCents === nleg.netCents &&
      leg.breakEvenCents === nleg.breakEvenCents &&
      legacyReq === newReq
    );
    classification = isExact ? "MATCH" : "LEGACY LIMITATION";
  }

  return {
    country: code,
    classification,
    legacy: { ...leg, requiredPriceCents: legacyReq },
    newEngine: { ...nleg, requiredPriceCents: newReq, newResult }
  };
}

/**
 * Deterministic in-memory storage mock simulating localStorage.
 */
function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, val) => map.set(key, String(val)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    get: (key) => (map.has(key) ? map.get(key) : null),
    set: (key, val) => map.set(key, String(val)),
    remove: (key) => map.delete(key),
    _map: map
  };
}

/**
 * Creates an offline client backed by the deterministic v1.1.1 fixture.
 */
function createFixtureClient(fixture = V1_1_1_API_FIXTURE, options = {}) {
  const mockFetch = async (url) => {
    const urlObj = new URL(url);
    if (urlObj.pathname.startsWith("/v1/fees/")) {
      const code = urlObj.pathname.split("/").pop().toUpperCase();
      const countryData = fixture.countries[code];
      if (!countryData) {
        return { ok: false, status: 404, statusText: "Not Found", json: async () => ({ error: "Country not found" }) };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          version: fixture.version,
          version_id: fixture.version_id,
          publishedAt: fixture.publishedAt,
          country: countryData
        })
      };
    }
    if (urlObj.pathname === "/v1/fees") {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => fixture
      };
    }
    return { ok: false, status: 404, statusText: "Not Found", json: async () => ({ error: "Route not found" }) };
  };

  return new FeeIntelligenceClient("https://mock.etsy-intelligence.local", {
    fetch: mockFetch,
    ...options
  });
}

// ============================================================================
// SUITE 1: 14 SPECIFIC MARKET CALCULATIONS (STEP 15)
// ============================================================================

test("Step 11D.1: US calculation via new fee engine", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("US");

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 35,
    shipping: 5,
    production: 7,
    packaging: 4
  });

  assert.equal(result.legacy.grossCents, 4000);
  assert.equal(result.legacy.listingCents, 20);
  assert.equal(result.legacy.transactionCents, 260); // 4000 * 6.5% = 260
  assert.equal(result.legacy.processingCents, 145);  // 4000 * 3.0% + 25 = 145
  assert.equal(result.legacy.regulatoryCents, 0);
  assert.equal(result.legacy.feesCents, 425);
  assert.equal(result.legacy.costsCents, 1100);
  assert.equal(result.legacy.netCents, 2475);
  assert.equal(result.legacy.breakEvenCents, 765);
});

test("Step 11D.2: UK calculation via new fee engine (GBP, regulatory 0.48%)", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("UK");

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 50,
    shipping: 10,
    production: 12,
    packaging: 3
  });

  assert.equal(result.metadata.currency, "GBP");
  assert.equal(result.legacy.grossCents, 6000);
  assert.equal(result.legacy.listingCents, 16);
  assert.equal(result.legacy.transactionCents, 390); // 6000 * 6.5% = 390
  assert.equal(result.legacy.processingCents, 260);  // 6000 * 4.0% + 20 = 260
  assert.equal(result.legacy.regulatoryCents, 29);   // 6000 * 0.48% = 28.8 -> 29
  assert.equal(result.metadata.regulatory.rate, 0.0048);
});

test("Step 11D.3: CA domestic calculation (CAD, domestic 3% + 0.25, reg 0.5%)", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("CA", { orderType: "domestic" });

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 100,
    shipping: 20,
    orderType: "domestic"
  });

  assert.equal(result.metadata.currency, "CAD");
  assert.equal(result.legacy.listingCents, 27);
  assert.equal(result.legacy.transactionCents, 780); // 12000 * 6.5% = 780
  assert.equal(result.legacy.processingCents, 385);  // 12000 * 3.0% + 25 = 385
  assert.equal(result.legacy.regulatoryCents, 60);   // 12000 * 0.50% = 60
});

test("Step 11D.4: CA international calculation (CAD, intl 4% + 0.25, reg 0.5%)", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("CA", { orderType: "international" });

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 100,
    shipping: 20,
    orderType: "international"
  });

  assert.equal(result.metadata.currency, "CAD");
  assert.equal(result.legacy.listingCents, 27);
  assert.equal(result.legacy.transactionCents, 780);
  assert.equal(result.legacy.processingCents, 505);  // 12000 * 4.0% + 25 = 505
  assert.equal(result.legacy.regulatoryCents, 60);
});

test("Step 11D.5: AU domestic calculation (AUD, domestic 3% + 0.25)", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("AU", { orderType: "domestic" });

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 100,
    shipping: 0,
    orderType: "domestic"
  });

  assert.equal(result.metadata.currency, "AUD");
  assert.equal(result.legacy.listingCents, 28);
  assert.equal(result.legacy.transactionCents, 650); // 10000 * 6.5% = 650
  assert.equal(result.legacy.processingCents, 325);  // 10000 * 3.0% + 25 = 325
  assert.equal(result.metadata.regulatory.rate, null);
});

test("Step 11D.6: AU international calculation (AUD, intl 4% + 0.25)", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("AU", { orderType: "international" });

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 100,
    shipping: 0,
    orderType: "international"
  });

  assert.equal(result.metadata.currency, "AUD");
  assert.equal(result.legacy.listingCents, 28);
  assert.equal(result.legacy.transactionCents, 650);
  assert.equal(result.legacy.processingCents, 425);  // 10000 * 4.0% + 25 = 425
});

test("Step 11D.7: NZ domestic calculation (NZD, domestic 3% + 0.30)", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("NZ", { orderType: "domestic" });

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 100,
    shipping: 10,
    orderType: "domestic"
  });

  assert.equal(result.metadata.currency, "NZD");
  assert.equal(result.legacy.listingCents, 30);
  assert.equal(result.legacy.transactionCents, 715); // 11000 * 6.5% = 715
  assert.equal(result.legacy.processingCents, 360);  // 11000 * 3.0% + 30 = 360
});

test("Step 11D.8: NZ international calculation (NZD, intl 4% + 0.30)", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("NZ", { orderType: "international" });

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 100,
    shipping: 10,
    orderType: "international"
  });

  assert.equal(result.metadata.currency, "NZD");
  assert.equal(result.legacy.listingCents, 30);
  assert.equal(result.legacy.transactionCents, 715);
  assert.equal(result.legacy.processingCents, 470);  // 11000 * 4.0% + 30 = 470
});

test("Step 11D.9: IN calculation (INR, Payoneer, reg 0.05%, setup fee $10 metadata)", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("IN");

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 1000,
    shipping: 200
  });

  assert.equal(result.metadata.currency, "INR");
  assert.equal(result.legacy.listingCents, 1650); // 16.5 INR = 1650 paise
  assert.equal(result.legacy.transactionCents, 7800); // 120000 * 6.5% = 7800
  assert.equal(result.legacy.processingCents, 8500);  // 120000 * 5.0% + 2500 = 8500
  assert.equal(result.legacy.regulatoryCents, 60);    // 120000 * 0.05% = 60
  assert.equal(result.informational.payoneer, true);
  assert.equal(result.informational.setupFee.amount, 10);
  assert.equal(result.informational.setupFee.currency, "USD");
});

test("Step 11D.10: JP calculation (JPY, zero minor decimals)", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("JP");

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 5000,
    shipping: 1000
  });

  assert.equal(result.metadata.currency, "JPY");
  assert.equal(result.minorUnits.listingFee, 30);
  assert.equal(result.minorUnits.transactionFee, 390); // 6000 * 6.5% = 390
  assert.equal(result.minorUnits.processingFee, 405);  // 6000 * 6.0% + 45 = 405
  assert.equal(result.informational.payoneer, true);
});

test("Step 11D.11: TR calculation (TRY, reg 1.67%, statutory deposit metadata)", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("TR");

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 500,
    shipping: 50
  });

  assert.equal(result.metadata.currency, "TRY");
  assert.equal(result.legacy.listingCents, 700);
  assert.equal(result.legacy.transactionCents, 3575); // 55000 * 6.5% = 3575
  assert.equal(result.legacy.processingCents, 4975);  // 55000 * 6.5% + 1400 = 4975
  assert.equal(result.legacy.regulatoryCents, 919);   // 55000 * 1.67% = 918.5 -> 919
  assert.equal(result.informational.depositSchedule.mode, "listed");
  assert.equal(result.informational.depositSchedule.fee.amount, 42);
  assert.equal(result.informational.depositSchedule.feeThreshold.amount, 600);
});

test("Step 11D.12: BG calculation (EUR payout, euroArea=true, bankFxPossibility=true)", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("BG");

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 50,
    shipping: 10
  });

  assert.equal(result.metadata.currency, "EUR");
  assert.equal(result.metadata.payoutCurrency, "EUR");
  assert.equal(result.informational.bankFxPossibility, true);
  assert.equal(result.metadata.regulatory.rate, null);
  assert.equal(result.metadata.regulatory.status, "not_listed");
  assert.equal(result.legacy.regulatoryCents, 0);
});

test("Step 11D.13: VN calculation (VND, reg 1.24%, statutory deposit 45000 VND)", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("VN");

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 500000,
    shipping: 50000
  });

  assert.equal(result.metadata.currency, "VND");
  assert.equal(result.minorUnits.listingFee, 5000);
  assert.equal(result.minorUnits.transactionFee, 35750); // 550000 * 6.5% = 35750
  assert.equal(result.minorUnits.processingFee, 36250);  // 550000 * 4.5% + 11500 = 36250
  assert.equal(result.minorUnits.regulatoryFee, 6820);   // 550000 * 1.24% = 6820
  assert.equal(result.informational.depositSchedule.mode, "listed");
  assert.equal(result.informational.depositSchedule.fee.amount, 45000);
});

test("Step 11D.14: OTHER fallback calculation (USD, global default rates)", async () => {
  const client = createFixtureClient();
  const schedule = await client.getNormalizedFeeSchedule("OTHER");

  const result = calculateOrderFees({
    country: schedule,
    itemPrice: 35,
    shipping: 5
  });

  assert.equal(result.metadata.currency, "USD");
  assert.equal(result.legacy.listingCents, 20);
  assert.equal(result.legacy.transactionCents, 260); // 4000 * 6.5% = 260
  assert.equal(result.legacy.processingCents, 290);  // 4000 * 6.5% + 30 = 290
  assert.equal(result.metadata.regulatory.rate, null);
});

// ============================================================================
// SUITE 2: COUNTRY SELECTOR & POPULATION (STEP 3 & 4)
// ============================================================================

test("Step 11D.15: Country selector populated with all 62 v1.1.1 countries", async () => {
  const client = createFixtureClient();
  const { schedules, countryOrder } = await client.loadAllNormalizedFeeSchedules();

  assert.equal(countryOrder.length, 62);
  assert.equal(schedules.size, 62);
  assert.ok(schedules.has("BG"), "Includes Bulgaria");
  assert.ok(schedules.has("OTHER"), "Includes OTHER fallback");

  // Verify sensible names and currencies for every entry
  for (const code of countryOrder) {
    const s = schedules.get(code);
    assert.ok(s.country.name && s.country.name.length > 0, `${code} has non-empty name`);
    assert.ok(s.country.currency && s.country.currency.length === 3, `${code} has 3-letter currency`);
  }
});

// ============================================================================
// SUITE 3: API LOADING, CACHING & ERROR HANDLING (STEPS 6, 7, 8)
// ============================================================================

test("Step 11D.16: API loading and cache hit behavior", async () => {
  let networkFetchCount = 0;
  const mockFetch = async () => {
    networkFetchCount++;
    return {
      ok: true,
      status: 200,
      json: async () => V1_1_1_API_FIXTURE
    };
  };

  const client = new FeeIntelligenceClient("https://mock.etsy.test", { fetch: mockFetch });
  const storage = createMemoryStorage();

  // First call -> loads from network, writes to cache
  const first = await client.loadFees({ storage });
  assert.equal(first.fromCache, false);
  assert.equal(networkFetchCount, 1);
  assert.ok(storage.get(FEE_CACHE_KEY), "Cache entry created in storage");

  // Second call -> returns from cache, zero network calls
  const second = await client.loadFees({ storage });
  assert.equal(second.fromCache, true);
  assert.equal(networkFetchCount, 1);
  assert.equal(second.payload.version_id, "v1.1.1");
});

test("Step 11D.17: Cache TTL expiration triggers fresh fetch", async () => {
  let networkFetchCount = 0;
  const mockFetch = async () => {
    networkFetchCount++;
    return {
      ok: true,
      status: 200,
      json: async () => V1_1_1_API_FIXTURE
    };
  };

  const client = new FeeIntelligenceClient("https://mock.etsy.test", { fetch: mockFetch });
  const storage = createMemoryStorage();

  let virtualTime = 1000000;
  const timeFn = () => virtualTime;

  // Initial load
  await client.loadFees({ storage, now: timeFn });
  assert.equal(networkFetchCount, 1);

  // Advance time past 1 hour TTL
  virtualTime += FEE_CACHE_TTL_MS + 1000;

  // Next load detects expiration and re-fetches
  const expiredLoad = await client.loadFees({ storage, now: timeFn });
  assert.equal(expiredLoad.fromCache, false);
  assert.equal(networkFetchCount, 2);
});

test("Step 11D.18: Stale version cache invalidation", async () => {
  const storage = createMemoryStorage();
  // Plant stale v1.0.0 cache
  storage.set(FEE_CACHE_KEY, JSON.stringify({
    version_id: "v1.0.0",
    timestamp: Date.now(),
    payload: { ...V1_1_1_API_FIXTURE, version_id: "v1.0.0" }
  }));

  let networkFetchCount = 0;
  const mockFetch = async () => {
    networkFetchCount++;
    return { ok: true, status: 200, json: async () => V1_1_1_API_FIXTURE };
  };

  const client = new FeeIntelligenceClient("https://mock.etsy.test", { fetch: mockFetch });
  const res = await client.loadFees({ storage, expectedVersion: "v1.1.1" });

  assert.equal(res.fromCache, false);
  assert.equal(networkFetchCount, 1);
  assert.equal(res.payload.version_id, "v1.1.1");
});

test("Step 11D.19: API failure throws descriptive error and never silently falls back to stale data", async () => {
  const failingFetch = async () => ({
    ok: false,
    status: 503,
    statusText: "Service Unavailable"
  });

  const client = new FeeIntelligenceClient("https://mock.etsy.test", { fetch: failingFetch });
  const emptyStorage = createMemoryStorage();

  await assert.rejects(
    async () => client.loadFees({ storage: emptyStorage }),
    /Failed to fetch fee intelligence: HTTP 503 Service Unavailable/
  );
});

test("Step 11D.20: API version mismatch throws version error", async () => {
  const mismatchedFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ...V1_1_1_API_FIXTURE,
      version_id: "v1.2.0"
    })
  });

  const client = new FeeIntelligenceClient("https://mock.etsy.test", { fetch: mismatchedFetch });
  const storage = createMemoryStorage();

  await assert.rejects(
    async () => client.loadFees({ storage }),
    /Version mismatch: expected active fee version 'v1.1.1', but API returned 'v1.2.0'/
  );
});

// ============================================================================
// SUITE 4: OFFSITE ADS, ETSY PLUS & REGULATORY (STEPS 9, 10, 11)
// ============================================================================

test("Step 11D.21: Offsite Ads 15% tier and $100 USD-equivalent cap metadata", () => {
  const capped = calculateOrderFees({
    country: "US",
    itemPrice: 1000,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15
  });

  assert.equal(capped.feeBreakdown.offsiteAds, 100.00);
  assert.equal(capped.legacy.offsiteCents, 10000);
  assert.deepEqual(capped.metadata.offsiteAdsCap, STATUTORY_OFFSITE_ADS_CAP);

  const uncappedGbp = calculateOrderFees({
    country: "UK",
    itemPrice: 1000,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15
  });
  // In GBP without caller-provided FX rate, calculates uncapped and attaches USD-equivalent cap metadata
  assert.equal(uncappedGbp.feeBreakdown.offsiteAds, 150.00);
  assert.deepEqual(uncappedGbp.metadata.offsiteAdsCap, STATUTORY_OFFSITE_ADS_CAP);
});

test("Step 11D.22: Offsite Ads 12% high-volume seller tier", () => {
  const result = calculateOrderFees({
    country: "US",
    itemPrice: 200,
    shipping: 10,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.12
  });

  assert.equal(result.feeBreakdown.offsiteAds, 25.20); // 210 * 12% = 25.20
  assert.equal(result.legacy.offsiteCents, 2520);
});

test("Step 11D.23: Etsy Plus monthly subscription amortized across sales", () => {
  const plus30 = calculateOrderFees({
    country: "US",
    itemPrice: 50,
    plusEnabled: true,
    salesPerMonth: 30
  });

  // $10 USD / 30 = $0.3333 -> 33 cents
  assert.equal(plus30.legacy.plusCents, 33);
  assert.equal(plus30.feeBreakdown.etsyPlusAmortized, 0.33);

  const plus10 = calculateOrderFees({
    country: "US",
    itemPrice: 50,
    plusEnabled: true,
    salesPerMonth: 10
  });
  // $10 USD / 10 = $1.00 -> 100 cents
  assert.equal(plus10.legacy.plusCents, 100);
  assert.equal(plus10.feeBreakdown.etsyPlusAmortized, 1.00);
});

// ============================================================================
// SUITE 5: TARGET PRICE & BREAK-EVEN SOLVER (STEP 12)
// ============================================================================

test("Step 11D.24: Target pricing binary search solver parity with legacy solver", () => {
  for (const [code, fixture] of Object.entries(LEGACY_CALCULATOR_CASES)) {
    const legacyReq = calculateRequiredPrice({
      ...fixture.inputs,
      targetProfit: 25,
      country: COUNTRIES[code]
    });

    const newReq = solveRequiredPrice(25, {
      country: code,
      shipping: fixture.inputs.shipping,
      production: fixture.inputs.production,
      packaging: fixture.inputs.packaging,
      offsiteAds: fixture.inputs.offsiteRate > 0,
      shopOffsiteAdsTier: fixture.inputs.offsiteRate,
      plusEnabled: fixture.inputs.plus,
      salesPerMonth: fixture.inputs.salesPerMonth
    });

    assert.equal(newReq, legacyReq, `Target price mismatch for ${code}: legacy=${legacyReq}, new=${newReq}`);
  }
});

test("Step 11D.25: Break-even pricing parity with legacy solver across all 12 baseline markets", () => {
  for (const [code, fixture] of Object.entries(LEGACY_CALCULATOR_CASES)) {
    const legacySale = calculateSale({
      ...fixture.inputs,
      country: COUNTRIES[code]
    });

    const newOrder = calculateOrderFees({
      country: code,
      itemPrice: fixture.inputs.itemPrice,
      shipping: fixture.inputs.shipping,
      production: fixture.inputs.production,
      packaging: fixture.inputs.packaging,
      offsiteAds: fixture.inputs.offsiteRate > 0,
      shopOffsiteAdsTier: fixture.inputs.offsiteRate,
      plusEnabled: fixture.inputs.plus,
      salesPerMonth: fixture.inputs.salesPerMonth
    });

    assert.equal(
      newOrder.legacy.breakEvenCents,
      legacySale.breakEvenCents,
      `Break-even price mismatch for ${code}: legacy=${legacySale.breakEvenCents}, new=${newOrder.legacy.breakEvenCents}`
    );
  }
});

// ============================================================================
// SUITE 6: DIGITAL DOWNLOAD PRESET MODE (STEP 13)
// ============================================================================

test("Step 11D.26: Digital download mode preset removes shipping and production costs cleanly", () => {
  const digitalOrder = calculateOrderFees({
    country: "US",
    itemPrice: 25,
    shipping: 0,
    production: 0,
    packaging: 0
  });

  assert.equal(digitalOrder.legacy.grossCents, 2500);
  assert.equal(digitalOrder.legacy.listingCents, 20);
  assert.equal(digitalOrder.legacy.transactionCents, 163); // 2500 * 6.5% = 162.5 -> 163
  assert.equal(digitalOrder.legacy.processingCents, 100);  // 2500 * 3.0% + 25 = 100
  assert.equal(digitalOrder.legacy.feesCents, 283);
  assert.equal(digitalOrder.legacy.costsCents, 0);
  assert.equal(digitalOrder.legacy.netCents, 2217);
  assert.equal(digitalOrder.legacy.margin, 2217 / 2500);
});

// ============================================================================
// SUITE 7: INTERNAL LEGACY COMPARISON AUDIT (STEP 14)
// ============================================================================

test("Step 11D.27: Internal legacy comparison audit classifies all 12 baseline markets as MATCH", () => {
  const comparisonResults = {};

  for (const code of Object.keys(LEGACY_CALCULATOR_CASES)) {
    const comp = compareLegacyVsNewCalculation(code, {
      itemPrice: 35,
      shipping: 5,
      production: 7,
      packaging: 4,
      targetProfit: 25
    });

    assert.equal(comp.classification, "MATCH", `Expected MATCH classification for ${code}`);
    assert.equal(comp.legacy.netCents, comp.newEngine.netCents);
    assert.equal(comp.legacy.breakEvenCents, comp.newEngine.breakEvenCents);
    assert.equal(comp.legacy.requiredPriceCents, comp.newEngine.requiredPriceCents);

    comparisonResults[code] = comp.classification;
  }

  assert.equal(Object.keys(comparisonResults).length, 12);
});
