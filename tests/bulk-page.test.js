import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  GRID_COLUMNS,
  VIEW_PRESETS,
  EXPANDED_DEMO_CATALOG,
  calculateCatalogBatch,
  summarizeCatalog,
  filterAndSortCatalog,
  exportCatalogToCsv
} from "../src/bulk-catalog-analyzer.js";

test("bulk.html and bulk/index.html exist and satisfy SEO, A11y, and JSON-LD standards", async () => {
  const bulkHtml = await readFile(new URL("../bulk.html", import.meta.url), "utf8");
  const bulkIndexHtml = await readFile(new URL("../bulk/index.html", import.meta.url), "utf8");

  for (const [name, html] of [["bulk.html", bulkHtml], ["bulk/index.html", bulkIndexHtml]]) {
    assert.ok(html.includes("<title>Etsy Bulk Profit &amp; Sourcing Analyzer — ShopProfit</title>"), `${name} title`);
    assert.ok(html.includes('<link rel="canonical" href="https://shopprofitcalculator.com/bulk/">'), `${name} canonical`);
    assert.ok(html.includes('<h1 id="bulk-hero-heading" class="bulk-hero-title">Etsy Bulk Profit &amp; Sourcing Analyzer</h1>'), `${name} H1`);
    assert.ok(html.includes('property="og:url" content="https://shopprofitcalculator.com/bulk/"'), `${name} og:url`);
    assert.ok(html.includes('id="kpi-dashboard"'), `${name} KPI dashboard container`);
    assert.ok(html.includes('id="preset-view-select"'), `${name} view preset selector`);
    assert.ok(html.includes('id="grid-container"'), `${name} spreadsheet grid container`);
    assert.ok(html.includes('id="upload-wizard-modal"'), `${name} upload wizard modal`);
    assert.ok(html.includes('id="column-chooser-modal"'), `${name} column chooser modal`);
    assert.ok(html.includes('id="fee-receipt-modal"'), `${name} fee receipt modal`);
    assert.ok(html.includes('src="/src/bulk-page.js"'), `${name} bulk-page.js module script`);

    // Verify structured data
    const jsonMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(jsonMatch, `${name} has JSON-LD`);
    const parsed = JSON.parse(jsonMatch[1]);
    assert.ok(parsed["@graph"].some((n) => n["@type"] === "WebApplication"), `${name} WebApplication schema`);
  }
});

test("src/bulk-page.js enforces strict DOM safety and privacy invariants", async () => {
  const code = await readFile(new URL("../src/bulk-page.js", import.meta.url), "utf8");

  assert.equal(code.includes("innerHTML"), false, "src/bulk-page.js must have zero innerHTML");
  assert.equal(code.includes("insertAdjacentHTML"), false, "src/bulk-page.js must have zero insertAdjacentHTML");
  assert.equal(/\bfetch\s*\(/.test(code), false, "src/bulk-page.js must have zero fetch calls (100% private)");
  assert.equal(/\bXMLHttpRequest\b/.test(code), false, "src/bulk-page.js must have zero XMLHttpRequest calls");
});

test("Fee-Engine multi-market accuracy on bulk catalog batch calculations", () => {
  // Test across US, UK, and Germany
  const { results: usResults, summary: usSummary } = calculateCatalogBatch(EXPANDED_DEMO_CATALOG, {
    fallbackCountry: "US"
  });
  assert.equal(usResults.length, 10);
  assert.ok(usSummary.totalRevenue > 500);
  assert.ok(usSummary.totalProfit > 200);
  assert.ok(usSummary.winnerCount >= 4);

  const { results: ukResults, summary: ukSummary } = calculateCatalogBatch(EXPANDED_DEMO_CATALOG, {
    fallbackCountry: "UK"
  });
  assert.equal(ukResults.length, 10);
  assert.equal(ukResults[0].countryCode, "UK");
  assert.equal(ukResults[0].currency, "GBP");
  assert.ok(ukResults[0].totalEtsyFees > 0);

  const { results: deResults } = calculateCatalogBatch(EXPANDED_DEMO_CATALOG, {
    fallbackCountry: "DE"
  });
  assert.equal(deResults[0].currency, "EUR");
});

test("Bulk presets and column mapping cover all 23 financial and sourcing metrics", () => {
  assert.equal(GRID_COLUMNS.length, 23);
  const columnIds = new Set(GRID_COLUMNS.map((c) => c.id));

  for (const [presetKey, preset] of Object.entries(VIEW_PRESETS)) {
    for (const colId of preset.columns) {
      assert.ok(columnIds.has(colId), `Preset ${presetKey} column ${colId} is valid`);
    }
  }
});
