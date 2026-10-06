import assert from "node:assert/strict";
import test from "node:test";
import { formatDepositSchedule, handleGetFees, handleGetCountryFee } from "../worker/src/api.js";
import { STATUTORY_DEPOSIT_SCHEDULES } from "../src/compatibility.js";
import { publishApprovedChanges } from "../worker/src/publisher.js";

test("Step 10F.2: 1. TR v1.1.1 deposit schedule: minimum 50, threshold 600, fee 42 TRY", () => {
  const tr = STATUTORY_DEPOSIT_SCHEDULES.TR;
  assert.equal(tr.min, 50);
  assert.equal(tr.threshold, 600);
  assert.equal(tr.fee, 42);
  assert.equal(tr.currency, "TRY");

  const formatted = formatDepositSchedule({
    deposit_minimum_amount: 50,
    deposit_minimum_currency: "TRY",
    deposit_threshold_amount: 600,
    deposit_threshold_currency: "TRY",
    deposit_fee_amount: 42,
    deposit_fee_currency: "TRY"
  });
  assert.equal(formatted.mode, "listed");
  assert.deepEqual(formatted.dailyDepositMinimum, { amount: 50, currency: "TRY" });
  assert.deepEqual(formatted.feeThreshold, { amount: 600, currency: "TRY" });
  assert.deepEqual(formatted.fee, { amount: 42, currency: "TRY" });
});

test("Step 10F.2: 2. PH deposit schedule remains 100 / 5000 / 100 PHP", () => {
  const ph = STATUTORY_DEPOSIT_SCHEDULES.PH;
  assert.equal(ph.min, 100);
  assert.equal(ph.threshold, 5000);
  assert.equal(ph.fee, 100);
  assert.equal(ph.currency, "PHP");
});

test("Step 10F.2: 3. ZA deposit schedule remains 35 / 1500 / 30 ZAR", () => {
  const za = STATUTORY_DEPOSIT_SCHEDULES.ZA;
  assert.equal(za.min, 35);
  assert.equal(za.threshold, 1500);
  assert.equal(za.fee, 30);
  assert.equal(za.currency, "ZAR");
});

test("Step 10F.2: 4. VN deposit schedule remains 45000 / 2300000 / 45000 VND", () => {
  const vn = STATUTORY_DEPOSIT_SCHEDULES.VN;
  assert.equal(vn.min, 45000);
  assert.equal(vn.threshold, 2300000);
  assert.equal(vn.fee, 45000);
  assert.equal(vn.currency, "VND");
});

test("Step 10F.2: 5. All other statutory deposit markets remain unchanged (ID, IL, MY, MX, MA)", () => {
  assert.deepEqual(STATUTORY_DEPOSIT_SCHEDULES.ID, { min: 28000, threshold: 1400000, fee: 28000, currency: "IDR" });
  assert.deepEqual(STATUTORY_DEPOSIT_SCHEDULES.IL, { min: 7, threshold: 350, fee: 7, currency: "ILS" });
  assert.deepEqual(STATUTORY_DEPOSIT_SCHEDULES.MY, { min: 9, threshold: 400, fee: 8, currency: "MYR" });
  assert.deepEqual(STATUTORY_DEPOSIT_SCHEDULES.MX, { min: 40, threshold: 2000, fee: 40, currency: "MXN" });
  assert.deepEqual(STATUTORY_DEPOSIT_SCHEDULES.MA, { min: 20, threshold: 1000, fee: 20, currency: "MAD" });
});

test("Step 10F.2: 6. Exactly 9 markets have listed deposit schedules", () => {
  const keys = Object.keys(STATUTORY_DEPOSIT_SCHEDULES);
  assert.equal(keys.length, 9);
  assert.deepEqual(keys.sort(), ["ID", "IL", "MA", "MX", "MY", "PH", "TR", "VN", "ZA"].sort());
});

test("Step 10F.2: 7. All other markets format with mode = not_listed, null amounts", () => {
  const formatted = formatDepositSchedule({
    country_code: "US",
    deposit_minimum_amount: null,
    deposit_threshold_amount: null,
    deposit_fee_amount: null
  });
  assert.equal(formatted.mode, "not_listed");
  assert.equal(formatted.dailyDepositMinimum, null);
  assert.equal(formatted.feeThreshold, null);
  assert.equal(formatted.fee, null);
});

test("Step 10F.2: 8. Public API exposes depositSchedule without synthetic zeroes", () => {
  const unlisted = formatDepositSchedule({
    country_code: "DE",
    deposit_minimum_amount: null,
    deposit_threshold_amount: null,
    deposit_fee_amount: null
  });
  assert.equal(unlisted.mode, "not_listed");
  assert.notEqual(unlisted.dailyDepositMinimum, 0);
  assert.notEqual(unlisted.feeThreshold, 0);
  assert.notEqual(unlisted.fee, 0);
});

test("Step 10F.2: 9. Public API contract serialization on mock DB for v1.1.1", async () => {
  const mockRows = [
    {
      country_code: "TR",
      country_name: "Türkiye",
      currency_code: "TRY",
      currency_symbol: "₺",
      locale: "tr-TR",
      sort_order: 1,
      transaction_rate: 0.065,
      listing_fee_amount: 7,
      processing_rate: 0.065,
      processing_fixed_amount: 14,
      regulatory_rate: 0.0167,
      deposit_minimum_amount: 50,
      deposit_minimum_currency: "TRY",
      deposit_threshold_amount: 600,
      deposit_threshold_currency: "TRY",
      deposit_fee_amount: 42,
      deposit_fee_currency: "TRY"
    },
    {
      country_code: "US",
      country_name: "United States",
      currency_code: "USD",
      currency_symbol: "$",
      locale: "en-US",
      sort_order: 2,
      transaction_rate: 0.065,
      listing_fee_amount: 0.20,
      processing_rate: 0.03,
      processing_fixed_amount: 0.25,
      regulatory_rate: null,
      deposit_minimum_amount: null,
      deposit_minimum_currency: null,
      deposit_threshold_amount: null,
      deposit_threshold_currency: null,
      deposit_fee_amount: null,
      deposit_fee_currency: null
    }
  ];

  const mockDb = {
    prepare(q) {
      return {
        async first() {
          if (q.includes("FROM fee_versions")) {
            return {
              version_id: "v1.1.1",
              version_label: "1.1.1",
              published_at: "2026-10-06T12:00:00Z"
            };
          }
          return mockRows[0];
        },
        bind() {
          return {
            async first() {
              if (q.includes("FROM fee_versions")) {
                return {
                  version_id: "v1.1.1",
                  version_label: "1.1.1",
                  published_at: "2026-10-06T12:00:00Z"
                };
              }
              return mockRows[0];
            },
            async all() {
              return { results: mockRows };
            }
          };
        }
      };
    }
  };

  const req = new Request("https://api.test/v1/fees");
  const res = await handleGetFees(req, { DB: mockDb });
  const data = await res.json();

  assert.equal(data.version, "1.1.1");
  assert.equal(data.version_id, "v1.1.1");
  assert.equal(data.countries.TR.depositSchedule.mode, "listed");
  assert.equal(data.countries.TR.depositSchedule.dailyDepositMinimum.amount, 50);
  assert.equal(data.countries.TR.depositSchedule.feeThreshold.amount, 600);
  assert.equal(data.countries.TR.depositSchedule.fee.amount, 42);

  assert.equal(data.countries.US.depositSchedule.mode, "not_listed");
  assert.equal(data.countries.US.depositSchedule.dailyDepositMinimum, null);
});
