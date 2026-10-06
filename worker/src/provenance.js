/**
 * ShopProfit Canonical Source Provenance & Composite Hashing Engine
 *
 * Implements deterministic canonicalization, composite Merkle-style source
 * manifest generation, and provenance verification across official Etsy sources.
 */

export const AUTHORITATIVE_SOURCE_SCOPES = {
  "115015628847": {
    domain: "help.etsy.com",
    scope: "payment_processing_and_deposits",
    name: "Payment Processing Fees for Selling on Etsy"
  },
  "1500011073202": {
    domain: "help.etsy.com",
    scope: "regulatory_operating_fees",
    name: "Regulatory Operating Fee"
  },
  "115014483627": {
    domain: "help.etsy.com",
    scope: "listing_and_transaction_fees",
    name: "Fees and Taxes for Selling on Etsy"
  },
  "360000338367": {
    domain: "help.etsy.com",
    scope: "offsite_ads",
    name: "How Etsy Offsite Ads Work"
  },
  "360001589928": {
    domain: "help.etsy.com",
    scope: "etsy_plus_subscription",
    name: "What is Etsy Plus?"
  },
  "360000344668": {
    domain: "help.etsy.com",
    scope: "currency_conversion",
    name: "Currency Conversion Fees"
  },
  "360040584433": {
    domain: "help.etsy.com",
    scope: "vat_on_seller_fees",
    name: "VAT on Seller Fees"
  },
  "115015710408": {
    domain: "help.etsy.com",
    scope: "etsy_payments_eligibility",
    name: "Countries Eligible for Etsy Payments"
  }
};

/**
 * Normalizes a URL into canonical format:
 * - lowercase protocol and host
 * - strip query parameters, fragments, tracking tags
 * - remove trailing slashes
 */
export function normalizeCanonicalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  try {
    const parsed = new URL(rawUrl.trim());
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}`;
  } catch {
    return rawUrl.trim().toLowerCase().replace(/\/+$/, "");
  }
}

/**
 * Extracts normalized host domain
 */
export function extractDomain(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return "help.etsy.com";
  try {
    const parsed = new URL(urlStr.trim());
    return parsed.hostname.toLowerCase();
  } catch {
    return "help.etsy.com";
  }
}

/**
 * Asynchronously computes SHA-256 hex string using Web Crypto API
 */
export async function computeSha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Canonicalizes a collection of source records into a sorted, normalized manifest array.
 *
 * Each record contains:
 * - source_id: string
 * - canonical_url: string
 * - source_domain: string
 * - content_hash: string | null
 * - retrieval_timestamp: string | null
 * - scope: string
 *
 * Guaranteed canonical ordering: sorted deterministically by source_id ascending,
 * with canonical_url as secondary tie-breaker.
 */
export function canonicalizeSourceManifest(rawSources) {
  if (!Array.isArray(rawSources)) {
    throw new Error("Source records must be an array");
  }

  const normalized = rawSources.map(s => {
    const sourceId = String(s.source_id || s.sourceId || "").trim();
    const sourceUrl = s.source_url || s.sourceUrl || s.url || "";
    const canonicalUrl = normalizeCanonicalUrl(sourceUrl);
    const domain = s.source_domain || s.sourceDomain || extractDomain(canonicalUrl);
    const contentHash = s.content_hash || s.contentHash || s.latest_hash || s.latestHash || s.hash || null;
    const retrievalTimestamp = s.retrieval_timestamp || s.retrievalTimestamp || s.last_checked_at || s.fetched_at || null;
    const defaultMeta = AUTHORITATIVE_SOURCE_SCOPES[sourceId];
    const scope = s.scope || s.governed_scope || (defaultMeta ? defaultMeta.scope : "general");

    return {
      source_id: sourceId,
      canonical_url: canonicalUrl,
      source_domain: domain,
      content_hash: contentHash ? String(contentHash).trim() : null,
      retrieval_timestamp: retrievalTimestamp ? String(retrievalTimestamp).trim() : null,
      scope: scope
    };
  });

  // Sort deterministically by source_id ascending, then canonical_url
  return normalized.sort((a, b) => {
    const idCmp = a.source_id.localeCompare(b.source_id);
    if (idCmp !== 0) return idCmp;
    return a.canonical_url.localeCompare(b.canonical_url);
  });
}

/**
 * Computes a deterministic composite source hash from a canonicalized source manifest.
 *
 * INVARIANT RULES:
 * 1. Deterministic: same manifest + same content = same hash
 * 2. Sensitive: different source content, URL, or scope = different hash
 * 3. Set-complete: different source set = different hash
 * 4. Order-independent in raw input: sorting guarantees same hash regardless of input order
 * 5. Temporal-invariant: retrieval_timestamp is EXCLUDED from the hashed preimage
 *    so unstable timestamps NEVER change the composite content hash.
 */
export async function computeCompositeSourceHash(rawSources) {
  const manifest = canonicalizeSourceManifest(rawSources);

  // Construct deterministic preimage string using ONLY semantic provenance attributes:
  // source_id, canonical_url, source_domain, scope, content_hash
  const preimageLines = manifest.map(s => 
    `${s.source_id}|${s.canonical_url}|${s.source_domain}|${s.scope}|${s.content_hash || ""}`
  );

  const preimage = preimageLines.join("\n");
  return await computeSha256(preimage);
}

/**
 * Builds the complete canonical source manifest object with composite hash and metadata
 */
export async function buildCompleteSourceManifest(rawSources) {
  const sources = canonicalizeSourceManifest(rawSources);
  const compositeHash = await computeCompositeSourceHash(sources);

  return {
    manifest_version: "1.0.0",
    generated_at: new Date().toISOString(),
    source_count: sources.length,
    composite_source_hash: compositeHash,
    sources
  };
}

/**
 * Validates that all required authoritative Etsy sources have non-empty content hashes
 * and complete evidence references.
 *
 * Throws descriptive error if provenance is incomplete or evidence is missing.
 */
export function validateSourceManifestCompleteness(manifestSources, options = {}) {
  const requiredSourceIds = options.requiredSourceIds || Object.keys(AUTHORITATIVE_SOURCE_SCOPES);
  const manifestMap = new Map();

  for (const s of manifestSources) {
    const id = String(s.source_id || s.sourceId || "").trim();
    const hash = s.content_hash || s.contentHash || s.latest_hash || s.latestHash || s.hash;
    manifestMap.set(id, { ...s, content_hash: hash });
  }

  for (const reqId of requiredSourceIds) {
    const src = manifestMap.get(reqId);
    if (!src) {
      throw new Error(`Publication blocked: Incomplete source provenance — missing authoritative source '${reqId}' in source manifest`);
    }
    if (!src.content_hash || typeof src.content_hash !== "string" || src.content_hash.trim() === "") {
      throw new Error(`Publication blocked: Incomplete source provenance — source '${reqId}' (${src.scope || AUTHORITATIVE_SOURCE_SCOPES[reqId]?.scope}) is missing a verified content hash`);
    }
  }

  return true;
}
