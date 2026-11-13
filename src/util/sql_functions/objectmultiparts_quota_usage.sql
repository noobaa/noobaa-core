-- Keep quotausages.used_bytes in step with objectmultiparts for buckets whose
-- quota.mode is strict.
-- objectmds_quota_usage.sql posts the completed size of a simple upload and
-- the object count. A live multipart_upload row adds no bytes there.
-- Soft-deleting that object releases data.size from objectmds.
-- This trigger posts each part size instead. used_objects stays 0 here.
--
-- A part reserves its size once the part upload finishes (data.create_time),
-- which happens while the parent object upload is still in progress
-- (objectmds.data.upload_started). create_multipart only checks the cache;
-- the counter moves on the complete_multipart update.
-- Completing the object clears upload_started and sets multipart_upload.
-- The part rows are left in place, so the bytes stay in quotausages.
-- Unused parts are soft-deleted at completion and release their size.
-- Aborting an in-progress upload soft-deletes the part rows later, and that
-- update releases those bytes. Deleting a completed multipart object releases
-- data.size from the objectmds trigger; part deletes after that do not
-- release the same bytes again.
-- Soft delete is an UPDATE that sets data.deleted, not a SQL DELETE.
--
-- The parent upload is read from the sibling objectmds table so test suffixes
-- match (objectmultiparts_foo -> objectmds_foo, quotausages_foo).
-- Depends on bucket_has_strict_quota and quotausage_apply_delta from
-- objectmds_quota_usage.sql, which loads first.

-- bytes is the part size once the part is completed and not deleted.
-- objects is always 0; objectmds owns used_objects.
CREATE OR REPLACE FUNCTION objectmultipart_quota_contribution(part jsonb)
RETURNS TABLE(bytes bigint, objects bigint)
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT
        CASE
            WHEN part IS NULL THEN 0::bigint
            WHEN NULLIF(part->>'bucket', '') IS NULL THEN 0::bigint
            WHEN part->'deleted' IS NOT NULL AND part->'deleted' <> 'null'::jsonb THEN 0::bigint
            WHEN part->'create_time' IS NULL OR part->'create_time' = 'null'::jsonb THEN 0::bigint
            WHEN jsonb_typeof(part->'size') = 'number' AND (part->>'size')::numeric > 0
                THEN trunc((part->>'size')::numeric)::bigint
            ELSE 0::bigint
        END AS bytes,
        0::bigint AS objects;
$$;

-- True when obj_id is a strict-quota upload in objectmds whose part sizes
-- still belong in quotausages: an in-progress upload (upload_started, including
-- after abort) or a live multipart object. A deleted completed multipart
-- object is excluded: objectmds already released data.size.
-- The objectmds table name is passed in so test suffixes resolve to the
-- sibling table. plpgsql so this can be created before objectmds exists.
CREATE OR REPLACE FUNCTION object_quota_upload_active(
    objectmds_table text,
    obj_id text,
    bucket_id text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    active boolean;
BEGIN
    IF obj_id IS NULL OR obj_id = '' OR bucket_id IS NULL OR bucket_id = '' THEN
        RETURN false;
    END IF;
    IF objectmds_table IS NULL OR objectmds_table !~ '^objectmds' THEN
        RETURN false;
    END IF;

    EXECUTE format(
        'SELECT EXISTS (
            SELECT 1
            FROM %I
            WHERE _id = left($1, 24)::char(24)
              AND left(data->>''bucket'', 24) = left($2, 24)
              AND data->''triggers'' ? ''quota''
              AND (
                    (data->''upload_started'' IS NOT NULL
                     AND data->''upload_started'' <> ''null''::jsonb)
                 OR (
                        data->''multipart_upload'' = ''true''::jsonb
                    AND (data->''deleted'' IS NULL OR data->''deleted'' = ''null''::jsonb)
                    )
              )
        )',
        objectmds_table
    )
    INTO active
    USING obj_id, bucket_id;
    RETURN COALESCE(active, false);
END;
$$;

CREATE OR REPLACE FUNCTION objectmultiparts_quota_usage_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    quota_table text;
    objectmds_table text;
    old_bytes bigint := 0;
    old_objects bigint := 0;
    new_bytes bigint := 0;
    new_objects bigint := 0;
    old_bucket text;
    new_bucket text;
    obj_id text;
