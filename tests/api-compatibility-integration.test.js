import assert from "node:assert/strict";
import test from "node:test";
import {
  FeeIntelligenceClient,
  EXPECTED_VERSION_ID
} from "../src/fee-intelligence-client.js";
import {
  normalizeFeeSchedule,
  STATUTORY_REGULATORY_RATES,
  STATUTORY_DEPOSIT_SCHEDULES,
  OFFICIAL_PAYONEER_COUNTRIES,
  EUR_PAYOUT_COUNTRIES,
  EURO_AREA_COUNTRIES
} from "../src/compatibility.js";
import {
  calculateOrderFees,
  calculateDepositFee,
  STATUTORY_OFFSITE_ADS_CAP
} from "../src/fee-engine.js";
import {
  V1_1_1_API_FIXTURE,
  V1_1_1_COUNTRY_ORDER
} from "./fixtures/v1.1.1-api-fixture.js";
import { LEGACY_CALCULATOR_CASES } from "./fixtures/legacy-calculator-cases.js";

/**
 * Creates an offline test client backed by the deterministic v1.1.1 API fixture.
 * Guarantees zero network calls to production Cloudflare Worker during test execution.
 */
function createFixtureClient(fixture = V1_1_1_API_FIXTURE, options = {}) {
  const mockFetch = async (url) => {
    const urlObj = new URL(url);
    if (urlObj.pathname.startsWith("/v1/fees/")) {
      const code = urlObj.pathname.split("/").pop().toUpperCase();
      const countryData = fixture.countries[code];
      if (!countryData) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({ error: `Country '${code}' not found` })
        };
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

    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ error: "Route not found" })
    };
  };

  return new FeeIntelligenceClient("https://mock.etsy-intelligence.local", {
    fetch: mockFetch,
    ...options
  });
}

// ============================================================================
// SUITE 1: API CLIENT & VERSION SAFETY (STEPS 1 & 7)
// ============================================================================

test("Step 11C.1: FeeIntelligenceClient validates and accepts v1.1.1 fixture", async () => {
  const client = createFixtureClient();
  const payload = await client.fetchFees();

  assert.equal(payload.version_id, "v1.1.1");
  assert.equal(payload.version, "1.1.1");
  assert.equal(payload.countryOrder.length, 62);
  assert.equal(Object.keys(payload.countries).length, 62);
});

test("Step 11C.2: FeeIntelligenceClient rejects unexpected or stale versions", async () => {
  // Stale v1.0.0 payload rejection
  const staleClient = createFixtureClient({
    ...V1_1_1_API_FIXTURE,
    version_id: "v1.0.0",
    version: "1.0.0"
  });

  await assert.rejects(
    async () => staleClient.fetchFees(),
    /Version mismatch: expected active fee version 'v1.1.1'/
  );

  // Stale v1.1.0 payload rejection
  const v110Client = createFixtureClient({
    ...V1_1_1_API_FIXTURE,
    version_id: "v1.1.0",
    version: "1.1.0"
  });

  await assert.rejects(
    async () => v110Client.fetchFees(),
    /Version mismatch: expected active fee version 'v1.1.1'/
  );

  // Permitted explicit historical override
  const allowedStale = await staleClient.fetchFees({ expectedVersion: "v1.0.0" });
  assert.equal(allowedStale.version_id, "v1.0.0");
});

test("Step 11C.3: FeeIntelligenceClient rejects malformed API responses", async () => {
  // Missing countryOrder
  const badClient1 = createFixtureClient({
    version_id: "v1.1.1",
    countries: {}
  });
  await assert.rejects(async () => badClient1.fetchFees(), /countryOrder must be a non-empty array/);

  // Missing countries dictionary
  const badClient2 = createFixtureClient({
    version_id: "v1.1.1",
    countryOrder: ["US"]
  });
  await assert.rejects(async () => badClient2.fetchFees(), /countries must be a non-null dictionary object/);

  // Missing country record in countries dictionary
  const badClient3 = createFixtureClient({
    version_id: "v1.1.1",
    countryOrder: ["US", "XX"],
    countries: { US: V1_1_1_API_FIXTURE.countries.US }
  });
  await assert.rejects(async () => badClient3.fetchFees(), /missing country record for code 'XX'/);
});

