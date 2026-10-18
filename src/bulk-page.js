/**
 * ShopProfit — Dedicated Bulk Catalog & Sourcing Profit Analyzer (Interactive Controller)
 *
 * Implements full-screen enterprise-grade bulk catalog analysis inspired by Analyzer.Tools,
 * tailored for Etsy sellers, wholesale sourcing, and multi-product pricing strategies.
 *
 * ARCHITECTURAL & SECURITY INVARIANTS:
 * - 100% Client-Side Processing: Zero external network requests; zero data uploaded.
 * - Strict Fee Engine Parity: All calculations driven by src/fee-engine.js (62 international markets).
 * - DOM Safety: Safe text-node construction only; zero unsafe markup injection.
 * - Formula Sanitization: Single-quote prefixing on all exported CSV cells.
 */

import {
  GRID_COLUMNS,
  VIEW_PRESETS,
  EXPANDED_DEMO_CATALOG,
  calculateCatalogBatch,
  summarizeCatalog,
  filterAndSortCatalog,
  exportCatalogToCsv
} from "./bulk-catalog-analyzer.js";

import {
  GLOBAL_COUNTRY_RULES,
  resolveCountryFeeRule,
  formatMoney,
  getCurrencyMinorUnitDigits
} from "./fee-engine.js";

import {
  BULK_LIMITS,
  decodeAndValidateCsvText,
  parseCsvRecords,
  mapCsvHeaders,
  previewBulkCsv,
  sanitizeCsvTextCell,
  formatBulkCurrency
} from "./bulk-analyzer.js";

// Local storage key for starred favorites
const FAVORITES_STORAGE_KEY = "shopprofit_catalog_favorites_v1";

// Active state container
const state = {
  rawProducts: [],
  analyzedResults: [],
  summary: null,
  currentPreset: "sourcing",
  visibleColumns: new Set(VIEW_PRESETS.sourcing.columns),
  activeFilterTab: "all",
  favorites: new Set(),
  searchQuery: "",
  sortBy: "netProfit",
  sortDir: "desc",
  settings: {
    country: "US",
    offsiteRate: 0,
    plusEnabled: false,
    salesPerMonth: 30,
    defaultPackaging: 0,
    defaultPostage: 0
  },
  modal: null, // "upload", "columns", "adjustments", "receipt"
  selectedReceiptItem: null,
  uploadStep: 1,
  stagedFile: null,
  stagedRecords: [],
  stagedHeaders: [],
  stagedMapping: {}
};

/**
 * Loads persisted favorites from localStorage safely.
 */
function loadPersistedFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        state.favorites = new Set(arr);
      }
    }
  } catch (_e) {
    state.favorites = new Set();
  }
}

/**
 * Saves favorites to localStorage safely.
 */
function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...state.favorites]));
  } catch (_e) {
    // Ignore storage quota errors in private browsing
  }
}

/**
 * Recalculates analysis and updates UI.
 */
function recalculateAndRender() {
  const { results, summary } = calculateCatalogBatch(state.rawProducts, {
    fallbackCountry: state.settings.country,
    defaultOffsiteRate: state.settings.offsiteRate,
    plusEnabled: state.settings.plusEnabled,
    salesPerMonth: state.settings.salesPerMonth
  });

  state.analyzedResults = results;
  state.summary = summary;

  renderKpiCards();
  renderFilterTabs();
  renderGrid();
}

/**
 * Formats a currency value using the fee engine rules for the active country.
 */
function formatCurrency(amount, countryCode = state.settings.country) {
  const rule = resolveCountryFeeRule(countryCode);
  return formatBulkCurrency(amount, rule);
}

/**
 * Formats a percentage nicely.
 */
function formatPct(value) {
  if (value === null || value === undefined || isNaN(value)) return "0.0%";
  return `${Number(value).toFixed(1)}%`;
}

/**
 * Renders the top KPI cards.
 */
