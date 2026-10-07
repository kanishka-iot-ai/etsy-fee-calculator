import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const pages = [
  ["../index.html", "/"],
  ["../etsy-fee-calculator-uk.html", "/etsy-fee-calculator-uk"],
  ["../etsy-fee-calculator-canada.html", "/etsy-fee-calculator-canada"],
  ["../etsy-fee-calculator-australia.html", "/etsy-fee-calculator-australia"],
  ["../etsy-digital-download-fee-calculator.html", "/etsy-digital-download-fee-calculator"],
  ["../etsy-pricing-calculator.html", "/etsy-pricing-calculator/"],
  ["../etsy-break-even-calculator.html", "/etsy-break-even-calculator/"],
  ["../etsy-offsite-ads-calculator.html", "/etsy-offsite-ads-calculator/"],
  ["../etsy-print-on-demand-calculator.html", "/etsy-print-on-demand-calculator/"],
];
const attr = (html, expression) => html.match(expression)?.[1] ?? "";

const expectedH1s = {
  "/": "Etsy Profit Calculator",
  "/etsy-fee-calculator-uk": "Etsy Fee Calculator UK",
  "/etsy-fee-calculator-canada": "Etsy Fee Calculator Canada",
  "/etsy-fee-calculator-australia": "Etsy Fee Calculator Australia",
  "/etsy-digital-download-fee-calculator": "Etsy Digital Download Fee Calculator",
  "/etsy-pricing-calculator/": "Etsy Pricing Calculator",
  "/etsy-break-even-calculator/": "Etsy Break-Even Calculator",
  "/etsy-offsite-ads-calculator/": "Etsy Offsite Ads Calculator",
  "/etsy-print-on-demand-calculator/": "Etsy Print on Demand Calculator",
};

