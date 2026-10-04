import { SUPPORT_EMAIL } from "./site-config.mjs";
import { readFile } from "node:fs/promises";

if (!SUPPORT_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(SUPPORT_EMAIL)) {
  console.error("LAUNCH BLOCKED: configure SUPPORT_EMAIL in config/site-config.json, then rebuild.");
  process.exitCode = 1;
} else {
  const pages = ["privacy.html", "terms.html", "contact.html", "contact/index.html"];
  for (const page of pages) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    if (!html.includes(`mailto:${SUPPORT_EMAIL}`)) throw new Error(`${page} does not include configured SUPPORT_EMAIL`);
  }
  console.log("Launch contact check passed.");
}
