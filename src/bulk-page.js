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
  SUPPLIER_PRESETS,
  generateSupplierCsvTemplate,
  exportCatalogToXlsx,
  computeMarginHistogram,
  computeCostWaterfall,
  computeScatterBounds,
  computeAdsSensitivityComparison,
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
  viewMode: "split", // "split", "grid", "charts"
  chartsCollapsed: false,
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
  renderVisualAnalytics();
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
      label: "Optimal Margin SKUs",
      value: String(s.winnerCount),
      badge: "Margin ≥ 30%",
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
 * Safely creates an SVG element with given attributes.
 */
function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

/**
 * Creates safe DOM elements for floating chart tooltip (safe DOM nodes only).
 */
function createTooltipNode(title, lines = [], note = null) {
  const root = document.createElement("div");
  const titleEl = document.createElement("div");
  titleEl.style.fontWeight = "700";
  titleEl.style.marginBottom = "4px";
  titleEl.style.color = "#F8FAFC";
  titleEl.textContent = title;
  root.appendChild(titleEl);

  for (const item of lines) {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.marginBottom = "2px";

    const lbl = document.createElement("span");
    lbl.textContent = item.label;
    if (item.sub) {
      lbl.style.fontSize = "10px";
      lbl.style.color = "#94A3B8";
    }

    const val = document.createElement("strong");
    val.textContent = item.val;
    if (item.color) val.style.color = item.color;

    row.appendChild(lbl);
    row.appendChild(val);
    root.appendChild(row);
  }

  if (note) {
    const noteEl = document.createElement("div");
    noteEl.style.fontSize = "10px";
    noteEl.style.color = "#38BDF8";
    noteEl.style.fontWeight = "600";
    noteEl.style.marginTop = "6px";
    noteEl.style.textAlign = "right";
    noteEl.textContent = note;
    root.appendChild(noteEl);
  }

  return root;
}

/**
 * Displays floating tooltip near cursor using safe DOM nodes.
 */
function showChartTooltip(e, contentNode) {
  const tip = document.getElementById("chart-tooltip");
  if (!tip) return;
  tip.replaceChildren(contentNode);
  tip.hidden = false;
  tip.setAttribute("aria-hidden", "false");

  const x = e.clientX + 14;
  const y = e.clientY + 14;
  tip.style.left = `${Math.min(window.innerWidth - 290, Math.max(10, x))}px`;
  tip.style.top = `${Math.min(window.innerHeight - 200, Math.max(10, y))}px`;
}

/**
 * Hides floating tooltip.
 */
function hideChartTooltip() {
  const tip = document.getElementById("chart-tooltip");
  if (!tip) return;
  tip.hidden = true;
  tip.setAttribute("aria-hidden", "true");
}

/**
 * Renders the Pricing vs. Margin Positioning Matrix with connected trajectory contour.
 */
