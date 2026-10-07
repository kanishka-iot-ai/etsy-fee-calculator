import { readFile } from "node:fs/promises";

const pages = [
  { url: "/", file: "index.html" },
  { url: "/fees/", file: "fees.html" },
  { url: "/etsy-pricing-calculator/", file: "etsy-pricing-calculator.html" },
  { url: "/etsy-break-even-calculator/", file: "etsy-break-even-calculator.html" },
  { url: "/etsy-offsite-ads-calculator/", file: "etsy-offsite-ads-calculator.html" },
  { url: "/etsy-print-on-demand-calculator/", file: "etsy-print-on-demand-calculator.html" },
  { url: "/etsy-digital-download-fee-calculator", file: "etsy-digital-download-fee-calculator.html" },
  { url: "/etsy-fee-calculator-uk", file: "etsy-fee-calculator-uk.html" },
  { url: "/etsy-fee-calculator-canada", file: "etsy-fee-calculator-canada.html" },
  { url: "/etsy-fee-calculator-australia", file: "etsy-fee-calculator-australia.html" },
  { url: "/methodology/", file: "methodology.html" },
  { url: "/faq/", file: "faq.html" },
  { url: "/privacy", file: "privacy.html" },
  { url: "/terms", file: "terms.html" },
  { url: "/contact", file: "contact.html" }
];

async function runAudit() {
  console.log("=== SEO SAFETY AUDIT DATA COLLECTION ===\n");

  for (const page of pages) {
    const html = await readFile(page.file, "utf8");
    const jsonScripts = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    
    // 1. FAQ Audit
    let faqSchema = null;
    let webAppSchema = null;
    let otherSchemas = [];

    for (const [, json] of jsonScripts) {
      try {
        const parsed = JSON.parse(json);
        if (parsed["@type"] === "FAQPage") faqSchema = parsed;
        if (parsed["@graph"]) {
          for (const node of parsed["@graph"]) {
            if (node["@type"] === "WebApplication") webAppSchema = node;
            else otherSchemas.push(node["@type"]);
          }
        }
      } catch (e) {
        console.error(`JSON Parse error in ${page.url}:`, e);
      }
    }

    // Visible FAQs
    const visibleSummaries = [...html.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
    // Filter out menu/control summaries (e.g., Advanced options, Compare scenarios)
    const faqSummaries = visibleSummaries.filter(s => s.includes("?") || s.startsWith("What") || s.startsWith("How") || s.startsWith("Why") || s.startsWith("Does") || s.startsWith("Do") || s.startsWith("Can") || s.startsWith("Is"));

    const schemaQuestions = faqSchema?.mainEntity?.map(q => q.name) || [];

    // Compare
    const missingInHtml = schemaQuestions.filter(q => !faqSummaries.some(s => s.toLowerCase() === q.toLowerCase()));
    const missingInSchema = faqSummaries.filter(s => !schemaQuestions.some(q => q.toLowerCase() === s.toLowerCase()));

    console.log(`PAGE: ${page.url} (${page.file})`);
    console.log(`- Title: ${html.match(/<title>([^<]+)<\/title>/)?.[1]}`);
    console.log(`- Canonical: ${html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]}`);
    console.log(`- H1: ${[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(m => m[1].replace(/<[^>]+>/g, "").trim()).join(" | ")}`);
    console.log(`- FAQ Schema present: ${!!faqSchema} (Count: ${schemaQuestions.length})`);
    console.log(`- Visible FAQ count: ${faqSummaries.length}`);
    if (missingInHtml.length > 0) {
      console.log(`  * WARNING: Schema questions NOT visible on page:`, missingInHtml);
    }
    if (missingInSchema.length > 0) {
      console.log(`  * NOTE: Visible questions not in schema:`, missingInSchema);
    }
    if (webAppSchema) {
      console.log(`- WebApp Schema: name="${webAppSchema.name}", price="${webAppSchema.offers?.price}", currency="${webAppSchema.offers?.priceCurrency}"`);
    }
    console.log("");
  }
}

runAudit().catch(console.error);
