import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BULK_LIMITS,
  DEMO_PRODUCTS,
  EXPORT_CSV_HEADERS,
  normalizeHeaderName,
  mapCsvHeaders,
  decodeAndValidateCsvText,
  parseCsvRecords,
  previewBulkCsv,
  calculateBulkProducts,
  summarizeBulkResults,
  filterAndSortBulkResults,
  sanitizeCsvTextCell,
  generateSampleCsv,
  serializeBulkResultsToCsv,
  formatBulkCurrency
} from "../src/bulk-analyzer.js";
import {
  calculateOrderFees,
  solveRequiredPrice,
  resolveCountryFeeRule,
  STATUTORY_OFFSITE_ADS_CAP
} from "../src/fee-engine.js";

// ============================================================================
// 1. CSV PARSER EDGE CASES, BOM, QUOTES, AND LINE ENDINGS
// ============================================================================

test("Bulk CSV Parser: handles UTF-8 BOM in both string and Uint8Array inputs", () => {
  const csvWithBom = "\uFEFFproduct_name,item_price,shipping_charged\nCeramic Mug,35.00,5.00\n";
  const parsedStr = parseCsvRecords(csvWithBom);
  assert.equal(parsedStr.ok, true);
  assert.deepEqual(parsedStr.headers, ["product_name", "item_price", "shipping_charged"]);
  assert.equal(parsedStr.rows.length, 1);
  assert.deepEqual(parsedStr.rows[0].values, ["Ceramic Mug", "35.00", "5.00"]);

  const utf8BytesWithBom = new Uint8Array([
    0xef, 0xbb, 0xbf,
    ...new TextEncoder().encode("product_name,item_price\nSilver Ring,48.50\n")
  ]);
  const parsedBytes = parseCsvRecords(utf8BytesWithBom);
  assert.equal(parsedBytes.ok, true);
  assert.deepEqual(parsedBytes.headers, ["product_name", "item_price"]);
  assert.equal(parsedBytes.rows[0].values[0], "Silver Ring");
});

test("Bulk CSV Parser: handles quoted commas, escaped double quotes, CRLF, and LF line endings", () => {
  const csv = [
    'product_name,item_price,shipping_charged,production_cost,packaging_cost',
    '"Handmade Mug, 12oz "" Speckled "" Edition",35.00,5.00,7.00,4.00',
    '"Linen Tote, Large",28.50,4.00,6.25,2.10'
  ].join("\r\n") + "\n";

  const parsed = parseCsvRecords(csv);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].values[0], 'Handmade Mug, 12oz " Speckled " Edition');
  assert.equal(parsed.rows[1].values[0], "Linen Tote, Large");
});

test("Bulk CSV Parser: rejects unclosed quotes, quotes inside unquoted fields, and empty files", () => {
  const unclosed = 'product_name,item_price\n"Unclosed Mug,35.00';
  const res1 = parseCsvRecords(unclosed);
  assert.equal(res1.ok, false);
  assert.match(res1.error, /unclosed quoted field/i);

  const midQuote = 'product_name,item_price\nBad"QuoteMug,35.00';
  const res2 = parseCsvRecords(midQuote);
  assert.equal(res2.ok, false);
  assert.match(res2.error, /Malformed CSV quote/i);

  const afterQuote = 'product_name,item_price\n"Mug"extra,35.00';
  const res3 = parseCsvRecords(afterQuote);
  assert.equal(res3.ok, false);
  assert.match(res3.error, /unexpected character after closing quote/i);

  const empty = parseCsvRecords("   \r\n  ");
  assert.equal(empty.ok, false);
  assert.match(empty.error, /empty/i);

  const headersOnly = parseCsvRecords("product_name,item_price\r\n");
  assert.equal(headersOnly.ok, false);
  assert.match(headersOnly.error, /no product rows/i);
});

// ============================================================================
// 2. HEADERS, ALIASES, EXTRA COLUMNS, AND VALIDATION
// ============================================================================

