/**
 * ShopProfit — Advanced Bulk Catalog & Sourcing Profit Engine
 *
 * Inspired by professional bulk analysis software (Analyzer.Tools),
 * tailored specifically for Etsy sellers, multi-item shops, and wholesale sourcing catalogs.
 *
 * SAFETY & ARCHITECTURAL INVARIANTS:
 * - 100% Client-Side Processing: Zero network calls, zero data uploads, complete confidentiality.
 * - Strict Calculation Parity: Computes all fees, margins, and break-even points through src/fee-engine.js.
 * - Formula & XSS Injection Protection: Employs RFC 4180 parsing, single-quote formula prefixing,
 *   and strict DOM text-node rendering (zero unsafe markup injections).
 * - Multi-Market Support: 62 international Etsy Payment jurisdictions supported.
 */

import {
  calculateOrderFees,
  solveRequiredPrice,
  resolveCountryFeeRule,
  getCurrencyMinorUnitDigits,
  formatMoney,
  GLOBAL_COUNTRY_RULES
} from "./fee-engine.js";

import {
  BULK_LIMITS,
  CSV_HEADER_ALIASES,
  REQUIRED_CSV_COLUMNS,
  decodeAndValidateCsvText,
  parseCsvRecords,
  mapCsvHeaders,
  previewBulkCsv,
  sanitizeCsvTextCell,
  formatBulkCurrency
} from "./bulk-analyzer.js";

export {
  BULK_LIMITS,
  decodeAndValidateCsvText,
  parseCsvRecords,
  mapCsvHeaders,
  previewBulkCsv,
  sanitizeCsvTextCell,
  formatBulkCurrency
};

/**
 * Enhanced Column definitions for the interactive Analyzer.Tools-style grid.
 */
export const GRID_COLUMNS = Object.freeze([
  { id: "favorite", label: "Fav", category: "meta", align: "center", minWidth: 48, defaultVisible: true },
  { id: "rowNumber", label: "#", category: "meta", align: "center", minWidth: 44, defaultVisible: true },
  { id: "productName", label: "Product Title & SKU", category: "product", align: "left", minWidth: 220, defaultVisible: true },
  { id: "category", label: "Category", category: "product", align: "left", minWidth: 110, defaultVisible: true },
  { id: "itemPrice", label: "Listing Price", category: "revenue", align: "right", minWidth: 100, defaultVisible: true },
  { id: "shippingCharged", label: "Buyer Shipping", category: "revenue", align: "right", minWidth: 100, defaultVisible: false },
  { id: "grossRevenue", label: "Gross Revenue", category: "revenue", align: "right", minWidth: 105, defaultVisible: true },
  { id: "productionCost", label: "Unit COGS", category: "costs", align: "right", minWidth: 95, defaultVisible: true },
  { id: "packagingCost", label: "Packaging", category: "costs", align: "right", minWidth: 90, defaultVisible: false },
  { id: "shippingCost", label: "Seller Postage", category: "costs", align: "right", minWidth: 100, defaultVisible: false },
  { id: "totalCosts", label: "Total Costs", category: "costs", align: "right", minWidth: 105, defaultVisible: true },
  { id: "transactionFee", label: "Tx Fee (6.5%)", category: "fees", align: "right", minWidth: 100, defaultVisible: false },
  { id: "processingFee", label: "Processing Fee", category: "fees", align: "right", minWidth: 105, defaultVisible: false },
  { id: "regulatoryFee", label: "Regulatory Fee", category: "fees", align: "right", minWidth: 100, defaultVisible: false },
  { id: "listingFee", label: "Listing Fee", category: "fees", align: "right", minWidth: 95, defaultVisible: false },
  { id: "totalEtsyFees", label: "Total Etsy Fees", category: "fees", align: "right", minWidth: 110, defaultVisible: true },
  { id: "netProfit", label: "Net Profit", category: "profit", align: "right", minWidth: 110, defaultVisible: true },
  { id: "margin", label: "Margin %", category: "profit", align: "right", minWidth: 95, defaultVisible: true },
  { id: "roi", label: "ROI %", category: "profit", align: "right", minWidth: 95, defaultVisible: true },
  { id: "breakEvenPrice", label: "Break-Even", category: "sourcing", align: "right", minWidth: 100, defaultVisible: true },
  { id: "offsite15Profit", label: "15% Ads Net", category: "ads", align: "right", minWidth: 105, defaultVisible: true },
  { id: "status", label: "Status Badge", category: "status", align: "center", minWidth: 120, defaultVisible: true },
  { id: "actions", label: "Actions", category: "meta", align: "center", minWidth: 70, defaultVisible: true }
]);

/**
 * Built-in Preset Views (matching Analyzer.Tools workflow patterns).
 */
export const VIEW_PRESETS = Object.freeze({
  full: {
    id: "full",
    label: "Full Data View (All Columns)",
    columns: GRID_COLUMNS.map((c) => c.id)
  },
  sourcing: {
    id: "sourcing",
    label: "Sourcing & ROI View",
    columns: ["favorite", "rowNumber", "productName", "category", "itemPrice", "productionCost", "totalCosts", "netProfit", "margin", "roi", "breakEvenPrice", "status", "actions"]
  },
  winners: {
    id: "winners",
    label: "Potential Winners (High Margin)",
    columns: ["favorite", "rowNumber", "productName", "itemPrice", "totalCosts", "totalEtsyFees", "netProfit", "margin", "roi", "status", "actions"]
  },
  fees: {
    id: "fees",
    label: "Fee Breakdown View",
    columns: ["favorite", "rowNumber", "productName", "itemPrice", "grossRevenue", "listingFee", "transactionFee", "processingFee", "regulatoryFee", "totalEtsyFees", "netProfit", "status"]
  },
  ads: {
    id: "ads",
    label: "Offsite Ads Vulnerability View",
    columns: ["favorite", "rowNumber", "productName", "itemPrice", "totalCosts", "totalEtsyFees", "netProfit", "margin", "offsite15Profit", "status", "actions"]
  }
});

/**
 * Expanded 10-Item High-Fidelity Demo Catalog
 */
