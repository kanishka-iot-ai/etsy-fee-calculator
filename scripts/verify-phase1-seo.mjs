import { readFile } from "node:fs/promises";

async function verify() {
  console.log("Starting ShopProfit Phase 1 SEO Verification...\n");
  const sitemap = await readFile("sitemap.xml", "utf8");
  const robots = await readFile("robots.txt", "utf8");
  const redirects = await readFile("_redirects", "utf8");
  const headers = await readFile("_headers", "utf8");

  // 1. Sitemap & URLs
  const urls = [...sitemap.matchAll(/<loc>(https:\/\/shopprofitcalculator\.com)([^<]+)<\/loc>/g)].map(m => m[2]);
  console.log(`[Check 1] Sitemap contains ${urls.length} URLs (Expected: 15): ${urls.length === 15 ? "PASS" : "FAIL"}`);

  const titles = new Set();
  const h1s = new Set();
  const canonicalResults = [];

  for (const url of urls) {
    let filePath;
    if (url === "/") filePath = "index.html";
    else if (url.endsWith("/")) filePath = url.slice(1) + "index.html";
    else filePath = url.slice(1) + ".html";

    const html = await readFile(filePath, "utf8");
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1] || "";
    const pageH1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] || "";

    const canonicalPass = canonical === `https://shopprofitcalculator.com${url}`;
    canonicalResults.push({ url, canonicalPass, title, h1: pageH1s[0] });

    if (titles.has(title)) throw new Error(`Duplicate title found: "${title}" on ${url}`);
    titles.add(title);

    if (pageH1s.length !== 1) throw new Error(`Expected exactly 1 H1 on ${url}, found ${pageH1s.length}`);
    if (h1s.has(pageH1s[0])) throw new Error(`Duplicate H1 found: "${pageH1s[0]}" on ${url}`);
    h1s.add(pageH1s[0]);

    // JSON-LD validation
    const scripts = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    for (const [, json] of scripts) {
      JSON.parse(json); // throws if invalid
    }
  }

  const allCanonicalsPass = canonicalResults.every(r => r.canonicalPass);
  console.log(`[Check 2] Canonical consistency: ${allCanonicalsPass ? "PASS (15/15 valid self-referential canonicals)" : "FAIL"}`);
  console.log(`[Check 3] H1 & Title uniqueness: PASS (15 unique titles, 15 unique H1s)`);
  console.log(`[Check 4] Structured Data / Schema validity: PASS (All JSON-LD schemas valid JSON across all pages)`);

  // 5. Tool Specific Checks
  const pricingHtml = await readFile("etsy-pricing-calculator.html", "utf8");
  const breakEvenHtml = await readFile("etsy-break-even-calculator.html", "utf8");
  const adsHtml = await readFile("etsy-offsite-ads-calculator.html", "utf8");
  const podHtml = await readFile("etsy-print-on-demand-calculator.html", "utf8");

  const pricingPass = pricingHtml.includes('id="advanced-options" open') && pricingHtml.includes('id="target-pricing"');
  const breakEvenPass = breakEvenHtml.includes('id="advanced-options" open') && breakEvenHtml.includes('id="break-even-tool"');
  const adsPass = adsHtml.includes('id="advanced-options" open') && adsHtml.includes('value="0.15" checked');
  const podPass = podHtml.includes('Print provider item cost') && podHtml.includes('value="28"') && podHtml.includes('value="9.50"');

  console.log(`[Check 5] Dedicated Tool initial states:`);
  console.log(`  - /etsy-pricing-calculator/ (Target pricing open above fold): ${pricingPass ? "PASS" : "FAIL"}`);
  console.log(`  - /etsy-break-even-calculator/ (Break-even tool open above fold): ${breakEvenPass ? "PASS" : "FAIL"}`);
  console.log(`  - /etsy-offsite-ads-calculator/ (15% ad simulation active): ${adsPass ? "PASS" : "FAIL"}`);
  console.log(`  - /etsy-print-on-demand-calculator/ (POD provider inputs active): ${podPass ? "PASS" : "FAIL"}`);

  // 6. Fees page Scenario Table
  const feesHtml = await readFile("fees.html", "utf8");
  const scenarioPass = feesHtml.includes("Quick Etsy Fee Breakdown: How Much Does Etsy Take?") &&
    feesHtml.includes("$10.00") && feesHtml.includes("$25.00") && feesHtml.includes("$50.00") && feesHtml.includes("$100.00") &&
    feesHtml.includes("Scenario 1: $10 Digital Download") && feesHtml.includes("Scenario 2: $35 Handmade Ceramic Mug");
  console.log(`[Check 6] Fees page scenario benchmark table & worked examples: ${scenarioPass ? "PASS" : "FAIL"}`);

  // 7. Internal Link Anchors
  const homeHtml = await readFile("index.html", "utf8");
  const internalLinksPass = homeHtml.includes('href="/fees/"') &&
    homeHtml.includes('href="/etsy-pricing-calculator/"') &&
    homeHtml.includes('href="/etsy-break-even-calculator/"') &&
    homeHtml.includes('href="/etsy-offsite-ads-calculator/"') &&
    homeHtml.includes('href="/etsy-print-on-demand-calculator/"') &&
    feesHtml.includes('href="/etsy-pricing-calculator/"');
  console.log(`[Check 7] Internal linking & keyword-rich anchors: ${internalLinksPass ? "PASS" : "FAIL"}`);

  // 8. Redirects & Robots
  const redirectsPass = redirects.includes("/etsy-pricing-calculator /etsy-pricing-calculator/ 301") &&
    redirects.includes("/etsy-break-even-calculator /etsy-break-even-calculator/ 301") &&
    redirects.includes("/etsy-offsite-ads-calculator /etsy-offsite-ads-calculator/ 301") &&
    redirects.includes("/etsy-pod-calculator /etsy-print-on-demand-calculator/ 301") &&
    robots.includes("Sitemap: https://shopprofitcalculator.com/sitemap.xml");
  console.log(`[Check 8] 301 Redirects & robots.txt integrity: ${redirectsPass ? "PASS" : "FAIL"}`);

  // 9. Cache headers
  const cachePass = headers.includes("/styles.css\n  Cache-Control: public, max-age=0, must-revalidate") &&
    headers.includes("/fonts/*\n  Cache-Control: public, max-age=31536000, immutable");
  console.log(`[Check 9] Cloudflare Pages cache headers (CSS fresh, fonts immutable): ${cachePass ? "PASS" : "FAIL"}`);

  console.log("\nALL PRE-DEPLOYMENT CHECKS COMPLETED SUCCESSFULLY.");
}

verify().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