BEGIN
    IF TG_TABLE_NAME !~ '^objectmultiparts' THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    quota_table := regexp_replace(TG_TABLE_NAME, '^objectmultiparts', 'quotausages');
    objectmds_table := regexp_replace(TG_TABLE_NAME, '^objectmultiparts', 'objectmds');

    IF TG_OP = 'DELETE' THEN
        IF NOT bucket_has_strict_quota(OLD.data->>'bucket') THEN
            RETURN OLD;
        END IF;
        IF NOT object_quota_upload_active(objectmds_table, OLD.data->>'obj', OLD.data->>'bucket') THEN
            RETURN OLD;
        END IF;
        SELECT c.bytes, c.objects INTO old_bytes, old_objects
        FROM objectmultipart_quota_contribution(OLD.data) AS c;
        PERFORM quotausage_apply_delta(
            quota_table, OLD.data->>'bucket', OLD._id, -COALESCE(old_bytes, 0), -COALESCE(old_objects, 0));
        RETURN OLD;
    END IF;

    IF NOT bucket_has_strict_quota(NEW.data->>'bucket') THEN
        RETURN NEW;
    END IF;
    obj_id := NEW.data->>'obj';
    IF NOT object_quota_upload_active(objectmds_table, obj_id, NEW.data->>'bucket') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT c.bytes, c.objects INTO new_bytes, new_objects
        FROM objectmultipart_quota_contribution(NEW.data) AS c;
        PERFORM quotausage_apply_delta(
            quota_table, NEW.data->>'bucket', NEW._id, new_bytes, new_objects);
        RETURN NEW;
    END IF;

    SELECT c.bytes, c.objects INTO old_bytes, old_objects
    FROM objectmultipart_quota_contribution(OLD.data) AS c;
    SELECT c.bytes, c.objects INTO new_bytes, new_objects
    FROM objectmultipart_quota_contribution(NEW.data) AS c;
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
            quota_table, old_bucket, OLD._id, -COALESCE(old_bytes, 0), -COALESCE(old_objects, 0));
        PERFORM quotausage_apply_delta(
            quota_table, new_bucket, NEW._id, new_bytes, new_objects);
    END IF;
    RETURN NEW;
END;
$$;

-- Called after the objectmultiparts table exists. sql_functions load before
-- tables are created, so the trigger cannot be created from this file directly.
-- WHEN watches the fields that change the contribution. The upload lookup and
-- the strict-mode check live in the function, which is replaced on startup.
CREATE OR REPLACE FUNCTION install_objectmultiparts_quota_trigger(objectmultiparts_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF objectmultiparts_table IS NULL OR objectmultiparts_table !~ '^objectmultiparts' THEN
        RAISE EXCEPTION 'install_objectmultiparts_quota_trigger: expected an objectmultiparts table, got %', objectmultiparts_table;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'objectmultiparts_quota_ins'
          AND tgrelid = objectmultiparts_table::regclass
    ) THEN
        EXECUTE format(
            'CREATE TRIGGER objectmultiparts_quota_ins AFTER INSERT ON %I FOR EACH ROW
            WHEN (NEW.data->''create_time'' IS NOT NULL AND NEW.data->''create_time'' <> ''null''::jsonb)
            EXECUTE FUNCTION objectmultiparts_quota_usage_fn()',
            objectmultiparts_table
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'objectmultiparts_quota_upd'
          AND tgrelid = objectmultiparts_table::regclass
    ) THEN
        EXECUTE format(
            'CREATE TRIGGER objectmultiparts_quota_upd AFTER UPDATE ON %I FOR EACH ROW
            WHEN (
                OLD.data->''size''        IS DISTINCT FROM NEW.data->''size''
                OR OLD.data->''deleted''     IS DISTINCT FROM NEW.data->''deleted''
                OR OLD.data->''create_time'' IS DISTINCT FROM NEW.data->''create_time'')
            EXECUTE FUNCTION objectmultiparts_quota_usage_fn()',
            objectmultiparts_table
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'objectmultiparts_quota_del'
          AND tgrelid = objectmultiparts_table::regclass
    ) THEN
        EXECUTE format(
            'CREATE TRIGGER objectmultiparts_quota_del AFTER DELETE ON %I FOR EACH ROW
            WHEN (OLD.data->''create_time'' IS NOT NULL AND OLD.data->''create_time'' <> ''null''::jsonb)
            EXECUTE FUNCTION objectmultiparts_quota_usage_fn()',
            objectmultiparts_table
        );
    END IF;
END;
$$;
