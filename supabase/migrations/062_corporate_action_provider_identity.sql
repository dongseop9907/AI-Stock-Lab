-- AI Stock Lab
-- V9.7.12 Corporate Action Canonical Identity Contract
--
-- Preconditions already proven by V9.7.11:
--   corporate_action_events live rows: 0
--   provider-event duplicate groups: 0
--   preview conflicts: 0
--
-- This migration:
--   1) documents column semantics;
--   2) adds a stable UNIQUE index usable by PostgREST/Supabase ON CONFLICT.
--
-- IMPORTANT:
--   This is intentionally NOT a partial unique index.
--   PostgreSQL already permits multiple NULL values in a normal UNIQUE index,
--   while a non-partial unique index can be inferred by:
--     ON CONFLICT (provider, provider_event_id, is_validation)
--
-- No existing legacy unique constraint/index is dropped here.

BEGIN;

COMMENT ON COLUMN public.corporate_action_events.ratio_from IS
  'Pre-action units. For supported generic ratio actions: share_factor = ratio_to / ratio_from; price_factor = ratio_from / ratio_to.';

COMMENT ON COLUMN public.corporate_action_events.ratio_to IS
  'Post-action units. For supported generic ratio actions: share_factor = ratio_to / ratio_from; price_factor = ratio_from / ratio_to.';

COMMENT ON COLUMN public.corporate_action_events.cash_amount IS
  'Cash dividend amount PER SHARE in the currency column. Never total dividend cash.';

COMMENT ON COLUMN public.corporate_action_events.provider_event_id IS
  'Stable canonical provider event identifier. For DART correction chains use the original canonical DART receipt number; otherwise use the event receipt number.';

COMMENT ON COLUMN public.corporate_action_events.source_fingerprint IS
  'Stable canonical event identity fingerprint. For DART_KRX_CANONICAL: SHA256(provider|provider_event_id|stock_code|action_type).';

CREATE UNIQUE INDEX IF NOT EXISTS
  uq_corporate_action_events_provider_event_validation
ON public.corporate_action_events
  (provider, provider_event_id, is_validation);

COMMIT;
