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
-- (objectmds_foo -> quotausages_foo). Shard is stable per object id in [0, 9].
-- Strict mode is read from buckets.data->'quota'->>'mode'. Other buckets are left unchanged.

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
            -- Part bytes were reserved in complete_multipart. Count the object only.
            WHEN op IS DISTINCT FROM 'DELETE'
                AND obj->'multipart_upload' = 'true'::jsonb THEN 0::bigint
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

    -- buckets is a system table (_id, data jsonb). Only strict quota is tracked here.
    IF NOT EXISTS (
        SELECT 1
        FROM buckets
        WHERE _id = left(bucket_id, 24)::char(24)
          AND data->'quota'->>'mode' = 'strict'
    ) THEN
        RETURN;
    END IF;

    -- Same object always lands on the same shard, so reserve and release meet.
    shard_id := mod(mod(hashtextextended(COALESCE(object_id, bucket_id), 0), 10) + 10, 10);

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
BEGIN
    IF TG_TABLE_NAME !~ '^objectmds' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
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

    -- Hard delete, and soft delete (UPDATE that sets data.deleted).
    -- The pre-delete row is scored with op DELETE so a multipart object
    -- releases the size object_server reserved, plus its object count.
    -- A new row inserted for the same key is counted on its own INSERT/UPDATE.
    IF TG_OP = 'DELETE'
        OR (
            (NEW.data->'deleted' IS NOT NULL AND NEW.data->'deleted' <> 'null'::jsonb)
            AND (OLD.data->'deleted' IS NULL OR OLD.data->'deleted' = 'null'::jsonb)
        ) THEN
        SELECT c.bytes, c.objects INTO old_bytes, old_objects
        FROM objectmd_quota_contribution(OLD.data, 'DELETE') AS c;
        PERFORM quotausage_apply_delta(
            quota_table, OLD.data->>'bucket', OLD._id, -old_bytes, -old_objects);
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
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
    EXECUTE format('DROP TRIGGER IF EXISTS objectmds_quota_usage_trg ON %I', objectmds_table);
    EXECUTE format(
        'CREATE TRIGGER objectmds_quota_usage_trg
         AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW
         EXECUTE FUNCTION objectmds_quota_usage_fn()',
        objectmds_table
    );
END;
$$;

-- Earlier revisions used a one-argument function. Drop it after the trigger
-- function above no longer calls it.
DROP FUNCTION IF EXISTS objectmd_quota_contribution(jsonb);