function renderScatterChart(items, containerEl) {
  if (!containerEl) return;
  containerEl.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "chart-empty-state";
    empty.textContent = "No catalog data to plot.";
    containerEl.appendChild(empty);
    return;
  }

  const { minPrice, maxPrice, minMargin, maxMargin, medianPrice, targetMargin, points } = computeScatterBounds(items);

  const W = 520;
  const H = 260;
  const pad = { top: 22, right: 30, bottom: 35, left: 45 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;

  const svg = createSvgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "chart-svg chart-svg--scatter",
    role: "img",
    "aria-label": "Pricing and Margin Positioning Matrix"
  });

  const getX = (price) => pad.left + Math.max(0, Math.min(1, (price - minPrice) / (maxPrice - minPrice))) * pw;
  const getY = (margin) => pad.top + ph - Math.max(0, Math.min(1, (margin - minMargin) / (maxMargin - minMargin))) * ph;

  const xMedian = getX(medianPrice);
  const yZero = getY(0);
  const yTarget = getY(targetMargin);

  // Quadrant background fills (subtle executive tint)
  svg.appendChild(createSvgEl("rect", {
    x: xMedian,
    y: pad.top,
    width: Math.max(0, pad.left + pw - xMedian),
    height: Math.max(0, yTarget - pad.top),
    fill: "rgba(16, 185, 129, 0.05)",
    rx: "2"
  }));

  svg.appendChild(createSvgEl("rect", {
    x: pad.left,
    y: pad.top,
    width: Math.max(0, xMedian - pad.left),
    height: Math.max(0, yTarget - pad.top),
    fill: "rgba(14, 165, 233, 0.04)",
    rx: "2"
  }));

  if (yZero < pad.top + ph) {
    svg.appendChild(createSvgEl("rect", {
      x: pad.left,
      y: yZero,
      width: pw,
      height: Math.max(0, pad.top + ph - yZero),
      fill: "rgba(239, 68, 68, 0.05)",
      rx: "2"
    }));
  }

  // Corner quadrant watermark indicators (professional, no emojis)
  const watermarks = [
    { text: "OPTIMAL (≥30%)", x: pad.left + pw - 8, y: pad.top + 14, anchor: "end", color: "#10B981" },
    { text: "TARGET (15–30%)", x: pad.left + 8, y: pad.top + 14, anchor: "start", color: "#0EA5E9" },
    { text: "COMPRESSED (<15%)", x: pad.left + pw - 8, y: Math.min(yZero - 6, pad.top + ph - 8), anchor: "end", color: "#F59E0B" },
    { text: "DEFICIT (<0%)", x: pad.left + 8, y: pad.top + ph - 8, anchor: "start", color: "#EF4444" }
  ];

  for (const wm of watermarks) {
    const t = createSvgEl("text", {
      x: wm.x,
      y: wm.y,
      "text-anchor": wm.anchor,
      fill: wm.color,
      "font-size": "9",
      "font-weight": "700",
      opacity: "0.5",
      "letter-spacing": "0.06em",
      "font-family": "var(--mono)"
    });
    t.textContent = wm.text;
    svg.appendChild(t);
  }

  // Reference lines & axes
  const priceTicks = [minPrice, Math.round(medianPrice), Math.round(maxPrice)];
  for (const pt of priceTicks) {
    const x = getX(pt);
    svg.appendChild(createSvgEl("line", {
      x1: x, y1: pad.top, x2: x, y2: pad.top + ph,
      stroke: "var(--border, #E2E8F0)",
      "stroke-dasharray": "3,3",
      opacity: "0.4"
    }));
    const lbl = createSvgEl("text", {
      x: x, y: pad.top + ph + 15,
      "text-anchor": "middle",
      "font-size": "9",
      fill: "var(--muted, #64748B)",
      "font-family": "var(--mono)"
    });
    lbl.textContent = `$${pt}`;
    svg.appendChild(lbl);
  }

  const marginTicks = [0, targetMargin, Math.round(maxMargin)];
  for (const mt of marginTicks) {
    const y = getY(mt);
    svg.appendChild(createSvgEl("line", {
      x1: pad.left, y1: y, x2: pad.left + pw, y2: y,
      stroke: mt === 0 ? "#EF4444" : mt === targetMargin ? "#10B981" : "var(--border, #E2E8F0)",
      "stroke-dasharray": mt === 0 ? "none" : "3,3",
      "stroke-width": mt === 0 ? "1.5" : "1",
      opacity: mt === 0 ? "0.7" : "0.4"
    }));
    const lbl = createSvgEl("text", {
      x: pad.left - 6, y: y + 3,
      "text-anchor": "end",
      "font-size": "9",
      fill: mt === 0 ? "#EF4444" : mt === targetMargin ? "#10B981" : "var(--muted, #64748B)",
      "font-weight": mt === 0 || mt === targetMargin ? "700" : "400",
      "font-family": "var(--mono)"
    });
    lbl.textContent = `${mt}%`;
    svg.appendChild(lbl);
  }

  const xLabel = createSvgEl("text", {
    x: pad.left + pw / 2, y: H - 4,
    "text-anchor": "middle",
    "font-size": "9",
    "font-weight": "600",
    fill: "var(--muted, #64748B)"
  });
  xLabel.textContent = "Retail Price ($)";
  svg.appendChild(xLabel);

  // Connected Trajectory Contour (Multi-line area slope inspired by reference image)
  const sortedPoints = [...points].sort((a, b) => a.price - b.price);
  if (sortedPoints.length > 1) {
    let dArea = `M ${getX(sortedPoints[0].price)} ${pad.top + ph}`;
    let dLine = `M ${getX(sortedPoints[0].price)} ${getY(sortedPoints[0].margin)}`;

    for (const pt of sortedPoints) {
      const cx = getX(pt.price);
      const cy = getY(pt.margin);
      dArea += ` L ${cx} ${cy}`;
      dLine += ` L ${cx} ${cy}`;
    }
    dArea += ` L ${getX(sortedPoints[sortedPoints.length - 1].price)} ${pad.top + ph} Z`;

    svg.appendChild(createSvgEl("path", {
      d: dArea,
      fill: "rgba(14, 165, 233, 0.05)",
      class: "chart-trend-area"
    }));

    svg.appendChild(createSvgEl("path", {
      d: dLine,
      fill: "none",
      stroke: "rgba(14, 165, 233, 0.4)",
      "stroke-width": "1.5",
      "stroke-dasharray": "3,3",
      class: "chart-trend-line"
    }));
  }

  // Glowing Vector Nodes
  for (const pt of points) {
    const cx = getX(pt.price);
    const cy = getY(pt.margin);

    const circle = createSvgEl("circle", {
      cx, cy, r: "5.5",
      fill: pt.color,
      stroke: "var(--surface, #0A0F1D)",
      "stroke-width": "1.5",
      class: "chart-scatter-dot",
      tabindex: "0",
      "data-product-id": pt.id
    });

    circle.addEventListener("mouseenter", (e) => {
      circle.setAttribute("r", "8.5");
      circle.setAttribute("stroke-width", "2.5");
      const node = createTooltipNode(pt.productName, [
        { label: `SKU: ${pt.id} • ${pt.category}`, val: "", sub: true },
        { label: "Listing Price:", val: `$${pt.price.toFixed(2)}` },
        { label: "Net Profit:", val: `$${pt.profit.toFixed(2)}`, color: pt.profit >= 0 ? "#4ADE80" : "#F87171" },
        { label: "Profit Margin:", val: `${pt.margin.toFixed(1)}%`, color: pt.margin >= 30 ? "#4ADE80" : pt.margin >= 15 ? "#FBBF24" : "#F87171" },
        { label: "Total Etsy Fees:", val: `$${pt.totalFees.toFixed(2)}` }
      ], "Click node to inspect table record");
      showChartTooltip(e, node);
    });

    circle.addEventListener("mouseleave", () => {
      circle.setAttribute("r", "5.5");
      circle.setAttribute("stroke-width", "1.5");
      hideChartTooltip();
    });

    circle.addEventListener("click", () => {
      const row = document.querySelector(`tr[data-product-id="${pt.id}"]`);
      if (row) {
        document.querySelectorAll(".grid-row--highlighted").forEach((r) => r.classList.remove("grid-row--highlighted"));
        row.classList.add("grid-row--highlighted");
        row.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    svg.appendChild(circle);
  }

  containerEl.appendChild(svg);
}

/**
 * Renders the Margin Tier Distribution using pillared capsule bars inside rounded tracks.
 */
function renderHistogramChart(items, containerEl) {
  if (!containerEl) return;
  containerEl.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "chart-empty-state";
    empty.textContent = "No catalog data for distribution.";
    containerEl.appendChild(empty);
    return;
  }

  const hist = computeMarginHistogram(items);
  const bucketList = Object.values(hist.buckets);

  const W = 520;
  const H = 260;
  const pad = { top: 32, right: 25, bottom: 42, left: 25 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;

  const svg = createSvgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "chart-svg chart-svg--histogram",
    role: "img",
    "aria-label": "Margin Tier Distribution Pillared Capsule Chart"
  });

  const barCount = bucketList.length;
  const gap = 14;
  const barW = Math.max(18, (pw - gap * (barCount - 1)) / barCount);

  bucketList.forEach((b, idx) => {
    const x = pad.left + idx * (barW + gap);
    const barH = Math.max(b.count > 0 ? 12 : 0, (b.count / hist.maxCount) * ph);
    const y = pad.top + ph - barH;

    const isActive = state.activeFilterTab === b.tabId;

    // Track Slot (Full height pill slot background like the reference image)
    const track = createSvgEl("rect", {
      x, y: pad.top, width: barW, height: ph,
      rx: "9",
      class: "chart-pill-track"
    });
    svg.appendChild(track);

    // Filled Capsule Bar
    if (b.count > 0) {
      const pill = createSvgEl("rect", {
        x, y, width: barW, height: barH,
        rx: "9",
        fill: b.color,
        class: `chart-pill-bar ${isActive ? "is-active" : ""}`,
        tabindex: "0",
        "data-tab-id": b.tabId
      });

      pill.addEventListener("mouseenter", (e) => {
        const node = createTooltipNode(b.label, [
          { label: "Product Volume:", val: `${b.count} SKUs (${b.pct.toFixed(1)}%)`, color: b.color }
        ], "Click pillar to filter catalog");
        showChartTooltip(e, node);
      });

      pill.addEventListener("mouseleave", () => hideChartTooltip());

      pill.addEventListener("click", () => {
        state.activeFilterTab = b.tabId;
        renderFilterTabs();
        renderGrid();
        renderVisualAnalytics();
      });

      svg.appendChild(pill);

      // Percentage label inside capsule (like reference image: 15%, 20%, 35%, 100%)
      const pctText = createSvgEl("text", {
        x: x + barW / 2,
        y: barH >= 28 ? y + barH / 2 + 4 : y - 6,
        "text-anchor": "middle",
        "font-size": "10",
        "font-weight": "800",
        "font-family": "var(--mono)",
        fill: barH >= 28 ? "#FFFFFF" : "var(--fg, #0F172A)"
      });
      pctText.textContent = `${b.pct.toFixed(0)}%`;
      svg.appendChild(pctText);
    }

    // SKU Count above track
    const countText = createSvgEl("text", {
      x: x + barW / 2,
      y: pad.top - 10,
      "text-anchor": "middle",
      "font-size": "10",
      "font-weight": "700",
      "font-family": "var(--mono)",
      fill: b.count > 0 ? "var(--fg, #0F172A)" : "var(--muted, #64748B)"
    });
    countText.textContent = `${b.count}`;
    svg.appendChild(countText);

    // Tier Label below track
    const labelText = createSvgEl("text", {
      x: x + barW / 2,
      y: pad.top + ph + 16,
      "text-anchor": "middle",
      "font-size": "10",
      "font-weight": "700",
      fill: "var(--fg, #0F172A)"
    });
    labelText.textContent = b.label.split(" ")[0];
    svg.appendChild(labelText);

    // Margin range subtext below
    const subText = createSvgEl("text", {
      x: x + barW / 2,
      y: pad.top + ph + 28,
      "text-anchor": "middle",
      "font-size": "8",
      "font-family": "var(--mono)",
      fill: "var(--muted, #64748B)"
    });
    const ranges = ["<0%", "0–15%", "15–30%", "30–50%", "≥50%"];
    subText.textContent = ranges[idx] || "";
    svg.appendChild(subText);
  });

  containerEl.appendChild(svg);
}

