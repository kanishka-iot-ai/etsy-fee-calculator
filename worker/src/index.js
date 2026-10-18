/**
 * ShopProfit Global Etsy Fee Intelligence Worker
 *
 * Cloudflare Worker providing read-only fee intelligence API,
 * scheduled official policy monitoring, and change review management.
 */

import { handleGetFees, handleGetCountryFee, handleGetVersion, PUBLIC_SECURITY_HEADERS } from "./api.js";
import { handleAdvisorRequest } from "./advisor.js";
import {
  handleAdvisorConversationRequest,
  AdvisorConfirmationCoordinatorDO,
  createCoordinatorNamespaceSimulator,
  createConversationSessionStore
} from "./advisor-conversation.js";
import {
  checkRateLimit,
  createRateLimitResponse,
  DEFAULT_WINDOW_MS,
  DEFAULT_ADMIN_MAX_REQUESTS
} from "./rate-limiter.js";
import { executeMonitorRun } from "./monitor.js";
import {
  verifyAdminAuth,
  handleGetReviews,
  handleGetReviewDetail,
  handleApproveChange,
  handleRejectChange,
  handlePublishVersion,
  handleRollbackVersion,
  handleGetDataQuality,
  handleManualMonitorRun,
  handleGlobalDiscoveryRun
} from "./admin.js";

// Public API CORS headers — wildcard is appropriate for the read-only public fee API.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, If-None-Match",
  ...PUBLIC_SECURITY_HEADERS
};

// Admin API response headers — omit Access-Control-Allow-Origin.
// Admin endpoints require Bearer token auth and are accessed via CLI/scripts only,
// not from browser contexts. Emitting CORS wildcard on admin routes is unnecessary
// and contrary to least-privilege (M2).
const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  ...PUBLIC_SECURITY_HEADERS
};

