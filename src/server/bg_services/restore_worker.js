/* Copyright (C) 2026 NooBaa */
'use strict';

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('../object_services/md_store').MDStore;
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const auth_server = require('../common_services/auth_server');
const deep_archive_utils = require('../../util/deep_archive_utils');
const P = require('../../util/promise');

class RestoreWorker {

    constructor({ name, client }) {
        this.name = name;
        this.client = client;
        this.marker = undefined;
    }

    async run_batch() {
        if (!this._can_run()) return;

        const { ongoing_objects, marker } = await MDStore.instance().find_objects_restore_status_ongoing(
            config.RESTORE_WORKER_BATCH_SIZE, this.marker);

        if (!ongoing_objects || ongoing_objects.length === 0) {
            this.marker = undefined;
            dbg.log0('RestoreWorker: no objects with restore_status.ongoing');
            return config.RESTORE_WORKER_EMPTY_DELAY;
        }

        const next_marker = ongoing_objects.length === config.RESTORE_WORKER_BATCH_SIZE ? marker : undefined;

        dbg.log0('RestoreWorker: checking restore status for objects:',
            ongoing_objects.map(o => o.key).join(', '));

        const { has_errors } = await this._handle_ongoing_restores(ongoing_objects);

        if (has_errors) {
            return config.RESTORE_WORKER_ERROR_DELAY;
        }
        this.marker = next_marker;
        return next_marker ? config.RESTORE_WORKER_BATCH_DELAY : config.RESTORE_WORKER_EMPTY_DELAY;
    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('RestoreWorker: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    async _handle_ongoing_restores(ongoing_objects) {
        const system = system_store.data.systems[0];
        const auth_token = auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin',
        });

        let has_errors = false;
        await P.map_with_concurrency(config.RESTORE_WORKER_CONCURRENCY, ongoing_objects, async obj => {
            try {
                await this._handle_object_restore(obj, auth_token);
            } catch (err) {
                dbg.error(`RestoreWorker: failed handling object ${obj.key} ${obj._id}:`, err);
                has_errors = true;
            }
        });

        return { has_errors };
    }

    async _handle_object_restore(obj, auth_token) {
        const bucket = system_store.data.get_by_id(obj.bucket);
        if (!deep_archive_utils.is_remote_archive_object(obj, bucket)) {
            dbg.warn('RestoreWorker: skipping non-remote-archive object', obj.key, obj._id, obj.storage_class);
            return;
        }

        const { is_restored, size } = await this.client.archive.check_archive_restore_status(
            { bucket_id: obj.bucket, obj_id: obj._id }, { auth_token });

        if (is_restored) {
            const log_details = { key: obj.key, obj_id: String(obj._id), bucket: bucket.name.unwrap(), size };
            if (size > config.RESTORE_WORKER_LARGE_OBJECT_SIZE) {
                // temporary behavior (logs only) — later: use MPU for large objects.
                dbg.log0('RestoreWorker: large object restored on deep archive', log_details);
            } else {
                // temporary behavior (logs only) — later: GetObject, write STANDARD, update MD expiry.
                dbg.log0('RestoreWorker: object restored on deep archive', log_details);
            }
            return;
        }

        dbg.log1('RestoreWorker: restore still ongoing', obj.key, String(obj._id));
    }

}

exports.RestoreWorker = RestoreWorker;
