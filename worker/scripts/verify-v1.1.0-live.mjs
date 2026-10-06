import { readFileSync } from "node:fs";

const API_BASE = "https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev";
const devVars = readFileSync(".dev.vars", "utf8");
const secretKey = devVars.split("=")[1].trim();

const ADMIN_HEADERS = {
  "Authorization": `Bearer ${secretKey}`,
  "Content-Type": "application/json"
};

async function verify() {
  console.log("==================================================");
  console.log("STEP 10F: LIVE AUDIT & INVARIANT VERIFICATION");
  console.log("==================================================");

  const errors = [];

  // 1. Health check
  console.log("\n1. Checking /health...");
  const healthRes = await fetch(`${API_BASE}/health`);
  const health = await healthRes.json();
  console.log("Health:", health);
  if (health.status !== "healthy") errors.push(`/health status: expected healthy, got ${health.status}`);

  // 2. Version check
  console.log("\n2. Checking /v1/version...");
  const verRes = await fetch(`${API_BASE}/v1/version`);
  const ver = await verRes.json();
  console.log("Active version:", ver);
  if (ver.version_id !== "v1.1.0") errors.push(`Active version: expected v1.1.0, got ${ver.version_id}`);
  if (ver.version_label !== "1.1.0") errors.push(`Active label: expected 1.1.0, got ${ver.version_label}`);
  if (ver.status !== "active") errors.push(`Active status: expected active, got ${ver.status}`);

  // 3. Current active fees
  console.log("\n3. Checking /v1/fees (v1.1.0)...");
  const feesRes = await fetch(`${API_BASE}/v1/fees`);
  const fees = await feesRes.json();
  const countryKeys = Object.keys(fees.countries);
  console.log(`Total countries in v1.1.0: ${countryKeys.length}`);
  if (countryKeys.length !== 62) {
    errors.push(`Total countries: expected 62, got ${countryKeys.length}`);
  }
  if (fees.version_id !== "v1.1.0") {
    errors.push(`Fees version_id: expected v1.1.0, got ${fees.version_id}`);
  }

  // 4. Historical v1.0.0
  console.log("\n4. Checking historical /v1/fees?version=v1.0.0...");
  const histRes = await fetch(`${API_BASE}/v1/fees?version=v1.0.0`);
  const hist = await histRes.json();
  const histKeys = Object.keys(hist.countries);
  console.log(`Total countries in historical v1.0.0: ${histKeys.length}`);
  if (histKeys.length !== 12) {
    errors.push(`Historical v1.0.0 countries: expected 12, got ${histKeys.length}`);
  }
  if (hist.version_id !== "v1.0.0") {
    errors.push(`Historical version_id: expected v1.0.0, got ${hist.version_id}`);
  }
  const baselineExpected = ["US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP", "TR", "OTHER"];
  for (const b of baselineExpected) {
    if (!hist.countries[b]) errors.push(`Historical v1.0.0 missing baseline ${b}`);
  }

  // 5. Candidate breakdown verification
  console.log("\n5. Verifying candidate classifications...");
  const EUR_PAYOUT_6 = ["BG", "HR", "CZ", "HU", "RO", "PL"];
  const PAYONEER_14 = [
    "AE", "AR", "BR", "CL", "CN", "EG", "GE", "KR", "KZ", "PK", "PE", "RS", "TH", "UA"
  ];
  const FULLY_VERIFIED_30 = [
    "AT", "BE", "CH", "CY", "DK", "EE", "FI", "GR", "HK", "ID", 
    "IE", "IL", "LT", "LU", "LV", "MT", "MY", "MX", "NL", "NO", 
    "NZ", "PH", "PT", "SE", "SG", "SI", "SK", "VN", "ZA", "OTHER" // Note: OTHER is fallback
  ];

  // Check 6 EUR payout markets
  for (const code of EUR_PAYOUT_6) {
    const c = fees.countries[code];
    if (!c) errors.push(`Missing EUR payout candidate ${code}`);
  }

  // Check 14 Payoneer candidate markets
  for (const code of PAYONEER_14) {
    const c = fees.countries[code];
    if (!c) errors.push(`Missing Payoneer candidate ${code}`);
  }

  // 6. Regulatory Invariant Check
  console.log("\n6. Checking Regulatory Operating Fee Invariant...");
  const STATUTORY_9 = {
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

  let numericRegCount = 0;
  let nullRegCount = 0;
  for (const [code, c] of Object.entries(fees.countries)) {
    if (STATUTORY_9[code] !== undefined) {
      numericRegCount++;
      const expectedRate = STATUTORY_9[code];
      if (Math.abs(c.regulatoryRate - expectedRate) > 0.00001) {
        errors.push(`Statutory regulatory rate mismatch for ${code}: expected ${expectedRate}, got ${c.regulatoryRate}`);
      }
    } else {
      nullRegCount++;
      if (c.regulatoryRate !== null) {
        errors.push(`Non-statutory country ${code} must have null regulatoryRate, got ${c.regulatoryRate}`);
      }
    }
  }
  console.log(`Regulatory count check: ${numericRegCount} statutory markets (expected 9), ${nullRegCount} non-statutory markets (expected 53)`);
  if (numericRegCount !== 9) errors.push(`Expected exactly 9 statutory regulatory rates, found ${numericRegCount}`);
  if (nullRegCount !== 53) errors.push(`Expected exactly 53 null regulatory rates, found ${nullRegCount}`);

  // 7. Deposit Invariant Check
  console.log("\n7. Checking Deposit Invariant...");
  const EXPECTED_DEPOSITS = {
    ID: { min: 28000, thresh: 1400000, fee: 28000, cur: "IDR" },
    IL: { min: 7, thresh: 350, fee: 7, cur: "ILS" },
    MY: { min: 9, thresh: 400, fee: 8, cur: "MYR" },
    MX: { min: 40, thresh: 2000, fee: 40, cur: "MXN" },
    MA: { min: 20, thresh: 1000, fee: 20, cur: "MAD" },
    PH: { min: 50, thresh: 2500, fee: 50, cur: "PHP" },
    ZA: { min: 10, thresh: 500, fee: 10, cur: "ZAR" },
    TR: { min: 50, thresh: 1000, fee: 40, cur: "TRY" },
    VN: { min: 110000, thresh: 5000000, fee: 46000, cur: "VND" }
  };

  for (const [code, exp] of Object.entries(EXPECTED_DEPOSITS)) {
    const c = fees.countries[code];
    if (!c) {
      errors.push(`Missing deposit market ${code}`);
      continue;
    }
    if (c.depositFeeSchedule) {
      const dep = c.depositFeeSchedule;
      if (dep.feeAmount !== exp.fee) errors.push(`${code} deposit fee mismatch: exp ${exp.fee}, got ${dep.feeAmount}`);
      if (dep.thresholdAmount !== exp.thresh) errors.push(`${code} threshold mismatch: exp ${exp.thresh}, got ${dep.thresholdAmount}`);
      if (dep.minimumAmount !== exp.min) errors.push(`${code} minimum mismatch: exp ${exp.min}, got ${dep.minimumAmount}`);
    }
  }

  // 8. Specific Country Audits
  console.log("\n8. Auditing specific focal countries...");
  // BG
  const bg = fees.countries.BG;
  console.log("BG record:", bg);
  if (!bg) errors.push("Missing BG");
  else {
    if (bg.currency !== "EUR") errors.push(`BG currency: exp EUR, got ${bg.currency}`);
    if (bg.processingRate !== 0.04) errors.push(`BG processingRate: exp 0.04, got ${bg.processingRate}`);
    if (bg.processingFixed !== 0.30) errors.push(`BG processingFixed: exp 0.30, got ${bg.processingFixed}`);
    if (bg.regulatoryRate !== null) errors.push(`BG regulatoryRate: exp null, got ${bg.regulatoryRate}`);
  }

  // CA
  const ca = fees.countries.CA;
  console.log("CA record:", ca);
  if (!ca || ca.currency !== "CAD" || ca.regulatoryRate !== 0.0050) {
    errors.push("CA verification failed");
  }

  // IN
  const inMkt = fees.countries.IN;
  console.log("IN record:", inMkt);
  if (!inMkt || inMkt.currency !== "INR" || inMkt.processingRate !== 0.05 || inMkt.regulatoryRate !== 0.0005) {
    errors.push("IN verification failed");
  }

  // JP
  const jp = fees.countries.JP;
  console.log("JP record:", jp);
  if (!jp || jp.currency !== "JPY" || jp.processingFixed !== 45 || jp.regulatoryRate !== null) {
    errors.push("JP baseline verification failed");
  }

  // TR
  const tr = fees.countries.TR;
  console.log("TR record:", tr);
  if (!tr || tr.currency !== "TRY" || tr.regulatoryRate !== 0.0167) {
    errors.push("TR verification failed");
  }

  // VN
  const vn = fees.countries.VN;
  console.log("VN record:", vn);
  if (!vn || vn.currency !== "VND" || vn.processingRate !== 0.045 || vn.regulatoryRate !== 0.0124) {
    errors.push("VN verification failed");
  }

  // US
  const us = fees.countries.US;
  console.log("US record:", us);
  if (!us || us.currency !== "USD" || us.processingRate !== 0.03 || us.processingFixed !== 0.25 || us.regulatoryRate !== null) {
    errors.push("US baseline verification failed");
  }

  // OTHER
  const other = fees.countries.OTHER;
  console.log("OTHER record:", other);
  if (!other || other.currency !== "USD" || other.regulatoryRate !== null) {
    errors.push("OTHER fallback verification failed");
  }

  // 9. Check database active versions count
  console.log("\n9. Verifying fee_versions in D1...");
  // Let's call /api/admin/data-quality or inspect versions
  const dqRes = await fetch(`${API_BASE}/api/admin/data-quality`, { headers: ADMIN_HEADERS });
  const dq = await dqRes.json();
  console.log("Data quality telemetry:", dq);
  const activeVersions = dq.versions.filter(v => v.status === "active");
  if (activeVersions.length !== 1) {
    errors.push(`Active version count: expected 1, got ${activeVersions.length}`);
  }
  if (dq.activeVersion !== "v1.1.0") {
    errors.push(`Active version ID: expected v1.1.0, got ${dq.activeVersion}`);
  }

  console.log("\n==================================================");
  if (errors.length > 0) {
    console.error("❌ AUDIT FAILURES:", errors);
    process.exit(1);
  } else {
    console.log("✅ ALL AUDIT INVARIANTS PASSED PERFECTLY!");
    console.log("==================================================");
  }
}

verify().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