export default {
  /**
   * Main HTTP Request Handler
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    const isAdminRoute = url.pathname.startsWith("/api/admin/");

    // 1. Handle CORS Preflight
    if (method === "OPTIONS") {
      if (isAdminRoute) {
        return new Response(null, {
          status: 204,
          headers: ADMIN_HEADERS
        });
      }
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    try {
      // 2. Health & Status Check
      if (url.pathname === "/" || url.pathname === "/health") {
        return new Response(
          JSON.stringify({
            service: "shopprofit-fee-intelligence",
            status: "healthy",
            timestamp: new Date().toISOString(),
            version: "1.0.0"
          }),
          {
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json"
            }
          }
        );
      }

      // 3. Public Read API Routes
      if (method === "GET") {
        if (url.pathname === "/v1/fees") {
          const rl = checkRateLimit(request, "fees", env?.RATE_LIMIT_OPTIONS);
          if (!rl.allowed) {
            return createRateLimitResponse(rl.retryAfter, CORS_HEADERS);
          }
          return await handleGetFees(request, env);
        }

        if (url.pathname.startsWith("/v1/fees/")) {
          const rl = checkRateLimit(request, "country_fees", env?.RATE_LIMIT_OPTIONS);
          if (!rl.allowed) {
            return createRateLimitResponse(rl.retryAfter, CORS_HEADERS);
          }
          const countryCode = url.pathname.replace("/v1/fees/", "").trim();
          return await handleGetCountryFee(request, env, countryCode);
        }

        if (url.pathname === "/v1/version") {
          const rl = checkRateLimit(request, "version", env?.RATE_LIMIT_OPTIONS);
          if (!rl.allowed) {
            return createRateLimitResponse(rl.retryAfter, CORS_HEADERS);
          }
          return await handleGetVersion(request, env);
        }
      }

      // 3B. Controlled Profit Advisor Routes
      if (url.pathname === "/v1/advisor") {
        return await handleAdvisorRequest(request, env);
      }

      if (url.pathname === "/v1/advisor-conversation") {
        const defaultCoordinator = env?.CONFIRMATION_COORDINATOR || createCoordinatorNamespaceSimulator();
        const defaultStore = env?.SESSION_STORE || createConversationSessionStore();
        const conversationEnv = {
          ENABLE_CONVERSATIONAL_PROTOTYPE: env?.ENABLE_CONVERSATIONAL_PROTOTYPE ?? true,
          REQUIRE_GLOBAL_COORDINATOR: false,
          ALLOW_PUBLIC_WEB_SEARCH_FALLBACK: env?.ALLOW_PUBLIC_WEB_SEARCH_FALLBACK ?? true,
          CONFIRMATION_COORDINATOR: defaultCoordinator,
          SESSION_STORE: defaultStore,
          ...env
        };
        return await handleAdvisorConversationRequest(request, conversationEnv);
      }

      // 4. Protected Admin Routes
      if (isAdminRoute) {
        // Isolated admin rate-limit bucket (20 req / 60s per IP) enforced before auth or D1 access.
        const adminRl = checkRateLimit(request, "admin", {
          windowMs: DEFAULT_WINDOW_MS,
          maxRequests: DEFAULT_ADMIN_MAX_REQUESTS,
          ...env?.ADMIN_RATE_LIMIT_OPTIONS
        });
        if (!adminRl.allowed) {
          return createRateLimitResponse(adminRl.retryAfter, ADMIN_HEADERS);
        }

        // M2: Admin 401 uses ADMIN_HEADERS — no CORS wildcard on auth rejection.
        if (!verifyAdminAuth(request, env)) {
          return new Response(JSON.stringify({ error: "Unauthorized: Invalid or missing Bearer token" }), {
            status: 401,
            headers: ADMIN_HEADERS
          });
        }

        // L2: Reject admin POST requests with unsupported Content-Type.
        // Only application/json bodies are accepted; other types are invalid.
        if (method === "POST") {
          const ct = request.headers.get("Content-Type") || "";
          if (!ct.toLowerCase().includes("application/json")) {
            return new Response(JSON.stringify({ error: "Unsupported Media Type: Content-Type must be application/json" }), {
              status: 415,
              headers: ADMIN_HEADERS
            });
          }
        }

        if (method === "GET") {
          if (url.pathname === "/api/admin/review" || url.pathname === "/api/admin/review-queue") {
            return await handleGetReviews(request, env);
          }
          if (url.pathname.startsWith("/api/admin/review/")) {
            const reviewId = url.pathname.replace("/api/admin/review/", "").trim();
            return await handleGetReviewDetail(request, env, reviewId);
          }
          if (url.pathname === "/api/admin/data-quality") {
            return await handleGetDataQuality(request, env);
          }
        }

        if (method === "POST") {
          if (url.pathname === "/api/admin/approve-change") {
            return await handleApproveChange(request, env);
          }
          if (url.pathname.startsWith("/api/admin/review-queue/") && url.pathname.endsWith("/approve")) {
            const match = url.pathname.match(/^\/api\/admin\/review-queue\/([^/]+)\/approve$/);
            if (match) {
              return await handleApproveChange(new Request(request.url, {
                method: "POST",
                headers: request.headers,
                body: JSON.stringify({ review_id: match[1] })
              }), env);
            }
          }
          if (url.pathname === "/api/admin/reject-change") {
            return await handleRejectChange(request, env);
          }
          if (url.pathname === "/api/admin/publish-version") {
            return await handlePublishVersion(request, env);
          }
          if (url.pathname === "/api/admin/rollback-version") {
            return await handleRollbackVersion(request, env);
          }
          if (url.pathname === "/api/admin/monitor/run") {
            return await handleManualMonitorRun(request, env);
          }
          if (url.pathname === "/api/admin/discovery/run") {
            return await handleGlobalDiscoveryRun(request, env);
          }
        }
      }

      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: isAdminRoute
          ? ADMIN_HEADERS
          : {
              ...CORS_HEADERS,
              "Content-Type": "application/json"
            }
      });

    } catch (err) {
      // Log concise server-side diagnostic without exposing request headers or secrets.
      console.error("Worker unhandled error:", err instanceof Error ? err.message : "Unknown error");
      // M1: Return only a generic message — internal details (stack, query fragments,
      // D1 schema) must never be exposed to untrusted callers.
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: isAdminRoute
          ? ADMIN_HEADERS
          : {
              ...CORS_HEADERS,
              "Content-Type": "application/json"
            }
      });
    }
  },

  /**
   * Scheduled Cron Trigger Handler
   */
  async scheduled(event, env, ctx) {
    console.log(`[ShopProfit] Scheduled monitor run initiated at ${new Date().toISOString()}`);
    ctx.waitUntil(executeMonitorRun(env));
  }
};

export { AdvisorConfirmationCoordinatorDO };
