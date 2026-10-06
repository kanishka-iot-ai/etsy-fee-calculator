/**
 * ShopProfit Fee Intelligence API Client
 *
 * Consumes the global versioned Etsy Fee Intelligence API (/v1/fees).
 * Enforces strict runtime validation, version safety, and non-silent error handling.
 *
 * SAFETY INVARIANTS:
 * - Pure client module: Accepts dependency-injected fetch; never triggers unsolicited network calls.
 * - Version lock: Rejects unexpected API versions (expected: v1.1.1) to prevent silent fallback to stale fees.
 * - Strict structural validation: Validates countryOrder, country mappings, and field types.
 * - Zero secrets: Communicates strictly with public read-only endpoints.
 */

import { normalizeFeeSchedule } from "./compatibility.js";

export const EXPECTED_VERSION_ID = "v1.1.1";
export const DEFAULT_API_BASE = "https://shopprofit-fee-intelligence.kanishka-bmchak.workers.dev";
export const FEE_CACHE_KEY = "shopprofit_fee_intelligence_cache_v1";
export const FEE_CACHE_TTL_MS = 60 * 60 * 1000; // 1-hour client cache TTL

/**
 * Retrieves valid cached fees payload from storage (e.g. localStorage).
 * Returns null if cache is absent, expired, or version-mismatched.
 */
export function getCachedFees(storage, options = {}) {
  if (!storage) return null;
  const key = options.cacheKey || FEE_CACHE_KEY;
  const ttl = options.ttlMs || FEE_CACHE_TTL_MS;
  const expectedVersion = options.expectedVersion || options.allowVersion || EXPECTED_VERSION_ID;

  try {
    const raw = typeof storage.get === "function" ? storage.get(key) : storage.getItem(key);
    if (!raw) return null;
    const entry = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!entry || typeof entry !== "object") return null;

    // Check version
    if (entry.version_id !== expectedVersion) {
      clearCachedFees(storage, options);
      return null;
    }

    // Check TTL
    const now = typeof options.now === "function" ? options.now() : Date.now();
    if (typeof entry.timestamp === "number" && now - entry.timestamp > ttl) {
      clearCachedFees(storage, options);
      return null;
    }

    // Validate cached payload structure
    const validated = validateFeesPayload(entry.payload, { expectedVersion });
    return validated;
  } catch {
    return null;
  }
}

/**
 * Stores validated fees payload into storage with current timestamp and version.
 */
export function setCachedFees(payload, storage, options = {}) {
  if (!storage || !payload) return;
  const key = options.cacheKey || FEE_CACHE_KEY;
  const expectedVersion = options.expectedVersion || options.allowVersion || EXPECTED_VERSION_ID;
  validateFeesPayload(payload, { expectedVersion });

  const entry = {
    version_id: payload.version_id,
    timestamp: typeof options.now === "function" ? options.now() : Date.now(),
    payload
  };

  try {
    const serialized = JSON.stringify(entry);
    if (typeof storage.set === "function") storage.set(key, serialized);
    else if (typeof storage.setItem === "function") storage.setItem(key, serialized);
  } catch {
    // Ignore private browsing storage quota exceptions
  }
}

/**
 * Clears cached fee intelligence payload from storage.
 */
export function clearCachedFees(storage, options = {}) {
  if (!storage) return;
  const key = options.cacheKey || FEE_CACHE_KEY;
  try {
    if (typeof storage.remove === "function") storage.remove(key);
    else if (typeof storage.removeItem === "function") storage.removeItem(key);
  } catch {}
}

/**
 * Validates a /v1/fees API response payload against the v1.1.1 schema contract.
 * Throws descriptive errors if any invariant fails.
 */