function renderKpiCards() {
  const kpiContainer = document.getElementById("kpi-dashboard");
  if (!kpiContainer) return;

  kpiContainer.replaceChildren();

  const s = state.summary || {
    totalCount: 0,
    totalRevenue: 0,
    totalProfit: 0,
    averageMarginPct: 0,
    averageRoiPct: 0,
    winnerCount: 0
  };

  const cards = [
    { label: "Total SKUs", value: String(s.totalCount), badge: "Active Catalog", tone: "neutral" },
    { label: "Gross Revenue", value: formatCurrency(s.totalRevenue), badge: "Combined Sales", tone: "neutral" },
    {
      label: "Total Net Profit",
      value: formatCurrency(s.totalProfit),
      badge: s.totalProfit >= 0 ? "Profitable" : "Net Loss",
      tone: s.totalProfit >= 0 ? "positive" : "negative"
    },
    {
      label: "Avg Margin",
      value: formatPct(s.averageMarginPct),
      badge: s.averageMarginPct >= 20 ? "Healthy" : "Low Margin",
      tone: s.averageMarginPct >= 20 ? "positive" : "warning"
    },
    {
      label: "Avg ROI",
      value: formatPct(s.averageRoiPct),
      badge: "Return on Costs",
      tone: s.averageRoiPct >= 50 ? "positive" : "neutral"
    },
    {
      label: "Top Winners (★)",
      value: String(s.winnerCount),
      badge: "High Margin & ROI",
      tone: "gold"
    }
  ];

  for (const card of cards) {
    const cardEl = document.createElement("div");
    cardEl.className = `kpi-card kpi-card--${card.tone}`;

    const labelEl = document.createElement("span");
    labelEl.className = "kpi-card__label";
    labelEl.textContent = card.label;

    const valueEl = document.createElement("span");
    valueEl.className = "kpi-card__value";
    valueEl.textContent = card.value;

    const badgeEl = document.createElement("span");
    badgeEl.className = "kpi-card__badge";
    badgeEl.textContent = card.badge;

    cardEl.appendChild(labelEl);
    cardEl.appendChild(valueEl);
    cardEl.appendChild(badgeEl);
    kpiContainer.appendChild(cardEl);
  }
}

/**
 * Renders quick filter chips bar with dynamic count badges.
 */
function renderFilterTabs() {
  const tabsContainer = document.getElementById("filter-tabs");
  if (!tabsContainer) return;

  tabsContainer.replaceChildren();

  const allCount = state.analyzedResults.length;
  const favCount = state.analyzedResults.filter((r) => state.favorites.has(r.id)).length;
  const winCount = state.summary ? state.summary.winnerCount : 0;
  const roiCount = state.analyzedResults.filter((r) => r.roi >= 50).length;
  const thinCount = state.summary ? state.summary.thinCount : 0;
  const lossCount = state.summary ? state.summary.lossCount : 0;
  const adsCount = state.summary ? state.summary.adsRiskCount : 0;

  const tabs = [
    { id: "all", label: "All Products", count: allCount },
    { id: "favorites", label: "★ Shortlist", count: favCount, highlight: true },
    { id: "winners", label: "Top Winners (★)", count: winCount },
    { id: "high_roi", label: "High ROI (≥50%)", count: roiCount },
    { id: "thin_margin", label: "Thin Margin (<15%)", count: thinCount },
    { id: "losses", label: "Losses (<$0)", count: lossCount },
    { id: "ads_risk", label: "15% Ads Vulnerable", count: adsCount }
  ];

  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `filter-chip ${state.activeFilterTab === tab.id ? "filter-chip--active" : ""}`;
    if (tab.highlight) btn.classList.add("filter-chip--star");

    const textSpan = document.createElement("span");
    textSpan.textContent = tab.label;

    const countBadge = document.createElement("span");
    countBadge.className = "filter-chip__count";
    countBadge.textContent = String(tab.count);

    btn.appendChild(textSpan);
    btn.appendChild(countBadge);

    btn.addEventListener("click", () => {
      state.activeFilterTab = tab.id;
      renderFilterTabs();
      renderGrid();
    });

    tabsContainer.appendChild(btn);
  }
}

/**
 * Renders the main spreadsheet data grid.
 */
