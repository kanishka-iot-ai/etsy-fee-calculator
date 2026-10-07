import {
  LANGUAGES,
  detectPreferredLanguage,
  getLanguageDirection,
  isLanguageSupported
} from "./translations.js";
import {
  FeeIntelligenceClient,
  EXPECTED_VERSION_ID,
  getCachedFees,
  setCachedFees,
  clearCachedFees
} from "./fee-intelligence-client.js";
import { normalizeFeeSchedule } from "./compatibility.js";
import {
  calculateOrderFees,
  solveRequiredPrice,
  resolveCountryFeeRule,
  countryFromTimeZone,
  formatMoney,
  asCents,
  OFFICIAL_TRANSACTION_RATE as TRANSACTION_RATE
} from "./fee-engine.js";

const DEFAULT_BASELINE_ORDER = Object.freeze([
  "US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP", "TR", "OTHER"
]);

const $ = (selector, root = (typeof document !== "undefined" ? document : null)) => root?.querySelector?.(selector) ?? null;
const $$ = (selector, root = (typeof document !== "undefined" ? document : null)) => (root?.querySelectorAll ? [...root.querySelectorAll(selector)] : []);
const getCountryRoute = () => {
  if (typeof location === "undefined") return null;
  const path = location.pathname.toLowerCase();
  if (path.includes("etsy-fee-calculator-uk")) return "UK";
  if (path.includes("etsy-fee-calculator-canada")) return "CA";
  if (path.includes("etsy-fee-calculator-australia")) return "AU";
  if (path.includes("etsy-digital-download-fee-calculator")) return "OTHER";
  // Fallback: read data-route-country injected by the build into each regional page's <body>
  const bodyAttr = typeof document !== "undefined" ? document.body?.dataset?.routeCountry : null;
  if (bodyAttr && ["UK", "CA", "AU", "OTHER"].includes(bodyAttr)) return bodyAttr;
  return null;
};

const routeCountry = getCountryRoute();
const store = {
  get(key) { try { return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null; } catch { return null; } },
  set(key, value) { try { if (typeof localStorage !== "undefined") localStorage.setItem(key, value); } catch { /* Private browsing can disable storage. */ } },
  remove(key) { try { if (typeof localStorage !== "undefined") localStorage.removeItem(key); } catch {} }
};
const countrySelects = typeof document !== "undefined" ? [$("#country"), $("#country-nav")].filter(Boolean) : [];

// Authoritative global fee schedules populated from v1.1.1 API / local client cache
const activeFeeSchedules = new Map();
let activeCountryOrder = [...DEFAULT_BASELINE_ORDER];
let isFeeDataLoaded = false;
let feeDataError = null;
const feeClient = new FeeIntelligenceClient();

let activeCountryCode = routeCountry || store.get("shopprofit-country") || (typeof Intl !== "undefined" && Intl.DateTimeFormat ? countryFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) : "US");
if (!resolveCountryFeeRule(activeCountryCode) && activeCountryCode !== "OTHER") activeCountryCode = "US";
const languageSelect = typeof document !== "undefined" ? $("#language-nav") : null;
let languagePreference = store.get("shopprofit.language") || store.get("shopprofit-language") || "auto";
if (languagePreference !== "auto" && !isLanguageSupported(languagePreference)) languagePreference = "auto";
let activeLanguage = detectPreferredLanguage({
  savedLanguage: languagePreference === "auto" ? null : languagePreference,
  languages: typeof navigator !== "undefined" ? (navigator.languages || (navigator.language ? [navigator.language] : [])) : [],
});
let digitalMode = routeCountry === "OTHER";
let physicalSnapshot = null;
let toastTimer;
let outputAnimationFrame = 0;
let lastCalculation;
const translatedTextNodes = new WeakMap();
const translatedAttributes = new WeakMap();

