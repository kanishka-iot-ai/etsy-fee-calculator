import { mkdir, readFile, writeFile } from "node:fs/promises";
import { COUNTRY_ORDER } from "../src/countries.js";
import {
  GLOBAL_COUNTRY_RULES,
  formatMoney,
  OFFICIAL_TRANSACTION_RATE as TRANSACTION_RATE
} from "../src/fee-engine.js";
import { STATUTORY_REGULATORY_RATES } from "../src/compatibility.js";
import { SUPPORT_EMAIL, supportContactHtml } from "./site-config.mjs";

const htmlFile = new URL("../index.html", import.meta.url);
const source = await readFile(htmlFile, "utf8");
const replaceOnce = (html, pattern, replacement, label) => {
  if (!pattern.test(html)) throw new Error(`Could not find ${label} in index.html`);
  return html.replace(pattern, replacement);
};

const feeRows = COUNTRY_ORDER.map((code) => {
  const country = GLOBAL_COUNTRY_RULES[code];
  const regRate = STATUTORY_REGULATORY_RATES[code];
  const regulatory = regRate ? `${(regRate * 100).toFixed(2)}%` : "—";
  const rate = country.rate * 100;
  const rateLabel = `${Number.isInteger(rate) ? rate.toFixed(0) : rate.toFixed(1)}%`;
  const transaction = `${(TRANSACTION_RATE * 100).toFixed(1)}%`;
  const notes = code === "CA"
    ? "Domestic or US order rate; international orders are 4% + CA$0.25."
    : (code === "AU"
    ? "Domestic order rate; international orders are 4% + A$0.25."
    : (code === "JP" ? "Etsy publishes the fixed processing charge in USD; the JPY amount is an estimate and currency conversion is not modeled."
    : (code === "TR" ? "Türkiye rate per Etsy's published schedule: 6.5% + ₺14. Regulatory operating fee 1.67%. Fixed TRY amounts are subject to exchange-rate changes."
    : (code === "DE" ? "Eurozone rate (4% + €0.30); no separate regulatory operating fee is currently published for Germany/Eurozone."
    : (code === "OTHER" ? "Generic USD baseline only; this is not a country-specific Etsy fee schedule."
    : "Domestic/default processing estimate; international order rates may differ.")))));
  return `          <tr><th scope="row">${country.name}</th><td>${country.currency}</td><td>${formatMoney(Math.round(country.listingFee * 100), country)}</td><td>${transaction}</td><td>${rateLabel} + ${formatMoney(Math.round(country.fixed * 100), country)}</td><td>${regulatory}</td><td>${notes}</td></tr>`;
}).join("\n");

let base = replaceOnce(source, /<tbody id="fee-table-body">[\s\S]*?<\/tbody>/, `<tbody id="fee-table-body">\n${feeRows}\n      </tbody>`, "fee table body");
base = replaceOnce(base, /<select class="country-nav" id="country-nav" aria-label="Seller location">[\s\S]*?<\/select>/,
  `<select class="country-nav" id="country-nav" aria-label="Seller location">${COUNTRY_ORDER.map((code) => `<option value="${code}">${GLOBAL_COUNTRY_RULES[code].name}</option>`).join("")}</select>`, "header country selector");
base = replaceOnce(base, /<select id="country" name="country">[\s\S]*?<\/select>/,
  `<select id="country" name="country">${COUNTRY_ORDER.map((code) => `<option value="${code}">${GLOBAL_COUNTRY_RULES[code].name}</option>`).join("")}</select>`, "calculator country selector");
base = replaceOnce(base, /<link rel="preload" href="\/fonts\/silkscreen-700-latin\.woff2" as="font" type="font\/woff2" crossorigin>/,
  `<link rel="preload" href="/fonts/silkscreen-700-latin.woff2" as="font" type="font/woff2" crossorigin>`, "pixel font preload");
const noScriptNote = `<noscript><p class="noscript-note">The fee guide, methodology, country table, and FAQs are available below. Entering and calculating a sale requires JavaScript; your entries are not submitted.</p></noscript>`;
if (/<noscript>[\s\S]*?<\/noscript>/.test(base)) base = base.replace(/<noscript>[\s\S]*?<\/noscript>/, noScriptNote);
else base = replaceOnce(base, /<\/main>/, `</main>\n  ${noScriptNote}`, "main closing tag");
base = replaceOnce(base, /<div class="footer-column"><strong>Tools<\/strong>[\s\S]*?<\/div><div class="footer-column"><strong>Resources<\/strong>/,
  `<div class="footer-column"><strong>Tools</strong><a href="/#calculator">Etsy profit calculator</a><a href="/fees/">Etsy fee calculator</a><a href="/etsy-pricing-calculator/">Etsy pricing calculator</a><a href="/etsy-break-even-calculator/">Etsy break-even calculator</a><a href="/etsy-offsite-ads-calculator/">Etsy Offsite Ads calculator</a><a href="/etsy-digital-download-fee-calculator">Etsy digital product calculator</a><a href="/etsy-print-on-demand-calculator/">Etsy print on demand calculator</a><strong>Regional calculators</strong><a href="/etsy-fee-calculator-uk">United Kingdom</a><a href="/etsy-fee-calculator-canada">Canada</a><a href="/etsy-fee-calculator-australia">Australia</a></div><div class="footer-column"><strong>Resources</strong>`, "footer tool links");
base = replaceOnce(base, /<div class="footer-column"><strong>Resources<\/strong>[\s\S]*?<\/div><div class="footer-column"><strong>Legal<\/strong>/,
  `<div class="footer-column"><strong>Resources</strong><a href="/fees/">Etsy fees guide</a><a href="/methodology/">Methodology</a><a href="/faq/">FAQ</a></div><div class="footer-column"><strong>Legal</strong>`, "footer resource links");
base = replaceOnce(base, /<div class="footer-column"><strong>Legal<\/strong>[\s\S]*?<\/div>/,
  `<div class="footer-column"><strong>Legal</strong><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Contact</a>${supportContactHtml()}</div>`, "footer contact link");

const faqSchemaTag = base.match(/<script type="application\/ld\+json" id="faq-structured-data">\s*([\s\S]*?)\s*<\/script>/);
if (!faqSchemaTag) throw new Error("Missing FAQPage schema in index.html");
const faqSchema = JSON.parse(faqSchemaTag[1]);
const answerFaqs = [
  ["How do I calculate Etsy profit?", "Net profit is item price plus buyer shipping, minus Etsy fees, production and material costs, and packaging and shipping costs. Include other business costs that apply to your sale."],
  ["How do I calculate Etsy fees?", "Add the listing fee, transaction fee on the order total, payment processing for the seller’s country, any regulatory operating fee, and any Offsite Ads fee attributed to the order."],
  ["How much should I charge on Etsy?", "Choose a price that covers your costs and Etsy fees while meeting your take-home target. Use break-even for the minimum price that avoids a loss, or target pricing for a chosen profit amount."],
  ["What is Etsy profit margin?", "Profit margin is net profit divided by gross revenue, then multiplied by 100. ShopProfit’s gross revenue includes item price and shipping charged to the buyer."],
  ["What fees apply to Etsy digital products?", "Digital products still incur Etsy listing, transaction, and payment-processing fees. Attributed Offsite Ads may add a fee; physical production and packaging costs are optional inputs."],
  ["What is an Etsy break-even price?", "It is the minimum item price that covers estimated Etsy fees and costs at your chosen shipping amount, seller location, and Offsite Ads rate."],
];
for (const [name, answer] of answerFaqs) {
  if (!faqSchema.mainEntity.some((item) => item.name === name)) faqSchema.mainEntity.push({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text: answer } });
}
base = base.replace(faqSchemaTag[0], `<script type="application/ld+json" id="faq-structured-data">\n${JSON.stringify(faqSchema)}\n  </script>`);

const routes = [
  {
    file: "etsy-fee-calculator-uk.html", path: "/etsy-fee-calculator-uk", code: "UK",
    title: "Etsy Fee Calculator UK — ShopProfit",
    description: "Calculate Etsy seller fees and take-home profit in GBP. Accurate UK fee calculator modeling 6.5% transaction, 4% + £0.20 processing, and 0.48% regulatory fees.",
    h1: "Etsy Fee Calculator UK",
    intro: "Calculate your exact Etsy seller fees, unit break-even price, and net profit in British Pounds (£ GBP). Models Etsy’s 6.5% transaction fee, UK payment processing (4% + £0.20), the 0.48% UK regulatory operating fee, and optional Offsite Ads. Looking for multi-currency calculations? Visit the main <a href=\"/\">Etsy profit calculator</a> or browse the <a href=\"/fees/\">Etsy fees guide</a>.",
    question: "What Etsy fees do sellers pay in the United Kingdom?",
    answer: "UK sellers pay four core platform fees on standard domestic sales: an estimated £0.16 listing fee ($0.20 USD converted), a 6.5% transaction fee on the full order amount (item price + buyer postage), UK payment processing of 4% + £0.20 per order, and a 0.48% UK regulatory operating fee. Attributed Offsite Ads may add an optional 15% or mandatory 12% fee.",
  },
  {
    file: "etsy-fee-calculator-canada.html", path: "/etsy-fee-calculator-canada", code: "CA",
    title: "Etsy Fee Calculator Canada — ShopProfit",
    description: "Calculate Etsy seller fees and take-home profit in CAD. Accurate Canadian fee calculator modeling 6.5% transaction, domestic/US 3% + $0.25 processing, and 0.50% regulatory fees.",
    h1: "Etsy Fee Calculator Canada",
    intro: "Calculate your exact Etsy seller fees, unit break-even price, and net profit in Canadian Dollars ($ CAD). Models Etsy’s 6.5% transaction fee, Canadian payment processing (3% + $0.25 domestic/US or 4% + $0.25 international), the 0.50% Canadian regulatory operating fee, and optional Offsite Ads. Looking for multi-currency calculations? Visit the main <a href=\"/\">Etsy profit calculator</a> or browse the <a href=\"/fees/\">Etsy fees guide</a>.",
    question: "What fees does Etsy charge sellers in Canada?",
    answer: "Canadian sellers pay four core platform fees on standard orders: an estimated $0.27 CAD listing fee ($0.20 USD converted), a 6.5% transaction fee on the order total (item price + buyer shipping), Canadian payment processing of 3% + $0.25 CAD (for Canadian and US buyers) or 4% + $0.25 CAD (for international buyers), and a 0.50% Canadian regulatory operating fee. Attributed Offsite Ads may add an optional 15% or mandatory 12% advertising fee.",
  },
  {
    file: "etsy-fee-calculator-australia.html", path: "/etsy-fee-calculator-australia", code: "AU",
    title: "Etsy Fee Calculator Australia — ShopProfit",
    description: "Calculate Etsy seller fees and take-home profit in AUD. Accurate Australian fee calculator modeling 6.5% transaction, domestic 3% + A$0.25 processing, and export rates.",
    h1: "Etsy Fee Calculator Australia",
    intro: "Calculate your exact Etsy seller fees, unit break-even price, and net profit in Australian Dollars ($ AUD). Models Etsy’s 6.5% transaction fee, Australian payment processing (3% + A$0.25 domestic or 4% + A$0.25 international), zero regulatory operating fees, and optional Offsite Ads. Looking for multi-currency calculations? Visit the main <a href=\"/\">Etsy profit calculator</a> or browse the <a href=\"/fees/\">Etsy fees guide</a>.",
    question: "What fees does Etsy charge sellers in Australia?",
    answer: "Australian sellers pay three core platform fees on domestic sales: an estimated $0.28 AUD listing fee ($0.20 USD converted), a 6.5% transaction fee on the order total (item price + buyer shipping), and Australian payment processing of 3% + A$0.25 (for domestic Australian buyers) or 4% + A$0.25 (for international buyers). Australia has no separate regulatory operating fee. Attributed Offsite Ads may add an optional 15% or mandatory 12% advertising fee.",
  },
  {
    file: "etsy-digital-download-fee-calculator.html", path: "/etsy-digital-download-fee-calculator", code: "OTHER",
    title: "Etsy Digital Download Fee Calculator — ShopProfit",
    description: "Calculate Etsy seller fees, unit margins, and take-home profit for digital downloads. Accurate digital fee calculator modeling 6.5% transaction, payment processing, listing fees, and Offsite Ads.",
    h1: "Etsy Digital Download Fee Calculator",
    intro: "Calculate your exact Etsy seller fees, unit break-even price, and net profit for digital downloads, printables, templates, and SVGs. The calculator automatically zeroes shipping and production costs while accurately modeling Etsy’s 6.5% transaction fee, country-specific payment processing, listing fees, and optional Offsite Ads. Looking for multi-currency physical product calculations? Visit the main <a href=\"/\">Etsy profit calculator</a> or browse the <a href=\"/fees/\">Etsy fees guide</a>.",
    question: "What fees does Etsy charge on digital downloads?",
    answer: "Etsy charges the same core platform fees on digital downloads as on physical items: a $0.20 USD listing fee (renewed every 4 months or upon each sale), a 6.5% transaction fee on the download price, and country-specific payment processing (such as 3% + $0.25 in the US). If attributed to an Offsite Ad, an additional 12% or 15% advertising fee applies. Digital downloads incur no postage fees unless physical items are included.",
  },
  {
    file: "etsy-pricing-calculator.html", path: "/etsy-pricing-calculator/", code: "US", tool: "pricing",
    title: "Etsy Pricing Calculator — Calculate Item Price for Profit | ShopProfit",
    description: "Calculate the exact price to charge on Etsy to hit your target profit. Reverse pricing calculator solving backward through all 2026 Etsy fees and costs.",
    h1: "Etsy Pricing Calculator",
    intro: "Determine the exact item price to charge on Etsy to achieve your desired take-home profit. Unlike simple markup formulas that fail to account for Etsy's compounding deductions, ShopProfit uses an exact solver to calculate the required retail price backward from your target profit, production costs, shipping, and platform fees. Also explore our <a href=\"/etsy-break-even-calculator/\">break-even calculator</a> and complete <a href=\"/fees/\">Etsy fees guide</a>.",
    question: "How do I calculate what price to charge on Etsy?",
    answer: "To price an Etsy product for profit, start with your desired take-home profit and solve backward. Add your raw material costs and packaging/shipping costs. Then factor in Etsy's deductions that scale with the retail price: the 6.5% transaction fee, country payment processing (such as 3% + $0.25 in the US), statutory regulatory fees, and optional Offsite Ads (12% or 15%), plus the $0.20 listing fee. ShopProfit's pricing solver automates this reverse calculation to ensure you hit your exact profit target.",
  },
  {
    file: "etsy-break-even-calculator.html", path: "/etsy-break-even-calculator/", code: "US", tool: "break-even",
    title: "Etsy Break-Even Calculator — Find Minimum Item Price | ShopProfit",
    description: "Calculate your exact break-even price and sales volume on Etsy. Find the minimum floor price needed to cover all Etsy fees, material costs, and shipping.",
    h1: "Etsy Break-Even Calculator",
    intro: "Calculate the minimum selling price needed on Etsy to cover all platform fees, production expenses, and shipping costs with exactly $0.00 loss. Selling below your break-even floor loses money on every transaction. ShopProfit solves your exact per-order floor price and monthly volume requirements. For setting target profit margins, use our <a href=\"/etsy-pricing-calculator/\">Etsy pricing calculator</a>.",
    question: "What is an Etsy break-even price?",
    answer: "An Etsy break-even price is the absolute lowest listing price you can charge for an item such that total revenue (item price + buyer shipping) exactly equals total expenses (Etsy listing fee, 6.5% transaction fee, payment processing fee, regulatory fee, ad fees, production costs, and actual postage costs). Selling at your break-even price yields exactly $0.00 in profit; selling below it causes a financial loss on every order.",
  },
  {
    file: "etsy-offsite-ads-calculator.html", path: "/etsy-offsite-ads-calculator/", code: "US", tool: "offsite-ads",
    title: "Etsy Offsite Ads Calculator — 12% vs 15% Fee Simulator | ShopProfit",
    description: "Calculate the impact of Etsy Offsite Ads on your profit margins. Model 15% optional vs 12% mandatory fees with the official $100 per-order fee cap.",
    h1: "Etsy Offsite Ads Calculator",
    intro: "Simulate the exact impact of Etsy's 12% and 15% Offsite Ads fees on your net earnings and margins. Features a real-time comparative scenario ledger and accurately models Etsy's statutory $100 USD per-order advertising fee cap. To calculate regular non-ad sales, visit our main <a href=\"/\">Etsy profit calculator</a> or review the full <a href=\"/fees/\">Etsy fees breakdown</a>.",
    question: "How much does Etsy charge for Offsite Ads?",
    answer: "Etsy charges either 15% or 12% of the gross order total (item price + buyer shipping) when a sale is attributed to an external ad click on Google, Facebook, Instagram, or Pinterest. Shops making under $10,000 USD over the trailing 12 months pay 15% (optional); shops making $10,000 USD or more pay 12% (mandatory). Crucially, Etsy caps the maximum fee at $100 USD per attributed order.",
  },
  {
    file: "etsy-print-on-demand-calculator.html", path: "/etsy-print-on-demand-calculator/", code: "US", tool: "pod",
    title: "Etsy Print on Demand Calculator — POD Profit & Fee Calculator | ShopProfit",
    description: "Calculate your real profit margins for print-on-demand products on Etsy. Account for print provider item costs, shipping, and all Etsy fees for Printify, Printful, and Gelato.",
    h1: "Etsy Print on Demand Calculator",
    intro: "Calculate your net take-home profit and true profit margins for print-on-demand (POD) items on Etsy. Built specifically for sellers using Printify, Printful, Gelato, or Awkward Styles, this calculator models both sides of the transaction: retail revenue and Etsy fees from the buyer, plus base production charges and fulfillment shipping from your print provider. Also explore our <a href=\"/etsy-pricing-calculator/\">Etsy pricing calculator</a> and complete <a href=\"/fees/\">Etsy fees guide</a>.",
    question: "How do I calculate profit for Etsy print on demand?",
    answer: "To calculate profit for an Etsy print-on-demand item, subtract both Etsy platform fees and your print provider fulfillment costs from total customer revenue. Total customer revenue equals listing price plus shipping charged to the buyer. Deduct Etsy fees ($0.20 listing, 6.5% transaction, payment processing, and any ad fees), then deduct your print provider's base product charge (blank + printing) and provider shipping fee. What remains is your net take-home profit.",
  },
];

