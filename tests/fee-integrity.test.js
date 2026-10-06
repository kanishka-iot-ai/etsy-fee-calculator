import test from "node:test";
import assert from "node:assert/strict";
import { COUNTRY_ORDER } from "../src/countries.js";
import {
  GLOBAL_COUNTRY_RULES,
  OFFICIAL_TRANSACTION_RATE as TRANSACTION_RATE,
  STATUTORY_OFFSITE_ADS_CAP
} from "../src/fee-engine.js";
import { STATUTORY_REGULATORY_RATES } from "../src/compatibility.js";
import { readFile } from "node:fs/promises";

test("all countries in database conform to official Etsy bounds and documented structure", () => {
  assert.equal(COUNTRY_ORDER.length, 12, "exactly 12 country keys defined in baseline order");
  for (const code of COUNTRY_ORDER) {
    const c = GLOBAL_COUNTRY_RULES[code];
    assert.ok(c, `${code} exists in GLOBAL_COUNTRY_RULES`);
    assert.equal(typeof c.currency, "string", `${code} has string currency`);
    assert.ok(c.currency.length === 3, `${code} has 3-letter currency code`);
    assert.ok(c.listingFee > 0, `${code} has positive listing fee`);
    assert.ok(c.rate >= 0.02 && c.rate <= 0.10, `${code} processing rate between 2% and 10%`);
    assert.ok(c.fixed >= 0, `${code} processing fixed charge is non-negative`);
    const regRate = STATUTORY_REGULATORY_RATES[code];
    if (regRate != null) {
      assert.ok(regRate >= 0 && regRate <= 0.05, `${code} regulatory rate between 0% and 5%`);
    }
    assert.equal(typeof c.locale, "string", `${code} has valid locale string`);
  }
});

test("official 6.5% transaction rate and $100 offsite cap remain strictly configured", () => {
  assert.equal(TRANSACTION_RATE, 0.065, "Etsy transaction fee must remain 6.5%");
  assert.equal(STATUTORY_OFFSITE_ADS_CAP.amount, 100, "Etsy Offsite Ads baseline cap must remain 100 USD");
  assert.equal(STATUTORY_OFFSITE_ADS_CAP.currency, "USD");
});

test("conditional fee regions contain explicit seller disclosures", () => {
  assert.ok(GLOBAL_COUNTRY_RULES.CA.domesticRate != null, "Canada documents domestic vs international rate");
  assert.ok(GLOBAL_COUNTRY_RULES.AU.domesticRate != null, "Australia documents domestic vs international rate");
});

test("methodology page discloses review date and official Etsy source URLs", async () => {
  const html = await readFile(new URL("../methodology.html", import.meta.url), "utf8");
  assert.match(html, /Fee schedules reviewed October 2026/);
  assert.match(html, /115014483627-What-are-the-Fees-and-Taxes-for-Selling-on-Etsy/);
  assert.match(html, /115015628847-What-are-Payment-Processing-Fees/);
  assert.match(html, /1500011073202-What-is-a-Regulatory-Operating-Fee/);
  assert.match(html, /360000338367-How-Etsy-s-Offsite-Ads-Work/);
  assert.match(html, /360001589928-What-is-Etsy-Plus/);
});
