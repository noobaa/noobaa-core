/* Copyright (C) 2016 NooBaa */
'use strict';

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('../object_services/md_store').MDStore;
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const map_deleter = require('../object_services/map_deleter');
const auth_server = require('../common_services/auth_server');
const deep_archive_utils = require('../../util/deep_archive_utils');
const P = require('../../util/promise');

class ObjectsReclaimer {

    constructor({ name, client }) {
        this.name = name;
        this.client = client;
    }

    /**
     * Reclaim unreclaimed deleted objects:
     * - STANDARD / tiering: map_deleter, then mark reclaimed.
     * - Remote archive (archive SC + bucket archive_policy): map_deleter only if
     *   restore_status is set, then delete remote keys and mark reclaimed.
     *   map_deleter must succeed before the object is queued for remote delete;
     *   if mapping cleanup throws, we skip enqueue so the object is not marked
     *   reclaimed while restore copies may still remain.
     */
    async run_batch() {
        if (!this._can_run()) return;

        const unreclaimed_objects = await MDStore.instance().find_unreclaimed_objects(config.OBJECT_RECLAIMER_BATCH_SIZE);
        if (!unreclaimed_objects || !unreclaimed_objects.length) {
            dbg.log0('no objects in "unreclaimed" state. nothing to do');
            return config.OBJECT_RECLAIMER_EMPTY_DELAY;
        }

        let has_errors = false;
        dbg.log0('object_reclaimer: starting batch work on objects: ', unreclaimed_objects.map(o => o.key).join(', '));
        const reclaimed_objects_ids = [];
        /** @type {{ [bucket_id: string]: object[] }} */
        const pending_archive_deletes_by_bucket = {};

        await P.all(unreclaimed_objects.map(async obj => {
            try {
                const bucket = system_store.data.get_by_id(obj.bucket);
                const is_remote_archive = deep_archive_utils.is_remote_archive_object(obj, bucket);
                const should_delete_mappings = is_remote_archive ? Boolean(obj.restore_status) : true;
                if (should_delete_mappings) {
                    await map_deleter.delete_object_mappings(obj);
                }
                if (is_remote_archive) {
                    const bucket_id = String(obj.bucket);
                    (pending_archive_deletes_by_bucket[bucket_id] ??= []).push(obj);
                    return;
                }
                reclaimed_objects_ids.push(obj._id);
            } catch (err) {
                dbg.error(`got error when trying to delete object ${obj.key} mappings :`, err);
                has_errors = true;
            }
        }));

        if (Object.keys(pending_archive_deletes_by_bucket).length) {
            const archive_result = await this._delete_archived_objects(pending_archive_deletes_by_bucket);
            reclaimed_objects_ids.push(...archive_result.reclaimed_ids);
            has_errors = has_errors || archive_result.has_errors;
        }

        await MDStore.instance().update_objects_by_ids(reclaimed_objects_ids, { reclaimed: new Date() });

        if (has_errors) {
            return config.OBJECT_RECLAIMER_ERROR_DELAY;
        }
        return config.OBJECT_RECLAIMER_BATCH_DELAY;
    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('ObjectsReclaimer: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    ////////////////////////
    // DEEP ARCHIVE UTILS //
    ////////////////////////

    /**
     * Per bucket, deletes archive keys via archive_api.
     * @param {{ [bucket_id: string]: object[] }} pending_archive_deletes_by_bucket
     * @returns {Promise<{ reclaimed_ids: object[], has_errors: boolean }>}
     */
    async _delete_archived_objects(pending_archive_deletes_by_bucket) {
        const system = system_store.data.systems[0];
        const auth_token = auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin',
        });
        const reclaimed_ids = [];
        let has_errors = false;

        await P.all(Object.entries(pending_archive_deletes_by_bucket).map(async ([bucket_id, objects]) => {
            try {
                const objects_to_delete = objects.map(obj => ({ obj_id: obj._id, key: obj.key }));
                const result = await this.client.archive.delete_archive_objects({ bucket_id, objects: objects_to_delete }, { auth_token });
                reclaimed_ids.push(...result.reclaimed_ids);
                has_errors = has_errors || result.has_errors;
            } catch (err) {
                dbg.error(`failed deleting archived objects for bucket ${bucket_id}:`, err);
                has_errors = true;
            }
        }));

        return { reclaimed_ids, has_errors };
    }

}


exports.ObjectsReclaimer = ObjectsReclaimer;