export const EXPANDED_DEMO_CATALOG = Object.freeze([
  {
    product_name: "Handmade Ceramic Mug 12oz (SKU: MUG-CER-01)",
    item_price: "34.00",
    shipping_charged: "5.00",
    production_cost: "8.50",
    packaging_cost: "1.50",
    shipping_cost: "4.80",
    category: "Home & Living",
    order_origin: "domestic"
  },
  {
    product_name: "Digital Wedding Planner & Budget Sheets (SKU: DIG-WED-99)",
    item_price: "14.99",
    shipping_charged: "0.00",
    production_cost: "0.00",
    packaging_cost: "0.00",
    shipping_cost: "0.00",
    category: "Digital Downloads",
    order_origin: "domestic"
  },
  {
    product_name: "Print-on-Demand Vintage Floral Tee (SKU: POD-TEE-04)",
    item_price: "26.50",
    shipping_charged: "4.50",
    production_cost: "14.00",
    packaging_cost: "0.00",
    shipping_cost: "4.50",
    category: "Apparel",
    order_origin: "domestic"
  },
  {
    product_name: "Handcrafted Full-Grain Leather Wallet (SKU: LTH-WAL-12)",
    item_price: "58.00",
    shipping_charged: "0.00",
    production_cost: "16.00",
    packaging_cost: "2.50",
    shipping_cost: "4.20",
    category: "Accessories",
    order_origin: "domestic"
  },
  {
    product_name: "Sterling Silver Minimalist Birthstone Ring (SKU: JWE-RNG-07)",
    item_price: "42.00",
    shipping_charged: "3.50",
    production_cost: "9.20",
    packaging_cost: "3.00",
    shipping_cost: "3.80",
    category: "Jewelry",
    order_origin: "domestic"
  },
  {
    product_name: "Hand-Poured Soy Wax Aromatherapy Candle (SKU: CND-SOY-08)",
    item_price: "24.00",
    shipping_charged: "6.00",
    production_cost: "6.50",
    packaging_cost: "1.80",
    shipping_cost: "5.50",
    category: "Home & Living",
    order_origin: "domestic"
  },
  {
    product_name: "Hard Enamel Cat Lapel Pin (Clearance) (SKU: PIN-CAT-02)",
    item_price: "8.50",
    shipping_charged: "3.50",
    production_cost: "3.20",
    packaging_cost: "0.80",
    shipping_cost: "3.80",
    category: "Collectibles",
    order_origin: "domestic"
  },
  {
    product_name: "Boho Macrame Geometric Wall Hanging (SKU: MAC-WAL-15)",
    item_price: "68.00",
    shipping_charged: "9.00",
    production_cost: "18.50",
    packaging_cost: "4.00",
    shipping_cost: "8.50",
    category: "Art & Decor",
    order_origin: "domestic"
  },
  {
    product_name: "Mid-Century Modern Wall Art 3-Piece Pack (SKU: DIG-ART-03)",
    item_price: "18.00",
    shipping_charged: "0.00",
    production_cost: "0.00",
    packaging_cost: "0.00",
    shipping_cost: "0.00",
    category: "Digital Downloads",
    order_origin: "domestic"
  },
  {
    product_name: "Chunky Merino Wool Hand-Knit Blanket (SKU: BLK-WOL-88)",
    item_price: "195.00",
    shipping_charged: "15.00",
    production_cost: "72.00",
    packaging_cost: "6.50",
    shipping_cost: "14.50",
    category: "Luxury Home",
    order_origin: "domestic"
  }
]);

/**
 * Calculates complete Etsy profit, ROI, break-even, and fee metrics for an array of products.
 */
export function calculateCatalogBatch(validRows = [], options = {}) {
  const plusEnabled = Boolean(options.plusEnabled);
  const salesPerMonth = Math.max(1, Math.min(10_000, Number(options.salesPerMonth) || 30));
  const fallbackCountry = options.fallbackCountry || "US";
  const defaultOffsiteRate = Number(options.defaultOffsiteRate) || 0;

  const results = validRows.map((row, index) => {
    const countryCode = row.countryCode || row.country || fallbackCountry;
    const rule = resolveCountryFeeRule(countryCode, { orderType: row.orderOrigin || row.order_origin || "domestic" });
    const currency = String(row.listingCurrency || row.currency || rule.currency || "USD").toUpperCase();

    const itemPrice = Number(row.itemPrice ?? row.item_price) || 0;
    const shippingCharged = Number(row.shippingCharged ?? row.shipping_charged) || 0;
    const giftWrap = Number(row.giftWrap ?? row.gift_wrap) || 0;
    const buyerSalesTax = Number(row.buyerSalesTax ?? row.buyer_sales_tax) || 0;

    const productionCost = Number(row.productionCost ?? row.production_cost) || 0;
    const packagingCost = Number(row.packagingCost ?? row.packaging_cost) || 0;
    const shippingCost = Number(row.shippingCost ?? row.shipping_cost) || 0;

    const totalSellerCosts = productionCost + packagingCost + shippingCost;
    const offsiteAdsRate = row.offsiteAdsRate !== undefined && row.offsiteAdsRate !== null
      ? row.offsiteAdsRate
      : (row.offsite_ads_tier !== undefined && row.offsite_ads_tier !== null ? Number(row.offsite_ads_tier) : defaultOffsiteRate);

    const baseInputs = {
      country: countryCode,
      itemPrice,
      shipping: shippingCharged,
      giftWrap,
      buyerSalesTax,
      production: productionCost,
      packaging: packagingCost,
      shippingCost,
      orderType: row.orderOrigin || row.order_origin || "domestic",
      plusEnabled,
      salesPerMonth,
      listingCurrency: currency,
      paymentAccountCurrency: currency
    };

    // 1. Current selected order fees
    const selectedCalc = calculateOrderFees({
      ...baseInputs,
      offsiteAds: offsiteAdsRate > 0,
      shopOffsiteAdsTier: offsiteAdsRate
    });

    // 2. Baseline without Offsite Ads (0%)
    const noAdsCalc = offsiteAdsRate === 0
      ? selectedCalc
      : calculateOrderFees({
          ...baseInputs,
          offsiteAds: false,
          shopOffsiteAdsTier: 0
        });

    // 3. 15% Offsite Ads Attribution scenario
    const offsite15Calc = offsiteAdsRate === 0.15
      ? selectedCalc
      : calculateOrderFees({
          ...baseInputs,
          offsiteAds: true,
          shopOffsiteAdsTier: 0.15
        });

    // Break-Even unit price
    const breakEvenCents = solveRequiredPrice(0, {
      ...baseInputs,
      offsiteAds: false,
      shopOffsiteAdsTier: 0
    });
    const digits = getCurrencyMinorUnitDigits(currency);
    const breakEvenPrice = digits === 0 ? Math.round(breakEvenCents / 100) : breakEvenCents / 100;

    const grossRevenue = selectedCalc.bases.transactionBase;
    const totalEtsyFees = selectedCalc.totals.totalEtsyFees;
    const netProfit = selectedCalc.totals.totalProfit ?? selectedCalc.totals.netProfit ?? 0;
    const margin = selectedCalc.totals.margin ?? 0;
    const marginPct = margin * 100;

    // Return on Investment (ROI): Net Profit divided by Seller Out-of-Pocket Costs
    const roi = totalSellerCosts > 0
      ? (netProfit / totalSellerCosts) * 100
      : (netProfit > 0 ? 100 : 0);

    const offsite15NetProfit = offsite15Calc.totals.totalProfit ?? offsite15Calc.totals.netProfit ?? 0;
    const offsite15MarginPct = (offsite15Calc.totals.margin ?? 0) * 100;

    // Classify profit status
    let status = "profitable";
    let statusLabel = "Profitable";

    if (netProfit < 0) {
      status = "loss";
      statusLabel = "Loss-Making";
    } else if (netProfit === 0) {
      status = "break_even";
      statusLabel = "Break-Even";
    } else if (margin < 0.15) {
      status = "thin_margin";
      statusLabel = "Thin Margin (<15%)";
    } else if (netProfit > 0 && offsite15NetProfit <= 0) {
      status = "ads_risk";
      statusLabel = "15% Ads Vulnerable";
    } else if (margin >= 0.25 && roi >= 40) {
      status = "winner";
      statusLabel = "Optimal Margin (≥30%)";
    }

    return Object.freeze({
      index,
      rowNumber: row.rowNumber || index + 1,
      id: row.sku || row.id || `SKU-${index + 1}`,
      productName: row.productName || row.product_name || "Untitled Product",
      category: row.category || "General",
      countryCode: rule.code,
      countryName: rule.name,
      currency,
      symbol: rule.symbol,
      itemPrice,
      shippingCharged,
      grossRevenue,
      productionCost,
      packagingCost,
      shippingCost,
      totalSellerCosts,
      feeBreakdown: selectedCalc.feeBreakdown,
      totalEtsyFees,
      netProfit,
      margin,
      marginPct,
      roi,
      breakEvenPrice,
      offsite15NetProfit,
      offsite15MarginPct,
      becomesUnprofitableAt15Pct: netProfit > 0 && offsite15NetProfit <= 0,
      status,
      statusLabel
    });
  });

  const summary = summarizeCatalog(results);
  return { results, summary };
}

