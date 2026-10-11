/**
 * ShopProfit Policy Monitor & Change Detection Engine
 * Scrapes official Etsy Help Center Zendesk endpoints, captures snapshots,
 * and populates the review queue upon detecting policy adjustments.
 */

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ShopProfitMonitor/1.0";

/**
 * Etsy Help Center article IDs are 12–13 digit numeric strings (e.g. "115015628847", "1500011073202").
 * Matches the exact format of all registered source IDs in governance.js OFFICIAL_SOURCES.
 * Reject anything else to prevent SSRF or path traversal via source_id (L3).
 */
export const ETSY_SOURCE_ID_RE = /^\d{12,13}$/;

export function isValidEtsySourceId(sourceId) {
  return typeof sourceId === "string" && ETSY_SOURCE_ID_RE.test(sourceId);
}

/**
 * Approved outbound host for Etsy Help Center monitoring fetches.
 */
export const ETSY_HELP_HOST = "help.etsy.com";

/**
 * Default approved webhook destination hosts (L4).
 * Can be extended via env.ALLOWED_WEBHOOK_HOSTS (comma-separated hostnames).
 */
export const DEFAULT_APPROVED_WEBHOOK_HOSTS = new Set([
  "hooks.slack.com",
  "discord.com",
  "discordapp.com",
  "events.pagerduty.com",
  "api.opsgenie.com",
  "shopprofitcalculator.com",
  "api.shopprofitcalculator.com"
]);

function isDisallowedHostname(hostname) {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.startsWith("[") || // IPv6 literal
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) // IPv4 literal
  ) {
    return true;
  }
  return false;
}

/**
 * Validates and returns a normalized HTTPS webhook URL string, or null if invalid (L4).
 * - Requires https: scheme.
 * - Rejects malformed URLs, embedded credentials, and IP/localhost/internal hosts.
 * - Restricts destination host to approved webhook hosts (default allowlist + optional env override).
 * Callers must also pass redirect: "error" in fetch() to prevent redirect-based bypass.
 */
export function validateWebhookUrl(raw, options = {}) {
  if (!raw || typeof raw !== "string") return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;

  const host = parsed.hostname.toLowerCase();
  if (!host || isDisallowedHostname(host)) return null;

  const customHosts = typeof options.allowedHosts === "string"
    ? options.allowedHosts.split(",").map(h => h.trim().toLowerCase()).filter(Boolean)
    : Array.isArray(options.allowedHosts)
      ? options.allowedHosts.map(h => String(h).trim().toLowerCase()).filter(Boolean)
      : [];

  const allowlist = new Set([...DEFAULT_APPROVED_WEBHOOK_HOSTS, ...customHosts]);
  if (!allowlist.has(host)) {
    return null;
  }

  return parsed.href;
}

/**
 * Computes SHA-256 hex string using native Web Crypto API
 */
async function computeSha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Strips HTML tags and normalizes whitespace
 */