test("Step 11C.3B: FeeIntelligenceClient safely binds default fetch to globalThis preventing browser illegal invocation", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // Simulate browser Window.fetch which strictly enforces `this === globalThis`
    function browserLikeFetch(url, init) {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          version_id: "v1.1.1",
          version: "1.1.1",
          publishedAt: "2026-10-06T00:00:00Z",
          countryOrder: ["US"],
          countries: {
            US: {
              name: "United States",
              currency: "USD",
              symbol: "$",
              locale: "en-US",
              listingFee: 0.20,
              processingRate: 0.03,
              processingFixed: 0.25,
              regulatoryRate: 0
            }
          }
        })
      });
    }

    globalThis.fetch = browserLikeFetch;

    // Instantiate WITHOUT options.fetch (using default globalThis.fetch)
    const client = new FeeIntelligenceClient("https://mock.etsy.test");

    // Must NOT throw TypeError: Illegal invocation
    const payload = await client.fetchFees();
    assert.equal(payload.version_id, "v1.1.1");
    assert.equal(payload.countryOrder[0], "US");

    // Also verify custom injected fetch is preserved as-is
    let customCalled = false;
    const customFetch = async () => {
      customCalled = true;
      return {
        ok: true,
        json: async () => ({
          version_id: "v1.1.1",
          countryOrder: ["US"],
          countries: { US: payload.countries.US }
        })
      };
    };
    const customClient = new FeeIntelligenceClient("https://mock.etsy.test", { fetch: customFetch });
    assert.equal(customClient.fetchFn, customFetch);
    await customClient.fetchFees();
    assert.ok(customCalled);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ============================================================================
// SUITE 2: ALL 62 MARKETS NORMALIZATION (STEP 4)
// ============================================================================

test("Step 11C.4: Full 62-Market Normalization (61 Sovereign + OTHER)", async () => {
  const client = createFixtureClient();
  const normalizedMap = await client.getAllNormalizedFeeSchedules();

  assert.equal(normalizedMap.size, 62);
  assert.equal(V1_1_1_COUNTRY_ORDER.length, 62);

  for (const code of V1_1_1_COUNTRY_ORDER) {
    const norm = normalizedMap.get(code);
    assert.ok(norm, `Normalized schedule must exist for ${code}`);
    assert.equal(norm.country.code, code);
    assert.ok(norm.country.currency, `Currency missing for ${code}`);
    assert.ok(norm.fees.processing.rate >= 0, `Processing rate invalid for ${code}`);
    assert.ok(norm.fees.transaction.rate === 0.065, `Transaction rate must be 6.5% for ${code}`);

    // Verify end-to-end fee engine calculation consumes normalized schedule without error
    const calc = calculateOrderFees({
      country: norm,
      itemPrice: 50,
      shipping: 10
    });

    assert.ok(calc.totals.totalEtsyFees > 0, `Total fees must be positive for ${code}`);
    assert.ok(calc.totals.totalProfit !== undefined, `Profit must be defined for ${code}`);
    assert.equal(calc.metadata.country, code);
  }
});

// ============================================================================
// SUITE 3: SPECIAL MARKETS & JURISDICTIONS (STEP 5)
// ============================================================================

test("Step 11C.5: Six EUR Payout Markets (BG, HR, CZ, HU, RO, PL)", async () => {
  const client = createFixtureClient();

  for (const code of ["BG", "HR", "CZ", "HU", "RO", "PL"]) {
    const norm = await client.getNormalizedFeeSchedule(code);
    const calc = calculateOrderFees({ country: norm, itemPrice: 100 });

    // Etsy sends EUR
    assert.equal(calc.metadata.currency, "EUR");
    assert.equal(calc.metadata.payoutCurrency, "EUR");
    // bankFxPossibility is strictly true per official documentation
    assert.equal(calc.informational.bankFxPossibility, true, `${code} must have bankFxPossibility = true`);

    // Monetary status check
    if (code === "BG" || code === "HR") {
      assert.equal(norm.eligibility.euroArea, true, `${code} must be euroArea = true`);
    } else {
      assert.equal(norm.eligibility.euroArea, false, `${code} must be euroArea = false`);
    }
  }
});