/**
 * Computes portfolio-wide summary KPIs.
 */
export function summarizeCatalog(results = []) {
  const count = results.length;
  if (count === 0) {
    return Object.freeze({
      totalCount: 0,
      totalRevenue: 0,
      totalProfit: 0,
      averageMarginPct: 0,
      averageRoiPct: 0,
      profitableCount: 0,
      lossCount: 0,
      thinCount: 0,
      adsRiskCount: 0,
      winnerCount: 0
    });
  }

  let totalRevenue = 0;
  let totalProfit = 0;
  let marginSum = 0;
  let roiSum = 0;
  let profitableCount = 0;
  let lossCount = 0;
  let thinCount = 0;
  let adsRiskCount = 0;
  let winnerCount = 0;

  for (const item of results) {
    totalRevenue += item.grossRevenue;
    totalProfit += item.netProfit;
    marginSum += item.marginPct;
    roiSum += item.roi;

    if (item.netProfit > 0) profitableCount++;
    if (item.netProfit < 0) lossCount++;
    if (item.status === "thin_margin") thinCount++;
    if (item.becomesUnprofitableAt15Pct) adsRiskCount++;
    if (item.status === "winner" || (item.marginPct >= 25 && item.netProfit >= 10)) winnerCount++;
  }

  return Object.freeze({
    totalCount: count,
    totalRevenue,
    totalProfit,
    averageMarginPct: count > 0 ? marginSum / count : 0,
    averageRoiPct: count > 0 ? roiSum / count : 0,
    profitableCount,
    lossCount,
    thinCount,
    adsRiskCount,
    winnerCount
  });
}

/**
 * Multi-parameter filtering and sorting engine (Analyzer.Tools style).
 */
export function filterAndSortCatalog(results = [], options = {}) {
  const {
    filterTab = "all",
    searchQuery = "",
    minProfit = null,
    minMarginPct = null,
    minRoi = null,
    category = "all",
    favoritesSet = new Set(),
    sortBy = "netProfit",
    sortDir = "desc"
  } = options;

  const query = searchQuery.trim().toLowerCase();

  const filtered = results.filter((item) => {
    // 1. Tab filter
    if (filterTab === "favorites" && !favoritesSet.has(item.id)) return false;
    if (filterTab === "winners" && item.status !== "winner" && !(item.marginPct >= 25 && item.netProfit >= 10)) return false;
    if (filterTab === "high_roi" && item.roi < 50) return false;
    if (filterTab === "thin_margin" && item.status !== "thin_margin") return false;
    if (filterTab === "losses" && item.netProfit >= 0) return false;
    if (filterTab === "ads_risk" && !item.becomesUnprofitableAt15Pct) return false;
    if (filterTab === "profitable" && item.netProfit <= 0) return false;

    // 2. Global search match
    if (query !== "") {
      const matchText = `${item.id} ${item.productName} ${item.category}`.toLowerCase();
      if (!matchText.includes(query)) return false;
    }

    // 3. Category match
    if (category !== "all" && item.category !== category) return false;

    // 4. Numeric parameter sliders/thresholds
    if (minProfit !== null && Number.isFinite(minProfit) && item.netProfit < minProfit) return false;
    if (minMarginPct !== null && Number.isFinite(minMarginPct) && item.marginPct < minMarginPct) return false;
    if (minRoi !== null && Number.isFinite(minRoi) && item.roi < minRoi) return false;

    return true;
  });

  // Sorting
  const dir = sortDir === "asc" ? 1 : -1;
  const sorted = [...filtered].sort((a, b) => {
    let diff = 0;
    switch (sortBy) {
      case "productName":
        diff = a.productName.localeCompare(b.productName, undefined, { sensitivity: "base" });
        break;
      case "category":
        diff = a.category.localeCompare(b.category);
        break;
      case "itemPrice":
        diff = a.itemPrice - b.itemPrice;
        break;
      case "grossRevenue":
        diff = a.grossRevenue - b.grossRevenue;
        break;
      case "totalSellerCosts":
        diff = a.totalSellerCosts - b.totalSellerCosts;
        break;
      case "totalEtsyFees":
        diff = a.totalEtsyFees - b.totalEtsyFees;
        break;
      case "netProfit":
        diff = a.netProfit - b.netProfit;
        break;
      case "margin":
      case "marginPct":
        diff = a.marginPct - b.marginPct;
        break;
      case "roi":
        diff = a.roi - b.roi;
        break;
      case "breakEvenPrice":
        diff = a.breakEvenPrice - b.breakEvenPrice;
        break;
      case "offsite15Profit":
        diff = a.offsite15NetProfit - b.offsite15NetProfit;
        break;
      case "favorite":
        diff = (favoritesSet.has(a.id) ? 1 : 0) - (favoritesSet.has(b.id) ? 1 : 0);
        break;
      case "rowNumber":
      default:
        diff = a.rowNumber - b.rowNumber;
        break;
    }
    if (diff !== 0) return diff * dir;
    return a.rowNumber - b.rowNumber;
  });

  return sorted;
}

/**
 * Generates an Enriched CSV export of catalog results with formulas sanitized.
 */