function translate(value) { return LANGUAGES[activeLanguage]?.strings[value] || value; }
function fitHeroHeading() {
  const hero = $("#hero-title");
  if (!hero || hero.classList.contains("route-h1")) return;
  const parent = hero.parentElement;
  if (!parent) return;
  const available = parent.clientWidth;
  if (!available) return;
  const style = getComputedStyle(hero);
  const baseSize = Number.parseFloat(style.fontSize);
  if (!baseSize) return;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = `${style.fontWeight} ${baseSize}px ${style.fontFamily}`;
  const text = hero.textContent.replace(/\s+/g, " ").trim();
  const textWidth = context.measureText(text).width + baseSize * 0.3;
  if (textWidth > available && available > 0) {
    hero.style.fontSize = `${Math.max(14, Math.floor((baseSize * (available - 8)) / textWidth))}px`;
  } else if (hero.style.fontSize) {
    hero.style.removeProperty("font-size");
  }
}
function translatePage() {
  document.documentElement.lang = LANGUAGES[activeLanguage]?.locale || "en";
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim() || node.parentElement.closest("script, style, #language-nav")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node;
  while ((node = walker.nextNode())) {
    const current = node.nodeValue;
    const previous = translatedTextNodes.get(node);
    const source = previous && previous.output === current ? previous.source : current.trim();
    const translation = translate(source);
    const leading = current.match(/^\s*/)?.[0] || "";
    const trailing = current.match(/\s*$/)?.[0] || "";
    node.nodeValue = `${leading}${translation}${trailing}`;
    translatedTextNodes.set(node, { source, output: node.nodeValue });
  }
  const attributes = ["aria-label", "title", "placeholder"];
  document.querySelectorAll("[aria-label], [title], [placeholder]").forEach((element) => {
    let state = translatedAttributes.get(element);
    if (!state) { state = new Map(); translatedAttributes.set(element, state); }
    attributes.forEach((name) => {
      if (!element.hasAttribute(name)) return;
      const current = element.getAttribute(name), previous = state.get(name);
      const source = previous && previous.output === current ? previous.source : current;
      const output = translate(source);
      element.setAttribute(name, output);
      state.set(name, { source, output });
    });
  });
  languageSelect.value = languagePreference;
}
function applyLanguage() {
  const language = LANGUAGES[activeLanguage] || LANGUAGES.en;
  document.documentElement.lang = language.locale || "en";
  document.documentElement.dir = getLanguageDirection(activeLanguage);
  const hero = $("#hero-title");
  const [firstLine, secondLine] = language.heroLines || LANGUAGES.en.heroLines;
  if (hero) {
    const allWords = [
      ...(firstLine ? firstLine.split(/\s+/).filter(Boolean) : []),
      ...(secondLine ? secondLine.split(/\s+/).filter(Boolean) : []),
    ];
    hero.replaceChildren();
    allWords.forEach((word, index) => {
      const part = document.createElement("span");
      part.className = `hero-word${index === allWords.length - 1 ? " hero-keep" : ""}`;
      part.textContent = word;
      hero.append(part);
      if (index < allWords.length - 1) hero.append(" ");
    });
  }
  fitHeroHeading();
  const analysisButton = $("#show-analysis");
  if (analysisButton) analysisButton.textContent = translate($(".scenarios-panel")?.open ? "Hide Detailed Analysis" : "Show Detailed Analysis");
  const titles = {
    en: "Etsy Profit Calculator — Fees, Costs & Net Profit | ShopProfit",
    "zh-CN": "免费 Etsy 利润计算器 — ShopProfit",
    "hi-IN": "मुफ़्त Etsy लाभ कैलकुलेटर — ShopProfit",
    "fr-FR": "Calculateur de bénéfice Etsy gratuit — ShopProfit",
    "de-DE": "Kostenloser Etsy-Gewinnrechner — ShopProfit",
    "es-ES": "Calculadora gratuita de beneficios de Etsy — ShopProfit",
    "ja-JP": "無料 Etsy 利益計算機 — ShopProfit",
    ar: "حاسبة أرباح Etsy — الرسوم والتكاليف وصافي الربح | ShopProfit"
  };
  const routeTitles = {
    UK: { en: "Etsy Fee Calculator UK — ShopProfit", "zh-CN": "英国 Etsy 费用计算器 — ShopProfit", "hi-IN": "Etsy शुल्क कैलकुलेटर यूके — ShopProfit", "fr-FR": "Calculateur de frais Etsy Royaume-Uni — ShopProfit", "de-DE": "Etsy-Gebührenrechner Großbritannien — ShopProfit", "es-ES": "Calculadora de tarifas Etsy Reino Unido — ShopProfit", ar: "حاسبة رسوم Etsy المملكة المتحدة — ShopProfit" },
    CA: { en: "Etsy Fee Calculator Canada — ShopProfit", "zh-CN": "加拿大 Etsy 费用计算器 — ShopProfit", "hi-IN": "Etsy शुल्क कैलकुलेटर कनाडा — ShopProfit", "fr-FR": "Calculateur de frais Etsy Canada — ShopProfit", "de-DE": "Etsy-Gebührenrechner Kanada — ShopProfit", "es-ES": "Calculadora de tarifas Etsy Canadá — ShopProfit", ar: "حاسبة رسوم Etsy كندا — ShopProfit" },
    AU: { en: "Etsy Fee Calculator Australia — ShopProfit", "zh-CN": "澳大利亚 Etsy 费用计算器 — ShopProfit", "hi-IN": "Etsy शुल्क कैलकुलेटर ऑस्ट्रेलिया — ShopProfit", "fr-FR": "Calculateur de frais Etsy Australie — ShopProfit", "de-DE": "Etsy-Gebührenrechner Australien — ShopProfit", "es-ES": "Calculadora de tarifas Etsy Australia — ShopProfit", ar: "حاسبة رسوم Etsy أستراليا — ShopProfit" },
    OTHER: { en: "Etsy Digital Download Fee Calculator — ShopProfit", "zh-CN": "Etsy 数字下载费用计算器 — ShopProfit", "hi-IN": "Etsy डिजिटल डाउनलोड शुल्क कैलकुलेटर — ShopProfit", "fr-FR": "Calculateur de frais Etsy pour produits numériques — ShopProfit", "de-DE": "Etsy-Gebührenrechner für digitale Produkte — ShopProfit", "es-ES": "Calculadora de tarifas Etsy para descargas digitales — ShopProfit", ar: "حاسبة رسوم التنزيل الرقمي Etsy — ShopProfit" },
  };
  document.title = routeTitles[routeCountry]?.[activeLanguage] || routeTitles[routeCountry]?.en || titles[activeLanguage] || titles.en;
  const autoLabels = { en: "Auto", "zh-CN": "自动", "hi-IN": "स्वचालित", "fr-FR": "Auto", "de-DE": "Automatisch", "es-ES": "Auto", "ja-JP": "自動", ar: "تلقائي" };
  const autoOption = languageSelect.querySelector('[value="auto"]');
  if (autoOption) {
    const baseAuto = autoLabels[activeLanguage] || autoLabels.en;
    const currentName = language.label || "English";
    autoOption.textContent = languagePreference === "auto" ? `${baseAuto} (${currentName})` : baseAuto;
  }
  translatePage();
}
function getStatusBanner() {
  let banner = $("#fee-status-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "fee-status-banner";
    banner.className = "fee-status-banner";
    const calculatorSection = $("#calculator");
    if (calculatorSection) {
      calculatorSection.prepend(banner);
    }
  }
  return banner;
}

function setControlsEnabled(enabled) {
  const form = $("#sale-form");
  if (form) {
    form.setAttribute("aria-busy", String(!enabled));
    form.querySelectorAll("input, button:not(#retry-fees-btn), select").forEach((el) => {
      el.disabled = !enabled;
    });
  }
  const adv = $("#advanced-options");
  if (adv) {
    adv.querySelectorAll("input, button").forEach((el) => {
      el.disabled = !enabled;
    });
  }
}