function renderGrid() {
  const tableContainer = document.getElementById("grid-container");
  if (!tableContainer) return;

  tableContainer.replaceChildren();

  // Filter and sort products
  const filtered = filterAndSortCatalog(state.analyzedResults, {
    filterTab: state.activeFilterTab,
    searchQuery: state.searchQuery,
    favoritesSet: state.favorites,
    sortBy: state.sortBy,
    sortDir: state.sortDir
  });

  const countInfo = document.getElementById("grid-item-count");
  if (countInfo) {
    countInfo.textContent = `Showing ${filtered.length} of ${state.analyzedResults.length} items`;
  }

  if (filtered.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "grid-empty-state";

    const title = document.createElement("h3");
    title.textContent = state.analyzedResults.length === 0
      ? "No Products Loaded in Catalog"
      : "No Products Match Active Filters";

    const desc = document.createElement("p");
    desc.textContent = state.analyzedResults.length === 0
      ? "Upload a supplier CSV spreadsheet or load our 10-item demo catalog to start bulk analyzing."
      : "Try adjusting your search terms, clearing filter chips, or switching to the Full Data View.";

    emptyState.appendChild(title);
    emptyState.appendChild(desc);

    if (state.analyzedResults.length === 0) {
      const demoBtn = document.createElement("button");
      demoBtn.type = "button";
      demoBtn.className = "btn-primary";
      demoBtn.textContent = "⚡ Load 10-Item High-Fidelity Demo Catalog";
      demoBtn.addEventListener("click", handleLoadDemo);
      emptyState.appendChild(demoBtn);
    } else {
      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "btn-secondary";
      resetBtn.textContent = "Reset All Filters";
      resetBtn.addEventListener("click", () => {
        state.activeFilterTab = "all";
        state.searchQuery = "";
        const searchInput = document.getElementById("catalog-search-input");
        if (searchInput) searchInput.value = "";
        renderFilterTabs();
        renderGrid();
      });
      emptyState.appendChild(resetBtn);
    }

    tableContainer.appendChild(emptyState);
    return;
  }

  // Active columns to render
  const columnsToRender = GRID_COLUMNS.filter((col) => state.visibleColumns.has(col.id));

  const table = document.createElement("table");
  table.className = "bulk-data-table";

  // THEAD
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  for (const col of columnsToRender) {
    const th = document.createElement("th");
    th.className = `col-${col.align} col-${col.category}`;
    th.style.minWidth = `${col.minWidth}px`;
    th.setAttribute("scope", "col");

    const headerBtn = document.createElement("button");
    headerBtn.type = "button";
    headerBtn.className = "th-sort-button";
    headerBtn.textContent = col.label;

    if (state.sortBy === col.id) {
      const indicator = document.createElement("span");
      indicator.className = "sort-indicator";
      indicator.textContent = state.sortDir === "asc" ? " ▲" : " ▼";
      headerBtn.appendChild(indicator);
    }

    headerBtn.addEventListener("click", () => {
      if (col.id === "favorite" || col.id === "actions") return;
      if (state.sortBy === col.id) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortBy = col.id;
        state.sortDir = "desc";
      }
      renderGrid();
    });

    th.appendChild(headerBtn);
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // TBODY
  const tbody = document.createElement("tbody");

  filtered.forEach((item) => {
    const tr = document.createElement("tr");
    tr.className = `grid-row status-row--${item.status}`;
    if (state.favorites.has(item.id)) tr.classList.add("grid-row--favorite");

    for (const col of columnsToRender) {
      const td = document.createElement("td");
      td.className = `col-${col.align} col-${col.category}`;

      switch (col.id) {
        case "favorite": {
          const isFav = state.favorites.has(item.id);
          const favBtn = document.createElement("button");
          favBtn.type = "button";
          favBtn.className = `btn-star ${isFav ? "btn-star--active" : ""}`;
          favBtn.setAttribute("aria-label", isFav ? "Remove from shortlist" : "Add to shortlist");
          favBtn.textContent = isFav ? "★" : "☆";

          favBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (state.favorites.has(item.id)) {
              state.favorites.delete(item.id);
            } else {
              state.favorites.add(item.id);
            }
            saveFavorites();
            renderFilterTabs();
            renderGrid();
          });
          td.appendChild(favBtn);
          break;
        }

        case "rowNumber": {
          td.textContent = String(item.rowNumber);
          break;
        }

        case "productName": {
          const wrapper = document.createElement("div");
          wrapper.className = "cell-product-name";

          const titleSpan = document.createElement("span");
          titleSpan.className = "cell-product-title";
          titleSpan.textContent = item.productName;

          const skuSpan = document.createElement("span");
          skuSpan.className = "cell-product-sku";
          skuSpan.textContent = item.id;

          wrapper.appendChild(titleSpan);
          wrapper.appendChild(skuSpan);
          td.appendChild(wrapper);
          break;
        }

        case "category": {
          const badge = document.createElement("span");
          badge.className = "category-pill";
          badge.textContent = item.category;
          td.appendChild(badge);
          break;
        }

        case "itemPrice": {
          const input = document.createElement("input");
          input.type = "number";
          input.step = "0.01";
          input.min = "0.01";
          input.value = item.itemPrice.toFixed(2);
          input.className = "cell-number-input";
          input.setAttribute("aria-label", `Listing price for ${item.productName}`);

          input.addEventListener("change", (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val) && val > 0) {
              const targetRaw = state.rawProducts[item.index];
              if (targetRaw) {
                targetRaw.itemPrice = val;
                targetRaw.item_price = val;
                recalculateAndRender();
              }
            }
          });
          td.appendChild(input);
          break;
        }

        case "shippingCharged": {
          td.textContent = formatCurrency(item.shippingCharged, item.countryCode);
          break;
        }

        case "grossRevenue": {
          td.textContent = formatCurrency(item.grossRevenue, item.countryCode);
          break;
        }

        case "productionCost": {
          const input = document.createElement("input");
          input.type = "number";
          input.step = "0.01";
          input.min = "0";
          input.value = item.productionCost.toFixed(2);
          input.className = "cell-number-input";
          input.setAttribute("aria-label", `Unit COGS for ${item.productName}`);

          input.addEventListener("change", (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val) && val >= 0) {
              const targetRaw = state.rawProducts[item.index];
              if (targetRaw) {
                targetRaw.productionCost = val;
                targetRaw.production_cost = val;
                recalculateAndRender();
              }
            }
          });
          td.appendChild(input);
          break;
        }

        case "packagingCost": {
          td.textContent = formatCurrency(item.packagingCost, item.countryCode);
          break;
        }

        case "shippingCost": {
          td.textContent = formatCurrency(item.shippingCost, item.countryCode);
          break;
        }

        case "totalCosts": {
          td.textContent = formatCurrency(item.totalSellerCosts, item.countryCode);
          break;
        }

        case "listingFee": {
          td.textContent = formatCurrency(item.feeBreakdown.listing, item.countryCode);
          break;
        }

        case "transactionFee": {
          td.textContent = formatCurrency(item.feeBreakdown.transaction, item.countryCode);
          break;
        }

        case "processingFee": {
          td.textContent = formatCurrency(item.feeBreakdown.processing, item.countryCode);
          break;
        }

        case "regulatoryFee": {
          td.textContent = formatCurrency(item.feeBreakdown.regulatory, item.countryCode);
          break;
        }

        case "totalEtsyFees": {
          const feeBtn = document.createElement("button");
          feeBtn.type = "button";
          feeBtn.className = "btn-link-action";
          feeBtn.textContent = formatCurrency(item.totalEtsyFees, item.countryCode);
          feeBtn.setAttribute("title", "Click to inspect itemized Etsy fee receipt");
          feeBtn.addEventListener("click", () => openFeeReceiptModal(item));
          td.appendChild(feeBtn);
          break;
        }

        case "netProfit": {
          const profitSpan = document.createElement("button");
          profitSpan.type = "button";
          profitSpan.className = `btn-link-action cell-profit ${item.netProfit >= 0 ? "cell-profit--positive" : "cell-profit--negative"}`;
          profitSpan.textContent = formatCurrency(item.netProfit, item.countryCode);
          profitSpan.setAttribute("title", "Click to inspect fee and cost breakdown");
          profitSpan.addEventListener("click", () => openFeeReceiptModal(item));
          td.appendChild(profitSpan);
          break;
        }

        case "margin": {
          const badge = document.createElement("span");
          badge.className = `margin-badge ${item.marginPct >= 25 ? "margin-badge--high" : item.marginPct >= 15 ? "margin-badge--mid" : "margin-badge--low"}`;
          badge.textContent = formatPct(item.marginPct);
          td.appendChild(badge);
          break;
        }

        case "roi": {
          const badge = document.createElement("span");
          badge.className = `roi-badge ${item.roi >= 50 ? "roi-badge--high" : item.roi >= 20 ? "roi-badge--mid" : "roi-badge--low"}`;
          badge.textContent = formatPct(item.roi);
          td.appendChild(badge);
          break;
        }

        case "breakEvenPrice": {
          td.textContent = formatCurrency(item.breakEvenPrice, item.countryCode);
          break;
        }

        case "offsite15Profit": {
          const span = document.createElement("span");
          span.className = item.offsite15NetProfit >= 0 ? "text-positive" : "text-negative font-bold";
          span.textContent = formatCurrency(item.offsite15NetProfit, item.countryCode);
          if (item.becomesUnprofitableAt15Pct) {
            span.setAttribute("title", "Warning: 15% Offsite Ads wipes out all net profit!");
          }
          td.appendChild(span);
          break;
        }

        case "status": {
          const badge = document.createElement("span");
          badge.className = `status-badge status-badge--${item.status}`;
          badge.textContent = item.statusLabel;
          td.appendChild(badge);
          break;
        }

        case "actions": {
          const delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.className = "btn-row-action btn-row-delete";
          delBtn.setAttribute("aria-label", `Delete ${item.productName}`);
          delBtn.textContent = "✕";
          delBtn.addEventListener("click", () => {
            state.rawProducts.splice(item.index, 1);
            recalculateAndRender();
          });
          td.appendChild(delBtn);
          break;
        }

        default:
          td.textContent = "—";
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  tableContainer.appendChild(table);
}

