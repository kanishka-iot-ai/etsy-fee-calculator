import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanCellText,
  parsePaymentProcessingTable,
  parseDepositFeesTable,
  parseRegulatoryFeesTable
} from "./src/parser.js";
import { canonicalizeCountry, VALID_CURRENCIES } from "./src/canonicalize.js";
import { runGlobalDataDiscovery } from "./src/discovery.js";

// Sample fixture HTML for Payment Processing table
function makeProcessingHtml(rowsHtml) {
  return `
    <html>
      <body>
        <p>Intro text about payment processing.</p>
        <table>
          <thead>
            <tr><th>Location of Bank Account</th><th>Fees for Etsy Payments</th></tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

// Sample fixture HTML for Regulatory Operating Fee table
function makeRegulatoryHtml(rowsHtml) {
  return `
    <html>
      <body>
        <p>Regulatory Operating Fees are charged on the order total:</p>
        <table>
          <thead>
            <tr><th>Country</th><th>Regulatory Operating Fee</th></tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

// Sample fixture HTML for Deposit Fees table
function makeDepositHtml(rowsHtml) {
  return `
    <html>
      <body>
        <table>
          <thead>
            <tr>
              <th>Country</th>
              <th>Deposit Minimum</th>
              <th>Fee threshold</th>
              <th>Deposit fee</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

// Helper to create an in-memory mock D1 environment
function createMockD1(initialState = {}) {
  const countries = new Map(initialState.countries || [
    ["US", { country_code: "US", country_name: "United States", currency_code: "USD", status: "active", processing_rate: 0.03, processing_fixed_amount: 0.25, regulatory_rate: 0.0 }],
    ["UK", { country_code: "UK", country_name: "United Kingdom", currency_code: "GBP", status: "active", processing_rate: 0.04, processing_fixed_amount: 0.20, regulatory_rate: 0.0048 }],
    ["CA", { country_code: "CA", country_name: "Canada", currency_code: "CAD", status: "active", processing_rate: 0.03, processing_fixed_amount: 0.25, regulatory_rate: 0.0 }],
    ["AU", { country_code: "AU", country_name: "Australia", currency_code: "AUD", status: "active", processing_rate: 0.03, processing_fixed_amount: 0.25, regulatory_rate: 0.0 }],
    ["FR", { country_code: "FR", country_name: "France", currency_code: "EUR", status: "active", processing_rate: 0.04, processing_fixed_amount: 0.30, regulatory_rate: 0.0114 }],
    ["DE", { country_code: "DE", country_name: "Germany", currency_code: "EUR", status: "active", processing_rate: 0.04, processing_fixed_amount: 0.30, regulatory_rate: 0.0 }]
  ]);

  const snapshots = initialState.snapshots || [];
  const detectedChanges = initialState.detectedChanges || [];
  const reviewQueue = initialState.reviewQueue || [];
  const monitorRuns = initialState.monitorRuns || [];

  return {
    countries,
    snapshots,
    detectedChanges,
    reviewQueue,
    monitorRuns,
    prepare(sql) {
      return {
        _params: [],
        bind(...params) {
          this._params = params;
          return this;
        },
        async first() {
          if (sql.includes("SELECT content_hash FROM snapshots WHERE source_id =")) {
            const srcId = this._params[0] || (sql.includes("'115015628847'") ? "115015628847" : "1500011073202");
            const snap = snapshots.slice().reverse().find(s => s.source_id === srcId && s.success === 1);
            return snap ? { content_hash: snap.content_hash } : null;
          }
          if (sql.includes("FROM detected_changes") && sql.includes("country_code =")) {
            const code = this._params[0];
            let targetType = null;
            if (sql.includes("'new_country'")) targetType = "new_country";
            else if (sql.includes("'processing_rate_changed'")) targetType = "processing_rate_changed";
            else if (sql.includes("'currency_changed'")) targetType = "currency_changed";
            else if (sql.includes("'removed_country'")) targetType = "removed_country";
            else if (sql.includes("'regulatory_rate_changed'")) targetType = "regulatory_rate_changed";

            const change = detectedChanges.find(c => c.country_code === code && (!targetType || c.change_type === targetType) && c.status === "pending_review");
            return change ? { change_id: change.change_id } : null;
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM countries c")) {
            const results = Array.from(countries.values());
            return { results };
          }
          return { results: [] };
        },
        async run() {
          if (sql.includes("INSERT INTO snapshots")) {
            const [snapId, srcId, fetchedAt, raw, norm, hash1, hash2] = this._params;
            snapshots.push({ snapshot_id: snapId, source_id: srcId, fetched_at: fetchedAt, content_hash: hash1, success: 1 });
            return { success: true };
          }
          if (sql.includes("INSERT INTO countries")) {
            const [code, name, curr, sym, at1, at2] = this._params;
            if (!countries.has(code)) {
              countries.set(code, { country_code: code, country_name: name, currency_code: curr, status: "pending_review", processing_rate: null, regulatory_rate: null });
            }
            return { success: true };
          }
          if (sql.includes("UPDATE countries SET status = 'pending_review'")) {
            const [at, code] = this._params;
            const c = countries.get(code);
            if (c) c.status = "pending_review";
            return { success: true };
          }
          if (sql.includes("INSERT INTO detected_changes")) {
            let chgType = "unknown";
            let field = "unknown";
            const code = this._params[2];
            let oldVal = null;
            let newVal = null;
            let valMsg = null;

            if (sql.includes("'new_country'")) {
              chgType = "new_country";
              field = "market_availability";
              newVal = this._params[3];
              valMsg = "Discovered in official Etsy Payments table";
            } else if (sql.includes("'processing_rate_changed'")) {
              chgType = "processing_rate_changed";
              field = "processing_rate";
              oldVal = this._params[3];
              newVal = this._params[4];
              valMsg = this._params[6];
            } else if (sql.includes("'regulatory_rate_changed'")) {
              chgType = "regulatory_rate_changed";
              field = "regulatory_rate";
              oldVal = this._params[3];
              newVal = this._params[4];
              valMsg = "Regulatory fee differs from active baseline";
            } else if (sql.includes("'currency_changed'")) {
              chgType = "currency_changed";
              field = "currency";
              oldVal = this._params[3];
              newVal = this._params[4];
              valMsg = "Currency differs from baseline";
            } else if (sql.includes("'removed_country'")) {
              chgType = "removed_country";
              field = "market_availability";
              oldVal = "active";
              newVal = "unlisted";
              valMsg = "Country absent from published table";
            }

            detectedChanges.push({
              change_id: this._params[0],
              source_id: sql.includes("'1500011073202'") ? "1500011073202" : "115015628847",
              country_code: code,
              field_name: field,
              old_value: oldVal,
              new_value: newVal,
              change_type: chgType,
              status: "pending_review",
              validation_message: valMsg
            });
            return { success: true };
          }
          if (sql.includes("INSERT INTO review_queue")) {
            const revId = this._params[0];
            const chgId = this._params[1];
            let priority = "medium";
            if (this._params.length >= 3 && ["critical", "high", "medium", "low"].includes(this._params[2])) {
              priority = this._params[2];
            } else if (sql.includes("'high'")) {
              priority = "high";
            } else if (sql.includes("'critical'")) {
              priority = "critical";
            }
            reviewQueue.push({ review_id: revId, change_id: chgId, priority, status: "pending" });
            return { success: true };
          }
          if (sql.includes("INSERT INTO monitor_runs")) {
            const [runId, st, comp, stat, sc, scChg, cd, cp, rc, err, errMsg] = this._params;
            monitorRuns.push({ run_id: runId, status: stat, sources_checked: sc, sources_changed: scChg, changes_detected: cd, reviews_created: rc, errors: err });
            return { success: true };
          }
          return { success: true };
        }
      };
    }
  };
}

// ============================================================================
// THE 20 REQUIRED TEST SCENARIOS
// ============================================================================

test("1. global country table parsing: extracts multiple countries from standard table", () => {
  const html = makeProcessingHtml(`
    <tr><td>United States</td><td>3% + 0.25 USD</td></tr>
    <tr><td>United Kingdom</td><td>4% + 0.20 GBP</td></tr>
    <tr><td>France</td><td>4% + 0.30 EUR</td></tr>
    <tr><td>Germany</td><td>4% + 0.30 EUR</td></tr>
    <tr><td>India</td><td>5% + 25.00 INR</td></tr>
    <tr><td>Singapore</td><td>4.4% + 0.35 SGD</td></tr>
  `);

  const { markets, validationErrors } = parsePaymentProcessingTable(html);
  assert.equal(validationErrors.length, 0);
  assert.equal(markets.length, 6);

  const us = markets.find(m => m.countryCode === "US");
  assert.equal(us.processingRate, 0.03);
  assert.equal(us.processingFixed, 0.25);
  assert.equal(us.currency, "USD");

  const inMkt = markets.find(m => m.countryCode === "IN");
  assert.equal(inMkt.processingRate, 0.05);
  assert.equal(inMkt.processingFixed, 25.0);
  assert.equal(inMkt.currency, "INR");
});

test("2. new country discovery: queues unlisted sovereign market with pending_review", async () => {
  const mockD1 = createMockD1(); // Initially contains US, UK, CA, AU, FR, DE
  const env = {
    DB: mockD1,
    fetchOverride: async (url) => {
      if (url.includes("115015628847")) {
        return new Response(JSON.stringify({
          article: {
            body: makeProcessingHtml(`
              <tr><td>United States</td><td>3% + 0.25 USD</td></tr>
              <tr><td>United Kingdom</td><td>4% + 0.20 GBP</td></tr>
              <tr><td>France</td><td>4% + 0.30 EUR</td></tr>
              <tr><td>Germany</td><td>4% + 0.30 EUR</td></tr>
              <tr><td>Canada</td><td>3% + 0.25 CAD</td></tr>
              <tr><td>Australia</td><td>3% + 0.25 AUD</td></tr>
              <tr><td>Singapore</td><td>4.4% + 0.35 SGD</td></tr>
            `)
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ article: { body: "" } }), { status: 200 });
    }
  };

  const res = await runGlobalDataDiscovery(env);
  assert.equal(res.status, "completed");
  assert.ok(res.newlyDiscoveredCountries.includes("SG"));
  assert.ok(mockD1.countries.has("SG"));
  assert.equal(mockD1.countries.get("SG").status, "pending_review");

  const sgChange = mockD1.detectedChanges.find(c => c.country_code === "SG" && c.change_type === "new_country");
  assert.ok(sgChange);
  assert.equal(sgChange.status, "pending_review");

  const sgReview = mockD1.reviewQueue.find(r => r.change_id === sgChange.change_id);
  assert.ok(sgReview);
  assert.equal(sgReview.status, "pending");
});

test("3. removed country detection: detects missing market and preserves history as pending_review", async () => {
  const mockD1 = createMockD1(); // Contains US, UK, CA, AU, FR, DE
  const env = {
    DB: mockD1,
    fetchOverride: async (url) => {
      if (url.includes("115015628847")) {
        // Germany (DE) is intentionally omitted from the published table
        return new Response(JSON.stringify({
          article: {
            body: makeProcessingHtml(`
              <tr><td>United States</td><td>3% + 0.25 USD</td></tr>
              <tr><td>United Kingdom</td><td>4% + 0.20 GBP</td></tr>
              <tr><td>France</td><td>4% + 0.30 EUR</td></tr>
              <tr><td>Canada</td><td>3% + 0.25 CAD</td></tr>
              <tr><td>Australia</td><td>3% + 0.25 AUD</td></tr>
            `)
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ article: { body: "" } }), { status: 200 });
    }
  };

  const res = await runGlobalDataDiscovery(env);
  assert.ok(res.removedCountries.includes("DE"));
  assert.equal(mockD1.countries.get("DE").status, "pending_review");

  const deChange = mockD1.detectedChanges.find(c => c.country_code === "DE" && c.change_type === "removed_country");
  assert.ok(deChange);
  assert.equal(deChange.status, "pending_review");
});

test("4. changed processing rate: queues rate adjustment for human review", async () => {
  const mockD1 = createMockD1();
  const env = {
    DB: mockD1,
    fetchOverride: async (url) => {
      if (url.includes("115015628847")) {
        return new Response(JSON.stringify({
          article: {
            // UK changes from 4% to 4.2%
            body: makeProcessingHtml(`
              <tr><td>United States</td><td>3% + 0.25 USD</td></tr>
              <tr><td>United Kingdom</td><td>4.2% + 0.20 GBP</td></tr>
              <tr><td>France</td><td>4% + 0.30 EUR</td></tr>
              <tr><td>Germany</td><td>4% + 0.30 EUR</td></tr>
              <tr><td>Canada</td><td>3% + 0.25 CAD</td></tr>
              <tr><td>Australia</td><td>3% + 0.25 AUD</td></tr>
            `)
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ article: { body: "" } }), { status: 200 });
    }
  };

  const res = await runGlobalDataDiscovery(env);
  const ukChange = mockD1.detectedChanges.find(c => c.country_code === "UK" && c.change_type === "processing_rate_changed");
  assert.ok(ukChange);
  assert.equal(ukChange.old_value, "0.04");
  assert.equal(ukChange.new_value, "0.042");
});

test("5. domestic/international split: parses domestic and international order fees", () => {
  const html = makeProcessingHtml(`
    <tr><td>Australia (domestic orders)</td><td>3% + 0.25 AUD</td></tr>
    <tr><td>Australia (international orders)</td><td>4% + 0.25 AUD</td></tr>
    <tr><td>Canada (domestic orders)</td><td>3% + 0.25 CAD</td></tr>
    <tr><td>Canada (international orders)</td><td>4% + 0.25 CAD</td></tr>
    <tr><td>United States</td><td>3% + 0.25 USD</td></tr>
  `);

  const { markets } = parsePaymentProcessingTable(html);
  const au = markets.find(m => m.countryCode === "AU");
  assert.ok(au);
  assert.equal(au.domesticProcessingRate, 0.03);
  assert.equal(au.internationalProcessingRate, 0.04);
  assert.equal(au.currency, "AUD");

  const ca = markets.find(m => m.countryCode === "CA");
  assert.ok(ca);
  assert.equal(ca.domesticProcessingRate, 0.03);
  assert.equal(ca.internationalProcessingRate, 0.04);
});

test("6. regulatory fee detection: parses official regulatory rates correctly", () => {
  const html = makeRegulatoryHtml(`
    <tr><td>United Kingdom</td><td>0.48%</td></tr>
    <tr><td>France</td><td>1.14%</td></tr>
    <tr><td>Italy</td><td>0.80%</td></tr>
    <tr><td>Spain</td><td>0.88%</td></tr>
    <tr><td>Türkiye</td><td>1.67%</td></tr>
    <tr><td>Vietnam</td><td>1.24%</td></tr>
  `);

  const rules = parseRegulatoryFeesTable(html);
  assert.equal(rules.length, 6);

  const uk = rules.find(r => r.countryCode === "UK");
  assert.equal(uk.regulatoryRate, 0.0048);

  const tr = rules.find(r => r.countryCode === "TR");
  assert.equal(tr.regulatoryRate, 0.0167);

  const vn = rules.find(r => r.countryCode === "VN");
  assert.equal(vn.regulatoryRate, 0.0124);
});

test("7. deposit fee detection: extracts deposit minimums, thresholds, and fees", () => {
  const html = makeDepositHtml(`
    <tr>
      <td>Philippines</td>
      <td>50 PHP</td>
      <td>1,000 PHP</td>
      <td>25 PHP</td>
    </tr>
    <tr>
      <td>Vietnam</td>
      <td>115,000 VND</td>
      <td>2,300,000 VND</td>
      <td>58,000 VND</td>
    </tr>
  `);

  const rules = parseDepositFeesTable(html);
  assert.equal(rules.length, 2);

  const ph = rules.find(r => r.countryCode === "PH");
  assert.equal(ph.depositMinimumAmount, 50);
  assert.equal(ph.depositMinimumCurrency, "PHP");
  assert.equal(ph.depositThresholdAmount, 1000);
  assert.equal(ph.depositFeeAmount, 25);

  const vn = rules.find(r => r.countryCode === "VN");
  assert.equal(vn.depositMinimumAmount, 115000);
  assert.equal(vn.depositFeeAmount, 58000);
});

test("8. currency change: detects and queues currency changes", async () => {
  const mockD1 = createMockD1(); // UK starts with GBP
  const env = {
    DB: mockD1,
    fetchOverride: async (url) => {
      if (url.includes("115015628847")) {
        return new Response(JSON.stringify({
          article: {
            body: makeProcessingHtml(`
              <tr><td>United States</td><td>3% + 0.25 USD</td></tr>
              <tr><td>United Kingdom</td><td>4% + 0.20 EUR</td></tr>
              <tr><td>France</td><td>4% + 0.30 EUR</td></tr>
              <tr><td>Germany</td><td>4% + 0.30 EUR</td></tr>
              <tr><td>Canada</td><td>3% + 0.25 CAD</td></tr>
              <tr><td>Australia</td><td>3% + 0.25 AUD</td></tr>
            `)
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ article: { body: "" } }), { status: 200 });
    }
  };

  await runGlobalDataDiscovery(env);
  const currChange = mockD1.detectedChanges.find(c => c.country_code === "UK" && c.change_type === "currency_changed");
  assert.ok(currChange);
  assert.equal(currChange.old_value, "GBP");
  assert.equal(currChange.new_value, "EUR");
});

test("9. wording-only change: editorial edits outside table produce zero fee changes", async () => {
  const mockD1 = createMockD1();
  const env = {
    DB: mockD1,
    fetchOverride: async (url) => {
      if (url.includes("115015628847")) {
        return new Response(JSON.stringify({
          article: {
            body: `
              <h1>Updated Help Center Guide 2026</h1>
              <p>We have updated the clarity and explanations in this help documentation.</p>
              ${makeProcessingHtml(`
                <tr><td>United States</td><td>3% + 0.25 USD</td></tr>
                <tr><td>United Kingdom</td><td>4% + 0.20 GBP</td></tr>
                <tr><td>France</td><td>4% + 0.30 EUR</td></tr>
                <tr><td>Germany</td><td>4% + 0.30 EUR</td></tr>
                <tr><td>Canada</td><td>3% + 0.25 CAD</td></tr>
                <tr><td>Australia</td><td>3% + 0.25 AUD</td></tr>
              `)}
            `
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ article: { body: "" } }), { status: 200 });
    }
  };

  const res = await runGlobalDataDiscovery(env);
  assert.equal(res.fieldChanges.length, 0);
  assert.equal(res.changesDetected, 0);
});

test("10. formatting-only change: whitespace, &nbsp;, and inner styling produce no false changes", () => {
  const cleanHtml = makeProcessingHtml(`
    <tr><td>United States</td><td>3% + 0.25 USD</td></tr>
    <tr><td>United Kingdom</td><td>4% + 0.20 GBP</td></tr>
    <tr><td>France</td><td>4% + 0.30 EUR</td></tr>
    <tr><td>Germany</td><td>4% + 0.30 EUR</td></tr>
    <tr><td>Canada</td><td>3% + 0.25 CAD</td></tr>
  `);

  const dirtyHtml = makeProcessingHtml(`
    <tr><td>  <strong>United States</strong>&nbsp;&nbsp;</td><td>3% &nbsp;+ <span>0.25</span> USD </td></tr>
    <tr><td>United&nbsp;Kingdom<br/></td><td>4%&nbsp;+&nbsp;0.20 GBP</td></tr>
    <tr><td>France</td><td> 4%   +   0.30   EUR </td></tr>
    <tr><td>Germany</td><td>4% + 0.30 EUR</td></tr>
    <tr><td>Canada</td><td>3% + 0.25 CAD</td></tr>
  `);

  const resClean = parsePaymentProcessingTable(cleanHtml);
  const resDirty = parsePaymentProcessingTable(dirtyHtml);

  assert.equal(resClean.markets.length, resDirty.markets.length);
  for (let i = 0; i < resClean.markets.length; i++) {
    assert.equal(resClean.markets[i].countryCode, resDirty.markets[i].countryCode);
    assert.equal(resClean.markets[i].processingRate, resDirty.markets[i].processingRate);
    assert.equal(resClean.markets[i].processingFixed, resDirty.markets[i].processingFixed);
    assert.equal(resClean.markets[i].currency, resDirty.markets[i].currency);
  }
});

test("11. malformed source: unclosed tags and corrupted HTML handled safely", () => {
  const brokenHtml = `
    <div><table border="1">
      <tr><th>Location of Bank Account</th><th>Fees for Etsy Payments
      <tr><td>United States<td>3% + 0.25 USD
      <tr><td>United Kingdom<td>4% + 0.20 GBP
      <tr><td>France<td>4% + 0.30 EUR
      <tr><td>Germany<td>4% + 0.30 EUR
      <tr><td>Canada<td>3% + 0.25 CAD
    </table></div>
  `;

  const { markets } = parsePaymentProcessingTable(brokenHtml);
  assert.ok(markets.length >= 4);
  assert.equal(markets[0].countryCode, "US");
});

test("12. missing table columns: table lacking required columns is rejected", () => {
  const badHtml = `
    <table>
      <thead><tr><th>Article Title</th></tr></thead>
      <tbody><tr><td>Some random content</td></tr></tbody>
    </table>
  `;

  assert.throws(() => {
    parsePaymentProcessingTable(badHtml);
  }, /Missing required table columns/);
});

test("13. duplicate country: handles duplicate rows without duplicating records", () => {
  const html = makeProcessingHtml(`
    <tr><td>United States</td><td>3% + 0.25 USD</td></tr>
    <tr><td>United States</td><td>3% + 0.25 USD</td></tr>
    <tr><td>United Kingdom</td><td>4% + 0.20 GBP</td></tr>
    <tr><td>France</td><td>4% + 0.30 EUR</td></tr>
    <tr><td>Germany</td><td>4% + 0.30 EUR</td></tr>
  `);

  const { markets } = parsePaymentProcessingTable(html);
  const usEntries = markets.filter(m => m.countryCode === "US");
  assert.equal(usEntries.length, 1);
});

test("14. invalid percentage: rates < 0 or > 100 are rejected by validation", () => {
  const html = makeProcessingHtml(`
    <tr><td>United States</td><td>150% + 0.25 USD</td></tr>
    <tr><td>United Kingdom</td><td>-5% + 0.20 GBP</td></tr>
    <tr><td>France</td><td>4% + 0.30 EUR</td></tr>
    <tr><td>Germany</td><td>4% + 0.30 EUR</td></tr>
    <tr><td>Canada</td><td>3% + 0.25 CAD</td></tr>
  `);

  const { markets, validationErrors } = parsePaymentProcessingTable(html);
  assert.equal(validationErrors.length, 2);
  assert.ok(validationErrors.some(e => e.country === "US" && e.error.includes("bounds")));
  assert.ok(validationErrors.some(e => e.country === "UK" && e.error.includes("bounds")));
});

test("15. invalid currency: unrecognized currency codes rejected by validation", () => {
  const html = makeProcessingHtml(`
    <tr><td>United States</td><td>3% + 0.25 FAKE</td></tr>
    <tr><td>United Kingdom</td><td>4% + 0.20 GBP</td></tr>
    <tr><td>France</td><td>4% + 0.30 EUR</td></tr>
    <tr><td>Germany</td><td>4% + 0.30 EUR</td></tr>
    <tr><td>Canada</td><td>3% + 0.25 CAD</td></tr>
  `);

  const { markets, validationErrors } = parsePaymentProcessingTable(html);
  assert.equal(validationErrors.length, 1);
  assert.equal(validationErrors[0].country, "US");
  assert.ok(validationErrors[0].error.includes("currency"));
});

test("16. suspicious fee change: fee delta >= 5% flagged as critical priority", async () => {
  const mockD1 = createMockD1(); // US has 0.03
  const env = {
    DB: mockD1,
    fetchOverride: async (url) => {
      if (url.includes("115015628847")) {
        return new Response(JSON.stringify({
          article: {
            // US jumps from 3% to 9% (delta +6% >= 5%)
            body: makeProcessingHtml(`
              <tr><td>United States</td><td>9% + 0.25 USD</td></tr>
              <tr><td>United Kingdom</td><td>4% + 0.20 GBP</td></tr>
              <tr><td>France</td><td>4% + 0.30 EUR</td></tr>
              <tr><td>Germany</td><td>4% + 0.30 EUR</td></tr>
              <tr><td>Canada</td><td>3% + 0.25 CAD</td></tr>
              <tr><td>Australia</td><td>3% + 0.25 AUD</td></tr>
            `)
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ article: { body: "" } }), { status: 200 });
    }
  };

  await runGlobalDataDiscovery(env);
  const chg = mockD1.detectedChanges.find(c => c.country_code === "US" && c.change_type === "processing_rate_changed");
  assert.ok(chg);
  assert.ok(chg.validation_message.includes("SUSPICIOUS"));

  const rev = mockD1.reviewQueue.find(r => r.change_id === chg.change_id);
  assert.ok(rev);
  assert.equal(rev.priority, "critical");
});

test("17. parser failure: non-table body produces descriptive error without corrupting data", () => {
  const badHtml = "<div>Just some plain text without any tables at all.</div>";
  assert.throws(() => {
    parsePaymentProcessingTable(badHtml);
  }, /No <table> found/);
});

test("18. partial extraction: table with fewer than minimum rows throws partial extraction error", () => {
  const shortHtml = makeProcessingHtml(`
    <tr><td>United States</td><td>3% + 0.25 USD</td></tr>
  `);

  assert.throws(() => {
    parsePaymentProcessingTable(shortHtml);
  }, /Partial extraction/);
});

test("19. idempotent repeated run: consecutive runs with identical data produce zero duplicate reviews", async () => {
  const mockD1 = createMockD1();
  const mockPayload = JSON.stringify({
    article: {
      body: makeProcessingHtml(`
        <tr><td>United States</td><td>3% + 0.25 USD</td></tr>
        <tr><td>United Kingdom</td><td>4.2% + 0.20 GBP</td></tr>
        <tr><td>France</td><td>4% + 0.30 EUR</td></tr>
        <tr><td>Germany</td><td>4% + 0.30 EUR</td></tr>
        <tr><td>Canada</td><td>3% + 0.25 CAD</td></tr>
        <tr><td>Australia</td><td>3% + 0.25 AUD</td></tr>
        <tr><td>Singapore</td><td>4.4% + 0.35 SGD</td></tr>
      `)
    }
  });

  const env = {
    DB: mockD1,
    fetchOverride: async (url) => {
      if (url.includes("115015628847")) {
        return new Response(mockPayload, { status: 200 });
      }
      return new Response(JSON.stringify({ article: { body: "" } }), { status: 200 });
    }
  };

  // Run 1
  const res1 = await runGlobalDataDiscovery(env);
  assert.equal(res1.changesDetected, 2); // UK rate changed, SG new country

  // Run 2: Exact same data
  const res2 = await runGlobalDataDiscovery(env);
  assert.equal(res2.changesDetected, 0); // No new duplicates queued!
  assert.equal(res2.reviewsCreated, 0);
});

test("20. unchanged official source: matching content hash records 0 sources changed", async () => {
  const mockD1 = createMockD1();
  const bodyText = makeProcessingHtml(`
    <tr><td>United States</td><td>3% + 0.25 USD</td></tr>
    <tr><td>United Kingdom</td><td>4% + 0.20 GBP</td></tr>
    <tr><td>France</td><td>4% + 0.30 EUR</td></tr>
    <tr><td>Germany</td><td>4% + 0.30 EUR</td></tr>
    <tr><td>Canada</td><td>3% + 0.25 CAD</td></tr>
    <tr><td>Australia</td><td>3% + 0.25 AUD</td></tr>
  `);

  // Compute hash of bodyText
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(bodyText));
  const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

  // Seed existing snapshot with this exact hash
  mockD1.snapshots.push({
    snapshot_id: "snap_initial",
    source_id: "115015628847",
    fetched_at: "2026-10-06T00:00:00Z",
    content_hash: hash,
    success: 1
  });

  const env = {
    DB: mockD1,
    fetchOverride: async () => new Response(JSON.stringify({ article: { body: bodyText } }), { status: 200 })
  };

  const res = await runGlobalDataDiscovery(env);
  assert.equal(res.sourcesChanged, 0);
});
