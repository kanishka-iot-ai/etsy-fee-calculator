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
];
const attr = (html, expression) => html.match(expression)?.[1] ?? "";

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
    assert.ok(h1s[0][1].replace(/<[^>]+>/g, "").trim().length > 5, `${file} static H1 text`);
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
    assert.ok(faq && faq.mainEntity.length >= 10);
    for (const answerTitle of ["How do I calculate Etsy profit?", "How much should I charge on Etsy?", "What is an Etsy break-even price?"]) {
      assert.ok(html.includes(`<summary>${answerTitle}</summary>`), `${file} shows AEO answer ${answerTitle}`);
      assert.ok(faq.mainEntity.some((item) => item.name === answerTitle), `${file} schema includes ${answerTitle}`);
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

test("methodology and FAQ routes are indexable, crawlable resources with canonical metadata", async () => {
  const redirects = await read("../_redirects");
  const sitemap = await read("../sitemap.xml");
  for (const [file, route, expectedTitle] of [
    ["../methodology.html", "/methodology", "Etsy Profit Calculator Methodology | ShopProfit"],
    ["../faq.html", "/faq", "Etsy Profit Calculator FAQ | ShopProfit"],
  ]) {
    const html = await read(file);
    assert.equal(attr(html, /<link rel="canonical" href="([^"]+)"\s*>/), `https://shopprofitcalculator.com${route}`);
    assert.equal(attr(html, /<title>([^<]+)<\/title>/), expectedTitle);
    assert.match(html, /<h1\b/);
    assert.ok(html.includes('content="ShopProfit"'));
    assert.ok(html.includes('social-preview.png'));
    assert.ok(sitemap.includes(`<loc>https://shopprofitcalculator.com${route}</loc>`));
    assert.ok(!redirects.includes(`${route} ${route}.html 200`), "no looping 200 rewrite rules in _redirects");
    const dirIndex = await read(`..${route}/index.html`);
    assert.ok(dirIndex.includes(expectedTitle), `${route}/index.html served natively`);
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
    ["/etsy-profit-calculator", "/ 301"], ["/etsy-fee-calculator", "/#fees 301"],
    ["/etsy-pricing-calculator", "/#target-pricing 301"], ["/etsy-break-even-calculator", "/#break-even-tool 301"],
    ["/etsy-offsite-ads-calculator", "/#offsite-ads 301"],
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
  for (const header of ["X-Content-Type-Options: nosniff", "Referrer-Policy: strict-origin-when-cross-origin", "X-Frame-Options: DENY", "Permissions-Policy: camera=(), microphone=(), geolocation=()"])
    assert.ok(headers.includes(header));
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
