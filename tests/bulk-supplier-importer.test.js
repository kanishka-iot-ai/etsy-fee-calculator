import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  SUPPLIER_PRESETS,
  generateSupplierCsvTemplate,
  exportCatalogToXlsx,
  calculateCatalogBatch,
  summarizeCatalog
} from "../src/bulk-catalog-analyzer.js";

import {
  decodeAndValidateCsvText,
  parseCsvRecords,
  mapCsvHeaders,
  CSV_HEADER_ALIASES
} from "../src/bulk-analyzer.js";

test("Supplier Presets: all 5 major suppliers defined with realistic product catalogs", () => {
  const expectedKeys = ["printify", "printful", "gelato", "aliexpress", "cjdropshipping"];
  assert.deepEqual(Object.keys(SUPPLIER_PRESETS), expectedKeys);

  for (const key of expectedKeys) {
    const preset = SUPPLIER_PRESETS[key];
    assert.ok(preset.name, `Preset ${key} has a name`);
    assert.ok(preset.badge, `Preset ${key} has a badge`);
    assert.ok(Array.isArray(preset.items), `Preset ${key} items is an array`);
    assert.equal(preset.items.length, 5, `Preset ${key} contains exactly 5 vetted items`);

    for (const item of preset.items) {
      assert.ok(item.product_name, "Item has product_name");
      assert.ok(parseFloat(item.item_price) > 0, "Item price is positive");
      assert.ok(parseFloat(item.production_cost) >= 0, "Production cost is non-negative");
      assert.ok(parseFloat(item.shipping_cost) >= 0, "Shipping cost is non-negative");
    }

    // Verify batch calculation runs cleanly across the preset
    const { results, summary } = calculateCatalogBatch(preset.items, { fallbackCountry: "US" });
    assert.equal(results.length, 5);
    assert.ok(summary.totalRevenue > 0, "Summary totalRevenue is positive");
    assert.ok(Number.isFinite(summary.totalProfit), "Summary totalProfit is finite");
    assert.ok(Number.isFinite(summary.averageMarginPct), "Summary averageMarginPct is finite");
  }
});

test("Supplier CSV Templates: generates valid RFC 4180 CSV with supplier-specific headers", () => {
  const suppliers = ["printify", "printful", "gelato", "aliexpress", "cjdropshipping"];

  for (const s of suppliers) {
    const csv = generateSupplierCsvTemplate(s);
    assert.ok(csv.length > 50, `Template for ${s} is populated`);
    const lines = csv.split("\r\n");
    assert.equal(lines.length, 6, `Template for ${s} has 1 header + 5 rows`);

    // Verify parsing with bulk-analyzer engine
    const { text } = decodeAndValidateCsvText(csv);
    const { headers, rows } = parseCsvRecords(text);
    assert.equal(rows.length, 5, `Parsed 5 rows for ${s}`);

    const { columnMap } = mapCsvHeaders(headers);
    assert.ok(columnMap.has("product_name"), `Mapped product_name for ${s}`);
    assert.ok(columnMap.has("item_price"), `Mapped item_price for ${s}`);
    assert.ok(columnMap.has("production_cost"), `Mapped production_cost for ${s}`);
    assert.ok(columnMap.has("shipping_cost"), `Mapped shipping_cost for ${s}`);
  }
});

test("Supplier Header Aliases: recognizes variations from all 5 suppliers", () => {
  const testHeaders = [
    "Printify Base Cost",
    "Printful Item Cost",
    "Gelato Base Price",
    "AliExpress Cost Price",
    "Drop Shipping Price",
    "CJ Packet Freight",
    "Choice Shipping Fee",
    "Fulfillment Cost"
  ];

  for (const h of testHeaders) {
    const norm = h.toLowerCase().replace(/[^a-z0-9]/g, "");
    const matchedCategory = Object.keys(CSV_HEADER_ALIASES).find((cat) =>
      CSV_HEADER_ALIASES[cat].includes(norm)
    );
    assert.ok(matchedCategory, `Header "${h}" (normalized "${norm}") matched an alias category`);
  }
});

test("Excel (.xlsx) Export: generates valid OpenXML ZIP package with custom number formats", async () => {
  const items = SUPPLIER_PRESETS.printify.items.map((it, idx) => ({
    ...it,
    id: `PRF-${idx + 1}`,
    rowNumber: idx + 1,
    itemPrice: parseFloat(it.item_price),
    shippingCharged: parseFloat(it.shipping_charged),
    grossRevenue: parseFloat(it.item_price) + parseFloat(it.shipping_charged),
    productionCost: parseFloat(it.production_cost),
    packagingCost: 0,
    shippingCost: parseFloat(it.shipping_cost),
    totalSellerCosts: parseFloat(it.production_cost) + parseFloat(it.shipping_cost),
    feeBreakdown: { listing: 0.2, transaction: 1.5, processing: 1.0, regulatory: 0.0 },
    totalEtsyFees: 2.7,
    netProfit: 12.5,
    marginPct: 45.2,
    roi: 95.0,
    breakEvenPrice: 14.8,
    offsite15NetProfit: 8.5,
    statusLabel: "Top Winner"
  }));

  const xlsxResult = exportCatalogToXlsx(items, new Set(["PRF-1"]), "US");
  const bytes = xlsxResult instanceof Uint8Array
    ? xlsxResult
    : Buffer.from(await xlsxResult.arrayBuffer());

  assert.ok(bytes.length > 5000, `XLSX package is reasonably sized: ${bytes.length} bytes`);

  // Verify ZIP local file header signature 0x04034b50 (little endian: 0x50, 0x4b, 0x03, 0x04)
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);
});

test("Navigation Unification: index.html has single Bulk Sourcing link and no duplicate Bulk CSV in nav", () => {
  const indexHtml = fs.readFileSync("index.html", "utf8");

  // Check desktop nav
  const desktopNavMatch = indexHtml.match(/<nav class="desktop-nav"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(desktopNavMatch, "Found desktop nav");
  const desktopNav = desktopNavMatch[1];
  assert.ok(desktopNav.includes('<a href="/bulk/">Bulk Sourcing</a>'), "Desktop nav has /bulk/ Bulk Sourcing");
  assert.ok(!desktopNav.includes("Bulk CSV"), "Desktop nav does NOT have duplicate Bulk CSV");

  // Check mobile nav
  const mobileNavMatch = indexHtml.match(/<nav class="mobile-menu"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(mobileNavMatch, "Found mobile nav");
  const mobileNav = mobileNavMatch[1];
  assert.ok(mobileNav.includes('<a href="/bulk/">Bulk Sourcing</a>'), "Mobile nav has /bulk/ Bulk Sourcing");
  assert.ok(!mobileNav.includes("Bulk CSV"), "Mobile nav does NOT have duplicate Bulk CSV");
});

test("Dedicated Bulk Page: bulk/index.html includes supplier selector, export buttons, and mobile menu", () => {
  const bulkHtml = fs.readFileSync("bulk/index.html", "utf8");

  assert.ok(bulkHtml.includes('id="supplier-preset-select"'), "Contains supplier preset select");
  assert.ok(bulkHtml.includes('id="export-xlsx-btn"'), "Contains export xlsx button");
  assert.ok(bulkHtml.includes('id="export-pdf-btn"'), "Contains export pdf button");
  assert.ok(bulkHtml.includes('id="executive-report-modal"'), "Contains executive report modal");
  assert.ok(bulkHtml.includes('id="menu-toggle"'), "Contains mobile menu toggle");
  assert.ok(bulkHtml.includes('id="mobile-menu"'), "Contains mobile menu");
});
