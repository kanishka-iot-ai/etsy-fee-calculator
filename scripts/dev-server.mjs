import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 4173;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

// Parse _redirects — strip \r so mixed CRLF/LF files work correctly
const redirects = (await readFile(path.join(root, "_redirects"), "utf8"))
  .replace(/\r/g, "")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split(/\s+/))
  .filter((parts) => parts.length >= 3)
  .map(([from, to, status]) => ({ from, to, status: Number(status) }));

/** Safely resolve a URL path to an absolute file path under root. */
function safeResolve(urlPath) {
  const relative = (urlPath || "").replace(/^\/+/, "") || "index.html";
  if (relative.includes("..")) return null;
  const resolved = path.join(root, relative);
  const normalRoot = root.replace(/\\/g, "/").toLowerCase();
  const normalResolved = resolved.replace(/\\/g, "/").toLowerCase();
  return normalResolved.startsWith(normalRoot) ? resolved : null;
}

async function tryRead(filePath) {
  if (!filePath) return null;
  try { return await readFile(filePath); } catch { return null; }
}

createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  let requestUrl;
  try {
    requestUrl = new URL(request.url || "/", "http://localhost");
  } catch {
    response.writeHead(400).end();
    return;
  }

  const urlPath = requestUrl.pathname;

  // Match a redirect rule from _redirects
  const rule = redirects.find(({ from }) => from === urlPath);

  // 3xx redirect
  if (rule?.status >= 300 && rule.status < 400) {
    response.writeHead(rule.status, {
      Location: rule.to,
      "Cache-Control": "no-store",
    }).end();
    return;
  }

  // Determine target path
  const targetPath = (rule?.status === 200) ? rule.to : urlPath;

  // Candidate paths to try
  const candidates = [
    safeResolve(targetPath),
    !path.extname(targetPath) ? safeResolve(targetPath + ".html") : null,
    !path.extname(targetPath) ? safeResolve(targetPath + "/index.html") : null,
  ].filter(Boolean);

  let body = null;
  let servedPath = null;
  for (const candidate of candidates) {
    const data = await tryRead(candidate);
    if (data) {
      body = data;
      servedPath = candidate;
      break;
    }
  }

  if (!body) {
    // Serve custom 404.html page
    const notFoundPath = path.join(root, "404.html");
    body = await tryRead(notFoundPath);
    if (!body) {
      response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    response.writeHead(404, {
      "Content-Type": mimeTypes[".html"],
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }

  const ext = path.extname(servedPath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : body);
}).listen(port, () => {
  console.log(`ShopProfit preview running at http://localhost:${port}`);
});