test("all indexable pages have static unique titles, descriptions, canonicals, H1s, and JSON-LD", async () => {
  const titles = new Set();
  for (const [file, canonical] of pages) {
    const html = await read(file);
    const title = attr(html, /<title>([^<]+)<\/title>/);
    const description = attr(html, /<meta name="description" content="([^"]+)">/);
    const canonicalUrl = attr(html, /<link rel="canonical" href="([^"]+)">/);
    const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
    assert.ok(title, `${file} static title`);
    assert.ok(description.length >= 60, `${file} static description`);
    assert.equal(canonicalUrl, `https://shopprofitcalculator.com${canonical}`);
    assert.equal(h1s.length, 1, `${file} has one static H1`);
    const h1Text = h1s[0][1].replace(/<[^>]+>/g, "").trim();
    assert.equal(h1Text, expectedH1s[canonical], `${file} primary H1 matches page topic`);
    assert.ok(!html.includes('<h1 class="hero-title"'), `${file} hero-title slogan is not an H1`);
    assert.ok(html.includes('id="hero-title"'), `${file} preserves hero-title element`);
    assert.ok(html.includes("class=\"hero-description\">"), `${file} has static introduction`);
    assert.match(html, /id="fee-table-body">\s*<tr/, `${file} static fee rows`);
    assert.ok(html.includes("id=\"how-it-works\""), `${file} static methodology`);
    assert.ok(html.includes("id=\"faq-list\""), `${file} static FAQ`);
    assert.ok(html.includes("/etsy-fee-calculator-uk") && html.includes("/etsy-digital-download-fee-calculator"), `${file} links to regional and digital tools`);
    assert.ok(html.includes(`<meta property="og:url" content="${canonicalUrl}">`));
    assert.ok(html.includes('property="og:site_name" content="ShopProfit"'));
    assert.ok(html.includes('property="og:image" content="https://shopprofitcalculator.com/social-preview.png"'));
    assert.match(html, /<meta name="twitter:title" content="[^"]+">/);
    const jsonScripts = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>\s*([\s\S]*?)\s*<\/script>/g)];
    assert.ok(jsonScripts.length >= 2, `${file} has WebApplication and FAQ schemas`);
    const schemas = jsonScripts.map((match) => JSON.parse(match[1]));
    const graph = schemas.find((schema) => schema["@graph"]);
    assert.ok(graph["@graph"].some((node) => node["@type"] === "Organization"));
    assert.ok(graph["@graph"].some((node) => node["@type"] === "WebSite"));
    assert.ok(graph["@graph"].some((node) => node["@type"] === "WebApplication"));
    assert.ok(graph["@graph"].some((node) => node["@type"] === "BreadcrumbList"));
    const faq = schemas.find((schema) => schema["@type"] === "FAQPage");
    assert.ok(faq, `${file} has FAQPage schema`);
    if (canonical === "/etsy-fee-calculator-uk") {
      assert.ok(faq.mainEntity.length >= 6, `${file} UK FAQ schema has at least 6 questions`);
      for (const answerTitle of [
        "What Etsy fees do sellers pay in the United Kingdom?",
        "What is the 0.48% UK regulatory operating fee on Etsy?",
        "Does Etsy charge fees on shipping and postage in the UK?",
        "How do Etsy Offsite Ads work for UK shops?",
        "How do I calculate net profit for an Etsy sale in the UK?"
      ]) {
        assert.ok(html.includes(`<summary>${answerTitle}</summary>`), `${file} shows UK answer ${answerTitle}`);
        assert.ok(faq.mainEntity.some((item) => item.name === answerTitle), `${file} schema includes ${answerTitle}`);
      }
      assert.ok(html.includes("Etsy UK Seller Fee &amp; Profit Strategy"), `${file} contains UK seller guides`);
      assert.ok(html.includes("The UK Regulatory Operating Fee (0.48%): How It Adds Up"), `${file} contains UK regulatory guide`);
      assert.ok(html.includes("Royal Mail &amp; Postage Economics"), `${file} contains Royal Mail guide`);
      assert.ok(html.includes("gross revenue = item price + buyer postage (GBP)"), `${file} contains UK profit formula`);
    } else if (canonical === "/etsy-fee-calculator-canada") {
      assert.ok(faq.mainEntity.length >= 6, `${file} Canada FAQ schema has at least 6 questions`);
      for (const answerTitle of [
        "What fees does Etsy charge sellers in Canada?",
        "What is the 0.50% Canadian regulatory operating fee on Etsy?",
        "How does Etsy payment processing work for Canadian sellers?",
        "Does Etsy charge fees on shipping in Canada?",
        "How do Etsy Offsite Ads work for Canadian shops?"
      ]) {
        assert.ok(html.includes(`<summary>${answerTitle}</summary>`), `${file} shows Canada answer ${answerTitle}`);
        assert.ok(faq.mainEntity.some((item) => item.name === answerTitle), `${file} schema includes ${answerTitle}`);
      }
      assert.ok(html.includes("Etsy Canada Seller Fee &amp; Profit Strategy"), `${file} contains Canada seller guides`);
      assert.ok(html.includes("The Canadian Regulatory Operating Fee (0.50%): How It Adds Up"), `${file} contains Canada regulatory guide`);
      assert.ok(html.includes("Canada Post &amp; Shipping Economics"), `${file} contains Canada Post guide`);
      assert.ok(html.includes("gross revenue = item price + buyer shipping (CAD)"), `${file} contains Canada profit formula`);
    } else if (canonical === "/etsy-fee-calculator-australia") {
      assert.ok(faq.mainEntity.length >= 6, `${file} Australia FAQ schema has at least 6 questions`);
      for (const answerTitle of [
        "What fees does Etsy charge sellers in Australia?",
        "Does Etsy charge a regulatory operating fee in Australia?",
        "How does Etsy payment processing work for Australian sellers?",
        "Does Etsy charge fees on shipping in Australia?",
        "How do Etsy Offsite Ads work for Australian shops?"
      ]) {
        assert.ok(html.includes(`<summary>${answerTitle}</summary>`), `${file} shows Australia answer ${answerTitle}`);
        assert.ok(faq.mainEntity.some((item) => item.name === answerTitle), `${file} schema includes ${answerTitle}`);
      }
      assert.ok(html.includes("Etsy Australia Seller Fee &amp; Profit Strategy"), `${file} contains Australia seller guides`);
      assert.ok(html.includes("Regulatory Operating Fees: Why Australia Pays 0% on Etsy"), `${file} contains Australia regulatory guide`);
      assert.ok(html.includes("Australia Post &amp; Shipping Economics"), `${file} contains Australia Post guide`);
      assert.ok(html.includes("gross revenue = item price + buyer shipping (AUD)"), `${file} contains Australia profit formula`);
    } else if (canonical === "/etsy-digital-download-fee-calculator") {
      assert.ok(faq.mainEntity.length >= 6, `${file} Digital FAQ schema has at least 6 questions`);
      for (const answerTitle of [
        "What fees does Etsy charge on digital downloads?",
        "Does Etsy charge transaction fees on digital products?",
        "Do Etsy payment processing fees apply to digital downloads?",
        "Do Offsite Ads fees apply to Etsy digital downloads?",
        "How should I price a digital download after Etsy fees?",
        "Can I calculate the break-even price for an Etsy digital product?"
      ]) {
        assert.ok(html.includes(`<summary>${answerTitle}</summary>`), `${file} shows Digital answer ${answerTitle}`);
        assert.ok(faq.mainEntity.some((item) => item.name === answerTitle), `${file} schema includes ${answerTitle}`);
      }
      assert.ok(html.includes("Etsy Digital Download Fee &amp; Profit Strategy"), `${file} contains Digital seller guides`);
      assert.ok(html.includes("How to Price Etsy Digital Downloads After Fees"), `${file} contains Digital pricing guide`);
      assert.ok(html.includes("Etsy Digital Product Profit Margins: The Low-Ticket Trap"), `${file} contains Low-ticket trap guide`);
      assert.ok(html.includes("Realistic Digital Download Economics Across Product Types"), `${file} contains Digital examples benchmark`);
      assert.ok(html.includes("gross revenue = digital download price (shipping = $0.00)"), `${file} contains Digital profit formula`);
    } else if (canonical === "/etsy-pricing-calculator/") {
      assert.ok(faq.mainEntity.length >= 6, `${file} Pricing FAQ schema has at least 6 questions`);
      for (const answerTitle of [
        "How do I calculate what price to charge on Etsy?",
        "Why does simple cost markup result in lower profit on Etsy?",
        "What is the difference between markup and profit margin on Etsy?",
        "How do Etsy fees affect my pricing strategy?",
        "How should I price items when offering free shipping on Etsy?",
        "How does the Etsy target profit solver work?"
      ]) {
        assert.ok(html.includes(`<summary>${answerTitle}</summary>`), `${file} shows Pricing answer ${answerTitle}`);
        assert.ok(faq.mainEntity.some((item) => item.name === answerTitle), `${file} schema includes ${answerTitle}`);
      }
      assert.ok(html.includes("Etsy Pricing Strategy &amp; Margin Protection"), `${file} contains Pricing seller guides`);
      assert.ok(html.includes("Why Simple Percentage Markups Fail on Etsy"), `${file} contains markup failure guide`);
      assert.ok(html.includes("Target Pricing: Solving Backward Through Platform Fees"), `${file} contains reverse math guide`);
      assert.ok(html.includes("required price = solver(target profit, materials, packaging, buyer shipping, platform fees)"), `${file} contains pricing formula`);
    } else if (canonical === "/etsy-break-even-calculator/") {
      assert.ok(faq.mainEntity.length >= 6, `${file} Break-Even FAQ schema has at least 6 questions`);
      for (const answerTitle of [
        "What is an Etsy break-even price?",
        "How do I calculate my break-even price on Etsy?",
        "What happens if I sell below my Etsy break-even price?",
        "How do fixed fees impact the break-even price of cheap items?",
        "How does Offsite Ads affect my break-even price?",
        "What is monthly volume break-even on Etsy?"
      ]) {
        assert.ok(html.includes(`<summary>${answerTitle}</summary>`), `${file} shows Break-Even answer ${answerTitle}`);
        assert.ok(faq.mainEntity.some((item) => item.name === answerTitle), `${file} schema includes ${answerTitle}`);
      }
      assert.ok(html.includes("Etsy Break-Even Analysis &amp; Floor Price Strategy"), `${file} contains Break-Even seller guides`);
      assert.ok(html.includes("Per-Unit Floor vs. Monthly Volume Break-Even"), `${file} contains floor vs volume guide`);
      assert.ok(html.includes("The Fixed Fee Penalty: How $0.45 Minimums Impact Cheap Items"), `${file} contains fixed fee penalty guide`);
      assert.ok(html.includes("break-even price = minimum retail price where Net Profit = $0.00"), `${file} contains break-even formula`);
    } else if (canonical === "/etsy-offsite-ads-calculator/") {
      assert.ok(faq.mainEntity.length >= 6, `${file} Offsite Ads FAQ schema has at least 6 questions`);
      for (const answerTitle of [
        "How much does Etsy charge for Offsite Ads?",
        "Can I opt out of Etsy Offsite Ads?",
        "How does the $10,000 threshold for Etsy Offsite Ads work?",
        "Is there a maximum limit or cap on Etsy Offsite Ads fees?",
        "Does Etsy charge the Offsite Ads fee on shipping?",
        "How long does Etsy's Offsite Ads attribution window last?"
      ]) {
        assert.ok(html.includes(`<summary>${answerTitle}</summary>`), `${file} shows Offsite Ads answer ${answerTitle}`);
        assert.ok(faq.mainEntity.some((item) => item.name === answerTitle), `${file} schema includes ${answerTitle}`);
      }
      assert.ok(html.includes("Etsy Offsite Ads Fee &amp; Margin Strategy"), `${file} contains Offsite Ads seller guides`);
      assert.ok(html.includes("15% Optional vs. 12% Mandatory: The $10,000 Threshold"), `${file} contains tier guide`);
      assert.ok(html.includes("The Statutory $100 Per-Order Cap: High-Ticket Protection"), `${file} contains $100 cap guide`);
      assert.ok(html.includes("ad fee = min(order total × selected ad rate, $100 USD equivalent cap)"), `${file} contains ad fee formula`);
    } else if (canonical === "/etsy-print-on-demand-calculator/") {
      assert.ok(faq.mainEntity.length >= 6, `${file} POD FAQ schema has at least 6 questions`);
      for (const answerTitle of [
        "How do I calculate profit for Etsy print on demand?",
        "What fees does Etsy charge on print on demand products?",
        "What is a realistic profit margin for print on demand on Etsy?",
        "Does Etsy charge fees on print-on-demand shipping?",
        "How do Printify and Printful production costs interact with Etsy fees?",
        "How should I price a POD t-shirt or hoodie on Etsy?"
      ]) {
        assert.ok(html.includes(`<summary>${answerTitle}</summary>`), `${file} shows POD answer ${answerTitle}`);
        assert.ok(faq.mainEntity.some((item) => item.name === answerTitle), `${file} schema includes ${answerTitle}`);
      }
      assert.ok(html.includes("Etsy Print on Demand Profit &amp; Margin Strategy"), `${file} contains POD seller guides`);
      assert.ok(html.includes("The 2-Leg Shipping Trap in Print on Demand"), `${file} contains 2-leg shipping guide`);
      assert.ok(html.includes("Realistic Profit Margin Benchmarks for Etsy POD"), `${file} contains POD margin benchmarks`);
      assert.ok(html.includes("fulfillment costs = print provider item cost + print provider shipping cost"), `${file} contains POD formula`);
    } else {
      assert.ok(faq.mainEntity.length >= 10);
      for (const answerTitle of ["How do I calculate Etsy profit?", "How much should I charge on Etsy?", "What is an Etsy break-even price?"]) {
        assert.ok(html.includes(`<summary>${answerTitle}</summary>`), `${file} shows AEO answer ${answerTitle}`);
        assert.ok(faq.mainEntity.some((item) => item.name === answerTitle), `${file} schema includes ${answerTitle}`);
      }
    }
    if (canonical !== "/") assert.ok(!titles.has(title), `${file} title is unique`);
    titles.add(title);
  }
});

