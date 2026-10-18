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
  { id: "favorite", label: "★ Fav", category: "meta", align: "center", minWidth: 48, defaultVisible: true },
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
      statusLabel = "Top Winner (★)";
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
