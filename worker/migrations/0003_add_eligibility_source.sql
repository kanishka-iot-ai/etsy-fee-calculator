-- ============================================================================
-- Migration 0003: Add authoritative eligibility source to source_registry
-- Source 115015710408: Countries Eligible for Etsy Payments
-- ============================================================================

INSERT OR IGNORE INTO source_registry (
  source_id, source_name, source_url, source_type, enabled, parser_version, latest_hash, created_at, updated_at
) VALUES (
  '115015710408',
  'Countries Eligible for Etsy Payments',
  'https://help.etsy.com/hc/en-us/articles/115015710408-Countries-Eligible-for-Etsy-Payments',
  'zendesk_article',
  1,
  '1.0.0',
  '0f6f1e40ff1b48ecca4cbe7cf99063760674a2e679d7da6ba89cdb9566f033cf',
  '2026-10-06T00:00:00Z',
  '2026-10-06T00:00:00Z'
);