export function validateFeesPayload(payload, options = {}) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid API response: payload must be a non-null object");
  }

  const expectedVersion = options.expectedVersion || options.allowVersion || EXPECTED_VERSION_ID;
  if (payload.version_id !== expectedVersion) {
    throw new Error(
      `Version mismatch: expected active fee version '${expectedVersion}', but API returned '${payload.version_id}'`
    );
  }

  if (!Array.isArray(payload.countryOrder) || payload.countryOrder.length === 0) {
    throw new Error("Malformed API response: countryOrder must be a non-empty array");
  }

  if (options.expectedCountryCount && payload.countryOrder.length !== options.expectedCountryCount) {
    throw new Error(
      `Country count mismatch: expected ${options.expectedCountryCount} countries, got ${payload.countryOrder.length}`
    );
  }

  if (!payload.countries || typeof payload.countries !== "object") {
    throw new Error("Malformed API response: countries must be a non-null dictionary object");
  }

  // Validate each listed country in countryOrder
  for (const code of payload.countryOrder) {
    const record = payload.countries[code];
    if (!record || typeof record !== "object") {
      throw new Error(`Malformed API response: missing country record for code '${code}' in countries dictionary`);
    }

    if (!record.currency || typeof record.currency !== "string") {
      throw new Error(`Malformed country record '${code}': missing currency code`);
    }

    if (record.processingRate === undefined || record.processingRate === null || typeof record.processingRate !== "number") {
      throw new Error(`Malformed country record '${code}': processingRate must be a valid number`);
    }

    if (record.processingFixed === undefined || record.processingFixed === null || typeof record.processingFixed !== "number") {
      throw new Error(`Malformed country record '${code}': processingFixed must be a valid number`);
    }
  }

  return payload;
}

/**
 * Validates a /v1/fees/:country API response payload against the schema contract.
 */
export function validateCountryPayload(payload, options = {}) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid API response: payload must be a non-null object");
  }

  const expectedVersion = options.expectedVersion || options.allowVersion || EXPECTED_VERSION_ID;
  if (payload.version_id !== expectedVersion) {
    throw new Error(
      `Version mismatch: expected active fee version '${expectedVersion}', but API returned '${payload.version_id}'`
    );
  }

  const country = payload.country;
  if (!country || typeof country !== "object") {
    throw new Error("Malformed API response: missing country object in response");
  }

  const expectedCode = options.countryCode ? options.countryCode.toUpperCase() : null;
  if (expectedCode && country.code && country.code.toUpperCase() !== expectedCode) {
    throw new Error(`Country code mismatch: requested '${expectedCode}', got '${country.code}'`);
  }

  if (!country.currency || typeof country.currency !== "string") {
    throw new Error(`Malformed country record: missing currency code`);
  }

  if (country.processingRate === undefined || country.processingRate === null || typeof country.processingRate !== "number") {
    throw new Error(`Malformed country record: processingRate must be a valid number`);
  }

  return payload;
}

/**
 * High-reliability client for the global Etsy Fee Intelligence API.
 */
export class FeeIntelligenceClient {
  /**
   * @param {string} [baseUrl=DEFAULT_API_BASE] - API origin base URL
   * @param {Object} [options] - Configuration options
   * @param {Function} [options.fetch=globalThis.fetch] - Injected fetch function
   * @param {string} [options.expectedVersion=EXPECTED_VERSION_ID] - Required API version
   */
  constructor(baseUrl = DEFAULT_API_BASE, options = {}) {
    this.baseUrl = String(baseUrl || DEFAULT_API_BASE).replace(/\/+$/, "");
    const rawFetch = options.fetch || (
      typeof globalThis !== "undefined" ? globalThis.fetch : null
    );
    this.fetchFn =
      typeof rawFetch === "function"
        ? (options.fetch ? rawFetch : rawFetch.bind(globalThis))
        : null;
    this.expectedVersion = options.expectedVersion || EXPECTED_VERSION_ID;
  }

