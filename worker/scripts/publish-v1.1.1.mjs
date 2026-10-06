import { readFileSync } from "node:fs";

const API_BASE = "https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev";
const devVars = readFileSync(".dev.vars", "utf8");
const secretKey = devVars.split("=")[1].trim();

const ADMIN_HEADERS = {
  "Authorization": `Bearer ${secretKey}`,
  "Content-Type": "application/json"
};

async function main() {
  console.log("==================================================");
  console.log("SHOPPROFIT — STEP 10F.2: PUBLISH v1.1.1 RELEASE");
  console.log("==================================================");

  // 1. PRE-PUBLISH VALIDATION
  console.log("\n[1/6] Pre-publish integrity check...");
  const healthRes = await fetch(`${API_BASE}/health`);
  const health = await healthRes.json();
  if (health.status !== "healthy") throw new Error(`/health is ${health.status}`);

  const verRes = await fetch(`${API_BASE}/v1/version`);
  const ver = await verRes.json();
  console.log(`Current active version: ${ver.version_id} (${ver.version_label})`);
  if (ver.version_id !== "v1.1.0") {
    throw new Error(`Precondition failed: active version is ${ver.version_id}, expected v1.1.0`);
  }

  const feesRes = await fetch(`${API_BASE}/v1/fees`);
  const fees = await feesRes.json();
  const cCount = Object.keys(fees.countries).length;
  console.log(`Current active countries: ${cCount}`);
  if (cCount !== 62) throw new Error(`Precondition failed: expected 62 countries in v1.1.0, got ${cCount}`);

  const v10Res = await fetch(`${API_BASE}/v1/fees?version=v1.0.0`);
  const v10 = await v10Res.json();
  const v10Count = Object.keys(v10.countries).length;
  console.log(`Historical v1.0.0 countries: ${v10Count}`);
  if (v10Count !== 12) throw new Error(`Precondition failed: expected 12 countries in v1.0.0, got ${v10Count}`);

  console.log("✅ Preconditions passed: Production is confirmed at v1.1.0 with 62 countries.");

  // 2. STAGE GOVERNED CHANGE FOR TR IN D1
  console.log("\n[2/6] Staging governed change in review queue for TR deposit schedule...");
  // We can insert into detected_changes & review_queue using wrangler d1 execute (or API)
  const { execSync } = await import("node:child_process");
  const insertSql = `
    INSERT OR REPLACE INTO detected_changes (
      change_id, source_id, snapshot_id, country_code, field_name, old_value, new_value,
      change_type, detected_at, status, validation_message
    ) VALUES (
      'chg_tr_deposit_115015628847', '115015628847', 'snap_1791226428387_lwjewfu', 'TR', 'deposit_schedule',
      NULL, '{"minimum":50,"threshold":600,"fee":42,"currency":"TRY"}',
      'deposit_schedule_changed', datetime('now'), 'pending_review',
      'Official Etsy Payments deposit schedule for TR'
    );

    INSERT OR REPLACE INTO review_queue (
      review_id, change_id, priority, proposed_value, reason, status, detected_at
    ) VALUES (
      'rev_tr_deposit_115015628847', 'chg_tr_deposit_115015628847', 'high',
      '{"minimum":50,"threshold":600,"fee":42,"currency":"TRY"}',
      'Correct TR deposit schedule per official Etsy Help Center policy 115015628847',
      'pending', datetime('now')
    );
  `.replace(/\r?\n/g, " ");

  execSync(`npx wrangler d1 execute shopprofit-fees-db --remote --command "${insertSql.replace(/"/g, '\\"')}"`, {
    stdio: "inherit"
  });

  // 3. APPROVE CHANGE VIA ADMIN API
  console.log("\n[3/6] Approving TR deposit schedule change via Admin API...");
  const appRes = await fetch(`${API_BASE}/api/admin/approve-change`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({
      review_id: "rev_tr_deposit_115015628847",
      note: "Approved TR deposit schedule: min 50 TRY, threshold 600 TRY, fee 42 TRY for v1.1.1 release"
    })
  });
  const appData = await appRes.json();
  console.log("Approval status:", appData);
  if (!appData.success && appData.status !== "approved") {
    throw new Error(`Failed to approve TR review: ${JSON.stringify(appData)}`);
  }

  // 4. PUBLISH v1.1.1 ATOMICALLY
  console.log("\n[4/6] Publishing v1.1.1 atomically via POST /api/admin/publish-version...");
  const pubRes = await fetch(`${API_BASE}/api/admin/publish-version`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({
      version_label: "1.1.1",
      notes: "Official v1.1.1 Release: Corrected TR deposit schedule to 50/600/42 TRY per official Etsy Payment processing policy."
    })
  });
  const pubData = await pubRes.json();
  console.log("Publish result:", JSON.stringify(pubData, null, 2));

  if (!pubData.success || pubData.publishedVersion !== "v1.1.1") {
    throw new Error(`Publication transaction failed: ${JSON.stringify(pubData)}`);
  }

  // 5. POST-PUBLISH LIVE AUDIT
  console.log("\n[5/6] Running complete post-publish live verification...");
  const liveVerRes = await fetch(`${API_BASE}/v1/version`);
  const liveVer = await liveVerRes.json();
  console.log("Live /v1/version:", liveVer);

  const liveFeesRes = await fetch(`${API_BASE}/v1/fees`);
  const liveFees = await liveFeesRes.json();
  const countryKeys = Object.keys(liveFees.countries);
  console.log(`Live countries in v1.1.1: ${countryKeys.length}`);

  const errors = [];

  if (liveVer.version_id !== "v1.1.1" || liveVer.version_label !== "1.1.1") {
    errors.push(`Active version mismatch: expected v1.1.1, got ${liveVer.version_id}`);
  }
  if (countryKeys.length !== 62) {
    errors.push(`Expected 62 countries, got ${countryKeys.length}`);
  }

  // Verify TR deposit schedule in v1.1.1
  const tr = liveFees.countries.TR;
  console.log("Live TR record in v1.1.1:", JSON.stringify(tr, null, 2));
  if (!tr || !tr.depositSchedule || tr.depositSchedule.mode !== "listed") {
    errors.push("TR depositSchedule is not listed in v1.1.1");
  } else {
    if (tr.depositSchedule.dailyDepositMinimum.amount !== 50 || tr.depositSchedule.dailyDepositMinimum.currency !== "TRY") {
      errors.push(`TR minimum mismatch: ${JSON.stringify(tr.depositSchedule.dailyDepositMinimum)}`);
    }
    if (tr.depositSchedule.feeThreshold.amount !== 600 || tr.depositSchedule.feeThreshold.currency !== "TRY") {
      errors.push(`TR threshold mismatch: ${JSON.stringify(tr.depositSchedule.feeThreshold)}`);
    }
    if (tr.depositSchedule.fee.amount !== 42 || tr.depositSchedule.fee.currency !== "TRY") {
      errors.push(`TR fee mismatch: ${JSON.stringify(tr.depositSchedule.fee)}`);
    }
  }

  // Verify PH, ZA, VN, and all 9 statutory deposit schedules
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

  let listedCount = 0;
  let unlistedCount = 0;

  for (const [code, c] of Object.entries(liveFees.countries)) {
    const dep = c.depositSchedule;
    if (!dep) {
      errors.push(`Missing depositSchedule on ${code}`);
      continue;
    }
    if (STATUTORY_9_DEPOSITS[code]) {
      listedCount++;
      const exp = STATUTORY_9_DEPOSITS[code];
      if (dep.mode !== "listed") errors.push(`${code} deposit mode should be 'listed'`);
      if (dep.dailyDepositMinimum?.amount !== exp.min || dep.dailyDepositMinimum?.currency !== exp.cur) {
        errors.push(`${code} minimum mismatch: got ${JSON.stringify(dep.dailyDepositMinimum)}, expected ${exp.min} ${exp.cur}`);
      }
      if (dep.feeThreshold?.amount !== exp.thresh || dep.feeThreshold?.currency !== exp.cur) {
        errors.push(`${code} threshold mismatch: got ${JSON.stringify(dep.feeThreshold)}, expected ${exp.thresh} ${exp.cur}`);
      }
      if (dep.fee?.amount !== exp.fee || dep.fee?.currency !== exp.cur) {
        errors.push(`${code} fee mismatch: got ${JSON.stringify(dep.fee)}, expected ${exp.fee} ${exp.cur}`);
      }
    } else {
      unlistedCount++;
      if (dep.mode !== "not_listed") errors.push(`${code} deposit mode should be 'not_listed'`);
      if (dep.dailyDepositMinimum !== null || dep.feeThreshold !== null || dep.fee !== null) {
        errors.push(`${code} unlisted deposit fields must be null`);
      }
    }
  }

  console.log(`Deposit schedule verification: ${listedCount} listed (expected 9), ${unlistedCount} unlisted (expected 53)`);
  if (listedCount !== 9) errors.push(`Listed deposit count: expected 9, got ${listedCount}`);
  if (unlistedCount !== 53) errors.push(`Unlisted deposit count: expected 53, got ${unlistedCount}`);

  // Regulatory Invariant Check
  const STATUTORY_9_REG = {
    CA: 0.0050, FR: 0.0114, HU: 0.0197, IT: 0.0080, IN: 0.0005,
    ES: 0.0088, TR: 0.0167, UK: 0.0048, VN: 0.0124
  };
  for (const [code, c] of Object.entries(liveFees.countries)) {
    if (STATUTORY_9_REG[code] !== undefined) {
      if (Math.abs(c.regulatoryRate - STATUTORY_9_REG[code]) > 0.00001) {
        errors.push(`Regulatory rate mismatch for ${code}: expected ${STATUTORY_9_REG[code]}, got ${c.regulatoryRate}`);
      }
    } else {
      if (c.regulatoryRate !== null) {
        errors.push(`Non-statutory country ${code} must have null regulatoryRate`);
      }
    }
  }

  // 6. HISTORICAL VERIFICATION
  console.log("\n[6/6] Verifying historical queries...");
  const histV110Res = await fetch(`${API_BASE}/v1/fees?version=v1.1.0`);
  const histV110 = await histV110Res.json();
  console.log(`Historical v1.1.0 total countries: ${Object.keys(histV110.countries).length}`);
  if (histV110.version_id !== "v1.1.0" || Object.keys(histV110.countries).length !== 62) {
    errors.push("Historical v1.1.0 retrieval failed or altered");
  }
  // In v1.1.0, TR was not_listed
  if (histV110.countries.TR.depositSchedule.mode !== "not_listed") {
    errors.push("Historical v1.1.0 TR deposit should remain not_listed (immutable)");
  }

  const histV100Res = await fetch(`${API_BASE}/v1/fees?version=v1.0.0`);
  const histV100 = await histV100Res.json();
  console.log(`Historical v1.0.0 total countries: ${Object.keys(histV100.countries).length}`);
  if (histV100.version_id !== "v1.0.0" || Object.keys(histV100.countries).length !== 12) {
    errors.push("Historical v1.0.0 retrieval failed or altered");
  }

  // Verify D1 active version count
  const dqRes = await fetch(`${API_BASE}/api/admin/data-quality`, { headers: ADMIN_HEADERS });
  const dq = await dqRes.json();
  const activeVersions = dq.versions.filter(v => v.status === "active");
  console.log(`Active version count in D1: ${activeVersions.length} (${dq.activeVersion})`);
  if (activeVersions.length !== 1 || dq.activeVersion !== "v1.1.1") {
    errors.push(`Active version anomaly: count ${activeVersions.length}, active ${dq.activeVersion}`);
  }

  if (errors.length > 0) {
    console.error("❌ VALIDATION FAILURES:", errors);
    throw new Error(`Step 10F.2 verification failed: ${errors.join("; ")}`);
  }

  console.log("\n==================================================");
  console.log("✅ STEP 10F.2: v1.1.1 IS LIVE, HISTORICAL IMMUTABILITY PRESERVED, ALL INVARIANTS PASS");
  console.log("==================================================");
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