test("Step 11C.6: Payoneer Context Across All 16 Official Markets", async () => {
  const client = createFixtureClient();
  const payoneerCodes = [
    "AE", "AR", "BR", "CL", "CN", "EG", "GE", "IN", "JP", "KR", "KZ", "PK", "PE", "RS", "TH", "UA"
  ];

  for (const code of payoneerCodes) {
    const norm = await client.getNormalizedFeeSchedule(code);
    const calc = calculateOrderFees({ country: norm, itemPrice: 100 });

    assert.equal(calc.informational.payoneer, true, `${code} must have payoneer = true`);
    assert.equal(calc.informational.payoneerContext, "payoneer", `${code} must have payoneerContext = 'payoneer'`);
    assert.equal(norm.eligibility.paymentProviderContext, "payoneer");
    assert.equal(norm.eligibility.payoutCurrency, "USD");
  }
});

test("Step 11C.7: Statutory Regulatory Operating Fee Markets (CA, FR, HU, IT, IN, ES, TR, UK, VN)", async () => {
  const client = createFixtureClient();
  const expectedReg = {
    CA: 0.0050,
    FR: 0.0114,
    HU: 0.0197,
    IT: 0.0080,
    IN: 0.0005,
    ES: 0.0088,
    TR: 0.0167,
    UK: 0.0048,
    VN: 0.0124
  };

  // 1. Verify 9 statutory markets have listed rates
  for (const [code, expRate] of Object.entries(expectedReg)) {
    const norm = await client.getNormalizedFeeSchedule(code);
    const calc = calculateOrderFees({ country: norm, itemPrice: 100 });

    assert.equal(calc.metadata.regulatory.rate, expRate, `${code} regulatory rate mismatch`);
    assert.equal(calc.metadata.regulatory.status, "applicable");
    assert.equal(calc.metadata.regulatory.isListedByEtsy, true);
    assert.ok(calc.feeBreakdown.regulatory > 0, `${code} fee must be greater than 0`);
  }

  // 2. Verify all other markets have rate: null, status: 'not_listed', isListedByEtsy: false
  for (const code of ["US", "DE", "AU", "JP", "BG", "OTHER", "SG", "NL", "SE"]) {
    const norm = await client.getNormalizedFeeSchedule(code);
    const calc = calculateOrderFees({ country: norm, itemPrice: 100 });

    assert.equal(calc.metadata.regulatory.rate, null, `${code} must have null regulatory rate`);
    assert.equal(calc.metadata.regulatory.status, "not_listed");
    assert.equal(calc.metadata.regulatory.isListedByEtsy, false);
    assert.equal(calc.feeBreakdown.regulatory, 0);
  }
});