function setOutputsLoading(loading) {
  if (!loading) return;
  const selectors = [
    "#net-profit", "#mobile-profit", "#net-profit-ledger", "#profit-margin",
    "#gross-revenue", "#listing-fee", "#transaction-fee", "#processing-fee",
    "#regulatory-fee", "#offsite-fee", "#total-deductions", "#total-fees",
    "#total-costs", "#break-even-price", "#summary-break-even",
    "#required-price", "#summary-required-price", "#insight-break-even",
    "#insight-target", "#platform-rate", "#cost-rate"
  ];
  selectors.forEach((sel) => {
    const el = $(sel);
    if (el) el.textContent = "—";
  });
}

function showLoadingState() {
  const banner = getStatusBanner();
  if (banner) {
    banner.hidden = false;
    banner.className = "fee-status-banner is-loading";
    banner.innerHTML = `<span class="fee-spinner" aria-hidden="true"></span> <span>${translate("Loading verified Etsy fee data...")}</span>`;
  }
  setControlsEnabled(false);
  setOutputsLoading(true);
}

function hideStatusBanner() {
  const banner = getStatusBanner();
  if (banner) banner.hidden = true;
}

function showErrorState(message) {
  const banner = getStatusBanner();
  if (banner) {
    banner.hidden = false;
    banner.className = "fee-status-banner is-error";
    banner.setAttribute("role", "alert");
    banner.innerHTML = `<span>${translate(message || "Fee data is temporarily unavailable. Please try again.")}</span> <button type="button" class="button button-quiet" id="retry-fees-btn">${translate("Retry")}</button>`;
    $("#retry-fees-btn")?.addEventListener("click", () => loadFeeData());
  }
  setControlsEnabled(false);
  setOutputsLoading(true);
}

function getActiveCountry() {
  const norm = activeFeeSchedules.get(activeCountryCode);
  if (norm && norm.country) return norm.country;
  return resolveCountryFeeRule(activeCountryCode) || { currency: "USD", symbol: "$", locale: "en-US", name: "United States" };
}

function formatCents(value) {
  return formatMoney(value, getActiveCountry());
}

function fillCountryOptions() {
  const order = activeCountryOrder.length > 0 ? activeCountryOrder : DEFAULT_BASELINE_ORDER;
  const options = order.map((code) => {
    const norm = activeFeeSchedules.get(code);
    const c = norm ? norm.country : resolveCountryFeeRule(code);
    const name = c ? c.name : code;
    return `<option value="${code}">${name}</option>`;
  }).join("");
  countrySelects.forEach((select) => {
    if (select) {
      select.innerHTML = options;
      select.value = activeCountryCode;
    }
  });
}

function getNumber(id) {
  const input = $(id);
  const raw = input.value.trim();
  const value = raw === "" ? 0 : Number(raw);
  const invalid = !Number.isFinite(value) || value < 0 || value > 99_999_999;
  input.setAttribute("aria-invalid", String(invalid));
  const field = input.closest(".field");
  field?.classList.toggle("has-error", invalid);
  if (invalid) input.setCustomValidity(translate("Enter an amount between 0 and 99,999,999."));
  else input.setCustomValidity("");
  let error = field?.querySelector(".field-error-text");
  if (invalid && field) {
    if (!error) {
      error = document.createElement("small"); error.className = "field-error-text"; error.id = `${input.id}-error`; field.append(error);
    }
    error.textContent = "Enter an amount between 0 and 99,999,999.";
    input.setAttribute("aria-describedby", error.id);
  } else if (error) {
    error.remove(); input.removeAttribute("aria-describedby");
  }
  return invalid ? Math.min(99_999_999, Math.max(0, Number.isFinite(value) ? value : 0)) : value;
}

function getState() {
  const norm = activeFeeSchedules.get(activeCountryCode);
  return {
    itemPrice: getNumber("#item-price"),
    shipping: getNumber("#shipping"),
    production: getNumber("#production"),
    packaging: getNumber("#packaging"),
    country: norm || resolveCountryFeeRule(activeCountryCode),
    offsiteRate: Number($("input[name=offsite]:checked")?.value || 0),
    plus: $("#etsy-plus").checked,
    salesPerMonth: Math.max(1, Math.min(10_000, Number($("#sales-per-month").value) || 30)),
  };
}

function setOutput(selector, value) {
  const output = $(selector);
  const changed = output.textContent !== value;
  output.textContent = value;
  if (selector === "#net-profit" && changed && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cancelAnimationFrame(outputAnimationFrame);
    output.classList.remove("pixel-refresh");
    outputAnimationFrame = requestAnimationFrame(() => {
      output.classList.add("pixel-refresh");
      outputAnimationFrame = 0;
    });
  } else if (selector === "#net-profit" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
    output.classList.remove("pixel-refresh");
  }
}

