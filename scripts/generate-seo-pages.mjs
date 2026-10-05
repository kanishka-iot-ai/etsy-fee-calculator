import { mkdir, readFile, writeFile } from "node:fs/promises";
import { COUNTRIES, COUNTRY_ORDER } from "../src/countries.js";
import { formatMoney } from "../src/calculator.js";
import { TRANSACTION_RATE } from "../src/calculator.js";
import { SUPPORT_EMAIL, supportContactHtml } from "./site-config.mjs";

const htmlFile = new URL("../index.html", import.meta.url);
const source = await readFile(htmlFile, "utf8");
const replaceOnce = (html, pattern, replacement, label) => {
  if (!pattern.test(html)) throw new Error(`Could not find ${label} in index.html`);
  return html.replace(pattern, replacement);
};

const feeRows = COUNTRY_ORDER.map((code) => {
  const country = COUNTRIES[code];
  const regulatory = country.regulatoryRate ? `${(country.regulatoryRate * 100).toFixed(2)}%` : "—";
  const rate = country.processingRate * 100;
  const rateLabel = `${Number.isInteger(rate) ? rate.toFixed(0) : rate.toFixed(1)}%`;
  const transaction = `${(TRANSACTION_RATE * 100).toFixed(1)}%`;
  const notes = country.processingNote || "Domestic/default processing estimate; international order rates may differ.";
  return `          <tr><th scope="row">${country.name}</th><td>${country.currency}</td><td>${formatMoney(Math.round(country.listingFee * 100), country)}</td><td>${transaction}</td><td>${rateLabel} + ${formatMoney(Math.round(country.processingFixed * 100), country)}</td><td>${regulatory}</td><td>${notes}</td></tr>`;
}).join("\n");

let base = replaceOnce(source, /<tbody id="fee-table-body">[\s\S]*?<\/tbody>/, `<tbody id="fee-table-body">\n${feeRows}\n      </tbody>`, "fee table body");
base = replaceOnce(base, /<select class="country-nav" id="country-nav" aria-label="Seller location">[\s\S]*?<\/select>/,
  `<select class="country-nav" id="country-nav" aria-label="Seller location">${COUNTRY_ORDER.map((code) => `<option value="${code}">${COUNTRIES[code].name}</option>`).join("")}</select>`, "header country selector");
base = replaceOnce(base, /<select id="country" name="country">[\s\S]*?<\/select>/,
  `<select id="country" name="country">${COUNTRY_ORDER.map((code) => `<option value="${code}">${COUNTRIES[code].name}</option>`).join("")}</select>`, "calculator country selector");
base = replaceOnce(base, /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Silkscreen:wght@400;700&display=swap" rel="stylesheet">/,
  `<link href="https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&display=swap" rel="stylesheet">`, "pixel font stylesheet");