test("Header mapping: rejects missing required columns and duplicate canonical columns", () => {
  const missingPrice = previewBulkCsv("product_name,shipping_charged\nMug,5.00\n");
  assert.equal(missingPrice.ok, false);
  assert.match(missingPrice.error, /Missing required CSV column\(s\): item_price/);

  const missingName = previewBulkCsv("item_price,shipping_charged\n35.00,5.00\n");
  assert.equal(missingName.ok, false);
  assert.match(missingName.error, /Missing required CSV column\(s\): product_name/);

  const duplicatePrice = previewBulkCsv("product_name,item_price,price\nMug,35.00,35.00\n");
  assert.equal(duplicatePrice.ok, false);
  assert.match(duplicatePrice.error, /Duplicate CSV column/);
});

test("Header mapping: records unknown extra columns without discarding valid product rows", () => {
  const csv = "SKU,Selling Price,Internal Warehouse Bin,Notes,Production Cost\nMUG-01,35.00,BIN-A4,Fragile,7.00\n";
  const preview = previewBulkCsv(csv, { countryCode: "US" });
  assert.equal(preview.ok, true);
  assert.equal(preview.validCount, 1);
  assert.equal(preview.invalidCount, 0);
  assert.deepEqual(preview.unknownHeaders, ["Internal Warehouse Bin", "Notes"]);
  assert.equal(preview.validRows[0].productName, "MUG-01");
  assert.equal(preview.validRows[0].itemPrice, 35);
  assert.equal(preview.validRows[0].productionCost, 7);
});

test("Row validation: reports invalid rows individually without discarding valid rows", () => {
  const csv = [
    "product_name,item_price,shipping_charged,production_cost,packaging_cost,country,offsite_ads,order_origin",
    "Valid Mug,35.00,5.00,7.00,4.00,US,none,domestic",
    ",25.00,0,5,2,US,none,domestic",
    "Zero Price Item,0,5.00,3.00,1.00,US,none,domestic",
    "Negative Cost Item,25.00,4.00,-3.00,1.00,US,none,domestic",
    "NaN Price Item,abc,4.00,3.00,1.00,US,none,domestic",
    "Hex Price Item,0x10,4.00,3.00,1.00,US,none,domestic",
    "Out of Range Item,100000000,4.00,3.00,1.00,US,none,domestic",
    "Unsupported Country Item,25.00,4.00,3.00,1.00,ZZ,none,domestic",
    "Bad Offsite Tier Item,25.00,4.00,3.00,1.00,US,25%,domestic",
    "Bad Origin Item,25.00,4.00,3.00,1.00,US,none,mars",
    "Second Valid Item,42.00,0,10.00,2.50,UK,12,international"
  ].join("\n");

  const preview = previewBulkCsv(csv, { countryCode: "US" });
  assert.equal(preview.ok, true);
  assert.equal(preview.validCount, 2);
  assert.equal(preview.invalidCount, 9);
  assert.equal(preview.validRows[0].productName, "Valid Mug");
  assert.equal(preview.validRows[1].productName, "Second Valid Item");

  const errorMessages = preview.invalidRows.map((r) => r.errors.join(" "));
  assert.match(errorMessages[0], /product_name is required/);
  assert.match(errorMessages[1], /item_price must be greater than 0/);
  assert.match(errorMessages[2], /production_cost cannot be negative/);
  assert.match(errorMessages[3], /item_price.*must be a valid finite number/);
  assert.match(errorMessages[4], /item_price.*must be a valid finite number/);
  assert.match(errorMessages[5], /item_price cannot exceed/);
  assert.match(errorMessages[6], /Unsupported country code "ZZ"/);
  assert.match(errorMessages[7], /Offsite Ads tier.*must be "none", "12", or "15"/);
  assert.match(errorMessages[8], /Order origin.*must be "domestic" or "international"/);
});

