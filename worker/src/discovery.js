/**
 * ShopProfit Global Official Etsy Data Discovery & Semantic Extraction Engine
 * Fetches official tables, parses market rates, compares against active D1 baseline,
 * and creates structured change events in the review queue.
 */

import {
  parsePaymentProcessingTable,
  parseDepositFeesTable,
  parseRegulatoryFeesTable
} from "./parser.js";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ShopProfitDiscovery/1.0";

function generateId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

async function computeSha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Runs complete global official data discovery against official Etsy Help Center
 */
export async function runGlobalDataDiscovery(env) {
  const runId = generateId("disc_run");
  const startedAt = new Date().toISOString();

  let sourcesChecked = 0;
  let sourcesChanged = 0;
  let countriesExtracted = 0;
  let changesDetected = 0;
  let reviewsCreated = 0;
  let errors = 0;
  let lastErrorMessage = null;
  const discoveredMarkets = [];
  const newlyDiscoveredCountries = [];
  const removedCountries = [];
  const fieldChanges = [];

  try {
    // 1. Fetch official Payment Processing article (115015628847)
    const fetchFn = env.fetchOverride || fetch;
    const procUrl = "https://help.etsy.com/api/v2/help_center/en-us/articles/115015628847.json";
    const procRes = await fetchFn(procUrl, { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } });
    sourcesChecked++;

    if (!procRes.ok) {
      throw new Error(`Failed to fetch payment processing article: HTTP ${procRes.status}`);
    }

    const procJson = await procRes.json();
    const procBody = procJson?.article?.body || "";
    const procHash = await computeSha256(procBody);

    // Check if source changed compared to previous successful snapshot
    const prevProcSnap = await env.DB.prepare(`
      SELECT content_hash FROM snapshots WHERE source_id = '115015628847' AND success = 1 ORDER BY fetched_at DESC LIMIT 1;
    `).first();

    if (prevProcSnap && prevProcSnap.content_hash !== procHash) {
      sourcesChanged++;
    }

    // Save retention-safe snapshot
    const snapIdProc = generateId("snap");
    await env.DB.prepare(`
      INSERT INTO snapshots (
        snapshot_id, source_id, fetched_at, http_status, content_type,
        raw_content, normalized_content, content_hash, normalized_hash,
        parser_version, success
      ) VALUES (?, '115015628847', ?, 200, 'application/json', ?, ?, ?, ?, '2.0.0', 1);
    `).bind(snapIdProc, startedAt, procBody.substring(0, 15000), procBody.replace(/<[^>]+>/g, " ").substring(0, 5000), procHash, procHash).run();

    // Parse tables
    const { markets, validationErrors } = parsePaymentProcessingTable(procBody);
    const depositRules = parseDepositFeesTable(procBody);
    countriesExtracted = markets.length;

    // 2. Fetch Regulatory Operating Fee article (1500011073202)
    const regUrl = "https://help.etsy.com/api/v2/help_center/en-us/articles/1500011073202.json";
    const regRes = await fetchFn(regUrl, { headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } });
    sourcesChecked++;

    let regRules = [];
    if (regRes.ok) {
      const regJson = await regRes.json();
      const regBody = regJson?.article?.body || "";
      const regHash = await computeSha256(regBody);

      const prevRegSnap = await env.DB.prepare(`
        SELECT content_hash FROM snapshots WHERE source_id = '1500011073202' AND success = 1 ORDER BY fetched_at DESC LIMIT 1;
      `).first();

      if (prevRegSnap && prevRegSnap.content_hash !== regHash) {
        sourcesChanged++;
      }

      await env.DB.prepare(`
        INSERT INTO snapshots (
          snapshot_id, source_id, fetched_at, http_status, content_type,
          raw_content, normalized_content, content_hash, normalized_hash,
          parser_version, success
        ) VALUES (?, '1500011073202', ?, 200, 'application/json', ?, ?, ?, ?, '2.0.0', 1);
      `).bind(generateId("snap"), startedAt, regBody.substring(0, 15000), regBody.replace(/<[^>]+>/g, " ").substring(0, 5000), regHash, regHash).run();

      regRules = parseRegulatoryFeesTable(regBody);
    }

    // Merge regulatory and deposit rules into candidate market set
    const candidateMap = new Map();
    for (const m of markets) {
      candidateMap.set(m.countryCode, {
        ...m,
        regulatoryRate: null,
        depositMinimumAmount: null,
        depositThresholdAmount: null,
        depositFeeAmount: null
      });
    }

    for (const r of regRules) {
      const existing = candidateMap.get(r.countryCode);
      if (existing) {
        existing.regulatoryRate = r.regulatoryRate;
      }
    }

    for (const d of depositRules) {
      const existing = candidateMap.get(d.countryCode);
      if (existing) {
        existing.depositMinimumAmount = d.depositMinimumAmount;
        existing.depositThresholdAmount = d.depositThresholdAmount;
        existing.depositFeeAmount = d.depositFeeAmount;
      }
    }

    // 3. Query current D1 active baseline (countries & fee_rules)
    const { results: d1Countries } = await env.DB.prepare(`
      SELECT c.country_code, c.country_name, c.currency_code, c.status,
             r.processing_rate, r.processing_fixed_amount, r.regulatory_rate
      FROM countries c
      LEFT JOIN fee_rules r ON c.country_code = r.country_code
      LEFT JOIN fee_versions v ON r.version_id = v.version_id AND v.status = 'active';
    `).all();

    const d1CountryMap = new Map();
    for (const c of d1Countries) {
      d1CountryMap.set(c.country_code, c);
    }

    // 4. Semantic Comparison & Change Detection
    for (const [code, candidate] of candidateMap.entries()) {
      discoveredMarkets.push(code);
      const current = d1CountryMap.get(code);

      if (!current) {
        // NEW COUNTRY DISCOVERED
        newlyDiscoveredCountries.push(code);

        // Record in countries table with status = 'pending_review' to satisfy foreign keys and data modeling rules
        await env.DB.prepare(`
          INSERT INTO countries (
            country_code, country_name, currency_code, currency_symbol,
            locale, etsy_payments_status, status, sort_order, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'en', 'supported', 'pending_review', 999, ?, ?)
          ON CONFLICT(country_code) DO NOTHING;
        `).bind(code, candidate.countryName, candidate.currency, candidate.currency, startedAt, startedAt).run();

        // Idempotency: Check if change is already queued
        const existingPending = await env.DB.prepare(`
          SELECT change_id FROM detected_changes
          WHERE country_code = ? AND change_type = 'new_country' AND status = 'pending_review';
        `).bind(code).first();

        if (!existingPending) {
          changesDetected++;
          const chgId = generateId("chg_new");
          await env.DB.prepare(`
            INSERT INTO detected_changes (
              change_id, source_id, snapshot_id, country_code, field_name,
              old_value, new_value, change_type, detected_at, status, validation_message
            ) VALUES (?, '115015628847', ?, ?, 'market_availability', NULL, ?, 'new_country', ?, 'pending_review', 'Discovered in official Etsy Payments table');
          `).bind(chgId, snapIdProc, code, `${candidate.countryName} (${candidate.currency}): ${candidate.processingRate * 100}% + ${candidate.processingFixed}`, startedAt).run();

          const revId = generateId("rev_new");
          reviewsCreated++;
          await env.DB.prepare(`
            INSERT INTO review_queue (
              review_id, change_id, priority, reason, old_value, proposed_value,
              source_url, detected_at, status
            ) VALUES (?, ?, 'medium', 'New sovereign Etsy Payments market discovered', NULL, ?, 'https://help.etsy.com/hc/en-us/articles/115015628847', ?, 'pending');
          `).bind(revId, chgId, JSON.stringify(candidate), startedAt).run();
        }

      } else {
        // EXISTING COUNTRY — Check currency change
        if (current.currency_code && candidate.currency && current.currency_code !== candidate.currency) {
          const existingPendingCurr = await env.DB.prepare(`
            SELECT change_id FROM detected_changes
            WHERE country_code = ? AND change_type = 'currency_changed' AND status = 'pending_review';
          `).bind(code).first();

          if (!existingPendingCurr) {
            changesDetected++;
            fieldChanges.push({ country: code, field: "currency", old: current.currency_code, new: candidate.currency });
            const chgId = generateId("chg_curr");
            await env.DB.prepare(`
              INSERT INTO detected_changes (
                change_id, source_id, snapshot_id, country_code, field_name,
                old_value, new_value, change_type, detected_at, status, validation_message
              ) VALUES (?, '115015628847', ?, ?, 'currency', ?, ?, 'currency_changed', ?, 'pending_review', 'Currency differs from baseline');
            `).bind(chgId, snapIdProc, code, current.currency_code, candidate.currency, startedAt).run();

            reviewsCreated++;
            await env.DB.prepare(`
              INSERT INTO review_queue (
                review_id, change_id, priority, reason, old_value, proposed_value,
                source_url, detected_at, status
              ) VALUES (?, ?, 'high', 'Official currency changed', ?, ?, 'https://help.etsy.com/hc/en-us/articles/115015628847', ?, 'pending');
            `).bind(generateId("rev"), chgId, current.currency_code, candidate.currency, startedAt).run();
          }
        }

        // EXISTING COUNTRY — Check processing rate change
        if (current.processing_rate !== null && Math.abs(current.processing_rate - candidate.processingRate) > 0.0001) {
          const existingPendingRate = await env.DB.prepare(`
            SELECT change_id FROM detected_changes
            WHERE country_code = ? AND change_type = 'processing_rate_changed' AND status = 'pending_review';
          `).bind(code).first();

          if (!existingPendingRate) {
            changesDetected++;
            fieldChanges.push({ country: code, field: "processing_rate", old: current.processing_rate, new: candidate.processingRate });

            const isSuspicious = Math.abs(current.processing_rate - candidate.processingRate) >= 0.05 || candidate.processingRate > 0.25;
            const priority = isSuspicious ? "critical" : "high";
            const validationMsg = isSuspicious 
              ? "SUSPICIOUS: rate change exceeds safety threshold (delta >= 5%)"
              : "Processing rate differs from active baseline";

            const chgId = generateId("chg_rate");
            await env.DB.prepare(`
              INSERT INTO detected_changes (
                change_id, source_id, snapshot_id, country_code, field_name,
                old_value, new_value, change_type, detected_at, status, validation_message
              ) VALUES (?, '115015628847', ?, ?, 'processing_rate', ?, ?, 'processing_rate_changed', ?, 'pending_review', ?);
            `).bind(chgId, snapIdProc, code, String(current.processing_rate), String(candidate.processingRate), startedAt, validationMsg).run();

            reviewsCreated++;
            await env.DB.prepare(`
              INSERT INTO review_queue (
                review_id, change_id, priority, reason, old_value, proposed_value,
                source_url, detected_at, status
              ) VALUES (?, ?, ?, 'Official payment processing rate changed', ?, ?, 'https://help.etsy.com/hc/en-us/articles/115015628847', ?, 'pending');
            `).bind(generateId("rev"), chgId, priority, String(current.processing_rate), String(candidate.processingRate), startedAt).run();
          }
        }

        // EXISTING COUNTRY — Check regulatory rate change
        if (candidate.regulatoryRate !== null && current.regulatory_rate !== null && Math.abs(current.regulatory_rate - candidate.regulatoryRate) > 0.0001) {
          const existingPendingReg = await env.DB.prepare(`
            SELECT change_id FROM detected_changes
            WHERE country_code = ? AND change_type = 'regulatory_rate_changed' AND status = 'pending_review';
          `).bind(code).first();

          if (!existingPendingReg) {
            changesDetected++;
            fieldChanges.push({ country: code, field: "regulatory_rate", old: current.regulatory_rate, new: candidate.regulatoryRate });

            const chgId = generateId("chg_reg");
            await env.DB.prepare(`
              INSERT INTO detected_changes (
                change_id, source_id, snapshot_id, country_code, field_name,
                old_value, new_value, change_type, detected_at, status, validation_message
              ) VALUES (?, '1500011073202', ?, ?, 'regulatory_rate', ?, ?, 'regulatory_rate_changed', ?, 'pending_review', 'Regulatory fee differs from active baseline');
            `).bind(chgId, snapIdProc, code, String(current.regulatory_rate), String(candidate.regulatoryRate), startedAt).run();

            reviewsCreated++;
            await env.DB.prepare(`
              INSERT INTO review_queue (
                review_id, change_id, priority, reason, old_value, proposed_value,
                source_url, detected_at, status
              ) VALUES (?, ?, 'high', 'Official regulatory operating fee changed', ?, ?, 'https://help.etsy.com/hc/en-us/articles/1500011073202', ?, 'pending');
            `).bind(generateId("rev"), chgId, String(current.regulatory_rate), String(candidate.regulatoryRate), startedAt).run();
          }
        }
      }
    }

    // 5. Check for removed countries (in D1 with status='active' but missing in official table)
    for (const [code, d1Item] of d1CountryMap.entries()) {
      if (code !== "OTHER" && d1Item.status === "active" && !candidateMap.has(code)) {
        removedCountries.push(code);

        const existingPendingRem = await env.DB.prepare(`
          SELECT change_id FROM detected_changes
          WHERE country_code = ? AND change_type = 'removed_country' AND status = 'pending_review';
        `).bind(code).first();

        if (!existingPendingRem) {
          changesDetected++;

          // Preserve country history by marking status='pending_review' instead of deleting
          await env.DB.prepare(`
            UPDATE countries SET status = 'pending_review', updated_at = ? WHERE country_code = ?;
          `).bind(startedAt, code).run();

          const chgId = generateId("chg_rem");
          await env.DB.prepare(`
            INSERT INTO detected_changes (
              change_id, source_id, snapshot_id, country_code, field_name,
              old_value, new_value, change_type, detected_at, status, validation_message
            ) VALUES (?, '115015628847', ?, ?, 'market_availability', 'active', 'unlisted', 'removed_country', ?, 'pending_review', 'Country absent from published table');
          `).bind(chgId, snapIdProc, code, startedAt).run();

          reviewsCreated++;
          await env.DB.prepare(`
            INSERT INTO review_queue (
              review_id, change_id, priority, reason, old_value, proposed_value,
              source_url, detected_at, status
            ) VALUES (?, ?, 'high', 'Country missing from official Etsy published table', 'active', 'inactive', 'https://help.etsy.com/hc/en-us/articles/115015628847', ?, 'pending');
          `).bind(generateId("rev"), chgId, startedAt).run();
        }
      }
    }

  } catch (fatalErr) {
    errors++;
    lastErrorMessage = fatalErr.message;
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
    runId, startedAt, completedAt, errors > 0 ? "completed_with_errors" : "completed",
    sourcesChecked, sourcesChanged, changesDetected,
    reviewsCreated, errors, lastErrorMessage
  ).run();

  return {
    runId,
    status: errors > 0 ? "completed_with_errors" : "completed",
    sourcesChecked,
    sourcesChanged,
    countriesExtracted,
    discoveredMarketsCount: discoveredMarkets.length,
    newlyDiscoveredCount: newlyDiscoveredCountries.length,
    newlyDiscoveredCountries,
    removedCountriesCount: removedCountries.length,
    removedCountries,
    fieldChanges,
    changesDetected,
    reviewsCreated,
    errors,
    startedAt,
    completedAt
  };
}
