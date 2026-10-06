import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// 1. Generate fresh cryptographic key
const secretKey = randomBytes(32).toString("hex");

// 2. Write to gitignored .dev.vars
writeFileSync(".dev.vars", `ADMIN_API_KEY=${secretKey}\n`, "utf8");

// 3. Upload secret securely to Cloudflare Worker
try {
  execSync("npx.cmd wrangler secret put ADMIN_API_KEY", {
    input: secretKey,
    stdio: ["pipe", "ignore", "inherit"]
  });
  console.log("Uploaded rotated ADMIN_API_KEY secret to Cloudflare Worker successfully.");
} catch (err) {
  console.error("Failed to upload secret to Worker:", err.message);
  process.exit(1);
}

// 4. Wait 3 seconds for Cloudflare edge propagation
console.log("Waiting for Cloudflare edge key propagation...");
await new Promise(resolve => setTimeout(resolve, 3000));

// 5. Invoke POST /api/admin/discovery/run
console.log("Triggering live global Etsy fee discovery on remote Worker...");
const res = await fetch("https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev/api/admin/discovery/run", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${secretKey}`,
    "Content-Type": "application/json"
  }
});

console.log("HTTP Response Status:", res.status);
const data = await res.json();
console.log("Discovery Run Results:", JSON.stringify(data, null, 2));
