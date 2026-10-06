/**
 * ShopProfit Policy Monitor & Change Detection Engine
 * Scrapes official Etsy Help Center Zendesk endpoints, captures snapshots,
 * and populates the review queue upon detecting policy adjustments.
 */

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ShopProfitMonitor/1.0";

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
      const apiUrl = `https://help.etsy.com/api/v2/help_center/en-us/articles/${source.source_id}.json`;
      const fetchedAt = new Date().toISOString();

      try {
        const response = await fetch(apiUrl, {
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
          `).bind(generateId("snap"), source.source_id, fetchedAt, response.status, `HTTP ${response.status}`).run();
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
        `).bind(snapshotId, source.source_id, fetchedAt, rawBody.substring(0, 10000), cleanText.substring(0, 5000), liveHash, liveHash).run();

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
          `).bind(changeId, source.source_id, snapshotId, source.latest_hash, liveHash, fetchedAt).run();

          const reviewId = generateId("rev");
          reviewsCreated++;
          await env.DB.prepare(`
            INSERT INTO review_queue (
              review_id, change_id, priority, reason,
              old_value, proposed_value, source_url, detected_at,
              status
            ) VALUES (?, ?, 'high', 'Official Etsy Policy Content Changed', ?, ?, ?, ?, 'pending');
          `).bind(reviewId, changeId, source.latest_hash, liveHash, source.source_url, fetchedAt).run();

          // Dispatch alert webhook if configured
          if (env.ALERT_WEBHOOK_URL) {
            try {
              await fetch(env.ALERT_WEBHOOK_URL, {
                method: "POST",
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
