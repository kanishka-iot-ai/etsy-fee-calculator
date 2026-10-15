/**
 * ShopProfit — Phase 7F Isolated Private Advisor Preview Server
 *
 * Connects `private-advisor-test.html` to `handleAdvisorConversationRequest`
 * locally for private user-journey validation without modifying `worker/src/index.js`,
 * `worker/wrangler.toml`, or any public production endpoint.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  handleAdvisorConversationRequest,
  createConversationSessionStore,
  createCoordinatorNamespaceSimulator
} from "../worker/src/advisor-conversation.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
});

const PRIVATE_SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin"
});

/**
 * Creates an isolated Node HTTP server mounting the private UI and
 * `POST /api/private/advisor-conversation`.
 *
 * @param {Object} [envOverrides] - Custom Worker env bindings (AI, CONVERSATION_HMAC_SECRET, SESSION_STORE, CONFIRMATION_COORDINATOR, etc.)
 */
export function createPrivateAdvisorPreviewServer(envOverrides = {}) {
  const defaultStore = createConversationSessionStore();
  const defaultCoordinator = createCoordinatorNamespaceSimulator();
  const serverEnv = {
    ENABLE_CONVERSATIONAL_PROTOTYPE: true,
    REQUIRE_GLOBAL_COORDINATOR: true,
    ALLOW_PUBLIC_WEB_SEARCH_FALLBACK: envOverrides.ALLOW_PUBLIC_WEB_SEARCH_FALLBACK ?? true,
    CONFIRMATION_COORDINATOR: defaultCoordinator,
    CONVERSATION_HMAC_SECRET:
      envOverrides.CONVERSATION_HMAC_SECRET ||
      process.env.CONVERSATION_HMAC_SECRET ||
      "phase7f-local-private-hmac-secret-not-for-public-prod",
    SESSION_STORE: envOverrides.SESSION_STORE || defaultStore,
    REQUIRE_PRIVATE_AUTH: envOverrides.REQUIRE_PRIVATE_AUTH ?? Boolean(process.env.PRIVATE_PROTOTYPE_KEY),
    PRIVATE_PROTOTYPE_KEY: envOverrides.PRIVATE_PROTOTYPE_KEY || process.env.PRIVATE_PROTOTYPE_KEY || "",
    ...envOverrides
  };

  return createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", "http://127.0.0.1");

      // Private API endpoint: POST /api/private/advisor-conversation
      if (requestUrl.pathname === "/api/private/advisor-conversation") {
        const chunks = [];
        let totalBytes = 0;
        for await (const chunk of req) {
          totalBytes += chunk.length;
          if (totalBytes > 65536) {
            res.writeHead(413, {
              ...PRIVATE_SECURITY_HEADERS,
              "Content-Type": "application/json; charset=utf-8"
            });
            res.end(JSON.stringify({ ok: false, error: "payload_too_large" }));
            return;
          }
          chunks.push(chunk);
        }
        const bodyBuffer = Buffer.concat(chunks);

        const webHeaders = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string") {
            webHeaders.set(k, v);
          } else if (Array.isArray(v)) {
            webHeaders.set(k, v.join(", "));
          }
        }

        const webReq = new Request(requestUrl.toString(), {
          method: req.method || "POST",
          headers: webHeaders,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : bodyBuffer
        });

        const webRes = await handleAdvisorConversationRequest(webReq, serverEnv);
        const outHeaders = {};
        webRes.headers.forEach((value, key) => {
          outHeaders[key] = value;
        });
        const responseText = await webRes.text();
        res.writeHead(webRes.status, outHeaders);
        res.end(responseText);
        return;
      }

      // Serve static files for the private test interface
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname === "/" || pathname === "/private-advisor") {
        pathname = "/private-advisor-test.html";
      }

      const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
      const candidatePath = join(rootDir, safePath);
      const info = await stat(candidatePath);
      if (!info.isFile()) {
        res.writeHead(404, PRIVATE_SECURITY_HEADERS);
        res.end("Not found");
        return;
      }

      const ext = extname(candidatePath).toLowerCase();
      const body = await readFile(candidatePath);
      res.writeHead(200, {
        ...PRIVATE_SECURITY_HEADERS,
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
      });
      res.end(body);
    } catch {
      res.writeHead(404, {
        ...PRIVATE_SECURITY_HEADERS,
        "Content-Type": "text/plain; charset=utf-8"
      });
      res.end("Not found");
    }
  });
}

// Run standalone if invoked directly via CLI
if (process.argv[1] && normalize(fileURLToPath(import.meta.url)) === normalize(process.argv[1])) {
  const port = Number(process.env.PRIVATE_ADVISOR_PORT || 4179);
  const server = createPrivateAdvisorPreviewServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Private Conversational AI Advisor Harness listening on http://127.0.0.1:${port}/private-advisor-test.html`
    );
  });
}