  /**
   * Fetches full fee intelligence payload (/v1/fees).
   *
   * @param {Object} [options]
   * @param {string} [options.version] - Explicit historical version query (e.g. 'v1.0.0')
   * @param {string} [options.expectedVersion] - Override expected version validation
   * @returns {Promise<Object>} Validated API response payload
   */
  async fetchFees(options = {}) {
    if (typeof this.fetchFn !== "function") {
      throw new Error("Fetch implementation is unavailable. Provide options.fetch to FeeIntelligenceClient.");
    }

    let url = `${this.baseUrl}/v1/fees`;
    if (options.version) {
      url += `?version=${encodeURIComponent(options.version)}`;
    }

    const res = await this.fetchFn(url, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch fee intelligence: HTTP ${res.status} ${res.statusText}`);
    }

    const payload = await res.json();
    const validateOpts = {
      expectedVersion: options.expectedVersion || options.version || this.expectedVersion,
      expectedCountryCount: options.expectedCountryCount
    };

    return validateFeesPayload(payload, validateOpts);
  }

  /**
   * Fetches fee schedule for a single market (/v1/fees/:country).
   *
   * @param {string} countryCode - ISO 3166-1 alpha-2 or 'OTHER'
   * @param {Object} [options]
   * @returns {Promise<Object>} Validated country payload
   */
  async fetchCountryFee(countryCode, options = {}) {
    if (!countryCode || typeof countryCode !== "string") {
      throw new Error("Invalid countryCode: must be a non-empty string");
    }

    if (typeof this.fetchFn !== "function") {
      throw new Error("Fetch implementation is unavailable. Provide options.fetch to FeeIntelligenceClient.");
    }

    const code = countryCode.toUpperCase();
    const url = `${this.baseUrl}/v1/fees/${encodeURIComponent(code)}`;

    const res = await this.fetchFn(url, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch country fee for '${code}': HTTP ${res.status} ${res.statusText}`);
    }