test("Row validation: distinguishes omitted optional fields from explicit zero values", () => {
  const csv = [
    "product_name,item_price,shipping_charged,target_profit",
    "Omitted Row,35.00,,",
    "Explicit Zero Row,35.00,0,0"
  ].join("\n");

  const preview = previewBulkCsv(csv, { countryCode: "US" });
  assert.equal(preview.ok, true);
  assert.equal(preview.validCount, 2);

  const omittedRow = preview.validRows[0];
  assert.ok(omittedRow.omittedFields.includes("shipping_charged"));
  assert.ok(omittedRow.omittedFields.includes("target_profit"));
  assert.equal(omittedRow.shippingCharged, 0);
  assert.equal(omittedRow.targetProfit, null);

  const explicitZeroRow = preview.validRows[1];
  assert.ok(!explicitZeroRow.omittedFields.includes("shipping_charged"));
  assert.ok(!explicitZeroRow.omittedFields.includes("target_profit"));
  assert.equal(explicitZeroRow.shippingCharged, 0);
  assert.equal(explicitZeroRow.targetProfit, 0);

  const { results } = calculateBulkProducts(preview.validRows, { countryCode: "US" });
  assert.equal(results[0].requiredPriceForTarget, null, "omitted target_profit must not invent a target price");
  assert.equal(results[1].requiredPriceForTarget, results[1].totals.breakEvenPrice, "explicit 0 target_profit equals break-even price");
});

// ============================================================================
// 3. RESOURCE LIMITS & BINARY / ENCODING GUARDS
// ============================================================================

test("Resource limits: enforces 1 MiB file size, 20 columns, 1,000 chars/line, and 500 data rows", () => {
  // 1. File size > 1 MiB
  const oversizedBytes = new Uint8Array(BULK_LIMITS.MAX_FILE_BYTES + 1);
  oversizedBytes.fill(65); // 'A'
  const sizeRes = parseCsvRecords(oversizedBytes);
  assert.equal(sizeRes.ok, false);
  assert.match(sizeRes.error, /exceeds the maximum allowed 1 MiB/);

  // 2. Column count > 20
  const twentyOneCols = Array.from({ length: 21 }, (_, i) => `col_${i}`).join(",") + "\n" +
    Array.from({ length: 21 }, () => "1").join(",");
  const colRes = parseCsvRecords(twentyOneCols);
  assert.equal(colRes.ok, false);
  assert.match(colRes.error, /exceeds the maximum limit of 20 columns/);

  // 3. Line length > 1,000 chars
  const longLine = "product_name,item_price\n" + "A".repeat(1005) + ",25.00\n";
  const lineRes = parseCsvRecords(longLine);
  assert.equal(lineRes.ok, false);
  assert.match(lineRes.error, /exceeds the maximum allowed length of 1,000 characters/);

  // 4. Row count > 500 data rows
  const fiveHundredOneRows = ["product_name,item_price"];
  for (let i = 1; i <= 501; i++) {
    fiveHundredOneRows.push(`Item ${i},25.00`);
  }
  const rowRes = parseCsvRecords(fiveHundredOneRows.join("\n"));
  assert.equal(rowRes.ok, false);
  assert.match(rowRes.error, /exceeds the maximum limit of 500 product rows/);

  // Exactly 500 rows succeeds
  const fiveHundredRows = fiveHundredOneRows.slice(0, 501).join("\n");
  const exactRes = parseCsvRecords(fiveHundredRows);
  assert.equal(exactRes.ok, true);
  assert.equal(exactRes.rows.length, 500);
});

test("Binary and encoding guards: rejects null bytes, control chars, invalid UTF-8, and lone surrogates", () => {
  // Null byte in Uint8Array
  const binaryBytes = new Uint8Array([0x70, 0x72, 0x6f, 0x00, 0x64]);
  const binRes = decodeAndValidateCsvText(binaryBytes);
  assert.equal(binRes.ok, false);
  assert.match(binRes.error, /binary data/i);

  // Invalid UTF-8 sequence in Uint8Array
  const invalidUtf8 = new Uint8Array([0x70, 0x72, 0xff, 0xfe, 0x64]);
  const utf8Res = decodeAndValidateCsvText(invalidUtf8);
  assert.equal(utf8Res.ok, false);
  assert.match(utf8Res.error, /invalid UTF-8/i);

  // Replacement character \uFFFD in string
  const replacementStr = "product_name,item_price\nBad\uFFFDMug,25.00";
  const repRes = decodeAndValidateCsvText(replacementStr);
  assert.equal(repRes.ok, false);
  assert.match(repRes.error, /replacement characters/i);

  // Lone UTF-16 high surrogate
  const loneSurrogate = "product_name,item_price\nBad\uD800Mug,25.00";
  const surRes = decodeAndValidateCsvText(loneSurrogate);
  assert.equal(surRes.ok, false);
  assert.match(surRes.error, /surrogate/i);
});

