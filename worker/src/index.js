/**
 * ShopProfit Global Etsy Fee Intelligence Worker
 *
 * Cloudflare Worker providing read-only fee intelligence API,
 * scheduled official policy monitoring, and change review management.
 */

import { handleGetFees, handleGetCountryFee, handleGetVersion, PUBLIC_SECURITY_HEADERS } from "./api.js";
import { checkRateLimit, createRateLimitResponse } from "./rate-limiter.js";
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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, If-None-Match",
  ...PUBLIC_SECURITY_HEADERS
};

export default {
  /**
   * Main HTTP Request Handler
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // 1. Handle CORS Preflight
    if (method === "OPTIONS") {
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

      // 4. Protected Admin Routes
      if (url.pathname.startsWith("/api/admin/")) {
        if (!verifyAdminAuth(request, env)) {
          return new Response(JSON.stringify({ error: "Unauthorized: Invalid or missing Bearer token" }), {
            status: 401,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json"
            }
          });
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
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json"
        }
      });

    } catch (err) {
      console.error("Worker unhandled error:", err);
      return new Response(JSON.stringify({ error: "Internal Server Error", message: err.message }), {
        status: 500,
        headers: {
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
