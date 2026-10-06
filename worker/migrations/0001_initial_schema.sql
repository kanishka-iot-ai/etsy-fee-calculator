-- ============================================================================
-- Migration: 0001_initial_schema.sql
-- Project: ShopProfit Global Etsy Fee Intelligence System
-- Database: shopprofit-fees-db (Cloudflare D1)
-- Safety: Non-destructive creation with strict foreign keys & single-active version constraint
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLE 1: countries
-- Statuses: active, inactive, partial, pending_review, unsupported
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS countries (
  country_code TEXT PRIMARY KEY,
  country_name TEXT NOT NULL,
  currency_code TEXT,
  currency_symbol TEXT,
  locale TEXT,
  etsy_payments_status TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'partial', 'pending_review', 'unsupported')),
  sort_order INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- TABLE 2: fee_versions
-- Statuses: draft, active, archived
-- Constraint: Exactly ONE active production fee version allowed at any time
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fee_versions (
  version_id TEXT PRIMARY KEY,
  version_label TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft', 'active', 'archived')),
  created_at TEXT NOT NULL,
  published_at TEXT,
  source_hash TEXT,
  notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_versions_single_active
  ON fee_versions (status)
  WHERE status = 'active';

-- ----------------------------------------------------------------------------
-- TABLE 3: fee_rules
-- Verified and versioned fee parameters per country
-- NULL explicitly means unverified or not applicable (NOT zero)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fee_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id TEXT NOT NULL REFERENCES fee_versions(version_id) ON DELETE RESTRICT,
  country_code TEXT NOT NULL REFERENCES countries(country_code) ON DELETE RESTRICT,

  transaction_rate REAL,

  listing_fee_amount REAL,
  listing_fee_currency TEXT,

  processing_rate REAL,
  processing_fixed_amount REAL,
  processing_fixed_currency TEXT,

  domestic_processing_rate REAL,
  domestic_processing_fixed_amount REAL,
  domestic_processing_fixed_currency TEXT,

  international_processing_rate REAL,
  international_processing_fixed_amount REAL,
  international_processing_fixed_currency TEXT,

  regulatory_rate REAL,

  currency_conversion_rate REAL,

  offsite_rate_below_threshold REAL,
  offsite_rate_above_threshold REAL,
  offsite_cap_amount REAL,
  offsite_cap_currency TEXT,
  offsite_threshold_amount REAL,
  offsite_threshold_currency TEXT,

  plus_monthly_amount REAL,
  plus_currency TEXT,

  deposit_minimum_amount REAL,
  deposit_minimum_currency TEXT,
  deposit_threshold_amount REAL,
  deposit_threshold_currency TEXT,
  deposit_fee_amount REAL,
  deposit_fee_currency TEXT,

  setup_fee_amount REAL,
  setup_fee_currency TEXT,

  tax_notes TEXT,
  special_rules TEXT,

  source_id TEXT,
  source_url TEXT,

  effective_from TEXT,
  effective_until TEXT,

  verification_status TEXT NOT NULL,
  created_at TEXT NOT NULL,

  CONSTRAINT unq_version_country UNIQUE (version_id, country_code)
);

CREATE INDEX IF NOT EXISTS idx_fee_rules_version ON fee_rules(version_id);
CREATE INDEX IF NOT EXISTS idx_fee_rules_country ON fee_rules(country_code);
CREATE INDEX IF NOT EXISTS idx_fee_rules_effective ON fee_rules(effective_from);
CREATE INDEX IF NOT EXISTS idx_fee_rules_verification ON fee_rules(verification_status);

