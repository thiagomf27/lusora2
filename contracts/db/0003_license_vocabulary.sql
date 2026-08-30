-- D72: the licence vocabulary becomes the library's, because the library is
-- what stores the values the filter compares against. `owned` -> `own`,
-- `stock-licensed` -> `royalty-free`; every other token was already shared.
--
-- `licenses` appears in exactly one place in channel_config —
-- $defs/visualSource, reachable only from source_policy.visual.chain[] — so
-- this rewrites that array and nothing else. A blanket search-and-replace over
-- the document would also hit free text like a source's `style` string.
--
-- Only channels.config is rewritten. videos.cfg is the immutable snapshot of
-- what a video was produced with (Principle 7: a re-run reproduces the old
-- video) and nothing re-validates it — the platform validates the LIVE channel
-- config at enqueue. asset_usage.license is provenance for footage already on
-- disk, and is left alone for the same reason.
--
-- Idempotent: the WHERE finds no old tokens on a second run and rewrites
-- nothing.
UPDATE channels
SET config = jsonb_set(
      config,
      '{source_policy,visual,chain}',
      (
        SELECT jsonb_agg(
                 CASE
                   WHEN src ? 'licenses' THEN jsonb_set(
                     src, '{licenses}',
                     (SELECT jsonb_agg(
                               CASE lic #>> '{}'
                                 WHEN 'owned' THEN '"own"'::jsonb
                                 WHEN 'stock-licensed' THEN '"royalty-free"'::jsonb
                                 ELSE lic
                               END ORDER BY lic_ord)
                        FROM jsonb_array_elements(src -> 'licenses')
                             WITH ORDINALITY AS l(lic, lic_ord)))
                   ELSE src
                 END ORDER BY ord)
        FROM jsonb_array_elements(config #> '{source_policy,visual,chain}')
             WITH ORDINALITY AS t(src, ord)
      )
    )
WHERE jsonb_path_exists(
        config,
        '$.source_policy.visual.chain[*].licenses[*] ? (@ == "owned" || @ == "stock-licensed")');
