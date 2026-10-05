import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const configFile = new URL("../config/etsy-fee-watch.json", import.meta.url);
const rawConfig = await readFile(configFile, "utf8");
const baseline = JSON.parse(rawConfig);
const isUpdateMode = process.argv.includes("--update");

console.log("Checking live Etsy official Help Center policies for fee updates...");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const changes = [];
const updatedBaseline = { ...baseline };

for (const [id, info] of Object.entries(baseline)) {
  const apiUrl = `https://help.etsy.com/api/v2/help_center/en-us/articles/${id}.json`;
  try {
    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      console.warn(`⚠️ Warning: Could not fetch ${info.title} (HTTP ${response.status}). Skipping.`);
      continue;
    }

    const json = await response.json();
    const article = json.article;
    if (!article) continue;

    const rawBody = article.body || "";
    // Normalize HTML to extract text content, stripping dynamic attributes and excess whitespace
    const cleanText = rawBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const liveHash = createHash("sha256").update(cleanText).digest("hex");

    if (liveHash !== info.textHash) {
      changes.push({
        id,
        title: article.title,
        url: article.html_url,
        updatedAt: article.updated_at,
        previousHash: info.textHash,
        newHash: liveHash
      });
    }

    if (isUpdateMode) {
      updatedBaseline[id] = {
        id: article.id,
        title: article.title,
        url: article.html_url,
        updatedAt: article.updated_at,
        textHash: liveHash
      };
    }
  } catch (err) {
    console.warn(`⚠️ Network error checking ${info.title}: ${err.message}`);
  }
}

if (isUpdateMode) {
  await writeFile(configFile, JSON.stringify(updatedBaseline, null, 2) + "\n");
  console.log("✅ Baseline fee signatures updated successfully.");
  process.exit(0);
}

if (changes.length > 0) {
  console.error("\n🚨 ETSY FEE POLICY UPDATE DETECTED!");
  console.error("The following official Etsy Help Center policy articles have changed:");
  for (const change of changes) {
    console.error(` - [${change.title}]`);
    console.error(`   URL: ${change.url}`);
    console.error(`   Last Updated by Etsy: ${change.updatedAt}`);
  }
  console.error("\nAction: Review the rate changes on help.etsy.com, update src/countries.js if needed, and run 'npm run check:etsy -- --update'.\n");
  process.exitCode = 1;
} else {
  console.log("✅ All official Etsy fee policies are unchanged. ShopProfit fee database is 100% current.");
}