/**
 * Renders the Cost Structure & Margin Decomposition using a concentric donut with pointer callout lines and radial gauge rings.
 */
function renderWaterfallChart(items, containerEl) {
  if (!containerEl) return;
  containerEl.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "chart-empty-state";
    empty.textContent = "No catalog data for cost decomposition.";
    containerEl.appendChild(empty);
    return;
  }

  const waterfall = computeCostWaterfall(items);
  const steps = waterfall.steps;

  const W = 520;
  const H = 260;

  const svg = createSvgEl("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "chart-svg chart-svg--donut",
    role: "img",
    "aria-label": "Cost Structure and Margin Decomposition Infographic"
  });

  // Left Donut Center & Radii
  const cx = 150;
  const cy = 130;
  const R = 78;
  const r = 48;

  // Map 5 components: net profit, cogs, shipping, platform fees, payment fees
  const grossRev = Math.max(1, waterfall.grossRevenue);
  const slices = steps.filter((s) => s.id !== "revenue");

  let currentAngle = -Math.PI / 2; // start from 12 o'clock

  slices.forEach((s) => {
    const sliceAngle = (Math.max(0, s.amount) / grossRev) * (2 * Math.PI);
    if (sliceAngle <= 0.001) return;

    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    currentAngle = endAngle;

    // Outer & inner arc coordinates
    const x1 = cx + R * Math.cos(startAngle);
    const y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(endAngle);
    const y2 = cy + R * Math.sin(endAngle);
    const x3 = cx + r * Math.cos(endAngle);
    const y3 = cy + r * Math.sin(endAngle);
    const x4 = cx + r * Math.cos(startAngle);
    const y4 = cy + r * Math.sin(startAngle);

    const largeArc = sliceAngle > Math.PI ? 1 : 0;
    const d = `M ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${r} ${r} 0 ${largeArc} 0 ${x4} ${y4} Z`;

    const path = createSvgEl("path", {
      d,
      fill: s.color,
      stroke: "var(--surface, #0A0F1D)",
      "stroke-width": "2",
      class: "chart-donut-segment",
      tabindex: "0"
    });

    path.addEventListener("mouseenter", (e) => {
      const node = createTooltipNode(s.label.replace(/^[−=]\s*/, ""), [
        { label: "Amount:", val: `$${s.amount.toFixed(2)}`, color: s.color },
        { label: "Share of Revenue:", val: `${s.pct.toFixed(1)}%` }
      ]);
      showChartTooltip(e, node);
    });

    path.addEventListener("mouseleave", () => hideChartTooltip());

    svg.appendChild(path);

    // Vector Callout Pointer Lines (for slices >= 4%)
    if (s.pct >= 4) {
      const midAngle = (startAngle + endAngle) / 2;
      const isRight = Math.cos(midAngle) >= 0;

      const px1 = cx + R * Math.cos(midAngle);
      const py1 = cy + R * Math.sin(midAngle);
      const px2 = cx + (R + 14) * Math.cos(midAngle);
      const py2 = cy + (R + 14) * Math.sin(midAngle);
      const px3 = isRight ? px2 + 18 : px2 - 18;

      const polyline = createSvgEl("polyline", {
        points: `${px1},${py1} ${px2},${py2} ${px3},${py2}`,
        stroke: s.color,
        "stroke-width": "1.2",
        fill: "none",
        class: "chart-callout-line"
      });
      svg.appendChild(polyline);

      const dot = createSvgEl("circle", {
        cx: px1, cy: py1, r: "2.2",
        fill: s.color
      });
      svg.appendChild(dot);

      const calloutText = createSvgEl("text", {
        x: isRight ? px3 + 4 : px3 - 4,
        y: py2 + 3,
        "text-anchor": isRight ? "start" : "end",
        "font-size": "9",
        "font-weight": "700",
        "font-family": "var(--mono)",
        fill: s.color
      });
      calloutText.textContent = `${s.pct.toFixed(0)}%`;
      svg.appendChild(calloutText);
    }
  });

  // Center Cutout Circle & Metric
  const centerCircle = createSvgEl("circle", {
    cx, cy, r: r - 2,
    fill: "var(--surface, #0A0F1D)",
    stroke: "var(--border, #1E293B)",
    "stroke-width": "1"
  });
  svg.appendChild(centerCircle);

  const netStep = steps.find((s) => s.id === "net_profit") || { pct: 0, amount: 0 };
  const centerPct = createSvgEl("text", {
    x: cx, y: cy - 4,
    "text-anchor": "middle",
    "font-size": "18",
    "font-weight": "800",
    "font-family": "var(--mono)",
    fill: netStep.amount >= 0 ? "#10B981" : "#EF4444"
  });
  centerPct.textContent = `${netStep.pct.toFixed(0)}%`;
  svg.appendChild(centerPct);

  const centerLabel = createSvgEl("text", {
    x: cx, y: cy + 10,
    "text-anchor": "middle",
    "font-size": "8",
    "font-weight": "700",
    "letter-spacing": "0.08em",
    fill: "var(--muted, #64748B)"
  });
  centerLabel.textContent = "NET MARGIN";
  svg.appendChild(centerLabel);

  const centerDollar = createSvgEl("text", {
    x: cx, y: cy + 22,
    "text-anchor": "middle",
    "font-size": "9",
    "font-weight": "600",
    "font-family": "var(--mono)",
    fill: "var(--fg, #0F172A)"
  });
  centerDollar.textContent = `$${Math.round(netStep.amount)}`;
  svg.appendChild(centerDollar);

  // Right Side: 3 Circular Radial Gauge Rings (like the 75%, 50%, 25% rings in reference image)
  const totalItems = Math.max(1, items.length);
  const profitableCount = items.filter((i) => (Number(i.netProfit) || 0) > 0).length;
  const profitablePct = (profitableCount / totalItems) * 100;
  const targetCount = items.filter((i) => {
    const m = typeof i.marginPct === "number" ? i.marginPct : (i.margin <= 1 ? i.margin * 100 : i.margin);
    return m >= 30;
  }).length;
  const targetPct = (targetCount / totalItems) * 100;

  const rings = [
    {
      title: "Portfolio Net Margin",
      valText: `${netStep.pct.toFixed(1)}%`,
      pct: Math.max(0, Math.min(100, netStep.pct)),
      color: "#10B981",
      cy: 52,
      sub: `$${waterfall.netProfit.toFixed(2)} Take-Home`
    },
    {
      title: "Profitable Catalog Rate",
      valText: `${profitablePct.toFixed(0)}%`,
      pct: profitablePct,
      color: "#0EA5E9",
      cy: 130,
      sub: `${profitableCount} of ${totalItems} SKUs Profitable`
    },
    {
      title: "Target Margin Compliance",
      valText: `${targetPct.toFixed(0)}%`,
      pct: targetPct,
      color: "#8B5CF6",
      cy: 208,
      sub: `${targetCount} of ${totalItems} SKUs ≥ 30%`
    }
  ];

  const ringRadius = 22;
  const circumference = 2 * Math.PI * ringRadius;

  rings.forEach((rg) => {
    const rx = 350;

    // Track circle
    svg.appendChild(createSvgEl("circle", {
      cx: rx, cy: rg.cy, r: ringRadius,
      class: "chart-radial-ring-track",
      "stroke-width": "4.5"
    }));

    // Filled progress arc
    const offset = circumference - (rg.pct / 100) * circumference;
    const arc = createSvgEl("circle", {
      cx: rx, cy: rg.cy, r: ringRadius,
      stroke: rg.color,
      "stroke-width": "4.5",
      "stroke-dasharray": `${circumference}`,
      "stroke-dashoffset": `${offset}`,
      class: "chart-radial-ring-fill",
      transform: `rotate(-90 ${rx} ${rg.cy})`
    });
    svg.appendChild(arc);

    // Value inside ring
    const valText = createSvgEl("text", {
      x: rx, y: rg.cy + 4,
      "text-anchor": "middle",
      "font-size": "9",
      "font-weight": "800",
      "font-family": "var(--mono)",
      fill: "var(--fg, #0F172A)"
    });
    valText.textContent = `${Math.round(rg.pct)}%`;
    svg.appendChild(valText);

    // Title label to right
    const titleText = createSvgEl("text", {
      x: rx + 34, y: rg.cy - 2,
      "text-anchor": "start",
      "font-size": "10",
      "font-weight": "700",
      fill: "var(--fg, #0F172A)"
    });
    titleText.textContent = rg.title;
    svg.appendChild(titleText);

    // Subtitle label to right
    const subText = createSvgEl("text", {
      x: rx + 34, y: rg.cy + 12,
      "text-anchor": "start",
      "font-size": "9",
      "font-family": "var(--mono)",
      fill: "var(--muted, #64748B)"
    });
    subText.textContent = rg.sub;
    svg.appendChild(subText);
  });

  containerEl.appendChild(svg);
}

