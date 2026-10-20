/**
 * ShopProfit — AI Etsy Business Advisor & Market Intelligence Client
 *
 * Integrates authoritative fee calculation (src/fee-engine.js) with real-time market research,
 * structured input verification, and transparent citations.
 *
 * ZERO-LEAK SECURITY:
 * - No private keys, account IDs, or tokens in client bundle.
 * - All server communication routes through /v1/advisor-conversation.
 * - Strict DOM text-node creation to eliminate XSS risks.
 */

import { DEFAULT_API_BASE } from "./fee-intelligence-client.js";

export const SUPPORTED_COUNTRIES = Object.freeze([
  { code: "US", label: "United States (USD)" },
  { code: "UK", label: "United Kingdom (GBP)" },
  { code: "CA", label: "Canada (CAD)" },
  { code: "AU", label: "Australia (AUD)" },
  { code: "DE", label: "Germany (EUR)" },
  { code: "FR", label: "France (EUR)" },
  { code: "IT", label: "Italy (EUR)" },
  { code: "ES", label: "Spain (EUR)" },
  { code: "NL", label: "Netherlands (EUR)" },
  { code: "IE", label: "Ireland (EUR)" },
  { code: "AT", label: "Austria (EUR)" },
  { code: "BE", label: "Belgium (EUR)" },
  { code: "FI", label: "Finland (EUR)" },
  { code: "PT", label: "Portugal (EUR)" },
  { code: "GR", label: "Greece (EUR)" },
  { code: "IN", label: "India (INR)" },
  { code: "JP", label: "Japan (JPY)" },
  { code: "TR", label: "Türkiye (TRY)" },
  { code: "VN", label: "Vietnam (VND)" },
  { code: "NZ", label: "New Zealand (NZD)" },
  { code: "SG", label: "Singapore (SGD)" },
  { code: "HK", label: "Hong Kong (HKD)" },
  { code: "MX", label: "Mexico (MXN)" },
  { code: "CH", label: "Switzerland (CHF)" },
  { code: "SE", label: "Sweden (SEK)" },
  { code: "NO", label: "Norway (NOK)" },
  { code: "DK", label: "Denmark (DKK)" },
  { code: "PL", label: "Poland (PLN)" }
]);

export const FIELD_LABELS = Object.freeze({
  country: "Seller Country / Market",
  itemPrice: "Item Listing Price",
  shipping: "Buyer-Paid Shipping Charge",
  freeShipping: "Explicit Free Shipping ($0 Buyer Charge)",
  production: "Production / Materials Cost (COGS)",
  confirmZeroProduction: "Digital / Zero Production Cost ($0 COGS)",
  packaging: "Packaging Cost",
  shippingCost: "Your Actual Postage / Label Cost",
  targetProfit: "Target Net Profit Amount",
  targetMarginPct: "Target Net Margin (%)",
  orderType: "Order Type (Domestic vs International)",
  offsiteAds: "Include Etsy Offsite Ads",
  offsiteRate: "Offsite Ads Rate (12% or 15%)"
});

function parseOptionalNumber(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : NaN;
  }
  const trimmed = String(raw).trim();
  if (trimmed === "") return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : NaN;
}

export function buildConfirmationPayloadFromForm(formState = {}) {
  const confirmedInputs = {};

  if (typeof formState.country === "string" && formState.country.trim().length > 0) {
    confirmedInputs.country = formState.country.trim().toUpperCase();
  }

  const numericKeys = [
    "itemPrice",
    "shipping",
    "production",
    "packaging",
    "shippingCost",
    "targetProfit",
    "targetMarginPct",
    "offsiteRate"
  ];

  for (const key of numericKeys) {
    const parsed = parseOptionalNumber(formState[key]);
    if (Number.isNaN(parsed)) {
      return {
        ok: false,
        error: `Invalid numeric value for ${FIELD_LABELS[key] || key}. Please enter a valid number.`
      };
    }
    if (parsed !== undefined) {
      if (parsed < 0) {
        return {
          ok: false,
          error: `${FIELD_LABELS[key] || key} cannot be negative.`
        };
      }
      confirmedInputs[key] = parsed;
    }
  }

  if (formState.freeShipping === true) {
    confirmedInputs.freeShipping = true;
    confirmedInputs.confirmZeroShipping = true;
    confirmedInputs.shipping = 0;
  } else if (confirmedInputs.shipping === 0) {
    confirmedInputs.confirmZeroShipping = true;
  }

  if (formState.confirmZeroProduction === true) {
    confirmedInputs.confirmZeroProduction = true;
    confirmedInputs.production = 0;
  }

  if (formState.orderType === "domestic" || formState.orderType === "international") {
    confirmedInputs.orderType = formState.orderType;
  }

  if (typeof formState.offsiteAds === "boolean") {
    confirmedInputs.offsiteAds = formState.offsiteAds;
  }

  return {
    ok: true,
    confirmedInputs
  };
}

