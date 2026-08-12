/* Copyright (C) 2026 NooBaa */
'use strict';

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('../object_services/md_store').MDStore;
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const auth_server = require('../common_services/auth_server');
const server_rpc = require('../server_rpc');
const deep_archive_utils = require('../../util/deep_archive_utils');
const { destroy_source_stream } = require('../../util/object_utils');
const ObjectIO = require('../../sdk/object_io');
const map_deleter = require('../object_services/map_deleter');
const archive_server = require('./archive_server');
const P = require('../../util/promise');

class RestoreWorker {

    /**
     * @param {{ name: string }} params
     */
    constructor({ name }) {
        this.name = name;
        this.marker = undefined;
        this.object_io = new ObjectIO(); // for writing STANDARD restore copies
    }

    /**
     * Polls objects with restore_status.ongoing and completes restores whose
     * archive copy is ready by writing a temporary STANDARD copy and updating MD
     * @returns {Promise<number|undefined>} Delay in ms until the next batch
     */
    async run_batch() {
        if (!this._can_run()) return;
        if (!this._has_archive_policy_bucket()) {
            dbg.log0('RestoreWorker: no buckets with archive policy');
            this.marker = undefined;
            return config.RESTORE_WORKER_INACTIVE_DELAY;
        }

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

    /**
     * True when system_store is loaded and the system is not in maintenance
     * @returns {boolean}
     */
    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('RestoreWorker: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    /**
     * True when there is at least one non deleting bucket with archive policy
     * @returns {boolean}
     */
    _has_archive_policy_bucket() {
        return system_store.data.buckets.some(bucket =>
            !bucket.deleting && Boolean(bucket.archive_policy?.deep_archive_resource));
    }

    /**
     * Builds one admin rpc_client for the batch and handles each ongoing object
     * @param {nb.ObjectMD[]} ongoing_objects
     * @returns {Promise<{ has_errors: boolean }>}
     */
    async _handle_ongoing_restores(ongoing_objects) {
        const system = system_store.data.systems[0];
        const auth_token = auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin',
        });
        const rpc_client = server_rpc.rpc.new_client({ auth_token });

        let has_errors = false;
        await P.map_with_concurrency(config.RESTORE_WORKER_CONCURRENCY, ongoing_objects, async obj => {
            try {
                await this._handle_object_restore(obj, rpc_client);
            } catch (err) {
                dbg.error(`RestoreWorker: failed handling object ${obj.key} ${obj._id}:`, err);
                has_errors = true;
            }
        });

        return { has_errors };
    }

    /**
     * Checks archive restore status and writes the STANDARD restore copy when ready
     * @param {nb.ObjectMD} obj
     * @param {nb.APIClient} rpc_client
     */
    async _handle_object_restore(obj, rpc_client) {
        const bucket = system_store.data.get_by_id(obj.bucket);
        if (!deep_archive_utils.is_remote_archive_object(obj, bucket)) {
            dbg.warn('RestoreWorker: skipping non-remote-archive object', obj.key, obj._id, obj.storage_class);
            return;
        }

        const { is_restored, size } = await rpc_client.archive.check_archive_restore_status(
            { bucket_id: obj.bucket, obj_id: obj._id });

        if (!is_restored) {
            dbg.log1('RestoreWorker: restore still ongoing', obj.key, String(obj._id));
            return;
        }

        const log_details = { key: obj.key, obj_id: String(obj._id), bucket: bucket.name.unwrap(), size };
        dbg.log0('RestoreWorker: object restored on deep archive, writing STANDARD copy', log_details);
        await this._write_standard_restore_copy(obj, bucket, size, rpc_client);
    }

    /**
     * Writes a temporary STANDARD restore copy from archive when needed, then sets restore_status to ongoing false with expiry_time
     * @param {nb.ObjectMD} obj
     * @param {nb.Bucket} bucket
     * @param {number} size
     * @param {nb.APIClient} rpc_client
     */
    async _write_standard_restore_copy(obj, bucket, size, rpc_client) {
        dbg.log0('RestoreWorker: starting STANDARD restore copy write',
            { key: obj.key, obj_id: String(obj._id), bucket: bucket.name.unwrap(), size });
        const { days, bucket_name, object_size, restore_copy_layout } = await this._prepare_restore_copy(obj, bucket, size);

        if (!restore_copy_layout.is_complete) {
            const is_small_object = object_size <= config.RESTORE_WORKER_LARGE_OBJECT_SIZE;
            const starting_from_byte_zero = restore_copy_layout.mapped_end_offset === 0;
            await this._upload_restore_copy(obj, bucket_name, object_size, rpc_client, restore_copy_layout.mapped_end_offset,
                { full_archive_read: is_small_object && starting_from_byte_zero });
        }
        await this._finalize_restore_copy(obj, bucket_name, days, rpc_client);
    }

