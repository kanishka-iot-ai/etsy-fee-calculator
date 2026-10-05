import test from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES, COUNTRY_ORDER } from "../src/countries.js";
import { TRANSACTION_RATE, OFFSITE_CAP } from "../src/calculator.js";
import { readFile } from "node:fs/promises";

test("all countries in database conform to official Etsy bounds and documented structure", () => {
  assert.equal(COUNTRY_ORDER.length, 12, "exactly 12 country keys defined");
  for (const code of COUNTRY_ORDER) {
    const c = COUNTRIES[code];
    assert.ok(c, `${code} exists in COUNTRIES`);
    assert.equal(typeof c.currency, "string", `${code} has string currency`);
    assert.ok(c.currency.length === 3, `${code} has 3-letter currency code`);
    assert.ok(c.listingFee > 0, `${code} has positive listing fee`);
    assert.ok(c.processingRate >= 0.02 && c.processingRate <= 0.10, `${code} processing rate between 2% and 10%`);
    assert.ok(c.processingFixed >= 0, `${code} processing fixed charge is non-negative`);
    assert.ok(c.regulatoryRate >= 0 && c.regulatoryRate <= 0.05, `${code} regulatory rate between 0% and 5%`);
    assert.ok(c.offsiteCap > 0, `${code} offsite cap is positive`);
    assert.equal(typeof c.locale, "string", `${code} has valid locale string`);
  }
});

test("official 6.5% transaction rate and $100 offsite cap remain strictly configured", () => {
  assert.equal(TRANSACTION_RATE, 0.065, "Etsy transaction fee must remain 6.5%");
  assert.equal(OFFSITE_CAP, 100, "Etsy Offsite Ads baseline cap must remain 100 USD");
});

test("conditional fee regions contain explicit seller disclosures", () => {
  assert.ok(COUNTRIES.CA.processingNote.toLowerCase().includes("domestic"), "Canada documents domestic vs international rate");
  assert.ok(COUNTRIES.AU.processingNote.toLowerCase().includes("domestic"), "Australia documents domestic vs international rate");
  assert.ok(COUNTRIES.JP.processingNote.toLowerCase().includes("usd"), "Japan documents USD fixed conversion");
  assert.ok(COUNTRIES.TR.processingNote.includes("6.5%"), "Türkiye documents 6.5% + 14 TRY rate");
  assert.ok(COUNTRIES.OTHER.processingNote.toLowerCase().includes("baseline"), "Global/Other documents generic baseline");
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