/**
 * Loads the 10-item demo catalog.
 */
function handleLoadDemo() {
  state.rawProducts = EXPANDED_DEMO_CATALOG.map((item, idx) => ({
    ...item,
    id: `SKU-${idx + 1}`
  }));
  recalculateAndRender();
}

/**
 * Handles View Preset changes.
 */
function handlePresetChange(presetId) {
  const preset = VIEW_PRESETS[presetId];
  if (!preset) return;

  state.currentPreset = presetId;
  state.visibleColumns = new Set(preset.columns);

  const select = document.getElementById("preset-view-select");
  if (select) select.value = presetId;

  renderGrid();
}

/**
 * Exports currently filtered or favorited catalog to CSV.
 */
function handleExport(mode = "all") {
  const dataset = mode === "favorites"
    ? state.analyzedResults.filter((r) => state.favorites.has(r.id))
    : state.analyzedResults;

  if (dataset.length === 0) {
    alert(mode === "favorites" ? "No favorites selected in your shortlist." : "No products to export.");
    return;
  }

  const csvText = exportCatalogToCsv(dataset, state.favorites);
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const filename = mode === "favorites" ? "shopprofit-etsy-favorites.csv" : "shopprofit-etsy-catalog-analysis.csv";

  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Opens the Itemized Etsy Fee Receipt Modal (matching Analyzer.Tools profit popover).
 */
function openFeeReceiptModal(item) {
  state.selectedReceiptItem = item;
  const modal = document.getElementById("fee-receipt-modal");
  if (!modal) return;

  const content = document.getElementById("receipt-content");
  if (content) {
    content.replaceChildren();

    const header = document.createElement("div");
    header.className = "receipt-header";

    const title = document.createElement("h3");
    title.textContent = item.productName;

    const sub = document.createElement("p");
    sub.textContent = `SKU: ${item.id} | Country: ${item.countryName} (${item.countryCode}) | Currency: ${item.currency}`;

    header.appendChild(title);
    header.appendChild(sub);
    content.appendChild(header);

    // Math Table
    const table = document.createElement("table");
    table.className = "receipt-table";

    const rows = [
      { label: "Item Listing Price", amount: item.itemPrice, type: "revenue" },
      { label: "+ Buyer Shipping Charged", amount: item.shippingCharged, type: "revenue" },
      { label: "= Gross Order Revenue", amount: item.grossRevenue, type: "subtotal" },
      { label: "— Etsy Listing Fee ($0.20 USD equivalent)", amount: -item.feeBreakdown.listing, type: "fee" },
      { label: "— Etsy Transaction Fee (6.5%)", amount: -item.feeBreakdown.transaction, type: "fee" },
      { label: "— Payment Processing Fee", amount: -item.feeBreakdown.processing, type: "fee" },
      { label: "— Regulatory Operating Fee", amount: -item.feeBreakdown.regulatory, type: "fee" },
      { label: "— Total Etsy Fees", amount: -item.totalEtsyFees, type: "fee-subtotal" },
      { label: "— Unit Production Cost (COGS)", amount: -item.productionCost, type: "cost" },
      { label: "— Packaging Cost", amount: -item.packagingCost, type: "cost" },
      { label: "— Postage / Shipping Cost", amount: -item.shippingCost, type: "cost" },
      { label: "— Total Seller Out-of-Pocket Costs", amount: -item.totalSellerCosts, type: "cost-subtotal" },
      { label: "★ Net Take-Home Profit", amount: item.netProfit, type: "total" }
    ];

    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.className = `receipt-row receipt-row--${r.type}`;

      const labelTd = document.createElement("td");
      labelTd.textContent = r.label;

      const amtTd = document.createElement("td");
      amtTd.className = "col-right";
      amtTd.textContent = formatCurrency(Math.abs(r.amount), item.countryCode);
      if (r.amount < 0) amtTd.textContent = `-${amtTd.textContent}`;

      tr.appendChild(labelTd);
      tr.appendChild(amtTd);
      table.appendChild(tr);
    }
    content.appendChild(table);

    // Metrics summary pills
    const metricsDiv = document.createElement("div");
    metricsDiv.className = "receipt-metrics";

    const marginPill = document.createElement("span");
    marginPill.className = "receipt-pill";
    marginPill.textContent = `Profit Margin: ${formatPct(item.marginPct)}`;

    const roiPill = document.createElement("span");
    roiPill.className = "receipt-pill";
    roiPill.textContent = `ROI on Costs: ${formatPct(item.roi)}`;

    const breakEvenPill = document.createElement("span");
    breakEvenPill.className = "receipt-pill";
    breakEvenPill.textContent = `Break-Even Price: ${formatCurrency(item.breakEvenPrice, item.countryCode)}`;

    metricsDiv.appendChild(marginPill);
    metricsDiv.appendChild(roiPill);
    metricsDiv.appendChild(breakEvenPill);
    content.appendChild(metricsDiv);
  }

  modal.classList.add("modal--open");
}