function render() {
  if (!isFeeDataLoaded) {
    return;
  }
  const state = getState();
  const schedule = activeFeeSchedules.get(activeCountryCode) || resolveCountryFeeRule(activeCountryCode);
  const activeCurrency = schedule.country ? schedule.country.currency : (schedule.currency || "USD");
  const orderType = (routeCountry === "CA" || routeCountry === "AU") ? "domestic" : "domestic";

  // Pure fee engine calculation
  const orderFees = calculateOrderFees({
    country: schedule,
    itemPrice: state.itemPrice,
    shipping: state.shipping,
    production: state.production,
    packaging: state.packaging,
    offsiteAds: state.offsiteRate > 0,
    shopOffsiteAdsTier: state.offsiteRate,
    plusEnabled: state.plus,
    salesPerMonth: state.salesPerMonth,
    orderType,
    listingCurrency: activeCurrency,
    paymentAccountCurrency: activeCurrency
  });

  const data = orderFees.legacy;
  const targetProfit = getNumber("#target-profit");
  const required = solveRequiredPrice(targetProfit, {
    country: schedule,
    shipping: state.shipping,
    production: state.production,
    packaging: state.packaging,
    offsiteAds: state.offsiteRate > 0,
    shopOffsiteAdsTier: state.offsiteRate,
    plusEnabled: state.plus,
    salesPerMonth: state.salesPerMonth,
    orderType,
    listingCurrency: activeCurrency,
    paymentAccountCurrency: activeCurrency
  });

  lastCalculation = { state, data, targetProfit, required, orderFees };

  const countryData = getActiveCountry();
  $("#currency-display").innerHTML = `${countryData.currency} <span>·</span> ${countryData.symbol}`;
  $$(".currency-prefix").forEach((el) => { el.textContent = countryData.symbol; });
  $$(".input-suffix").forEach((el) => { el.textContent = countryData.currency; });

  setOutput("#net-profit", formatCents(data.netCents));
  setOutput("#mobile-profit", formatCents(data.netCents));
  setOutput("#net-profit-ledger", formatCents(data.netCents));
  setOutput("#profit-margin", `${(data.margin * 100).toFixed(2)}%`);
  setOutput("#out-item", formatCents(asCents(state.itemPrice)));
  setOutput("#out-shipping", formatCents(asCents(state.shipping)));
  setOutput("#gross-revenue", formatCents(data.grossCents));
  setOutput("#listing-fee", `−${formatCents(data.listingCents)}`);
  setOutput("#transaction-fee", `−${formatCents(data.transactionCents)}`);
  setOutput("#processing-fee", `−${formatCents(data.processingCents)}`);
  setOutput("#regulatory-fee", `−${formatCents(data.regulatoryCents)}`);
  setOutput("#offsite-fee", `−${formatCents(data.offsiteCents)}`);
  setOutput("#production-cost", `−${formatCents(asCents(state.production))}`);
  setOutput("#packaging-cost", `−${formatCents(asCents(state.packaging))}`);
  setOutput("#total-deductions", `−${formatCents(data.feesCents + data.costsCents)}`);
  setOutput("#total-fees", formatCents(data.feesCents));
  setOutput("#total-costs", formatCents(data.costsCents));
  setOutput("#break-even-price", formatCents(data.breakEvenCents));
  setOutput("#summary-break-even", formatCents(data.breakEvenCents));
  setOutput("#goal-display", formatCents(asCents(targetProfit)));
  setOutput("#required-price", formatCents(required));
  setOutput("#summary-required-price", formatCents(required));
  setOutput("#insight-break-even", formatCents(data.breakEvenCents));
  setOutput("#insight-target", formatCents(required));
  const insight = (LANGUAGES[activeLanguage]?.insightLead || LANGUAGES.en.insightLead)
    .replace("{kept}", formatCents(data.keptPer100Cents)).replace("{gross}", formatCents(10_000));
  setOutput("#insight-lead", insight);
  setOutput("#platform-rate", `${(data.platformRate * 100).toFixed(1)}%`);
  setOutput("#cost-rate", `${(data.costsRate * 100).toFixed(1)}%`);

  const status = $("#profit-status");
  const negative = data.netCents < 0;
  $(".result-panel").classList.toggle("is-negative", negative);
  status.textContent = negative ? "Loss on this sale" : "Profitable sale";
  $(".net-number").setAttribute("aria-label", `${negative ? "Loss" : "Net profit"}: ${formatCents(Math.abs(data.netCents))}`);
  $("#flow-fees").style.width = `${Math.max(0, Math.min(100, data.grossCents ? data.feesCents / data.grossCents * 100 : 0))}%`;
  $("#flow-costs").style.width = `${Math.max(0, Math.min(100, data.grossCents ? data.costsCents / data.grossCents * 100 : 0))}%`;
  $("#flow-profit").style.width = `${Math.max(0, Math.min(100, data.grossCents ? Math.max(0, data.netCents) / data.grossCents * 100 : 0))}%`;
  setOutput("#flow-fees-label", `${(data.grossCents ? data.feesCents / data.grossCents * 100 : 0).toFixed(1)}%`);
  setOutput("#flow-costs-label", `${(data.grossCents ? data.costsCents / data.grossCents * 100 : 0).toFixed(1)}%`);
  setOutput("#flow-profit-label", `${(data.margin * 100).toFixed(1)}%`);
  $("#plus-fee-row").hidden = !state.plus;
  $("#sales-count-wrap").hidden = !state.plus;
  setOutput("#plus-fee", `−${formatCents(data.plusCents)}`);

  renderScenarios(state);
  translatePage();
}

function renderScenarios(state) {
  const entries = [
    { name: "Current sale", rate: state.offsiteRate, current: true },
    { name: "No Offsite Ads", rate: 0 },
    { name: "15% Offsite Ads", rate: 0.15 },
    { name: "12% Offsite Ads", rate: 0.12 },
  ];
  const schedule = activeFeeSchedules.get(activeCountryCode) || resolveCountryFeeRule(activeCountryCode);
  const activeCurrency = schedule.country ? schedule.country.currency : (schedule.currency || "USD");

  $("#scenario-body").innerHTML = entries.map((entry) => {
    const calc = calculateOrderFees({
      country: schedule,
      itemPrice: state.itemPrice,
      shipping: state.shipping,
      production: state.production,
      packaging: state.packaging,
      offsiteAds: entry.rate > 0,
      shopOffsiteAdsTier: entry.rate,
      plusEnabled: state.plus,
      salesPerMonth: state.salesPerMonth,
      listingCurrency: activeCurrency,
      paymentAccountCurrency: activeCurrency
    });
    const result = calc.legacy;
    const costs = result.costsCents;
    const price = formatCents(asCents(state.itemPrice));
    return `<tr class="${entry.current ? "current-row" : ""}"><td>${entry.name}</td><td>${price}</td><td>${formatCents(result.feesCents)}</td><td>${formatCents(costs)}</td><td>${formatCents(result.netCents)}</td><td>${(result.margin * 100).toFixed(1)}%</td></tr>`;
  }).join("");
}

