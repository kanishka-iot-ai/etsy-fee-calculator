-- ============================================================================
-- Migration 0002: Expand source_registry for complete official Etsy coverage
-- Adds official Etsy articles for Etsy Plus, Currency Conversion, and VAT
-- ============================================================================

INSERT OR IGNORE INTO source_registry (
  source_id, source_name, source_url, source_type, enabled, parser_version, latest_hash, created_at, updated_at
) VALUES
  (
    '360001589928',
    'What is Etsy Plus?',
    'https://help.etsy.com/hc/en-us/articles/360001589928-What-is-Etsy-Plus',
    'zendesk_article',
    1,
    '1.0.0',
    NULL,
    '2026-10-06T00:00:00Z',
    '2026-10-06T00:00:00Z'
  ),
  (
    '360000344668',
    'Currency Conversion Fees',
    'https://help.etsy.com/hc/en-us/articles/360000344668-Currency-Conversion-Fees',
    'zendesk_article',
    1,
    '1.0.0',
    NULL,
    '2026-10-06T00:00:00Z',
    '2026-10-06T00:00:00Z'
  ),
  (
    '360040584433',
    'VAT on Seller Fees',
    'https://help.etsy.com/hc/en-us/articles/360040584433-VAT-on-Seller-Fees',
    'zendesk_article',
    1,
    '1.0.0',
    NULL,
    '2026-10-06T00:00:00Z',
    '2026-10-06T00:00:00Z'
  );
