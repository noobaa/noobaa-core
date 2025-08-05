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

async function process_restores() {
    const fs_context = native_fs_utils.get_process_fs_context();
    const backend = Glacier.getBackend();

    if (
        await backend.low_free_space() ||
        !(await time_exceeded(fs_context, config.NSFS_GLACIER_RESTORE_INTERVAL, Glacier.RESTORE_TIMESTAMP_FILE))
    ) return;

    await backend.perform(prepare_galcier_fs_context(fs_context), "RESTORE");
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

exports.process_migrations = process_migrations;
exports.process_restores = process_restores;
exports.process_expiry = process_expiry;
