-- Keep quotausages in step with objectmds rows whose data.triggers contains
-- 'quota'. The application sets that when the bucket quota mode is strict.
-- This file does not read buckets.data.quota. Rows without the trigger contribute nothing.
--
-- A live completed simple object (no upload_started, not deleted, size > 0)
-- contributes its size and one object. An incomplete upload (upload_started set)
-- contributes nothing here; part bytes are posted by objectmultiparts_quota_usage.sql.
-- A live multipart_upload row contributes one object and no bytes. Part sizes
-- stay on the part rows. num_parts is the NB chunk count (~4MB), so a plain
-- PutObject larger than one chunk also has num_parts > 1 and must still reserve
-- its size here. Multipart bytes are recognized by data.multipart_upload, not num_parts.
-- Soft-deleting that multipart object contributes -size and 0 objects, so the
-- update delta (new - old) releases the size and the one object. Part deletes
-- after that do not release those bytes again: the multipart trigger skips a
-- parent that is no longer an active upload.
-- A live delete marker has no size, so it contributes one object and no bytes.
--
-- Soft delete is an UPDATE that sets data.deleted and releases the old
-- contribution. Overwrite does that to the previous object and inserts the new
-- one. A SQL DELETE of a still-live row (data.deleted absent, or JSON null)
-- releases its contribution from the delete trigger. A row already soft-deleted
-- was released on the update, and the delete trigger skips it.
--
-- install_quota_functions builds one trigger function per table. The quota table
-- name and the shard count are fixed in that body, so the upsert is static SQL
-- and PL/pgSQL plans it once per session. suffix is '' in production and the
-- coretest table suffix otherwise. CREATE OR REPLACE keeps the function OID, so
-- existing triggers use the new body with no DDL on the tables.
-- The shard is mod(hashint8(txid_current()), shards), folded into [0, shards).
-- txid_current() stays until coretest leaves PostgreSQL 12 (no pg_current_xact_id()).
-- Readers sum every shard, so a new shard count does not invalidate old rows.
-- md_store passes config.QUOTA_USAGE_SHARDS on startup.

-- A live multipart_upload row contributes 0 bytes and 1 object.
-- A soft-deleted multipart_upload row contributes -size and 0 objects so the
-- update delta (new - old) releases the size. A positive size on that row
-- would add usage, because the live row is 0.
-- The deleted check has to come after that branch: an earlier deleted match
-- returns 0 and the size branch never runs.
-- Any other live row, including a delete marker, contributes one object.
-- The op argument is unused; the contribution depends only on the row.
CREATE OR REPLACE FUNCTION objectmd_quota_contribution(obj jsonb, op text)
RETURNS TABLE(bytes bigint, objects bigint)
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT
        CASE
            WHEN obj IS NULL THEN 0::bigint
            WHEN NULLIF(obj->>'bucket', '') IS NULL THEN 0::bigint
            WHEN obj->'upload_started' IS NOT NULL AND obj->'upload_started' <> 'null'::jsonb THEN 0::bigint
            -- Before the general deleted -> 0 branch. Live multipart bytes are 0,
            -- so this negative value is what new - old subtracts from quotausages.
            WHEN obj->'multipart_upload' = 'true'::jsonb
                AND obj->'deleted' IS NOT NULL AND obj->'deleted' <> 'null'::jsonb
                AND jsonb_typeof(obj->'size') = 'number' AND (obj->>'size')::numeric > 0
                THEN -trunc((obj->>'size')::numeric)::bigint
            WHEN obj->'deleted' IS NOT NULL AND obj->'deleted' <> 'null'::jsonb THEN 0::bigint
            WHEN obj->'multipart_upload' IS NULL AND jsonb_typeof(obj->'size') = 'number' AND (obj->>'size')::numeric > 0
                THEN trunc((obj->>'size')::numeric)::bigint
            ELSE 0::bigint
        END AS bytes,
        CASE
            WHEN obj IS NULL THEN 0::bigint
            WHEN NULLIF(obj->>'bucket', '') IS NULL THEN 0::bigint
            WHEN obj->'upload_started' IS NOT NULL AND obj->'upload_started' <> 'null'::jsonb THEN 0::bigint
            WHEN obj->'deleted' IS NOT NULL AND obj->'deleted' <> 'null'::jsonb THEN 0::bigint
            ELSE 1::bigint
        END AS objects;
$$;

