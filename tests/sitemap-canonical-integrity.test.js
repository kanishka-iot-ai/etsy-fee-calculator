import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const EXPECTED_SITEMAP_URLS = [
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
  "https://shopprofitcalculator.com/bulk/",
  "https://shopprofitcalculator.com/methodology/",
  "https://shopprofitcalculator.com/faq/",
  "https://shopprofitcalculator.com/privacy",
  "https://shopprofitcalculator.com/terms",
  "https://shopprofitcalculator.com/contact"
];

const CANONICAL_PATHS = new Set(EXPECTED_SITEMAP_URLS.map(u => new URL(u).pathname));

test("Phase 9C: sitemap.xml contains exactly the 16 expected canonical URLs in strict order", async () => {
  const sitemap = await readFile("sitemap.xml", "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.equal(locs.length, 16, "Sitemap must contain exactly 16 URLs");
  assert.deepEqual(locs, EXPECTED_SITEMAP_URLS, "Sitemap URLs must match expected canonical URLs");
});

test("Phase 9C: robots.txt allows all indexing and references canonical sitemap.xml", async () => {
  const robots = await readFile("robots.txt", "utf8");
  assert.match(robots, /User-agent:\s*\*/, "Robots.txt has wildcard User-agent");
  assert.match(robots, /Allow:\s*\//, "Robots.txt allows all paths");
  assert.match(robots, /Sitemap:\s*https:\/\/shopprofitcalculator\.com\/sitemap\.xml/, "Robots.txt declares sitemap location");
  assert.ok(!robots.includes("Disallow:"), "Robots.txt contains no Disallow rules blocking the 15 URLs");
});

test("Phase 9C: all static HTML pages declare exact canonical matching sitemap", async () => {
  for (const url of EXPECTED_SITEMAP_URLS) {
    const pathname = new URL(url).pathname;
    let filePath;
    if (pathname === "/") filePath = "index.html";
    else if (pathname.endsWith("/")) filePath = pathname.slice(1) + "index.html";
    else filePath = pathname.slice(1) + ".html";

    const html = await readFile(filePath, "utf8");
    const canonicalMatch = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i) ||
                           html.match(/<link\s+href=["']([^"']+)["']\s+rel=["']canonical["']/i);
    assert.ok(canonicalMatch, `${filePath} must contain a canonical link`);
    assert.equal(canonicalMatch[1], url, `${filePath} canonical must match sitemap URL exactly`);

    const robotsMeta = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)["']/i);
    if (robotsMeta) {
      assert.ok(!robotsMeta[1].includes("noindex"), `${filePath} robots meta must not specify noindex`);
    }
  }
});

test("Phase 9C: no sitemap URL is listed as a redirect source in _redirects", async () => {
  const redirects = await readFile("_redirects", "utf8");
  const redirectSources = redirects
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .map(line => line.split(/\s+/)[0]);

  for (const url of EXPECTED_SITEMAP_URLS) {
    const pathname = new URL(url).pathname;
    assert.ok(!redirectSources.includes(pathname), `Canonical URL ${pathname} must never be a redirect source in _redirects`);
  }
});

async function getHtmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "backups" || entry.name === "scratch") continue;
    const fullPath = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await getHtmlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }
  return files;
}

test("Phase 9C: all internal HTML navigation links point exclusively to canonical paths", async () => {
  const htmlFiles = await getHtmlFiles(".");
  const nonCanonicalLinks = [];

  for (const file of htmlFiles) {
    const content = await readFile(file, "utf8");
    const hrefs = [...content.matchAll(/href="([^"#][^"]*)"/g)].map(m => m[1]);
    for (const href of hrefs) {
      if (href.startsWith("http") && !href.startsWith("https://shopprofitcalculator.com")) continue;
      if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
      if (href.startsWith("/fonts/") || href.endsWith(".css") || href.endsWith(".svg") || href.endsWith(".png") || href.endsWith(".ico") || href.endsWith(".js") || href.endsWith(".mjs")) continue;

      let clean = href.replace("https://shopprofitcalculator.com", "").split("?")[0].split("#")[0];
      if (!clean) clean = "/";
      if (!CANONICAL_PATHS.has(clean)) {
        nonCanonicalLinks.push({ file, href, clean });
      }
    }
  }

  assert.equal(nonCanonicalLinks.length, 0, `All internal links must be canonical. Found non-canonical links: ${JSON.stringify(nonCanonicalLinks, null, 2)}`);
});
