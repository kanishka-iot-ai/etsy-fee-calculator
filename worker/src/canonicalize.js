/**
 * Canonical Country & Currency Resolution Dictionary
 * Maps official Etsy published country names to standard ISO 3166-1 alpha-2 codes.
 */

export const COUNTRY_ISO_MAP = {
  "argentina": "AR",
  "australia": "AU",
  "austria": "AT",
  "belgium": "BE",
  "brazil": "BR",
  "bulgaria": "BG",
  "canada": "CA",
  "chile": "CL",
  "china": "CN",
  "croatia": "HR",
  "cyprus": "CY",
  "czech republic": "CZ",
  "denmark": "DK",
  "egypt": "EG",
  "estonia": "EE",
  "finland": "FI",
  "france": "FR",
  "georgia": "GE",
  "germany": "DE",
  "greece": "GR",
  "hong kong": "HK",
  "hungary": "HU",
  "india": "IN",
  "indonesia": "ID",
  "ireland": "IE",
  "israel": "IL",
  "italy": "IT",
  "japan": "JP",
  "kazakhstan": "KZ",
  "latvia": "LV",
  "lithuania": "LT",
  "luxembourg": "LU",
  "malaysia": "MY",
  "malta": "MT",
  "mexico": "MX",
  "morocco": "MA",
  "netherlands": "NL",
  "new zealand": "NZ",
  "norway": "NO",
  "pakistan": "PK",
  "peru": "PE",
  "philippines": "PH",
  "poland": "PL",
  "portugal": "PT",
  "romania": "RO",
  "serbia": "RS",
  "singapore": "SG",
  "slovakia": "SK",
  "slovenia": "SI",
  "south africa": "ZA",
  "south korea": "KR",
  "spain": "ES",
  "sweden": "SE",
  "switzerland": "CH",
  "thailand": "TH",
  "türkiye": "TR",
  "turkey": "TR",
  "ukraine": "UA",
  "united arab emirates": "AE",
  "united kingdom": "UK",
  "great britain": "UK",
  "united states": "US",
  "vietnam": "VN"
};

export const VALID_CURRENCIES = new Set([
  "USD", "GBP", "EUR", "CAD", "AUD", "JPY", "INR", "TRY", "CHF",
  "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "ILS", "SGD", "HKD",
  "NZD", "MXN", "MYR", "PHP", "ZAR", "IDR", "VND", "MAD", "BRL",
  "ARS", "CLP", "EGP", "GEL", "KZT", "PKR", "PEN", "RSD", "THB", "UAH"
]);

/**
 * Resolves a raw published country name into an ISO code and clean display name.
 */
export function canonicalizeCountry(rawName) {
  if (!rawName || typeof rawName !== "string") return null;

  // Clean annotations like "(domestic orders)" or "(domestic orders or orders from the US)"
  const cleanName = rawName.replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
  const isoCode = COUNTRY_ISO_MAP[cleanName] || null;

  // Determine order scope note
  let orderScope = "all";
  if (/\bdomestic\b/i.test(rawName)) orderScope = "domestic";
  if (/\binternational\b/i.test(rawName)) orderScope = "international";

  return {
    rawName,
    cleanName: rawName.replace(/\s*\([^)]*\)/g, "").trim(),
    isoCode,
    orderScope
  };
}
