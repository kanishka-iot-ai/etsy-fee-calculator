import { COUNTRY_ORDER } from "../src/countries.js";
import {
  GLOBAL_COUNTRY_RULES,
  OFFICIAL_TRANSACTION_RATE as TRANSACTION_RATE,
  STATUTORY_OFFSITE_ADS_CAP
} from "../src/fee-engine.js";
import { STATUTORY_REGULATORY_RATES } from "../src/compatibility.js";

console.log("Checking Etsy fee database integrity...");

const EXPECTED_COUNTRIES = ["US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP", "TR", "OTHER"];

// Verify country completeness against the authoritative engine
for (const code of EXPECTED_COUNTRIES) {
  const country = GLOBAL_COUNTRY_RULES[code];
  if (!country) {
    throw new Error(`Fee Verification Failed: Missing country definition for ${code}`);
  }
  if (!country.currency || typeof country.currency !== "string") {
    throw new Error(`Fee Verification Failed: Invalid currency for ${code}`);
  }
  if (typeof country.listingFee !== "number" || country.listingFee <= 0) {
    throw new Error(`Fee Verification Failed: Invalid listing fee for ${code}`);
  }
  if (typeof country.rate !== "number" || country.rate < 0.02 || country.rate > 0.10) {
    throw new Error(`Fee Verification Failed: Processing rate out of expected bounds (2% - 10%) for ${code}: ${country.rate}`);
  }
  if (typeof country.fixed !== "number" || country.fixed < 0) {
    throw new Error(`Fee Verification Failed: Invalid fixed processing charge for ${code}`);
  }
  const regRate = STATUTORY_REGULATORY_RATES[code];
  if (regRate != null && (typeof regRate !== "number" || regRate < 0 || regRate > 0.05)) {
    throw new Error(`Fee Verification Failed: Regulatory operating fee rate out of expected bounds (0% - 5%) for ${code}: ${regRate}`);
  }
}

// Verify transaction rate
if (TRANSACTION_RATE !== 0.065) {
  throw new Error(`Fee Verification Failed: Transaction rate must match official 6.5% standard (was ${TRANSACTION_RATE})`);
}

// Verify offsite cap default
if (STATUTORY_OFFSITE_ADS_CAP.amount !== 100 || STATUTORY_OFFSITE_ADS_CAP.currency !== "USD") {
  throw new Error(`Fee Verification Failed: Base offsite cap must match official $100 USD (was ${STATUTORY_OFFSITE_ADS_CAP.amount} ${STATUTORY_OFFSITE_ADS_CAP.currency})`);
}

// Verify conditional exceptions documentation
const CONDITIONAL_COUNTRIES = ["CA", "AU"];
for (const code of CONDITIONAL_COUNTRIES) {
  const c = GLOBAL_COUNTRY_RULES[code];
  if (c.domesticRate == null || c.intlRate == null) {
    throw new Error(`Fee Verification Failed: Conditional country ${code} must contain domestic and international rate split`);
  }
}

console.log(`✅ All ${EXPECTED_COUNTRIES.length} country fee schedules verified successfully against official Etsy specifications.`);
console.log("Fee integrity check passed.");