export function buildFollowUpScenarios(calculationResult) {
  const status = calculationResult?.state || calculationResult?.status;
  if (!calculationResult || status !== "calculation_completed") {
    return [];
  }

  const args = calculationResult.verifiedArguments || {};
  const country = args.country || "US";
  const price = typeof args.itemPrice === "number" ? args.itemPrice : 35;
  const shipping = typeof args.shipping === "number" ? args.shipping : 0;
  const prod = typeof args.production === "number" ? args.production : 10;
  const shipCost = typeof args.shippingCost === "number" ? args.shippingCost : shipping;
  const shipPhrase = shipping === 0 ? "free shipping" : `$${shipping} buyer shipping`;
  const orderTypeSuffix =
    (country === "CA" || country === "AU" || country === "NZ") && args.orderType
      ? ` (${args.orderType} order)`
      : "";

  const followUps = [];

  if (calculationResult.tool !== "analyze_offsite_ads") {
    followUps.push({
      label: "Test 15% Offsite Ads Impact",
      prompt: `Analyze Offsite Ads impact at 15% for a $${price} item in ${country}${orderTypeSuffix} with ${shipPhrase}, $${prod} production cost, and $${shipCost} postage cost.`
    });
  }

  if (calculationResult.tool !== "find_target_price") {
    followUps.push({
      label: "Find Price for 30% Margin",
      prompt: `What price do I need in ${country}${orderTypeSuffix} for a 30% profit margin if production costs $${prod}, ${shipPhrase}, and postage costs me $${shipCost}?`
    });
  }

  if (calculationResult.tool !== "compare_price_scenarios") {
    const pLow = Math.max(5, Math.round((price - 5) * 100) / 100);
    const pMid = price;
    const pHigh = Math.round((price + 5) * 100) / 100;
    followUps.push({
      label: `Compare $${pLow} / $${pMid} / $${pHigh}`,
      prompt: `Compare selling at $${pLow}, $${pMid}, and $${pHigh} in ${country}${orderTypeSuffix} with ${shipPhrase}, $${prod} production cost, and $${shipCost} postage cost.`
    });
  }

  return followUps;
}

/**
 * Initializes the AI Seller Advisor component if present in the DOM.
 */