function renderFeeTable() {
  const tableBody = $("#fee-table-body");
  if (!tableBody) return;
  const list = activeCountryOrder.length > 0 ? activeCountryOrder : DEFAULT_BASELINE_ORDER;
  tableBody.innerHTML = list.map((code) => {
    const norm = activeFeeSchedules.get(code);
    const fallbackRule = resolveCountryFeeRule(code);
    const c = norm ? {
      name: norm.country.name,
      currency: norm.country.currency,
      symbol: norm.country.symbol,
      locale: norm.country.locale,
      listingFee: norm.fees.listing.amount,
      processingRate: norm.fees.processing.rate,
      processingFixed: norm.fees.processing.fixedAmount,
      regulatoryRate: norm.fees.regulatory.rate,
      processingNote: norm.metadata?.specialRules
    } : {
      name: fallbackRule.name,
      currency: fallbackRule.currency,
      symbol: fallbackRule.symbol,
      locale: fallbackRule.locale,
      listingFee: fallbackRule.listingFee,
      processingRate: fallbackRule.rate,
      processingFixed: fallbackRule.fixed,
      regulatoryRate: fallbackRule.regulatoryRate || 0,
      processingNote: fallbackRule.domesticRate != null ? "Domestic order rate; international orders differ." : (code === "TR" ? "Türkiye rate per published schedule." : "")
    };
    if (!c) return "";
    const regulatory = c.regulatoryRate ? `${(c.regulatoryRate * 100).toFixed(2)}%` : "—";
    const processingRate = c.processingRate * 100;
    const rateDigits = Number.isInteger(processingRate) ? 0 : 1;
    const note = c.processingNote || "Default processing estimate; international order rates may differ.";
    return `<tr class="${code === activeCountryCode ? "is-selected" : ""}"><th scope="row">${c.name}${code === activeCountryCode ? ' <span class="selected-country">Selected</span>' : ""}</th><td>${c.currency}</td><td>${formatMoney(Math.round(c.listingFee * 100), c)}</td><td>${(TRANSACTION_RATE * 100).toFixed(1)}%</td><td>${processingRate.toFixed(rateDigits)}% + ${formatMoney(Math.round(c.processingFixed * 100), c)}</td><td>${regulatory}</td><td>${note}</td></tr>`;
  }).join("");
}

function syncCountry(code, persist = true) {
  const norm = activeFeeSchedules.get(code);
  if (!norm && !resolveCountryFeeRule(code)) return;
  activeCountryCode = code;
  countrySelects.forEach((select) => { if (select) select.value = code; });
  if (persist && !routeCountry) store.set("shopprofit-country", code);
  renderFeeTable();
  render();
}
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = translate(message); toast.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}
function makeBreakdown() {
  const { state, data } = lastCalculation;
  const line = (label, value) => `${translate(label)}: ${value}`;
  return [
    translate("ShopProfit — Etsy Profit Breakdown"), "",
    line("Item price", formatCents(asCents(state.itemPrice))),
    line("Shipping", formatCents(asCents(state.shipping))),
    line("Gross revenue", formatCents(data.grossCents)), "",
    line("Listing fee", formatCents(data.listingCents)),
    line("Transaction fee", formatCents(data.transactionCents)),
    line("Payment processing", formatCents(data.processingCents)),
    line("Regulatory fee", formatCents(data.regulatoryCents)),
    line("Offsite Ads", formatCents(data.offsiteCents)),
    ...(state.plus ? [line("Etsy Plus allocation", formatCents(data.plusCents))] : []), "",
    line("Production cost", formatCents(asCents(state.production))),
    line("Packaging & shipping", formatCents(asCents(state.packaging))), "",
    line("Total deductions", formatCents(data.feesCents + data.costsCents)),
    line("Total platform fees", formatCents(data.feesCents)),
    line("Total business costs", formatCents(data.costsCents)),
    line("Net profit", formatCents(data.netCents)),
    line("Profit margin", `${(data.margin * 100).toFixed(2)}%`),
    line("Break-even price", formatCents(data.breakEvenCents)),
    line("Country", state.country.name),
    line("Currency", state.country.currency),
    "", translate("Rates are estimates. Check Etsy's current seller fee schedule for your account."),
  ].join("\n");
}
async function copyBreakdown(button) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(makeBreakdown());
  } catch {
    const area = document.createElement("textarea");
    area.value = makeBreakdown(); area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
    document.body.append(area); area.select();
    const ok = document.execCommand("copy"); area.remove();
    if (!ok) { showToast("Clipboard access is unavailable."); return; }
  }
  button.textContent = "Copied ✓"; showToast("Breakdown copied");
  setTimeout(() => { button.textContent = original; }, 1700);
}
function makeReportPdf() {
  const { state, data, targetProfit, required } = lastCalculation;
  const reportRows = [
    `COUNTRY: ${state.country.name} (${state.country.currency})`,
    `ITEM PRICE: ${formatCents(asCents(state.itemPrice))}`,
    `SHIPPING CHARGED: ${formatCents(asCents(state.shipping))}`,
    `GROSS REVENUE: ${formatCents(data.grossCents)}`,
    "",
    "ETSY FEES",
    `Listing fee: ${formatCents(data.listingCents)}`,
    `Transaction fee: ${formatCents(data.transactionCents)}`,
    `Payment processing: ${formatCents(data.processingCents)}`,
    `Regulatory fee: ${formatCents(data.regulatoryCents)}`,
    `Offsite Ads: ${formatCents(data.offsiteCents)}`,
    ...(state.plus ? [`Etsy Plus allocation: ${formatCents(data.plusCents)}`] : []),
    `TOTAL PLATFORM FEES: ${formatCents(data.feesCents)}`,
    "",
    "YOUR COSTS",
    `Production: ${formatCents(asCents(state.production))}`,
    `Packaging and shipping: ${formatCents(asCents(state.packaging))}`,
    `TOTAL BUSINESS COSTS: ${formatCents(data.costsCents)}`,
    `Total deductions: ${formatCents(data.feesCents + data.costsCents)}`,
    "",
    `NET PROFIT: ${formatCents(data.netCents)}`,
    `PROFIT MARGIN: ${(data.margin * 100).toFixed(2)}%`,
    `BREAK-EVEN ITEM PRICE: ${formatCents(data.breakEvenCents)}`,
    `TARGET PROFIT: ${formatCents(asCents(targetProfit))}`,
    `PRICE FOR TARGET: ${formatCents(required)}`,
    "",
    "Calculated locally by ShopProfit. Estimates only; verify current Etsy fees.",
  ];
  const safe = (value) => String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[−–—]/g, "-").replace(/[^\x20-\x7e]/g, "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const commands = ["q", "0.78 1 0 rg", "40 778 515 28 re f", "Q"];
  const put = (x, y, size, text, color = "0 0 0 rg") => commands.push(color, "BT", `/F1 ${size} Tf`, `1 0 0 1 ${x} ${y} Tm`, `(${safe(text)}) Tj`, "ET");
  put(52, 787, 13, "SHOPPROFIT / ETSY PROFIT REPORT");
  put(40, 754, 9, `GENERATED ${new Date().toLocaleDateString(LANGUAGES[activeLanguage]?.locale || "en-US")}`, "0.35 0.35 0.35 rg");
  let y = 726;
  for (const row of reportRows) {
    if (row === "") { y -= 11; continue; }
    const heading = row === "ETSY FEES" || row === "YOUR COSTS" || row.startsWith("NET PROFIT:");
    if (heading) {
      commands.push("q", "0.90 0.90 0.86 rg", `40 ${y - 5} 515 20 re f`, "Q");
      put(50, y, 9, row, "0 0 0 rg");
    } else put(50, y, 9, row, "0.12 0.12 0.12 rg");
    y -= 22;
  }
  put(40, 52, 8, "SHOPPROFITCALCULATOR.COM  |  CALCULATIONS STAY IN YOUR BROWSER; SHARING SENDS DATA ONLY WHEN YOU CHOOSE IT", "0.38 0.38 0.38 rg");
  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n%ShopProfit\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}