/**
 * Renders the 15% Offsite Ads Sensitivity & Stress-Test chart.
 */
function renderAdsSensitivityChart(items, containerEl) {
  if (!containerEl) return;
  containerEl.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "chart-empty-state";
    empty.textContent = "No catalog data for ad sensitivity.";
    containerEl.appendChild(empty);
    return;
  }

  const ads = computeAdsSensitivityComparison(items);

  const wrapper = document.createElement("div");
  wrapper.className = "ads-sensitivity-content";

  // 1. Mini KPI cards
  const metricsGrid = document.createElement("div");
  metricsGrid.className = "ads-mini-kpis";

  function createAdsMiniCard(label, valText, valColor, subText) {
    const card = document.createElement("div");
    card.className = "ads-mini-card";
    const lbl = document.createElement("span");
    lbl.className = "ads-mini-card__label";
    lbl.textContent = label;
    const val = document.createElement("span");
    val.className = "ads-mini-card__val";
    val.style.color = valColor;
    val.textContent = valText;
    const sub = document.createElement("span");
    sub.className = "ads-mini-card__sub";
    sub.textContent = subText;
    card.appendChild(lbl);
    card.appendChild(val);
    card.appendChild(sub);
    return card;
  }

  metricsGrid.appendChild(createAdsMiniCard("Organic Profit", `$${ads.organicProfit.toFixed(2)}`, "#10B981", `${ads.organicMargin.toFixed(1)}% margin`));
  metricsGrid.appendChild(createAdsMiniCard("With 15% Ads", `$${ads.adsProfit.toFixed(2)}`, ads.adsProfit >= 0 ? "#F59E0B" : "#EF4444", `${ads.adsMargin.toFixed(1)}% margin`));
  metricsGrid.appendChild(createAdsMiniCard("Profit Erosion", `-$${ads.erosionDollar.toFixed(2)}`, "#EF4444", `-${ads.erosionPct.toFixed(1)}% drop`));
  wrapper.appendChild(metricsGrid);

  // 2. Comparative Horizontal Bars
  const barsWrap = document.createElement("div");
  barsWrap.className = "ads-comparison-bars";

  const maxProfit = Math.max(1, ads.organicProfit, Math.abs(ads.adsProfit));
  const orgWidthPct = Math.max(4, Math.min(100, (Math.max(0, ads.organicProfit) / maxProfit) * 100));
  const adsWidthPct = Math.max(4, Math.min(100, (Math.max(0, ads.adsProfit) / maxProfit) * 100));

  function createAdsBarRow(label, valText, widthPct, barColor) {
    const row = document.createElement("div");
    row.className = "ads-bar-row";
    const lblRow = document.createElement("div");
    lblRow.className = "ads-bar-label";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = label;
    const amtStrong = document.createElement("strong");
    amtStrong.textContent = valText;
    lblRow.appendChild(nameSpan);
    lblRow.appendChild(amtStrong);

    const track = document.createElement("div");
    track.className = "ads-bar-track";
    const fill = document.createElement("div");
    fill.className = "ads-bar-fill";
    fill.style.width = `${widthPct}%`;
    fill.style.background = barColor;
    track.appendChild(fill);

    row.appendChild(lblRow);
    row.appendChild(track);
    return row;
  }

  barsWrap.appendChild(createAdsBarRow("Organic (0% Ads)", `$${ads.organicProfit.toFixed(2)}`, orgWidthPct, "#10B981"));
  barsWrap.appendChild(createAdsBarRow("Attributed (15% Ads)", `$${ads.adsProfit.toFixed(2)}`, adsWidthPct, ads.adsProfit >= 0 ? "#F59E0B" : "#EF4444"));
  wrapper.appendChild(barsWrap);

  // 3. At-Risk Alert Pill
  const alertBox = document.createElement("div");
  if (ads.atRiskCount > 0) {
    alertBox.className = "ads-risk-alert ads-risk-alert--danger";
    const textSpan = document.createElement("span");
    textSpan.textContent = `Catalog Risk: ${ads.atRiskCount} of ${ads.totalItems} products operate at an deficit under 15% ad attribution.`;
    const filterBtn = document.createElement("button");
    filterBtn.type = "button";
    filterBtn.className = "button button-quiet btn-filter-ads-risk";
    filterBtn.style.padding = "2px 8px";
    filterBtn.style.fontSize = "11px";
    filterBtn.style.marginLeft = "8px";
    filterBtn.textContent = "Filter At-Risk Records";
    filterBtn.addEventListener("click", () => {
      state.activeFilterTab = "ads_risk";
      renderFilterTabs();
      renderGrid();
    });
    alertBox.appendChild(textSpan);
    alertBox.appendChild(filterBtn);
  } else {
    alertBox.className = "ads-risk-alert ads-risk-alert--safe";
    const textSpan = document.createElement("span");
    textSpan.textContent = "Catalog Resilient: 100% of products in this catalog maintain positive net margin under 15% Offsite Ads attribution.";
    alertBox.appendChild(textSpan);
  }
  wrapper.appendChild(alertBox);

  containerEl.appendChild(wrapper);
}