-- suffix = '' in production, test suffix in coretest.
-- Safe on every startup: CREATE OR REPLACE keeps the function OID,
-- so existing triggers use the new body with no DDL on the tables.
CREATE OR REPLACE FUNCTION install_quota_functions(suffix text, shards int DEFAULT 64)
RETURNS void
LANGUAGE plpgsql
AS $gen$
BEGIN
    -- objectmds trigger function
    EXECUTE format($f$
        CREATE OR REPLACE FUNCTION %1$I() RETURNS trigger LANGUAGE plpgsql AS $b$
        DECLARE
            bucket_id text; o record; n record; d_bytes bigint; d_objects bigint;
        BEGIN
            IF TG_OP = 'INSERT' THEN
                SELECT * INTO n FROM objectmd_quota_contribution(NEW.data, TG_OP);
                bucket_id := NEW.data->>'bucket';
                d_bytes := n.bytes;  d_objects := n.objects;
            ELSIF TG_OP = 'DELETE' THEN
                SELECT * INTO o FROM objectmd_quota_contribution(OLD.data, TG_OP);
                bucket_id := OLD.data->>'bucket';
                d_bytes := -o.bytes; d_objects := -o.objects;
            ELSE
                SELECT * INTO o FROM objectmd_quota_contribution(OLD.data, TG_OP);
                SELECT * INTO n FROM objectmd_quota_contribution(NEW.data, TG_OP);
                bucket_id := OLD.data->>'bucket';
                d_bytes := n.bytes - o.bytes; d_objects := n.objects - o.objects;
            END IF;

            IF bucket_id IS NULL OR bucket_id = '' OR (d_bytes = 0 AND d_objects = 0) THEN
                RETURN NULL;
            END IF;

            -- static upsert: planned once per session
            INSERT INTO %2$I AS c (scope_type, scope_id, shard, used_bytes, used_objects)
            VALUES ('bucket', left(bucket_id, 24),
                    mod(mod(hashint8(txid_current()), %3$s) + %3$s, %3$s),
                    d_bytes, d_objects)
            ON CONFLICT (scope_type, scope_id, shard) DO UPDATE
            SET used_bytes   = c.used_bytes   + EXCLUDED.used_bytes,
                used_objects = c.used_objects + EXCLUDED.used_objects;
            RETURN NULL;
        END
        $b$;
    $f$,
        'objectmds_quota_usage_fn' || suffix,
        'quotausages' || suffix,
        shards);

    -- objectmultiparts trigger function (INSERT and UPDATE)
    EXECUTE format($f$
        CREATE OR REPLACE FUNCTION %1$I() RETURNS trigger LANGUAGE plpgsql AS $b$
        DECLARE
            bucket_id text;
            d_bytes bigint;
        BEGIN
            -- cheap check first: pure jsonb, no table access
            IF TG_OP = 'INSERT' THEN
                bucket_id := NEW.data->>'bucket';
                d_bytes := (SELECT bytes FROM objectmultipart_quota_contribution(NEW.data));
            ELSE
                bucket_id := OLD.data->>'bucket';
                d_bytes := (SELECT bytes FROM objectmultipart_quota_contribution(NEW.data))
                         - (SELECT bytes FROM objectmultipart_quota_contribution(OLD.data));
            END IF;
            IF bucket_id IS NULL OR bucket_id = '' OR d_bytes = 0 THEN
                RETURN NULL;
            END IF;

            -- static parent lookup: planned once per session.
            -- The char(24) cast keeps the _id index (text vs char(24) gives a seq scan).
            IF NOT EXISTS (
                SELECT 1 FROM %2$I
                WHERE _id = left(NEW.data->>'obj', 24)::char(24)
                  AND left(data->>'bucket', 24) = left(bucket_id, 24)
                  AND data->'triggers' ? 'quota'
                  AND (   (data->'upload_started' IS NOT NULL
                           AND data->'upload_started' <> 'null'::jsonb)
                       OR (data->'multipart_upload' = 'true'::jsonb
                           AND (data->'deleted' IS NULL OR data->'deleted' = 'null'::jsonb)))
            ) THEN
                RETURN NULL;
            END IF;

            INSERT INTO %3$I AS c (scope_type, scope_id, shard, used_bytes, used_objects)
            VALUES ('bucket', left(bucket_id, 24),
                    mod(mod(hashint8(txid_current()), %4$s) + %4$s, %4$s),
                    d_bytes, 0)
            ON CONFLICT (scope_type, scope_id, shard) DO UPDATE
            SET used_bytes = c.used_bytes + EXCLUDED.used_bytes;
            RETURN NULL;
        END
        $b$;
    $f$,
        'objectmultiparts_quota_usage_fn' || suffix,
        'objectmds' || suffix,
        'quotausages' || suffix,
        shards);
END
$gen$;

-- Called after the objectmds table exists. sql_functions load before tables
-- are created, so the trigger cannot be created from this file directly.
-- install_quota_functions must already have created the trigger function.
-- lock_timeout keeps CREATE TRIGGER from waiting out a long transaction and
-- then blocking writes queued behind that lock.
CREATE OR REPLACE FUNCTION install_objectmds_quota_trigger(objectmds_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    fn text := regexp_replace(objectmds_table, '^objectmds', 'objectmds_quota_usage_fn');
BEGIN
    SET LOCAL lock_timeout = '2s';

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'objectmds_quota_ins'
        AND tgrelid = objectmds_table::regclass
    ) THEN
        EXECUTE format(
            'CREATE TRIGGER objectmds_quota_ins AFTER INSERT ON %I FOR EACH ROW
            WHEN (NEW.data->''triggers'' ? ''quota'')
            EXECUTE FUNCTION %I()',
            objectmds_table, fn
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'objectmds_quota_upd'
        AND tgrelid = objectmds_table::regclass
    ) THEN
        EXECUTE format(
            'CREATE TRIGGER objectmds_quota_upd AFTER UPDATE ON %I FOR EACH ROW
            WHEN ((OLD.data->''triggers'' ? ''quota'') AND (
                OLD.data->''size''           IS DISTINCT FROM NEW.data->''size''
                OR OLD.data->''deleted''        IS DISTINCT FROM NEW.data->''deleted''
                OR OLD.data->''upload_started'' IS DISTINCT FROM NEW.data->''upload_started''))
            EXECUTE FUNCTION %I()',
            objectmds_table, fn
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'objectmds_quota_del'
        AND tgrelid = objectmds_table::regclass
    ) THEN
        EXECUTE format(
            'CREATE TRIGGER objectmds_quota_del AFTER DELETE ON %I FOR EACH ROW
            WHEN (OLD.data->''triggers'' ? ''quota''
            AND OLD.data->>''deleted'' IS NULL)
            EXECUTE FUNCTION %I()',
            objectmds_table, fn
        );
    END IF;
END;
$$;
