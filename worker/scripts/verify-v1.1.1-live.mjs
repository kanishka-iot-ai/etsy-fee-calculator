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
  console.log("STEP 10F.2: COMPREHENSIVE LIVE AUDIT OF v1.1.1");
  console.log("==================================================");

  const errors = [];

  // 1. Version status & active count
  console.log("\n1. Checking version status & count in D1...");
  const verRes = await fetch(`${API_BASE}/v1/version`);
  const ver = await verRes.json();
  console.log("Active version:", ver);
  if (ver.version_id !== "v1.1.1" || ver.version_label !== "1.1.1" || ver.status !== "active") {
    errors.push(`Active version mismatch: expected v1.1.1 active, got ${ver.version_id} (${ver.status})`);
  }

  const dqRes = await fetch(`${API_BASE}/api/admin/data-quality`, { headers: ADMIN_HEADERS });
  const dq = await dqRes.json();
  const activeVersions = dq.versions.filter(v => v.status === "active");
  console.log(`Active versions count: ${activeVersions.length} (${dq.activeVersion})`);
  if (activeVersions.length !== 1 || dq.activeVersion !== "v1.1.1") {
    errors.push(`Active versions count: expected exactly 1, got ${activeVersions.length}`);
  }

  const v110 = dq.versions.find(v => v.version_id === "v1.1.0");
  const v100 = dq.versions.find(v => v.version_id === "v1.0.0");
  if (!v110 || v110.status !== "archived") errors.push("v1.1.0 is not archived in D1");
  if (!v100 || v100.status !== "archived") errors.push("v1.0.0 is not archived in D1");

  // 2. Public countries count
  console.log("\n2. Checking public country count in v1.1.1...");
  const feesRes = await fetch(`${API_BASE}/v1/fees`);
  const fees = await feesRes.json();
  const keys = Object.keys(fees.countries);
  console.log(`Total public countries: ${keys.length}`);
  if (keys.length !== 62) errors.push(`Country count mismatch: expected 62, got ${keys.length}`);

  // 3. Deposit schedule audit for all 9 markets
  console.log("\n3. Auditing 9 statutory deposit markets...");
  const STATUTORY_9_DEPOSITS = {
    ID: { min: 28000, thresh: 1400000, fee: 28000, cur: "IDR" },
    IL: { min: 7, thresh: 350, fee: 7, cur: "ILS" },
    MY: { min: 9, thresh: 400, fee: 8, cur: "MYR" },
    MX: { min: 40, thresh: 2000, fee: 40, cur: "MXN" },
    MA: { min: 20, thresh: 1000, fee: 20, cur: "MAD" },
    PH: { min: 100, thresh: 5000, fee: 100, cur: "PHP" },
    ZA: { min: 35, thresh: 1500, fee: 30, cur: "ZAR" },
    TR: { min: 50, thresh: 600, fee: 42, cur: "TRY" },
    VN: { min: 45000, thresh: 2300000, fee: 45000, cur: "VND" }
  };

  const depositAuditResults = [];

  for (const [code, exp] of Object.entries(STATUTORY_9_DEPOSITS)) {
    const c = fees.countries[code];
    if (!c) {
      errors.push(`Missing deposit market ${code}`);
      continue;
    }
    const dep = c.depositSchedule;
    if (!dep || dep.mode !== "listed") {
      errors.push(`${code} depositSchedule mode is not 'listed'`);
      continue;
    }
    const minMatch = dep.dailyDepositMinimum?.amount === exp.min && dep.dailyDepositMinimum?.currency === exp.cur;
    const threshMatch = dep.feeThreshold?.amount === exp.thresh && dep.feeThreshold?.currency === exp.cur;
    const feeMatch = dep.fee?.amount === exp.fee && dep.fee?.currency === exp.cur;
    const match = minMatch && threshMatch && feeMatch;

    depositAuditResults.push({
      country: code,
      currency: exp.cur,
      liveMin: dep.dailyDepositMinimum?.amount,
      liveThresh: dep.feeThreshold?.amount,
      liveFee: dep.fee?.amount,
      expMin: exp.min,
      expThresh: exp.thresh,
      expFee: exp.fee,
      status: match ? "MATCH" : "MISMATCH"
    });

    if (!match) errors.push(`${code} deposit mismatch: live=${JSON.stringify(dep)} vs exp=${JSON.stringify(exp)}`);
  }

  console.table(depositAuditResults);

  // 4. Non-statutory deposit check (53 markets)
  console.log("\n4. Checking non-statutory deposit schedules (53 markets)...");
  let unlistedDepositCount = 0;
  for (const [code, c] of Object.entries(fees.countries)) {
    if (!STATUTORY_9_DEPOSITS[code]) {
      unlistedDepositCount++;
      const dep = c.depositSchedule;
      if (dep.mode !== "not_listed" || dep.dailyDepositMinimum !== null || dep.feeThreshold !== null || dep.fee !== null) {
        errors.push(`${code} non-statutory deposit schedule must have mode='not_listed' and null fields`);
      }
    }
  }
  console.log(`Unlisted deposit count: ${unlistedDepositCount} (expected 53)`);
  if (unlistedDepositCount !== 53) errors.push(`Unlisted deposit count: expected 53, got ${unlistedDepositCount}`);

  // 5. Regulatory Invariant Check
  console.log("\n5. Checking statutory regulatory operating fee invariant...");
  const STATUTORY_9_REG = {
    CA: 0.0050, FR: 0.0114, HU: 0.0197, IT: 0.0080, IN: 0.0005,
    ES: 0.0088, TR: 0.0167, UK: 0.0048, VN: 0.0124
  };
  let numericRegCount = 0;
  let nullRegCount = 0;
  for (const [code, c] of Object.entries(fees.countries)) {
    if (STATUTORY_9_REG[code] !== undefined) {
      numericRegCount++;
      if (Math.abs(c.regulatoryRate - STATUTORY_9_REG[code]) > 0.00001) {
        errors.push(`${code} regulatory rate mismatch: live ${c.regulatoryRate}, exp ${STATUTORY_9_REG[code]}`);
      }
    } else {
      nullRegCount++;
      if (c.regulatoryRate !== null) {
        errors.push(`${code} non-statutory regulatory rate must be null, got ${c.regulatoryRate}`);
      }
    }
  }
  console.log(`Regulatory count: ${numericRegCount} numeric (expected 9), ${nullRegCount} null (expected 53)`);
  if (numericRegCount !== 9 || nullRegCount !== 53) errors.push("Regulatory invariant failed");

  // 6. Bulgaria Invariant
  console.log("\n6. Checking Bulgaria (BG)...");
  const bg = fees.countries.BG;
  if (!bg || bg.currency !== "EUR" || bg.processingRate !== 0.04 || bg.processingFixed !== 0.30 || bg.regulatoryRate !== null) {
    errors.push("BG invariant failed");
  } else {
    console.log("BG record:", bg);
  }

  // 7. Payoneer Invariant
  console.log("\n7. Checking Payoneer 16-country invariant...");
  const PAYONEER_16 = [
    "AE", "AR", "BR", "CL", "CN", "EG", "GE", "IN", "JP", "KR", "KZ", "PK", "PE", "RS", "TH", "UA"
  ];
  for (const p of PAYONEER_16) {
    if (!fees.countries[p]) errors.push(`Missing Payoneer market ${p}`);
  }

  // 8. Individual Country Endpoint Check
  console.log("\n8. Checking individual country endpoint GET /v1/fees/TR...");
  const trRes = await fetch(`${API_BASE}/v1/fees/TR`);
  const trData = await trRes.json();
  console.log("GET /v1/fees/TR:", trData);
  if (trData.country.depositSchedule.dailyDepositMinimum.amount !== 50 || trData.country.depositSchedule.feeThreshold.amount !== 600 || trData.country.depositSchedule.fee.amount !== 42) {
    errors.push("GET /v1/fees/TR deposit schedule mismatch");
  }

  // 9. Historical Immutability
  console.log("\n9. Checking historical immutability...");
  const v110Res = await fetch(`${API_BASE}/v1/fees?version=v1.1.0`);
  const v110Data = await v110Res.json();
  console.log(`v1.1.0 country count: ${Object.keys(v110Data.countries).length}`);
  if (v110Data.countries.TR.depositSchedule.mode !== "not_listed") {
    errors.push("v1.1.0 TR deposit schedule should be unlisted (immutable)");
  }

  const v100Res = await fetch(`${API_BASE}/v1/fees?version=v1.0.0`);
  const v100Data = await v100Res.json();
  console.log(`v1.0.0 country count: ${Object.keys(v100Data.countries).length}`);
  if (Object.keys(v100Data.countries).length !== 12) {
    errors.push(`v1.0.0 country count expected 12, got ${Object.keys(v100Data.countries).length}`);
  }

  // 10. Review queue clean
  if (dq.totalPendingReviews !== 0) {
    errors.push(`Expected 0 pending reviews, found ${dq.totalPendingReviews}`);
  }

  if (errors.length > 0) {
    console.error("❌ VALIDATION ERRORS:", errors);
    process.exit(1);
  } else {
    console.log("\n==================================================");
    console.log("✅ ALL STEP 10F.2 LIVE VALIDATIONS PASSED PERFECTLY!");
    console.log("==================================================");
  }
}

verify().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