export function exportCatalogToCsv(items = [], favoritesSet = new Set()) {
  const headers = [
    "Favorite",
    "Row",
    "SKU_ID",
    "Product_Title",
    "Category",
    "Country",
    "Currency",
    "Listing_Price",
    "Buyer_Shipping",
    "Gross_Revenue",
    "Production_Cost",
    "Packaging_Cost",
    "Seller_Postage_Cost",
    "Total_Seller_Costs",
    "Listing_Fee",
    "Transaction_Fee",
    "Payment_Processing_Fee",
    "Regulatory_Fee",
    "Total_Etsy_Fees",
    "Net_Profit",
    "Profit_Margin_Pct",
    "ROI_Pct",
    "Break_Even_Price",
    "Net_Profit_15Pct_Ads",
    "Becomes_Unprofitable_At_15Pct_Ads",
    "Profit_Status"
  ];

  const escapeCell = (val) => {
    if (val === null || val === undefined) return "";
    let str = sanitizeCsvTextCell(String(val));
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.join(",")];

  for (const item of items) {
    const row = [
      favoritesSet.has(item.id) ? "★" : "",
      item.rowNumber,
      item.id,
      item.productName,
      item.category,
      item.countryCode,
      item.currency,
      item.itemPrice.toFixed(2),
      item.shippingCharged.toFixed(2),
      item.grossRevenue.toFixed(2),
      item.productionCost.toFixed(2),
      item.packagingCost.toFixed(2),
      item.shippingCost.toFixed(2),
      item.totalSellerCosts.toFixed(2),
      (item.feeBreakdown.listing || 0).toFixed(2),
      (item.feeBreakdown.transaction || 0).toFixed(2),
      (item.feeBreakdown.processing || 0).toFixed(2),
      (item.feeBreakdown.regulatory || 0).toFixed(2),
      item.totalEtsyFees.toFixed(2),
      item.netProfit.toFixed(2),
      item.marginPct.toFixed(2) + "%",
      item.roi.toFixed(2) + "%",
      item.breakEvenPrice.toFixed(2),
      item.offsite15NetProfit.toFixed(2),
      item.becomesUnprofitableAt15Pct ? "YES" : "NO",
      item.statusLabel
    ];
    lines.push(row.map(escapeCell).join(","));
  }

  return lines.join("\r\n");
}

/**
 * One-Click Supplier Preset Catalogs (Printify, Printful, Gelato, AliExpress, CJ Dropshipping).
 */
