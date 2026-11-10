-- Keep quotausages in step with objectmds for buckets whose quota.mode is strict.
-- A completed object reserves its size and one object.
-- An S3 multipart object (data.multipart_upload) reserves one object and no
-- bytes: object_server.js already reserved each part in complete_multipart.
-- num_parts is the NB chunk count (~4MB), so a plain PutObject larger than one
-- chunk also has num_parts > 1 and must still reserve its size here.
-- Deleting a row releases its size and one object, including when an overwrite
-- soft-deletes the previous object and inserts a new one.
-- Soft delete is an UPDATE that sets data.deleted, not a SQL DELETE.
-- Incomplete uploads (upload_started set) do not consume quota.
-- The quota table name follows the objectmds table name so test suffixes match
-- (objectmds_foo -> quotausages_foo). Shard is hashtextextended(bucket_id, random seed)
-- in [0, 9]; readers sum all shards of a bucket.
-- Strict mode is read from buckets.data->'quota'->>'mode'. The trigger returns
-- before any quota work when the bucket is not strict.

-- op is 'INSERT', 'UPDATE', or 'DELETE'.
-- A live row with multipart_upload contributes 0 bytes and 1 object on
-- INSERT and UPDATE. op 'DELETE' returns the real size and one object so the
-- replaced row can be released.
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
            WHEN obj->'deleted' IS NOT NULL AND obj->'deleted' <> 'null'::jsonb THEN 0::bigint
            WHEN jsonb_typeof(obj->'size') = 'number' AND (obj->>'size')::numeric > 0
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

-- plpgsql so this can be created before the buckets table exists.
CREATE OR REPLACE FUNCTION bucket_has_strict_quota(bucket_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    IF bucket_id IS NULL OR bucket_id = '' THEN
        RETURN false;
    END IF;
    RETURN EXISTS (
        SELECT 1
        FROM buckets
        WHERE _id = left(bucket_id, 24)::char(24)
          AND data->'quota'->>'mode' = 'strict'
    );
END;
$$;

CREATE OR REPLACE FUNCTION quotausage_apply_delta(
    quota_table text,
    bucket_id text,
    object_id text,
    delta_bytes bigint,
    delta_objects bigint
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    shard_id int;
BEGIN
    IF bucket_id IS NULL OR bucket_id = '' THEN
        RETURN;
    END IF;
    IF COALESCE(delta_bytes, 0) = 0 AND COALESCE(delta_objects, 0) = 0 THEN
        RETURN;
    END IF;

    -- shard_id := floor(random() * 10)::int;
    --  TODO : coretest uses PG 12 image, PG 12 dont have pg_current_xact_id(), Keep txid_current() till coretest uses PG 18
    --  once coretest move to PG 18, replace it with pg_current_xact_id()
    shard_id := mod(mod(hashint8(txid_current()), 10) + 10, 10);

    EXECUTE format(
        'INSERT INTO %I AS c (scope_type, scope_id, shard, used_bytes, used_objects)
         VALUES (''bucket'', $1, $2, $3, $4)
         ON CONFLICT (scope_type, scope_id, shard) DO UPDATE
         SET used_bytes = c.used_bytes + EXCLUDED.used_bytes,
             used_objects = c.used_objects + EXCLUDED.used_objects',
        quota_table
    )
    USING left(bucket_id, 24), shard_id, COALESCE(delta_bytes, 0), COALESCE(delta_objects, 0);
END;
$$;

CREATE OR REPLACE FUNCTION objectmds_quota_usage_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    quota_table text;
    old_bytes bigint := 0;
    old_objects bigint := 0;
    new_bytes bigint := 0;
    new_objects bigint := 0;
    old_bucket text;
    new_bucket text;
    new_strict boolean;
BEGIN
    IF TG_TABLE_NAME !~ '^objectmds' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    -- Hard delete has no NEW row. Score the pre-delete row with op DELETE so a
    -- multipart object returns its size (the live-row rule returns 0 bytes).

    -- Return before contribution math or any quotausages write.
    new_strict := bucket_has_strict_quota(NEW.data->>'bucket');
    IF NOT new_strict THEN
        RETURN NEW;
    END IF;

    quota_table := regexp_replace(TG_TABLE_NAME, '^objectmds', 'quotausages');

    IF TG_OP = 'INSERT' THEN
        SELECT c.bytes, c.objects INTO new_bytes, new_objects
        FROM objectmd_quota_contribution(NEW.data, TG_OP) AS c;
        PERFORM quotausage_apply_delta(
            quota_table, NEW.data->>'bucket', NEW._id, new_bytes, new_objects);
        RETURN NEW;
    END IF;


    SELECT c.bytes, c.objects INTO old_bytes, old_objects
    FROM objectmd_quota_contribution(OLD.data, TG_OP) AS c;
    SELECT c.bytes, c.objects INTO new_bytes, new_objects
    FROM objectmd_quota_contribution(NEW.data, TG_OP) AS c;
    old_bucket := OLD.data->>'bucket';
    new_bucket := NEW.data->>'bucket';

    IF old_bucket IS NOT DISTINCT FROM new_bucket THEN
        PERFORM quotausage_apply_delta(
            quota_table,
            new_bucket,
            NEW._id,
            COALESCE(new_bytes, 0) - COALESCE(old_bytes, 0),
            COALESCE(new_objects, 0) - COALESCE(old_objects, 0));
    ELSE
        PERFORM quotausage_apply_delta(
            quota_table, old_bucket, OLD._id, -old_bytes, -old_objects);
        PERFORM quotausage_apply_delta(
            quota_table, new_bucket, NEW._id, new_bytes, new_objects);
    END IF;
    RETURN NEW;
END;
$$;

-- Called after the objectmds table exists. sql_functions load before tables
-- are created, so the trigger cannot be created from this file directly.
CREATE OR REPLACE FUNCTION install_objectmds_quota_trigger(objectmds_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN

    IF NOT EXISTS (
        SELECT 1 
        FROM pg_trigger 
        WHERE tgname = 'objectmds_quota_ins'
    ) THEN
        EXECUTE format(
            'CREATE TRIGGER objectmds_quota_ins AFTER INSERT ON objectmds FOR EACH ROW
            WHEN (NEW.data->''triggers'' ? ''quota'')
            EXECUTE FUNCTION objectmds_quota_usage_fn()'
        );
    END IF;


    IF NOT EXISTS (
        SELECT 1 
        FROM pg_trigger 
        WHERE tgname = 'objectmds_quota_upd'
    ) THEN
        EXECUTE format(
            'CREATE TRIGGER objectmds_quota_upd AFTER UPDATE ON objectmds FOR EACH ROW
            WHEN ((OLD.data->''triggers'' ? ''quota'') AND (
                OLD.data->''size''           IS DISTINCT FROM NEW.data->''size''
                OR OLD.data->''deleted''        IS DISTINCT FROM NEW.data->''deleted''
                OR OLD.data->''upload_started'' IS DISTINCT FROM NEW.data->''upload_started''))
            EXECUTE FUNCTION objectmds_quota_usage_fn()'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 
        FROM pg_trigger 
        WHERE tgname = 'objectmds_quota_del'
    ) THEN
        EXECUTE format(
            'CREATE TRIGGER objectmds_quota_del AFTER DELETE ON objectmds FOR EACH ROW
            WHEN (OLD.data->''triggers'' ? ''quota'')
            EXECUTE FUNCTION objectmds_quota_usage_fn()'
        );
    END IF;


END;
$$;
