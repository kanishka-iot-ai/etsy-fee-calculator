/**
 * ShopProfit Protected Admin API Handler
 *
 * Implements governance endpoints for human review, change approvals,
 * atomic version publishing, rollbacks, and data quality diagnostics.
 */

import { executeMonitorRun } from "./monitor.js";
import { publishApprovedChanges, rollbackVersion, getDataQualityReport } from "./publisher.js";

/**
 * Performs a constant-time string comparison to prevent timing side-channel attacks.
 * Equivalent to crypto.timingSafeEqual but works on strings without allocating Buffers
 * in the Workers runtime (which lacks Node.js Buffer). Uses TextEncoder for byte-level ops.
 */
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  // If lengths differ, compare full length of 'a' anyway to prevent length oracle.
  let result = ba.length === bb.length ? 0 : 1;
  const len = Math.max(ba.length, bb.length);
  for (let i = 0; i < len; i++) {
    result |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return result === 0;
}

/**
 * Validates Bearer token authentication
 */
export function verifyAdminAuth(request, env) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.substring(7).trim();
  const validKey = env.ADMIN_API_KEY ? env.ADMIN_API_KEY.trim() : null;
  if (!validKey) {
    return false;
  }
  // L1: Use constant-time comparison to prevent timing oracle on the token value.
  return timingSafeEqual(token, validKey);
}

import { PUBLIC_SECURITY_HEADERS } from "./api.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  ...PUBLIC_SECURITY_HEADERS
};

/**
 * Safely parses a JSON object body from a Request.
 * Empty bodies resolve to {}; malformed JSON or non-object payloads return an error response.
 */
async function parseJsonObject(request) {
  const raw = await request.text();
  if (!raw || !raw.trim()) {
    return { ok: true, body: {} };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        response: new Response(JSON.stringify({ error: "Bad Request: JSON body must be an object" }), {
          status: 400,
          headers: HEADERS
        })
      };
    }
    return { ok: true, body: parsed };
  } catch {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Bad Request: Malformed JSON body" }), {
        status: 400,
        headers: HEADERS
      })
    };
  }
}

/**
 * Handles GET /api/admin/review and GET /api/admin/review-queue
 * Returns compact review list for governance
 */
export async function handleGetReviews(request, env) {
  const query = `
    SELECT 
      r.review_id,
      c.country_code,
      c.field_name,
      r.old_value,
      r.proposed_value,
      c.change_type,
      r.priority,
      c.source_id,
      r.detected_at,
      c.effective_from,
      c.validation_message as validation_result,
      r.status
    FROM review_queue r
    JOIN detected_changes c ON r.change_id = c.change_id
    ORDER BY 
      CASE r.priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
        ELSE 5
      END,
      r.detected_at DESC;
  `;
  const { results } = await env.DB.prepare(query).all();

  return new Response(JSON.stringify({
    count: (results || []).length,
    queue: results || [],
    reviews: (results || []).map(r => ({
      reviewId: r.review_id,
      country: r.country_code,
      field: r.field_name,
      oldValue: r.old_value,
      proposedValue: r.proposed_value,
      changeType: r.change_type,
      priority: r.priority,
      source: r.source_id,
      detectedAt: r.detected_at,
      effectiveDate: r.effective_from,
      validationResult: r.validation_result,
      status: r.status
    }))
  }), { status: 200, headers: HEADERS });
}

const ADMIN_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function isValidAdminId(value) {
  return typeof value === "string" && ADMIN_ID_RE.test(value);
}

/**
 * Handles GET /api/admin/review/:id
 */
