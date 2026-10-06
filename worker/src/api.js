/**
 * ShopProfit Fee Intelligence API Handler
 * Handles public read-only requests for versioned Etsy fee schedules.
 */

export const PUBLIC_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

const FLAGS = {
  US: "🇺🇸",
  UK: "🇬🇧",
  CA: "🇨🇦",
  AU: "🇦🇺",
  DE: "🇩🇪",
  FR: "🇫🇷",
  IT: "🇮🇹",
  ES: "🇪🇸",
  IN: "🇮🇳",
  JP: "🇯🇵",
  TR: "🇹🇷",
  OTHER: "🌐"
};

/**
 * Generates an ETag hash from content string
 */
function generateETag(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = (hash << 5) - hash + content.charCodeAt(i);
    hash |= 0;
  }
  return `"${Math.abs(hash).toString(16)}"`;
}

/**
 * Normalizes deposit schedule fields into public contract.
 * Does not expose raw database column names or synthetic zeroes.
 */
export function formatDepositSchedule(row) {
  if (
    row.deposit_minimum_amount != null ||
    row.deposit_threshold_amount != null ||
    row.deposit_fee_amount != null
  ) {
    return {
      mode: "listed",
      dailyDepositMinimum: row.deposit_minimum_amount != null ? {
        amount: row.deposit_minimum_amount,
        currency: row.deposit_minimum_currency || row.currency_code
      } : null,
      feeThreshold: row.deposit_threshold_amount != null ? {
        amount: row.deposit_threshold_amount,
        currency: row.deposit_threshold_currency || row.currency_code
      } : null,
      fee: row.deposit_fee_amount != null ? {
        amount: row.deposit_fee_amount,
        currency: row.deposit_fee_currency || row.currency_code
      } : null
    };
  }

  return {
    mode: "not_listed",
    dailyDepositMinimum: null,
    feeThreshold: null,
    fee: null
  };
}

/**
 * Handles GET /v1/fees
 * Returns the complete active fee schedule across all supported countries.
 */
export async function handleGetFees(request, env) {
  const url = new URL(request.url);
  const requestedVersion = url.searchParams.get("version");

  // Query version: specified historical version or current active version
  let versionRes;
  if (requestedVersion) {
    versionRes = await env.DB.prepare(`
      SELECT version_id, version_label, published_at, source_hash, notes
      FROM fee_versions
      WHERE (version_id = ? OR version_label = ?) AND status != 'draft'
      LIMIT 1;
    `).bind(requestedVersion, requestedVersion.replace(/^v/i, "")).first();

    if (!versionRes) {
      return new Response(JSON.stringify({ error: `Fee version '${requestedVersion}' not found` }), {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          ...PUBLIC_SECURITY_HEADERS
        }
      });
    }
  } else {
    versionRes = await env.DB.prepare(`
      SELECT version_id, version_label, published_at, source_hash, notes
      FROM fee_versions
      WHERE status = 'active'
      LIMIT 1;
    `).first();

    if (!versionRes) {
      return new Response(JSON.stringify({ error: "No active fee version found" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          ...PUBLIC_SECURITY_HEADERS
        }
      });
    }
  }

  // Query fee rules for the published version joined with country metadata for display.
  // The presence of a fee_rule in the published version is the authoritative inclusion rule.
  // Mutable countries.status MUST NOT decide whether a historical or active published rule exists in the response.
  const rulesQuery = `
    SELECT 
      r.country_code,
      c.country_name,
      c.currency_code,
      c.currency_symbol,
      c.locale,
      c.sort_order,
      r.transaction_rate,
      r.listing_fee_amount,
      r.processing_rate,
      r.processing_fixed_amount,
      r.domestic_processing_rate,
      r.domestic_processing_fixed_amount,
      r.international_processing_rate,
      r.international_processing_fixed_amount,
      r.regulatory_rate,
      r.currency_conversion_rate,
      r.offsite_rate_below_threshold,
      r.offsite_rate_above_threshold,
      r.offsite_cap_amount,
      r.plus_monthly_amount,
      r.special_rules,
      r.deposit_minimum_amount,
      r.deposit_minimum_currency,
      r.deposit_threshold_amount,
      r.deposit_threshold_currency,
      r.deposit_fee_amount,
      r.deposit_fee_currency
    FROM fee_rules r
    JOIN countries c ON r.country_code = c.country_code
    WHERE r.version_id = ?
    ORDER BY c.sort_order ASC;
  `;
  const { results } = await env.DB.prepare(rulesQuery).bind(versionRes.version_id).all();

  const countryOrder = [];
  const countries = {};

  for (const row of results) {
    countryOrder.push(row.country_code);
    countries[row.country_code] = {
      name: row.country_name,
      flag: FLAGS[row.country_code] || "🌐",
      currency: row.currency_code,
      symbol: row.currency_symbol,
      locale: row.locale,
      listingFee: row.listing_fee_amount,
      processingRate: row.processing_rate,
      processingFixed: row.processing_fixed_amount,
      regulatoryRate: row.regulatory_rate,
      plusMonthly: row.plus_monthly_amount,
      offsiteCap: row.offsite_cap_amount,
      processingNote: row.special_rules || undefined,
      depositSchedule: formatDepositSchedule(row)
    };
  }

  const payload = {
    version: versionRes.version_label,
    version_id: versionRes.version_id,
    publishedAt: versionRes.published_at,
    countryOrder,
    countries
  };

  const jsonString = JSON.stringify(payload);
  const etag = generateETag(jsonString);

  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        "ETag": etag,
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
        ...PUBLIC_SECURITY_HEADERS
      }
    });
  }

  return new Response(jsonString, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "ETag": etag,
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
      ...PUBLIC_SECURITY_HEADERS
    }
  });
}

