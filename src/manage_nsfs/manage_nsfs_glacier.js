/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const { PersistentLogger } = require('../util/persistent_logger');
const config = require('../../config');
const nb_native = require('../util/nb_native');
const { Glacier } = require('../sdk/glacier');
const native_fs_utils = require('../util/native_fs_utils');

const CLUSTER_LOCK = 'cluster.lock';
const SCAN_LOCK = 'scan.lock';

async function process_migrations() {
    const fs_context = native_fs_utils.get_process_fs_context();

    await lock_and_run(fs_context, CLUSTER_LOCK, async () => {
        const backend = Glacier.getBackend();

        if (
            await backend.low_free_space() ||
            await time_exceeded(fs_context, config.NSFS_GLACIER_MIGRATE_INTERVAL, Glacier.MIGRATE_TIMESTAMP_FILE)
        ) {
            await run_glacier_migrations(fs_context, backend);
            await record_current_time(fs_context, Glacier.MIGRATE_TIMESTAMP_FILE);
        }
    });
}

/**
 * run_tape_migrations reads the migration WALs and attempts to migrate the
 * files mentioned in the WAL.
 * @param {nb.NativeFSContext} fs_context
 * @param {import('../sdk/glacier').Glacier} backend
 */
async function run_glacier_migrations(fs_context, backend) {
    await run_glacier_operation(fs_context, Glacier.MIGRATE_WAL_NAME, backend.migrate.bind(backend));
}

async function process_restores() {
    const fs_context = native_fs_utils.get_process_fs_context();

    await lock_and_run(fs_context, CLUSTER_LOCK, async () => {
        const backend = Glacier.getBackend();

        if (
            await backend.low_free_space() ||
            !(await time_exceeded(fs_context, config.NSFS_GLACIER_RESTORE_INTERVAL, Glacier.RESTORE_TIMESTAMP_FILE))
        ) return;


        await run_glacier_restore(fs_context, backend);
        await record_current_time(fs_context, Glacier.RESTORE_TIMESTAMP_FILE);
    });
}

/**
 * run_tape_restore reads the restore WALs and attempts to restore the
 * files mentioned in the WAL.
 * @param {nb.NativeFSContext} fs_context
 * @param {import('../sdk/glacier').Glacier} backend
 */
async function run_glacier_restore(fs_context, backend) {
    await run_glacier_operation(fs_context, Glacier.RESTORE_WAL_NAME, backend.restore.bind(backend));
}

async function process_expiry() {
    const fs_context = force_gpfs_fs_context(native_fs_utils.get_process_fs_context());

    await lock_and_run(fs_context, SCAN_LOCK, async () => {
        const backend = Glacier.getBackend();
        if (
            await backend.low_free_space() ||
            await is_desired_time(
                    fs_context,
                    new Date(),
                    config.NSFS_GLACIER_EXPIRY_RUN_TIME,
                    config.NSFS_GLACIER_EXPIRY_RUN_DELAY_LIMIT_MINS,
                    Glacier.EXPIRY_TIMESTAMP_FILE,
            )
        ) {
            await backend.expiry(fs_context);
            await record_current_time(fs_context, Glacier.EXPIRY_TIMESTAMP_FILE);
        }
    });
}

/**
 * is_desired_time returns true if the given time matches with
 * the desired time or if
 * @param {nb.NativeFSContext} fs_context
 * @param {Date} current
 * @param {string} desire time in format 'hh:mm'
 * @param {number} delay_limit_mins
 * @param {string} timestamp_file
 * @returns {Promise<boolean>}
 */
async function is_desired_time(fs_context, current, desire, delay_limit_mins, timestamp_file) {
    const [desired_hour, desired_min] = desire.split(':').map(Number);
    if (
        isNaN(desired_hour) ||
        isNaN(desired_min) ||
        (desired_hour < 0 || desired_hour >= 24) ||
        (desired_min < 0 || desired_min >= 60)
    ) {
        throw new Error('invalid desired_time - must be hh:mm');
    }

    const min_time = get_tz_date(desired_hour, desired_min, 0, config.NSFS_GLACIER_EXPIRY_TZ);
    const max_time = get_tz_date(desired_hour, desired_min + delay_limit_mins, 0, config.NSFS_GLACIER_EXPIRY_TZ);

    if (current >= min_time && current <= max_time) {
        try {
            const { data } = await nb_native().fs.readFile(fs_context, path.join(config.NSFS_GLACIER_LOGS_DIR, timestamp_file));
            const lastrun = new Date(data.toString());

            // Last run should NOT be in this window
            if (lastrun >= min_time && lastrun <= max_time) return false;
        } catch (error) {
            if (error.code === 'ENOENT') return true;
            console.error('failed to read last run timestamp:', error, 'timestamp_file:', timestamp_file);

            throw error;
        }

        return true;
    }

    return false;
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
    const log = new PersistentLogger(config.NSFS_GLACIER_LOGS_DIR, log_namespace, { locking: 'EXCLUSIVE' });

    fs_context = force_gpfs_fs_context(fs_context);
    try {
        await log.process(async (entry, failure_recorder) => cb(fs_context, entry, failure_recorder));
    } catch (error) {
        console.error('failed to process log in namespace:', log_namespace);
    } finally {
        await log.close();
    }
}

/**
 * @param {number} hours
 * @param {number} mins
 * @param {number} secs
 * @param {'UTC' | 'LOCAL'} tz
 * @returns {Date}
 */
function get_tz_date(hours, mins, secs, tz) {
    const date = new Date();

    if (tz === 'UTC') {
        date.setUTCHours(hours);
        date.setUTCMinutes(hours);
        date.setUTCSeconds(secs);
        date.setUTCMilliseconds(0);
    } else {
        date.setHours(hours);
        date.setMinutes(mins);
        date.setSeconds(secs);
        date.setMilliseconds(0);
    }

    return date;
}

/**
 * force_gpfs_fs_context returns a shallow copy of given
 * fs_context with backend set to 'GPFS'.
 *
 * NOTE: The function will throw error if it detects that GPFS
 * DL isn't loaded.
 *
 * @param {nb.NativeFSContext} fs_context
 * @returns {nb.NativeFSContext}
 */
function force_gpfs_fs_context(fs_context) {
    if (config.NSFS_GLACIER_USE_DMAPI) {
        if (!nb_native().fs.gpfs) {
            throw new Error('cannot use DMAPI EA: gpfs dl not loaded');
        }

        return { ...fs_context, backend: 'GPFS', use_dmapi: true };
    }

    return { ...fs_context };
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