test("Step 11C.8: Statutory Deposit Fee Markets (ID, IL, MY, MX, MA, PH, ZA, TR, VN)", async () => {
  const client = createFixtureClient();
  const expectedDeposits = {
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

  for (const [code, exp] of Object.entries(expectedDeposits)) {
    const norm = await client.getNormalizedFeeSchedule(code);
    const calc = calculateOrderFees({ country: norm, itemPrice: 100 });
    const dep = calc.informational.depositSchedule;

    assert.equal(dep.mode, "listed", `${code} must have listed deposit schedule`);
    assert.equal(dep.dailyDepositMinimum.amount, exp.min);
    assert.equal(dep.feeThreshold.amount, exp.threshold);
    assert.equal(dep.fee.amount, exp.fee);
    assert.equal(dep.fee.currency, exp.currency);

    // Verify calculateDepositFee logic
    assert.equal(calculateDepositFee(exp.min - 1, dep), 0);
    assert.equal(calculateDepositFee(exp.min, dep), 0);
    assert.equal(calculateDepositFee(exp.min + 1, dep), exp.fee);
    assert.equal(calculateDepositFee(exp.threshold - 1, dep), exp.fee);
    assert.equal(calculateDepositFee(exp.threshold, dep), 0);
    assert.equal(calculateDepositFee(exp.threshold * 2, dep), 0);
  }

  // Verify other markets have mode: 'not_listed'
  for (const code of ["US", "UK", "CA", "DE", "BG", "OTHER"]) {
    const norm = await client.getNormalizedFeeSchedule(code);
    const calc = calculateOrderFees({ country: norm, itemPrice: 100 });
    assert.equal(calc.informational.depositSchedule.mode, "not_listed");
    assert.equal(calculateDepositFee(500, calc.informational.depositSchedule), 0);
  }
});

// ============================================================================
// SUITE 4: PROCESSING CONTEXT & SPLITS (STEP 6)
// ============================================================================

test("Step 11C.9: Domestic vs International Processing Splits (CA, AU, NZ)", async () => {
  const client = createFixtureClient();

  // Canada: Domestic 3% + 0.25 CAD vs International 4% + 0.25 CAD
  const caNormDom = await client.getNormalizedFeeSchedule("CA", { orderType: "domestic" });
  const caDom = calculateOrderFees({ country: caNormDom, itemPrice: 100, orderType: "domestic" });
  assert.equal(caDom.feeBreakdown.processing, 3.25); // 100 * 3% + 0.25

  const caNormIntl = await client.getNormalizedFeeSchedule("CA", { orderType: "international" });
  const caIntl = calculateOrderFees({ country: caNormIntl, itemPrice: 100, orderType: "international" });
  assert.equal(caIntl.feeBreakdown.processing, 4.25); // 100 * 4% + 0.25

  // Australia: Domestic 3% + 0.25 AUD vs International 4% + 0.25 AUD
  const auNormDom = await client.getNormalizedFeeSchedule("AU", { orderType: "domestic" });
  const auDom = calculateOrderFees({ country: auNormDom, itemPrice: 100, orderType: "domestic" });
  assert.equal(auDom.feeBreakdown.processing, 3.25);

  const auNormIntl = await client.getNormalizedFeeSchedule("AU", { orderType: "international" });
  const auIntl = calculateOrderFees({ country: auNormIntl, itemPrice: 100, orderType: "international" });
  assert.equal(auIntl.feeBreakdown.processing, 4.25);

  // New Zealand: Domestic 3% + 0.30 NZD vs International 4% + 0.30 NZD
  const nzNormDom = await client.getNormalizedFeeSchedule("NZ", { orderType: "domestic" });
  const nzDom = calculateOrderFees({ country: nzNormDom, itemPrice: 100, orderType: "domestic" });
  assert.equal(nzDom.feeBreakdown.processing, 3.30); // 100 * 3% + 0.30

  const nzNormIntl = await client.getNormalizedFeeSchedule("NZ", { orderType: "international" });
  const nzIntl = calculateOrderFees({ country: nzNormIntl, itemPrice: 100, orderType: "international" });
  assert.equal(nzIntl.feeBreakdown.processing, 4.30); // 100 * 4% + 0.30
});

// ============================================================================
// SUITE 5: OFFSITE ADS & CURRENCY CONVERSION (STEPS 8 & 9)
// ============================================================================

test("Step 11C.10: Offsite Ads 15%/12% and $100 USD-Equivalent Cap via API Client", async () => {
  const client = createFixtureClient();
  const usNorm = await client.getNormalizedFeeSchedule("US");

  // USD 15% tier capped at $100 USD
  const cappedUs = calculateOrderFees({
    country: usNorm,
    itemPrice: 1000,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15
  });
  assert.equal(cappedUs.feeBreakdown.offsiteAds, 100.00);
  assert.deepEqual(cappedUs.metadata.offsiteAdsCap, STATUTORY_OFFSITE_ADS_CAP);

  // Non-USD without caller FX rate does not use invented rate; returns uncapped fee and USD cap metadata
  const ukNorm = await client.getNormalizedFeeSchedule("UK");
  const ukNoFx = calculateOrderFees({
    country: ukNorm,
    itemPrice: 1000,
    offsiteAds: true,
    shopOffsiteAdsTier: 0.15
  });
  assert.equal(ukNoFx.feeBreakdown.offsiteAds, 150.00);
  assert.deepEqual(ukNoFx.metadata.offsiteAdsCap, STATUTORY_OFFSITE_ADS_CAP);
});

test("Step 11C.11: Currency Conversion 2.5% Strictly on Currency Mismatch via Client", async () => {
  const client = createFixtureClient();
  const usNorm = await client.getNormalizedFeeSchedule("US");

  // Same currency -> 0%
  const same = calculateOrderFees({
    country: usNorm,
    itemPrice: 100,
    listingCurrency: "USD",
    paymentAccountCurrency: "USD"
  });
  assert.equal(same.feeBreakdown.currencyConversion, 0);

  // Differing currencies -> 2.5% on currencyConversionBase
  const diff = calculateOrderFees({
    country: usNorm,
    itemPrice: 100,
    shipping: 20,
    listingCurrency: "USD",
    paymentAccountCurrency: "EUR"
  });
  assert.equal(diff.bases.currencyConversionBase, 120);
  assert.equal(diff.feeBreakdown.currencyConversion, 3.00); // 120 * 2.5% = 3.00
});

// ============================================================================
// SUITE 6: 26-KEY-MARKET DIVERSE PIPELINE TEST (STEP 11)
// ============================================================================

test("Step 11C.12: Diverse 26-Market End-to-End Pipeline Verification", async () => {
  const client = createFixtureClient();
  const testMarkets = [
    "US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP",
    "TR", "BG", "HR", "CZ", "HU", "RO", "PL", "VN", "ID", "IL",
    "MY", "MX", "MA", "PH", "ZA", "OTHER"
  ];

  for (const code of testMarkets) {
    const norm = await client.getNormalizedFeeSchedule(code);
    assert.ok(norm, `Normalized schedule must exist for ${code}`);

    const calc = calculateOrderFees({
      country: norm,
      itemPrice: 100,
      shipping: 20
    });

    assert.equal(calc.metadata.country, code);
    assert.ok(calc.bases.transactionBase === 120);
    assert.ok(calc.bases.currencyConversionBase === 120);
    assert.ok(calc.totals.totalEtsyFees > 0);
    assert.ok(calc.totals.totalProfit !== undefined);
  }
});

// ============================================================================
// SUITE 7: LEGACY PARITY COMPARISON VIA FULL PIPELINE (STEP 13)
// API Fixture -> Client -> Compatibility -> Fee Engine VS Legacy Calculator
// ============================================================================

test("Step 11C.13: Legacy Parity Audit via Full v1.1.1 Pipeline Across All 12 Baseline Countries", async () => {
  const client = createFixtureClient();
  const comparisonResults = {};

  for (const [code, fixture] of Object.entries(LEGACY_CALCULATOR_CASES)) {
    const norm = await client.getNormalizedFeeSchedule(code, {
      orderType: "domestic"
    });

    const res = calculateOrderFees({
      country: norm,
      ...fixture.inputs
    });

    const exp = fixture.expected;
    const leg = res.legacy;

    // Verify exact equality across all 15 discrete metrics
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

    comparisonResults[code] = {
      status: "MATCH",
      currency: res.metadata.currency,
      netCents: leg.netCents,
      feesCents: leg.feesCents,
      breakEvenCents: leg.breakEvenCents
    };
  }

  assert.equal(Object.keys(comparisonResults).length, 12);
});

test("Production Regression: browser native fetch binding, custom fetch injection, and v1.1.1 62-market loading", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // 1. Emulate strict browser Window.fetch which fails if unbound
    function strictBrowserFetch(url, init) {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve({
        ok: true,
        json: async () => V1_1_1_API_FIXTURE
      });
    }

    globalThis.fetch = strictBrowserFetch;

    // Default client with no options must use bound fetch without error
    const client = new FeeIntelligenceClient("https://mock.etsy.test");
    const payload = await client.fetchFees();
    assert.equal(payload.version_id, "v1.1.1");
    assert.equal(payload.countryOrder.length, 62);

    // 2. Custom injected fetch functions continue to work
    let customCalls = 0;
    const customFetch = async () => {
      customCalls++;
      return {
        ok: true,
        json: async () => V1_1_1_API_FIXTURE
      };
    };
    const customClient = new FeeIntelligenceClient("https://mock.etsy.test", { fetch: customFetch });
    const customPayload = await customClient.fetchFees();
    assert.equal(customCalls, 1);
    assert.equal(customPayload.countryOrder.length, 62);

    // 3. Normalized loading yields all 62 markets
    const schedules = await client.getAllNormalizedFeeSchedules();
    assert.equal(schedules.size, 62);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