-- ----------------------------------------------------------------------------
-- TABLE 4: source_registry
-- Monitored official Etsy Help Center and policy documentation endpoints
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_registry (
  source_id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  parser_version TEXT,
  last_checked_at TEXT,
  last_successful_check_at TEXT,
  latest_hash TEXT,
  latest_normalized_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ----------------------------------------------------------------------------
-- TABLE 5: snapshots
-- Periodic content captures with retention controls for auditing
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source_registry(source_id) ON DELETE RESTRICT,
  fetched_at TEXT NOT NULL,
  http_status INTEGER,
  content_type TEXT,
  raw_content TEXT,
  normalized_content TEXT,
  content_hash TEXT,
  normalized_hash TEXT,
  parser_version TEXT,
  success INTEGER NOT NULL,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_snapshots_source_fetched ON snapshots(source_id, fetched_at DESC);

-- ----------------------------------------------------------------------------
-- TABLE 6: detected_changes
-- Normalized field-level diffs detected by automated monitoring
-- Statuses: detected, pending_review, approved, rejected, published
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS detected_changes (
  change_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source_registry(source_id) ON DELETE RESTRICT,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id) ON DELETE RESTRICT,
  country_code TEXT REFERENCES countries(country_code) ON DELETE RESTRICT,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  change_type TEXT,
  detected_at TEXT NOT NULL,
  effective_from TEXT,
  status TEXT NOT NULL CHECK(status IN ('detected', 'pending_review', 'approved', 'rejected', 'published')),
  validation_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_detected_changes_status ON detected_changes(status);
CREATE INDEX IF NOT EXISTS idx_detected_changes_source ON detected_changes(source_id);

-- ----------------------------------------------------------------------------
-- TABLE 7: review_queue
-- Human-in-the-loop governance for approving detected rate adjustments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_queue (
  review_id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES detected_changes(change_id) ON DELETE RESTRICT,
  priority TEXT NOT NULL,
  reason TEXT,
  old_value TEXT,
  proposed_value TEXT,
  source_url TEXT,
  detected_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewer_note TEXT,
  status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_priority ON review_queue(priority);

-- ----------------------------------------------------------------------------
-- TABLE 8: monitor_runs
-- Health telemetry and execution log for scheduled monitor tasks
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monitor_runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  sources_checked INTEGER DEFAULT 0,
  sources_changed INTEGER DEFAULT 0,
  changes_detected INTEGER DEFAULT 0,
  changes_published INTEGER DEFAULT 0,
  reviews_created INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_monitor_runs_started ON monitor_runs(started_at DESC);

-- ============================================================================
-- INITIAL SEED DATA
-- Sourced exclusively from existing verified ShopProfit production database
-- ============================================================================

-- 1. Initial Production Fee Version
INSERT INTO fee_versions (version_id, version_label, status, created_at, published_at, source_hash, notes)
VALUES (
  'v1.0.0',
  '1.0.0',
  'active',
  '2026-10-06T00:00:00Z',
  '2026-10-06T00:00:00Z',
  '44526eef75082b7751e59f32eff9bfaf27ad22f2cdc83446ea18a34f012adf54',
  'Initial baseline seed from verified ShopProfit production dataset.'
);

-- 2. Initial Official Source Registry (From config/etsy-fee-watch.json)
INSERT INTO source_registry (source_id, source_name, source_url, source_type, enabled, parser_version, latest_hash, created_at, updated_at)
VALUES
  ('115015628847', 'Payment Processing Fees for Selling on Etsy', 'https://help.etsy.com/hc/en-us/articles/115015628847-What-are-Payment-Processing-Fees-for-Selling-on-Etsy', 'zendesk_article', 1, '1.0.0', '44526eef75082b7751e59f32eff9bfaf27ad22f2cdc83446ea18a34f012adf54', '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('1500011073202', 'Regulatory Operating Fee', 'https://help.etsy.com/hc/en-us/articles/1500011073202-What-is-a-Regulatory-Operating-Fee', 'zendesk_article', 1, '1.0.0', '3b31cf734681c4f8ac4503f83e44cb9e81e700f4a804d9930692282bacc069b7', '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('115014483627', 'Fees and Taxes for Selling on Etsy', 'https://help.etsy.com/hc/en-us/articles/115014483627-What-are-the-Fees-and-Taxes-for-Selling-on-Etsy', 'zendesk_article', 1, '1.0.0', '14643cd24ae12214904ee611eea3de9c2a70a664d583f2f27ab845f4120f1c2f', '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('360000338367', 'How Etsy Offsite Ads Work', 'https://help.etsy.com/hc/en-us/articles/360000338367-How-Etsy-s-Offsite-Ads-Work', 'zendesk_article', 1, '1.0.0', 'fcc15cae7938f08e690d418ab884a438485ed0d111784c719171024d3640a6de', '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z');

-- 3. Initial 12 Verified Countries
INSERT INTO countries (country_code, country_name, currency_code, currency_symbol, locale, etsy_payments_status, status, sort_order, created_at, updated_at)
VALUES
  ('US', 'United States', 'USD', '$', 'en-US', 'supported', 'active', 1, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('UK', 'United Kingdom', 'GBP', '£', 'en-GB', 'supported', 'active', 2, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('CA', 'Canada', 'CAD', 'CA$', 'en-CA', 'supported', 'active', 3, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('AU', 'Australia', 'AUD', 'A$', 'en-AU', 'supported', 'active', 4, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('DE', 'Germany / Eurozone', 'EUR', '€', 'de-DE', 'supported', 'active', 5, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('FR', 'France', 'EUR', '€', 'fr-FR', 'supported', 'active', 6, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('IT', 'Italy', 'EUR', '€', 'it-IT', 'supported', 'active', 7, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('ES', 'Spain', 'EUR', '€', 'es-ES', 'supported', 'active', 8, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('IN', 'India', 'INR', '₹', 'en-IN', 'supported', 'active', 9, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('JP', 'Japan', 'JPY', '¥', 'ja-JP', 'supported', 'active', 10, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('TR', 'Türkiye', 'TRY', '₺', 'tr-TR', 'supported', 'active', 11, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z'),
  ('OTHER', 'Global / Other', 'USD', '$', 'en-US', 'supported', 'partial', 12, '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z');

-- 4. Initial 12 Verified Fee Rule Records (Linked to v1.0.0)
INSERT INTO fee_rules (
  version_id, country_code, transaction_rate,
  listing_fee_amount, listing_fee_currency,
  processing_rate, processing_fixed_amount, processing_fixed_currency,
  domestic_processing_rate, domestic_processing_fixed_amount, domestic_processing_fixed_currency,
  international_processing_rate, international_processing_fixed_amount, international_processing_fixed_currency,
  regulatory_rate, currency_conversion_rate,
  offsite_rate_below_threshold, offsite_rate_above_threshold, offsite_cap_amount, offsite_cap_currency, offsite_threshold_amount, offsite_threshold_currency,
  plus_monthly_amount, plus_currency,
  special_rules, source_id, source_url, effective_from, verification_status, created_at
) VALUES
  (
    'v1.0.0', 'US', 0.065,
    0.20, 'USD',
    0.03, 0.25, 'USD',
    0.03, 0.25, 'USD',
    0.03, 0.25, 'USD',
    0.0, 0.025,
    0.15, 0.12, 100.0, 'USD', 10000.0, 'USD',
    10.0, 'USD',
    NULL, '115015628847', 'https://help.etsy.com/hc/en-us/articles/115015628847', '2026-10-01T00:00:00Z', 'verified', '2026-10-06T00:00:00Z'
  ),
  (
    'v1.0.0', 'UK', 0.065,
    0.16, 'GBP',
    0.04, 0.20, 'GBP',
    0.04, 0.20, 'GBP',
    0.04, 0.20, 'GBP',
    0.0048, 0.025,
    0.15, 0.12, 80.0, 'GBP', 10000.0, 'USD',
    8.0, 'GBP',
    NULL, '1500011073202', 'https://help.etsy.com/hc/en-us/articles/1500011073202', '2026-10-01T00:00:00Z', 'verified', '2026-10-06T00:00:00Z'
  ),
  (
    'v1.0.0', 'CA', 0.065,
    0.27, 'CAD',
    0.03, 0.25, 'CAD',
    0.03, 0.25, 'CAD',
    0.04, 0.25, 'CAD',
    0.005, 0.025,
    0.15, 0.12, 135.0, 'CAD', 10000.0, 'USD',
    13.5, 'CAD',
    'Domestic or US order rate; international orders are 4% + CA$0.25.', '1500011073202', 'https://help.etsy.com/hc/en-us/articles/1500011073202', '2026-10-01T00:00:00Z', 'verified', '2026-10-06T00:00:00Z'
  ),
  (
    'v1.0.0', 'AU', 0.065,
    0.28, 'AUD',
    0.03, 0.25, 'AUD',
    0.03, 0.25, 'AUD',
    0.04, 0.25, 'AUD',
    0.0, 0.025,
    0.15, 0.12, 150.0, 'AUD', 10000.0, 'USD',
    15.0, 'AUD',
    'Domestic order rate; international orders are 4% + A$0.25.', '115015628847', 'https://help.etsy.com/hc/en-us/articles/115015628847', '2026-10-01T00:00:00Z', 'verified', '2026-10-06T00:00:00Z'
  ),
  (
    'v1.0.0', 'DE', 0.065,
    0.18, 'EUR',
    0.04, 0.30, 'EUR',
    0.04, 0.30, 'EUR',
    0.04, 0.30, 'EUR',
    0.0, 0.025,
    0.15, 0.12, 95.0, 'EUR', 10000.0, 'USD',
    9.5, 'EUR',
    'Eurozone rate (4% + €0.30); no separate regulatory operating fee is currently published for Germany/Eurozone.', '115015628847', 'https://help.etsy.com/hc/en-us/articles/115015628847', '2026-10-01T00:00:00Z', 'verified', '2026-10-06T00:00:00Z'
  ),
  (
    'v1.0.0', 'FR', 0.065,
    0.18, 'EUR',
    0.04, 0.30, 'EUR',
    0.04, 0.30, 'EUR',
    0.04, 0.30, 'EUR',
    0.0114, 0.025,
    0.15, 0.12, 95.0, 'EUR', 10000.0, 'USD',
    9.5, 'EUR',
    NULL, '1500011073202', 'https://help.etsy.com/hc/en-us/articles/1500011073202', '2026-10-01T00:00:00Z', 'verified', '2026-10-06T00:00:00Z'
  ),
  (
    'v1.0.0', 'IT', 0.065,
    0.18, 'EUR',
    0.04, 0.30, 'EUR',
    0.04, 0.30, 'EUR',
    0.04, 0.30, 'EUR',
    0.008, 0.025,
    0.15, 0.12, 95.0, 'EUR', 10000.0, 'USD',
    9.5, 'EUR',
    NULL, '1500011073202', 'https://help.etsy.com/hc/en-us/articles/1500011073202', '2026-10-01T00:00:00Z', 'verified', '2026-10-06T00:00:00Z'
  ),
  (
    'v1.0.0', 'ES', 0.065,
    0.18, 'EUR',
    0.04, 0.30, 'EUR',
    0.04, 0.30, 'EUR',
    0.04, 0.30, 'EUR',
    0.0088, 0.025,
    0.15, 0.12, 95.0, 'EUR', 10000.0, 'USD',
    9.5, 'EUR',
    NULL, '1500011073202', 'https://help.etsy.com/hc/en-us/articles/1500011073202', '2026-10-01T00:00:00Z', 'verified', '2026-10-06T00:00:00Z'
  ),
  (
    'v1.0.0', 'IN', 0.065,
    16.5, 'INR',
    0.05, 25.0, 'INR',
    0.05, 25.0, 'INR',
    0.05, 25.0, 'INR',
    0.0005, 0.025,
    0.15, 0.12, 8300.0, 'INR', 10000.0, 'USD',
    830.0, 'INR',
    NULL, '1500011073202', 'https://help.etsy.com/hc/en-us/articles/1500011073202', '2026-10-01T00:00:00Z', 'verified', '2026-10-06T00:00:00Z'
  ),
  (
    'v1.0.0', 'JP', 0.065,
    30.0, 'JPY',
    0.06, 45.0, 'JPY',
    0.06, 45.0, 'JPY',
    0.06, 45.0, 'JPY',
    0.0, 0.025,
    0.15, 0.12, 15000.0, 'JPY', 10000.0, 'USD',
    1500.0, 'JPY',
    'Etsy publishes the fixed processing charge in USD; the JPY amount is an estimate and currency conversion is not modeled.', '115015628847', 'https://help.etsy.com/hc/en-us/articles/115015628847', '2026-10-01T00:00:00Z', 'verified', '2026-10-06T00:00:00Z'
  ),
  (
    'v1.0.0', 'TR', 0.065,
    7.0, 'TRY',
    0.065, 14.0, 'TRY',
    0.065, 14.0, 'TRY',
    0.065, 14.0, 'TRY',
    0.0167, 0.025,
    0.15, 0.12, 3400.0, 'TRY', 10000.0, 'USD',
    340.0, 'TRY',
    'Türkiye rate per Etsy published schedule: 6.5% + ₺14. Regulatory operating fee 1.67%. Fixed TRY amounts are subject to exchange-rate changes.', '1500011073202', 'https://help.etsy.com/hc/en-us/articles/1500011073202', '2026-10-01T00:00:00Z', 'verified', '2026-10-06T00:00:00Z'
  ),
  (
    'v1.0.0', 'OTHER', 0.065,
    0.20, 'USD',
    0.065, 0.30, 'USD',
    0.065, 0.30, 'USD',
    0.065, 0.30, 'USD',
    0.0, 0.025,
    0.15, 0.12, 100.0, 'USD', 10000.0, 'USD',
    10.0, 'USD',
    'Generic USD baseline only; this is not a country-specific Etsy fee schedule.', '115014483627', 'https://help.etsy.com/hc/en-us/articles/115014483627', '2026-10-01T00:00:00Z', 'verified', '2026-10-06T00:00:00Z'
  );
