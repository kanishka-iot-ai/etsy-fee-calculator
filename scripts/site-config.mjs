import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const configPath = new URL("../config/site-config.json", import.meta.url);
const siteConfig = JSON.parse(readFileSync(fileURLToPath(configPath), "utf8"));
export const SUPPORT_EMAIL = String(process.env.SUPPORT_EMAIL || siteConfig.SUPPORT_EMAIL || "").trim();

export function supportContactHtml() {
  if (!SUPPORT_EMAIL) return '<span>Contact email not configured for this preview build. Site owner: set SUPPORT_EMAIL in the hosting environment before launch.</span>';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(SUPPORT_EMAIL)) throw new Error("SUPPORT_EMAIL must be a valid email address.");
  const safe = SUPPORT_EMAIL.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<a href="mailto:${safe}">${safe}</a>`;
}