export async function handleGetReviewDetail(request, env, reviewId) {
  if (!isValidAdminId(reviewId)) {
    return new Response(JSON.stringify({ error: "Invalid reviewId format" }), {
      status: 400,
      headers: HEADERS
    });
  }

  const query = `
    SELECT 
      r.review_id,
      r.change_id,
      r.priority,
      r.reason,
      r.old_value,
      r.proposed_value,
      r.source_url,
      r.detected_at,
      r.reviewed_at,
      r.reviewer_note,
      r.status as review_status,
      c.source_id,
      c.snapshot_id,
      c.country_code,
      c.field_name,
      c.change_type,
      c.effective_from,
      c.status as change_status,
      c.validation_message,
      s.source_name
    FROM review_queue r
    JOIN detected_changes c ON r.change_id = c.change_id
    JOIN source_registry s ON c.source_id = s.source_id
    WHERE r.review_id = ?;
  `;
  const detail = await env.DB.prepare(query).bind(reviewId).first();

  if (!detail) {
    return new Response(JSON.stringify({ error: "Review item not found", reviewId }), {
      status: 404,
      headers: HEADERS
    });
  }

  return new Response(JSON.stringify({ review: detail }), { status: 200, headers: HEADERS });
}

/**
 * Handles POST /api/admin/approve-change
 * Approves a detected change with optimistic concurrency checks and idempotency
 */
export async function handleApproveChange(request, env) {
  const parsed = await parseJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const reviewId = body.review_id || body.reviewId;
  const changeId = body.change_id || body.changeId;
  const expectedStatus = body.expected_change_status || "pending";
  const note = body.note || "Approved via admin governance API";
  const reviewedBy = body.reviewed_by || body.approved_by || request.headers.get("X-Reviewer-Id") || null;
  const now = new Date().toISOString();

  if (!reviewId && !changeId) {
    return new Response(JSON.stringify({ error: "Missing required review_id or change_id" }), {
      status: 400,
      headers: HEADERS
    });
  }

  if ((reviewId && !isValidAdminId(reviewId)) || (changeId && !isValidAdminId(changeId))) {
    return new Response(JSON.stringify({ error: "Invalid review_id or change_id format" }), {
      status: 400,
      headers: HEADERS
    });
  }

  // 1. Fetch current review state
  const selector = reviewId ? "review_id = ?" : "change_id = ?";
  const targetId = reviewId || changeId;

  const current = await env.DB.prepare(`
    SELECT review_id, change_id, status FROM review_queue WHERE ${selector};
  `).bind(targetId).first();

  if (!current) {
    return new Response(JSON.stringify({ error: "Review item not found", targetId }), {
      status: 404,
      headers: HEADERS
    });
  }

  // Idempotency check: Already approved
  if (current.status === "approved" || (current.status === "published" && !body.force_reapprove)) {
    return new Response(JSON.stringify({
      success: true,
      reviewId: current.review_id,
      changeId: current.change_id,
      status: current.status,
      message: "Already approved (idempotent request)"
    }), { status: 200, headers: HEADERS });
  }

  // Stale approval rejection: Check optimistic concurrency
  if (expectedStatus && current.status !== expectedStatus) {
    return new Response(JSON.stringify({
      error: "Stale approval rejected: Review status has changed",
      currentStatus: current.status,
      expectedStatus
    }), { status: 409, headers: HEADERS });
  }

  // Execute approval atomically
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE review_queue
      SET status = 'approved', reviewed_at = ?, reviewer_note = ?, reviewed_by = ?
      WHERE review_id = ?;
    `).bind(now, note, reviewedBy, current.review_id),
    env.DB.prepare(`
      UPDATE detected_changes
      SET status = 'approved'
      WHERE change_id = ?;
    `).bind(current.change_id)
  ]);

  return new Response(JSON.stringify({
    success: true,
    reviewId: current.review_id,
    changeId: current.change_id,
    status: "approved",
    approvedAt: now,
    reviewedBy
  }), { status: 200, headers: HEADERS });
}

/**
 * Handles POST /api/admin/reject-change
 * Rejects a detected change idempotently
 */
export async function handleRejectChange(request, env) {
  const parsed = await parseJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const reviewId = body.review_id || body.reviewId;
  const changeId = body.change_id || body.changeId;
  const reason = body.reason || "Rejected by admin";
  const now = new Date().toISOString();

  if (!reviewId && !changeId) {
    return new Response(JSON.stringify({ error: "Missing required review_id or change_id" }), {
      status: 400,
      headers: HEADERS
    });
  }

  if ((reviewId && !isValidAdminId(reviewId)) || (changeId && !isValidAdminId(changeId))) {
    return new Response(JSON.stringify({ error: "Invalid review_id or change_id format" }), {
      status: 400,
      headers: HEADERS
    });
  }

  const selector = reviewId ? "review_id = ?" : "change_id = ?";
  const targetId = reviewId || changeId;

  const current = await env.DB.prepare(`
    SELECT review_id, change_id, status FROM review_queue WHERE ${selector};
  `).bind(targetId).first();

  if (!current) {
    return new Response(JSON.stringify({ error: "Review item not found", targetId }), {
      status: 404,
      headers: HEADERS
    });
  }

  // Idempotency check: Already rejected
  if (current.status === "rejected") {
    return new Response(JSON.stringify({
      success: true,
      reviewId: current.review_id,
      changeId: current.change_id,
      status: "rejected",
      message: "Already rejected (idempotent request)"
    }), { status: 200, headers: HEADERS });
  }

  // Execute rejection atomically
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE review_queue
      SET status = 'rejected', reviewed_at = ?, reviewer_note = ?
      WHERE review_id = ?;
    `).bind(now, reason, current.review_id),
    env.DB.prepare(`
      UPDATE detected_changes
      SET status = 'rejected'
      WHERE change_id = ?;
    `).bind(current.change_id)
  ]);

  return new Response(JSON.stringify({
    success: true,
    reviewId: current.review_id,
    changeId: current.change_id,
    status: "rejected",
    rejectedAt: now
  }), { status: 200, headers: HEADERS });
}