for (const route of routes) {
  let html = base;
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${route.title}</title>`, `${route.file} title`);
  html = replaceOnce(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${route.description}">`, `${route.file} description`);
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="https://shopprofitcalculator.com${route.path}">`, `${route.file} canonical`);
  html = replaceOnce(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${route.title}">`, `${route.file} OG title`);
  html = replaceOnce(html, /<meta property="og:site_name" content="[^"]*">/, `<meta property="og:site_name" content="ShopProfit">`, `${route.file} OG site name`);
  html = replaceOnce(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${route.description}">`, `${route.file} OG description`);
  html = replaceOnce(html, /<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="https://shopprofitcalculator.com${route.path}">`, `${route.file} OG URL`);
  html = replaceOnce(html, /<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="https://shopprofitcalculator.com/social-preview.png">`, `${route.file} OG image`);
  html = replaceOnce(html, /<meta name="twitter:card" content="[^"]*">/, `<meta name="twitter:card" content="summary_large_image">`, `${route.file} Twitter card`);
  html = replaceOnce(html, /<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${route.title}">`, `${route.file} Twitter title`);
  html = replaceOnce(html, /<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${route.description}">`, `${route.file} Twitter description`);
  html = replaceOnce(html, /<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="https://shopprofitcalculator.com/social-preview.png">`, `${route.file} Twitter image`);
  html = replaceOnce(html, /<p class="hero-index">[\s\S]*?<\/p>/, `<p class="hero-index">SHOPPROFIT / ${route.code} &nbsp;—&nbsp; FREE ${route.title.replace(" — ShopProfit", "").toUpperCase()}</p>`, `${route.file} index`);
  html = replaceOnce(html, /<h1 id="calculator-heading">[\s\S]*?<\/h1>/, `<h1 id="calculator-heading">${route.h1}</h1>`, `${route.file} calculator heading`);
  html = replaceOnce(html, /<p class="hero-description">[\s\S]*?<\/p>/, `<p class="hero-description">${route.intro}</p>`, `${route.file} introduction`);
  html = replaceOnce(html, /<details><summary>What fees does Etsy charge sellers\?<\/summary><p>[\s\S]*?<\/p><\/details>/, `<details><summary>${route.question}</summary><p>${route.answer}</p></details>`, `${route.file} FAQ`);
  // Inject data-route-country on <body> so JS can read it as a reliable fallback (no pathname dependency)
  html = html.replace(/<body>/, `<body data-route-country="${route.code}">`);
  // Pre-select the correct country in both dropdowns in the static HTML
  html = html.replace(/(<select class="country-nav"[^>]*>)([\s\S]*?)(<\/select>)/, (m, open, inner, close) =>
    open + inner.replace(/value="([A-Z]+)"/g, (_, c) => c === route.code ? `value="${c}" selected` : `value="${c}"`) + close);
  html = html.replace(/(<select id="country"[^>]*>)([\s\S]*?)(<\/select>)/, (m, open, inner, close) =>
    open + inner.replace(/value="([A-Z]+)"/g, (_, c) => c === route.code ? `value="${c}" selected` : `value="${c}"`) + close);

  const graphTag = html.match(/<script type="application\/ld\+json" id="structured-data">\s*([\s\S]*?)\s*<\/script>/);
  if (!graphTag) throw new Error(`Missing WebApplication schema in ${route.file}`);
  const graph = JSON.parse(graphTag[1]);
  const organization = graph["@graph"].find((node) => node["@type"] === "Organization");
  organization.logo = "https://shopprofitcalculator.com/logo-mark.svg";
  const app = graph["@graph"].find((node) => node["@type"] === "WebApplication");
  app.name = route.title.replace(" — ShopProfit", ""); app.url = `https://shopprofitcalculator.com${route.path}`; app.description = route.description;
  const crumbs = graph["@graph"].find((node) => node["@type"] === "BreadcrumbList");
  crumbs.itemListElement[1].name = app.name; crumbs.itemListElement[1].item = app.url;
  html = html.replace(graphTag[0], `<script type="application/ld+json" id="structured-data">\n${JSON.stringify(graph)}\n  </script>`);

  const faqTag = html.match(/<script type="application\/ld\+json" id="faq-structured-data">\s*([\s\S]*?)\s*<\/script>/);
  if (!faqTag) throw new Error(`Missing FAQPage schema in ${route.file}`);

  if (route.code === "UK") {
    const ukHowItWorks = `<section class="answer-formula page-width" id="how-it-works" aria-label="Etsy UK fees and calculation method">
      <article class="panel answer-panel">
        <p class="eyebrow">UK fee breakdown</p>
        <h2>How much does Etsy take from a UK sale?</h2>
        <p>For UK sellers, Etsy takes an estimated £0.16 listing fee, a 6.5% transaction fee on the full order amount (item price + buyer postage), 4% + £0.20 UK payment processing, and a 0.48% regulatory operating fee. If the order is attributed to an Offsite Ad, an additional 12% or 15% ad fee applies (capped at the $100 USD equivalent).</p>
        <p class="answer-footnote">Your exact deduction depends on sale price, postage charged to the buyer, and advertising attribution.</p>
      </article>
      <article class="panel formula-panel">
        <p class="eyebrow">Transparent methodology</p>
        <h2>How ShopProfit calculates UK profit</h2>
        <div class="formula-code" aria-label="UK Profit formulas">
          <code>gross revenue = item price + buyer postage (GBP)</code>
          <code>UK platform fees = £0.16 listing + 6.5% transaction + (4% + £0.20) processing + 0.48% regulatory + ads</code>
          <code>net profit = gross revenue − platform fees − production − postage &amp; packaging</code>
        </div>
        <p class="formula-note">Fee calculations are based on Etsy's official published fee schedule for United Kingdom sellers. UK domestic processing is modeled at 4% + £0.20; the statutory regulatory operating fee is 0.48%. VAT on seller fees, international card processing differences, and account-level adjustments are not modeled. <a href="/methodology/">Read our full methodology and calculation standards</a> or browse the <a href="/fees/">Etsy Fees Guide</a>.</p>
      </article>
    </section>`;

    const ukSellerGuides = `<section class="content-section page-width" id="seller-guides" aria-labelledby="guides-heading">
      <div class="section-heading"><div><h2 id="guides-heading">Etsy UK Seller Fee &amp; Profit Strategy</h2><p>Essential frameworks for pricing backward in GBP, absorbing UK-specific fees, and protecting take-home margins.</p></div></div>
      <div class="calculator-grid" style="align-items: stretch; margin-bottom: 24px;">
        <article class="panel input-panel">
          <p class="eyebrow">UK Pricing Strategy</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Target Pricing in GBP: How to Price Backward in the UK</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Most UK sellers guess a retail price in pounds and hope a margin remains after Etsy takes its cut. Target pricing reverses that formula: you specify the exact take-home profit you want in GBP, and calculate backward through Etsy’s tiered deductions.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Because Etsy's 6.5% transaction fee, UK payment processing (4% + £0.20), the 0.48% regulatory operating fee, and optional Offsite Ads (12% or 15%) scale with your final order total, simple linear markups consistently fall short of your profit target. ShopProfit uses an exact binary search solver to calculate the precise listing price required to hit your desired profit in pounds.</p>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Statutory Operating Fees</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">The UK Regulatory Operating Fee (0.48%): How It Adds Up</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Etsy levies a 0.48% regulatory operating fee on every sale made by a UK seller. This statutory fee was introduced to offset the operating costs of the UK Digital Services Tax.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Crucially, this 0.48% charge applies to the entire order total (item price + buyer postage). Combined with the 6.5% transaction fee and 4% payment processing, UK sellers pay a baseline variable deduction of 10.98% on every pound collected before fixed charges (£0.36 combined listing and processing) are applied.</p>
        </article>
      </div>
      <div class="calculator-grid" style="align-items: stretch;">
        <article class="panel input-panel">
          <p class="eyebrow">Advertising Economics</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Offsite Ads for UK Shops: 15% vs 12% &amp; The $100 USD Cap</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">When a shopper clicks an Etsy-funded ad on Google, Facebook, or Instagram and orders from your UK shop within 30 days, Etsy deducts an advertising fee on the full order amount (item price + buyer postage):</p>
          <ul style="padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; margin: 8px 0;">
            <li><strong>15% Fee (Optional):</strong> For UK shops with under $10,000 USD in trailing 12-month sales. Can be toggled on or off in Shop Manager.</li>
            <li><strong>12% Fee (Mandatory):</strong> For UK shops that have generated $10,000 USD or more in trailing 12-month sales. Enrolled permanently.</li>
            <li><strong>The Statutory $100 USD Cap:</strong> Etsy caps the Offsite Ads fee at $100 USD (or equivalent in GBP) per order, preventing runaway advertising costs on high-ticket UK sales.</li>
          </ul>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Postage Profitability</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Royal Mail &amp; Postage Economics: Fees Deducted from Shipping</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">A frequent surprise for new UK sellers is discovering that Etsy fees apply to postage. Etsy charges the 6.5% transaction fee, 4% processing fee, and 0.48% regulatory fee on the postage amount paid by the buyer.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">If you charge a buyer £3.85 for Royal Mail Tracked 48, Etsy deducts approximately £0.42 (10.98%) in fees from that postage. If your actual postage label costs £3.85 and packaging costs £0.65, you lose money on fulfillment unless your item price absorbs that shortfall. Always enter your true packaging and shipping costs into ShopProfit.</p>
        </article>
      </div>
    </section>`;

    const ukFaqList = `<section class="faq-section page-width" id="faq" aria-labelledby="faq-heading">
      <div class="section-heading"><div><h2 id="faq-heading">Frequently asked questions about Etsy UK fees</h2><p>Clear, verified answers for United Kingdom sellers. Browse the full <a href="/faq/">Etsy Seller FAQ</a>.</p></div></div>
      <div class="panel faq-list" id="faq-list">
        <details><summary>What Etsy fees do sellers pay in the United Kingdom?</summary><p>UK sellers pay four core platform fees on standard domestic sales: an estimated £0.16 listing fee ($0.20 USD converted), a 6.5% transaction fee on the full order amount (item price + buyer postage), UK payment processing of 4% + £0.20 per order, and a 0.48% UK regulatory operating fee. Attributed Offsite Ads may add an optional 15% or mandatory 12% fee.</p></details>
        <details><summary>What is the 0.48% UK regulatory operating fee on Etsy?</summary><p>The UK regulatory operating fee is a 0.48% charge applied to the total order value (item price plus buyer postage). Etsy introduced this fee to cover the operating costs of the UK Digital Services Tax. It is deducted automatically alongside standard transaction and processing fees.</p></details>
        <details><summary>Does Etsy charge fees on shipping and postage in the UK?</summary><p>Yes. Etsy applies the 6.5% transaction fee, 4% payment processing, and 0.48% regulatory operating fee to the entire postage amount charged to the buyer. For example, on a £3.50 shipping charge, Etsy deducts approximately £0.38 in fees.</p></details>
        <details><summary>How do Etsy Offsite Ads work for UK shops?</summary><p>If a buyer clicks an Etsy advertisement on search engines or partner networks and purchases from your shop within 30 days, Etsy charges an Offsite Ads fee on the total order value. The rate is 15% for shops with under $10,000 USD in trailing 12-month sales (which can be opted out), or 12% for shops at or above $10,000 USD (mandatory). Etsy caps this fee at $100 USD (or equivalent in GBP) per order.</p></details>
        <details><summary>How do I calculate net profit for an Etsy sale in the UK?</summary><p>Net profit is gross revenue (item price + buyer postage in GBP) minus total Etsy platform fees (listing fee, 6.5% transaction fee, 4% + £0.20 payment processing, 0.48% regulatory fee, and any ad fees), minus item production and materials costs, minus actual packaging and postage costs.</p></details>
        <details><summary>Can I calculate Etsy fees for digital downloads sold in the UK?</summary><p>Yes. Select the Digital product preset in this calculator to automatically set physical production and postage costs to £0.00. For sellers exclusively offering digital products, explore our dedicated <a href="/etsy-digital-download-fee-calculator">Etsy digital download fee calculator</a>.</p></details>
      </div>
    </section>`;

    const ukFaqs = [
      { name: "What Etsy fees do sellers pay in the United Kingdom?", text: "UK sellers pay four core platform fees on standard domestic sales: an estimated £0.16 listing fee ($0.20 USD converted), a 6.5% transaction fee on the full order amount (item price + buyer postage), UK payment processing of 4% + £0.20 per order, and a 0.48% UK regulatory operating fee. Attributed Offsite Ads may add an optional 15% or mandatory 12% fee." },
      { name: "What is the 0.48% UK regulatory operating fee on Etsy?", text: "The UK regulatory operating fee is a 0.48% charge applied to the total order value (item price plus buyer postage). Etsy introduced this fee to cover the operating costs of the UK Digital Services Tax. It is deducted automatically alongside standard transaction and processing fees." },
      { name: "Does Etsy charge fees on shipping and postage in the UK?", text: "Yes. Etsy applies the 6.5% transaction fee, 4% payment processing, and 0.48% regulatory operating fee to the entire postage amount charged to the buyer. For example, on a £3.50 shipping charge, Etsy deducts approximately £0.38 in fees." },
      { name: "How do Etsy Offsite Ads work for UK shops?", text: "If a buyer clicks an Etsy advertisement on search engines or partner networks and purchases from your shop within 30 days, Etsy charges an Offsite Ads fee on the total order value. The rate is 15% for shops with under $10,000 USD in trailing 12-month sales (which can be opted out), or 12% for shops at or above $10,000 USD (mandatory). Etsy caps this fee at $100 USD (or equivalent in GBP) per order." },
      { name: "How do I calculate net profit for an Etsy sale in the UK?", text: "Net profit is gross revenue (item price + buyer postage in GBP) minus total Etsy platform fees (listing fee, 6.5% transaction fee, 4% + £0.20 payment processing, 0.48% regulatory fee, and any ad fees), minus item production and materials costs, minus actual packaging and postage costs." },
      { name: "Can I calculate Etsy fees for digital downloads sold in the UK?", text: "Yes. Select the Digital product preset in this calculator to automatically set physical production and postage costs to £0.00. For sellers exclusively offering digital products, explore our dedicated Etsy digital download fee calculator." }
    ];

    html = replaceOnce(html, /<section class="answer-formula page-width" id="how-it-works"[\s\S]*?<\/section>/, ukHowItWorks, "UK how-it-works section");
    html = replaceOnce(html, /<section class="content-section page-width" id="seller-guides"[\s\S]*?<\/section>/, ukSellerGuides, "UK seller-guides section");
    html = replaceOnce(html, /<section class="faq-section page-width" id="faq"[\s\S]*?<\/section>/, ukFaqList, "UK faq section");
    html = html.replace(/<h2 id="fees-heading">How Etsy fees vary by country<\/h2><p>[\s\S]*?<\/p>/,
      `<h2 id="fees-heading">Etsy UK Fee Schedule &amp; International Processing Rates</h2><p>Published payment processing and statutory regulatory rates for UK shops and international destinations. Explore the full 62-country <a href="/fees/">Etsy Fees Guide</a>.</p>`);
    html = html.replace(/<p class="table-note">\* Etsy publishes some fixed charges in USD;[\s\S]*?<\/p>/,
      `<p class="table-note">* Etsy publishes some fixed charges in USD; UK listing fee is estimated at £0.16. UK domestic payment processing is 4% + £0.20 per order; the statutory UK regulatory operating fee is 0.48%. International sales may use differing processing rates. Fixed local amounts are estimates. Sales tax, VAT on seller fees, refunds, and currency-conversion charges are not modeled. For other sovereign markets, see the <a href="/fees/">global fee table</a>.</p>`);

    const ukFaqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": ukFaqs.map(q => ({
        "@type": "Question",
        "name": q.name,
        "acceptedAnswer": { "@type": "Answer", "text": q.text }
      }))
    };
    html = html.replace(faqTag[0], `<script type="application/ld+json" id="faq-structured-data">\n${JSON.stringify(ukFaqSchema)}\n  </script>`);
  } else if (route.code === "CA") {
    const caHowItWorks = `<section class="answer-formula page-width" id="how-it-works" aria-label="Etsy Canada fees and calculation method">
      <article class="panel answer-panel">
        <p class="eyebrow">Canadian fee breakdown</p>
        <h2>How much does Etsy take from a Canadian sale?</h2>
        <p>For Canadian sellers, Etsy takes an estimated $0.27 CAD listing fee, a 6.5% transaction fee on the full order amount (item price + buyer shipping), Canadian payment processing (3% + $0.25 CAD for domestic Canada and US buyer orders, or 4% + $0.25 CAD for international orders), and a 0.50% Canadian regulatory operating fee. If the order is attributed to an Offsite Ad, an additional 12% or 15% ad fee applies (capped at the $100 USD equivalent).</p>
        <p class="answer-footnote">Your exact deduction depends on sale price, shipping charged to the buyer, buyer destination, and advertising attribution.</p>
      </article>
      <article class="panel formula-panel">
        <p class="eyebrow">Transparent methodology</p>
        <h2>How ShopProfit calculates Canadian profit</h2>
        <div class="formula-code" aria-label="Canadian Profit formulas">
          <code>gross revenue = item price + buyer shipping (CAD)</code>
          <code>Canadian platform fees = $0.27 listing + 6.5% transaction + processing (3% or 4% + $0.25) + 0.50% regulatory + ads</code>
          <code>net profit = gross revenue − platform fees − production − packaging &amp; shipping</code>
        </div>
        <p class="formula-note">Fee calculations are grounded in Etsy's official published fee schedules for Canadian shops. Domestic and US buyer orders use the 3% + $0.25 CAD processing rate; international orders use 4% + $0.25 CAD. The statutory Canadian regulatory operating fee is 0.50%. Sales taxes (GST/HST/PST), currency conversion (2.5% when listing currency differs from bank deposit currency), and account-level fees are not modeled. <a href="/methodology/">Read our full methodology and calculation standards</a> or browse the <a href="/fees/">Etsy Fees Guide</a>.</p>
      </article>
    </section>`;

    const caSellerGuides = `<section class="content-section page-width" id="seller-guides" aria-labelledby="guides-heading">
      <div class="section-heading"><div><h2 id="guides-heading">Etsy Canada Seller Fee &amp; Profit Strategy</h2><p>Essential frameworks for pricing backward in CAD, absorbing Canadian-specific fees, and protecting take-home margins.</p></div></div>
      <div class="calculator-grid" style="align-items: stretch; margin-bottom: 24px;">
        <article class="panel input-panel">
          <p class="eyebrow">Canadian Pricing Strategy</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Target Pricing in CAD: How to Price Backward in Canada</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Most Canadian sellers guess a retail price in Canadian Dollars and hope a healthy margin remains after deductions. Target pricing reverses that formula: you specify the exact take-home profit you want in CAD, and calculate backward through Etsy’s tiered deductions.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Because Etsy's 6.5% transaction fee, Canadian payment processing (3% + $0.25 CAD domestic/US or 4% + $0.25 intl), the 0.50% regulatory operating fee, and optional Offsite Ads (12% or 15%) scale with your final order total, simple linear markups consistently fall short of your profit target. ShopProfit uses an exact binary search solver to calculate the precise listing price required to hit your desired profit in Canadian Dollars.</p>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Statutory Operating Fees</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">The Canadian Regulatory Operating Fee (0.50%): How It Adds Up</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Etsy levies a 0.50% regulatory operating fee on every sale completed by a Canadian shop. This statutory fee was introduced to offset the operating costs of digital services regulations in Canada.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Crucially, this 0.50% charge applies to the entire order total (item price + buyer shipping). Combined with the 6.5% transaction fee and standard 3% domestic/US payment processing, Canadian sellers pay a baseline variable deduction of 10.00% on sales before fixed charges ($0.52 combined listing and processing) are applied.</p>
        </article>
      </div>
      <div class="calculator-grid" style="align-items: stretch;">
        <article class="panel input-panel">
          <p class="eyebrow">Cross-Border Economics</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Domestic vs. US vs. International Payment Processing</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">A distinctive feature of Etsy's Canadian fee schedule is that Etsy applies the lower domestic processing rate to both Canadian domestic orders and orders from US buyers:</p>
          <ul style="padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; margin: 8px 0;">
            <li><strong>Domestic &amp; US Orders:</strong> 3% + $0.25 CAD. Orders from American buyers are treated with the domestic processing rate.</li>
            <li><strong>International Orders:</strong> 4% + $0.25 CAD for buyers located outside Canada and the United States (e.g., UK, Europe, Australia).</li>
            <li><strong>Currency Conversion (2.5%):</strong> If your shop lists items in USD while your bank account receives CAD payouts, Etsy assesses an additional 2.5% currency conversion fee on the converted deposit amount.</li>
          </ul>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Fulfillment Economics</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Canada Post &amp; Shipping Economics: Fees Deducted from Shipping</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">A frequent surprise for new Canadian sellers is discovering that Etsy fees apply to shipping revenue. Etsy charges the 6.5% transaction fee, payment processing fee (3% or 4%), and 0.50% regulatory fee on the postage amount paid by the buyer.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">If you charge a buyer $16 CAD for Canada Post delivery, Etsy deducts approximately $1.60 in platform fees directly from that shipping charge. If your actual carrier postage costs $16 and packaging materials cost $2, you lose money on shipping unless your item price absorbs that fulfillment deduction. Always enter your true packaging and shipping costs into ShopProfit.</p>
        </article>
      </div>
    </section>`;

    const caFaqList = `<section class="faq-section page-width" id="faq" aria-labelledby="faq-heading">
      <div class="section-heading"><div><h2 id="faq-heading">Frequently asked questions about Etsy Canada fees</h2><p>Clear, verified answers for Canadian sellers. Browse the full <a href="/faq/">Etsy Seller FAQ</a>.</p></div></div>
      <div class="panel faq-list" id="faq-list">
        <details><summary>What fees does Etsy charge sellers in Canada?</summary><p>Canadian sellers pay four core platform fees on standard orders: an estimated $0.27 CAD listing fee ($0.20 USD converted), a 6.5% transaction fee on the order total (item price + buyer shipping), Canadian payment processing of 3% + $0.25 CAD (for Canadian and US buyers) or 4% + $0.25 CAD (for international buyers), and a 0.50% Canadian regulatory operating fee. Attributed Offsite Ads may add an optional 15% or mandatory 12% advertising fee.</p></details>
        <details><summary>What is the 0.50% Canadian regulatory operating fee on Etsy?</summary><p>The Canadian regulatory operating fee is a 0.50% charge applied to the total order value (item price plus buyer shipping). Etsy introduced this fee to cover the operating costs associated with digital services regulations in Canada. It is deducted automatically alongside standard transaction and processing fees.</p></details>
        <details><summary>How does Etsy payment processing work for Canadian sellers?</summary><p>Etsy charges Canadian sellers 3% + $0.25 CAD for orders from buyers in Canada and the United States. For orders from buyers in any other country, the processing rate is 4% + $0.25 CAD. If you list items in a currency other than Canadian Dollars, Etsy also charges a 2.5% currency conversion fee on your bank deposit.</p></details>
        <details><summary>Does Etsy charge fees on shipping in Canada?</summary><p>Yes. Etsy applies the 6.5% transaction fee, payment processing fee (3% domestic/US, 4% international), and 0.50% regulatory operating fee to the entire shipping amount paid by the buyer. For example, on a $15 CAD shipping charge, Etsy deducts approximately $1.50 in fees.</p></details>
        <details><summary>How do Etsy Offsite Ads work for Canadian shops?</summary><p>If a buyer clicks an Etsy advertisement on search engines or partner networks and purchases from your shop within 30 days, Etsy charges an Offsite Ads fee on the total order value. The rate is 15% for shops with under $10,000 USD in trailing 12-month sales (which can be opted out), or 12% for shops at or above $10,000 USD (mandatory). Etsy caps this fee at $100 USD (or equivalent in CAD) per order.</p></details>
        <details><summary>Can I calculate Etsy fees for digital downloads in Canada?</summary><p>Yes. Select the Digital product preset in this calculator to automatically set physical production and shipping costs to $0.00 CAD. For sellers offering printables, templates, or digital downloads, explore our dedicated <a href="/etsy-digital-download-fee-calculator">Etsy digital download fee calculator</a>.</p></details>
      </div>
    </section>`;

    const caFaqs = [
      { name: "What fees does Etsy charge sellers in Canada?", text: "Canadian sellers pay four core platform fees on standard orders: an estimated $0.27 CAD listing fee ($0.20 USD converted), a 6.5% transaction fee on the order total (item price + buyer shipping), Canadian payment processing of 3% + $0.25 CAD (for Canadian and US buyers) or 4% + $0.25 CAD (for international buyers), and a 0.50% Canadian regulatory operating fee. Attributed Offsite Ads may add an optional 15% or mandatory 12% advertising fee." },
      { name: "What is the 0.50% Canadian regulatory operating fee on Etsy?", text: "The Canadian regulatory operating fee is a 0.50% charge applied to the total order value (item price plus buyer shipping). Etsy introduced this fee to cover the operating costs associated with digital services regulations in Canada. It is deducted automatically alongside standard transaction and processing fees." },
      { name: "How does Etsy payment processing work for Canadian sellers?", text: "Etsy charges Canadian sellers 3% + $0.25 CAD for orders from buyers in Canada and the United States. For orders from buyers in any other country, the processing rate is 4% + $0.25 CAD. If you list items in a currency other than Canadian Dollars, Etsy also charges a 2.5% currency conversion fee on your bank deposit." },
      { name: "Does Etsy charge fees on shipping in Canada?", text: "Yes. Etsy applies the 6.5% transaction fee, payment processing fee (3% domestic/US, 4% international), and 0.50% regulatory operating fee to the entire shipping amount paid by the buyer. For example, on a $15 CAD shipping charge, Etsy deducts approximately $1.50 in fees." },
      { name: "How do Etsy Offsite Ads work for Canadian shops?", text: "If a buyer clicks an Etsy advertisement on search engines or partner networks and purchases from your shop within 30 days, Etsy charges an Offsite Ads fee on the total order value. The rate is 15% for shops with under $10,000 USD in trailing 12-month sales (which can be opted out), or 12% for shops at or above $10,000 USD (mandatory). Etsy caps this fee at $100 USD (or equivalent in CAD) per order." },
      { name: "Can I calculate Etsy fees for digital downloads in Canada?", text: "Yes. Select the Digital product preset in this calculator to automatically set physical production and shipping costs to $0.00 CAD. For sellers offering printables, templates, or digital downloads, explore our dedicated Etsy digital download fee calculator." }
    ];

    html = replaceOnce(html, /<section class="answer-formula page-width" id="how-it-works"[\s\S]*?<\/section>/, caHowItWorks, "CA how-it-works section");
    html = replaceOnce(html, /<section class="content-section page-width" id="seller-guides"[\s\S]*?<\/section>/, caSellerGuides, "CA seller-guides section");
    html = replaceOnce(html, /<section class="faq-section page-width" id="faq"[\s\S]*?<\/section>/, caFaqList, "CA faq section");
    html = html.replace(/<h2 id="fees-heading">How Etsy fees vary by country<\/h2><p>[\s\S]*?<\/p>/,
      `<h2 id="fees-heading">Etsy Canada Fee Schedule &amp; International Processing Rates</h2><p>Published payment processing and statutory regulatory rates for Canadian shops and international export destinations. Explore the full 62-country <a href="/fees/">Etsy Fees Guide</a>.</p>`);
    html = html.replace(/<p class="table-note">\* Etsy publishes some fixed charges in USD;[\s\S]*?<\/p>/,
      `<p class="table-note">* Etsy publishes some fixed charges in USD; Canadian listing fee is estimated at $0.27 CAD. Canadian domestic payment processing is 3% + $0.25 CAD for domestic and US orders, or 4% + $0.25 CAD for international orders. The statutory Canadian regulatory operating fee is 0.50%. Sales tax, refunds, and currency-conversion charges (2.5% when listing currency differs from bank payout currency) are not modeled. For other sovereign markets, see the <a href="/fees/">global fee table</a>.</p>`);

    const caFaqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": caFaqs.map(q => ({
        "@type": "Question",
        "name": q.name,
        "acceptedAnswer": { "@type": "Answer", "text": q.text }
      }))
    };
    html = html.replace(faqTag[0], `<script type="application/ld+json" id="faq-structured-data">\n${JSON.stringify(caFaqSchema)}\n  </script>`);
  } else if (route.code === "AU") {
    const auHowItWorks = `<section class="answer-formula page-width" id="how-it-works" aria-label="Etsy Australia fees and calculation method">
      <article class="panel answer-panel">
        <p class="eyebrow">Australian fee breakdown</p>
        <h2>How much does Etsy take from an Australian sale?</h2>
        <p>For Australian sellers, Etsy takes an estimated $0.28 AUD listing fee, a 6.5% transaction fee on the full order amount (item price + buyer shipping), and Australian payment processing (3% + A$0.25 for domestic Australian buyers, or 4% + A$0.25 for international buyers). Australia has no separate regulatory operating fee. If the order is attributed to an Offsite Ad, an additional 12% or 15% ad fee applies (capped at the $100 USD equivalent).</p>
        <p class="answer-footnote">Your exact deduction depends on item price, shipping charged to the buyer, buyer location (domestic vs international), and advertising attribution.</p>
      </article>
      <article class="panel formula-panel">
        <p class="eyebrow">Transparent methodology</p>
        <h2>How ShopProfit calculates Australian profit</h2>
        <div class="formula-code" aria-label="Australian Profit formulas">
          <code>gross revenue = item price + buyer shipping (AUD)</code>
          <code>Australian platform fees = $0.28 listing + 6.5% transaction + processing (3% or 4% + A$0.25) + ads</code>
          <code>net profit = gross revenue − platform fees − production − packaging &amp; shipping</code>
        </div>
        <p class="formula-note">Fee calculations are grounded in Etsy's official published fee schedules for Australian shops. Domestic Australian buyer orders use the 3% + A$0.25 processing rate; international orders use 4% + A$0.25. Australia does not have a statutory regulatory operating fee (0.00%). Goods and Services Tax (GST), currency conversion (2.5% when listing currency differs from bank deposit currency), and account-level fees are not modeled. <a href="/methodology/">Read our full methodology and calculation standards</a> or browse the <a href="/fees/">Etsy Fees Guide</a>.</p>
      </article>
    </section>`;

    const auSellerGuides = `<section class="content-section page-width" id="seller-guides" aria-labelledby="guides-heading">
      <div class="section-heading"><div><h2 id="guides-heading">Etsy Australia Seller Fee &amp; Profit Strategy</h2><p>Essential frameworks for pricing backward in AUD, understanding domestic vs international rates, and protecting take-home margins.</p></div></div>
      <div class="calculator-grid" style="align-items: stretch; margin-bottom: 24px;">
        <article class="panel input-panel">
          <p class="eyebrow">Australian Pricing Strategy</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Target Pricing in AUD: How to Price Backward in Australia</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Most Australian sellers pick an arbitrary retail price in AUD and discover too late that their profit has eroded. Target pricing reverses that formula: you specify the exact take-home profit you need in Australian Dollars, and calculate backward through Etsy’s tiered deductions.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Because Etsy's 6.5% transaction fee, Australian payment processing (3% + A$0.25 domestic or 4% + A$0.25 intl), and optional Offsite Ads (12% or 15%) scale with your final order total, simple linear markups consistently fall short of your profit target. ShopProfit uses an exact binary search solver to calculate the precise listing price required to hit your desired profit in Australian Dollars.</p>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Statutory Fee Clarity</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Regulatory Operating Fees: Why Australia Pays 0% on Etsy</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Unlike sellers in the United Kingdom (0.48%), Canada (0.50%), France (0.40%), or Spain (0.40%), Etsy does not charge a separate regulatory operating fee to shops in Australia. Australia is not subject to Etsy's statutory regulatory operating fee surcharge.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">This means your baseline variable platform cost on domestic Australian orders remains 9.5% (6.5% transaction + 3% domestic processing), rather than the higher blended rates seen in Europe and the UK. Knowing your true baseline rate prevents unnecessary over-padding or confusing deductions in your unit economics.</p>
        </article>
      </div>
      <div class="calculator-grid" style="align-items: stretch;">
        <article class="panel input-panel">
          <p class="eyebrow">Cross-Border Economics</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Domestic vs. International Payment Processing (3% vs 4%)</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Etsy distinguishes payment processing fees for Australian sellers depending on whether the buyer is located within Australia or overseas:</p>
          <ul style="padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; margin: 8px 0;">
            <li><strong>Domestic Australian Orders:</strong> 3% + A$0.25 for sales to buyers within Australia.</li>
            <li><strong>International Orders:</strong> 4% + A$0.25 for orders shipped to overseas buyers (e.g., US, UK, Canada, New Zealand, Europe).</li>
            <li><strong>Currency Conversion (2.5%):</strong> If you list items in USD or EUR while having an Australian bank account (AUD payouts), Etsy charges a 2.5% currency conversion fee on the converted payout amount. Keep your listing currency in AUD to avoid FX charges.</li>
          </ul>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Fulfillment Economics</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Australia Post &amp; Shipping Economics: Fees Deducted from Shipping</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Australian distances and high international export postage make shipping economics crucial on Etsy. Etsy levies its 6.5% transaction fee and payment processing (3% domestic or 4% international) on the total postage amount paid by the buyer.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">If you charge a domestic buyer $12 AUD for Australia Post Parcel Post, Etsy deducts approximately $1.14 in platform fees from that postage. If shipping internationally to the US at $30 AUD postage, Etsy deducts over $3.15 from the shipping charge. If you don't factor these deductions into your pricing, fulfillment will eat directly into your product margin.</p>
        </article>
      </div>
    </section>`;

    const auFaqList = `<section class="faq-section page-width" id="faq" aria-labelledby="faq-heading">
      <div class="section-heading"><div><h2 id="faq-heading">Frequently asked questions about Etsy Australia fees</h2><p>Clear, verified answers for Australian sellers. Browse the full <a href="/faq/">Etsy Seller FAQ</a>.</p></div></div>
      <div class="panel faq-list" id="faq-list">
        <details><summary>What fees does Etsy charge sellers in Australia?</summary><p>Australian sellers pay three core platform fees on domestic sales: an estimated $0.28 AUD listing fee ($0.20 USD converted), a 6.5% transaction fee on the order total (item price + buyer shipping), and Australian payment processing of 3% + A$0.25 (for domestic Australian buyers) or 4% + A$0.25 (for international buyers). Australia has no separate regulatory operating fee. Attributed Offsite Ads may add an optional 15% or mandatory 12% advertising fee.</p></details>
        <details><summary>Does Etsy charge a regulatory operating fee in Australia?</summary><p>No. Etsy does not charge a regulatory operating fee in Australia. While sellers in countries like the UK (0.48%) and Canada (0.50%) pay statutory operating fees to cover local digital regulations, Australia is not subject to this fee (0.00%).</p></details>
        <details><summary>How does Etsy payment processing work for Australian sellers?</summary><p>Etsy charges Australian sellers 3% + A$0.25 for orders from buyers within Australia. For orders from buyers outside Australia, the processing rate is 4% + A$0.25. If you list items in a currency different from your Australian bank account's currency (AUD), Etsy also assesses a 2.5% currency conversion fee.</p></details>
        <details><summary>Does Etsy charge fees on shipping in Australia?</summary><p>Yes. Etsy applies the 6.5% transaction fee and payment processing (3% domestic or 4% international) to the entire shipping amount paid by the buyer. For instance, on a $15 AUD Australia Post shipping fee, Etsy deducts approximately $1.43 in platform fees.</p></details>
        <details><summary>How do Etsy Offsite Ads work for Australian shops?</summary><p>If a shopper clicks an Etsy-placed advertisement on Google, Facebook, or partner networks and purchases from your shop within 30 days, Etsy charges an Offsite Ads fee on the order total. The fee is 15% for shops with under $10,000 USD in trailing 12-month sales (optional, can be disabled), or 12% for shops earning $10,000 USD or more (mandatory). Etsy caps this fee at $100 USD (equivalent in AUD) per attributed order.</p></details>
        <details><summary>Can I calculate Etsy fees for digital downloads in Australia?</summary><p>Yes. Select the Digital product preset in this calculator to automatically set physical production and shipping costs to $0.00 AUD. If you sell digital printables, templates, or planners, check out our dedicated <a href="/etsy-digital-download-fee-calculator">Etsy digital download fee calculator</a>.</p></details>
      </div>
    </section>`;

    const auFaqs = [
      { name: "What fees does Etsy charge sellers in Australia?", text: "Australian sellers pay three core platform fees on domestic sales: an estimated $0.28 AUD listing fee ($0.20 USD converted), a 6.5% transaction fee on the order total (item price + buyer shipping), and Australian payment processing of 3% + A$0.25 (for domestic Australian buyers) or 4% + A$0.25 (for international buyers). Australia has no separate regulatory operating fee. Attributed Offsite Ads may add an optional 15% or mandatory 12% advertising fee." },
      { name: "Does Etsy charge a regulatory operating fee in Australia?", text: "No. Etsy does not charge a regulatory operating fee in Australia. While sellers in countries like the UK (0.48%) and Canada (0.50%) pay statutory operating fees to cover local digital regulations, Australia is not subject to this fee (0.00%)." },
      { name: "How does Etsy payment processing work for Australian sellers?", text: "Etsy charges Australian sellers 3% + A$0.25 for orders from buyers within Australia. For orders from buyers outside Australia, the processing rate is 4% + A$0.25. If you list items in a currency different from your Australian bank account's currency (AUD), Etsy also assesses a 2.5% currency conversion fee." },
      { name: "Does Etsy charge fees on shipping in Australia?", text: "Yes. Etsy applies the 6.5% transaction fee and payment processing (3% domestic or 4% international) to the entire shipping amount paid by the buyer. For instance, on a $15 AUD Australia Post shipping fee, Etsy deducts approximately $1.43 in platform fees." },
      { name: "How do Etsy Offsite Ads work for Australian shops?", text: "If a shopper clicks an Etsy-placed advertisement on Google, Facebook, or partner networks and purchases from your shop within 30 days, Etsy charges an Offsite Ads fee on the order total. The fee is 15% for shops with under $10,000 USD in trailing 12-month sales (optional, can be disabled), or 12% for shops earning $10,000 USD or more (mandatory). Etsy caps this fee at $100 USD (equivalent in AUD) per attributed order." },
      { name: "Can I calculate Etsy fees for digital downloads in Australia?", text: "Yes. Select the Digital product preset in this calculator to automatically set physical production and shipping costs to $0.00 AUD. If you sell digital printables, templates, or planners, check out our dedicated Etsy digital download fee calculator." }
    ];

    html = replaceOnce(html, /<section class="answer-formula page-width" id="how-it-works"[\s\S]*?<\/section>/, auHowItWorks, "AU how-it-works section");
    html = replaceOnce(html, /<section class="content-section page-width" id="seller-guides"[\s\S]*?<\/section>/, auSellerGuides, "AU seller-guides section");
    html = replaceOnce(html, /<section class="faq-section page-width" id="faq"[\s\S]*?<\/section>/, auFaqList, "AU faq section");
    html = html.replace(/<h2 id="fees-heading">How Etsy fees vary by country<\/h2><p>[\s\S]*?<\/p>/,
      `<h2 id="fees-heading">Etsy Australia Fee Schedule &amp; International Processing Rates</h2><p>Published payment processing and fee rates for Australian shops and export markets. Explore the full 62-country <a href="/fees/">Etsy Fees Guide</a>.</p>`);
    html = html.replace(/<p class="table-note">\* Etsy publishes some fixed charges in USD;[\s\S]*?<\/p>/,
      `<p class="table-note">* Etsy publishes some fixed charges in USD; Australian listing fee is estimated at $0.28 AUD. Australian domestic payment processing is 3% + A$0.25 for domestic orders, or 4% + A$0.25 for international orders. Australia has no separate regulatory operating fee (0.00%). Goods and Services Tax (GST), refunds, and currency-conversion charges (2.5% when listing currency differs from bank payout currency) are not modeled. For other sovereign markets, see the <a href="/fees/">global fee table</a>.</p>`);

    const auFaqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": auFaqs.map(q => ({
        "@type": "Question",
        "name": q.name,
        "acceptedAnswer": { "@type": "Answer", "text": q.text }
      }))
    };
    html = html.replace(faqTag[0], `<script type="application/ld+json" id="faq-structured-data">\n${JSON.stringify(auFaqSchema)}\n  </script>`);
  } else if (route.file === "etsy-digital-download-fee-calculator.html") {
    const digitalHowItWorks = `<section class="answer-formula page-width" id="how-it-works" aria-label="Etsy digital download fees and calculation method">
      <article class="panel answer-panel">
        <p class="eyebrow">Digital download fee breakdown</p>
        <h2>How much does Etsy take from a digital download sale?</h2>
        <p>For Etsy digital downloads, Etsy charges a $0.20 USD listing fee (which renews upon every sale or every 4 months), a 6.5% transaction fee on the download price, and country-specific payment processing (such as 3% + $0.25 in the US, 4% + £0.20 in the UK, 3% + $0.25 CAD in Canada, or 3% + A$0.25 in Australia). If the sale is attributed to an Etsy Offsite Ad, an additional 12% or 15% fee applies (capped at the $100 USD equivalent). Any statutory regulatory operating fees (e.g., 0.48% UK, 0.50% Canada) also apply.</p>
        <p class="answer-footnote">While digital downloads eliminate physical postage and material expenses, Etsy platform fees apply to every sale. Per-unit design software, mockups, or commercial licenses can be entered as production costs.</p>
      </article>
      <article class="panel formula-panel">
        <p class="eyebrow">Transparent methodology</p>
        <h2>How ShopProfit calculates digital download profit</h2>
        <div class="formula-code" aria-label="Digital download profit formulas">
          <code>gross revenue = digital download price (shipping = $0.00)</code>
          <code>platform fees = $0.20 listing + 6.5% transaction + payment processing + ads</code>
          <code>net profit = gross revenue − platform fees − digital creation &amp; software costs</code>
        </div>
        <p class="formula-note">Fee calculations are grounded in Etsy's official published fee schedules for digital products. The preset automatically sets physical production, packaging, and shipping costs to $0.00, while leaving input fields open for sellers who track per-unit software, mockup, or commercial license amortizations. Sales tax/VAT (which Etsy collects and remits directly in most jurisdictions), currency conversion (2.5% when listing currency differs from bank deposit currency), and shop-level overhead are not deducted per-item. <a href="/methodology/">Read our full methodology and calculation standards</a> or browse the <a href="/fees/">Etsy Fees Guide</a>.</p>
      </article>
    </section>`;

    const digitalSellerGuides = `<section class="content-section page-width" id="seller-guides" aria-labelledby="guides-heading">
      <div class="section-heading"><div><h2 id="guides-heading">Etsy Digital Download Fee &amp; Profit Strategy</h2><p>Essential frameworks for pricing digital printables, avoiding fixed-fee margin erosion, and modeling net take-home.</p></div></div>
      <div class="calculator-grid" style="align-items: stretch; margin-bottom: 24px;">
        <article class="panel input-panel">
          <p class="eyebrow">Digital Pricing Strategy</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">How to Price Etsy Digital Downloads After Fees</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Many digital creators price files arbitrarily at $2 or $3 without factoring in how compounding Etsy deductions erode low-ticket sales. Target pricing reverses that formula: you define your desired net profit per download, and calculate backward through Etsy’s tiered deductions.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Because Etsy's 6.5% transaction fee, country-specific payment processing percentage, and optional Offsite Ads (12% or 15%) scale with your retail price alongside flat fixed fees ($0.20 listing + $0.25 US processing), simple linear markups consistently fall short of your profit target. ShopProfit uses an exact binary search solver to calculate the precise listing price required to hit your target profit.</p>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Unit Margin Economics</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Etsy Digital Product Profit Margins: The Low-Ticket Trap</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Fixed platform charges create disproportionately high fee drag on low-priced digital downloads. In the US, every order incurs a $0.20 listing fee and a $0.25 fixed processing fee ($0.45 in combined fixed fees):</p>
          <ul style="padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; margin: 8px 0;">
            <li><strong>$2.00 SVG Cut File:</strong> The $0.45 in fixed fees alone consumes 22.5% of revenue. With 6.5% transaction ($0.13) and 3% processing ($0.06), total fees reach $0.64 (32.0% platform deduction), leaving only $1.36.</li>
            <li><strong>$15.00 Planner Template:</strong> That same $0.45 fixed fee represents only 3.0% of revenue. Total fees are $1.88 (12.5% platform deduction), leaving $13.12 take-home profit.</li>
          </ul>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">To maximize margins on Etsy, digital sellers should bundle low-cost assets into higher-value collections ($10 to $20) rather than selling single files at extreme micro-prices.</p>
        </article>
      </div>
      <div class="calculator-grid" style="align-items: stretch; margin-bottom: 24px;">
        <article class="panel input-panel">
          <p class="eyebrow">Advertising Economics</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Etsy Offsite Ads on Digital Downloads (15% vs. 12% &amp; The $100 Cap)</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">When a shopper discovers your digital listing via an Etsy-placed advertisement on Google, Pinterest, or Facebook and purchases within 30 days, Etsy deducts an advertising fee:</p>
          <ul style="padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; margin: 8px 0;">
            <li><strong>15% Fee (Optional):</strong> For shops under $10,000 USD in trailing 12-month sales. Can be disabled in Shop Manager.</li>
            <li><strong>12% Fee (Mandatory):</strong> For shops at or above $10,000 USD in trailing 12-month sales. Enrolled permanently.</li>
            <li><strong>The $100 Order Cap:</strong> Etsy caps the Offsite Ads fee at $100 USD (or local equivalent) per order. For high-ticket commercial digital licenses or full template bundles, your ad fee never exceeds this ceiling.</li>
          </ul>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Business Model Comparison</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Digital Downloads vs. Physical Etsy Products: The Economic Difference</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Selling digital products on Etsy offers distinct operational and margin advantages over physical commerce, but platform fee rules apply identically:</p>
          <ul style="padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; margin: 8px 0;">
            <li><strong>Zero Shipping &amp; Postage Deductions:</strong> On physical goods, Etsy levies 6.5% transaction and payment processing fees on buyer shipping revenue. Digital downloads have $0 shipping, eliminating postage fee drag entirely.</li>
            <li><strong>Zero Marginal Production Costs:</strong> Physical products consume materials and labor on every unit sold. Once created, a digital file delivers infinitely at zero reproduction cost.</li>
            <li><strong>Upfront Sunk Costs:</strong> Digital sellers must amortize software subscriptions (Adobe Creative Cloud, Canva Pro), font/asset commercial licenses, and creation time rather than per-order raw materials.</li>
          </ul>
        </article>
      </div>
      <div class="calculator-grid" style="align-items: stretch;">
        <article class="panel input-panel" style="grid-column: 1 / -1;">
          <p class="eyebrow">Real-World Benchmarks</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Realistic Digital Download Economics Across Product Types</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Here is how standard Etsy fees (listing, 6.5% transaction, and US 3% + $0.25 payment processing) affect typical digital product price tiers:</p>
          <div class="table-scroll" style="margin-top: 12px;">
            <table class="scenario-table" style="font-size: 12px;">
              <thead>
                <tr>
                  <th scope="col">Product Example</th>
                  <th scope="col">Sale Price</th>
                  <th scope="col">Etsy Platform Fees</th>
                  <th scope="col">Effective Fee %</th>
                  <th scope="col">Net Take-Home</th>
                  <th scope="col">Profit Margin</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">SVG Cut File / Clipart</th>
                  <td>$3.00</td>
                  <td>$0.74</td>
                  <td>24.7%</td>
                  <td>$2.26</td>
                  <td>75.3%</td>
                </tr>
                <tr>
                  <th scope="row">Digital Art Print / Printable</th>
                  <td>$5.00</td>
                  <td>$0.93</td>
                  <td>18.6%</td>
                  <td>$4.07</td>
                  <td>81.4%</td>
                </tr>
                <tr>
                  <th scope="row">Editable Invitation Template</th>
                  <td>$8.00</td>
                  <td>$1.21</td>
                  <td>15.1%</td>
                  <td>$6.79</td>
                  <td>84.9%</td>
                </tr>
                <tr>
                  <th scope="row">Digital Planner Bundle</th>
                  <td>$15.00</td>
                  <td>$1.88</td>
                  <td>12.5%</td>
                  <td>$13.12</td>
                  <td>87.5%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p style="color: var(--muted); font-size: 12px; margin-top: 8px;">Figures assume standard domestic US processing without Offsite Ads attribution. For international currency rates or physical goods, see our <a href="/etsy-fee-calculator-uk">UK fee calculator</a>, <a href="/etsy-fee-calculator-canada">Canada fee calculator</a>, or <a href="/etsy-fee-calculator-australia">Australia fee calculator</a>.</p>
        </article>
      </div>
    </section>`;

    const digitalFaqList = `<section class="faq-section page-width" id="faq" aria-labelledby="faq-heading">
      <div class="section-heading"><div><h2 id="faq-heading">Frequently asked questions about Etsy digital download fees</h2><p>Clear, verified answers for digital creators. Browse the full <a href="/faq/">Etsy Seller FAQ</a>.</p></div></div>
      <div class="panel faq-list" id="faq-list">
        <details><summary>What fees does Etsy charge on digital downloads?</summary><p>Etsy charges the same core platform fees on digital downloads as on physical items: a $0.20 USD listing fee (renewed every 4 months or upon each sale), a 6.5% transaction fee on the download price, and country-specific payment processing (such as 3% + $0.25 in the US). If attributed to an Offsite Ad, an additional 12% or 15% advertising fee applies. Digital downloads incur no shipping fees unless physical items are included.</p></details>
        <details><summary>Does Etsy charge transaction fees on digital products?</summary><p>Yes. Etsy charges its standard 6.5% transaction fee on the digital product's sale price. Because digital items typically have $0 shipping, the 6.5% applies solely to the item price.</p></details>
        <details><summary>Do Etsy payment processing fees apply to digital downloads?</summary><p>Yes. Etsy Payments processes buyer payments for all digital downloads, charging a percentage plus a fixed flat fee per transaction depending on your bank country (e.g., 3% + $0.25 in the US, 4% + £0.20 in the UK, 3% + $0.25 CAD in Canada, 3% + A$0.25 in Australia).</p></details>
        <details><summary>Do Offsite Ads fees apply to Etsy digital downloads?</summary><p>Yes. If a buyer clicks an Etsy advertisement on external platforms (Google, Facebook, Instagram, Pinterest) and buys your digital download within 30 days, Etsy charges an Offsite Ads fee (15% for shops under $10k annual sales, 12% mandatory for shops at or above $10k). The fee is capped at $100 USD per order.</p></details>
        <details><summary>How should I price a digital download after Etsy fees?</summary><p>To price a digital download profitably, work backward from your desired take-home profit rather than guessing a price. Account for Etsy's fixed fees ($0.20 listing + $0.25 processing = $0.45 minimum in the US), 6.5% transaction fee, variable processing percentage, and any advertising. For low-ticket items under $5, consider bundling multiple designs to dilute the impact of fixed fees.</p></details>
        <details><summary>Can I calculate the break-even price for an Etsy digital product?</summary><p>Yes. Using ShopProfit's break-even mode, you can calculate the minimum selling price needed to cover all Etsy fees and per-unit digital creation or licensing expenses. With zero production and shipping costs, the break-even price represents the minimum price where revenue exactly covers Etsy platform fees.</p></details>
      </div>
    </section>`;

    const digitalFaqs = [
      { name: "What fees does Etsy charge on digital downloads?", text: "Etsy charges the same core platform fees on digital downloads as on physical items: a $0.20 USD listing fee (renewed every 4 months or upon each sale), a 6.5% transaction fee on the download price, and country-specific payment processing (such as 3% + $0.25 in the US). If attributed to an Offsite Ad, an additional 12% or 15% advertising fee applies. Digital downloads incur no shipping fees unless physical items are included." },
      { name: "Does Etsy charge transaction fees on digital products?", text: "Yes. Etsy charges its standard 6.5% transaction fee on the digital product's sale price. Because digital items typically have $0 shipping, the 6.5% applies solely to the item price." },
      { name: "Do Etsy payment processing fees apply to digital downloads?", text: "Yes. Etsy Payments processes buyer payments for all digital downloads, charging a percentage plus a fixed flat fee per transaction depending on your bank country (e.g., 3% + $0.25 in the US, 4% + £0.20 in the UK, 3% + $0.25 CAD in Canada, 3% + A$0.25 in Australia)." },
      { name: "Do Offsite Ads fees apply to Etsy digital downloads?", text: "Yes. If a buyer clicks an Etsy advertisement on external platforms (Google, Facebook, Instagram, Pinterest) and buys your digital download within 30 days, Etsy charges an Offsite Ads fee (15% for shops under $10k annual sales, 12% mandatory for shops at or above $10k). The fee is capped at $100 USD per order." },
      { name: "How should I price a digital download after Etsy fees?", text: "To price a digital download profitably, work backward from your desired take-home profit rather than guessing a price. Account for Etsy's fixed fees ($0.20 listing + $0.25 processing = $0.45 minimum in the US), 6.5% transaction fee, variable processing percentage, and any advertising. For low-ticket items under $5, consider bundling multiple designs to dilute the impact of fixed fees." },
      { name: "Can I calculate the break-even price for an Etsy digital product?", text: "Yes. Using ShopProfit's break-even mode, you can calculate the minimum selling price needed to cover all Etsy fees and per-unit digital creation or licensing expenses. With zero production and shipping costs, the break-even price represents the minimum price where revenue exactly covers Etsy platform fees." }
    ];

    html = replaceOnce(html, /<section class="answer-formula page-width" id="how-it-works"[\s\S]*?<\/section>/, digitalHowItWorks, "digital how-it-works section");
    html = replaceOnce(html, /<section class="content-section page-width" id="seller-guides"[\s\S]*?<\/section>/, digitalSellerGuides, "digital seller-guides section");
    html = replaceOnce(html, /<section class="faq-section page-width" id="faq"[\s\S]*?<\/section>/, digitalFaqList, "digital faq section");
    html = html.replace(/<h2 id="fees-heading">How Etsy fees vary by country<\/h2><p>[\s\S]*?<\/p>/,
      `<h2 id="fees-heading">Etsy Digital Download Fees by Seller Country</h2><p>Published payment processing and statutory regulatory rates across major seller jurisdictions. Explore our complete 62-country <a href="/fees/">Etsy Fees Guide</a>.</p>`);
    html = html.replace(/<p class="table-note">\* Etsy publishes some fixed charges in USD;[\s\S]*?<\/p>/,
      `<p class="table-note">* Etsy publishes some fixed charges in USD; local currency equivalents are estimates. On digital downloads, transaction fees (6.5%) apply directly to the item price without shipping deductions. Canada and Australia use domestic processing rates by default. Sales tax/VAT (remitted by Etsy in most jurisdictions), currency-conversion charges (2.5% when listing currency differs from bank payout), and account subscriptions are not modeled. For other sovereign markets, see the <a href="/fees/">global fee table</a>.</p>`);

    const digitalFaqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": digitalFaqs.map(q => ({
        "@type": "Question",
        "name": q.name,
        "acceptedAnswer": { "@type": "Answer", "text": q.text }
      }))
    };
    html = html.replace(faqTag[0], `<script type="application/ld+json" id="faq-structured-data">\n${JSON.stringify(digitalFaqSchema)}\n  </script>`);
  } else if (route.tool === "pricing") {
    const pricingHowItWorks = `<section class="answer-formula page-width" id="how-it-works" aria-label="Etsy pricing and calculation methodology">
      <article class="panel answer-panel">
        <p class="eyebrow">Target Pricing Methodology</p>
        <h2>How to price an Etsy item for profit</h2>
        <p>To hit a specific take-home profit, you must solve backward through Etsy's fees. Because the 6.5% transaction fee and payment processing rate apply to the final customer price (including shipping), a simple cost-plus percentage markup will undercut your profit. ShopProfit uses an exact binary search solver to calculate the required listing price backward from your desired dollar profit.</p>
        <p class="answer-footnote">Your required price adjusts in real-time as you enter production costs, buyer shipping, and seller location.</p>
      </article>
      <article class="panel formula-panel">
        <p class="eyebrow">Reverse Pricing Formula</p>
        <h2>How ShopProfit solves required listing price</h2>
        <div class="formula-code" aria-label="Pricing formulas">
          <code>required price = solver(target profit, materials, packaging, buyer shipping, platform fees)</code>
          <code>gross revenue = calculated listing price + buyer shipping</code>
          <code>net profit = gross revenue − platform fees − business costs = target profit</code>
        </div>
        <p class="formula-note">Pricing calculations account for Etsy's published fee schedules: $0.20 listing fee, 6.5% transaction fee on total order amount, country-specific payment processing, and statutory regulatory fees where applicable. If Offsite Ads applies, the solver accounts for the 12% or 15% deduction up to the $100 cap. <a href="/methodology/">Read our full methodology and calculation standards</a> or browse the <a href="/fees/">Etsy Fees Guide</a>.</p>
      </article>
    </section>`;

    const pricingSellerGuides = `<section class="content-section page-width" id="seller-guides" aria-labelledby="guides-heading">
      <div class="section-heading"><div><h2 id="guides-heading">Etsy Pricing Strategy &amp; Margin Protection</h2><p>Proven frameworks to price your products for consistent take-home profit without margin erosion.</p></div></div>
      <div class="calculator-grid" style="align-items: stretch; margin-bottom: 24px;">
        <article class="panel input-panel">
          <p class="eyebrow">Pricing Pitfalls</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Why Simple Percentage Markups Fail on Etsy</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">A common mistake among craft and vintage sellers is applying a traditional markup—such as doubling costs (2x) or adding 20% on top of raw materials. On Etsy, this formula guarantees lower profit than expected.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">The reason: Etsy's deductions (6.5% transaction fee, country payment processing, and optional 12% or 15% Offsite Ads) are calculated against the <em>retail selling price</em>, not your base cost. A 20% markup on a $10 cost yields $12, but Etsy fees on $12 eat away nearly all of that $2 markup. Target pricing solves backward from your desired profit to eliminate this shortfall.</p>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Reverse Math</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Target Pricing: Solving Backward Through Platform Fees</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Instead of guessing a price and discovering what is left, target pricing starts with the exact net profit you need in your bank account per sale.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">ShopProfit models every deduction in reverse: fixed listing fees ($0.20), fixed processing ($0.25 in the US), variable percentages (6.5% + processing % + regulatory %), and postage. Our binary search solver determines the exact retail price required so that after all deductions occur, your take-home matches your exact target.</p>
        </article>
      </div>
      <div class="calculator-grid" style="align-items: stretch; margin-bottom: 24px;">
        <article class="panel input-panel">
          <p class="eyebrow">Margin vs Dollar</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Pricing for Margin Percentage vs. Fixed Profit Dollar</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Sellers often confuse profit margin percentage with net cash in hand:</p>
          <ul style="padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; margin: 8px 0;">
            <li><strong>Target Profit Dollar:</strong> Asking "I want to keep $15.00 cash from every order." This provides predictable income per unit made and shipped.</li>
            <li><strong>Target Margin Percentage:</strong> Asking "I want a 40% net margin." Margin scales with gross volume: (Net Profit ÷ Gross Revenue) × 100. Higher-ticket items require higher dollar profits to maintain the same margin.</li>
          </ul>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Postage Integration</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Baking Shipping into Retail: The True Cost of Free Shipping</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">When offering "Free Shipping", sellers frequently roll their exact postage label cost into the item price. However, Etsy levies the 6.5% transaction fee and payment processing on the total price.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">If you raise your item price by $6 to cover a $6 shipping label, Etsy takes an extra ~10% ($0.60) in fees from that $6 increase. To truly break even on shipping, you must markup the shipping portion by approximately 11-12% when incorporating it into your item price. Also check our <a href="/etsy-break-even-calculator/">break-even calculator</a>.</p>
        </article>
      </div>
    </section>`;

    const pricingFaqList = `<section class="faq-section page-width" id="faq" aria-labelledby="faq-heading">
      <div class="section-heading"><div><h2 id="faq-heading">Frequently asked questions about Etsy pricing</h2><p>Clear answers to help you price profitably on Etsy. Browse the full <a href="/faq/">Etsy Seller FAQ</a>.</p></div></div>
      <div class="panel faq-list" id="faq-list">
        <details><summary>How do I calculate what price to charge on Etsy?</summary><p>To price an Etsy product for profit, start with your desired take-home profit and solve backward. Add your raw material costs and packaging/shipping costs. Then factor in Etsy's deductions that scale with the retail price: the 6.5% transaction fee, country payment processing (such as 3% + $0.25 in the US), statutory regulatory fees, and optional Offsite Ads (12% or 15%), plus the $0.20 listing fee. ShopProfit's pricing solver automates this reverse calculation to ensure you hit your exact profit target.</p></details>
        <details><summary>Why does simple cost markup result in lower profit on Etsy?</summary><p>Simple cost markups fail because Etsy fees are calculated as a percentage of the total selling price (including shipping), not your cost of goods. If you mark up a $10 item by 20% to $12, Etsy's 6.5% transaction fee, 3% + $0.25 payment processing, and $0.20 listing fee consume $1.59 of your $2 markup, leaving only $0.41 in actual profit.</p></details>
        <details><summary>What is the difference between markup and profit margin on Etsy?</summary><p>Markup is the percentage added to your cost to arrive at a selling price: (Price − Cost) ÷ Cost. Profit margin is the percentage of the selling price that you keep as profit: (Profit ÷ Revenue) × 100. A 50% markup on a $10 item gives a $15 price, but your profit margin after Etsy fees is substantially lower than 50%.</p></details>
        <details><summary>How do Etsy fees affect my pricing strategy?</summary><p>Etsy fees include fixed charges ($0.20 listing + $0.25 US processing = $0.45 flat) and variable percentages (6.5% transaction + 3% processing = 9.5% minimum in the US). Fixed fees make low-priced products (under $10) disproportionately expensive to sell, requiring higher relative markups or product bundles to maintain healthy margins.</p></details>
        <details><summary>How should I price items when offering free shipping on Etsy?</summary><p>Because Etsy charges 6.5% transaction fees and payment processing on the entire price, adding your exact carrier postage cost to the item price results in a loss on shipping. To maintain your margins, inflate the shipping component by approximately 11% to 12% before adding it to your item retail price.</p></details>
        <details><summary>How does the Etsy target profit solver work?</summary><p>ShopProfit's target pricing tool uses a high-precision binary search algorithm. You input your desired take-home profit in dollars, your costs, and shipping, and the engine iterates through possible retail prices until it finds the exact penny where Gross Revenue minus all Etsy platform fees and business costs equals your desired profit target.</p></details>
      </div>
    </section>`;

    const pricingFaqs = [
      { name: "How do I calculate what price to charge on Etsy?", text: "To price an Etsy product for profit, start with your desired take-home profit and solve backward. Add your raw material costs and packaging/shipping costs. Then factor in Etsy's deductions that scale with the retail price: the 6.5% transaction fee, country payment processing (such as 3% + $0.25 in the US), statutory regulatory fees, and optional Offsite Ads (12% or 15%), plus the $0.20 listing fee. ShopProfit's pricing solver automates this reverse calculation to ensure you hit your exact profit target." },
      { name: "Why does simple cost markup result in lower profit on Etsy?", text: "Simple cost markups fail because Etsy fees are calculated as a percentage of the total selling price (including shipping), not your cost of goods. If you mark up a $10 item by 20% to $12, Etsy's 6.5% transaction fee, 3% + $0.25 payment processing, and $0.20 listing fee consume $1.59 of your $2 markup, leaving only $0.41 in actual profit." },
      { name: "What is the difference between markup and profit margin on Etsy?", text: "Markup is the percentage added to your cost to arrive at a selling price: (Price − Cost) ÷ Cost. Profit margin is the percentage of the selling price that you keep as profit: (Profit ÷ Revenue) × 100. A 50% markup on a $10 item gives a $15 price, but your profit margin after Etsy fees is substantially lower than 50%." },
      { name: "How do Etsy fees affect my pricing strategy?", text: "Etsy fees include fixed charges ($0.20 listing + $0.25 US processing = $0.45 flat) and variable percentages (6.5% transaction + 3% processing = 9.5% minimum in the US). Fixed fees make low-priced products (under $10) disproportionately expensive to sell, requiring higher relative markups or product bundles to maintain healthy margins." },
      { name: "How should I price items when offering free shipping on Etsy?", text: "Because Etsy charges 6.5% transaction fees and payment processing on the entire price, adding your exact carrier postage cost to the item price results in a loss on shipping. To maintain your margins, inflate the shipping component by approximately 11% to 12% before adding it to your item retail price." },
      { name: "How does the Etsy target profit solver work?", text: "ShopProfit's target pricing tool uses a high-precision binary search algorithm. You input your desired take-home profit in dollars, your costs, and shipping, and the engine iterates through possible retail prices until it finds the exact penny where Gross Revenue minus all Etsy platform fees and business costs equals your desired profit target." }
    ];

    html = replaceOnce(html, /<section class="answer-formula page-width" id="how-it-works"[\s\S]*?<\/section>/, pricingHowItWorks, "pricing how-it-works section");
    html = replaceOnce(html, /<section class="content-section page-width" id="seller-guides"[\s\S]*?<\/section>/, pricingSellerGuides, "pricing seller-guides section");
    html = replaceOnce(html, /<section class="faq-section page-width" id="faq"[\s\S]*?<\/section>/, pricingFaqList, "pricing faq section");
    html = html.replace(/<h2 id="fees-heading">How Etsy fees vary by country<\/h2><p>[\s\S]*?<\/p>/,
      `<h2 id="fees-heading">Etsy Processing Rates &amp; Country Fee Schedules</h2><p>Published payment processing and statutory regulatory rates to factor into your pricing model. Explore our complete 62-country <a href="/fees/">Etsy Fees Guide</a>.</p>`);
    html = html.replace(/<p class="table-note">\* Etsy publishes some fixed charges in USD;[\s\S]*?<\/p>/,
      `<p class="table-note">* Etsy publishes some fixed charges in USD; local currency equivalents are estimates. When pricing items, remember that payment processing and transaction fees apply to the customer's total payment including shipping. For other sovereign markets, see the <a href="/fees/">global fee table</a>.</p>`);

    const pricingFaqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": pricingFaqs.map(q => ({
        "@type": "Question",
        "name": q.name,
        "acceptedAnswer": { "@type": "Answer", "text": q.text }
      }))
    };
    html = html.replace(faqTag[0], `<script type="application/ld+json" id="faq-structured-data">\n${JSON.stringify(pricingFaqSchema)}\n  </script>`);
  } else if (route.tool === "break-even") {
    const breakEvenHowItWorks = `<section class="answer-formula page-width" id="how-it-works" aria-label="Etsy break-even calculation methodology">
      <article class="panel answer-panel">
        <p class="eyebrow">Break-Even Methodology</p>
        <h2>What is an Etsy break-even price?</h2>
        <p>Your break-even price is the exact minimum item price you must charge so that revenue covers all Etsy platform fees, production materials, and packaging/shipping costs with $0.00 net loss. Selling below your break-even floor loses money on every shipment.</p>
        <p class="answer-footnote">Use your break-even price as an absolute floor when running sales, accepting custom offers, or running promotions.</p>
      </article>
      <article class="panel formula-panel">
        <p class="eyebrow">Break-Even Formulas</p>
        <h2>How ShopProfit calculates break-even</h2>
        <div class="formula-code" aria-label="Break-even formulas">
          <code>break-even price = minimum retail price where Net Profit = $0.00</code>
          <code>gross revenue = break-even price + buyer shipping</code>
          <code>net profit = gross revenue − Etsy platform fees − materials − packaging/shipping = $0.00</code>
        </div>
        <p class="formula-note">ShopProfit calculates your break-even price by iteratively solving for the price where gross revenue exactly equals the sum of fixed listing fees ($0.20), payment processing ($0.25 + variable rate), 6.5% transaction fee, regulatory fees, ad costs, and physical expenses. <a href="/methodology/">Read our full methodology and calculation standards</a> or browse the <a href="/fees/">Etsy Fees Guide</a>.</p>
      </article>
    </section>`;

    const breakEvenSellerGuides = `<section class="content-section page-width" id="seller-guides" aria-labelledby="guides-heading">
      <div class="section-heading"><div><h2 id="guides-heading">Etsy Break-Even Analysis &amp; Floor Price Strategy</h2><p>Essential frameworks to establish your minimum selling prices and avoid unprofitable product lines.</p></div></div>
      <div class="calculator-grid" style="align-items: stretch; margin-bottom: 24px;">
        <article class="panel input-panel">
          <p class="eyebrow">Threshold Analysis</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Per-Unit Floor vs. Monthly Volume Break-Even</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Every Etsy seller must understand two distinct break-even calculations:</p>
          <ul style="padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; margin: 8px 0;">
            <li><strong>Per-Unit Break-Even Price:</strong> The bare minimum item price where a single sale pays for its own materials, shipping, and platform fees. Selling below this price means paying out of pocket to ship an order.</li>
            <li><strong>Monthly Volume Break-Even:</strong> The number of units you must sell each month at your normal profit margin to cover fixed shop overhead (Etsy Plus subscriptions, studio rent, accounting software, and listing renewal cadences).</li>
          </ul>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Fixed Fee Penalty</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">The Fixed Fee Penalty: How $0.45 Minimums Impact Cheap Items</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">On Etsy, every order carries a non-negotiable fixed charge: a $0.20 listing fee and a $0.25 payment processing flat fee (in the US), totaling $0.45 per transaction.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Even if an item costs $0.00 to produce and $0.00 to ship, your break-even price is not zero—it is roughly $0.50 just to pay Etsy's fixed fees and transaction percentages. On low-priced items ($3 to $8), this fixed drag represents 6% to 15% of your sale before materials are considered. To raise profits, explore our <a href="/etsy-pricing-calculator/">Etsy pricing calculator</a>.</p>
        </article>
      </div>
      <div class="calculator-grid" style="align-items: stretch; margin-bottom: 24px;">
        <article class="panel input-panel">
          <p class="eyebrow">Advertising Impact</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">How Offsite Ads Elevate Your Break-Even Floor</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">When an order is attributed to an Etsy Offsite Ad, Etsy deducts an additional 12% or 15% of the total order value. This drastically shifts your break-even floor higher.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">An item that breaks even at $15.00 on organic sales may require an $18.50+ price point to break even if sold through an ad click. Sellers who operate on slim margins without accounting for advertising risk turning break-even sales into cash-losing orders. Model ad fees with our <a href="/etsy-offsite-ads-calculator/">Etsy Offsite Ads calculator</a>.</p>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Margin Optimization</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">3 Practical Strategies to Lower Your Break-Even Point</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Lowering your break-even floor gives you greater pricing flexibility against competitors:</p>
          <ul style="padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; margin: 8px 0;">
            <li><strong>Bulk Packaging Sourcing:</strong> Buying mailers, boxes, and tissue in bulk cuts per-unit packaging from $2.00+ down to $0.50, lowering your floor immediately.</li>
            <li><strong>Product Bundling:</strong> Combining 3 complementary low-ticket items into a single listing spreads Etsy's $0.45 fixed fees across 3 units instead of paying $1.35 in separate fees.</li>
            <li><strong>Commercial Shipping Rates:</strong> Use Etsy Shipping Labels or commercial postage providers (Pirate Ship) to access discounted commercial base rates.</li>
          </ul>
        </article>
      </div>
    </section>`;

    const breakEvenFaqList = `<section class="faq-section page-width" id="faq" aria-labelledby="faq-heading">
      <div class="section-heading"><div><h2 id="faq-heading">Frequently asked questions about Etsy break-even</h2><p>Clear guidance on finding your floor price on Etsy. Browse the full <a href="/faq/">Etsy Seller FAQ</a>.</p></div></div>
      <div class="panel faq-list" id="faq-list">
        <details><summary>What is an Etsy break-even price?</summary><p>An Etsy break-even price is the absolute lowest listing price you can charge for an item such that total revenue (item price + buyer shipping) exactly equals total expenses (Etsy listing fee, 6.5% transaction fee, payment processing fee, regulatory fee, ad fees, production costs, and actual postage costs). Selling at your break-even price yields exactly $0.00 in profit; selling below it causes a financial loss on every order.</p></details>
        <details><summary>How do I calculate my break-even price on Etsy?</summary><p>To calculate break-even on Etsy, solve for the item price where Gross Revenue − Etsy Platform Fees − Production Cost − Packaging/Shipping Cost = $0.00. Because Etsy takes a percentage of the final price, you cannot simply add fees to costs. ShopProfit automatically solves this equation for your specific country and fee structure.</p></details>
        <details><summary>What happens if I sell below my Etsy break-even price?</summary><p>If you price an item below your break-even threshold, you lose money on every completed sale. Even if your sales volume increases, every additional unit sold deepens your net operating loss because platform fees, material costs, and shipping postage exceed the money collected from the customer.</p></details>
        <details><summary>How do fixed fees impact the break-even price of cheap items?</summary><p>Etsy's fixed charges ($0.20 listing fee + $0.25 US payment processing fee = $0.45 total) disproportionately penalize low-priced items. On a $5 item, fixed fees consume 9% of revenue before variable percentages are even applied. This creates a high break-even floor for low-ticket products.</p></details>
        <details><summary>How does Offsite Ads affect my break-even price?</summary><p>If an order is attributed to an Offsite Ad, Etsy deducts an extra 12% or 15% from the gross order total. This additional deduction raises your break-even floor significantly. Sellers should either model their break-even with ad rates enabled or maintain profit margins wide enough to absorb ad deductions.</p></details>
        <details><summary>What is monthly volume break-even on Etsy?</summary><p>Monthly volume break-even is the number of units you must sell in a calendar month to cover fixed shop expenses (such as the $10/month Etsy Plus subscription, studio space, listing renewal fees, and software tools). It is calculated by dividing total fixed monthly expenses by your average net profit per unit.</p></details>
      </div>
    </section>`;

    const breakEvenFaqs = [
      { name: "What is an Etsy break-even price?", text: "An Etsy break-even price is the absolute lowest listing price you can charge for an item such that total revenue (item price + buyer shipping) exactly equals total expenses (Etsy listing fee, 6.5% transaction fee, payment processing fee, regulatory fee, ad fees, production costs, and actual postage costs). Selling at your break-even price yields exactly $0.00 in profit; selling below it causes a financial loss on every order." },
      { name: "How do I calculate my break-even price on Etsy?", text: "To calculate break-even on Etsy, solve for the item price where Gross Revenue − Etsy Platform Fees − Production Cost − Packaging/Shipping Cost = $0.00. Because Etsy takes a percentage of the final price, you cannot simply add fees to costs. ShopProfit automatically solves this equation for your specific country and fee structure." },
      { name: "What happens if I sell below my Etsy break-even price?", text: "If you price an item below your break-even threshold, you lose money on every completed sale. Even if your sales volume increases, every additional unit sold deepens your net operating loss because platform fees, material costs, and shipping postage exceed the money collected from the customer." },
      { name: "How do fixed fees impact the break-even price of cheap items?", text: "Etsy's fixed charges ($0.20 listing fee + $0.25 US payment processing fee = $0.45 total) disproportionately penalize low-priced items. On a $5 item, fixed fees consume 9% of revenue before variable percentages are even applied. This creates a high break-even floor for low-ticket products." },
      { name: "How does Offsite Ads affect my break-even price?", text: "If an order is attributed to an Offsite Ad, Etsy deducts an extra 12% or 15% from the gross order total. This additional deduction raises your break-even floor significantly. Sellers should either model their break-even with ad rates enabled or maintain profit margins wide enough to absorb ad deductions." },
      { name: "What is monthly volume break-even on Etsy?", text: "Monthly volume break-even is the number of units you must sell in a calendar month to cover fixed shop expenses (such as the $10/month Etsy Plus subscription, studio space, listing renewal fees, and software tools). It is calculated by dividing total fixed monthly expenses by your average net profit per unit." }
    ];

    html = replaceOnce(html, /<section class="answer-formula page-width" id="how-it-works"[\s\S]*?<\/section>/, breakEvenHowItWorks, "break-even how-it-works section");
    html = replaceOnce(html, /<section class="content-section page-width" id="seller-guides"[\s\S]*?<\/section>/, breakEvenSellerGuides, "break-even seller-guides section");
    html = replaceOnce(html, /<section class="faq-section page-width" id="faq"[\s\S]*?<\/section>/, breakEvenFaqList, "break-even faq section");
    html = html.replace(/<h2 id="fees-heading">How Etsy fees vary by country<\/h2><p>[\s\S]*?<\/p>/,
      `<h2 id="fees-heading">Etsy Fee Schedules by Country for Break-Even Analysis</h2><p>Published payment processing and statutory regulatory rates across seller jurisdictions. Explore our complete 62-country <a href="/fees/">Etsy Fees Guide</a>.</p>`);
    html = html.replace(/<p class="table-note">\* Etsy publishes some fixed charges in USD;[\s\S]*?<\/p>/,
      `<p class="table-note">* Etsy publishes some fixed charges in USD; local currency equivalents are estimates. Break-even analysis accounts for country-specific payment processing and regulatory fees. For other sovereign markets, see the <a href="/fees/">global fee table</a>.</p>`);

    const breakEvenFaqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": breakEvenFaqs.map(q => ({
        "@type": "Question",
        "name": q.name,
        "acceptedAnswer": { "@type": "Answer", "text": q.text }
      }))
    };
    html = html.replace(faqTag[0], `<script type="application/ld+json" id="faq-structured-data">\n${JSON.stringify(breakEvenFaqSchema)}\n  </script>`);
  } else if (route.tool === "offsite-ads") {
    const adsHowItWorks = `<section class="answer-formula page-width" id="how-it-works" aria-label="Etsy Offsite Ads fees and calculation method">
      <article class="panel answer-panel">
        <p class="eyebrow">Offsite Ads Breakdown</p>
        <h2>How much does Etsy take on Offsite Ads sales?</h2>
        <p>When an order is attributed to an Etsy Offsite Ad, Etsy deducts an advertising fee of 15% (for shops under $10,000 in trailing 12-month sales) or 12% (for shops at or above $10,000) on the entire order total (item price + buyer shipping). Crucially, Etsy caps the maximum fee at $100 USD per order.</p>
        <p class="answer-footnote">The ad fee is added on top of Etsy's standard listing fee, 6.5% transaction fee, and payment processing charges.</p>
      </article>
      <article class="panel formula-panel">
        <p class="eyebrow">Transparent Methodology</p>
        <h2>How ShopProfit models Offsite Ads fees</h2>
        <div class="formula-code" aria-label="Offsite Ads formulas">
          <code>ad fee = min(order total × selected ad rate, $100 USD equivalent cap)</code>
          <code>order total = item price + buyer shipping + gift wrap</code>
          <code>net profit (ad order) = order total − standard fees − ad fee − production − shipping</code>
        </div>
        <p class="formula-note">Calculations model Etsy's official advertising policy: 15% optional tier, 12% mandatory high-volume tier, and the statutory $100 per-order maximum fee cap. Ad attribution applies to orders placed within 30 days of an external ad click. <a href="/methodology/">Read our full methodology and calculation standards</a> or browse the <a href="/fees/">Etsy Fees Guide</a>.</p>
      </article>
    </section>`;

    const adsSellerGuides = `<section class="content-section page-width" id="seller-guides" aria-labelledby="guides-heading">
      <div class="section-heading"><div><h2 id="guides-heading">Etsy Offsite Ads Fee &amp; Margin Strategy</h2><p>Master Etsy's external advertising program, protect profit margins, and understand the $100 fee cap.</p></div></div>
      <div class="calculator-grid" style="align-items: stretch; margin-bottom: 24px;">
        <article class="panel input-panel">
          <p class="eyebrow">Tiers &amp; Rules</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">15% Optional vs. 12% Mandatory: The $10,000 Threshold</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Etsy runs Offsite Ads on Google Shopping, Facebook, Instagram, Pinterest, and Bing on behalf of sellers. Participation terms depend strictly on your trailing 12-month gross revenue:</p>
          <ul style="padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; margin: 8px 0;">
            <li><strong>Under $10,000 USD (15% Fee):</strong> Participation is optional. You can enable or disable Offsite Ads at any time in Shop Manager.</li>
            <li><strong>$10,000 USD or More (12% Fee):</strong> Once your shop hits $10,000 in sales over any consecutive 365-day period, participation becomes mandatory for the lifetime of your shop. Your fee rate drops from 15% to 12%.</li>
          </ul>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Fee Protection</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">The Statutory $100 Per-Order Cap: High-Ticket Protection</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">One of the most important yet overlooked provisions in Etsy's advertising policy is the per-order maximum fee cap:</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Regardless of how large an order is, Etsy caps the maximum Offsite Ads fee at <strong>$100.00 USD</strong> (or local currency equivalent). On a $500 order, a 15% fee would normally be $75. On a $1,200 custom furniture order, 15% would be $180, but Etsy charges only $100. ShopProfit accurately models this cap; many competing calculators erroneously charge uncapped percentages.</p>
        </article>
      </div>
      <div class="calculator-grid" style="align-items: stretch; margin-bottom: 24px;">
        <article class="panel input-panel">
          <p class="eyebrow">Tracking Window</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">The 30-Day Attribution Window: How Etsy Tracks Ad Clicks</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">When a shopper clicks an Etsy-placed ad on Google or social media, a 30-day tracking cookie is established.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">If that customer buys <em>any listing</em> from your shop within the next 30 days—even if they buy a completely different item than the one shown in the ad—Etsy attributes the sale to the ad and levies the 12% or 15% fee. Understanding this attribution window is essential for evaluating your overall advertising ROI.</p>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Pricing Strategy</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Pricing Your Shop to Absorb Offsite Ads Profitably</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">You cannot adjust your prices dynamically based on whether a customer found you through an ad. Instead, seasoned sellers blend ad costs into their overall pricing strategy.</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">If 20% of your sales originate from Offsite Ads at a 15% rate, your effective advertising drag across your entire shop is 3% (20% × 15%). Raising catalog prices by 3% across the board absorbs the program seamlessly without hurting organic conversions. Check our <a href="/etsy-pricing-calculator/">Etsy pricing calculator</a> to model adjusted pricing.</p>
        </article>
      </div>
    </section>`;

    const adsFaqList = `<section class="faq-section page-width" id="faq" aria-labelledby="faq-heading">
      <div class="section-heading"><div><h2 id="faq-heading">Frequently asked questions about Etsy Offsite Ads</h2><p>Clear, verified answers about Etsy's advertising fees. Browse the full <a href="/faq/">Etsy Seller FAQ</a>.</p></div></div>
      <div class="panel faq-list" id="faq-list">
        <details><summary>How much does Etsy charge for Offsite Ads?</summary><p>Etsy charges either 15% or 12% of the gross order total (item price + buyer shipping) when a sale is attributed to an external ad click on Google, Facebook, Instagram, or Pinterest. Shops making under $10,000 USD over the trailing 12 months pay 15% (optional); shops making $10,000 USD or more pay 12% (mandatory). Crucially, Etsy caps the maximum fee at $100 USD per attributed order.</p></details>
        <details><summary>Can I opt out of Etsy Offsite Ads?</summary><p>Yes, but only if your shop has generated less than $10,000 USD in sales over the trailing 365 days. You can toggle Offsite Ads off in Shop Manager > Settings > Offsite Ads. Once your shop crosses $10,000 USD in 12-month sales, participation is mandatory for the lifetime of the shop and cannot be disabled.</p></details>
        <details><summary>How does the $10,000 threshold for Etsy Offsite Ads work?</summary><p>Etsy calculates your sales volume over a trailing 365-day rolling window. If gross sales in that period reach or exceed $10,000 USD, your shop is permanently enrolled in mandatory Offsite Ads at the lower 12% rate. Even if your sales later drop below $10,000 in subsequent years, mandatory participation remains permanent.</p></details>
        <details><summary>Is there a maximum limit or cap on Etsy Offsite Ads fees?</summary><p>Yes. Etsy officially caps the maximum Offsite Ads fee at $100.00 USD (or equivalent in local currency) per order, regardless of order total. On high-value sales (such as a $1,000 custom piece), your ad fee is capped at $100 rather than $150 or $120.</p></details>
        <details><summary>Does Etsy charge the Offsite Ads fee on shipping?</summary><p>Yes. The 12% or 15% Offsite Ads fee applies to the entire order total paid by the customer, which includes item price, buyer shipping, and any gift wrapping. It does not apply to sales taxes collected directly by Etsy.</p></details>
        <details><summary>How long does Etsy's Offsite Ads attribution window last?</summary><p>Etsy's attribution window lasts 30 days. If a shopper clicks an ad for one of your listings and purchases from your shop within 30 days, that order is subject to the Offsite Ads fee, even if they buy a different item than the one displayed in the advertisement.</p></details>
      </div>
    </section>`;

    const adsFaqs = [
      { name: "How much does Etsy charge for Offsite Ads?", text: "Etsy charges either 15% or 12% of the gross order total (item price + buyer shipping) when a sale is attributed to an external ad click on Google, Facebook, Instagram, or Pinterest. Shops making under $10,000 USD over the trailing 12 months pay 15% (optional); shops making $10,000 USD or more pay 12% (mandatory). Crucially, Etsy caps the maximum fee at $100 USD per attributed order." },
      { name: "Can I opt out of Etsy Offsite Ads?", text: "Yes, but only if your shop has generated less than $10,000 USD in sales over the trailing 365 days. You can toggle Offsite Ads off in Shop Manager > Settings > Offsite Ads. Once your shop crosses $10,000 USD in 12-month sales, participation is mandatory for the lifetime of the shop and cannot be disabled." },
      { name: "How does the $10,000 threshold for Etsy Offsite Ads work?", text: "Etsy calculates your sales volume over a trailing 365-day rolling window. If gross sales in that period reach or exceed $10,000 USD, your shop is permanently enrolled in mandatory Offsite Ads at the lower 12% rate. Even if your sales later drop below $10,000 in subsequent years, mandatory participation remains permanent." },
      { name: "Is there a maximum limit or cap on Etsy Offsite Ads fees?", text: "Yes. Etsy officially caps the maximum Offsite Ads fee at $100.00 USD (or equivalent in local currency) per order, regardless of order total. On high-value sales (such as a $1,000 custom piece), your ad fee is capped at $100 rather than $150 or $120." },
      { name: "Does Etsy charge the Offsite Ads fee on shipping?", text: "Yes. The 12% or 15% Offsite Ads fee applies to the entire order total paid by the customer, which includes item price, buyer shipping, and any gift wrapping. It does not apply to sales taxes collected directly by Etsy." },
      { name: "How long does Etsy's Offsite Ads attribution window last?", text: "Etsy's attribution window lasts 30 days. If a shopper clicks an ad for one of your listings and purchases from your shop within 30 days, that order is subject to the Offsite Ads fee, even if they buy a different item than the one displayed in the advertisement." }
    ];

    html = replaceOnce(html, /<section class="answer-formula page-width" id="how-it-works"[\s\S]*?<\/section>/, adsHowItWorks, "ads how-it-works section");
    html = replaceOnce(html, /<section class="content-section page-width" id="seller-guides"[\s\S]*?<\/section>/, adsSellerGuides, "ads seller-guides section");
    html = replaceOnce(html, /<section class="faq-section page-width" id="faq"[\s\S]*?<\/section>/, adsFaqList, "ads faq section");
    html = html.replace(/<h2 id="fees-heading">How Etsy fees vary by country<\/h2><p>[\s\S]*?<\/p>/,
      `<h2 id="fees-heading">Etsy Fee Rates &amp; Offsite Ads Schedule by Country</h2><p>Published payment processing and statutory regulatory rates for shops worldwide. Explore our complete 62-country <a href="/fees/">Etsy Fees Guide</a>.</p>`);
    html = html.replace(/<p class="table-note">\* Etsy publishes some fixed charges in USD;[\s\S]*?<\/p>/,
      `<p class="table-note">* Etsy publishes some fixed charges in USD; local currency equivalents are estimates. The Offsite Ads fee is calculated on gross order total up to the statutory $100 USD equivalent cap. For other sovereign markets, see the <a href="/fees/">global fee table</a>.</p>`);

    const adsFaqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": adsFaqs.map(q => ({
        "@type": "Question",
        "name": q.name,
        "acceptedAnswer": { "@type": "Answer", "text": q.text }
      }))
    };
    html = html.replace(faqTag[0], `<script type="application/ld+json" id="faq-structured-data">\n${JSON.stringify(adsFaqSchema)}\n  </script>`);
  } else if (route.tool === "pod") {
    const podHowItWorks = `<section class="answer-formula page-width" id="how-it-works" aria-label="Etsy print on demand fees and calculation method">
      <article class="panel answer-panel">
        <p class="eyebrow">Print on Demand Breakdown</p>
        <h2>How much does Etsy take from a print-on-demand sale?</h2>
        <p>For print-on-demand sales, Etsy takes its standard fees: $0.20 listing fee, 6.5% transaction fee on total customer payment, and payment processing (3% + $0.25 in the US). In addition, your print provider (Printify, Printful, Gelato) charges you directly for the product blank, printing, and customer shipping.</p>
        <p class="answer-footnote">Your net profit is the margin remaining after deducting both Etsy's platform cut and your provider's fulfillment invoice.</p>
      </article>
      <article class="panel formula-panel">
        <p class="eyebrow">Transparent Methodology</p>
        <h2>How ShopProfit calculates POD profit</h2>
        <div class="formula-code" aria-label="Print on demand profit formulas">
          <code>gross revenue = retail price + shipping charged to buyer</code>
          <code>Etsy platform fees = $0.20 listing + 6.5% transaction + processing + ads</code>
          <code>fulfillment costs = print provider item cost + print provider shipping cost</code>
          <code>net profit = gross revenue − Etsy platform fees − fulfillment costs</code>
        </div>
        <p class="formula-note">ShopProfit is provider-agnostic: enter your exact wholesale product charges and shipping invoices from Printify, Printful, Gelato, or Awkward Styles. Calculations accurately model Etsy's 6.5% fee on buyer shipping, payment processing, and optional ad deductions. <a href="/methodology/">Read our full methodology and calculation standards</a> or browse the <a href="/fees/">Etsy Fees Guide</a>.</p>
      </article>
    </section>`;

    const podSellerGuides = `<section class="content-section page-width" id="seller-guides" aria-labelledby="guides-heading">
      <div class="section-heading"><div><h2 id="guides-heading">Etsy Print on Demand Profit &amp; Margin Strategy</h2><p>Essential frameworks to manage fulfillment costs, avoid negative margins, and price POD products for profit.</p></div></div>
      <div class="calculator-grid" style="align-items: stretch; margin-bottom: 24px;">
        <article class="panel input-panel">
          <p class="eyebrow">Fulfillment Economics</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">The 2-Leg Shipping Trap in Print on Demand</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">The most frequent reason new POD sellers lose money is misunderstanding the two separate shipping transactions involved in every order:</p>
          <ul style="padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; margin: 8px 0;">
            <li><strong>Customer Shipping Leg:</strong> The shipping amount you charge the buyer on Etsy. Etsy levies its 6.5% transaction fee and payment processing fee directly on this amount.</li>
            <li><strong>Provider Shipping Leg:</strong> The shipping fee your print provider (Printify, Printful) invoices you to print and ship the item. This is a real out-of-pocket production expense.</li>
          </ul>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">If you charge the buyer $4.50 shipping and your provider charges you $4.50 shipping, you lose money because Etsy deducts ~$0.45 from that customer shipping revenue. Always model both legs in ShopProfit.</p>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Category Margins</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Realistic Profit Margin Benchmarks for Etsy POD</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Typical healthy net margin benchmarks for popular print-on-demand categories after all Etsy fees and provider costs:</p>
          <ul style="padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; margin: 8px 0;">
            <li><strong>T-Shirts &amp; Apparel:</strong> 20% to 30% ($5.00 to $9.00 net profit on a $26–$30 retail price).</li>
            <li><strong>Sweatshirts &amp; Hoodies:</strong> 25% to 35% ($10.00 to $16.00 net profit on a $42–$50 retail price).</li>
            <li><strong>Mugs &amp; Drinkware:</strong> 15% to 25% ($3.00 to $5.50 net profit on a $16–$20 retail price). High shipping relative to price makes mugs margin-sensitive.</li>
            <li><strong>Posters &amp; Wall Art:</strong> 35% to 50% ($8.00 to $18.00 net profit on a $22–$36 retail price). Low provider production costs yield strong margins.</li>
          </ul>
        </article>
      </div>
      <div class="calculator-grid" style="align-items: stretch; margin-bottom: 24px;">
        <article class="panel input-panel">
          <p class="eyebrow">Advertising Economics</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Why Offsite Ads Can Wipe Out Thin POD Margins</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Because print-on-demand items have fixed baseline costs from your print provider, your gross profit margins (20–30%) are much narrower than handmade or digital goods (60–85%).</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">If an order triggers a 15% Etsy Offsite Ads fee on a $30 sale ($4.50 deduction), a $6.00 expected profit shrinks to just $1.50 (a 5% margin). If unexpected customer returns occur, that sale becomes unprofitable. Sellers must price POD items with sufficient buffer using our <a href="/etsy-pricing-calculator/">Etsy pricing calculator</a>.</p>
        </article>
        <article class="panel input-panel">
          <p class="eyebrow">Provider Agnostic</p>
          <h3 style="font-size: 18px; margin: 0 0 10px;">Provider Agnostic: Modeling Printify, Printful, and Gelato</h3>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Rather than relying on outdated hardcoded provider tables that fail to reflect live vendor price changes, ShopProfit uses transparent direct inputs:</p>
          <p style="color: var(--muted); font-size: 13px; line-height: 1.6;">Simply look at your print provider catalog (e.g., Bella+Canvas 3001 on Printify for $9.50 with $4.50 shipping), enter those figures directly into "Print provider item cost" and "Print provider shipping cost", and ShopProfit gives you the exact take-home profit down to the penny.</p>
        </article>
      </div>
    </section>`;

    const podFaqList = `<section class="faq-section page-width" id="faq" aria-labelledby="faq-heading">
      <div class="section-heading"><div><h2 id="faq-heading">Frequently asked questions about Etsy print on demand</h2><p>Clear, verified answers for POD sellers. Browse the full <a href="/faq/">Etsy Seller FAQ</a>.</p></div></div>
      <div class="panel faq-list" id="faq-list">
        <details><summary>How do I calculate profit for Etsy print on demand?</summary><p>To calculate profit for an Etsy print-on-demand item, subtract both Etsy platform fees and your print provider fulfillment costs from total customer revenue. Total customer revenue equals listing price plus shipping charged to the buyer. Deduct Etsy fees ($0.20 listing, 6.5% transaction, payment processing, and any ad fees), then deduct your print provider's base product charge (blank + printing) and provider shipping fee. What remains is your net take-home profit.</p></details>
        <details><summary>What fees does Etsy charge on print on demand products?</summary><p>Etsy does not charge any special fee for print on demand. You pay the exact same platform fees as physical sellers: a $0.20 listing fee, a 6.5% transaction fee on total order revenue (item + buyer shipping), country payment processing (3% + $0.25 in the US), and optional 12% or 15% Offsite Ads fees if applicable.</p></details>
        <details><summary>What is a realistic profit margin for print on demand on Etsy?</summary><p>A healthy net profit margin for Etsy POD is between 20% and 35%. On a standard $28 t-shirt with $4.50 buyer shipping ($32.50 revenue), after ~$3.50 in Etsy fees and ~$14.00 in provider production and shipping, you should expect to take home roughly $7.00 to $9.00 per shirt (22% to 28% margin).</p></details>
        <details><summary>Does Etsy charge fees on print-on-demand shipping?</summary><p>Yes. Etsy levies its 6.5% transaction fee and payment processing fee on the entire shipping amount charged to the buyer. This means if you charge $4.50 for shipping, Etsy retains roughly $0.43 to $0.45 in platform fees directly from that shipping charge.</p></details>
        <details><summary>How do Printify and Printful production costs interact with Etsy fees?</summary><p>Your print provider operates independently of Etsy. When an order occurs, Etsy deposits customer revenue (minus Etsy platform fees) into your Etsy Payment account, while your print provider automatically charges your credit card or PayPal for fulfillment. ShopProfit models both transactions simultaneously to show your true consolidated take-home.</p></details>
        <details><summary>How should I price a POD t-shirt or hoodie on Etsy?</summary><p>Start with your total print provider cost (item blank + print fee + fulfillment postage), add your desired profit in dollars (e.g., $8.00 per shirt), and use ShopProfit's target pricing tool to calculate backward. For apparel, retail prices between $26.00 and $32.00 for t-shirts and $42.00 to $52.00 for hoodies generally balance competitive conversion rates with solid margins.</p></details>
      </div>
    </section>`;

    const podFaqs = [
      { name: "How do I calculate profit for Etsy print on demand?", text: "To calculate profit for an Etsy print-on-demand item, subtract both Etsy platform fees and your print provider fulfillment costs from total customer revenue. Total customer revenue equals listing price plus shipping charged to the buyer. Deduct Etsy fees ($0.20 listing, 6.5% transaction, payment processing, and any ad fees), then deduct your print provider's base product charge (blank + printing) and provider shipping fee. What remains is your net take-home profit." },
      { name: "What fees does Etsy charge on print on demand products?", text: "Etsy does not charge any special fee for print on demand. You pay the exact same platform fees as physical sellers: a $0.20 listing fee, a 6.5% transaction fee on total order revenue (item + buyer shipping), country payment processing (3% + $0.25 in the US), and optional 12% or 15% Offsite Ads fees if applicable." },
      { name: "What is a realistic profit margin for print on demand on Etsy?", text: "A healthy net profit margin for Etsy POD is between 20% and 35%. On a standard $28 t-shirt with $4.50 buyer shipping ($32.50 revenue), after ~$3.50 in Etsy fees and ~$14.00 in provider production and shipping, you should expect to take home roughly $7.00 to $9.00 per shirt (22% to 28% margin)." },
      { name: "Does Etsy charge fees on print-on-demand shipping?", text: "Yes. Etsy levies its 6.5% transaction fee and payment processing fee on the entire shipping amount charged to the buyer. This means if you charge $4.50 for shipping, Etsy retains roughly $0.43 to $0.45 in platform fees directly from that shipping charge." },
      { name: "How do Printify and Printful production costs interact with Etsy fees?", text: "Your print provider operates independently of Etsy. When an order occurs, Etsy deposits customer revenue (minus Etsy platform fees) into your Etsy Payment account, while your print provider automatically charges your credit card or PayPal for fulfillment. ShopProfit models both transactions simultaneously to show your true consolidated take-home." },
      { name: "How should I price a POD t-shirt or hoodie on Etsy?", text: "Start with your total print provider cost (item blank + print fee + fulfillment postage), add your desired profit in dollars (e.g., $8.00 per shirt), and use ShopProfit's target pricing tool to calculate backward. For apparel, retail prices between $26.00 and $32.00 for t-shirts and $42.00 to $52.00 for hoodies generally balance competitive conversion rates with solid margins." }
    ];

    html = replaceOnce(html, /<section class="answer-formula page-width" id="how-it-works"[\s\S]*?<\/section>/, podHowItWorks, "pod how-it-works section");
    html = replaceOnce(html, /<section class="content-section page-width" id="seller-guides"[\s\S]*?<\/section>/, podSellerGuides, "pod seller-guides section");
    html = replaceOnce(html, /<section class="faq-section page-width" id="faq"[\s\S]*?<\/section>/, podFaqList, "pod faq section");
    html = html.replace(/<h2 id="fees-heading">How Etsy fees vary by country<\/h2><p>[\s\S]*?<\/p>/,
      `<h2 id="fees-heading">Etsy Fee Rates &amp; Processing Schedules for POD Sellers</h2><p>Published payment processing and statutory regulatory rates for international POD shops. Explore our complete 62-country <a href="/fees/">Etsy Fees Guide</a>.</p>`);
    html = html.replace(/<p class="table-note">\* Etsy publishes some fixed charges in USD;[\s\S]*?<\/p>/,
      `<p class="table-note">* Etsy publishes some fixed charges in USD; local currency equivalents are estimates. On print-on-demand orders, remember that Etsy deducts transaction fees from customer shipping while your print provider invoices you separately for fulfillment postage. For other sovereign markets, see the <a href="/fees/">global fee table</a>.</p>`);

    const podFaqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": podFaqs.map(q => ({
        "@type": "Question",
        "name": q.name,
        "acceptedAnswer": { "@type": "Answer", "text": q.text }
      }))
    };
    html = html.replace(faqTag[0], `<script type="application/ld+json" id="faq-structured-data">\n${JSON.stringify(podFaqSchema)}\n  </script>`);
  } else {
    const faq = JSON.parse(faqTag[1]);
    faq.mainEntity[0].name = route.question; faq.mainEntity[0].acceptedAnswer.text = route.answer;
    html = html.replace(faqTag[0], `<script type="application/ld+json" id="faq-structured-data">\n${JSON.stringify(faq)}\n  </script>`);
  }
  if (route.code === "OTHER") {
    html = html.replace('id="shipping" name="shipping" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="5"', 'id="shipping" name="shipping" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="0"')
      .replace('id="production" name="production" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="7"', 'id="production" name="production" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="0"')
      .replace('id="packaging" name="packaging" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="4"', 'id="packaging" name="packaging" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="0"')
      .replace('id="digital-preset" aria-pressed="false"', 'id="digital-preset" aria-pressed="true"')
      .replace('id="digital-mode-note" hidden', 'id="digital-mode-note"');
  } else if (route.tool === "pricing" || route.tool === "break-even") {
    html = html.replace('<details class="advanced-options" id="advanced-options">', '<details class="advanced-options" id="advanced-options" open>');
  } else if (route.tool === "offsite-ads") {
    html = html.replace('<details class="advanced-options" id="advanced-options">', '<details class="advanced-options" id="advanced-options" open>')
      .replace('<details class="panel scenarios-panel">', '<details class="panel scenarios-panel" open>')
      .replace('<input type="radio" name="offsite" value="0" checked>', '<input type="radio" name="offsite" value="0">')
      .replace('<input type="radio" name="offsite" value="0.15">', '<input type="radio" name="offsite" value="0.15" checked>');
  } else if (route.tool === "pod") {
    html = html.replace('id="item-price" name="itemPrice" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="35"', 'id="item-price" name="itemPrice" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="28"')
      .replace('id="shipping" name="shipping" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="5"', 'id="shipping" name="shipping" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="4.50"')
      .replace('id="production" name="production" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="7"', 'id="production" name="production" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="9.50"')
      .replace('id="packaging" name="packaging" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="4"', 'id="packaging" name="packaging" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="4.50"')
      .replace('<label for="production">Production / material cost</label>', '<label for="production">Print provider item cost</label>')
      .replace('<label for="packaging">Packaging &amp; shipping cost</label>', '<label for="packaging">Print provider shipping cost</label>')
      .replace('<small id="item-price-help" class="field-help">Your item price before shipping.</small>', '<small id="item-price-help" class="field-help">Retail price charged to Etsy customer.</small>');
  }
  await writeFile(new URL(`../${route.file}`, import.meta.url), html);
  // Also write to slug/index.html so Cloudflare Pages serves the clean URL natively
  // (avoids _redirects 200-rewrite loops caused by Cloudflare's Pretty URLs feature)
  const slugDir = route.file.replace(/\.html$/, "");
  await mkdir(new URL(`../${slugDir}/`, import.meta.url), { recursive: true });
  await writeFile(new URL(`../${slugDir}/index.html`, import.meta.url), html);
}

