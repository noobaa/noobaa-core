/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const { PersistentLogger } = require('../util/persistent_logger');
const config = require('../../config');
const nb_native = require('../util/nb_native');
const { GlacierBackend } = require('../sdk/nsfs_glacier_backend/backend');
const { getGlacierBackend } = require('../sdk/nsfs_glacier_backend/helper');
const native_fs_utils = require('../util/native_fs_utils');
const { is_desired_time, record_current_time } = require('./manage_nsfs_cli_utils');

const CLUSTER_LOCK = 'cluster.lock';
const SCAN_LOCK = 'scan.lock';

async function process_migrations() {
    const fs_context = native_fs_utils.get_process_fs_context();
    const lock_path = path.join(config.NSFS_GLACIER_LOGS_DIR, CLUSTER_LOCK);
    await native_fs_utils.lock_and_run(fs_context, lock_path, async () => {
        const backend = getGlacierBackend();

        if (
            await backend.low_free_space() ||
            await time_exceeded(fs_context, config.NSFS_GLACIER_MIGRATE_INTERVAL, GlacierBackend.MIGRATE_TIMESTAMP_FILE)
        ) {
            await run_glacier_migrations(fs_context, backend);
            const timestamp_file_path = path.join(config.NSFS_GLACIER_LOGS_DIR, GlacierBackend.MIGRATE_TIMESTAMP_FILE);
            await record_current_time(fs_context, timestamp_file_path);
        }
    });
}

/**
 * run_tape_migrations reads the migration WALs and attempts to migrate the
 * files mentioned in the WAL.
 * @param {nb.NativeFSContext} fs_context
 * @param {import('../sdk/nsfs_glacier_backend/backend').GlacierBackend} backend
 */
async function run_glacier_migrations(fs_context, backend) {
    await run_glacier_operation(fs_context, GlacierBackend.MIGRATE_WAL_NAME, backend.migrate.bind(backend));
}

async function process_restores() {
    const fs_context = native_fs_utils.get_process_fs_context();
    const lock_path = path.join(config.NSFS_GLACIER_LOGS_DIR, CLUSTER_LOCK);
    await native_fs_utils.lock_and_run(fs_context, lock_path, async () => {
        const backend = getGlacierBackend();

        if (
            await backend.low_free_space() ||
            !(await time_exceeded(fs_context, config.NSFS_GLACIER_RESTORE_INTERVAL, GlacierBackend.RESTORE_TIMESTAMP_FILE))
        ) return;


        await run_glacier_restore(fs_context, backend);
        const timestamp_file_path = path.join(config.NSFS_GLACIER_LOGS_DIR, GlacierBackend.RESTORE_TIMESTAMP_FILE);
        await record_current_time(fs_context, timestamp_file_path);
    });
}

/**
 * run_tape_restore reads the restore WALs and attempts to restore the
 * files mentioned in the WAL.
 * @param {nb.NativeFSContext} fs_context 
 * @param {import('../sdk/nsfs_glacier_backend/backend').GlacierBackend} backend
 */
async function run_glacier_restore(fs_context, backend) {
    await run_glacier_operation(fs_context, GlacierBackend.RESTORE_WAL_NAME, backend.restore.bind(backend));
}

async function process_expiry() {
    const fs_context = native_fs_utils.get_process_fs_context();
    const lock_path = path.join(config.NSFS_GLACIER_LOGS_DIR, SCAN_LOCK);
    await native_fs_utils.lock_and_run(fs_context, lock_path, async () => {
        const backend = getGlacierBackend();
        const timestamp_file_path = path.join(config.NSFS_GLACIER_LOGS_DIR, GlacierBackend.EXPIRY_TIMESTAMP_FILE);
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
            await backend.expiry(fs_context);
            await record_current_time(fs_context, timestamp_file_path);
        }
    });
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
 * run_glacier_operations takes a log_namespace and a callback and executes the
 * callback on each log file in that namespace. It will also generate a failure
 * log file and persist the failures in that log file.
 * @param {nb.NativeFSContext} fs_context 
 * @param {string} log_namespace 
 * @param {Function} cb 
 */
async function run_glacier_operation(fs_context, log_namespace, cb) {
    const log = new PersistentLogger(config.NSFS_GLACIER_LOGS_DIR, log_namespace, { locking: 'EXCLUSIVE' });
    try {
        await log.process(async (entry, failure_recorder) => cb(fs_context, entry, failure_recorder));
    } catch (error) {
        console.error('failed to process log in namespace:', log_namespace);
    } finally {
        await log.close();
    }
}

exports.process_migrations = process_migrations;
exports.process_restores = process_restores;
exports.process_expiry = process_expiry;
