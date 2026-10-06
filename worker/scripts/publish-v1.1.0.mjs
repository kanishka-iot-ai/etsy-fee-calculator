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
  console.log("SHOPPROFIT — STEP 10F CONTROLLED PRODUCTION PUBLISH");
  console.log("==================================================");

  // 1. Pre-publish integrity check
  console.log("\n[1/6] Verifying pre-publish production state...");
  const healthRes = await fetch(`${API_BASE}/health`);
  const health = await healthRes.json();
  if (health.status !== "healthy") {
    throw new Error(`Pre-publish check failed: /health is ${health.status}`);
  }

  const verRes = await fetch(`${API_BASE}/v1/version`);
  const ver = await verRes.json();
  console.log(`Current active version: ${ver.version_id} (${ver.version})`);
  if (ver.version_id !== "v1.0.0") {
    throw new Error(`Pre-publish check failed: active version is ${ver.version_id}, expected v1.0.0`);
  }

  const feesRes = await fetch(`${API_BASE}/v1/fees`);
  const fees = await feesRes.json();
  const countryCount = Object.keys(fees.countries).length;
  console.log(`Current active countries: ${countryCount} (${fees.countryOrder.join(",")})`);
  if (countryCount !== 12) {
    throw new Error(`Pre-publish check failed: country count is ${countryCount}, expected 12`);
  }

  // 2. Fetch review queue
  console.log("\n[2/6] Inspecting governance review queue...");
  const revRes = await fetch(`${API_BASE}/api/admin/review`, { headers: ADMIN_HEADERS });
  const revData = await revRes.json();
  console.log(`Total reviews in queue: ${revData.count}`);

  const jpReview = revData.reviews.find(r => r.country === "JP" && r.changeType === "currency_changed");
  const candidateReviews = revData.reviews.filter(r => r.changeType === "new_country");

  console.log(`Found ${candidateReviews.length} new_country candidate reviews`);
  if (candidateReviews.length !== 50) {
    throw new Error(`Expected exactly 50 new_country reviews, found ${candidateReviews.length}`);
  }

  // 3. Reject JP currency change if pending
  if (jpReview && jpReview.status === "pending") {
    console.log("\n[3/6] Rejecting spurious JP currency change to preserve JPY baseline schedule...");
    const rejRes = await fetch(`${API_BASE}/api/admin/reject-change`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({
        review_id: jpReview.reviewId,
        reason: "Retain official baseline JPY fixed fee schedule (¥45 JPY estimate)"
      })
    });
    const rejData = await rejRes.json();
    console.log("JP rejection status:", rejData.status);
  } else {
    console.log("\n[3/6] JP currency change already rejected or absent.");
  }

  // 4. Approve all 50 candidate new_country reviews
  console.log("\n[4/6] Approving all 50 candidate sovereign market reviews...");
  let approvedCount = 0;
  for (const r of candidateReviews) {
    if (r.status === "approved" || r.status === "published") {
      approvedCount++;
      continue;
    }
    const appRes = await fetch(`${API_BASE}/api/admin/approve-change`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({
        review_id: r.reviewId,
        note: `Approved for v1.1.0 release: ${r.country}`
      })
    });
    const appData = await appRes.json();
    if (!appData.success) {
      throw new Error(`Failed to approve review ${r.reviewId} (${r.country}): ${JSON.stringify(appData)}`);
    }
    approvedCount++;
    process.stdout.write(`Approved ${approvedCount}/50: ${r.country}\r`);
  }
  console.log(`\nSuccessfully approved ${approvedCount} candidate market reviews.`);

  // 5. Trigger atomic publish of v1.1.0
  console.log("\n[5/6] Triggering atomic release of v1.1.0 via POST /api/admin/publish-version...");
  const pubRes = await fetch(`${API_BASE}/api/admin/publish-version`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({
      version_label: "1.1.0",
      includePublished: true,
      notes: "Official v1.1.0 Global Release: 50 sovereign Etsy markets + 12 baseline markets = 62 total records."
    })
  });
  const pubData = await pubRes.json();
  console.log("Publish result:", JSON.stringify(pubData, null, 2));

  if (!pubData.success || pubData.publishedVersion !== "v1.1.0") {
    throw new Error(`Publication transaction failed: ${JSON.stringify(pubData)}`);
  }

  // 6. Post-publish live validation
  console.log("\n[6/6] Verifying live endpoints post-publish...");
  const liveVerRes = await fetch(`${API_BASE}/v1/version`);
  const liveVer = await liveVerRes.json();
  console.log("Live /v1/version:", liveVer);

  const liveFeesRes = await fetch(`${API_BASE}/v1/fees`);
  const liveFees = await liveFeesRes.json();
  const liveCountryKeys = Object.keys(liveFees.countries);
  console.log(`Live /v1/fees total countries: ${liveCountryKeys.length}`);

  const histFeesRes = await fetch(`${API_BASE}/v1/fees?version=v1.0.0`);
  const histFees = await histFeesRes.json();
  const histCountryKeys = Object.keys(histFees.countries);
  console.log(`Historical /v1/fees?version=v1.0.0 total countries: ${histCountryKeys.length}`);

  // INVARIANT AUDIT
  const errors = [];

  if (liveVer.version_id !== "v1.1.0" || (liveVer.version_label !== "1.1.0" && liveVer.version !== "1.1.0")) {
    errors.push(`Live version mismatch: expected v1.1.0, got ${liveVer.version_id}`);
  }

  if (liveCountryKeys.length !== 62) {
    errors.push(`Live country count mismatch: expected 62, got ${liveCountryKeys.length}`);
  }

  if (histFees.version_id !== "v1.0.0" || histCountryKeys.length !== 12) {
    errors.push(`Historical v1.0.0 immutability violated: got ${histFees.version_id} with ${histCountryKeys.length} countries`);
  }

  // Check specific markets
  const bg = liveFees.countries.BG;
  if (!bg) errors.push("Missing BG in v1.1.0");
  else {
    if (bg.currency !== "EUR") errors.push(`BG currency: expected EUR, got ${bg.currency}`);
    if (bg.processingRate !== 0.04) errors.push(`BG processingRate: expected 0.04, got ${bg.processingRate}`);
    if (bg.processingFixed !== 0.30) errors.push(`BG processingFixed: expected 0.30, got ${bg.processingFixed}`);
    if (bg.regulatoryRate !== null) errors.push(`BG regulatoryRate: expected null, got ${bg.regulatoryRate}`);
  }

  const inMkt = liveFees.countries.IN;
  if (!inMkt || inMkt.processingRate !== 0.05 || inMkt.regulatoryRate !== 0.0005) {
    errors.push("IN baseline fee mismatch in v1.1.0");
  }

  const vn = liveFees.countries.VN;
  if (!vn || vn.processingRate !== 0.045 || vn.regulatoryRate !== 0.0124) {
    errors.push("VN candidate fee mismatch in v1.1.0");
  }

  const hu = liveFees.countries.HU;
  if (!hu || hu.regulatoryRate !== 0.0197) {
    errors.push("HU regulatory rate mismatch in v1.1.0");
  }

  const jp = liveFees.countries.JP;
  if (!jp || jp.currency !== "JPY" || jp.processingFixed !== 45) {
    errors.push("JP baseline fee altered in v1.1.0");
  }

  // Regulatory invariant: exactly 9 countries with numeric regulatory rate
  const statutory9 = ["CA", "FR", "HU", "IT", "IN", "ES", "TR", "UK", "VN"];
  for (const [code, c] of Object.entries(liveFees.countries)) {
    if (statutory9.includes(code)) {
      if (typeof c.regulatoryRate !== "number") errors.push(`${code} should have numeric regulatoryRate`);
    } else {
      if (c.regulatoryRate !== null) errors.push(`${code} should have null regulatoryRate, got ${c.regulatoryRate}`);
    }
  }

  if (errors.length > 0) {
    console.error("\n❌ VALIDATION ERRORS DETECTED:", errors);
    console.log("Triggering automatic emergency rollback to v1.0.0...");
    const rollRes = await fetch(`${API_BASE}/api/admin/rollback-version`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({
        target_version_id: "v1.0.0",
        reason: `Automatic rollback due to validation errors: ${errors.join("; ")}`
      })
    });
    const rollData = await rollRes.json();
    console.log("Rollback result:", rollData);
    process.exit(1);
  }

  console.log("\n✅ ALL POST-PUBLISH INVARIANTS PASSED PERFECTLY!");
  console.log("==================================================");
  console.log("PRODUCTION RELEASE v1.1.0 IS FULLY LIVE & VERIFIED");
  console.log("==================================================");
}

main().catch(err => {
  console.error("FATAL ERROR in publish script:", err);
  process.exit(1);
});
