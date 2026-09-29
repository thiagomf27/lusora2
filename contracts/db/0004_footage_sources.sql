-- D104: gather_footage places shots from two new sources, and asset_usage
-- records every placed asset's source. Without these values the first
-- Centralia run on documentary v1.3 failed in resolve_assets on its first
-- YouTube shot ("invalid input value for enum asset_source").
--
-- Declared only, never used in this file, so both are safe inside
-- migrate.ts's BEGIN/COMMIT (PG12+, see 0002).
ALTER TYPE asset_source ADD VALUE IF NOT EXISTS 'youtube';
ALTER TYPE asset_source ADD VALUE IF NOT EXISTS 'archive';
