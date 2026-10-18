import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  calculateCatalogBatch,
  summarizeCatalog,
  filterAndSortCatalog,
  exportCatalogToCsv,
  EXPANDED_DEMO_CATALOG,
  GRID_COLUMNS,
  VIEW_PRESETS
} from "../src/bulk-catalog-analyzer.js";

test("calculateCatalogBatch: accurately computes fees, net profit, margin, and ROI on demo catalog", () => {
  const { results, summary } = calculateCatalogBatch(EXPANDED_DEMO_CATALOG, {
    fallbackCountry: "US"
  });

  assert.equal(results.length, 10, "processes all 10 demo items");
  assert.equal(summary.totalCount, 10);
  assert.ok(summary.totalRevenue > 400);
  assert.ok(summary.totalProfit > 100);

  // Check Ceramic Mug (Item 0: $34 item price + $5 shipping = $39 gross)
  const mug = results[0];
  assert.equal(mug.grossRevenue, 39.00);
  assert.equal(mug.totalSellerCosts, 8.50 + 1.50 + 4.80); // 14.80
  assert.ok(mug.netProfit > 18.00 && mug.netProfit < 21.00);
  assert.ok(mug.roi > 100, "ROI is greater than 100%");
  assert.equal(mug.currency, "USD");
  assert.equal(mug.status, "winner");

  // Check Digital Planner (Item 1: $14.99 price, $0 shipping, $0 costs)
  const digital = results[1];
  assert.equal(digital.grossRevenue, 14.99);
  assert.equal(digital.totalSellerCosts, 0);
  assert.ok(digital.netProfit > 12.00);
  assert.equal(digital.roi, 100, "digital product with 0 cost defaults to 100% ROI");

  // Check Clearance Pin (Item 6: $8.50 price + $3.50 shipping = $12.00, high cost $7.80)
  const pin = results[6];
  assert.equal(pin.grossRevenue, 12.00);
  assert.ok(pin.netProfit < 4.00);
});

test("filterAndSortCatalog: filtering by favorites, winners, high ROI, and search query", () => {
  const { results } = calculateCatalogBatch(EXPANDED_DEMO_CATALOG, { fallbackCountry: "US" });
  const favoritesSet = new Set([results[0].id, results[2].id]);

  // 1. Filter by favorites tab
  const favFiltered = filterAndSortCatalog(results, {
    filterTab: "favorites",
    favoritesSet
  });
  assert.equal(favFiltered.length, 2);
  assert.equal(favFiltered[0].id, results[0].id);

  // 2. Filter by search query "planner"
  const searchFiltered = filterAndSortCatalog(results, {
    searchQuery: "planner"
  });
  assert.equal(searchFiltered.length, 1);
  assert.ok(searchFiltered[0].productName.includes("Planner"));

  // 3. Filter by high ROI (>= 50%)
  const highRoiFiltered = filterAndSortCatalog(results, {
    filterTab: "high_roi"
  });
  assert.ok(highRoiFiltered.length > 0);
  for (const item of highRoiFiltered) {
    assert.ok(item.roi >= 50);
  }

  // 4. Sorting by net profit descending
  const sorted = filterAndSortCatalog(results, {
    sortBy: "netProfit",
    sortDir: "desc"
  });
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i - 1].netProfit >= sorted[i].netProfit);
  }
});

test("exportCatalogToCsv: produces valid CSV and sanitizes formula injection", () => {
  const maliciousItems = [
    {
      rowNumber: 1,
      id: "SKU-001",
      productName: "=cmd|' /C calc'!A0",
      category: "Tools",
      countryCode: "US",
      currency: "USD",
      itemPrice: 20.00,
      shippingCharged: 0.00,
      grossRevenue: 20.00,
      productionCost: 5.00,
      packagingCost: 1.00,
      shippingCost: 3.00,
      totalSellerCosts: 9.00,
      feeBreakdown: { listing: 0.20, transaction: 1.30, processing: 0.80, regulatory: 0 },
      totalEtsyFees: 2.30,
      netProfit: 8.70,
      marginPct: 43.50,
      roi: 96.67,
      breakEvenPrice: 10.45,
      offsite15NetProfit: 5.70,
      becomesUnprofitableAt15Pct: false,
      statusLabel: "Profitable"
    }
  ];

  const csv = exportCatalogToCsv(maliciousItems, new Set(["SKU-001"]));
  assert.ok(csv.includes("'=cmd|' /C calc'!A0"), "formula was prefixed with single quote");
  assert.ok(csv.includes("★"), "favorite mark exported");
});

test("GRID_COLUMNS and VIEW_PRESETS conform to specifications", () => {
  assert.ok(GRID_COLUMNS.length >= 20, "contains at least 20 grid columns");
  assert.ok(VIEW_PRESETS.full);
  assert.ok(VIEW_PRESETS.sourcing);
  assert.ok(VIEW_PRESETS.winners);
  assert.ok(VIEW_PRESETS.fees);
  assert.ok(VIEW_PRESETS.ads);
});

test("Code safety invariants: src/bulk-catalog-analyzer.js has no innerHTML and no network calls", async () => {
  const code = await readFile(new URL("../src/bulk-catalog-analyzer.js", import.meta.url), "utf8");
  assert.equal(code.includes("innerHTML"), false, "no innerHTML");
  assert.equal(code.includes("insertAdjacentHTML"), false, "no insertAdjacentHTML");
  assert.equal(/\bfetch\s*\(/.test(code), false, "no fetch calls");
  assert.equal(/\bXMLHttpRequest\b/.test(code), false, "no XMLHttpRequest");
});