/**
 * Sets up listeners for the Column Chooser drawer.
 */
function setupColumnChooser() {
  const modal = document.getElementById("column-chooser-modal");
  const listContainer = document.getElementById("column-checkbox-list");
  if (!modal || !listContainer) return;

  listContainer.replaceChildren();

  for (const col of GRID_COLUMNS) {
    if (col.id === "actions") continue;

    const label = document.createElement("label");
    label.className = "column-toggle-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = col.id;
    cb.checked = state.visibleColumns.has(col.id);

    cb.addEventListener("change", () => {
      if (cb.checked) {
        state.visibleColumns.add(col.id);
      } else {
        if (state.visibleColumns.size > 2) {
          state.visibleColumns.delete(col.id);
        } else {
          cb.checked = true;
          alert("At least 2 columns must remain visible.");
        }
      }
      renderGrid();
    });

    const nameSpan = document.createElement("span");
    nameSpan.textContent = col.label;

    const catSpan = document.createElement("span");
    catSpan.className = "column-cat-tag";
    catSpan.textContent = col.category;

    label.appendChild(cb);
    label.appendChild(nameSpan);
    label.appendChild(catSpan);
    listContainer.appendChild(label);
  }
}

/**
 * Initializes the Upload & Ingestion Wizard.
 */
