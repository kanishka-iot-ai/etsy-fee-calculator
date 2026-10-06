/**
 * ShopProfit Live Production Synthetic Canary
 *
 * Performs continuous, zero-cost, read-only health, integrity, and immutability checks
 * against live Cloudflare Worker API production endpoints.
 *
 * Invariants:
 * - Read-only: Zero database mutations or administrative actions.
 * - Zero secrets: Uses exclusively public GET endpoints.
 * - Concise output: Outputs standard compact summary on success or targeted error on failure.
 */

const API_BASE = "https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev";
const EXPECTED_VERSION_ID = "v1.1.1";
const EXPECTED_SOURCE_HASH = "44526eef75082b7751e59f32eff9bfaf27ad22f2cdc83446ea18a34f012adf54";
const EXPECTED_MARKET_COUNT = 62;
const REQUEST_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function runCanary() {
  const stepsCompleted = {
    health: false,
    version: false,
    fees: false,
    countryEndpoints: false,
    historicalSnapshots: false,
    feeIntegrity: false
  };

  try {
    // 1. Health Endpoint Check
    const healthRes = await fetchWithTimeout(`${API_BASE}/health`);
    if (healthRes.status !== 200) {
      throw new Error(`Health endpoint failed: Expected HTTP 200, got ${healthRes.status}`);
    }
    const healthData = await healthRes.json();
    if (healthData.status !== "healthy") {
      throw new Error(`Health status invalid: Expected 'healthy', got '${healthData.status}'`);
    }
    stepsCompleted.health = true;

    // 2. Active Version Metadata Check
    const versionRes = await fetchWithTimeout(`${API_BASE}/v1/version`);
    if (versionRes.status !== 200) {
      throw new Error(`Version endpoint failed: Expected HTTP 200, got ${versionRes.status}`);
    }
    const versionData = await versionRes.json();
    if (versionData.version_id !== EXPECTED_VERSION_ID) {
      throw new Error(`Active version drift: Expected version_id '${EXPECTED_VERSION_ID}', got '${versionData.version_id}'`);
    }
    if (versionData.status !== "active") {
      throw new Error(`Active version status invalid: Expected 'active', got '${versionData.status}'`);
    }
    if (versionData.source_hash !== EXPECTED_SOURCE_HASH) {
      throw new Error(`Source hash drift: Expected '${EXPECTED_SOURCE_HASH}', got '${versionData.source_hash}'`);
    }
    stepsCompleted.version = true;

    // 3. Active Global Fees Schedule Check
    const feesRes = await fetchWithTimeout(`${API_BASE}/v1/fees`);
    if (feesRes.status !== 200) {
      throw new Error(`Global fees endpoint failed: Expected HTTP 200, got ${feesRes.status}`);
    }
    const feesData = await feesRes.json();
    if (feesData.version_id !== EXPECTED_VERSION_ID) {
      throw new Error(`Global fees version mismatch: Expected '${EXPECTED_VERSION_ID}', got '${feesData.version_id}'`);
    }
    if (!Array.isArray(feesData.countryOrder) || feesData.countryOrder.length !== EXPECTED_MARKET_COUNT) {
      throw new Error(`Market count mismatch in countryOrder: Expected ${EXPECTED_MARKET_COUNT}, got ${feesData.countryOrder?.length}`);
    }
    const countryKeys = Object.keys(feesData.countries || {});
    if (countryKeys.length !== EXPECTED_MARKET_COUNT) {
      throw new Error(`Market count mismatch in countries map: Expected ${EXPECTED_MARKET_COUNT}, got ${countryKeys.length}`);
    }
    stepsCompleted.fees = true;

    // 4. Country-Specific Endpoints Verification
    const testCountries = ["US", "IN", "TR", "VN"];
    for (const code of testCountries) {
      const countryRes = await fetchWithTimeout(`${API_BASE}/v1/fees/${code}`);
      if (countryRes.status !== 200) {
        throw new Error(`Country endpoint for ${code} failed: Expected HTTP 200, got ${countryRes.status}`);
      }
      const countryData = await countryRes.json();
      if (!countryData.country || countryData.country.code !== code) {
        throw new Error(`Country endpoint for ${code} returned mismatched code: Expected ${code}, got ${countryData.country?.code}`);
      }
      if (typeof countryData.country.processingRate !== "number" || typeof countryData.country.listingFee !== "number") {
        throw new Error(`Country endpoint for ${code} returned incomplete fee parameters`);
      }
    }
    stepsCompleted.countryEndpoints = true;

    // 5. Fee Integrity & Special Policies Check
    const us = feesData.countries.US;
    if (us.processingRate !== 0.03 || us.processingFixed !== 0.25 || us.listingFee !== 0.2) {
      throw new Error("US fee rule baseline mismatch: Expected 3.0% + $0.25, listing $0.20");
    }
    if (us.offsiteCap !== 100) {
      throw new Error(`US Offsite Ads cap mismatch: Expected 100, got ${us.offsiteCap}`);
    }

    const tr = feesData.countries.TR;
    const trDeposit = tr.depositSchedule;
    if (!trDeposit || trDeposit.mode !== "listed" ||
        trDeposit.dailyDepositMinimum?.amount !== 50 ||
        trDeposit.feeThreshold?.amount !== 600 ||
        trDeposit.fee?.amount !== 42) {
      throw new Error("TR statutory deposit schedule mismatch: Expected 50/600/42 TRY");
    }

    const vn = feesData.countries.VN;
    const vnDeposit = vn.depositSchedule;
    if (!vnDeposit || vnDeposit.mode !== "listed" ||
        vnDeposit.dailyDepositMinimum?.amount !== 45000 ||
        vnDeposit.feeThreshold?.amount !== 2300000 ||
        vnDeposit.fee?.amount !== 45000) {
      throw new Error("VN statutory deposit schedule mismatch: Expected 45000/2300000/45000 VND");
    }

    const uk = feesData.countries.UK;
    if (uk.regulatoryRate !== 0.0048) {
      throw new Error(`UK regulatory operating fee mismatch: Expected 0.0048, got ${uk.regulatoryRate}`);
    }

    const other = feesData.countries.OTHER;
    if (!other || other.currency !== "USD") {
      throw new Error("OTHER global fallback market missing or invalid currency");
    }
    stepsCompleted.feeIntegrity = true;

    // 6. Historical Snapshot Immutability Check
    const histV100Res = await fetchWithTimeout(`${API_BASE}/v1/fees?version=v1.0.0`);
    if (histV100Res.status !== 200) {
      throw new Error(`Historical snapshot v1.0.0 failed: Expected HTTP 200, got ${histV100Res.status}`);
    }
    const histV100 = await histV100Res.json();
    if (histV100.version_id !== "v1.0.0" || histV100.countryOrder.length !== 12) {
      throw new Error(`Historical snapshot v1.0.0 corrupted: Expected 12 markets, got ${histV100.countryOrder?.length}`);
    }

    const histV110Res = await fetchWithTimeout(`${API_BASE}/v1/fees?version=v1.1.0`);
    if (histV110Res.status !== 200) {
      throw new Error(`Historical snapshot v1.1.0 failed: Expected HTTP 200, got ${histV110Res.status}`);
    }
    const histV110 = await histV110Res.json();
    if (histV110.version_id !== "v1.1.0" || histV110.countryOrder.length !== 62) {
      throw new Error(`Historical snapshot v1.1.0 corrupted: Expected 62 markets, got ${histV110.countryOrder?.length}`);
    }

    const histV111Res = await fetchWithTimeout(`${API_BASE}/v1/fees?version=v1.1.1`);
    if (histV111Res.status !== 200) {
      throw new Error(`Historical snapshot v1.1.1 failed: Expected HTTP 200, got ${histV111Res.status}`);
    }
    const histV111 = await histV111Res.json();
    if (histV111.version_id !== "v1.1.1" || histV111.countryOrder.length !== 62) {
      throw new Error(`Historical snapshot v1.1.1 corrupted: Expected 62 markets, got ${histV111.countryOrder?.length}`);
    }
    stepsCompleted.historicalSnapshots = true;

    // Compact Success Output (Step 8)
    console.log("ShopProfit production canary: PASS");
    console.log(`Version: ${EXPECTED_VERSION_ID}`);
    console.log(`Markets: ${EXPECTED_MARKET_COUNT}`);
    console.log("Health: PASS");
    console.log("API: PASS");
    console.log("Historical snapshots: PASS");
    console.log("Fee integrity: PASS");
    process.exit(0);

  } catch (err) {
    console.error("::error::ShopProfit production canary FAILED");
    console.error(`CANARY ERROR: ${err.message}`);
    console.error("Steps Completed:", JSON.stringify(stepsCompleted));
    process.exit(1);
  }
}

runCanary();