function downloadReport() {
  const blob = new Blob([makeReportPdf()], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `shopprofit-report-${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Profit report downloaded");
}
function shareByEmail() {
  const subject = `ShopProfit Etsy report — ${lastCalculation.state.country.name}`;
  location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(makeBreakdown())}`;
}
function shareByWhatsApp() {
  const text = makeBreakdown();
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}
function toggleDetailedAnalysis() {
  const advanced = $("#advanced-options");
  const panel = $(".scenarios-panel");
  if (!advanced.open) {
    advanced.open = true;
    panel.open = true;
  } else if (!panel.open) panel.open = true;
  else { panel.open = false; advanced.open = false; }
  if (advanced.open) advanced.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
}
function setItemPriceFromCents(value, input) {
  input.value = (value / 100).toFixed(2);
  input.classList.remove("highlight-input");
  requestAnimationFrame(() => input.classList.add("highlight-input"));
  render(); input.focus({ preventScroll: true });
}
function applyRouteContent() {
  if (!routeCountry) return;
  const cName = (resolveCountryFeeRule(routeCountry) || {}).name || routeCountry;
  $(".answer-panel h2").textContent = routeCountry === "OTHER"
    ? "How do Etsy fees affect a digital download?"
    : `How much does Etsy take from a sale in ${cName}?`;
  // The build generates route-specific metadata and structured data in the HTML.
  // Keep those crawlable values intact after hydration instead of replacing them
  // with generic client-side metadata.
  if (routeCountry === "OTHER") {
    physicalSnapshot = { itemPrice: "35", shipping: "5", production: "7", packaging: "4" };
    $("#shipping").value = "0"; $("#production").value = "0"; $("#packaging").value = "0";
    $("#digital-preset").setAttribute("aria-pressed", "true");
    $("#digital-mode-note").hidden = false;
    $("#calculator-heading").textContent = "Digital product calculator";
  }
}
function setTheme(theme) {
  const dark = theme === "dark";
  document.body.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  $("#theme-toggle").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  $("#theme-toggle").title = dark ? "Switch to light mode" : "Switch to dark mode";
  $("meta[name=theme-color]").content = dark ? "#050505" : "#F2F1EC";
  translatePage();
}
function setupPointerEffects() {
  const desktop = matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
  if (!desktop.matches) return;
  $$(".spotlight").forEach((card) => {
    let frame = 0;
    let pointer = { x: 0, y: 0 };
    card.addEventListener("pointermove", (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        const bounds = card.getBoundingClientRect();
        card.style.setProperty("--mouse-x", `${pointer.x - bounds.left}px`);
        card.style.setProperty("--mouse-y", `${pointer.y - bounds.top}px`);
        frame = 0;
      });
    }, { passive: true });
  });
  $$(".button-primary").forEach((button) => {
    let frame = 0;
    let pointer = { x: 0, y: 0 };
    button.addEventListener("pointermove", (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        const rect = button.getBoundingClientRect();
        const dx = (pointer.x - rect.left - rect.width / 2) / rect.width;
        const dy = (pointer.y - rect.top - rect.height / 2) / rect.height;
        button.style.transform = `translate(${dx * 2}px, ${dy * 2}px)`;
        frame = 0;
      });
    }, { passive: true });
    button.addEventListener("pointerleave", () => { cancelAnimationFrame(frame); frame = 0; button.style.transform = ""; });
  });
}
function setupMenu() {
  const toggle = $("#menu-toggle"), menu = $("#mobile-menu");
  const close = () => { menu.hidden = true; toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-label", "Open menu"); translatePage(); };
  toggle.addEventListener("click", () => {
    const open = menu.hidden; menu.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    translatePage();
    if (open) $("a", menu).at(0)?.focus();
  });
  menu.addEventListener("click", (event) => { if (event.target.closest("a")) close(); });
  document.addEventListener("click", (event) => { if (!menu.hidden && !event.target.closest(".nav-wrap") && !menu.contains(event.target)) close(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) { close(); toggle.focus(); }
    if (!menu.hidden && event.key === "Tab") {
      const links = $$("a", menu), first = links[0], last = links.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  fillCountryOptions();
  applyRouteContent();
  applyLanguage();
  renderFeeTable();
  countrySelects.forEach((select) => select?.addEventListener("change", () => syncCountry(select.value)));
  languageSelect?.addEventListener("change", () => {
    languagePreference = languageSelect.value;
    store.set("shopprofit.language", languagePreference);
    store.set("shopprofit-language", languagePreference);
    activeLanguage = detectPreferredLanguage({
      savedLanguage: languagePreference === "auto" ? null : languagePreference,
      languages: typeof navigator !== "undefined" ? (navigator.languages || (navigator.language ? [navigator.language] : [])) : [],
    });
    applyLanguage();
    render();
  });

  window.addEventListener("languagechange", () => {
    if (languagePreference === "auto") {
      activeLanguage = detectPreferredLanguage({
        savedLanguage: null,
        languages: typeof navigator !== "undefined" ? (navigator.languages || (navigator.language ? [navigator.language] : [])) : [],
      });
      applyLanguage();
      render();
    }
  });

  $("#sale-form")?.addEventListener("submit", (event) => event.preventDefault());
  $("#sale-form")?.addEventListener("input", (event) => { if (event.target.matches("input")) render(); });
  $("#target-profit")?.addEventListener("input", render);
  $("#sales-per-month")?.addEventListener("input", render);
  $("#etsy-plus")?.addEventListener("change", render);
  $$('input[name="offsite"]').forEach((input) => input.addEventListener("change", render));
  $$('[data-price]').forEach((button) => button.addEventListener("click", () => {
    const ip = $("#item-price");
    if (ip) ip.value = button.dataset.price;
    render();
  }));
  $("#digital-preset")?.addEventListener("click", () => {
    if (!digitalMode) {
      physicalSnapshot = { itemPrice: $("#item-price")?.value, shipping: $("#shipping")?.value, production: $("#production")?.value, packaging: $("#packaging")?.value };
      digitalMode = true;
      if ($("#item-price")) $("#item-price").value = "25";
      if ($("#shipping")) $("#shipping").value = "0";
      if ($("#production")) $("#production").value = "0";
      if ($("#packaging")) $("#packaging").value = "0";
      $("#digital-preset")?.setAttribute("aria-pressed", "true");
      if ($("#digital-mode-note")) $("#digital-mode-note").hidden = false;
      render(); showToast("Digital product preset applied");
    } else {
      const restored = physicalSnapshot || { itemPrice: "35", shipping: "5", production: "7", packaging: "4" };
      if ($("#item-price")) $("#item-price").value = restored.itemPrice;
      if ($("#shipping")) $("#shipping").value = restored.shipping;
      if ($("#production")) $("#production").value = restored.production;
      if ($("#packaging")) $("#packaging").value = restored.packaging;
      digitalMode = false; physicalSnapshot = null;
      $("#digital-preset")?.setAttribute("aria-pressed", "false");
      if ($("#digital-mode-note")) $("#digital-mode-note").hidden = true;
      render(); showToast("Physical product settings restored");
    }
  });
  $("#use-break-even")?.addEventListener("click", () => {
    const ip = $("#item-price");
    if (ip && lastCalculation) setItemPriceFromCents(lastCalculation.data.breakEvenCents, ip);
  });
  $("#use-target")?.addEventListener("click", () => {
    const ip = $("#item-price");
    if (ip && lastCalculation) setItemPriceFromCents(lastCalculation.required, ip);
  });
  $("#copy-breakdown")?.addEventListener("click", (event) => copyBreakdown(event.currentTarget));
  $("#mobile-copy")?.addEventListener("click", (event) => copyBreakdown(event.currentTarget));
  $("#download-report")?.addEventListener("click", downloadReport);
  $("#share-email")?.addEventListener("click", shareByEmail);
  $("#share-whatsapp")?.addEventListener("click", shareByWhatsApp);
  const analysisPanel = $(".scenarios-panel"), analysisButton = $("#show-analysis");
  analysisButton?.addEventListener("click", toggleDetailedAnalysis);
  analysisPanel?.addEventListener("toggle", () => {
    if (analysisButton) analysisButton.textContent = translate(analysisPanel.open ? "Hide Detailed Analysis" : "Show Detailed Analysis");
  });
  function resetCalculator() {
    digitalMode = routeCountry === "OTHER";
    physicalSnapshot = digitalMode ? { itemPrice: "35", shipping: "5", production: "7", packaging: "4" } : null;
    const itemPriceEl = $("#item-price");
    if (itemPriceEl) itemPriceEl.value = "35";
    const shippingEl = $("#shipping");
    if (shippingEl) shippingEl.value = digitalMode ? "0" : "5";
    const productionEl = $("#production");
    if (productionEl) productionEl.value = digitalMode ? "0" : "7";
    const packagingEl = $("#packaging");
    if (packagingEl) packagingEl.value = digitalMode ? "0" : "4";
    $("#digital-preset")?.setAttribute("aria-pressed", String(digitalMode));
    const note = $("#digital-mode-note");
    if (note) note.hidden = !digitalMode;
    const targetProfitEl = $("#target-profit");
    if (targetProfitEl) targetProfitEl.value = "25";
    const etsyPlusEl = $("#etsy-plus");
    if (etsyPlusEl) etsyPlusEl.checked = false;
    const salesEl = $("#sales-per-month");
    if (salesEl) salesEl.value = "30";
    const offsiteZero = $('input[name="offsite"][value="0"]');
    if (offsiteZero) offsiteZero.checked = true;
    $$("input[aria-invalid]").forEach((input) => {
      input.removeAttribute("aria-invalid");
      input.setCustomValidity("");
      input.closest(".field")?.classList.remove("has-error");
      input.closest(".field")?.querySelector(".field-error-text")?.remove();
    });
    syncCountry(routeCountry || "US");
    showToast("Calculator reset");
  }

  $("#reset")?.addEventListener("click", resetCalculator);
  $("#mobile-reset")?.addEventListener("click", resetCalculator);
  $("#theme-toggle")?.addEventListener("click", () => {
    const next = document.body.classList.contains("dark") ? "light" : "dark";
    setTheme(next); store.set("shopprofit-theme", next);
  });
  const copyYear = $("#copyright-year");
  if (copyYear) copyYear.textContent = new Date().getFullYear();

  function setupInstantNavigation() {
    const prefetched = new Set();
    const prefetch = (href) => {
      if (!href || prefetched.has(href)) return;
      try {
        const url = new URL(href, location.origin);
        if (url.origin !== location.origin || url.pathname === location.pathname || url.hash) return;
        prefetched.add(href);
        const link = document.createElement("link");
        link.rel = "prefetch";
        link.href = url.pathname;
        document.head?.appendChild(link);
      } catch { /* ignore */ }
    };

    document.addEventListener("pointerover", (event) => {
      const link = event.target?.closest?.("a");
      if (link) prefetch(link.getAttribute("href"));
    }, { passive: true });

    document.addEventListener("touchstart", (event) => {
      const link = event.target?.closest?.("a");
      if (link) prefetch(link.getAttribute("href"));
    }, { passive: true });

    document.addEventListener("click", (event) => {
      const link = event.target?.closest?.('a[href^="/#"]');
      if (!link) return;
      const isHome = location.pathname === "/" || location.pathname === "" || location.pathname === "/index.html";
      if (isHome) {
        const hash = link.getAttribute("href").slice(1);
        const target = $(hash);
        if (target) {
          event.preventDefault();
          target.scrollIntoView?.({ behavior: "smooth" });
          history.pushState?.(null, "", hash);
        }
      }
    });
  }

  setupMenu(); setupPointerEffects(); setupInstantNavigation();
  window.addEventListener("scroll", () => $(".site-header")?.classList.toggle("scrolled", window.scrollY > 10), { passive: true });
  window.addEventListener("resize", () => {
    if (headingResizeFrame) return;
    headingResizeFrame = requestAnimationFrame(() => { fitHeroHeading(); headingResizeFrame = 0; });
  }, { passive: true });
  document.addEventListener("keydown", (event) => {
    const typing = event.target.matches("input, textarea, select, [contenteditable=true]");
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() === "r") $("#reset")?.click();
    if (event.key.toLowerCase() === "c") $("#copy-breakdown")?.click();
  });

  const preferredTheme = store.get("shopprofit-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  setTheme(preferredTheme);
  if ($("#country")) $("#country").value = activeCountryCode;
  if ($("#country-nav")) $("#country-nav").value = activeCountryCode;

  loadFeeData();
}

/**
 * Asynchronously loads authoritative v1.1.1 fee intelligence.
 */
export async function loadFeeData(customOptions = {}) {
  const isRetry = customOptions.showLoading || !!feeDataError;
  if (isRetry) {
    showLoadingState();
  }
  const client = customOptions.client || feeClient;
  const storage = customOptions.storage !== undefined ? customOptions.storage : store;

  try {
    const result = await client.loadAllNormalizedFeeSchedules({
      storage,
      expectedVersion: customOptions.expectedVersion || EXPECTED_VERSION_ID,
      bypassCache: customOptions.bypassCache || false
    });

    activeFeeSchedules.clear();
    for (const [code, schedule] of result.schedules.entries()) {
      activeFeeSchedules.set(code, schedule);
    }
    activeCountryOrder = result.countryOrder;
    isFeeDataLoaded = true;
    feeDataError = null;
    hideStatusBanner();

    const preferredCountry = routeCountry || store.get("shopprofit-country") || countryFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (activeFeeSchedules.has(preferredCountry)) {
      activeCountryCode = preferredCountry;
    } else if (activeFeeSchedules.has("US")) {
      activeCountryCode = "US";
    }

    fillCountryOptions();
    setControlsEnabled(true);
    renderFeeTable();
    render();
    return true;
  } catch (err) {
    console.error("Fee data load failed:", err);
    isFeeDataLoaded = false;
    feeDataError = err;
    showErrorState("Fee data is temporarily unavailable. Please try again.");
    return false;
  }
}

export function getFeeDataState() {
  return {
    isLoaded: isFeeDataLoaded,
    error: feeDataError,
    activeCountryCode,
    activeCountryOrder: [...activeCountryOrder],
    scheduleCount: activeFeeSchedules.size
  };
}

export {
  activeFeeSchedules,
  activeCountryOrder,
  solveRequiredPrice,
  formatCents,
  render,
  getState
};

// Startup initialization is handled above in the DOM ready block