test("sitemap and internal navigation expose every regional route; missing paths use 404, not 410", async () => {
  const sitemap = await read("../sitemap.xml");
  const robots = await read("../robots.txt");
  const redirects = await read("../_redirects");
  const footer = await read("../index.html");
  for (const [, path] of pages) {
    assert.ok(sitemap.includes(`https://shopprofitcalculator.com${path}</loc>`), `sitemap includes ${path}`);
    if (path !== "/") assert.ok(footer.includes(`href="${path}"`), `home footer links ${path}`);
  }
  assert.ok(robots.includes("Sitemap: https://shopprofitcalculator.com/sitemap.xml"));
  assert.ok(!sitemap.includes("404"));
  assert.ok(!redirects.match(/\s410(?:\s|$)/), "no unnecessary 410 rules");
  const notFound = await read("../404.html");
  assert.ok(notFound.includes("name=\"robots\" content=\"noindex,follow\""));
  assert.ok(notFound.includes("href=\"/\""));
});

test("static page retains useful content without JavaScript and initializes the country selector", async () => {
  const html = await read("../index.html");
  const { COUNTRY_ORDER } = await import("../src/countries.js");
  assert.ok(html.includes("<noscript>"));
  assert.match(html, /<select class="country-nav" id="country-nav" aria-label="Seller location"><option value="US">United States<\/option>/);
  assert.match(html, /<select id="country" name="country"><option value="US">United States<\/option>/);
  assert.ok(html.includes("data:image" ) === false, "core SEO copy is semantic text, not embedded imagery");
  assert.equal((html.match(/<tr><th scope="row">/g) || []).length, COUNTRY_ORDER.length);
  assert.ok(html.includes("value=\"ja-JP\">日本語</option>"));
  assert.match(html, /id="summary-break-even"/);
  assert.match(html, /id="summary-required-price"/);
});