/**
 * Handles POST /api/admin/publish-version
 * Atomically releases approved changes into a new active fee version
 */
export async function handlePublishVersion(request, env) {
  const parsed = await parseJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const reviewerFromHeader = request.headers.get("X-Reviewer-Id");
  if (!body.approved_by && !body.reviewed_by && reviewerFromHeader) {
    body.approved_by = reviewerFromHeader;
  }

  const result = await publishApprovedChanges(env, body);

  const status = result.success ? 200 : 400;
  return new Response(JSON.stringify(result), { status, headers: HEADERS });
}

/**
 * Handles POST /api/admin/rollback-version
 * Atomically rolls back to a previous archived fee version
 */
export async function handleRollbackVersion(request, env) {
  const parsed = await parseJsonObject(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const targetVersionId = body.target_version_id || body.targetVersionId || null;
  const reason = body.reason || "Manual rollback initiated via admin API";

  if (targetVersionId !== null && !isValidAdminId(targetVersionId)) {
    return new Response(JSON.stringify({ error: "Invalid target_version_id format" }), {
      status: 400,
      headers: HEADERS
    });
  }

  try {
    const result = await rollbackVersion(env, targetVersionId, reason);
    return new Response(JSON.stringify(result), { status: 200, headers: HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: HEADERS });
  }
}

/**
 * Handles GET /api/admin/data-quality
 * Returns comprehensive data quality and health telemetry
 */
export async function handleGetDataQuality(request, env) {
  const report = await getDataQualityReport(env);
  return new Response(JSON.stringify(report), { status: 200, headers: HEADERS });
}

/**
 * Handles POST /api/admin/monitor/run
 */
export async function handleManualMonitorRun(request, env) {
  const result = await executeMonitorRun(env);
  return new Response(JSON.stringify(result), { status: 200, headers: HEADERS });
}

/**
 * Handles POST /api/admin/discovery/run
 */
export async function handleGlobalDiscoveryRun(request, env) {
  const { runGlobalDataDiscovery } = await import("./discovery.js");
  const result = await runGlobalDataDiscovery(env);
  return new Response(JSON.stringify(result), { status: 200, headers: HEADERS });
}