/**
 * Handles GET /v1/fees/:country
 */
export async function handleGetCountryFee(request, env, countryCode) {
  const code = countryCode.toUpperCase();
  const query = `
    SELECT 
      c.country_code,
      c.country_name,
      c.currency_code,
      c.currency_symbol,
      c.locale,
      r.transaction_rate,
      r.listing_fee_amount,
      r.processing_rate,
      r.processing_fixed_amount,
      r.regulatory_rate,
      r.plus_monthly_amount,
      r.offsite_cap_amount,
      r.special_rules,
      r.deposit_minimum_amount,
      r.deposit_minimum_currency,
      r.deposit_threshold_amount,
      r.deposit_threshold_currency,
      r.deposit_fee_amount,
      r.deposit_fee_currency,
      v.version_id,
      v.version_label,
      v.published_at
    FROM fee_rules r
    JOIN fee_versions v ON r.version_id = v.version_id
    JOIN countries c ON r.country_code = c.country_code
    WHERE v.status = 'active' AND r.country_code = ?
    LIMIT 1;
  `;
  const row = await env.DB.prepare(query).bind(code).first();

  if (!row) {
    return new Response(JSON.stringify({ error: `Country '${code}' not found in active fee schedule` }), {
      status: 404,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        ...PUBLIC_SECURITY_HEADERS
      }
    });
  }

  const countryData = {
    version: row.version_label,
    version_id: row.version_id,
    publishedAt: row.published_at,
    country: {
      code: row.country_code,
      name: row.country_name,
      flag: FLAGS[row.country_code] || "🌐",
      currency: row.currency_code,
      symbol: row.currency_symbol,
      locale: row.locale,
      listingFee: row.listing_fee_amount,
      processingRate: row.processing_rate,
      processingFixed: row.processing_fixed_amount,
      regulatoryRate: row.regulatory_rate,
      plusMonthly: row.plus_monthly_amount,
      offsiteCap: row.offsite_cap_amount,
      processingNote: row.special_rules || undefined,
      depositSchedule: formatDepositSchedule(row)
    }
  };

  return new Response(JSON.stringify(countryData), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
      ...PUBLIC_SECURITY_HEADERS
    }
  });
}

/**
 * Handles GET /v1/version
 */
export async function handleGetVersion(request, env) {
  const query = `
    SELECT version_id, version_label, status, created_at, published_at, source_hash, source_manifest_hash, approved_by, notes
    FROM fee_versions
    WHERE status = 'active'
    LIMIT 1;
  `;
  const version = await env.DB.prepare(query).first();

  if (!version) {
    return new Response(JSON.stringify({ error: "No active version found" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        ...PUBLIC_SECURITY_HEADERS
      }
    });
  }

  return new Response(JSON.stringify(version), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=600",
      "Access-Control-Allow-Origin": "*",
      ...PUBLIC_SECURITY_HEADERS
    }
  });
}