function setupUploadWizard() {
  const fileInput = document.getElementById("catalog-file-input");
  const dropZone = document.getElementById("catalog-drop-zone");
  const processBtn = document.getElementById("btn-process-upload");

  if (!fileInput || !dropZone || !processBtn) return;

  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drop-zone--drag");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drop-zone--drag");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drop-zone--drag");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) {
      handleFileSelected(fileInput.files[0]);
    }
  });

  function handleFileSelected(file) {
    state.stagedFile = file;
    const fileLabel = document.getElementById("selected-file-label");
    if (fileLabel) {
      fileLabel.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
      fileLabel.classList.remove("hidden");
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const decoded = decodeAndValidateCsvText(text);
        const { records } = parseCsvRecords(decoded);

        if (records.length < 2) {
          alert("The CSV file must contain a header row and at least 1 product data row.");
          return;
        }

        const headers = records[0];
        const rawRows = records.slice(1);
        const { mapping, unknownColumns } = mapCsvHeaders(headers);

        state.stagedHeaders = headers;
        state.stagedRecords = rawRows;
        state.stagedMapping = mapping;

        // Populate Preview Table in Step 2
        renderUploadPreview(headers, rawRows, mapping);
        document.getElementById("upload-step-1")?.classList.add("hidden");
        document.getElementById("upload-step-2")?.classList.remove("hidden");
        processBtn.removeAttribute("disabled");
      } catch (err) {
        alert(`Error parsing CSV file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  processBtn.addEventListener("click", () => {
    if (state.stagedRecords.length === 0) return;

    const parsedProducts = [];
    const mapping = state.stagedMapping;

    state.stagedRecords.forEach((row, idx) => {
      if (!row || row.length === 0 || (row.length === 1 && !row[0].trim())) return;

      const productName = mapping.product_name !== undefined ? sanitizeCsvTextCell(row[mapping.product_name]) : `Product #${idx + 1}`;
      const itemPrice = mapping.item_price !== undefined ? parseFloat(row[mapping.item_price]) || 0 : 0;
      const shippingCharged = mapping.shipping_charged !== undefined ? parseFloat(row[mapping.shipping_charged]) || 0 : 0;
      const productionCost = mapping.production_cost !== undefined ? parseFloat(row[mapping.production_cost]) || 0 : 0;
      const packagingCost = mapping.packaging_cost !== undefined ? parseFloat(row[mapping.packaging_cost]) || 0 : 0;
      const shippingCost = mapping.shipping_cost !== undefined ? parseFloat(row[mapping.shipping_cost]) || 0 : 0;

      parsedProducts.push({
        id: `SKU-${idx + 1}`,
        productName: productName || `Product #${idx + 1}`,
        itemPrice: Math.max(0.01, itemPrice),
        shippingCharged,
        productionCost,
        packagingCost,
        shippingCost,
        category: "Imported"
      });
    });

    state.rawProducts = parsedProducts;
    recalculateAndRender();

    // Close modal
    document.getElementById("upload-wizard-modal")?.classList.remove("modal--open");
    document.getElementById("upload-step-1")?.classList.remove("hidden");
    document.getElementById("upload-step-2")?.classList.add("hidden");
    processBtn.setAttribute("disabled", "true");
    fileInput.value = "";
  });
}

