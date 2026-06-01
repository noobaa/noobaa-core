/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const { PersistentLogger } = require('../util/persistent_logger');
const config = require('../../config');
const nb_native = require('../util/nb_native');
const { Glacier } = require('../sdk/glacier');
const native_fs_utils = require('../util/native_fs_utils');
const { is_desired_time, record_current_time } = require('./manage_nsfs_cli_utils');
const dbg = require('../util/debug_module')(__filename);
const notifications_util = require('../util/notifications_util');
const { CONFIG_TYPES } = require('../sdk/config_fs');
const SensitiveString = require('../util/sensitive_string');

async function process_migrations() {
    const fs_context = native_fs_utils.get_process_fs_context();
    const backend = Glacier.getBackend();

    if (
        await backend.low_free_space() ||
        await time_exceeded(fs_context, config.NSFS_GLACIER_MIGRATE_INTERVAL, Glacier.MIGRATE_TIMESTAMP_FILE) ||
        await migrate_log_exceeds_threshold()
    ) {
        await backend.perform(prepare_galcier_fs_context(fs_context), "MIGRATION");
        const timestamp_file_path = path.join(config.NSFS_GLACIER_LOGS_DIR, Glacier.MIGRATE_TIMESTAMP_FILE);
        await record_current_time(fs_context, timestamp_file_path);
    }
}

async function process_restores(config_fs) {
    const fs_context = native_fs_utils.get_process_fs_context();
    const backend = Glacier.getBackend();

    if (
        await backend.low_free_space() ||
        !(await time_exceeded(fs_context, config.NSFS_GLACIER_RESTORE_INTERVAL, Glacier.RESTORE_TIMESTAMP_FILE))
    ) return;

    let notification_logger;
    try {
        if (config_fs && config.NOTIFICATION_LOG_DIR) {
            const bucket_path_map = await build_bucket_path_map(config_fs);
            if (bucket_path_map.size > 0) {
                notification_logger = notifications_util.get_notification_logger('SHARED');
                backend.on_restore_complete = async (entry_path, expires_on, storage_class) => {
                    await handle_restore_notification(
                        entry_path, expires_on, storage_class,
                        bucket_path_map, notification_logger
                    );
                };
            }
        }

        await backend.perform(prepare_galcier_fs_context(fs_context), "RESTORE");
    } finally {
        backend.on_restore_complete = null;
        if (notification_logger) await notification_logger.close();
    }

    const timestamp_file_path = path.join(config.NSFS_GLACIER_LOGS_DIR, Glacier.RESTORE_TIMESTAMP_FILE);
    await record_current_time(fs_context, timestamp_file_path);
}

async function process_expiry() {
    const fs_context = native_fs_utils.get_process_fs_context();
    const backend = Glacier.getBackend();
    const timestamp_file_path = path.join(config.NSFS_GLACIER_LOGS_DIR, Glacier.EXPIRY_TIMESTAMP_FILE);
    if (
        await backend.low_free_space() ||
        await is_desired_time(
            fs_context,
            new Date(),
            config.NSFS_GLACIER_EXPIRY_RUN_TIME,
            config.NSFS_GLACIER_EXPIRY_RUN_DELAY_LIMIT_MINS,
            timestamp_file_path,
            config.NSFS_GLACIER_EXPIRY_TZ
        )
    ) {
        await backend.perform(prepare_galcier_fs_context(fs_context), "EXPIRY");
        await record_current_time(fs_context, timestamp_file_path);
    }
}

async function process_reclaim() {
    const fs_context = native_fs_utils.get_process_fs_context();
    const backend = Glacier.getBackend();

    if (
        await backend.low_free_space() ||
        !(await time_exceeded(fs_context, config.NSFS_GLACIER_RECLAIM_INTERVAL, Glacier.RECLAIM_TIMESTAMP_FILE))
    ) return;

    await backend.perform(prepare_galcier_fs_context(fs_context), "RECLAIM");
    const timestamp_file_path = path.join(config.NSFS_GLACIER_LOGS_DIR, Glacier.RECLAIM_TIMESTAMP_FILE);
    await record_current_time(fs_context, timestamp_file_path);
}

/**
 * time_exceeded returns true if the time between last run recorded in the given
 * timestamp_file and now is greater than the given interval.
 * @param {nb.NativeFSContext} fs_context 
 * @param {number} interval 
 * @param {string} timestamp_file 
 * @returns {Promise<boolean>}
 */
async function time_exceeded(fs_context, interval, timestamp_file) {
    try {
        const { data } = await nb_native().fs.readFile(fs_context, path.join(config.NSFS_GLACIER_LOGS_DIR, timestamp_file));
        const lastrun = new Date(data.toString());

        if (lastrun.getTime() + interval < Date.now()) return true;
    } catch (error) {
        console.error('failed to read last run timestamp:', error, 'timestamp_file:', timestamp_file);
        if (error.code === 'ENOENT') return true;

        throw error;
    }

    return false;
}