// ============================================================================
// 4. FORMULA INJECTION & SAFE DOM / XSS HANDLING
// ============================================================================

test("Formula injection defense: neutralizes =, +, -, @, tab, CR, leading spaces, and multiline formulas", () => {
  assert.equal(sanitizeCsvTextCell("=1+1"), "'=1+1");
  assert.equal(sanitizeCsvTextCell("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
  assert.equal(sanitizeCsvTextCell("-2+3"), "'-2+3");
  assert.equal(sanitizeCsvTextCell("@SUM(A1:A10)"), "'@SUM(A1:A10)");
  assert.equal(sanitizeCsvTextCell("\t=1+1"), "'\t=1+1");
  assert.equal(sanitizeCsvTextCell("   =HYPERLINK(\"http://evil.example\")"), "\"'   =HYPERLINK(\"\"http://evil.example\"\")\"");
  assert.equal(sanitizeCsvTextCell("Safe Line\n=EVIL()"), "\"Safe Line\n'=EVIL()\"");

  // Full pipeline export check with malicious product names
  const maliciousCsv = [
    "product_name,item_price,shipping_charged,production_cost,packaging_cost",
    '"=cmd|""/c calc""!A0",35.00,5.00,7.00,4.00',
    '"+SUM(1,2)",25.00,0.00,5.00,2.00',
    '"-10+20",25.00,0.00,5.00,2.00',
    '"@IMPORTXML(A1,B1)",25.00,0.00,5.00,2.00'
  ].join("\n");

  const preview = previewBulkCsv(maliciousCsv, { countryCode: "US" });
  assert.equal(preview.ok, true);
  const { results } = calculateBulkProducts(preview.validRows, { countryCode: "US" });
  const exported = serializeBulkResultsToCsv(results);
  const exportedLines = exported.trim().split("\r\n");

  assert.equal(exportedLines.length, 5); // 1 header + 4 rows
  assert.match(exportedLines[1], /^"'=cmd\|""\/c calc""!A0",/);
  assert.match(exportedLines[2], /^"'\+SUM\(1,2\)",/);
  assert.match(exportedLines[3], /^'-10\+20,/);
  assert.match(exportedLines[4], /^"'@IMPORTXML\(A1,B1\)",/);
});

test("XSS and safe DOM rendering: HTML/script-like product names are preserved as plain text and never passed to innerHTML", async () => {
  const xssName = '<img src=x onerror="alert(1)"><script>fetch("https://evil.example")</script>';
  const csv = `product_name,item_price\n"${xssName.replace(/"/g, '""')}",35.00\n`;
  const preview = previewBulkCsv(csv, { countryCode: "US" });
  assert.equal(preview.ok, true);
  const { results } = calculateBulkProducts(preview.validRows, { countryCode: "US" });
  assert.equal(results[0].productName, xssName);

  // Verify src/bulk-analyzer.js and bulk rendering functions in src/app.js never use innerHTML
  const [bulkSource, appSource] = await Promise.all([
    readFile(new URL("../src/bulk-analyzer.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app.js", import.meta.url), "utf8")
  ]);
  assert.equal(bulkSource.includes("innerHTML"), false, "src/bulk-analyzer.js must not contain innerHTML");
  assert.equal(bulkSource.includes("insertAdjacentHTML"), false, "src/bulk-analyzer.js must not contain insertAdjacentHTML");

  const bulkSectionInApp = appSource.slice(appSource.indexOf("const bulkState ="), appSource.indexOf("if (typeof document !== \"undefined\""));
  assert.ok(bulkSectionInApp.length > 500, "bulk controller found in src/app.js");
  assert.equal(bulkSectionInApp.includes("innerHTML"), false, "bulk controller in src/app.js must never use innerHTML");
  assert.equal(bulkSectionInApp.includes("insertAdjacentHTML"), false, "bulk controller in src/app.js must never use insertAdjacentHTML");
});

// ============================================================================
// 5. FEE-ENGINE PARITY ACROSS MARKETS & CURRENCIES
// ============================================================================

test("Fee-engine parity: US, UK, EU (DE/FR/BG), India (IN), Japan (JP), Canada (CA), Australia (AU), Türkiye (TR), Vietnam (VN)", () => {
  const testCases = [
    { name: "US Physical Mug", price: 35, shipping: 5, prod: 7, pack: 4, shipCost: 0, gift: 0, country: "US", origin: "domestic", ads: "none", target: 25 },
    { name: "UK Print with Reg Fee", price: 50, shipping: 10, prod: 12, pack: 3, shipCost: 2, gift: 5, country: "UK", origin: "domestic", ads: "12", target: 30 },
    { name: "Germany EUR Item", price: 42, shipping: 6, prod: 9, pack: 3, shipCost: 0, gift: 0, country: "DE", origin: "domestic", ads: "15", target: 20 },
    { name: "France EUR Reg Fee", price: 60, shipping: 8, prod: 15, pack: 4, shipCost: 0, gift: 0, country: "FR", origin: "domestic", ads: "none", target: 35 },
    { name: "Bulgaria EUR Payout", price: 45, shipping: 5, prod: 10, pack: 2, shipCost: 0, gift: 0, country: "BG", origin: "domestic", ads: "none", target: 25 },
    { name: "India Payoneer Item", price: 2500, shipping: 300, prod: 600, pack: 150, shipCost: 0, gift: 0, country: "IN", origin: "domestic", ads: "15", target: 1500 },
    { name: "Japan Zero-Decimal JPY", price: 4500, shipping: 800, prod: 1200, pack: 300, shipCost: 0, gift: 0, country: "JP", origin: "domestic", ads: "12", target: 2500 },
    { name: "Canada Domestic", price: 80, shipping: 12, prod: 20, pack: 5, shipCost: 0, gift: 0, country: "CA", origin: "domestic", ads: "none", target: 50 },
    { name: "Canada International", price: 80, shipping: 12, prod: 20, pack: 5, shipCost: 0, gift: 0, country: "CA", origin: "international", ads: "none", target: 50 },
    { name: "Australia International", price: 95, shipping: 15, prod: 25, pack: 6, shipCost: 0, gift: 0, country: "AU", origin: "international", ads: "15", target: 55 },
    { name: "Türkiye TRY Schedule", price: 1200, shipping: 150, prod: 350, pack: 80, shipCost: 0, gift: 0, country: "TR", origin: "domestic", ads: "none", target: 600 },
    { name: "Vietnam VND Zero-Decimal", price: 550000, shipping: 50000, prod: 150000, pack: 30000, shipCost: 0, gift: 0, country: "VN", origin: "domestic", ads: "none", target: 300000 }
  ];

  const csvLines = [
    "product_name,item_price,shipping_charged,production_cost,packaging_cost,shipping_cost,gift_wrap,country,order_origin,offsite_ads,target_profit"
  ];
  for (const tc of testCases) {
    csvLines.push([
      tc.name, tc.price, tc.shipping, tc.prod, tc.pack, tc.shipCost, tc.gift, tc.country, tc.origin, tc.ads, tc.target
    ].join(","));
  }

  const preview = previewBulkCsv(csvLines.join("\n"), { countryCode: "US" });
  assert.equal(preview.ok, true);
  assert.equal(preview.validCount, testCases.length);

  const { results } = calculateBulkProducts(preview.validRows, {
    plusEnabled: true,
    salesPerMonth: 25
  });

  results.forEach((bulkItem, idx) => {
    const tc = testCases[idx];
    const adRate = tc.ads === "15" ? 0.15 : (tc.ads === "12" ? 0.12 : 0);
    const rule = resolveCountryFeeRule(tc.country, { orderType: tc.origin });

    const directCalc = calculateOrderFees({
      country: tc.country,
      itemPrice: tc.price,
      shipping: tc.shipping,
      giftWrap: tc.gift,
      production: tc.prod,
      packaging: tc.pack,
      shippingCost: tc.shipCost,
      orderType: tc.origin,
      offsiteAds: adRate > 0,
      shopOffsiteAdsTier: adRate,
      plusEnabled: true,
      salesPerMonth: 25,
      listingCurrency: rule.currency,
      paymentAccountCurrency: rule.currency
    });

    const directTargetCents = solveRequiredPrice(tc.target, {
      country: tc.country,
      shipping: tc.shipping,
      giftWrap: tc.gift,
      production: tc.prod,
      packaging: tc.pack,
      shippingCost: tc.shipCost,
      orderType: tc.origin,
      offsiteAds: adRate > 0,
      shopOffsiteAdsTier: adRate,
      plusEnabled: true,
      salesPerMonth: 25,
      listingCurrency: rule.currency,
      paymentAccountCurrency: rule.currency
    });

    assert.deepEqual(bulkItem.feeBreakdown, directCalc.feeBreakdown, `${tc.name} feeBreakdown parity`);
    assert.deepEqual(bulkItem.totals, directCalc.totals, `${tc.name} totals parity`);
    assert.deepEqual(bulkItem.minorUnits, directCalc.minorUnits, `${tc.name} minorUnits parity`);
    assert.deepEqual(bulkItem.legacy, directCalc.legacy, `${tc.name} legacy parity`);
    assert.equal(bulkItem.requiredPriceCents, directTargetCents, `${tc.name} target price solver parity`);

    // Deposit fee invariant: never deducted as a per-sale fee
    const sumOfPerSaleFees =
      directCalc.minorUnits.listingFee +
      directCalc.minorUnits.transactionFee +
      directCalc.minorUnits.processingFee +
      directCalc.minorUnits.regulatoryFee +
      directCalc.minorUnits.offsiteAdsFee +
      directCalc.minorUnits.currencyConversionFee;
    assert.equal(bulkItem.minorUnits.totalEtsyFees, sumOfPerSaleFees, `${tc.name} excludes deposit fee from per-sale totalEtsyFees`);
  });
});

test("Offsite Ads scenarios, $100 USD cap preservation, and 15% ad loss risk detection", () => {
  const csv = [
    "product_name,item_price,shipping_charged,production_cost,packaging_cost,offsite_ads",
    "High Ticket Table,1200.00,0.00,400.00,50.00,15",
    "Thin Margin Tee,20.00,0.00,15.50,1.50,none"
  ].join("\n");

  const preview = previewBulkCsv(csv, { countryCode: "US" });
  const { results, summary } = calculateBulkProducts(preview.validRows, { countryCode: "US" });

  // 1. High Ticket Table: 15% of $1200 is $180, capped at $100 USD
  const highTicket = results[0];
  assert.equal(highTicket.feeBreakdown.offsiteAds, 100);
  assert.equal(highTicket.scenarios.offsiteAds15.feeBreakdown.offsiteAds, 100);
  assert.equal(highTicket.scenarios.offsiteAds12.feeBreakdown.offsiteAds, 100); // 12% of $1200 is $144 -> capped at $100
  assert.deepEqual(highTicket.metadata.offsiteAdsCap, STATUTORY_OFFSITE_ADS_CAP);

  // 2. Thin Margin Tee: profitable with no Offsite Ads, but unprofitable at 15% Offsite Ads
  const thinTee = results[1];
  assert.ok(thinTee.scenarios.noOffsiteAds.totals.totalProfit > 0, "profitable without Offsite Ads");
  assert.ok(thinTee.scenarios.offsiteAds15.totals.totalProfit < 0, "loss-making with 15% Offsite Ads");
  assert.equal(thinTee.becomesUnprofitableAt15Pct, true);
  assert.equal(thinTee.profitStatus, "thin_margin");
  assert.equal(summary.offsiteAds15RiskCount, 1);
});

// ============================================================================
// 6. SORTING, FILTERING, SAMPLE CSV, AND ENRICHED EXPORT
// ============================================================================

test("Sorting and filtering work across all supported views and metrics", () => {
  const sampleCsv = generateSampleCsv();
  const preview = previewBulkCsv(sampleCsv, { countryCode: "US" });
  assert.equal(preview.ok, true);
  assert.equal(preview.validCount, DEMO_PRODUCTS.length);

  const { results, summary } = calculateBulkProducts(preview.validRows, { countryCode: "US" });
  assert.equal(summary.productsAnalyzed, 5);
  assert.ok(summary.lossMakingCount >= 1, "demo catalog includes at least 1 loss-making product");
  assert.ok(summary.thinMarginCount >= 1, "demo catalog includes at least 1 thin-margin product");
  assert.ok(summary.offsiteAds15RiskCount >= 1, "demo catalog includes at least 1 15% Offsite Ads risk product");

  const lossesOnly = filterAndSortBulkResults(results, { filter: "losses" });
  assert.equal(lossesOnly.length, summary.lossMakingCount);
  assert.ok(lossesOnly.every((r) => r.minorUnits.netProfit < 0));

  const thinOnly = filterAndSortBulkResults(results, { filter: "thin_margin" });
  assert.equal(thinOnly.length, summary.thinMarginCount);
  assert.ok(thinOnly.every((r) => r.minorUnits.netProfit > 0 && r.totals.margin < BULK_LIMITS.THIN_MARGIN_THRESHOLD));

  const riskOnly = filterAndSortBulkResults(results, { filter: "offsite_risk" });
  assert.equal(riskOnly.length, summary.offsiteAds15RiskCount);
  assert.ok(riskOnly.every((r) => r.becomesUnprofitableAt15Pct));

  const sortedByMarginDesc = filterAndSortBulkResults(results, { filter: "all", sortBy: "margin", sortDir: "desc" });
  for (let i = 1; i < sortedByMarginDesc.length; i++) {
    assert.ok(sortedByMarginDesc[i - 1].totals.margin >= sortedByMarginDesc[i].totals.margin);
  }

  const sortedByProfitAsc = filterAndSortBulkResults(results, { filter: "all", sortBy: "netProfit", sortDir: "asc" });
  for (let i = 1; i < sortedByProfitAsc.length; i++) {
    assert.ok(sortedByProfitAsc[i - 1].totals.totalProfit <= sortedByProfitAsc[i].totals.totalProfit);
  }

  const exportedCsv = serializeBulkResultsToCsv(results);
  const exportedParsed = parseCsvRecords(exportedCsv, { maxColumns: EXPORT_CSV_HEADERS.length });
  assert.equal(exportedParsed.ok, true);
  assert.deepEqual(exportedParsed.headers, [...EXPORT_CSV_HEADERS]);
  assert.equal(exportedParsed.rows.length, 5);
});

// ============================================================================
// 7. PRIVACY & ZERO NETWORK TRANSMISSION VERIFICATION
// ============================================================================

test("Privacy invariant: CSV import, calculation, sorting, and export trigger zero network requests", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  globalThis.fetch = async (...args) => {
    fetchCallCount++;
    throw new Error(`Unexpected network call during bulk analysis: ${String(args[0])}`);
  };

  try {
    const sample = generateSampleCsv();
    const preview = previewBulkCsv(sample, { countryCode: "US" });
    const { results } = calculateBulkProducts(preview.validRows, { countryCode: "US" });
    const sorted = filterAndSortBulkResults(results, { filter: "all", sortBy: "netProfit", sortDir: "desc" });
    const exported = serializeBulkResultsToCsv(sorted);
    assert.ok(exported.length > 100);
    assert.equal(fetchCallCount, 0, "zero fetch calls made during entire bulk lifecycle");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const bulkSource = await readFile(new URL("../src/bulk-analyzer.js", import.meta.url), "utf8");
  assert.equal(/\bfetch\s*\(/.test(bulkSource), false, "src/bulk-analyzer.js contains no fetch() calls");
  assert.equal(/\bXMLHttpRequest\b/.test(bulkSource), false, "src/bulk-analyzer.js contains no XMLHttpRequest");
  assert.equal(/\bsendBeacon\b/.test(bulkSource), false, "src/bulk-analyzer.js contains no navigator.sendBeacon");
});