/**
 * Master renderer for the full visual analytics dashboard.
 */
function renderVisualAnalytics() {
  const panel = document.getElementById("visual-analytics-panel");
  if (!panel) return;

  const scatterContainer = document.getElementById("scatter-chart-wrap");
  const histContainer = document.getElementById("histogram-chart-wrap");
  const waterfallContainer = document.getElementById("waterfall-chart-wrap");
  const adsContainer = document.getElementById("ads-sensitivity-chart-wrap");

  renderScatterChart(state.analyzedResults, scatterContainer);
  renderHistogramChart(state.analyzedResults, histContainer);
  renderWaterfallChart(state.analyzedResults, waterfallContainer);
  renderAdsSensitivityChart(state.analyzedResults, adsContainer);
}

/**
 * Wires View Mode Switcher controls: Split View, Grid Only, Visuals Only, and Collapse.
 */
function setupViewModeHandlers() {
  const splitBtn = document.getElementById("view-split-btn");
  const gridBtn = document.getElementById("view-grid-btn");
  const chartsBtn = document.getElementById("view-charts-btn");
  const collapseBtn = document.getElementById("toggle-charts-collapse-btn");

  const panel = document.getElementById("visual-analytics-panel");
  const chartsContainer = document.getElementById("visual-charts-container");
  const gridCard = document.getElementById("bulk-grid-card");
  const filterTabs = document.getElementById("filter-tabs");
  const collapseLabel = document.getElementById("charts-collapse-label");

  function applyViewMode(mode) {
    state.viewMode = mode;
    splitBtn?.classList.toggle("is-active", mode === "split");
    gridBtn?.classList.toggle("is-active", mode === "grid");
    chartsBtn?.classList.toggle("is-active", mode === "charts");

    if (mode === "grid") {
      if (panel) panel.style.display = "none";
      if (gridCard) gridCard.style.display = "block";
      if (filterTabs) filterTabs.style.display = "flex";
    } else if (mode === "charts") {
      if (panel) panel.style.display = "block";
      if (chartsContainer) chartsContainer.style.display = "grid";
      if (gridCard) gridCard.style.display = "none";
      if (filterTabs) filterTabs.style.display = "none";
    } else { // "split"
      if (panel) panel.style.display = "block";
      if (chartsContainer) chartsContainer.style.display = state.chartsCollapsed ? "none" : "grid";
      if (gridCard) gridCard.style.display = "block";
      if (filterTabs) filterTabs.style.display = "flex";
    }
  }

  splitBtn?.addEventListener("click", () => applyViewMode("split"));
  gridBtn?.addEventListener("click", () => applyViewMode("grid"));
  chartsBtn?.addEventListener("click", () => applyViewMode("charts"));

  collapseBtn?.addEventListener("click", () => {
    state.chartsCollapsed = !state.chartsCollapsed;
    collapseBtn.setAttribute("aria-expanded", String(!state.chartsCollapsed));
    if (chartsContainer) {
      chartsContainer.style.display = state.chartsCollapsed ? "none" : "grid";
    }
    if (collapseLabel) {
      collapseLabel.textContent = state.chartsCollapsed ? "Show Visuals" : "Hide Visuals";
    }
  });
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
    { id: "favorites", label: "Shortlist", count: favCount, highlight: true },
    { id: "winners", label: "Optimal Margin (≥30%)", count: winCount },
    { id: "high_roi", label: "High ROI (≥50%)", count: roiCount },
    { id: "thin_margin", label: "Compressed Margin (<15%)", count: thinCount },
    { id: "losses", label: "Operating Deficit (<0%)", count: lossCount },
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
      demoBtn.textContent = "Load 10-Item Demo Catalog";
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
    tr.dataset.productId = item.id;
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
          input.name = `price_${item.id}`;
          input.id = `input_price_${item.id}`;
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
          input.name = `cogs_${item.id}`;
          input.id = `input_cogs_${item.id}`;
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
 * Loads a supplier preset or demo catalog.
 */
function handleLoadSupplierPreset(presetKey) {
  if (presetKey === "demo") {
    handleLoadDemo();
    return;
  }
  const supplier = SUPPLIER_PRESETS[presetKey];
  if (!supplier) return;

  state.rawProducts = supplier.items.map((item, idx) => ({
    ...item,
    id: `${presetKey.toUpperCase().slice(0, 3)}-${idx + 1}`
  }));

  const select = document.getElementById("supplier-preset-select");
  if (select) select.value = presetKey;

  // Dismiss any open modal
  document.querySelectorAll(".modal--open").forEach((m) => m.classList.remove("modal--open"));

  recalculateAndRender();
}

/**
 * Downloads a pre-formatted supplier CSV template.
 */
function handleDownloadTemplate(supplierId) {
  const csvContent = generateSupplierCsvTemplate(supplierId);
  if (!csvContent) return;

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `${supplierId}-supplier-template.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Handles Excel (.xlsx) Export.
 */
function handleExportXlsx() {
  const dataset = state.analyzedResults;
  if (dataset.length === 0) {
    alert("No products to export.");
    return;
  }

  const xlsxBlobOrUint8 = exportCatalogToXlsx(dataset, state.favorites, state.settings.country);
  const blob = xlsxBlobOrUint8 instanceof Blob
    ? xlsxBlobOrUint8
    : new Blob([xlsxBlobOrUint8], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "shopprofit-etsy-sourcing-analysis.xlsx");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Opens the Executive PDF Profit Summary Modal with formatted C-level metrics.
 */
function openExecutiveReportModal() {
  const modal = document.getElementById("executive-report-modal");
  const content = document.getElementById("executive-report-content");
  if (!modal || !content) return;

  content.replaceChildren();

  const dataset = state.analyzedResults;
  const summary = state.summary || summarizeCatalog(dataset);
  const countryRule = resolveCountryFeeRule(state.settings.country);
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const timeStr = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  // 1. Report Header
  const headerEl = document.createElement("div");
  headerEl.className = "exec-report-header";

  const brandEl = document.createElement("div");
  brandEl.className = "exec-report-brand";
  brandEl.textContent = "SHOPPROFIT / EXECUTIVE CATALOG & SOURCING AUDIT";

  const metaRow = document.createElement("div");
  metaRow.className = "exec-report-meta-row";

  const col1 = document.createElement("span");
  col1.textContent = `Generated: ${dateStr} at ${timeStr}`;
  const col2 = document.createElement("span");
  col2.textContent = `Market: ${countryRule.name} (${countryRule.currency})`;
  const col3 = document.createElement("span");
  col3.textContent = `Total Catalog SKUs: ${summary.totalCount}`;
  const col4 = document.createElement("span");
  col4.textContent = `Offsite Ads Setting: ${state.settings.offsiteRate > 0 ? (state.settings.offsiteRate * 100).toFixed(0) + "%" : "0% (Direct/Organic)"}`;

  metaRow.append(col1, col2, col3, col4);
  headerEl.append(brandEl, metaRow);
  content.appendChild(headerEl);

  // 2. Executive KPI Cards
  const kpiSection = document.createElement("div");
  kpiSection.className = "exec-kpi-grid";

  const cards = [
    { label: "Total SKUs", value: String(summary.totalCount), sub: "Analyzed catalog items" },
    { label: "Projected Gross Revenue", value: formatCurrency(summary.totalRevenue), sub: "Combined list price + shipping" },
    { label: "Estimated Net Profit", value: formatCurrency(summary.totalProfit), sub: summary.totalProfit >= 0 ? "Net seller proceeds" : "Net negative loss" },
    { label: "Average Profit Margin", value: formatPct(summary.averageMarginPct), sub: "Portfolio-wide margin" },
    { label: "Average ROI", value: formatPct(summary.averageRoiPct), sub: "Return on out-of-pocket costs" },
    { label: "Top Margin Winners", value: String(summary.winnerCount), sub: "SKUs with healthy margin & ROI" }
  ];

  for (const c of cards) {
    const card = document.createElement("div");
    card.className = "exec-kpi-card";
    const lbl = document.createElement("div");
    lbl.className = "exec-kpi-label";
    lbl.textContent = c.label;
    const val = document.createElement("div");
    val.className = "exec-kpi-value";
    val.textContent = c.value;
    const sub = document.createElement("div");
    sub.className = "exec-kpi-sub";
    sub.textContent = c.sub;
    card.append(lbl, val, sub);
    kpiSection.appendChild(card);
  }
  content.appendChild(kpiSection);

  // 3. Top Winners Table (Top 5 SKUs by Net Profit)
  const winnersTitle = document.createElement("h3");
  winnersTitle.className = "exec-section-title";
  winnersTitle.textContent = "Top Sourcing Winners (Highest Projected Return)";
  content.appendChild(winnersTitle);

  const sortedByProfit = [...dataset].sort((a, b) => b.netProfit - a.netProfit);
  const topWinners = sortedByProfit.slice(0, 5);

  const table = document.createElement("table");
  table.className = "exec-data-table";

  const thead = document.createElement("thead");
  const trH = document.createElement("tr");
  ["#", "Product & SKU", "Category", "Retail Price", "Unit COGS", "Total Costs", "Etsy Fees", "Net Profit", "Margin %", "ROI %", "Break-Even"].forEach((txt) => {
    const th = document.createElement("th");
    th.textContent = txt;
    trH.appendChild(th);
  });
  thead.appendChild(trH);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  topWinners.forEach((item, idx) => {
    const tr = document.createElement("tr");
    const cells = [
      String(idx + 1),
      item.productName,
      item.category || "General",
      formatCurrency(item.itemPrice, item.countryCode),
      formatCurrency(item.productionCost, item.countryCode),
      formatCurrency(item.totalSellerCosts, item.countryCode),
      formatCurrency(item.totalEtsyFees, item.countryCode),
      formatCurrency(item.netProfit, item.countryCode),
      formatPct(item.marginPct),
      formatPct(item.roi),
      formatCurrency(item.breakEvenPrice, item.countryCode)
    ];
    cells.forEach((cTxt, cIdx) => {
      const td = document.createElement("td");
      td.textContent = cTxt;
      if (cIdx >= 3 && cIdx !== 7) td.style.textAlign = "right";
      if (cIdx === 7) {
        td.style.textAlign = "right";
        td.style.fontWeight = "700";
        td.style.color = item.netProfit >= 0 ? "#16a34a" : "#dc2626";
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  content.appendChild(table);

  // 4. Advertising Sensitivity & Vulnerability Analysis
  const adsSection = document.createElement("div");
  adsSection.className = "exec-ads-section";

  const adsTitle = document.createElement("h4");
  adsTitle.textContent = "15% Offsite Ads Vulnerability Assessment";
  adsSection.appendChild(adsTitle);

  const vulnerableCount = dataset.filter((d) => d.becomesUnprofitableAt15Pct).length;
  const adsP = document.createElement("p");
  adsP.textContent = `${vulnerableCount} out of ${dataset.length} products in this catalog become unprofitable (negative net take-home) if sold via an Etsy Offsite Ad (15% platform attribution). Sellers should maintain buffer margins above 25% or adjust retail listing prices upward to offset ad deductions.`;
  adsSection.appendChild(adsP);
  content.appendChild(adsSection);

  // 5. Verification Notice
  const notice = document.createElement("div");
  notice.className = "exec-report-notice";
  notice.textContent = "ShopProfit Audit Standards: 100% Client-side deterministic calculation based on official 2026 Etsy Seller Policy & Payments Fee Schedules. Listing fees, transaction deductions, domestic and international processing, and statutory regulatory operating fees are modeled to exact currency precision.";
  content.appendChild(notice);

  modal.classList.add("modal--open");
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
      { label: "= Net Take-Home Profit", amount: item.netProfit, type: "total" }
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

  const exportXlsxBtn = document.getElementById("export-xlsx-btn");
  if (exportXlsxBtn) {
    exportXlsxBtn.addEventListener("click", handleExportXlsx);
  }

  const exportPdfBtn = document.getElementById("export-pdf-btn");
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", openExecutiveReportModal);
  }

  // Print Executive Report Buttons
  document.getElementById("btn-print-executive-report")?.addEventListener("click", () => {
    window.print();
  });
  document.getElementById("btn-print-executive-report-footer")?.addEventListener("click", () => {
    window.print();
  });

  // Supplier Catalog Preset Dropdown
  const supplierSelect = document.getElementById("supplier-preset-select");
  if (supplierSelect) {
    supplierSelect.addEventListener("change", (e) => {
      handleLoadSupplierPreset(e.target.value);
    });
  }

  // One-Click Supplier Preset Buttons in Upload Modal
  document.querySelectorAll(".btn-supplier-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const supplier = btn.getAttribute("data-supplier");
      if (supplier) handleLoadSupplierPreset(supplier);
    });
  });

  // Downloadable Blank CSV Templates
  document.querySelectorAll(".link-download-template").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const template = btn.getAttribute("data-template");
      if (template) handleDownloadTemplate(template);
    });
  });

  // Mobile menu toggle
  const menuToggle = document.getElementById("menu-toggle");
  const mobileMenu = document.getElementById("mobile-menu");
  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener("click", () => {
      const isHidden = mobileMenu.hidden;
      mobileMenu.hidden = !isHidden;
      menuToggle.setAttribute("aria-expanded", String(isHidden));
    });
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

  // Setup View Mode Switcher (Split, Grid, Charts)
  setupViewModeHandlers();

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
