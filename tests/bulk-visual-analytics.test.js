import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  computeMarginHistogram,
  computeCostWaterfall,
  computeScatterBounds,
  computeAdsSensitivityComparison,
  calculateCatalogBatch,
  EXPANDED_DEMO_CATALOG,
  SUPPLIER_PRESETS
} from "../src/bulk-catalog-analyzer.js";

test("Visual Analytics: computeMarginHistogram categorizes items correctly into 5 tiers", () => {
  const mockItems = [
    { id: "1", productName: "Loss item", margin: -5.0 },
    { id: "2", productName: "Thin margin item", margin: 8.5 },
    { id: "3", productName: "Standard item", margin: 22.0 },
    { id: "4", productName: "Healthy item", margin: 38.0 },
    { id: "5", productName: "Star winner item", margin: 55.0 }
  ];

  const hist = computeMarginHistogram(mockItems);
  assert.equal(hist.totalCount, 5);
  assert.equal(hist.buckets.losses.count, 1);
  assert.equal(hist.buckets.thin.count, 1);
  assert.equal(hist.buckets.standard.count, 1);
  assert.equal(hist.buckets.healthy.count, 1);
  assert.equal(hist.buckets.stars.count, 1);

  // Percentages must sum to 100%
  const totalPct = Object.values(hist.buckets).reduce((sum, b) => sum + b.pct, 0);
  assert.ok(Math.abs(totalPct - 100) < 0.001);

  // Test empty catalog
  const emptyHist = computeMarginHistogram([]);
  assert.equal(emptyHist.totalCount, 0);
  assert.equal(emptyHist.maxCount, 1);
  assert.equal(emptyHist.buckets.losses.count, 0);
});

test("Visual Analytics: computeMarginHistogram and computeScatterBounds handle both fractional ratios and percentages", () => {
  const ratioItems = [
    { id: "1", productName: "Item 1", itemPrice: 20, margin: 0.589, netProfit: 11.78 },
    { id: "2", productName: "Item 2", itemPrice: 40, marginPct: 58.9, netProfit: 23.56 }
  ];
  const hist = computeMarginHistogram(ratioItems);
  assert.equal(hist.buckets.stars.count, 2);

  const scatter = computeScatterBounds(ratioItems);
  assert.equal(scatter.points[0].margin, 58.9);
  assert.equal(scatter.points[1].margin, 58.9);
});

test("Visual Analytics: computeCostWaterfall maintains exact deduction accounting balance", () => {
  const { results, summary } = calculateCatalogBatch(EXPANDED_DEMO_CATALOG, { fallbackCountry: "US" });
  assert.ok(results.length > 0);

  const waterfall = computeCostWaterfall(results);
  assert.equal(waterfall.steps.length, 6);
  assert.ok(waterfall.grossRevenue > 0);
  assert.ok(waterfall.cogs > 0);
  assert.ok(waterfall.platformFees > 0);

  // Invariant: Gross Revenue - Total Deductions = Net Profit (within float precision)
  const calculatedNet = waterfall.grossRevenue - waterfall.totalDeductions;
  assert.ok(Math.abs(calculatedNet - waterfall.netProfit) < 0.05, `Accounting check: calculated ${calculatedNet} vs netProfit ${waterfall.netProfit}`);

  // Test that steps match
  const revStep = waterfall.steps.find((s) => s.id === "revenue");
  assert.equal(revStep.amount, waterfall.grossRevenue);
  assert.equal(revStep.pct, 100);

  const netStep = waterfall.steps.find((s) => s.id === "net_profit");
  assert.equal(netStep.amount, waterfall.netProfit);
});

test("Visual Analytics: computeScatterBounds classifies quadrants and computes bounds", () => {
  const { results } = calculateCatalogBatch(EXPANDED_DEMO_CATALOG, { fallbackCountry: "US" });
  const scatter = computeScatterBounds(results);

  assert.equal(scatter.points.length, results.length);
  assert.ok(scatter.maxPrice > scatter.minPrice);
  assert.ok(scatter.maxMargin > scatter.minMargin);
  assert.ok(scatter.medianPrice > 0);
  assert.equal(scatter.targetMargin, 30);

  // Check each point has valid coordinates and quadrant label
  for (const pt of scatter.points) {
    assert.ok(Number.isFinite(pt.price));
    assert.ok(Number.isFinite(pt.margin));
    assert.ok(Number.isFinite(pt.profit));
    assert.ok(["star", "gem", "trap", "thin", "bleeder", "standard"].includes(pt.quadrant));
    assert.ok(pt.color.startsWith("#"));
  }

  // Test empty array fallback
  const emptyScatter = computeScatterBounds([]);
  assert.equal(emptyScatter.points.length, 0);
  assert.equal(emptyScatter.minPrice, 0);
});

test("Visual Analytics: computeAdsSensitivityComparison accurately computes profit erosion under 15% ads", () => {
  const { results } = calculateCatalogBatch(SUPPLIER_PRESETS.printify.items, { fallbackCountry: "US" });
  const adsComp = computeAdsSensitivityComparison(results);

  assert.equal(adsComp.totalItems, 5);
  assert.ok(adsComp.organicProfit > 0);
  assert.ok(adsComp.adsProfit < adsComp.organicProfit, "15% ads must erode net profit");
  assert.ok(adsComp.erosionDollar > 0);
  assert.ok(adsComp.erosionPct > 0);
  assert.ok(adsComp.organicMargin > adsComp.adsMargin);
  assert.equal(typeof adsComp.atRiskCount, "number");
});

test("Visual Analytics: bulk/index.html includes dashboard markup and 4 chart containers", () => {
  const html = fs.readFileSync(new URL("../bulk/index.html", import.meta.url), "utf8");
  assert.ok(html.includes('id="visual-analytics-panel"'), "has visual-analytics-panel");
  assert.ok(html.includes('id="scatter-chart-wrap"'), "has scatter-chart-wrap");
  assert.ok(html.includes('id="histogram-chart-wrap"'), "has histogram-chart-wrap");
  assert.ok(html.includes('id="waterfall-chart-wrap"'), "has waterfall-chart-wrap");
  assert.ok(html.includes('id="ads-sensitivity-chart-wrap"'), "has ads-sensitivity-chart-wrap");
  assert.ok(html.includes('id="view-split-btn"'), "has view-split-btn");
  assert.ok(html.includes('id="view-grid-btn"'), "has view-grid-btn");
  assert.ok(html.includes('id="view-charts-btn"'), "has view-charts-btn");
  assert.ok(html.includes('id="toggle-charts-collapse-btn"'), "has toggle-charts-collapse-btn");
  assert.ok(html.includes('id="chart-tooltip"'), "has chart-tooltip");
});

