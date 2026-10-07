/* Copyright (C) 2026 NooBaa */
'use strict';

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('../object_services/md_store').MDStore;
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const map_deleter = require('../object_services/map_deleter');
const P = require('../../util/promise');

class LifecycleReclaimer {

    constructor({ name }) {
        this.name = name;
    }

    /**
     * Reclaims expired restore copies and transition source data,
     * and returns the delay until the next run.
     */
    async run_batch() {
        if (!this._can_run()) return;

        const results = [
            await this.reclaim_expired_restores(),
            await this.reclaim_transition_source_data(),
        ];
        return this._next_delay(results);
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
        const batch_size = config.LIFECYCLE_RECLAIMER_EXPIRE_RESTORE_BATCH_SIZE;
        let expired_restores;
        try {
            expired_restores = await MDStore.instance().find_expired_restore_objects(batch_size);
        } catch (err) {
            dbg.error('lifecycle_reclaimer: failed finding expired restore objects:', err);
            return { had_work: false, had_errors: true };
        }
        if (!expired_restores || !expired_restores.length) {
            dbg.log0('no expired restore objects. nothing to do');
            return { had_work: false, had_errors: false };
        }

        let had_errors = false;
        dbg.log0('lifecycle_reclaimer: reclaiming expired restores, count:', expired_restores.length);
        dbg.log1('lifecycle_reclaimer: reclaiming expired restores:', expired_restores.map(o => o.key).join(', '));

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
        const batch_size = config.LIFECYCLE_RECLAIMER_TRANSITION_SOURCE_BATCH_SIZE;
        let unreclaimed_transitions_sources;
        try {
            unreclaimed_transitions_sources = await MDStore.instance().find_objects_with_transition_done_unreclaimed_source(batch_size);
        } catch (err) {
            dbg.error('lifecycle_reclaimer: failed finding unreclaimed transition sources:', err);
            return { had_work: false, had_errors: true };
        }
        if (!unreclaimed_transitions_sources || !unreclaimed_transitions_sources.length) {
            dbg.log0('no unreclaimed transition source objects. nothing to do');
            return { had_work: false, had_errors: false };
        }

        let had_errors = false;
        dbg.log0('lifecycle_reclaimer: reclaiming transition source data, count:', unreclaimed_transitions_sources.length);
        dbg.log1('lifecycle_reclaimer: reclaiming transition source data for:', unreclaimed_transitions_sources.map(o => o.key).join(', '));

        await P.all(unreclaimed_transitions_sources.map(async obj => {
            try {
                // Skip if a restore appeared after the find (query already requires restore_status: null).
                if (obj.restore_status) {
                    dbg.log1('lifecycle_reclaimer: skip transition reclaim while restore_status set:', obj.key);
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
            return config.LIFECYCLE_RECLAIMER_ERROR_DELAY;
        }
        if (results.some(r => r.had_work)) {
            return config.LIFECYCLE_RECLAIMER_BATCH_DELAY;
        }
        return config.LIFECYCLE_RECLAIMER_EMPTY_DELAY;
    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('LifecycleReclaimer: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }
}

exports.LifecycleReclaimer = LifecycleReclaimer;