await writeFile(htmlFile, base);
for (const page of ["privacy", "terms"]) {
  await mkdir(new URL(`../${page}/`, import.meta.url), { recursive: true });
  let html = await readFile(new URL(`../${page}.html`, import.meta.url), "utf8");
  html = html.replace(/<h2>Contact<\/h2><p>[\s\S]*?<\/p>/g, "");
  const contact = supportContactHtml();
  if (page === "privacy") {
    const contactSection = `<h2>Contact</h2><p>For privacy questions or requests, contact the ShopProfit operator at ${contact}.</p>`;
    const originalContact = /<h2>Changes and questions<\/h2><p>[\s\S]*?<\/p>/;
    html = originalContact.test(html) ? html.replace(originalContact, contactSection)
      : html.replace('<div class="resource-links">', `${contactSection}<div class="resource-links">`);
  }
  else html = html.replace(/<h2>Updates<\/h2><p>[\s\S]*?<\/p>/,
    `<h2>Updates</h2><p>These terms may be revised as the service changes. Review this page for the current text; nothing here limits rights that cannot be limited under applicable law.</p><h2>Contact</h2><p>For questions about these terms, contact the ShopProfit operator at ${contact}.</p>`);
  await writeFile(new URL(`../${page}.html`, import.meta.url), html);
  await writeFile(new URL(`../${page}/index.html`, import.meta.url), html);
}
let contactPage = await readFile(new URL("../contact.html", import.meta.url), "utf8");
contactPage = contactPage.replace(/(<p>For questions about the calculator, site content, or privacy requests, email\s+)(?:<a href="mailto:[^"]+">[^<]+<\/a>|<span>Contact email not configured for this preview build\.[\s\S]*?<\/span>|\{\{SUPPORT_CONTACT\}\})(<\/p>)/,
  `$1${supportContactHtml()}$2`);
await mkdir(new URL("../contact/", import.meta.url), { recursive: true });
await writeFile(new URL("../contact.html", import.meta.url), contactPage);
await writeFile(new URL("../contact/index.html", import.meta.url), contactPage);
// Write fees, methodology, and faq to subdirectories so Cloudflare serves them natively (no 200-rewrite loop)
for (const page of ["fees", "methodology", "faq"]) {
  const content = await readFile(new URL(`../${page}.html`, import.meta.url), "utf8");
  await mkdir(new URL(`../${page}/`, import.meta.url), { recursive: true });
  await writeFile(new URL(`../${page}/index.html`, import.meta.url), content);
}
console.log(`Generated ${routes.length} static SEO routes and populated the static fee table.`);
if (!SUPPORT_EMAIL) console.warn("LAUNCH BLOCKER: SUPPORT_EMAIL is unset; generated contact pages show a setup notice. Set it in Cloudflare Pages and rebuild before launch.");