    /**
     * Validates restore days and size, checks restore-copy part layout, and clears invalid layouts
     * @param {nb.ObjectMD} obj
     * @param {nb.Bucket} bucket
     * @param {number} size
     * @returns {Promise<{ days: number, bucket_name: string, object_size: number, restore_copy_layout: { is_complete: boolean, mapped_end_offset: number, must_clear_parts: boolean } }>}
     */
    async _prepare_restore_copy(obj, bucket, size) {
        const days = obj.restore_status?.days;
        if (days === undefined || !Number.isInteger(days) || days < 1) {
            throw new Error(`RestoreWorker: missing restore_status.days for object ${obj.key} ${obj._id}`);
        }

        const object_size = size ?? obj.size;
        if (!(object_size >= 0)) {
            throw new Error(`RestoreWorker: invalid object size for ${obj.key} ${obj._id}`);
        }

        const bucket_name = bucket.name.unwrap();
        let restore_copy_layout = await this._get_restore_copy_layout(obj, object_size);

        if (restore_copy_layout.must_clear_parts) {
            dbg.log0('RestoreWorker: invalid restore-copy part layout detected, clearing before rewrite',
                { key: obj.key, obj_id: String(obj._id), bucket: bucket_name });
            await this._clear_restore_copy_parts(obj, bucket_name);
            restore_copy_layout = { is_complete: false, mapped_end_offset: 0, must_clear_parts: false };
        }
        if (restore_copy_layout.is_complete) {
            dbg.log0('RestoreWorker: restore copy already complete, skipping archive read and upload',
                { key: obj.key, obj_id: String(obj._id), bucket: bucket_name, size: object_size });
        }
        return { days, bucket_name, object_size, restore_copy_layout };
    }

    /**
     * Sets restore_status to ongoing false with expiry_time after a successful restore copy
     * @param {nb.ObjectMD} obj
     * @param {string} bucket_name
     * @param {number} days
     * @param {nb.APIClient} rpc_client
     */
    async _finalize_restore_copy(obj, bucket_name, days, rpc_client) {
        const expires_on = deep_archive_utils.compute_restore_expiry(days);
        dbg.log0('RestoreWorker: updating restore_status',
            { key: obj.key, obj_id: String(obj._id), bucket: bucket_name, expiry_time: expires_on });
        await this._update_restore_status(rpc_client, { bucket_name, key: obj.key, obj_id: obj._id, expires_on });
    }

    /**
     * Returns restore-copy part layout from byte 0 and whether parts must be cleared before resume
     * (overlapping mappings, missing bytes from 0 or holes in the middle, invalid part ranges, or extra parts after full mapping)
     * @param {nb.ObjectMD} obj
     * @param {number} object_size
     * @returns {Promise<{ is_complete: boolean, mapped_end_offset: number, must_clear_parts: boolean }>}
     */
    async _get_restore_copy_layout(obj, object_size) {
        if (object_size === 0) {
            const has_parts = await MDStore.instance().has_any_parts_for_object(obj);
            return { is_complete: !has_parts, mapped_end_offset: 0, must_clear_parts: has_parts };
        }
        const parts = await MDStore.instance().find_parts_sorted_by_start({ obj_id: obj._id });
        if (!parts.length) {
            return { is_complete: false, mapped_end_offset: 0, must_clear_parts: false };
        }

        // Parts are sorted by start; walk parts and track mapped range [0, mapped_end_offset).
        let mapped_end_offset = 0;
        let must_clear_parts = false;
        let fully_mapped_from_zero = false;
        for (const part of parts) {
            if (this._is_invalid_restore_copy_part(part, object_size)) {
                must_clear_parts = true;
                break;
            }
            if (fully_mapped_from_zero) { // extra part after object is already fully mapped from byte 0
                must_clear_parts = true;
                break;
            }
            if (part.start < mapped_end_offset) { // overlap (duplicate parts)
                must_clear_parts = true;
                break;
            }
            if (part.start > mapped_end_offset) { // gap before this part (missing bytes from 0 or hole in the middle)
                must_clear_parts = true;
                break;
            }
            if (part.end > mapped_end_offset) mapped_end_offset = part.end;
            // mapped_end_offset is the exclusive end of [0, mapped_end_offset)
            // when it reaches object_size every byte of the object is mapped
            if (mapped_end_offset >= object_size) fully_mapped_from_zero = true;
        }
        return {
            is_complete: fully_mapped_from_zero && !must_clear_parts,
            mapped_end_offset,
            must_clear_parts,
        };
    }

    /**
     * True when a restore-copy part range is outside the object or not a valid half-open interval
     * @param {{ start: number, end: number }} part
     * @param {number} object_size
     * @returns {boolean}
     */
    _is_invalid_restore_copy_part(part, object_size) {
        return part.start < 0 || part.end <= part.start || part.end > object_size;
    }

    /**
     * Returns a finite strictly positive RESTORE_WORKER_RANGE_SIZE for multi-range archive reads
     * @returns {number}
     */
    _get_restore_range_size() {
        const range_size = config.RESTORE_WORKER_RANGE_SIZE;
        if (!Number.isFinite(range_size) || range_size <= 0) {
            throw new Error(`RestoreWorker: invalid RESTORE_WORKER_RANGE_SIZE ${range_size}`);
        }
        return range_size;
    }