/**
 * Renders CSV preview and mapping confirmation.
 */
function renderUploadPreview(headers, rows, mapping) {
  const container = document.getElementById("mapping-preview-container");
  if (!container) return;

  container.replaceChildren();

  const previewTable = document.createElement("table");
  previewTable.className = "preview-mini-table";

  const thead = document.createElement("thead");
  const trH = document.createElement("tr");

  headers.forEach((h, colIdx) => {
    const th = document.createElement("th");
    th.textContent = h;

    // Show mapped target indicator
    for (const [targetKey, mappedIdx] of Object.entries(mapping)) {
      if (mappedIdx === colIdx) {
        const badge = document.createElement("span");
        badge.className = "mapping-badge";
        badge.textContent = `→ ${targetKey}`;
        th.appendChild(badge);
      }
    }
    trH.appendChild(th);
  });
  thead.appendChild(trH);
  previewTable.appendChild(thead);

  const tbody = document.createElement("tbody");
  const sampleRows = rows.slice(0, 3);

  sampleRows.forEach((row) => {
    const tr = document.createElement("tr");
    headers.forEach((_, colIdx) => {
      const td = document.createElement("td");
      td.textContent = row[colIdx] || "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  previewTable.appendChild(tbody);
  container.appendChild(previewTable);
}

/**
 * Master initialization function called on DOMContentLoaded.
 */
export function initBulkPage() {
  loadPersistedFavorites();

  // Populate Country Selector with 62 markets
  const countrySelect = document.getElementById("catalog-country-select");
  if (countrySelect) {
    countrySelect.replaceChildren();
    for (const [code, rule] of Object.entries(GLOBAL_COUNTRY_RULES)) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = `${rule.name} (${code}) — ${rule.currency}`;
      if (code === state.settings.country) opt.selected = true;
      countrySelect.appendChild(opt);
    }

    countrySelect.addEventListener("change", (e) => {
      state.settings.country = e.target.value;
      recalculateAndRender();
    });
  }

  // Preset Views Dropdown
  const presetSelect = document.getElementById("preset-view-select");
  if (presetSelect) {
    presetSelect.replaceChildren();
    for (const [id, preset] of Object.entries(VIEW_PRESETS)) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = preset.label;
      if (id === state.currentPreset) opt.selected = true;
      presetSelect.appendChild(opt);
    }

    presetSelect.addEventListener("change", (e) => {
      handlePresetChange(e.target.value);
    });
  }

  // Search input
  const searchInput = document.getElementById("catalog-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderGrid();
    });
  }

  // Load Demo Button
  const loadDemoBtn = document.getElementById("load-demo-btn");
  if (loadDemoBtn) {
    loadDemoBtn.addEventListener("click", handleLoadDemo);
  }

  // Ingest Catalog Button
  const openUploadBtn = document.getElementById("open-upload-btn");
  if (openUploadBtn) {
    openUploadBtn.addEventListener("click", () => {
      document.getElementById("upload-wizard-modal")?.classList.add("modal--open");
    });
  }

  // Column Chooser Button
  const toggleColumnsBtn = document.getElementById("toggle-columns-btn");
  if (toggleColumnsBtn) {
    toggleColumnsBtn.addEventListener("click", () => {
      setupColumnChooser();
      document.getElementById("column-chooser-modal")?.classList.add("modal--open");
    });
  }

  // Additional Expenses / Adjustments Drawer Button
  const toggleAdjustmentsBtn = document.getElementById("toggle-adjustments-btn");
  if (toggleAdjustmentsBtn) {
    toggleAdjustmentsBtn.addEventListener("click", () => {
      document.getElementById("adjustments-drawer-modal")?.classList.add("modal--open");
    });
  }

  // Export Buttons
  const exportAllBtn = document.getElementById("export-all-btn");
  if (exportAllBtn) {
    exportAllBtn.addEventListener("click", () => handleExport("all"));
  }

  const exportFavsBtn = document.getElementById("export-favs-btn");
  if (exportFavsBtn) {
    exportFavsBtn.addEventListener("click", () => handleExport("favorites"));
  }

  // Add Row Button
  const addRowBtn = document.getElementById("add-row-btn");
  if (addRowBtn) {
    addRowBtn.addEventListener("click", () => {
      const newIndex = state.rawProducts.length + 1;
      state.rawProducts.push({
        id: `SKU-${newIndex}`,
        productName: `New Custom Product #${newIndex}`,
        itemPrice: 25.00,
        shippingCharged: 0.00,
        productionCost: 5.00,
        packagingCost: 1.00,
        shippingCost: 3.50,
        category: "Custom"
      });
      recalculateAndRender();
    });
  }

  // Modal Close Buttons
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".modal--open").forEach((m) => m.classList.remove("modal--open"));
    });
  });

  // Adjustments Form Controls
  const offsiteSelect = document.getElementById("setting-offsite-ads");
  if (offsiteSelect) {
    offsiteSelect.addEventListener("change", (e) => {
      state.settings.offsiteRate = parseFloat(e.target.value) || 0;
      recalculateAndRender();
    });
  }

  const plusCb = document.getElementById("setting-etsy-plus");
  if (plusCb) {
    plusCb.addEventListener("change", (e) => {
      state.settings.plusEnabled = e.target.checked;
      recalculateAndRender();
    });
  }

  // Theme initialization & Toggle
  initTheme();

  // Ingestion Wizard setup
  setupUploadWizard();

  // Load demo catalog initially so page is rich and instantly interactive!
  handleLoadDemo();
}

/**
 * Manages theme synchronization between dark and light modes.
 */
function initTheme() {
  function setTheme(theme) {
    const dark = theme === "dark";
    document.body.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    const toggleBtn = document.getElementById("theme-toggle");
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      toggleBtn.title = dark ? "Switch to light mode" : "Switch to dark mode";
    }
    const metaTheme = document.querySelector("meta[name=theme-color]");
    if (metaTheme) {
      metaTheme.content = dark ? "#050505" : "#F2F1EC";
    }
  }

  let preferredTheme = "light";
  try {
    preferredTheme = localStorage.getItem("shopprofit-theme") || (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch (_e) {
    preferredTheme = "light";
  }
  setTheme(preferredTheme);

  document.getElementById("theme-toggle")?.addEventListener("click", () => {
    const next = document.body.classList.contains("dark") ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("shopprofit-theme", next);
    } catch (_e) {}
  });
}

// Auto-run if executed in a browser environment with document ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBulkPage);
  } else {
    initBulkPage();
  }
}