    const payload = await res.json();
    return validateCountryPayload(payload, {
      expectedVersion: options.expectedVersion || this.expectedVersion,
      countryCode: code
    });
  }

  /**
   * High-reliability loader that utilizes short-lived client cache before network fetch.
   * If cache is missing, expired, or version-mismatched, fetches from the API and refreshes cache.
   * If network fails or version is rejected, throws descriptive error (never silently uses stale data).
   */
  async loadFees(options = {}) {
    const storage = options.storage !== undefined ? options.storage : (typeof localStorage !== "undefined" ? localStorage : null);
    if (!options.bypassCache && storage) {
      const cached = getCachedFees(storage, options);
      if (cached) {
        return { payload: cached, fromCache: true };
      }
    }

    const payload = await this.fetchFees(options);
    if (storage) {
      setCachedFees(payload, storage, options);
    }
    return { payload, fromCache: false };
  }

  /**
   * Loads fees via cache/API and returns normalized schedules map plus metadata.
   */
  async loadAllNormalizedFeeSchedules(options = {}) {
    const { payload, fromCache } = await this.loadFees(options);
    const schedules = new Map();

    for (const code of payload.countryOrder) {
      const c = payload.countries[code];
      const normalized = normalizeFeeSchedule(
        {
          country_code: code,
          country_name: c.name,
          currency_code: c.currency,
          currency_symbol: c.symbol,
          locale: c.locale,
          listing_fee_amount: c.listingFee,
          processing_rate: c.processingRate,
          processing_fixed_amount: c.processingFixed,
          domestic_processing_rate: c.domesticRate,
          domestic_processing_fixed_amount: c.domesticFixed,
          international_processing_rate: c.internationalRate,
          international_processing_fixed_amount: c.internationalFixed,
          regulatory_rate: c.regulatoryRate,
          plus_monthly_amount: c.plusMonthly,
          deposit_minimum_amount: c.depositSchedule?.dailyDepositMinimum?.amount,
          deposit_minimum_currency: c.depositSchedule?.dailyDepositMinimum?.currency,
          deposit_threshold_amount: c.depositSchedule?.feeThreshold?.amount,
          deposit_threshold_currency: c.depositSchedule?.feeThreshold?.currency,
          deposit_fee_amount: c.depositSchedule?.fee?.amount,
          deposit_fee_currency: c.depositSchedule?.fee?.currency,
          special_rules: c.processingNote,
          version_id: payload.version_id
        },
        options
      );
      schedules.set(code, normalized);
    }

    return {
      schedules,
      countryOrder: payload.countryOrder,
      version_id: payload.version_id,
      publishedAt: payload.publishedAt,
      fromCache
    };
  }

  /**
   * Fetches and normalizes a single market's schedule for consumption by fee-engine.js.
   *
   * @param {string} countryCode
   * @param {Object} [options]
   * @returns {Promise<Object>} Normalized fee schedule (via compatibility.js)
   */
  async getNormalizedFeeSchedule(countryCode, options = {}) {
    const payload = await this.fetchCountryFee(countryCode, options);
    const countryData = payload.country;
    return normalizeFeeSchedule(
      {
        country_code: countryData.code || countryCode,
        country_name: countryData.name,
        currency_code: countryData.currency,
        currency_symbol: countryData.symbol,
        locale: countryData.locale,
        listing_fee_amount: countryData.listingFee,
        processing_rate: countryData.processingRate,
        processing_fixed_amount: countryData.processingFixed,
        domestic_processing_rate: countryData.domesticRate,
        domestic_processing_fixed_amount: countryData.domesticFixed,
        international_processing_rate: countryData.internationalRate,
        international_processing_fixed_amount: countryData.internationalFixed,
        regulatory_rate: countryData.regulatoryRate,
        plus_monthly_amount: countryData.plusMonthly,
        deposit_minimum_amount: countryData.depositSchedule?.dailyDepositMinimum?.amount,
        deposit_minimum_currency: countryData.depositSchedule?.dailyDepositMinimum?.currency,
        deposit_threshold_amount: countryData.depositSchedule?.feeThreshold?.amount,
        deposit_threshold_currency: countryData.depositSchedule?.feeThreshold?.currency,
        deposit_fee_amount: countryData.depositSchedule?.fee?.amount,
        deposit_fee_currency: countryData.depositSchedule?.fee?.currency,
        special_rules: countryData.processingNote,
        version_id: payload.version_id
      },
      options
    );
  }

  /**
   * Fetches full fee intelligence and returns all normalized schedules mapped by country code.
   *
   * @param {Object} [options]
   * @returns {Promise<Map<string, Object>>} Map of countryCode -> normalized fee schedule
   */
  async getAllNormalizedFeeSchedules(options = {}) {
    const payload = await this.fetchFees(options);
    const map = new Map();

    for (const code of payload.countryOrder) {
      const c = payload.countries[code];
      const normalized = normalizeFeeSchedule(
        {
          country_code: code,
          country_name: c.name,
          currency_code: c.currency,
          currency_symbol: c.symbol,
          locale: c.locale,
          listing_fee_amount: c.listingFee,
          processing_rate: c.processingRate,
          processing_fixed_amount: c.processingFixed,
          domestic_processing_rate: c.domesticRate,
          domestic_processing_fixed_amount: c.domesticFixed,
          international_processing_rate: c.internationalRate,
          international_processing_fixed_amount: c.internationalFixed,
          regulatory_rate: c.regulatoryRate,
          plus_monthly_amount: c.plusMonthly,
          deposit_minimum_amount: c.depositSchedule?.dailyDepositMinimum?.amount,
          deposit_minimum_currency: c.depositSchedule?.dailyDepositMinimum?.currency,
          deposit_threshold_amount: c.depositSchedule?.feeThreshold?.amount,
          deposit_threshold_currency: c.depositSchedule?.feeThreshold?.currency,
          deposit_fee_amount: c.depositSchedule?.fee?.amount,
          deposit_fee_currency: c.depositSchedule?.fee?.currency,
          special_rules: c.processingNote,
          version_id: payload.version_id
        },
        options
      );
      map.set(code, normalized);
    }

    return map;
  }
}

/**
 * Factory helper for creating fee clients with custom configurations.
 */
export function createFeeClient(baseUrl, options) {
  return new FeeIntelligenceClient(baseUrl, options);
}
