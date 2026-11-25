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
-- The trigger function is created by install_quota_functions, with the sibling
-- objectmds table and the quotausages table fixed in the body (objectmultiparts_foo
-- reads objectmds_foo and writes quotausages_foo). A part whose byte delta is 0
-- returns before that parent lookup.

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

-- Called after the objectmultiparts table exists. sql_functions load before
-- tables are created, so the trigger cannot be created from this file directly.
-- install_quota_functions must already have created the trigger function.
-- WHEN watches the fields that change the contribution.
-- lock_timeout keeps CREATE TRIGGER from waiting out a long transaction and
-- then blocking writes queued behind that lock.
CREATE OR REPLACE FUNCTION install_objectmultiparts_quota_trigger(objectmultiparts_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    fn text := regexp_replace(objectmultiparts_table, '^objectmultiparts', 'objectmultiparts_quota_usage_fn');
BEGIN
    IF objectmultiparts_table IS NULL OR objectmultiparts_table !~ '^objectmultiparts' THEN
        RAISE EXCEPTION 'install_objectmultiparts_quota_trigger: expected an objectmultiparts table, got %', objectmultiparts_table;
    END IF;

    SET LOCAL lock_timeout = '2s';

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'objectmultiparts_quota_ins'
          AND tgrelid = objectmultiparts_table::regclass
    ) THEN
        EXECUTE format(
            'CREATE TRIGGER objectmultiparts_quota_ins AFTER INSERT ON %I FOR EACH ROW
            WHEN ((NEW.data->''triggers'' ? ''quota'')
            AND (NEW.data->''size'' IS NOT NULL)
            AND (NEW.data->''create_time'' IS NOT NULL AND NEW.data->''create_time'' <> ''null''::jsonb))
            EXECUTE FUNCTION %I()',
            objectmultiparts_table, fn
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
            WHEN ((NEW.data->''triggers'' ? ''quota'') AND
                (OLD.data->''size''        IS DISTINCT FROM NEW.data->''size''
                OR OLD.data->''deleted''     IS DISTINCT FROM NEW.data->''deleted''
                OR OLD.data->''create_time'' IS DISTINCT FROM NEW.data->''create_time''))
            EXECUTE FUNCTION %I()',
            objectmultiparts_table, fn
        );
    END IF;
END;
$$;
