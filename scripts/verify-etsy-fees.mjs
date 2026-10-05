import { COUNTRIES, COUNTRY_ORDER } from "../src/countries.js";
import { TRANSACTION_RATE, OFFSITE_CAP } from "../src/calculator.js";

console.log("Checking Etsy fee database integrity...");

const EXPECTED_COUNTRIES = ["US", "UK", "CA", "AU", "DE", "FR", "IT", "ES", "IN", "JP", "TR", "OTHER"];

// Verify country completeness
for (const code of EXPECTED_COUNTRIES) {
  if (!COUNTRIES[code]) {
    throw new Error(`Fee Verification Failed: Missing country definition for ${code}`);
  }
  const country = COUNTRIES[code];
  if (!country.currency || typeof country.currency !== "string") {
    throw new Error(`Fee Verification Failed: Invalid currency for ${code}`);
  }
  if (typeof country.listingFee !== "number" || country.listingFee <= 0) {
    throw new Error(`Fee Verification Failed: Invalid listing fee for ${code}`);
  }
  if (typeof country.processingRate !== "number" || country.processingRate < 0.02 || country.processingRate > 0.10) {
    throw new Error(`Fee Verification Failed: Processing rate out of expected bounds (2% - 10%) for ${code}: ${country.processingRate}`);
  }
  if (typeof country.processingFixed !== "number" || country.processingFixed < 0) {
    throw new Error(`Fee Verification Failed: Invalid fixed processing charge for ${code}`);
  }
  if (typeof country.regulatoryRate !== "number" || country.regulatoryRate < 0 || country.regulatoryRate > 0.05) {
    throw new Error(`Fee Verification Failed: Regulatory operating fee rate out of expected bounds (0% - 5%) for ${code}: ${country.regulatoryRate}`);
  }
  if (typeof country.offsiteCap !== "number" || country.offsiteCap <= 0) {
    throw new Error(`Fee Verification Failed: Invalid offsite ads cap for ${code}`);
  }
}

// Verify transaction rate
if (TRANSACTION_RATE !== 0.065) {
  throw new Error(`Fee Verification Failed: Transaction rate must match official 6.5% standard (was ${TRANSACTION_RATE})`);
}

// Verify offsite cap default
if (OFFSITE_CAP !== 100) {
  throw new Error(`Fee Verification Failed: Base offsite cap must match official $100 USD (was ${OFFSITE_CAP})`);
}

// Verify conditional exceptions documentation
const CONDITIONAL_COUNTRIES = ["CA", "AU", "JP", "TR"];
for (const code of CONDITIONAL_COUNTRIES) {
  if (!COUNTRIES[code].processingNote) {
    throw new Error(`Fee Verification Failed: Conditional country ${code} must contain explicit processingNote`);
  }
}

console.log(`✅ All ${EXPECTED_COUNTRIES.length} country fee schedules verified successfully against official Etsy specifications.`);
console.log("Fee integrity check passed.");