export const SUPPLIER_PRESETS = Object.freeze({
  printify: {
    id: "printify",
    name: "Printify",
    fullName: "Printify (Print on Demand)",
    badge: "POD Apparel & Accessories",
    description: "Curated Printify DTG apparel, ceramic drinkware, and custom vinyl stickers.",
    templateHeaders: ["Product Title", "SKU", "Etsy Selling Price", "Printify Base Cost", "Printify Shipping Cost", "Category"],
    items: [
      {
        product_name: "Bella + Canvas 3001 Unisex Jersey Tee (SKU: PRF-BC3001)",
        item_price: "24.99",
        shipping_charged: "4.99",
        production_cost: "8.24",
        packaging_cost: "0.00",
        shipping_cost: "4.99",
        category: "Apparel",
        order_origin: "domestic"
      },
      {
        product_name: "Gildan 18500 Heavy Blend Hooded Sweatshirt (SKU: PRF-GD1850)",
        item_price: "42.50",
        shipping_charged: "6.99",
        production_cost: "15.82",
        packaging_cost: "0.00",
        shipping_cost: "7.99",
        category: "Apparel",
        order_origin: "domestic"
      },
      {
        product_name: "Ceramic Accent Coffee Mug 11oz (SKU: PRF-MUG11)",
        item_price: "18.99",
        shipping_charged: "5.49",
        production_cost: "4.45",
        packaging_cost: "0.00",
        shipping_cost: "5.99",
        category: "Home & Living",
        order_origin: "domestic"
      },
      {
        product_name: "Comfort Colors 1717 Garment-Dyed Heavyweight Tee (SKU: PRF-CC1717)",
        item_price: "29.99",
        shipping_charged: "4.99",
        production_cost: "11.75",
        packaging_cost: "0.00",
        shipping_cost: "4.99",
        category: "Apparel",
        order_origin: "domestic"
      },
      {
        product_name: "Kiss-Cut Vinyl Stickers 3x3 Multi-Pack (SKU: PRF-STK03)",
        item_price: "9.99",
        shipping_charged: "2.99",
        production_cost: "1.85",
        packaging_cost: "0.00",
        shipping_cost: "3.99",
        category: "Paper & Party",
        order_origin: "domestic"
      }
    ]
  },
  printful: {
    id: "printful",
    name: "Printful",
    fullName: "Printful (Print on Demand)",
    badge: "POD & Embroidery",
    description: "Curated Printful DTG shirts, heavyweight fleece, embroidered trucker caps, and glossy mugs.",
    templateHeaders: ["Item Name", "SKU", "Listing Price", "Printful Item Cost", "Estimated Shipping", "Category"],
    items: [
      {
        product_name: "Unisex Staple T-Shirt | Bella + Canvas 3001 (SKU: PFL-BC3001)",
        item_price: "26.00",
        shipping_charged: "4.50",
        production_cost: "10.25",
        packaging_cost: "0.00",
        shipping_cost: "4.69",
        category: "Apparel",
        order_origin: "domestic"
      },
      {
        product_name: "Unisex Heavyweight Hoodie | Gildan 18500 (SKU: PFL-GD1850)",
        item_price: "48.00",
        shipping_charged: "6.50",
        production_cost: "20.95",
        packaging_cost: "0.00",
        shipping_cost: "6.99",
        category: "Apparel",
        order_origin: "domestic"
      },
      {
        product_name: "Retro Trucker Cap | Yupoong 6606 Embroidered (SKU: PFL-YP6606)",
        item_price: "32.00",
        shipping_charged: "4.50",
        production_cost: "14.50",
        packaging_cost: "0.00",
        shipping_cost: "4.39",
        category: "Accessories",
        order_origin: "domestic"
      },
      {
        product_name: "White Glossy Ceramic Mug 15oz (SKU: PFL-MUG15)",
        item_price: "21.50",
        shipping_charged: "5.50",
        production_cost: "6.95",
        packaging_cost: "0.00",
        shipping_cost: "5.79",
        category: "Home & Living",
        order_origin: "domestic"
      },
      {
        product_name: "All-Over Print Recycled Canvas Tote Bag (SKU: PFL-TOT01)",
        item_price: "34.00",
        shipping_charged: "4.50",
        production_cost: "16.95",
        packaging_cost: "0.00",
        shipping_cost: "4.99",
        category: "Bags & Purses",
        order_origin: "domestic"
      }
    ]
  },
  gelato: {
    id: "gelato",
    name: "Gelato",
    fullName: "Gelato (Global POD Art & Paper)",
    badge: "POD Wall Art & Paper",
    description: "Curated Gelato local printing: wooden framed posters, canvas prints, photo books, and calendars.",
    templateHeaders: ["Product", "SKU", "Retail Price", "Gelato Base Price", "Shipping Cost", "Category"],
    items: [
      {
        product_name: "Classic Matte Wooden Framed Poster 30x40cm (SKU: GEL-WFP304)",
        item_price: "48.00",
        shipping_charged: "6.00",
        production_cost: "18.50",
        packaging_cost: "0.00",
        shipping_cost: "6.50",
        category: "Art & Wall Decor",
        order_origin: "domestic"
      },
      {
        product_name: "Stretched Canvas Wrap 12x16in Thin Frame (SKU: GEL-CAN121)",
        item_price: "44.00",
        shipping_charged: "7.00",
        production_cost: "16.80",
        packaging_cost: "0.00",
        shipping_cost: "7.20",
        category: "Art & Wall Decor",
        order_origin: "domestic"
      },
      {
        product_name: "Hardcover Photo Memory Book 20x20cm (SKU: GEL-BK2020)",
        item_price: "38.00",
        shipping_charged: "5.00",
        production_cost: "14.90",
        packaging_cost: "0.00",
        shipping_cost: "5.50",
        category: "Paper & Party",
        order_origin: "domestic"
      },
      {
        product_name: "Wall Calendar A3 Spiral Wire Hanging (SKU: GEL-CAL-A3)",
        item_price: "27.50",
        shipping_charged: "4.50",
        production_cost: "9.40",
        packaging_cost: "0.00",
        shipping_cost: "4.80",
        category: "Stationery",
        order_origin: "domestic"
      },
      {
        product_name: "Premium Matte Folded Greeting Cards 10-Pack (SKU: GEL-CRD-10)",
        item_price: "22.00",
        shipping_charged: "3.50",
        production_cost: "8.20",
        packaging_cost: "0.00",
        shipping_cost: "4.20",
        category: "Paper & Party",
        order_origin: "domestic"
      }
    ]
  },
  aliexpress: {
    id: "aliexpress",
    name: "AliExpress",
    fullName: "AliExpress (Wholesale & Supplies)",
    badge: "Wholesale & Craft Supplies",
    description: "Curated AliExpress wholesale jewelry, raw crystal charms, aesthetic washi tape, and macrame cord.",
    templateHeaders: ["Item Title", "AliExpress Cost Price", "Choice Shipping Fee", "Packaging Cost", "Etsy Target Price", "Category"],
    items: [
      {
        product_name: "10-Piece Vintage Boho Stacking Rings Set (SKU: ALX-RNG-10)",
        item_price: "16.99",
        shipping_charged: "3.50",
        production_cost: "1.85",
        packaging_cost: "0.75",
        shipping_cost: "2.50",
        category: "Jewelry",
        order_origin: "domestic"
      },
      {
        product_name: "Natural Raw Crystal Quartz Hexagonal Pendant (SKU: ALX-QRTZ-01)",
        item_price: "19.50",
        shipping_charged: "3.50",
        production_cost: "2.40",
        packaging_cost: "0.80",
        shipping_cost: "2.80",
        category: "Jewelry",
        order_origin: "domestic"
      },
      {
        product_name: "Japanese Aesthetic Washi Tape 10-Roll Box (SKU: ALX-WSH-10)",
        item_price: "18.00",
        shipping_charged: "3.00",
        production_cost: "3.20",
        packaging_cost: "0.50",
        shipping_cost: "2.90",
        category: "Craft Supplies",
        order_origin: "domestic"
      },
      {
        product_name: "100m 3mm Natural Cotton Macrame Cord Spool (SKU: ALX-MAC-100)",
        item_price: "22.50",
        shipping_charged: "4.00",
        production_cost: "4.50",
        packaging_cost: "1.00",
        shipping_cost: "3.80",
        category: "Craft Supplies",
        order_origin: "domestic"
      },
      {
        product_name: "50-Piece Antique Bronze Steampunk Gear Charms (SKU: ALX-BRZ-50)",
        item_price: "14.50",
        shipping_charged: "3.00",
        production_cost: "2.90",
        packaging_cost: "0.60",
        shipping_cost: "2.50",
        category: "Craft Supplies",
        order_origin: "domestic"
      }
    ]
  },
  cjdropshipping: {
    id: "cjdropshipping",
    name: "CJ Dropshipping",
    fullName: "CJ Dropshipping (Direct Dropship)",
    badge: "Direct Dropshipping",
    description: "Curated CJ Dropshipping trending home decor, boho coasters, pocket printers, and wooden gifts.",
    templateHeaders: ["Product Name", "Drop Shipping Price", "CJ Packet Freight", "Packaging Cost", "Etsy Selling Price", "Category"],
    items: [
      {
        product_name: "Nordic Minimalist Ceramic Donut Vase (SKU: CJD-DON-01)",
        item_price: "36.00",
        shipping_charged: "5.00",
        production_cost: "6.80",
        packaging_cost: "1.00",
        shipping_cost: "6.20",
        category: "Home & Living",
        order_origin: "domestic"
      },
      {
        product_name: "Handmade Round Boho Braided Coasters 4-Pack (SKU: CJD-CST-04)",
        item_price: "21.00",
        shipping_charged: "3.50",
        production_cost: "3.40",
        packaging_cost: "0.75",
        shipping_cost: "3.90",
        category: "Home & Living",
        order_origin: "domestic"
      },
      {
        product_name: "Portable Mini Wireless Thermal Pocket Printer (SKU: CJD-PRN-02)",
        item_price: "39.99",
        shipping_charged: "0.00",
        production_cost: "11.50",
        packaging_cost: "1.20",
        shipping_cost: "5.80",
        category: "Electronics",
        order_origin: "domestic"
      },
      {
        product_name: "Vintage Carved Wooden Hand-Crank Music Box (SKU: CJD-MSC-07)",
        item_price: "24.50",
        shipping_charged: "3.50",
        production_cost: "3.80",
        packaging_cost: "0.80",
        shipping_cost: "4.20",
        category: "Gifts & Music",
        order_origin: "domestic"
      },
      {
        product_name: "Blank Leather Keychain Craft Blanks 20-Pack (SKU: CJD-KCH-20)",
        item_price: "23.00",
        shipping_charged: "3.00",
        production_cost: "4.20",
        packaging_cost: "0.60",
        shipping_cost: "3.50",
        category: "Craft Supplies",
        order_origin: "domestic"
      }
    ]
  }
});

/**
 * Generates downloadable RFC 4180 CSV Template for a specific supplier.
 */
export function generateSupplierCsvTemplate(supplierId) {
  const preset = SUPPLIER_PRESETS[supplierId];
  if (!preset) return "";

  const headers = preset.templateHeaders;
  const lines = [headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(",")];

  for (const item of preset.items) {
    let row = [];
    if (supplierId === "printify") {
      const sku = item.product_name.match(/SKU: ([^)]+)/)?.[1] || "PRF-SKU";
      row = [item.product_name, sku, item.item_price, item.production_cost, item.shipping_cost, item.category];
    } else if (supplierId === "printful") {
      const sku = item.product_name.match(/SKU: ([^)]+)/)?.[1] || "PFL-SKU";
      row = [item.product_name, sku, item.item_price, item.production_cost, item.shipping_cost, item.category];
    } else if (supplierId === "gelato") {
      const sku = item.product_name.match(/SKU: ([^)]+)/)?.[1] || "GEL-SKU";
      row = [item.product_name, sku, item.item_price, item.production_cost, item.shipping_cost, item.category];
    } else if (supplierId === "aliexpress") {
      row = [item.product_name, item.production_cost, item.shipping_cost, item.packaging_cost, item.item_price, item.category];
    } else if (supplierId === "cjdropshipping") {
      row = [item.product_name, item.production_cost, item.shipping_cost, item.packaging_cost, item.item_price, item.category];
    } else {
      row = [item.product_name, item.item_price, item.production_cost, item.shipping_cost, item.category];
    }
    lines.push(row.map((val) => `"${sanitizeCsvTextCell(String(val)).replace(/"/g, '""')}"`).join(","));
  }

  return lines.join("\r\n");
}