    /**
     * Next part seq when resuming after partial restore-copy progress
     * @param {nb.ObjectMD} obj
     * @param {number} start_offset
     * @returns {Promise<number>}
     */
    async _get_initial_part_seq(obj, start_offset) {
        if (start_offset === 0) return 0;
        return MDStore.instance().find_max_part_seq_for_object(obj._id);
    }

    /**
     * Clears leftover STANDARD restore-copy parts when part layout is not safe to resume
     * Does not delete multiparts so archive MPU multipart MD is preserved
     * @param {nb.ObjectMD} obj
     * @param {string} bucket_name
     */
    async _clear_restore_copy_parts(obj, bucket_name) {
        const has_parts = await MDStore.instance().has_any_parts_for_object(obj);
        if (!has_parts) return;
        dbg.log0('RestoreWorker: clearing restore-copy parts',
            { key: obj.key, obj_id: String(obj._id), bucket: bucket_name });
        await map_deleter.delete_object_parts(obj);
    }

    /**
     * Uploads restore-copy bytes from archive: full stream when starting a small object fresh,
     * one ranged read for the small-object remainder on resume, or by ranges of RESTORE_WORKER_RANGE_SIZE for large objects
     * @param {nb.ObjectMD} obj
     * @param {string} bucket_name
     * @param {number} object_size
     * @param {nb.APIClient} rpc_client
     * @param {number} start_offset
     * @param {{ full_archive_read?: boolean }} [options]
     */
    async _upload_restore_copy(obj, bucket_name, object_size, rpc_client, start_offset, { full_archive_read = false } = {}) {
        if (full_archive_read && start_offset !== 0) {
            throw new Error(`RestoreWorker: full_archive_read requires start_offset 0 for ${obj.key} ${obj._id}`);
        }
        const use_full_archive_read = full_archive_read && start_offset === 0;
        const is_small_object = object_size <= config.RESTORE_WORKER_LARGE_OBJECT_SIZE;
        let archive_read_mode = 'multi_range';
        if (use_full_archive_read) {
            archive_read_mode = 'full';
        } else if (is_small_object) {
            archive_read_mode = 'single_range';
        }
        dbg.log0('RestoreWorker: reading archive for restore copy',
            { key: obj.key, obj_id: String(obj._id), bucket: bucket_name, size: object_size,
                start_offset, archive_read_mode });
        let offset = start_offset;
        let next_seq = await this._get_initial_part_seq(obj, start_offset);
        const uses_multi_range = !(use_full_archive_read || is_small_object);
        const range_size = uses_multi_range ? this._get_restore_range_size() : 0;

        while (offset < object_size) {
            const start = offset;
            const end = uses_multi_range ?
                Math.min(offset + range_size, object_size) :
                object_size;
            const start_seq = next_seq;
            const upload_params = {
                client: rpc_client,
                obj_id: obj._id,
                bucket: bucket_name,
                key: obj.key,
                start,
                end,
                size: end - start,
                seq: start_seq,
            };

            const archive_read_params = { bucket_id: obj.bucket, obj_id: obj._id };
            if (!use_full_archive_read) {
                archive_read_params.start = start;
                archive_read_params.end = end;
            }
            upload_params.source_stream = await archive_server.read_archive_object_stream(archive_read_params);
            try {
                await this.object_io.upload_object_range(upload_params);
            } catch (err) {
                destroy_source_stream({ source_stream: upload_params.source_stream });
                dbg.error('RestoreWorker: failed writing STANDARD restore copy',
                    { key: obj.key, obj_id: String(obj._id), bucket: bucket_name, start, end, seq_start: start_seq }, err);
                throw err;
            }

            next_seq = upload_params.seq;
            dbg.log0('RestoreWorker: uploaded restore copy segment',
                { key: obj.key, obj_id: String(obj._id), bucket: bucket_name, start, end,
                    seq_start: start_seq, seq_next: next_seq, use_full_archive_read });
            offset = end;
            if (!uses_multi_range) break;
        }
    }

    /**
     * Updates restore_status to ongoing false with expiry_time, with short retries
     * @param {nb.APIClient} rpc_client
     * @param {{ bucket_name: string, key: string, obj_id: nb.ID, expires_on: Date }} params
     */
    async _update_restore_status(rpc_client, { bucket_name, key, obj_id, expires_on }) {
        const RESTORE_MD_UPDATE_ATTEMPTS = 3;
        const RESTORE_MD_UPDATE_DELAY_MS = 500;

        await P.retry({
            attempts: RESTORE_MD_UPDATE_ATTEMPTS,
            delay_ms: RESTORE_MD_UPDATE_DELAY_MS,
            func: () => rpc_client.object.update_object_md({
                bucket: bucket_name,
                key,
                obj_id,
                restore_status: {
                    ongoing: false,
                    expiry_time: expires_on.getTime(),
                },
            }),
            error_logger: err => dbg.warn('RestoreWorker: update_object_md failed, retrying',
                { key, obj_id: String(obj_id), bucket: bucket_name }, err),
        });
        dbg.log0('RestoreWorker: restore_status updated',
            { key, obj_id: String(obj_id), bucket: bucket_name, expiry_time: expires_on });
    }

}

exports.RestoreWorker = RestoreWorker;
