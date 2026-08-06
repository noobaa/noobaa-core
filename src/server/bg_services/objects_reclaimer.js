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
     * Orchestrates reclaim paths and returns the delay until the next run.
     */
    async run_batch() {
        if (!this._can_run()) return;

        const results = [
            await this.reclaim_deleted_objects(),
            await this.reclaim_expired_restores(),
            await this.reclaim_transition_source_data(),
        ];
        return this._next_delay(results);
    }

    /**
     * Reclaim unreclaimed deleted objects:
     * - STANDARD / tiering: map_deleter, then mark reclaimed.
     * - Remote archive with restore_status: full map_deleter (local restore copy),
     *   then delete remote keys and mark reclaimed.
     * - Remote archive without restore_status but with target_data_info.upload_id
     *   (archive MPU create/abort/complete): soft-delete multiparts only, then
     *   delete remote keys and mark reclaimed.
     *   Mapping cleanup must succeed before enqueue so we do not mark reclaimed
     *   while restore copies may still remain.
     * @returns {Promise<{ had_work: boolean, had_errors: boolean }>}
     */
    async reclaim_deleted_objects() {
        const unreclaimed_objects = await MDStore.instance().find_unreclaimed_objects(config.OBJECT_RECLAIMER_BATCH_SIZE);
        if (!unreclaimed_objects || !unreclaimed_objects.length) {
            dbg.log0('no objects in "unreclaimed" state. nothing to do');
            return { had_work: false, had_errors: false };
        }

        let had_errors = false;
        dbg.log0('object_reclaimer: starting batch work on objects: ', unreclaimed_objects.map(o => o.key).join(', '));
        const reclaimed_objects_ids = [];
        /** @type {{ [bucket_id: string]: object[] }} */
        const pending_archive_deletes_by_bucket = {};

        await P.all(unreclaimed_objects.map(async obj => {
            try {
                const bucket = system_store.data.get_by_id(obj.bucket);
                const is_remote_data = deep_archive_utils.is_remote_archive_object(obj, bucket);
                const should_delete_mappings = is_remote_data ? Boolean(obj.restore_status) : true;
                const is_md_only_multipart_upload = Boolean(obj.target_data_info?.upload_id);
                const should_delete_md_only_multiparts = is_remote_data && !should_delete_mappings && is_md_only_multipart_upload;
                if (should_delete_mappings) {
                    await map_deleter.delete_object_mappings(obj);
                } else if (should_delete_md_only_multiparts) {
                    await map_deleter.delete_object_multiparts(obj);
                }
                if (is_remote_data) {
                    const bucket_id = String(obj.bucket);
                    (pending_archive_deletes_by_bucket[bucket_id] ??= []).push(obj);
                    return;
                }
                reclaimed_objects_ids.push(obj._id);
            } catch (err) {
                dbg.error(`got error when trying to delete object ${obj.key} mappings :`, err);
                had_errors = true;
            }
        }));

        if (Object.keys(pending_archive_deletes_by_bucket).length) {
            const archive_result = await this._delete_archived_objects(pending_archive_deletes_by_bucket);
            reclaimed_objects_ids.push(...archive_result.reclaimed_ids);
            had_errors = had_errors || archive_result.has_errors;
        }

        await MDStore.instance().update_objects_by_ids(reclaimed_objects_ids, { reclaimed: new Date() });

        return { had_work: true, had_errors };
    }

    /**
     * Purge STANDARD restore copies past restore_status.expiry_time and clear
     * restore_status. Does not soft-delete the object or delete archive keys.
     *
     * Delete mappings first so a failed cleanup stays retryable (restore_status
     * still expired). RestoreObject is blocked while expired restore_status
     * remains (see update_object_md), so unset after delete is safe.
     * @returns {Promise<{ had_work: boolean, had_errors: boolean }>}
     */
    async reclaim_expired_restores() {
        const batch_size = config.OBJECT_RECLAIMER_EXPIRE_RESTORE_BATCH_SIZE;
        const expired_restores = await MDStore.instance().find_expired_restore_objects(batch_size);
        if (!expired_restores || !expired_restores.length) {
            dbg.log0('no expired restore objects. nothing to do');
            return { had_work: false, had_errors: false };
        }

        let had_errors = false;
        dbg.log0('object_reclaimer: reclaiming expired restores:',
            expired_restores.map(o => o.key).join(', '));

        await P.all(expired_restores.map(async obj => {
            try {
                await map_deleter.delete_object_mappings_for_expired_restore_or_transition(obj);
                await MDStore.instance().update_object_by_id(obj._id, undefined, { restore_status: 1 });
            } catch (err) {
                dbg.error(`got error when reclaiming expired restore for object ${obj.key}:`, err);
                had_errors = true;
            }
        }));

        return { had_work: true, had_errors };
    }

    /**
     * Purge source storage-class copies after transition and set
     * transition_info.source_info.reclaimed so the object leaves the unreclaimed find/index.
     *
     * Delete mappings first so a failed cleanup stays retryable. RestoreObject is
     * blocked while unreclaimed source data remains, so marking reclaimed
     * after delete is safe.
     * @returns {Promise<{ had_work: boolean, had_errors: boolean }>}
     */
    async reclaim_transition_source_data() {
        const batch_size = config.OBJECT_RECLAIMER_TRANSITION_SOURCE_BATCH_SIZE;
        const unreclaimed_transitions_sources = await MDStore.instance().find_objects_with_transition_done_unreclaimed_source(batch_size);
        if (!unreclaimed_transitions_sources || !unreclaimed_transitions_sources.length) {
            dbg.log0('no unreclaimed transition source objects. nothing to do');
            return { had_work: false, had_errors: false };
        }

        let had_errors = false;
        dbg.log0('object_reclaimer: reclaiming transition source data for:',
            unreclaimed_transitions_sources.map(o => o.key).join(', '));

        await P.all(unreclaimed_transitions_sources.map(async obj => {
            try {
                // Skip if a restore appeared after the find (query already requires restore_status: null).
                if (obj.restore_status) {
                    dbg.log0('object_reclaimer: skip transition reclaim while restore_status set:',
                        obj.key);
                    return;
                }
                await map_deleter.delete_object_mappings_for_expired_restore_or_transition(obj);
                await MDStore.instance().update_object_by_id(
                    obj._id,
                    { 'transition_info.source_info.reclaimed': new Date() },
                );
            } catch (err) {
                dbg.error(`got error when reclaiming transition source data for object ${obj.key}:`, err);
                had_errors = true;
            }
        }));

        return { had_work: true, had_errors };
    }

    /**
     * @param {Array<{ had_work: boolean, had_errors: boolean }>} results
     * @returns {number}
     */
    _next_delay(results) {
        if (results.some(r => r.had_errors)) {
            return config.OBJECT_RECLAIMER_ERROR_DELAY;
        }
        if (results.some(r => r.had_work)) {
            return config.OBJECT_RECLAIMER_BATCH_DELAY;
        }
        return config.OBJECT_RECLAIMER_EMPTY_DELAY;
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
