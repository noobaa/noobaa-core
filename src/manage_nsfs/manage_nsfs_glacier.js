/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const { PersistentLogger } = require('../util/persistent_logger');
const config = require('../../config');
const nb_native = require('../util/nb_native');
const { GlacierBackend } = require('../sdk/nsfs_glacier_backend/backend');
const { getGlacierBackend } = require('../sdk/nsfs_glacier_backend/helper');
const native_fs_utils = require('../util/native_fs_utils');

const CLUSTER_LOCK = 'cluster.lock';
const SCAN_LOCK = 'scan.lock';

async function process_migrations() {
    const fs_context = native_fs_utils.get_process_fs_context();

    await lock_and_run(fs_context, CLUSTER_LOCK, async () => {
        const backend = getGlacierBackend();

        if (
            await backend.low_free_space() ||
            await time_exceeded(fs_context, config.NSFS_GLACIER_MIGRATE_INTERVAL, GlacierBackend.MIGRATE_TIMESTAMP_FILE)
        ) {
            await run_glacier_migrations(fs_context, backend);
            await record_current_time(fs_context, GlacierBackend.MIGRATE_TIMESTAMP_FILE);
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

    await lock_and_run(fs_context, CLUSTER_LOCK, async () => {
        const backend = getGlacierBackend();

        if (
            await backend.low_free_space() ||
            !(await time_exceeded(fs_context, config.NSFS_GLACIER_RESTORE_INTERVAL, GlacierBackend.RESTORE_TIMESTAMP_FILE))
        ) return;


        await run_glacier_restore(fs_context, backend);
        await record_current_time(fs_context, GlacierBackend.RESTORE_TIMESTAMP_FILE);
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

    await lock_and_run(fs_context, SCAN_LOCK, async () => {
        if (!(await time_exceeded(fs_context, config.NSFS_GLACIER_EXPIRY_INTERVAL, GlacierBackend.EXPIRY_TIMESTAMP_FILE))) return;


        await getGlacierBackend().expiry(fs_context);
        await record_current_time(fs_context, GlacierBackend.EXPIRY_TIMESTAMP_FILE);
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
 * record_current_time stores the current timestamp in ISO format into
 * the given timestamp file
 * @param {nb.NativeFSContext} fs_context 
 * @param {string} timestamp_file 
 */
async function record_current_time(fs_context, timestamp_file) {
    await nb_native().fs.writeFile(
        fs_context,
        path.join(config.NSFS_GLACIER_LOGS_DIR, timestamp_file),
        Buffer.from(new Date().toISOString()),
    );
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
    let log = null;
    let failure_log = null;

    try {
        // This logger is getting opened only so that we can process all the process the entries
        log = new PersistentLogger(config.NSFS_GLACIER_LOGS_DIR, log_namespace, { locking: 'EXCLUSIVE' });
        failure_log = new PersistentLogger(
            config.NSFS_GLACIER_LOGS_DIR,
            `${log_namespace}.failure`,
            { locking: 'EXCLUSIVE' },
        );

        try {
            // Process all the inactive and currently active log
            await log.process_inactive(async file => cb(fs_context, file, failure_log.append.bind(failure_log)));
        } catch (error) {
            console.error('failed to process logs, error:', error, 'log_namespace:', log_namespace);
        }

        try {
            // Process the inactive failure logs (don't process the current though)
            // This will REMOVE the previous failure logs and will merge them with the current failures
            await failure_log.process_inactive(async file => cb(fs_context, file, failure_log.append.bind(failure_log)), false);
        } catch (error) {
            console.error('failed to process failure logs:', error, 'log_namespace:', log_namespace);
        }

        try {
            // Finally replace the current active so as to consume them in the next iteration
            await failure_log._replace_active();
        } catch (error) {
            console.error('failed to replace active failure log:', error, 'log_namespace:', log_namespace);
        }
    } finally {
        if (log) await log.close();
        if (failure_log) await failure_log.close();
    }
}

/**
 * lock_and_run acquires a flock and calls the given callback after
 * acquiring the lock
 * @param {nb.NativeFSContext} fs_context 
 * @param {string} lockfilename
 * @param {Function} cb 
 */
async function lock_and_run(fs_context, lockfilename, cb) {
    const lockfd = await nb_native().fs.open(fs_context, path.join(config.NSFS_GLACIER_LOGS_DIR, lockfilename), 'w');

    try {
        await lockfd.flock(fs_context, 'EXCLUSIVE');
        await cb();
    } finally {
        await lockfd.close(fs_context);
    }
}

exports.process_migrations = process_migrations;
exports.process_restores = process_restores;
exports.process_expiry = process_expiry;