const noScriptNote = `<noscript><p class="noscript-note">The fee guide, methodology, country table, and FAQs are available below. Entering and calculating a sale requires JavaScript; your entries are not submitted.</p></noscript>`;
if (/<noscript>[\s\S]*?<\/noscript>/.test(base)) base = base.replace(/<noscript>[\s\S]*?<\/noscript>/, noScriptNote);
else base = replaceOnce(base, /<\/main>/, `</main>\n  ${noScriptNote}`, "main closing tag");
base = replaceOnce(base, /<div class="footer-column"><strong>Tools<\/strong>[\s\S]*?<\/div><div class="footer-column"><strong>Resources<\/strong>/,
  `<div class="footer-column"><strong>Tools</strong><a href="/#calculator">Etsy profit calculator</a><a href="/#fees">Etsy fee calculator</a><a href="/#target-pricing">Etsy pricing calculator</a><a href="/#break-even-tool">Etsy break-even calculator</a><a href="/#offsite-ads">Etsy Offsite Ads calculator</a><a href="/etsy-digital-download-fee-calculator">Etsy digital product calculator</a><strong>Regional calculators</strong><a href="/etsy-fee-calculator-uk">United Kingdom</a><a href="/etsy-fee-calculator-canada">Canada</a><a href="/etsy-fee-calculator-australia">Australia</a></div><div class="footer-column"><strong>Resources</strong>`, "footer tool links");
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
    description: "Estimate Etsy fees and take-home profit in GBP for UK sellers, including payment processing and the UK regulatory operating fee.",
    h1: "Etsy Fee Calculator for UK Sellers",
    intro: "Estimate your Etsy take-home in pounds. This UK calculator includes the 6.5% transaction fee, UK payment-processing assumptions, and the published 0.48% regulatory operating fee; fixed local amounts are estimates.",
    question: "What Etsy fees do sellers pay in the United Kingdom?",
    answer: "UK sellers should account for Etsy's listing fee, 6.5% transaction fee, UK payment-processing fees, and a 0.48% regulatory operating fee. This calculator uses estimated local fixed amounts; check Etsy's current schedule and your order-specific rate.",
  },
  {
    file: "etsy-fee-calculator-canada.html", path: "/etsy-fee-calculator-canada", code: "CA",
    title: "Etsy Fee Calculator Canada — ShopProfit",
    description: "Estimate Etsy fees and seller profit in CAD for Canadian shops, including Canadian processing and the 0.50% regulatory operating fee.",
    h1: "Etsy Fee Calculator for Canadian Sellers",
    intro: "Estimate your Etsy take-home in Canadian dollars. The model includes the 6.5% transaction fee, Canadian payment-processing assumptions, and the published 0.50% regulatory operating fee; domestic and international processing can differ.",
    question: "What Etsy fees do sellers pay in Canada?",
    answer: "Canadian sellers should account for Etsy's listing fee, 6.5% transaction fee, payment-processing fees, and a 0.50% regulatory operating fee. Processing rates can vary for domestic, US, and international orders; the calculator uses the displayed estimate.",
  },
  {
    file: "etsy-fee-calculator-australia.html", path: "/etsy-fee-calculator-australia", code: "AU",
    title: "Etsy Fee Calculator Australia — ShopProfit",
    description: "Estimate Etsy fees and take-home profit in AUD for Australian sellers, with Australian payment-processing assumptions and local fee estimates.",
    h1: "Etsy Fee Calculator for Australian Sellers",
    intro: "Estimate your Etsy take-home in Australian dollars. This model includes the 6.5% transaction fee and Australian payment-processing assumptions; international orders and currency conversion may change your actual fees.",
    question: "What Etsy fees do sellers pay in Australia?",
    answer: "Australian sellers generally account for Etsy's listing fee, 6.5% transaction fee, and Australia-specific payment processing. Processing rates can differ for international orders; local fixed amounts shown here are estimates.",
  },
  {
    file: "etsy-digital-download-fee-calculator.html", path: "/etsy-digital-download-fee-calculator", code: "OTHER",
    title: "Etsy Digital Download Fee Calculator — ShopProfit",
    description: "Estimate Etsy fees and profit for a digital download. Set physical production and packaging costs to zero and calculate your take-home.",
    h1: "Etsy Digital Download Fee Calculator",
    intro: "Estimate what you keep from an Etsy digital download after transaction, listing, payment-processing, and applicable advertising fees. The preset removes production and packaging costs; enter any other costs that apply to your shop.",
    question: "How do Etsy fees affect a digital download?",
    answer: "Digital products still incur Etsy listing, transaction, and payment-processing fees, and attributed Offsite Ads may add a fee. Use the digital preset to set production and packaging costs to zero, then add any other costs relevant to your product.",
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
  html = replaceOnce(html, /<h2 id="calculator-heading">[\s\S]*?<\/h2>/, `<h2 id="calculator-heading">${route.h1}</h2>`, `${route.file} calculator heading`);
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
  const faq = JSON.parse(faqTag[1]);
  faq.mainEntity[0].name = route.question; faq.mainEntity[0].acceptedAnswer.text = route.answer;
  html = html.replace(faqTag[0], `<script type="application/ld+json" id="faq-structured-data">\n${JSON.stringify(faq)}\n  </script>`);
  if (route.code === "OTHER") html = html.replace('id="shipping" name="shipping" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="5"', 'id="shipping" name="shipping" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="0"')
    .replace('id="production" name="production" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="7"', 'id="production" name="production" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="0"')
    .replace('id="packaging" name="packaging" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="4"', 'id="packaging" name="packaging" type="number" inputmode="decimal" min="0" max="99999999" step="0.01" value="0"')
    .replace('id="digital-preset" aria-pressed="false"', 'id="digital-preset" aria-pressed="true"')
    .replace('id="digital-mode-note" hidden', 'id="digital-mode-note"');
  await writeFile(new URL(`../${route.file}`, import.meta.url), html);
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
console.log(`Generated ${routes.length} static SEO routes and populated the static fee table.`);
if (!SUPPORT_EMAIL) console.warn("LAUNCH BLOCKER: SUPPORT_EMAIL is unset; generated contact pages show a setup notice. Set it in Cloudflare Pages and rebuild before launch.");