// Internal CRC-32 for Zip creation
function crc32(u8) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c;
    }
  }
  let c = 0 ^ (-1);
  for (let i = 0; i < u8.length; i++) c = (c >>> 8) ^ table[(c ^ u8[i]) & 0xff];
  return (c ^ (-1)) >>> 0;
}

function writeUInt32LE(u8, val, offset) {
  u8[offset] = val & 0xff;
  u8[offset + 1] = (val >>> 8) & 0xff;
  u8[offset + 2] = (val >>> 16) & 0xff;
  u8[offset + 3] = (val >>> 24) & 0xff;
}

function writeUInt16LE(u8, val, offset) {
  u8[offset] = val & 0xff;
  u8[offset + 1] = (val >>> 8) & 0xff;
}

function concatUint8Arrays(arrays) {
  let totalLength = 0;
  for (const arr of arrays) totalLength += arr.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

export function createZipUint8Array(files) {
  const encoder = new TextEncoder();
  const fileEntries = [];
  let offset = 0;
  const parts = [];

  for (const { name, data } of files) {
    const nameBytes = encoder.encode(name);
    const dataBytes = typeof data === "string" ? encoder.encode(data) : data;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const header = new Uint8Array(30);
    writeUInt32LE(header, 0x04034b50, 0);
    writeUInt16LE(header, 20, 4);
    writeUInt16LE(header, 0, 6);
    writeUInt16LE(header, 0, 8);
    writeUInt16LE(header, 0, 10);
    writeUInt16LE(header, 0, 12);
    writeUInt32LE(header, crc, 14);
    writeUInt32LE(header, size, 18);
    writeUInt32LE(header, size, 22);
    writeUInt16LE(header, nameBytes.length, 26);
    writeUInt16LE(header, 0, 28);

    fileEntries.push({ nameBytes, crc, size, offset });
    parts.push(header, nameBytes, dataBytes);
    offset += 30 + nameBytes.length + size;
  }

  const centralDirStart = offset;
  for (const entry of fileEntries) {
    const cd = new Uint8Array(46);
    writeUInt32LE(cd, 0x02014b50, 0);
    writeUInt16LE(cd, 20, 4);
    writeUInt16LE(cd, 20, 6);
    writeUInt16LE(cd, 0, 8);
    writeUInt16LE(cd, 0, 10);
    writeUInt16LE(cd, 0, 12);
    writeUInt16LE(cd, 0, 14);
    writeUInt32LE(cd, entry.crc, 16);
    writeUInt32LE(cd, entry.size, 20);
    writeUInt32LE(cd, entry.size, 24);
    writeUInt16LE(cd, entry.nameBytes.length, 28);
    writeUInt16LE(cd, 0, 30);
    writeUInt16LE(cd, 0, 32);
    writeUInt16LE(cd, 0, 34);
    writeUInt16LE(cd, 0, 36);
    writeUInt32LE(cd, 0, 38);
    writeUInt32LE(cd, entry.offset, 42);

    parts.push(cd, entry.nameBytes);
    offset += 46 + entry.nameBytes.length;
  }

  const centralDirSize = offset - centralDirStart;
  const eocd = new Uint8Array(22);
  writeUInt32LE(eocd, 0x06054b50, 0);
  writeUInt16LE(eocd, 0, 4);
  writeUInt16LE(eocd, 0, 6);
  writeUInt16LE(eocd, fileEntries.length, 8);
  writeUInt16LE(eocd, fileEntries.length, 10);
  writeUInt32LE(eocd, centralDirSize, 12);
  writeUInt32LE(eocd, centralDirStart, 16);
  writeUInt16LE(eocd, 0, 20);

  parts.push(eocd);
  return concatUint8Arrays(parts);
}

function escapeXml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getColLetter(colIndex) {
  let letter = "";
  let temp = colIndex;
  while (temp > 0) {
    let rem = (temp - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

/**
 * Exports catalog results to a formatted OpenXML Excel workbook (.xlsx).
 * Zero external libraries; generates valid ZIP and SpreadsheetML directly.
 */
export function exportCatalogToXlsx(items = [], favoritesSet = new Set(), countryCode = "US") {
  const headers = [
    "Fav", "Row", "Product Title & SKU", "Category", "Country", "Currency",
    "Listing Price", "Buyer Shipping", "Gross Revenue",
    "Unit COGS", "Packaging Cost", "Seller Postage", "Total Costs",
    "Listing Fee", "Tx Fee (6.5%)", "Processing Fee", "Regulatory Fee", "Total Etsy Fees",
    "Net Profit", "Margin %", "ROI %", "Break-Even Price", "15% Ads Net", "Status Badge"
  ];

  let rowsXml = "";
  let headerCells = "";
  headers.forEach((h, idx) => {
    const col = getColLetter(idx + 1);
    headerCells += `<c r="${col}1" t="inlineStr" s="1"><is><t>${escapeXml(h)}</t></is></c>`;
  });
  rowsXml += `<row r="1" ht="26" customHeight="1">${headerCells}</row>`;

  items.forEach((item, rIdx) => {
    const r = rIdx + 2;
    const isFav = favoritesSet.has(item.id);
    const profitStyle = item.netProfit > 0 ? 4 : (item.netProfit < 0 ? 5 : 2);

    const cells = [
      `<c r="A${r}" t="inlineStr" s="6"><is><t>${isFav ? "★" : ""}</t></is></c>`,
      `<c r="B${r}" s="6"><v>${item.rowNumber}</v></c>`,
      `<c r="C${r}" t="inlineStr" s="0"><is><t>${escapeXml(item.productName)}</t></is></c>`,
      `<c r="D${r}" t="inlineStr" s="0"><is><t>${escapeXml(item.category || "General")}</t></is></c>`,
      `<c r="E${r}" t="inlineStr" s="6"><is><t>${escapeXml(item.countryCode || countryCode)}</t></is></c>`,
      `<c r="F${r}" t="inlineStr" s="6"><is><t>${escapeXml(item.currency || "USD")}</t></is></c>`,
      `<c r="G${r}" s="2"><v>${item.itemPrice.toFixed(2)}</v></c>`,
      `<c r="H${r}" s="2"><v>${item.shippingCharged.toFixed(2)}</v></c>`,
      `<c r="I${r}" s="2"><v>${item.grossRevenue.toFixed(2)}</v></c>`,
      `<c r="J${r}" s="2"><v>${item.productionCost.toFixed(2)}</v></c>`,
      `<c r="K${r}" s="2"><v>${item.packagingCost.toFixed(2)}</v></c>`,
      `<c r="L${r}" s="2"><v>${item.shippingCost.toFixed(2)}</v></c>`,
      `<c r="M${r}" s="2"><v>${item.totalSellerCosts.toFixed(2)}</v></c>`,
      `<c r="N${r}" s="2"><v>${(item.feeBreakdown?.listing || 0).toFixed(2)}</v></c>`,
      `<c r="O${r}" s="2"><v>${(item.feeBreakdown?.transaction || 0).toFixed(2)}</v></c>`,
      `<c r="P${r}" s="2"><v>${(item.feeBreakdown?.processing || 0).toFixed(2)}</v></c>`,
      `<c r="Q${r}" s="2"><v>${(item.feeBreakdown?.regulatory || 0).toFixed(2)}</v></c>`,
      `<c r="R${r}" s="2"><v>${item.totalEtsyFees.toFixed(2)}</v></c>`,
      `<c r="S${r}" s="${profitStyle}"><v>${item.netProfit.toFixed(2)}</v></c>`,
      `<c r="T${r}" s="3"><v>${((item.marginPct || 0) / 100).toFixed(4)}</v></c>`,
      `<c r="U${r}" s="3"><v>${((item.roi || 0) / 100).toFixed(4)}</v></c>`,
      `<c r="V${r}" s="2"><v>${item.breakEvenPrice.toFixed(2)}</v></c>`,
      `<c r="W${r}" s="2"><v>${(item.offsite15NetProfit || 0).toFixed(2)}</v></c>`,
      `<c r="X${r}" t="inlineStr" s="6"><is><t>${escapeXml(item.statusLabel || "Active")}</t></is></c>`
    ];

    rowsXml += `<row r="${r}" ht="20" customHeight="1">${cells.join("")}</row>`;
  });

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="ShopProfit Sourcing Analysis" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="$#,##0.00"/>
    <numFmt numFmtId="165" formatCode="0.0%"/>
  </numFmts>
  <fonts count="4">
    <font><name val="Segoe UI"/><sz val="10"/></font>
    <font><b/><name val="Segoe UI"/><sz val="10"/><color rgb="FFFFFFFF"/></font>
    <font><b/><name val="Segoe UI"/><sz val="10"/><color rgb="FF166534"/></font>
    <font><b/><name val="Segoe UI"/><sz val="10"/><color rgb="FF991B1B"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="164" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>
    <xf numFmtId="164" fontId="3" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
</styleSheet>`;

  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="6" customWidth="1"/>
    <col min="2" max="2" width="6" customWidth="1"/>
    <col min="3" max="3" width="38" customWidth="1"/>
    <col min="4" max="4" width="18" customWidth="1"/>
    <col min="5" max="6" width="10" customWidth="1"/>
    <col min="7" max="18" width="15" customWidth="1"/>
    <col min="19" max="19" width="16" customWidth="1"/>
    <col min="20" max="21" width="12" customWidth="1"/>
    <col min="22" max="23" width="16" customWidth="1"/>
    <col min="24" max="24" width="18" customWidth="1"/>
  </cols>
  <sheetData>${rowsXml}</sheetData>
</worksheet>`;

  const zipUint8 = createZipUint8Array([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "xl/workbook.xml", data: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
    { name: "xl/styles.xml", data: stylesXml },
    { name: "xl/worksheets/sheet1.xml", data: sheet1Xml }
  ]);

  if (typeof Blob !== "undefined") {
    return new Blob([zipUint8], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }

  return zipUint8;
}

/**
 * Computes frequency histogram bins for catalog profit margins.
 * Tier intervals:
 * - losses: < 0%
 * - thin: 0% to 14.99%
 * - standard: 15% to 29.99%
 * - healthy: 30% to 49.99%
 * - stars: >= 50%
 *
 * @param {Array<Object>} items Analyzed catalog items
 * @returns {Object} Histogram bins, item counts, percentages, and max bin height
 */
export function computeMarginHistogram(items = []) {
  const buckets = {
    losses: { id: "losses", label: "Losses (<0%)", min: -Infinity, max: 0, count: 0, items: [], color: "#EF4444", tabId: "losses" },
    thin: { id: "thin", label: "Thin (0–15%)", min: 0, max: 15, count: 0, items: [], color: "#F59E0B", tabId: "thin_margin" },
    standard: { id: "standard", label: "Standard (15–30%)", min: 15, max: 30, count: 0, items: [], color: "#0EA5E9", tabId: "all" },
    healthy: { id: "healthy", label: "Healthy (30–50%)", min: 30, max: 50, count: 0, items: [], color: "#10B981", tabId: "winners" },
    stars: { id: "stars", label: "Super Stars (≥50%)", min: 50, max: Infinity, count: 0, items: [], color: "#8B5CF6", tabId: "winners" }
  };

  const total = items.length;

  for (const item of items) {
    const m = typeof item.marginPct === "number"
      ? item.marginPct
      : (typeof item.margin === "number" ? (item.margin >= -1 && item.margin <= 1 ? item.margin * 100 : item.margin) : 0);
    if (m < 0) {
      buckets.losses.count++;
      buckets.losses.items.push(item);
    } else if (m < 15) {
      buckets.thin.count++;
      buckets.thin.items.push(item);
    } else if (m < 30) {
      buckets.standard.count++;
      buckets.standard.items.push(item);
    } else if (m < 50) {
      buckets.healthy.count++;
      buckets.healthy.items.push(item);
    } else {
      buckets.stars.count++;
      buckets.stars.items.push(item);
    }
  }

  let maxCount = 0;
  for (const key of Object.keys(buckets)) {
    const b = buckets[key];
    b.pct = total > 0 ? (b.count / total) * 100 : 0;
    if (b.count > maxCount) maxCount = b.count;
  }

  return {
    totalCount: total,
    maxCount: Math.max(1, maxCount),
    buckets
  };
}

/**
 * Computes P&L Waterfall bridge data showing sequential deductions from Gross Revenue to Net Profit.
 *
 * @param {Array<Object>} items Analyzed catalog items
 * @returns {Object} Cumulative waterfall segments and breakdown percentages
 */
export function computeCostWaterfall(items = []) {
  let grossRevenue = 0;
  let cogs = 0;
  let shippingCost = 0;
  let packagingCost = 0;
  let listingFees = 0;
  let transactionFees = 0;
  let processingFees = 0;
  let regulatoryFees = 0;
  let offsiteAdsFees = 0;
  let otherCosts = 0;
  let netProfit = 0;

  for (const item of items) {
    grossRevenue += Number(item.grossRevenue) || 0;
    cogs += Number(item.productionCost) || 0;
    shippingCost += Number(item.shippingCost) || 0;
    packagingCost += Number(item.packagingCost) || 0;
    otherCosts += Number(item.totalAccountLevelCosts || item.otherCosts || 0);
    netProfit += Number(item.netProfit) || 0;

    const fb = item.feeBreakdown || {};
    listingFees += Number(fb.listing ?? item.listingFee ?? 0);
    transactionFees += Number(fb.transaction ?? item.transactionFee ?? 0);
    processingFees += Number(fb.processing ?? item.paymentProcessingFee ?? 0);
    regulatoryFees += Number(fb.regulatory ?? item.regulatoryFee ?? 0);
    offsiteAdsFees += Number(fb.offsiteAds ?? item.offsiteAdsFee ?? 0);
  }

  const postageAndPackaging = shippingCost + packagingCost;
  const platformFees = listingFees + transactionFees;
  const paymentAndReg = processingFees + regulatoryFees + offsiteAdsFees + otherCosts;

  const totalDeductions = cogs + postageAndPackaging + platformFees + paymentAndReg;

  // Build sequential steps
  const steps = [
    {
      id: "revenue",
      label: "Gross Revenue",
      amount: grossRevenue,
      type: "total",
      color: "#0284C7",
      start: 0,
      end: grossRevenue
    },
    {
      id: "cogs",
      label: "− Product COGS",
      amount: cogs,
      type: "deduction",
      color: "#EA580C",
      start: grossRevenue,
      end: Math.max(0, grossRevenue - cogs)
    },
    {
      id: "shipping",
      label: "− Shipping & Pack",
      amount: postageAndPackaging,
      type: "deduction",
      color: "#F59E0B",
      start: Math.max(0, grossRevenue - cogs),
      end: Math.max(0, grossRevenue - cogs - postageAndPackaging)
    },
    {
      id: "platform_fees",
      label: "− Etsy Fees (Tx+List)",
      amount: platformFees,
      type: "deduction",
      color: "#E11D48",
      start: Math.max(0, grossRevenue - cogs - postageAndPackaging),
      end: Math.max(0, grossRevenue - cogs - postageAndPackaging - platformFees)
    },
    {
      id: "payment_fees",
      label: "− Processing & Ads",
      amount: paymentAndReg,
      type: "deduction",
      color: "#9333EA",
      start: Math.max(0, grossRevenue - cogs - postageAndPackaging - platformFees),
      end: Math.max(0, grossRevenue - totalDeductions)
    },
    {
      id: "net_profit",
      label: "= Net Take-Home",
      amount: netProfit,
      type: "total",
      color: netProfit >= 0 ? "#10B981" : "#EF4444",
      start: 0,
      end: netProfit
    }
  ];

  for (const step of steps) {
    step.pct = grossRevenue > 0 ? (step.amount / grossRevenue) * 100 : 0;
  }

  return {
    grossRevenue,
    cogs,
    postageAndPackaging,
    platformFees,
    paymentAndReg,
    totalDeductions,
    netProfit,
    steps
  };
}

/**
 * Computes scatter plot bounds, median dividing lines, and quadrant classification for all items.
 *
 * @param {Array<Object>} items Analyzed catalog items
 * @returns {Object} Min/max bounds, median price, and classified plot points
 */
export function computeScatterBounds(items = []) {
  if (!items.length) {
    return {
      minPrice: 0,
      maxPrice: 100,
      minMargin: -10,
      maxMargin: 60,
      medianPrice: 50,
      targetMargin: 30,
      points: []
    };
  }

  const prices = items.map((i) => Number(i.itemPrice) || 0);
  const margins = items.map((i) => typeof i.marginPct === "number"
    ? i.marginPct
    : (typeof i.margin === "number" ? (i.margin >= -1 && i.margin <= 1 ? i.margin * 100 : i.margin) : 0));

  const sortedPrices = [...prices].sort((a, b) => a - b);
  const medianPrice = sortedPrices[Math.floor(sortedPrices.length / 2)] || 25;

  const rawMinPrice = Math.min(...prices);
  const rawMaxPrice = Math.max(...prices);
  const rawMinMargin = Math.min(...margins);
  const rawMaxMargin = Math.max(...margins);

  const minPrice = 0;
  const maxPrice = Math.max(20, Math.ceil(rawMaxPrice * 1.15));
  const minMargin = Math.min(-10, Math.floor(rawMinMargin - 5));
  const maxMargin = Math.max(60, Math.ceil(rawMaxMargin + 10));
  const targetMargin = 30;

  const points = items.map((item, idx) => {
    const price = Number(item.itemPrice) || 0;
    const margin = typeof item.marginPct === "number"
      ? item.marginPct
      : (typeof item.margin === "number" ? (item.margin >= -1 && item.margin <= 1 ? item.margin * 100 : item.margin) : 0);
    const profit = Number(item.netProfit) || 0;

    let quadrant = "standard";
    let color = "#0EA5E9";

    if (margin < 0) {
      quadrant = "bleeder"; // Loss-making dead weight
      color = "#EF4444";
    } else if (margin >= targetMargin && price >= medianPrice) {
      quadrant = "star"; // High price, high margin
      color = "#10B981";
    } else if (margin >= targetMargin && price < medianPrice) {
      quadrant = "gem"; // Low price impulse, high margin
      color = "#8B5CF6";
    } else if (margin < 15 && price >= medianPrice) {
      quadrant = "trap"; // High price, low margin volume trap
      color = "#F59E0B";
    } else if (margin < 15) {
      quadrant = "thin";
      color = "#F59E0B";
    }

    return {
      id: item.id || `item_${idx}`,
      productName: item.productName || `Item #${idx + 1}`,
      category: item.category || "General",
      price,
      margin,
      profit,
      roi: Number(item.roi) || 0,
      totalCosts: Number(item.totalCosts) || 0,
      totalFees: Number(item.totalEtsyFees) || 0,
      quadrant,
      color
    };
  });

  return {
    minPrice,
    maxPrice,
    minMargin,
    maxMargin,
    medianPrice,
    targetMargin,
    points
  };
}

/**
 * Computes advertising stress-test sensitivity comparing Organic vs 15% Offsite Ads Attribution.
 *
 * @param {Array<Object>} items Analyzed catalog items
 * @returns {Object} Comparative metrics, profit erosion, and at-risk catalog listings
 */
export function computeAdsSensitivityComparison(items = []) {
  let grossRevenue = 0;
  let organicProfit = 0;
  let adsProfit = 0;
  const atRiskItems = [];
  const winnersUnderAds = [];

  for (const item of items) {
    const rev = Number(item.grossRevenue) || 0;
    const org = Number(item.netProfit) || 0;
    const adP = Number(item.offsite15Profit) || 0;

    grossRevenue += rev;
    organicProfit += org;
    adsProfit += adP;

    if (org > 0 && adP <= 0) {
      atRiskItems.push(item);
    } else if (adP > 0) {
      winnersUnderAds.push(item);
    }
  }

  const erosionDollar = organicProfit - adsProfit;
  const erosionPct = organicProfit > 0 ? (erosionDollar / organicProfit) * 100 : 0;
  const organicMargin = grossRevenue > 0 ? (organicProfit / grossRevenue) * 100 : 0;
  const adsMargin = grossRevenue > 0 ? (adsProfit / grossRevenue) * 100 : 0;

  return {
    grossRevenue,
    organicProfit,
    adsProfit,
    organicMargin,
    adsMargin,
    erosionDollar,
    erosionPct,
    totalItems: items.length,
    atRiskCount: atRiskItems.length,
    atRiskItems,
    survivingCount: winnersUnderAds.length
  };
}