function normalizeText(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Generates random UUID
 */
function generateId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Executes a full monitoring run across all enabled official sources
 */
export async function executeMonitorRun(env) {
  const runId = generateId("run");
  const startedAt = new Date().toISOString();
  const fetchFn = env?.fetchOverride || fetch;

  let sourcesChecked = 0;
  let sourcesChanged = 0;
  let changesDetected = 0;
  let reviewsCreated = 0;
  let errors = 0;
  let runStatus = "completed";
  let lastErrorMessage = null;

  try {
    // 1. Fetch enabled sources
    const { results: sources } = await env.DB.prepare(`
      SELECT source_id, source_name, source_url, latest_hash
      FROM source_registry
      WHERE enabled = 1;
    `).all();

    for (const source of sources) {
      sourcesChecked++;

      // L3: Validate source_id matches the exact numeric Etsy article ID format
      // before constructing the Etsy URL.
      const sourceIdStr = String(source.source_id ?? "");
      if (!isValidEtsySourceId(sourceIdStr)) {
        errors++;
        lastErrorMessage = "Invalid source_id format in source_registry";
        console.error(`[Monitor] Skipping source with invalid source_id format: ${sourceIdStr}`);
        continue;
      }

      const apiUrl = `https://${ETSY_HELP_HOST}/api/v2/help_center/en-us/articles/${encodeURIComponent(sourceIdStr)}.json`;
      const fetchedAt = new Date().toISOString();

      try {
        const response = await fetchFn(apiUrl, {
          redirect: "error",
          headers: {
            "User-Agent": USER_AGENT,
            "Accept": "application/json"
          }
        });

        if (!response.ok) {
          errors++;
          await env.DB.prepare(`
            INSERT INTO snapshots (snapshot_id, source_id, fetched_at, http_status, success, error_message)
            VALUES (?, ?, ?, ?, 0, ?);
          `).bind(generateId("snap"), sourceIdStr, fetchedAt, response.status, `HTTP ${response.status}`).run();
          continue;
        }

        const json = await response.json();
        const article = json?.article;
        if (!article) {
          errors++;
          continue;
        }

        const rawBody = article.body || "";
        const cleanText = normalizeText(rawBody);
        const liveHash = await computeSha256(cleanText);

        const snapshotId = generateId("snap");
        await env.DB.prepare(`
          INSERT INTO snapshots (
            snapshot_id, source_id, fetched_at, http_status, content_type,
            raw_content, normalized_content, content_hash, normalized_hash,
            parser_version, success
          ) VALUES (?, ?, ?, 200, 'application/json', ?, ?, ?, ?, '1.0.0', 1);
        `).bind(snapshotId, sourceIdStr, fetchedAt, rawBody.substring(0, 10000), cleanText.substring(0, 5000), liveHash, liveHash).run();

        // Check if content hash changed
        if (source.latest_hash && liveHash !== source.latest_hash) {
          sourcesChanged++;
          changesDetected++;

          const changeId = generateId("chg");
          await env.DB.prepare(`
            INSERT INTO detected_changes (
              change_id, source_id, snapshot_id, field_name,
              old_value, new_value, change_type, detected_at,
              status, validation_message
            ) VALUES (?, ?, ?, 'article_body', ?, ?, 'content_hash_update', ?, 'pending_review', 'Article content changed on help.etsy.com');
          `).bind(changeId, sourceIdStr, snapshotId, source.latest_hash, liveHash, fetchedAt).run();

          const reviewId = generateId("rev");
          reviewsCreated++;
          await env.DB.prepare(`
            INSERT INTO review_queue (
              review_id, change_id, priority, reason,
              old_value, proposed_value, source_url, detected_at,
              status
            ) VALUES (?, ?, 'high', 'Official Etsy Policy Content Changed', ?, ?, ?, ?, 'pending');
          `).bind(reviewId, changeId, source.latest_hash, liveHash, source.source_url, fetchedAt).run();

          // Dispatch alert webhook if configured.
          // L4: Validate URL is https://, parseable, and targets an approved host before dispatch.
          // redirect:"error" prevents a 3xx redirect from bypassing destination validation.
          if (env.ALERT_WEBHOOK_URL) {
            const safeWebhookUrl = validateWebhookUrl(env.ALERT_WEBHOOK_URL, {
              allowedHosts: env.ALLOWED_WEBHOOK_HOSTS
            });
            if (safeWebhookUrl) {
              try {
                await fetchFn(safeWebhookUrl, {
                  method: "POST",
                  redirect: "error",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    event: "ETSY_FEE_POLICY_CHANGED",
                    source: source.source_name,
                    url: source.source_url,
                    detectedAt: fetchedAt,
                    oldHash: source.latest_hash,
                    newHash: liveHash
                  })
                });
              } catch (webhookErr) {
                console.warn("Webhook dispatch failed:", webhookErr.message);
              }
            } else {
              console.warn("[Monitor] ALERT_WEBHOOK_URL failed security validation — skipping webhook dispatch.");
            }
          }
        }

        // Update source registry status
        await env.DB.prepare(`
          UPDATE source_registry
          SET last_checked_at = ?, last_successful_check_at = ?, updated_at = ?
          WHERE source_id = ?;
        `).bind(fetchedAt, fetchedAt, fetchedAt, source.source_id).run();

      } catch (srcErr) {
        errors++;
        lastErrorMessage = srcErr.message;
      }
    }
  } catch (fatalErr) {
    runStatus = "failed";
    lastErrorMessage = fatalErr.message;
    errors++;
  }

  const completedAt = new Date().toISOString();

  // Log monitor run summary
  await env.DB.prepare(`
    INSERT INTO monitor_runs (
      run_id, started_at, completed_at, status,
      sources_checked, sources_changed, changes_detected,
      changes_published, reviews_created, errors, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?);
  `).bind(
    runId, startedAt, completedAt, runStatus,
    sourcesChecked, sourcesChanged, changesDetected,
    reviewsCreated, errors, lastErrorMessage
  ).run();

  return {
    runId,
    status: runStatus,
    sourcesChecked,
    sourcesChanged,
    changesDetected,
    reviewsCreated,
    errors,
    startedAt,
    completedAt
  };
}
