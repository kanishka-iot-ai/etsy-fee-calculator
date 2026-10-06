-- ============================================================================
-- Migration: 0004_provenance_hardening.sql
-- Project: ShopProfit Global Etsy Fee Intelligence System
-- Purpose: Provenance Governance Hardening (Step 15)
-- Safety: Additive, non-destructive NULLable columns preserving historical releases
-- ============================================================================

-- 1. Add composite source manifest hash and reviewer identity to fee_versions
ALTER TABLE fee_versions ADD COLUMN source_manifest_hash TEXT;
ALTER TABLE fee_versions ADD COLUMN approved_by TEXT;

-- 2. Add reviewer identity to review_queue
ALTER TABLE review_queue ADD COLUMN reviewed_by TEXT;