test("responsive and reduced-motion rules are present in the stylesheet", async () => {
  const css = await read("../styles.css");
  assert.match(css, /@media\s*\(max-width:\s*380px\)/);
  assert.match(css, /@media\s*\(max-width:\s*560px\)/);
  assert.match(css, /@media\s*\(min-width:\s*561px\)\s*and\s*\(max-width:\s*900px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /\.result-panel\s*\{[^}]*position:\s*sticky/s);
});

test("digital calculator static defaults remove physical shipping and costs", async () => {
  const html = await read("../etsy-digital-download-fee-calculator.html");
  for (const id of ["shipping", "production", "packaging"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*value="0"`));
  }
  assert.match(html, /id="digital-preset" aria-pressed="true"/);
  assert.match(html, /id="digital-mode-note">Digital mode sets buyer shipping/);
});

test("brand mark and favicon share a crisp pixel SVG without replacing bitmap typography", async () => {
  const [html, mark, favicon, css] = await Promise.all([
    read("../index.html"), read("../logo-mark.svg"), read("../favicon.svg"), read("../styles.css"),
  ]);
  assert.equal((html.match(/src="\/logo-mark\.svg"/g) || []).length, 2);
  assert.match(html, /FREE ETSY PROFIT, FEE &amp; PRICING CALCULATOR/);
  assert.match(mark, /shape-rendering="crispEdges"/);
  assert.match(favicon, /shape-rendering="crispEdges"/);
  assert.equal(mark.match(/<path[^>]*d="([^"]+)"/)?.[1], favicon.match(/<path[^>]*d="([^"]+)"/)?.[1]);
  assert.match(css, /\.brand-mark img\s*\{[^}]*image-rendering:\s*pixelated/s);
  assert.match(css, /--font-display:\s*"Silkscreen"/);
});

test("fees, methodology and FAQ routes are indexable, crawlable resources with canonical metadata", async () => {
  const redirects = await read("../_redirects");
  const sitemap = await read("../sitemap.xml");
  for (const [file, route, expectedTitle] of [
    ["../fees.html", "/fees/", "Etsy Fee Calculator — Calculate Etsy Seller Fees | ShopProfit"],
    ["../methodology.html", "/methodology/", "Etsy Profit Calculator Methodology | How ShopProfit Calculates Profit"],
    ["../faq.html", "/faq/", "Etsy Profit Calculator FAQ – Etsy Fees &amp; Profit Questions | ShopProfit"],
  ]) {
    const html = await read(file);
    assert.equal(attr(html, /<link rel="canonical" href="([^"]+)"\s*>/), `https://shopprofitcalculator.com${route}`);
    assert.equal(attr(html, /<title>([^<]+)<\/title>/), expectedTitle);
    assert.match(html, /<h1\b/);
    assert.ok(html.includes('content="ShopProfit"'));
    assert.ok(html.includes('social-preview.png'));
    assert.ok(sitemap.includes(`<loc>https://shopprofitcalculator.com${route}</loc>`));
    assert.ok(!redirects.includes(`${route} ${route}.html 200`), "no looping 200 rewrite rules in _redirects");
    const dir = route.replace(/\/$/, "");
    const dirIndex = await read(`..${dir}/index.html`);
    assert.ok(dirIndex.includes(expectedTitle), `${route} index.html served natively`);
    const scripts = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    for (const [, json] of scripts) assert.doesNotThrow(() => JSON.parse(json));
    assert.ok(html.includes('href="/#calculator"'));
  }
  const faq = await read("../faq.html");
  assert.match(faq, /id="faq-schema"/);
  assert.match(faq, /<details[^>]*><summary>How do I calculate Etsy profit\?/);
  const methodology = await read("../methodology.html");
  assert.match(methodology, /net profit = gross revenue − platform fees − production cost − packaging\/shipping cost − Etsy Plus allocation/);
  for (const [path, target] of [
    ["/etsy-profit-calculator", "/ 301"], ["/etsy-fee-calculator", "/fees/ 301"],
    ["/etsy-pricing-calculator", "/etsy-pricing-calculator/ 301"], ["/etsy-break-even-calculator", "/etsy-break-even-calculator/ 301"],
    ["/etsy-offsite-ads-calculator", "/etsy-offsite-ads-calculator/ 301"],
    ["/etsy-pod-calculator", "/etsy-print-on-demand-calculator/ 301"],
    ["/etsy-digital-product-calculator", "/etsy-digital-download-fee-calculator 301"],
  ]) assert.ok(redirects.includes(`${path} ${target}`), `${path} resolves to the corresponding existing tool`);
});

test("fee guide includes transaction, payment processing, regulatory, and notes columns", async () => {
  const html = await read("../index.html");
  const app = await read("../src/app.js");
  assert.match(html, /<th scope="col">Transaction fee<\/th>/);
  assert.match(html, /<th scope="col">Payment processing<\/th>/);
  assert.match(html, /<th scope="col">Regulatory fee<\/th>/);
  assert.match(html, /<th scope="col">Notes<\/th>/);
  assert.match(html, /<td>6\.5%<\/td><td>3% \+ \$0\.25<\/td>/);
  const rows = [...html.matchAll(/<tbody id="fee-table-body">([\s\S]*?)<\/tbody>/g)][0][1].match(/<tr>[\s\S]*?<\/tr>/g);
  assert.equal(rows.length, 12);
  for (const row of rows) assert.equal((row.match(/<td>/g) || []).length, 6);
  assert.match(app, /function renderFeeTable\(\)/);
  assert.match(app, /TRANSACTION_RATE/);
  assert.match(app, /<th scope="row">/);
  assert.match(app, /c\.processingNote \|\| "Default processing estimate; international order rates may differ\."/);
});

test("social preview PNG and ShopProfit route share assets exist", async () => {
  const png = await readFile(new URL("../social-preview.png", import.meta.url));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test("privacy and terms links resolve to crawlable legal pages", async () => {
  const home = await read("../index.html");
  const sitemap = await read("../sitemap.xml");
  const redirects = await read("../_redirects");
  assert.match(home, /<a href="\/privacy">Privacy<\/a>/);
  assert.match(home, /<a href="\/terms">Terms<\/a>/);
  for (const [file, route, title] of [
    ["../privacy.html", "/privacy", "Privacy Notice | ShopProfit"],
    ["../terms.html", "/terms", "Terms of Use | ShopProfit"],
  ]) {
    const html = await read(file);
    assert.equal(attr(html, /<link rel="canonical" href="([^"]+)"/), `https://shopprofitcalculator.com${route}`);
    assert.equal(attr(html, /<title>([^<]+)<\/title>/), title);
    assert.match(html, /<h1\b/);
    assert.ok(!redirects.includes(`${route} ${route}.html 200`), "no looping 200 rewrite rules in _redirects");
    const dirIndex = await read(`..${route}/index.html`);
    assert.ok(dirIndex.includes(title), `${route}/index.html served natively`);
    const schema = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(schema);
    assert.doesNotThrow(() => JSON.parse(schema));
  }
  const privacy = await read("../privacy.html");
  assert.match(privacy, /browser’s local storage/);
  assert.match(privacy, /not sent until you send it/);
  const terms = await read("../terms.html");
  assert.match(terms, /not affiliated with, endorsed by, or operated by Etsy/);
  assert.ok(privacy.includes('href="/terms"'));
  assert.ok(terms.includes('href="/privacy"'));
});

test("primary result exposes separate total platform fees and business costs", async () => {
  const [html, app] = await Promise.all([read("../index.html"), read("../src/app.js")]);
  assert.match(html, /id="total-fees"/);
  assert.match(html, /id="total-costs"/);
  assert.match(app, /setOutput\("#total-fees", formatCents\(data\.feesCents\)\)/);
  assert.match(app, /setOutput\("#total-costs", formatCents\(data\.costsCents\)\)/);
  assert.match(app, /TOTAL PLATFORM FEES:/);
  assert.match(app, /TOTAL BUSINESS COSTS:/);
});

test("Cloudflare Pages security headers are configured without blocking app resources", async () => {
  const headers = await read("../_headers");
  for (const header of [
    "Strict-Transport-Security: max-age=31536000; includeSubDomains",
    "X-Content-Type-Options: nosniff",
    "Referrer-Policy: strict-origin-when-cross-origin",
    "X-Frame-Options: DENY",
    "Permissions-Policy: camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy: default-src 'self'"
  ])
    assert.ok(headers.includes(header));
});

test("pages.dev deployments receive X-Robots-Tag: noindex, nofollow while apex domain remains indexable", async () => {
  const headers = await read("../_headers");
  assert.match(headers, /https:\/\/:\w*\.?pages\.dev\/\*[\s\S]*?X-Robots-Tag: noindex, nofollow/);
  const globalBlock = headers.split("https://")[0];
  assert.ok(!globalBlock.includes("X-Robots-Tag"), "Global /* rule must NOT include X-Robots-Tag");
});

test("contact information is configured through SUPPORT_EMAIL and missing configuration blocks launch check", async () => {
  const config = await read("../scripts/site-config.mjs");
  const checker = await read("../scripts/check-launch-readiness.mjs");
  const build = await read("../scripts/generate-seo-pages.mjs");
  const pkg = JSON.parse(await read("../package.json"));
  assert.match(config, /site-config\.json/);
  assert.match(checker, /LAUNCH BLOCKED/);
  assert.match(build, /SUPPORT_EMAIL is unset/);
  assert.ok(pkg.scripts["check:launch"]);
  const siteConfig = JSON.parse(await read("../config/site-config.json"));
  assert.equal(siteConfig.SUPPORT_EMAIL, "info@shopprofitcalculator.com");
});

test("contact page, official fee references, and transparent country assumptions are crawlable", async () => {
  const [contact, methodology, routes, sitemap, app] = await Promise.all([
    read("../contact.html"), read("../methodology.html"), read("../_redirects"), read("../sitemap.xml"), read("../src/app.js"),
  ]);
  assert.match(contact, /<title>Contact ShopProfit<\/title>/);
  assert.ok(!routes.includes("/contact /contact.html 200"), "no looping 200 rewrite rule for contact");
  const contactIndex = await read("../contact/index.html");
  assert.match(contactIndex, /<title>Contact ShopProfit<\/title>/);
  assert.match(sitemap, /https:\/\/shopprofitcalculator\.com\/contact/);
  assert.match(methodology, /Fee information is based on Etsy's published fee schedules and may change/);
  assert.match(methodology, /115015628847-What-are-Payment-Processing-Fees/);
  assert.match(methodology, /1500011073202-What-is-a-Regulatory-Operating-Fee/);
  assert.match(app, /c\.processingNote/);
});

test("dedicated /fees/ route satisfies all AEO, GEO, schema, and internal linking standards", async () => {
  const [fees, feesDir, home, sitemap] = await Promise.all([
    read("../fees.html"), read("../fees/index.html"), read("../index.html"), read("../sitemap.xml"),
  ]);
  assert.equal(attr(fees, /<link rel="canonical" href="([^"]+)"/), "https://shopprofitcalculator.com/fees/");
  assert.match(fees, /<h1\b[^>]*>Etsy Fee Calculator<\/h1>/);
  assert.equal((fees.match(/<h1\b/g) || []).length, 1, "fees.html has exactly one H1");
  assert.ok(fees.includes('id="sale-form"'), "fees.html contains interactive fee calculator");
  assert.ok(fees.includes('id="result-heading"'), "fees.html contains fee breakdown ledger");
  assert.ok(fees.includes("Direct Answer:"), "contains direct answer block for AEO");
  assert.ok(fees.includes("fee-stat-grid"), "contains key rate visual callouts");
  assert.ok(fees.includes("Scenario 1: $10 Digital Download"), "contains worked example 1");
  assert.ok(fees.includes("Scenario 2: $35 Handmade Ceramic Mug"), "contains worked example 2");
  assert.ok(fees.includes("Scenario 3: £28 Handmade Item with 0.48% Regulatory Fee"), "contains worked example 3");
  assert.ok(fees.includes('href="/#calculator"'), "links directly to homepage calculator");
  assert.ok(fees.includes('href="/methodology/"'), "links to methodology");
  assert.ok(fees.includes('href="/faq/"'), "links to faq");
  assert.ok(home.includes('href="/fees/"'), "homepage links to /fees/");
  assert.ok(sitemap.includes("<loc>https://shopprofitcalculator.com/fees/</loc>"), "sitemap lists /fees/");
  assert.equal(fees, feesDir, "fees/index.html matches fees.html for native Cloudflare Pages directory serving");
  
  const faqMatch = fees.match(/<script type="application\/ld\+json" id="fees-faq-schema">([\s\S]*?)<\/script>/);
  assert.ok(faqMatch, "has dedicated FAQPage schema");
  const faqSchema = JSON.parse(faqMatch[1]);
  assert.equal(faqSchema["@type"], "FAQPage");
  assert.ok(faqSchema.mainEntity.length >= 6, "has at least 6 FAQs");
  for (const q of faqSchema.mainEntity) {
    assert.ok(q.name && q.acceptedAnswer?.text);
  }
});

test("sitemap.xml is valid XML with exactly 15 canonical URLs and explicit application/xml header rule", async () => {
  const [sitemap, headers, redirects] = await Promise.all([
    read("../sitemap.xml"),
    read("../_headers"),
    read("../_redirects"),
  ]);

  assert.ok(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "starts with XML declaration");
  assert.ok(sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), "valid urlset namespace");
  assert.ok(sitemap.trim().endsWith("</urlset>"), "valid closing urlset tag");

  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, 15, "contains exactly 15 URLs");

  const expectedUrls = [
    "https://shopprofitcalculator.com/",
    "https://shopprofitcalculator.com/etsy-fee-calculator-uk",
    "https://shopprofitcalculator.com/etsy-fee-calculator-canada",
    "https://shopprofitcalculator.com/etsy-fee-calculator-australia",
    "https://shopprofitcalculator.com/etsy-digital-download-fee-calculator",
    "https://shopprofitcalculator.com/etsy-pricing-calculator/",
    "https://shopprofitcalculator.com/etsy-break-even-calculator/",
    "https://shopprofitcalculator.com/etsy-offsite-ads-calculator/",
    "https://shopprofitcalculator.com/etsy-print-on-demand-calculator/",
    "https://shopprofitcalculator.com/fees/",
    "https://shopprofitcalculator.com/methodology/",
    "https://shopprofitcalculator.com/faq/",
    "https://shopprofitcalculator.com/privacy",
    "https://shopprofitcalculator.com/terms",
    "https://shopprofitcalculator.com/contact",
  ];
  assert.deepEqual(locs, expectedUrls, "contains exactly the 15 production URLs in order");

  assert.ok(!sitemap.includes("pages.dev"), "no pages.dev URLs in sitemap");

  const uniqueLocs = new Set(locs);
  assert.equal(uniqueLocs.size, 15, "no duplicate URLs");

  const redirectSources = redirects
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[0])
    .filter(Boolean);
  for (const url of locs) {
    const path = new URL(url).pathname;
    assert.ok(!redirectSources.includes(path), `sitemap URL ${url} is not a redirect source`);
  }

  assert.match(
    headers,
    /\/sitemap\.xml\s*\n\s*Content-Type:\s*application\/xml\s*\n\s*Cache-Control:\s*public,\s*max-age=3600/,
    "_headers configures Content-Type application/xml and Cache-Control for /sitemap.xml"
  );
  assert.ok(!headers.includes("/sitemap.xml\n  X-Robots-Tag"), "sitemap rule has no noindex");
});

