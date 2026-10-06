import assert from "node:assert/strict";

async function verifyLive() {
  const routes = [
    { url: "https://shopprofitcalculator.com/fees/", expectedH1: "Etsy Fee Calculator", checkForm: true },
    { url: "https://shopprofitcalculator.com/", expectedH1: "Etsy Profit Calculator" },
    { url: "https://shopprofitcalculator.com/etsy-fee-calculator-uk", expectedH1: "Etsy Fee Calculator UK" },
    { url: "https://shopprofitcalculator.com/etsy-fee-calculator-canada", expectedH1: "Etsy Fee Calculator Canada" },
    { url: "https://shopprofitcalculator.com/etsy-fee-calculator-australia", expectedH1: "Etsy Fee Calculator Australia" },
    { url: "https://shopprofitcalculator.com/etsy-digital-download-fee-calculator", expectedH1: "Etsy Digital Download Fee Calculator" },
    { url: "https://shopprofitcalculator.com/methodology/" },
    { url: "https://shopprofitcalculator.com/faq/" }
  ];

  console.log("--- 1. Testing Production URLs ---");
  for (const r of routes) {
    const res = await fetch(r.url, { redirect: "manual" });
    const tag = res.headers.get("x-robots-tag");
    console.log(`${r.url} -> Status: ${res.status}, X-Robots-Tag: ${tag}`);
    assert.equal(res.status, 200, `${r.url} returned 200`);
    assert.equal(tag, null, `${r.url} should not have noindex`);

    const html = await res.text();
    const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
    console.log(`   H1 count: ${h1s.length}, H1 text: ${JSON.stringify(h1s)}`);
    if (r.expectedH1) {
      assert.equal(h1s.length, 1, `Exactly one H1 on ${r.url}`);
      assert.equal(h1s[0], r.expectedH1, `H1 matches ${r.expectedH1}`);
    }
    if (r.checkForm) {
      assert.ok(html.includes('id="sale-form"'), "Has #sale-form");
      assert.ok(html.includes('id="result-heading"'), "Has #result-heading");
      assert.ok(html.includes('src="/src/app.js"'), "Has script /src/app.js");
      assert.ok(html.includes('id="fees-faq-schema"'), "Has FAQ schema");
      console.log("   Calculator UI & scripts verified on /fees/");
    }
  }

  console.log("\n--- 2. Testing Legacy Redirect ---");
  const redir = await fetch("https://shopprofitcalculator.com/etsy-fee-calculator", { redirect: "manual" });
  console.log(`Redirect status: ${redir.status}, Location: ${redir.headers.get("location")}`);
  assert.equal(redir.status, 301, "Legacy route redirects with 301");
  assert.equal(redir.headers.get("location"), "/fees/", "Redirects to /fees/");

  console.log("\n--- 3. Testing Preview Domain Header ---");
  const prev = await fetch("https://d0d28d76.shopprofitcalculator.pages.dev/fees/", { redirect: "manual" });
  const prevTag = prev.headers.get("x-robots-tag");
  console.log(`Preview status: ${prev.status}, X-Robots-Tag: ${prevTag}`);
  assert.equal(prev.status, 200, "Preview returns 200");
  assert.equal(prevTag, "noindex, nofollow", "Preview domain protected with noindex, nofollow");

  console.log("\n--- 4. Testing API Health & Version ---");
  const healthRes = await fetch("https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev/health");
  const healthJson = await healthRes.json();
  console.log("API health:", healthRes.status, healthJson);
  assert.equal(healthRes.status, 200);
  assert.equal(healthJson.status, "healthy");

  const verRes = await fetch("https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev/v1/version");
  const verJson = await verRes.json();
  console.log("API version:", verRes.status, verJson);
  assert.equal(verRes.status, 200);
  assert.equal(verJson.version_id, "v1.1.1");

  console.log("\nALL STEP 29 LIVE CHECKS PASSED!");
}

verifyLive().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
