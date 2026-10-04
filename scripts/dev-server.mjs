import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 4173;
const mimeTypes = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
};

const redirects = (await readFile(path.join(root, "_redirects"), "utf8"))
  .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split(/\s+/)).filter((parts) => parts.length >= 3)
  .map(([from, to, status]) => ({ from, to, status: Number(status) }));

function resolveRequestPath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  const relative = decoded.replace(/^\/+/, "") || "index.html";
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(`${root}${path.sep}`) || resolved === root ? resolved : null;
}

createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end(); return;
  }
  let requestUrl;
  try { requestUrl = new URL(request.url || "/", "http://localhost"); } catch { response.writeHead(400).end(); return; }
  const route = redirects.find(({ from }) => from === requestUrl.pathname);
  if (route?.status >= 300 && route.status < 400) {
    response.writeHead(route.status, { Location: route.to, "Cache-Control": "no-store" }).end(); return;
  }
  let target = resolveRequestPath(route?.status === 200 ? route.to : requestUrl.pathname);
  if (!target) { response.writeHead(400).end("Bad request"); return; }
  let body;
  try { body = await readFile(target); }
  catch {
    target = path.join(root, "404.html");
    try { body = await readFile(target); } catch { response.writeHead(404).end(); return; }
    response.writeHead(404, { "Content-Type": mimeTypes[".html"] });
    response.end(request.method === "HEAD" ? undefined : body); return;
  }
  response.writeHead(200, { "Content-Type": mimeTypes[path.extname(target).toLowerCase()] || "application/octet-stream", "X-Content-Type-Options": "nosniff" });
  response.end(request.method === "HEAD" ? undefined : body);
}).listen(port, "127.0.0.1", () => console.log(`ShopProfit preview running at http://localhost:${port}`));
