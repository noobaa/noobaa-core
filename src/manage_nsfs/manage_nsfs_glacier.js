/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const { PersistentLogger } = require('../util/persistent_logger');
const config = require('../../config');
const nb_native = require('../util/nb_native');
const { Glacier } = require('../sdk/glacier');
const native_fs_utils = require('../util/native_fs_utils');
const { is_desired_time, record_current_time } = require('./manage_nsfs_cli_utils');

async function process_migrations() {
    const fs_context = native_fs_utils.get_process_fs_context();
    const backend = Glacier.getBackend();
    const timestamp_file_path = path.join(config.NSFS_GLACIER_LOGS_DIR, Glacier.MIGRATE_TIMESTAMP_FILE);

    if (await backend.low_free_space()) {
        await backend.perform(prepare_galcier_fs_context(fs_context), "MIGRATION");
        await record_current_time(fs_context, timestamp_file_path);
        return;
    }

    await backend.perform(prepare_galcier_fs_context(fs_context), "MIGRATION", {
        should_run: async () => (
            await interval_time_exceeded(fs_context, config.NSFS_GLACIER_MIGRATE_INTERVAL, Glacier.MIGRATE_TIMESTAMP_FILE) ||
            await migrate_log_exceeds_threshold()
        ),
        on_staged: async () => record_current_time(fs_context, timestamp_file_path),
    });
}

async function process_restores() {
    const fs_context = native_fs_utils.get_process_fs_context();
    const backend = Glacier.getBackend();
    const timestamp_file_path = path.join(config.NSFS_GLACIER_LOGS_DIR, Glacier.RESTORE_TIMESTAMP_FILE);

    if (await backend.low_free_space()) return;

    await backend.perform(prepare_galcier_fs_context(fs_context), "RESTORE", {
        should_run: async () => kickoff_time_exceeded(
            fs_context,
            Glacier.RESTORE_WAL_NAME,
            Glacier.RESTORE_TIMESTAMP_FILE,
            config.NSFS_GLACIER_RESTORE_INTERVAL,
            config.NSFS_GLACIER_RESTORE_MIN_INTERVAL,
        ),
        on_staged: async () => record_current_time(fs_context, timestamp_file_path),
    });
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
        !(await interval_time_exceeded(fs_context, config.NSFS_GLACIER_RECLAIM_INTERVAL, Glacier.RECLAIM_TIMESTAMP_FILE))
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
async function interval_time_exceeded(fs_context, interval, timestamp_file) {
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
    let fh;
    try {
        fh = await log._open();
        const { size } = await fh.stat(log.fs_context);
        log_size = size;
    } catch (error) {
        console.error("failed to get size of", Glacier.MIGRATE_WAL_NAME, error);
    } finally {
        if (fh) await fh.close(log.fs_context);
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
 * kickoff_time_exceeded decides whether the restore task should run. It returns
 * true if EITHER of the following holds:
 *
 * 1. Quiet period (min_time): no new entries have been appended to the active
 * WAL for at least `min_time` ms (i.e. the active log's mtime is older than
 * `min_time`). This lets a settled batch of requests be processed promptly
 * instead of waiting for the full `max_time` interval.
 *
 * 2. Periodic bound (max_time): at least `max_time` ms have elapsed since the
 * last run recorded in `timestamp_file`. This guarantees that all pending
 * entries - including any left over in inactive or failure logs from a
 * previous (possibly failed) run - are eventually drained, and it rate-limits
 * retries so a persistently failing batch is not reprocessed every tick.
 *
 * @param {nb.NativeFSContext} fs_context
 * @param {string} log_file - namespace of the active WAL (e.g. Glacier.RESTORE_WAL_NAME)
 * @param {string} timestamp_file - file recording the last run time
 * @param {number} max_time
 * @param {number} min_time
 *
 * @returns {Promise<boolean>}
 */
async function kickoff_time_exceeded(fs_context, log_file, timestamp_file, max_time, min_time) {
    // Periodic bound - guarantees that leftover inactive/failure logs are
    // eventually drained even when no new restore requests are arriving.
    if (await interval_time_exceeded(fs_context, max_time, timestamp_file)) return true;

    // Quiet period - kick off early if no new requests have arrived recently.
    // No locking is intentional - we just need to stat the active log file.
    const log = new PersistentLogger(config.NSFS_GLACIER_LOGS_DIR, log_file, {});
    try {
        const { mtime } = await nb_native().fs.stat(log.fs_context, log.active_path);
        return new Date(mtime.getTime() + min_time).getTime() < Date.now();
    } catch (error) {
        // An absent active log just means there are no pending requests - not an
        // error - and the periodic bound above already covers leftover logs.
        if (error.code !== 'ENOENT') {
            console.error("kickoff_time_exceeded - failed to stat:", log.active_path, error);
        }
        return false;
    }
}

exports.process_migrations = process_migrations;
exports.process_restores = process_restores;
exports.process_expiry = process_expiry;
exports.process_reclaim = process_reclaim;
