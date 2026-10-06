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
base = replaceOnce(base, /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Silkscreen:wght@400;700&display=swap" rel="stylesheet">/,
  `<link href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&display=swap" rel="stylesheet">`, "pixel font stylesheet");
const noScriptNote = `<noscript><p class="noscript-note">The fee guide, methodology, country table, and FAQs are available below. Entering and calculating a sale requires JavaScript; your entries are not submitted.</p></noscript>`;
if (/<noscript>[\s\S]*?<\/noscript>/.test(base)) base = base.replace(/<noscript>[\s\S]*?<\/noscript>/, noScriptNote);
else base = replaceOnce(base, /<\/main>/, `</main>\n  ${noScriptNote}`, "main closing tag");
base = replaceOnce(base, /<div class="footer-column"><strong>Tools<\/strong>[\s\S]*?<\/div><div class="footer-column"><strong>Resources<\/strong>/,
  `<div class="footer-column"><strong>Tools</strong><a href="/#calculator">Etsy profit calculator</a><a href="/fees/">Etsy fee calculator</a><a href="/#target-pricing">Etsy pricing calculator</a><a href="/#break-even-tool">Etsy break-even calculator</a><a href="/#offsite-ads">Etsy Offsite Ads calculator</a><a href="/etsy-digital-download-fee-calculator">Etsy digital product calculator</a><strong>Regional calculators</strong><a href="/etsy-fee-calculator-uk">United Kingdom</a><a href="/etsy-fee-calculator-canada">Canada</a><a href="/etsy-fee-calculator-australia">Australia</a></div><div class="footer-column"><strong>Resources</strong>`, "footer tool links");
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
  } else {
    const faq = JSON.parse(faqTag[1]);
    faq.mainEntity[0].name = route.question; faq.mainEntity[0].acceptedAnswer.text = route.answer;
    html = html.replace(faqTag[0], `<script type="application/ld+json" id="faq-structured-data">\n${JSON.stringify(faq)}\n  </script>`);
  }
  if (route.code === "OTHER") html = html.replace('id="shipping" name="shipping" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="5"', 'id="shipping" name="shipping" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="0"')
    .replace('id="production" name="production" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="7"', 'id="production" name="production" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="0"')
    .replace('id="packaging" name="packaging" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="4"', 'id="packaging" name="packaging" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="0"')
    .replace('id="digital-preset" aria-pressed="false"', 'id="digital-preset" aria-pressed="true"')
    .replace('id="digital-mode-note" hidden', 'id="digital-mode-note"');
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