export function setupSellerAdvisor(options = {}) {
  const container = document.getElementById("seller-advisor");
  if (!container) return null;

  const apiBase = (options.apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");

  // DOM Elements
  const form = document.getElementById("advisor-question-form");
  const textarea = document.getElementById("advisor-question-input");
  const sendBtn = document.getElementById("advisor-send-btn");
  const statusRegion = document.getElementById("advisor-status-region");
  const transcriptEl = document.getElementById("advisor-transcript");
  const clarifyContainer = document.getElementById("advisor-clarification-container");
  const reportBody = document.getElementById("advisor-report-content");
  const toolBadge = document.getElementById("advisor-tool-badge");
  const sessionBadge = document.getElementById("advisor-session-badge");
  const presetChips = container.querySelectorAll("[data-advisor-preset]");

  let state = {
    conversationId: null,
    loading: false,
    error: null,
    lastFailedPayload: null,
    transcript: [],
    pendingClarification: null,
    editableFields: {},
    lastCompletedResult: null
  };

  function setBadge(text, isLive = false) {
    if (!toolBadge) return;
    toolBadge.textContent = text;
    if (isLive) {
      toolBadge.classList.add("active");
    } else {
      toolBadge.classList.remove("active");
    }
  }

  function setSessionId(id) {
    if (!sessionBadge) return;
    sessionBadge.textContent = id ? `Session: ${id.slice(0, 8)}…` : "New Session";
  }

  function clearEl(el) {
    if (!el) return;
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }

  function renderStatus() {
    clearEl(statusRegion);
    if (!statusRegion) return;

    if (state.loading) {
      const banner = document.createElement("div");
      banner.className = "advisor-status-banner advisor-status-loading";
      banner.textContent = "Researching live market data & verifying financial calculations...";
      statusRegion.appendChild(banner);
      if (sendBtn) sendBtn.disabled = true;
      if (textarea) textarea.disabled = true;
      return;
    }

    if (sendBtn) sendBtn.disabled = false;
    if (textarea) textarea.disabled = false;

    if (state.error) {
      const banner = document.createElement("div");
      banner.className = "advisor-status-banner advisor-status-error";
      const textSpan = document.createElement("span");
      textSpan.textContent = `[${state.error.code || "error"}] ${state.error.message || "An error occurred."}`;
      banner.appendChild(textSpan);

      if (state.lastFailedPayload) {
        const retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "button button-secondary";
        retryBtn.style.padding = "4px 10px";
        retryBtn.style.fontSize = "11px";
        retryBtn.textContent = "Retry";
        retryBtn.addEventListener("click", () => {
          executeRequest(state.lastFailedPayload);
        });
        banner.appendChild(retryBtn);
      }
      statusRegion.appendChild(banner);
    }
  }

  function renderTranscript() {
    clearEl(transcriptEl);
    if (!transcriptEl) return;

    if (state.transcript.length === 0) {
      const empty = document.createElement("div");
      empty.className = "advisor-empty-state";
      empty.textContent =
        "Ask a question above or pick a sample scenario to begin. If inputs like buyer shipping or production cost are missing, the advisor asks for confirmation before computing exact results.";
      transcriptEl.appendChild(empty);
      return;
    }

    for (const turn of state.transcript) {
      const card = document.createElement("div");
      card.className = `advisor-turn ${turn.role === "seller" ? "turn-seller" : turn.role === "system_error" ? "turn-error" : "turn-assistant"}`;

      const meta = document.createElement("div");
      meta.className = "advisor-turn-meta";
      const roleSpan = document.createElement("span");
      roleSpan.textContent = turn.role === "seller" ? "You (Seller)" : turn.role === "system_error" ? "System Error" : "ShopProfit Advisor";
      const timeSpan = document.createElement("span");
      timeSpan.textContent = turn.status ? `Status: ${turn.status}` : "";
      meta.appendChild(roleSpan);
      meta.appendChild(timeSpan);

      const body = document.createElement("div");
      body.className = "advisor-turn-text";
      body.textContent = turn.text;

      card.appendChild(meta);
      card.appendChild(body);
      transcriptEl.appendChild(card);
    }

    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function renderClarificationCard() {
    clearEl(clarifyContainer);
    if (!clarifyContainer) return;

    const pending = state.pendingClarification;
    if (!pending) {
      clarifyContainer.hidden = true;
      return;
    }

    clarifyContainer.hidden = false;

    const box = document.createElement("div");
    box.className = "advisor-clarify-card";
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Input Clarification and Confirmation");

    const header = document.createElement("div");
    header.className = "advisor-clarify-header";
    const title = document.createElement("strong");
    title.textContent = "Confirm Your Product Inputs";
    const badge = document.createElement("span");
    badge.className = "advisor-badge";
    badge.textContent = "Explicit Confirmation Required";
    header.appendChild(title);
    header.appendChild(badge);
    box.appendChild(header);

    const questionP = document.createElement("p");
    questionP.className = "advisor-clarify-question";
    questionP.textContent = pending.clarificationQuestion || "Please verify the following values before running calculations:";
    box.appendChild(questionP);

    const flagged = new Set([
      ...(pending.missingFields || []),
      ...(pending.ambiguousFields || []),
      ...(pending.modelAssumptions || [])
    ]);

    const grid = document.createElement("div");
    grid.className = "advisor-clarify-grid";

    // Country field
    const countryField = document.createElement("div");
    countryField.className = `advisor-field ${flagged.has("country") ? "is-flagged" : ""}`;
    const countryLabel = document.createElement("label");
    countryLabel.setAttribute("for", "adv-confirm-country");
    countryLabel.textContent = "Seller Country";
    const countrySelect = document.createElement("select");
    countrySelect.id = "adv-confirm-country";
    countrySelect.className = "advisor-input";

    for (const c of SUPPORTED_COUNTRIES) {
      const opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = `${c.code} — ${c.label}`;
      if (state.editableFields.country === c.code) {
        opt.selected = true;
      }
      countrySelect.appendChild(opt);
    }
    countrySelect.addEventListener("change", (e) => {
      state.editableFields.country = e.target.value;
    });
    countryField.appendChild(countryLabel);
    countryField.appendChild(countrySelect);
    grid.appendChild(countryField);

    // Numeric fields
    const fields = [
      { key: "itemPrice", label: "Item Price", placeholder: "e.g. 32.00", step: "0.01" },
      { key: "shipping", label: "Buyer Shipping", placeholder: "e.g. 5.00 (or check Free Shipping)", step: "0.01" },
      { key: "production", label: "Production Cost (COGS)", placeholder: "e.g. 9.00", step: "0.01" },
      { key: "packaging", label: "Packaging Cost", placeholder: "e.g. 1.50", step: "0.01" },
      { key: "shippingCost", label: "Your Postage Cost", placeholder: "e.g. 4.50", step: "0.01" }
    ];

    for (const f of fields) {
      const fWrap = document.createElement("div");
      fWrap.className = `advisor-field ${flagged.has(f.key) ? "is-flagged" : ""}`;
      const fLbl = document.createElement("label");
      fLbl.setAttribute("for", `adv-confirm-${f.key}`);
      fLbl.textContent = f.label;
      const fInp = document.createElement("input");
      fInp.id = `adv-confirm-${f.key}`;
      fInp.type = "number";
      fInp.step = f.step;
      fInp.min = "0";
      fInp.className = "advisor-input";
      fInp.placeholder = f.placeholder;
      fInp.value = state.editableFields[f.key] !== undefined && state.editableFields[f.key] !== null ? String(state.editableFields[f.key]) : "";
      fInp.addEventListener("input", (e) => {
        state.editableFields[f.key] = e.target.value;
      });
      fWrap.appendChild(fLbl);
      fWrap.appendChild(fInp);
      grid.appendChild(fWrap);
    }

    box.appendChild(grid);

    // Checkboxes for Free Shipping & Digital/Zero COGS
    const checks = document.createElement("div");
    checks.className = "advisor-clarify-checks";

    const freeShipLabel = document.createElement("label");
    freeShipLabel.className = "advisor-check-label";
    const freeShipCb = document.createElement("input");
    freeShipCb.type = "checkbox";
    freeShipCb.checked = state.editableFields.freeShipping === true;
    freeShipCb.addEventListener("change", (e) => {
      state.editableFields.freeShipping = e.target.checked;
      if (e.target.checked) {
        state.editableFields.shipping = 0;
        const sInp = document.getElementById("adv-confirm-shipping");
        if (sInp) sInp.value = "0";
      }
    });
    freeShipLabel.appendChild(freeShipCb);
    freeShipLabel.appendChild(document.createTextNode(" Free Shipping ($0 charged to buyer)"));
    checks.appendChild(freeShipLabel);

    const zeroCogsLabel = document.createElement("label");
    zeroCogsLabel.className = "advisor-check-label";
    const zeroCogsCb = document.createElement("input");
    zeroCogsCb.type = "checkbox";
    zeroCogsCb.checked = state.editableFields.confirmZeroProduction === true;
    zeroCogsCb.addEventListener("change", (e) => {
      state.editableFields.confirmZeroProduction = e.target.checked;
      if (e.target.checked) {
        state.editableFields.production = 0;
        const pInp = document.getElementById("adv-confirm-production");
        if (pInp) pInp.value = "0";
      }
    });
    zeroCogsLabel.appendChild(zeroCogsCb);
    zeroCogsLabel.appendChild(document.createTextNode(" Digital / Zero Production Cost ($0 COGS)"));
    checks.appendChild(zeroCogsLabel);

    box.appendChild(checks);

    // Confirmation button
    const actions = document.createElement("div");
    actions.className = "advisor-clarify-actions";
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "button button-primary";
    confirmBtn.textContent = "Confirm Verified Inputs & Calculate";
    confirmBtn.addEventListener("click", () => {
      submitConfirmation();
    });
    actions.appendChild(confirmBtn);
    box.appendChild(actions);

    clarifyContainer.appendChild(box);
  }

  function renderReport(result) {
    clearEl(reportBody);
    if (!reportBody) return;

    if (!result || (result.state !== "calculation_completed" && !result.marketIntelligence)) {
      const empty = document.createElement("div");
      empty.className = "advisor-empty-state";
      empty.textContent = "Financial breakdown and market intelligence report will appear here upon calculation.";
      reportBody.appendChild(empty);
      return;
    }

    const reportWrap = document.createElement("div");
    reportWrap.className = "advisor-report-wrap";

    // 1. Primary Metrics (if calculation is completed)
    const calc = result.result || result.calculation;
    if (calc && typeof calc.netProfit === "number") {
      const metricsCard = document.createElement("div");
      metricsCard.className = "advisor-metrics-card";

      const curr = calc.currency || "$";
      const metrics = [
        { label: "Net Profit", value: `${curr}${Number(calc.netProfit).toFixed(2)}`, highlight: true },
        { label: "Net Margin", value: `${Number(calc.netMarginPct || calc.marginPct || 0).toFixed(1)}%`, highlight: true },
        { label: "Total Platform Fees", value: `${curr}${Number(calc.totalFees || calc.totalEtsyFees || 0).toFixed(2)}` },
        { label: "Break-Even Price", value: `${curr}${Number(calc.breakEvenPrice || 0).toFixed(2)}` }
      ];

      for (const m of metrics) {
        const item = document.createElement("div");
        item.className = `advisor-metric-item ${m.highlight ? "metric-highlight" : ""}`;
        const lbl = document.createElement("div");
        lbl.className = "advisor-metric-label";
        lbl.textContent = m.label;
        const val = document.createElement("div");
        val.className = "advisor-metric-value";
        val.textContent = m.value;
        item.appendChild(lbl);
        item.appendChild(val);
        metricsCard.appendChild(item);
      }
      reportWrap.appendChild(metricsCard);
    }

    // 2. Integrated Market Opportunity Report (Sections A through H)
    const mi = result.marketIntelligence;
    const intRep = mi?.integratedOpportunityReport;
    if (intRep) {
      const intBox = document.createElement("div");
      intBox.className = "advisor-opportunity-report";

      const repHeader = document.createElement("div");
      repHeader.className = "advisor-rep-header";
      const repTitle = document.createElement("strong");
      repTitle.textContent = "Market Opportunity & Seller Experiment Report";
      const repBadge = document.createElement("span");
      repBadge.className = "advisor-badge";
      repBadge.textContent = "Live Market Analysis";
      repHeader.appendChild(repTitle);
      repHeader.appendChild(repBadge);
      intBox.appendChild(repHeader);

      // Section A: Seller Objective
      if (intRep.sellerObjective) {
        const secA = document.createElement("div");
        secA.className = "advisor-rep-section";
        const hA = document.createElement("h4");
        hA.textContent = "A. Seller Objective";
        secA.appendChild(hA);
        const pObj = document.createElement("p");
        pObj.textContent = `${intRep.sellerObjective.objective || "Evaluate profitable pricing"} (Category: ${intRep.sellerObjective.productCategory || "General"})`;
        secA.appendChild(pObj);
        intBox.appendChild(secA);
      }

      // Section B: Observable Market Evidence
      if (intRep.marketEvidence) {
        const secB = document.createElement("div");
        secB.className = "advisor-rep-section";
        const hB = document.createElement("h4");
        hB.textContent = "B. Observable Market Evidence";
        secB.appendChild(hB);

        const opr = intRep.marketEvidence.observedPriceRange;
        if (opr) {
          const curr = opr.currency || "$";
          const pRange = document.createElement("p");
          pRange.className = "advisor-rep-highlight";
          pRange.textContent = `Observed Price Range: Low ${curr}${Number(opr.low).toFixed(2)} | Mid ${curr}${Number(opr.mid).toFixed(2)} | High ${curr}${Number(opr.high).toFixed(2)} (${opr.sampleCount} listings observed)`;
          secB.appendChild(pRange);
        }

        const discl = document.createElement("p");
        discl.className = "advisor-rep-disclaimer";
        discl.textContent = intRep.marketEvidence.volumeDisclaimer || "Listing prices represent asking prices and do not prove sales volume or transaction velocity.";
        secB.appendChild(discl);
        intBox.appendChild(secB);
      }

      // Section C: Competitor Observations
      if (intRep.competitorObservations?.listingSamples?.length > 0) {
        const secC = document.createElement("div");
        secC.className = "advisor-rep-section";
        const hC = document.createElement("h4");
        hC.textContent = "C. Competitor Observations";
        secC.appendChild(hC);

        const ul = document.createElement("ul");
        ul.className = "advisor-rep-list";
        for (const sample of intRep.competitorObservations.listingSamples.slice(0, 3)) {
          const li = document.createElement("li");
          li.textContent = `"${sample.title}" — ${sample.currency || "$"}${Number(sample.price).toFixed(2)}`;
          ul.appendChild(li);
        }
        secC.appendChild(ul);
        intBox.appendChild(secC);
      }

      // Section D: Potential Differentiation Vectors
      const angles = Array.isArray(intRep.potentialDifferentiation)
        ? intRep.potentialDifferentiation
        : Array.isArray(intRep.potentialDifferentiation?.positioningAngles)
          ? intRep.potentialDifferentiation.positioningAngles
          : [];
      if (angles.length > 0) {
        const secD = document.createElement("div");
        secD.className = "advisor-rep-section";
        const hD = document.createElement("h4");
        hD.textContent = "D. Positioning Angles (Hypotheses to Test)";
        secD.appendChild(hD);

        const ul = document.createElement("ul");
        ul.className = "advisor-rep-list";
        for (const angle of angles) {
          const li = document.createElement("li");
          li.textContent = angle;
          ul.appendChild(li);
        }
        secD.appendChild(ul);
        intBox.appendChild(secD);
      }

      // Section E: Deterministic Financial Comparison (3-tier)
      if (intRep.financialComparison?.candidatePrices?.length > 0) {
        const secE = document.createElement("div");
        secE.className = "advisor-rep-section";
        const hE = document.createElement("h4");
        hE.textContent = "E. Price Scenario Financial Comparison (fee-engine.js)";
        secE.appendChild(hE);

        const table = document.createElement("table");
        table.className = "advisor-scenario-table";
        table.innerHTML = `
          <thead>
            <tr>
              <th>Tier</th>
              <th>Price</th>
              <th>Net Profit</th>
              <th>Margin</th>
              <th>Etsy Fees</th>
            </tr>
          </thead>
          <tbody></tbody>
        `;
        const tbody = table.querySelector("tbody");
        for (const cand of intRep.financialComparison.candidatePrices) {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td><strong>${cand.label || "Tier"}</strong></td>
            <td>$${Number(cand.price).toFixed(2)}</td>
            <td style="color: var(--accent); font-weight: 700;">$${Number(cand.netProfit).toFixed(2)}</td>
            <td>${Number(cand.marginPct).toFixed(1)}%</td>
            <td>$${Number(cand.totalEtsyFees).toFixed(2)}</td>
          `;
          tbody.appendChild(tr);
        }
        secE.appendChild(table);
        intBox.appendChild(secE);
      }

      // Section F: Uncertainties & Risks
      if (intRep.keyUncertaintiesAndRisks?.length > 0) {
        const secF = document.createElement("div");
        secF.className = "advisor-rep-section";
        const hF = document.createElement("h4");
        hF.textContent = "F. Key Uncertainties & Financial Risks";
        secF.appendChild(hF);

        const ul = document.createElement("ul");
        ul.className = "advisor-rep-list";
        for (const risk of intRep.keyUncertaintiesAndRisks) {
          const li = document.createElement("li");
          li.textContent = risk;
          ul.appendChild(li);
        }
        secF.appendChild(ul);
        intBox.appendChild(secF);
      }

      // Section G: Recommended Next Experiment
      if (intRep.recommendedNextExperiment) {
        const secG = document.createElement("div");
        secG.className = "advisor-rep-section advisor-experiment-box";
        const hG = document.createElement("h4");
        hG.textContent = "G. Recommended Business Experiment";
        secG.appendChild(hG);

        const pExp = document.createElement("p");
        pExp.innerHTML = `<strong>Action:</strong> ${intRep.recommendedNextExperiment.testAction || "Test pricing"}<br><strong>Duration:</strong> ${intRep.recommendedNextExperiment.duration || "14 days"}`;
        secG.appendChild(pExp);
        intBox.appendChild(secG);
      }

      // Section H: Verified Sources & Citations
      if (intRep.sources?.length > 0) {
        const secH = document.createElement("div");
        secH.className = "advisor-rep-section";
        const hH = document.createElement("h4");
        hH.textContent = "H. Verified Sources & Citations";
        secH.appendChild(hH);

        const ul = document.createElement("ul");
        ul.className = "advisor-rep-list";
        for (const s of intRep.sources) {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = s.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = s.title || s.url;
          li.appendChild(a);
          li.appendChild(document.createTextNode(` [${s.sourceClassification || "verified"}]`));
          ul.appendChild(li);
        }
        secH.appendChild(ul);
        intBox.appendChild(secH);
      }

      reportWrap.appendChild(intBox);
    }

    // 3. Contextual Follow-up Scenarios
    const followUps = buildFollowUpScenarios(result);
    if (followUps.length > 0) {
      const followUpWrap = document.createElement("div");
      followUpWrap.className = "advisor-followups";
      const fTitle = document.createElement("strong");
      fTitle.textContent = "Explore Next Scenarios:";
      followUpWrap.appendChild(fTitle);

      const fBtns = document.createElement("div");
      fBtns.className = "advisor-followup-buttons";
      for (const item of followUps) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "advisor-chip";
        btn.textContent = item.label;
        btn.addEventListener("click", () => {
          if (textarea) textarea.value = item.prompt;
          submitQuestion(item.prompt);
        });
        fBtns.appendChild(btn);
      }
      followUpWrap.appendChild(fBtns);
      reportWrap.appendChild(followUpWrap);
    }

    reportBody.appendChild(reportWrap);
  }

  async function executeRequest(payload) {
    state.loading = true;
    state.error = null;
    state.lastFailedPayload = payload;
    setBadge("Processing...", true);
    renderStatus();

    try {
      const res = await fetch(`${apiBase}/v1/advisor-conversation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      let body = {};
      try {
        body = await res.json();
      } catch {
        body = { ok: false, message: "Non-JSON response received from advisor server." };
      }

      if (body.conversationId) {
        state.conversationId = body.conversationId;
        setSessionId(body.conversationId);
      }

      if (!res.ok || body.ok === false) {
        state.loading = false;
        state.error = {
          code: body.error || `http_${res.status}`,
          message: body.message || body.explanation || "Advisor request failed. Please check inputs and retry."
        };
        setBadge("Error");
        state.transcript.push({
          role: "system_error",
          status: "failed",
          text: state.error.message
        });
        renderStatus();
        renderTranscript();
        return;
      }

      const bodyState = body.state || body.status;

      if (bodyState === "needs_clarification" || bodyState === "awaiting_confirmation") {
        const cArgs = body.candidateExtraction?.arguments || {};
        state.editableFields = {
          country: cArgs.country || "US",
          itemPrice: cArgs.itemPrice ?? "",
          shipping: cArgs.shipping ?? "",
          freeShipping: cArgs.freeShipping === true,
          production: cArgs.production ?? "",
          confirmZeroProduction: cArgs.isDigital === true,
          packaging: cArgs.packaging ?? "",
          shippingCost: cArgs.shippingCost ?? "",
          targetProfit: cArgs.targetProfit ?? "",
          targetMarginPct: cArgs.targetMarginPct ?? "",
          orderType: cArgs.orderType || "domestic",
          offsiteAds: Boolean(cArgs.offsiteAds),
          offsiteRate: cArgs.offsiteRate ?? ""
        };

        state.pendingClarification = {
          conversationId: body.conversationId,
          originalMessage: body.originalMessage || payload.message,
          confirmationToken: body.confirmationToken,
          clarificationQuestion: body.clarificationQuestion,
          missingFields: body.missingFields || [],
          ambiguousFields: body.ambiguousFields || [],
          modelAssumptions: body.modelAssumptions || []
        };

        state.transcript.push({
          role: "assistant",
          status: bodyState,
          text: body.explanation || body.clarificationQuestion || "Please clarify the missing product details."
        });

        state.loading = false;
        setBadge("Awaiting Confirmation");
        renderStatus();
        renderTranscript();
        renderClarificationCard();

        if (body.marketIntelligence) {
          renderReport(body);
        }
        return;
      }

      if (bodyState === "calculation_completed") {
        state.pendingClarification = null;
        state.lastCompletedResult = body;
        state.transcript.push({
          role: "assistant",
          status: "completed",
          text: body.explanation || "Calculations completed successfully using ShopProfit's verified fee engine."
        });

        state.loading = false;
        setBadge(body.tool || "Verified");
        renderStatus();
        renderTranscript();
        renderClarificationCard();
        renderReport(body);
        return;
      }

      // Refusal or fallback
      state.loading = false;
      setBadge("Unavailable");
      state.transcript.push({
        role: "assistant",
        status: bodyState || "notice",
        text: body.message || body.explanation || "Advisor calculation could not be completed."
      });
      renderStatus();
      renderTranscript();
    } catch (err) {
      state.loading = false;
      state.error = {
        code: "network_error",
        message: err instanceof Error ? err.message : "Unable to reach the advisor service."
      };
      setBadge("Network Error");
      state.transcript.push({
        role: "system_error",
        status: "network_error",
        text: state.error.message
      });
      renderStatus();
      renderTranscript();
    }
  }

  function submitQuestion(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;

    state.transcript.push({
      role: "seller",
      text: trimmed
    });
    renderTranscript();

    const payload = {
      message: trimmed
    };
    if (state.conversationId) {
      payload.conversationId = state.conversationId;
    }

    executeRequest(payload);
  }

  function submitConfirmation() {
    if (!state.pendingClarification) return;

    const validation = buildConfirmationPayloadFromForm(state.editableFields);
    if (!validation.ok) {
      state.error = {
        code: "validation_error",
        message: validation.error || "Please check your entered values."
      };
      renderStatus();
      return;
    }

    state.transcript.push({
      role: "seller",
      text: `Confirmed inputs: Price $${validation.confirmedInputs.itemPrice || 0}, Shipping $${validation.confirmedInputs.shipping || 0}, Production $${validation.confirmedInputs.production || 0}, Country ${validation.confirmedInputs.country || "US"}`
    });
    renderTranscript();

    const payload = {
      conversationId: state.pendingClarification.conversationId,
      message: state.pendingClarification.originalMessage,
      confirmationToken: state.pendingClarification.confirmationToken,
      confirmedInputs: validation.confirmedInputs
    };

    executeRequest(payload);
  }

  // Event Listeners
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!textarea) return;
    const q = textarea.value.trim();
    if (q) {
      textarea.value = "";
      submitQuestion(q);
    }
  });

  textarea?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
      e.preventDefault();
      form?.dispatchEvent(new Event("submit"));
    }
  });

  presetChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const q = chip.getAttribute("data-advisor-preset");
      if (q) {
        if (textarea) textarea.value = q;
        submitQuestion(q);
      }
    });
  });

  // Initial render
  renderStatus();
  renderTranscript();
  renderClarificationCard();
  renderReport(null);

  return {
    submitQuestion,
    submitConfirmation,
    getState: () => ({ ...state })
  };
}