/**
 * migrate_log_exceeds_threshold returns true if the underlying backend
 * decides that the migrate log size has exceeded the given size threshold.
 * @param {number} [threshold]
 * @returns {Promise<boolean>}
 */
async function migrate_log_exceeds_threshold(threshold = config.NSFS_GLACIER_MIGRATE_LOG_THRESHOLD) {
    const log = new PersistentLogger(config.NSFS_GLACIER_LOGS_DIR, Glacier.MIGRATE_WAL_NAME, { locking: null });
    let log_size = Number.MAX_SAFE_INTEGER;
    try {
        const fh = await log._open();

        const { size } = await fh.stat(log.fs_context);
        log_size = size;
    } catch (error) {
        console.error("failed to get size of", Glacier.MIGRATE_WAL_NAME, error);
    }

    return log_size > threshold;
}

/**
 * prepare_galcier_fs_context returns a shallow copy of given
 * fs_context with backend set to 'GPFS'.
 *
 * NOTE: The function will throw error if it detects that libgfs
 * isn't loaded.
 *
 * @param {nb.NativeFSContext} fs_context
 * @returns {nb.NativeFSContext}
 */
function prepare_galcier_fs_context(fs_context) {
    if (config.NSFS_GLACIER_DMAPI_ENABLE) {
        if (!nb_native().fs.gpfs) {
            throw new Error('cannot use DMAPI xattrs: libgpfs not loaded');
        }

        return { ...fs_context, backend: 'GPFS', use_dmapi: true };
    }

    return { ...fs_context };
}

/**
 * @param {import('../sdk/config_fs').ConfigFS} config_fs
 * @returns {Promise<Map<string, Object>>}
 */
async function build_bucket_path_map(config_fs) {
    const map = new Map();
    try {
        const bucket_names = await config_fs.list_buckets();
        for (const bucket_name of bucket_names) {
            try {
                const bucket_config = await config_fs.get_bucket_by_name(bucket_name, { silent_if_missing: true });
                if (!bucket_config || !bucket_config.notifications) continue;

                const has_restore_notif = bucket_config.notifications.some(notif =>
                    !notif.event || notif.event.some(e => e.includes('ObjectRestore'))
                );
                if (!has_restore_notif) continue;

                try {
                    const account = await config_fs.get_identity_by_id(
                        bucket_config.owner_account, CONFIG_TYPES.ACCOUNT, { silent_if_missing: true }
                    );
                    if (account) {
                        bucket_config.bucket_owner = new SensitiveString(account.name);
                    }
                } catch (err) {
                    dbg.warn('build_bucket_path_map: failed to resolve owner for bucket', bucket_name, err);
                }

                const normalized = path.resolve(bucket_config.path) + path.sep;
                map.set(normalized, bucket_config);
            } catch (err) {
                dbg.warn('build_bucket_path_map: failed to load config for bucket', bucket_name, err);
            }
        }
    } catch (err) {
        dbg.error('build_bucket_path_map: failed to list buckets', err);
    }
    return map;
}

/**
 * @param {string} entry_path
 * @param {Map<string, Object>} bucket_path_map
 * @returns {{ bucket_config: Object, object_key: string } | null}
 */
function resolve_bucket_from_path(entry_path, bucket_path_map) {
    const resolved = path.resolve(entry_path);
    for (const [bucket_path, bucket_config] of bucket_path_map) {
        if (resolved.startsWith(bucket_path)) {
            const object_key = resolved.substring(bucket_path.length);
            return { bucket_config, object_key };
        }
    }
    return null;
}

/**
 * @param {string} entry_path
 * @param {Date} expires_on
 * @param {string} storage_class
 * @param {Map<string, Object>} bucket_path_map
 * @param {import('../util/persistent_logger').PersistentLogger} notification_logger
 */
async function handle_restore_notification(entry_path, expires_on, storage_class, bucket_path_map, notification_logger) {
    try {
        const resolved = resolve_bucket_from_path(entry_path, bucket_path_map);
        if (!resolved) return;

        const { bucket_config, object_key } = resolved;
        const mock_req = {
            op_name: 'post_object_restore',
            s3_event_method: 'Completed',
        };

        for (const notif_conf of bucket_config.notifications) {
            if (notifications_util.check_notif_relevant(notif_conf, mock_req)) {
                const notif = notifications_util.compose_notification_restore(
                    { key: object_key, expires_on, storage_class },
                    notif_conf,
                    bucket_config,
                    { nsfs_system: true }
                );
                await notification_logger.append(JSON.stringify(notif));
            }
        }
    } catch (err) {
        dbg.warn('handle_restore_notification: failed for', entry_path, err);
    }
}

exports.process_migrations = process_migrations;
exports.process_restores = process_restores;
exports.process_expiry = process_expiry;
exports.process_reclaim = process_reclaim;
