/* Copyright (C) 2024 NooBaa */
'use strict';

const { PersistentLogger } = require("../../util/persistent_logger");
const { NewlineReader } = require('../../util/file_reader');
const { GlacierBackend } = require("./backend");
const config = require('../../../config');
const path = require("path");
const { parse_decimal_int } = require("../../endpoint/s3/s3_utils");
const { exec } = require('../../util/os_utils');
const dbg = require('../../util/debug_module')(__filename);

const ERROR_DUPLICATE_TASK = "GLESM431E";

const MIGRATE_SCRIPT = 'migrate';
const RECALL_SCRIPT = 'recall';
const TASK_SHOW_SCRIPT = 'task_show';
const PROCESS_EXPIRED_SCRIPT = 'process_expired';
const LOW_FREE_SPACE_SCRIPT = 'low_free_space';

function get_bin_path(bin_name) {
    return path.join(config.NSFS_GLACIER_TAPECLOUD_BIN_DIR, bin_name);
}

async function get_task(task_id) {
    return await exec(`${get_bin_path(TASK_SHOW_SCRIPT)} ${task_id}`, { return_stdout: true });
}

async function tapecloud_failure_handler(error) {
    const { stdout } = error;

    // Find the line in the stdout which has the line 'task ID is, <id>' and extract id
    const match = stdout.match(/task ID is (\d+)/);
    if (match.length !== 2) {
        throw error;
    }

    const task_id = match[1];

    // Fetch task status and see what failed
    const taskshowstdout = await get_task(task_id);
    return taskshowstdout
        .split('\n')
        .filter(line => line.startsWith("Fail"))
        .map(line => {
            const parsed = line.split(/\s+/);
            if (parsed.length !== 6) {
                throw Error('failed to parse task show');
            }

            if (parsed[1] === ERROR_DUPLICATE_TASK) {
                return null;
            }

            // Column 5 is the filename (refer tapecloud [eeadm] manual)
            return parsed[5];
        })
        .filter(Boolean);
}

/**
 * migrate takes name of a file which contains the list
 * of the files to be migrated to tape.
 * 
 * The file should be in the following format: <filename>
 * 
 * The function returns the names of the files which failed
 * to migrate.
 * @param {string} file filename
 * @returns {Promise<string[]>} failedfiles
 */
async function migrate(file) {
    try {
        await exec(`${get_bin_path(MIGRATE_SCRIPT)} ${file}`);
        return [];
    } catch (error) {
        return tapecloud_failure_handler(error);
    }
}

/**
 * recall takes name of a file which contains the list
 * of the files to be recall to tape.
 * 
 * The file should be in the following format: <filename>
 * 
 * The function returns the names of the files which failed
 * to recall.
 * @param {string} file filename
 * @returns {Promise<string[]>} failed files
 */
async function recall(file) {
    try {
        await exec(`${get_bin_path(RECALL_SCRIPT)} ${file}`);
        return [];
    } catch (error) {
        return tapecloud_failure_handler(error);
    }
}

async function process_expired() {
    await exec(`${get_bin_path(PROCESS_EXPIRED_SCRIPT)}`);
}

class TapeCloudGlacierBackend extends GlacierBackend {
    async migrate(fs_context, log_file) {
        dbg.log2('TapeCloudGlacierBackend.migrate starting for', log_file);

        let filtered_log = null;
        let walreader = null;
        try {
            filtered_log = new PersistentLogger(
                config.NSFS_GLACIER_LOGS_DIR,
                `tapecloud_migrate_run_${Date.now().toString()}`,
                { disable_rotate: true, locking: 'EXCLUSIVE' },
            );

            walreader = new NewlineReader(fs_context, log_file, 'EXCLUSIVE');

            const [processed, result] = await walreader.forEachFilePathEntry(async entry => {
                let should_migrate = true;
                try {
                    should_migrate = await this.should_migrate(fs_context, entry.path);
                } catch (err) {
                    if (err.code === 'ENOENT') {
                        // Skip this file
                        return true;
                    }

                    // Something else is wrong with this entry of this file
                    // should skip processing this WAL for now
                    dbg.log1('skipping log entry', entry.path, 'due to error:', err);
                    return false;
                }

                // Skip the file if it shouldn't be migrated
                if (!should_migrate) return true;

                await filtered_log.append(entry.path);
                return true;
            });

            // If the result of the above is false then it indicates that we concluded
            // to exit early hence the file shouldn't be processed further, exit
            if (!result) return false;

            // If we didn't read even one line then it most likely indicates that the WAL is
            // empty - this case is unlikely given the mechanism of WAL but still needs to be
            // handled.
            // Return `true` to mark it for deletion.
            if (processed === 0) {
                dbg.warn('unexpected empty persistent log found:', log_file);
                return true;
            }

            await filtered_log.close();
            const failed = await this._migrate(filtered_log.active_path);

            // Do not delete the WAL if migration failed - This allows easy retries
            return failed.length === 0;
        } catch (error) {
            dbg.error('unexpected error occured while processing migrate WAL:', error);

            // Preserve the WAL if we encounter exception here, possible failures
            // 1.eaedm command failure
            // 2. tempwal failure
            // 3. newline reader failure
            return false;
        } finally {
            if (filtered_log) {
                await filtered_log.close();
                await filtered_log.remove();
            }

            if (walreader) await walreader.close();
        }
    }

    async restore(fs_context, log_file) {
        dbg.log2('TapeCloudGlacierBackend.restore starting for', log_file);

        let tempwal = null;
        let walreader = null;
        let tempwalreader = null;
        try {
            // tempwal will store all the files of interest and will be handed over to tapecloud script
            tempwal = new PersistentLogger(
                config.NSFS_GLACIER_LOGS_DIR,
                `tapecloud_restore_run_${Date.now().toString()}`,
                { disable_rotate: true, locking: 'EXCLUSIVE' },
            );

            walreader = new NewlineReader(fs_context, log_file, 'EXCLUSIVE');

            let [processed, result] = await walreader.forEachFilePathEntry(async entry => {
                let fh = null;
                try {
                    fh = await entry.open();
                    const stat = await fh.stat(
                        fs_context,
                        {
                            xattr_get_keys: [
                                GlacierBackend.XATTR_RESTORE_REQUEST,
                                GlacierBackend.XATTR_RESTORE_REQUEST_STAGED,
                            ]
                        }
                    );

                    const should_restore = await this.should_restore(fs_context, entry.path, stat);
                    if (!should_restore) {
                        // Skip this file
                        return true;
                    }

                    await fh.replacexattr(
                        fs_context,
                        {
                            [GlacierBackend.XATTR_RESTORE_REQUEST_STAGED]:
                                stat.xattr[GlacierBackend.XATTR_RESTORE_REQUEST] || stat.xattr[GlacierBackend.XATTR_RESTORE_REQUEST_STAGED],
                            [GlacierBackend.XATTR_RESTORE_ONGOING]: 'true',
                        }
                    );

                    // Add entry to the tempwal
                    await tempwal.append(entry.path);

                    return true;
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        // Skip this file
                        return true;
                    }

                    // Something else is wrong so skip processing the file for now
                    return false;
                } finally {
                    if (fh) await fh.close(fs_context);
                }
            });

            // If the result of the above iteration was negative it indicates
            // an early exit hence no need to process further for now
            if (!result) return false;

            // If we didn't read even one line then it most likely indicates that the WAL is
            // empty - this case is unlikely given the mechanism of WAL but still needs to be
            // handled.
            // Return `true` so as clear this file
            if (processed === 0) {
                dbg.warn('unexpected empty persistent log found:', log_file);
                return true;
            }

            // If we didn't find any candidates despite complete read, exit and delete this WAL
            if (tempwal.local_size === 0) return true;

            await tempwal.close();
            const failed = await this._recall(tempwal.active_path);

            tempwalreader = new NewlineReader(fs_context, tempwal.active_path, "EXCLUSIVE");

            // Start iteration over the WAL again
            [processed, result] = await tempwalreader.forEachFilePathEntry(async entry => {
                let fh = null;
                try {
                    fh = await entry.open();

                    const stat = await fh.stat(
                        fs_context,
                        {
                            xattr_get_keys: [
                                GlacierBackend.XATTR_RESTORE_REQUEST,
                                GlacierBackend.XATTR_RESTORE_REQUEST_STAGED,
                            ]
                        }
                    );

                    // We noticed that the file has failed earlier
                    // so mustn't have been part of the WAL, ignore
                    if (failed.includes(entry.path)) {
                        await fh.replacexattr(
                            fs_context,
                            {
                                [GlacierBackend.XATTR_RESTORE_REQUEST]: stat.xattr[GlacierBackend.XATTR_RESTORE_REQUEST_STAGED],
                            },
                            GlacierBackend.XATTR_RESTORE_ONGOING,
                        );

                        return true;
                    }

                    const expires_on = new Date();
                    const days = parse_decimal_int(stat.xattr[GlacierBackend.XATTR_RESTORE_REQUEST_STAGED]);
                    expires_on.setUTCDate(expires_on.getUTCDate() + days);
                    expires_on.setUTCHours(0, 0, 0, 0);

                    await fh.replacexattr(fs_context, {
                        [GlacierBackend.XATTR_RESTORE_ONGOING]: 'false',
                        [GlacierBackend.XATTR_RESTORE_EXPIRY]: expires_on.toISOString(),
                    }, GlacierBackend.XATTR_RESTORE_REQUEST);

                    return true;
                } catch (error) {
                    dbg.error(`failed to process ${entry.path}`, error);
                    // It's OK if the file got deleted between the last check and this check
                    // but if there is any other error, retry restore
                    //
                    // It could be that the error is transient and the actual
                    // restore did successfully take place, in that case, rely on tapecloud script to
                    // handle dups
                    if (error.code !== 'ENOENT') {
                        return false;
                    }
                } finally {
                    if (fh) await fh.close(fs_context);
                }
            });

            if (!result) return false;

            // Even if we failed to process one entry in log, preserve the WAL
            return failed.length === 0;
        } catch (error) {
            dbg.error('unexpected error occured while processing restore WAL:', error);

            // Preserve the WAL, failure cases:
            // 1. tapecloud command exception
            // 2. WAL open failure
            // 3. Newline reader failure
            return false;
        } finally {
            if (walreader) await walreader.close();
            if (tempwalreader) await tempwalreader.close();

            if (tempwal) {
                await tempwal.close();
                await tempwal.remove();
            }
        }
    }

    async expiry(fs_context) {
        try {
            await this._process_expired();
        } catch (error) {
            dbg.error('unexpected error occured while running tapecloud.expiry:', error);
        }
    }

    async low_free_space() {
        const result = await exec(get_bin_path(LOW_FREE_SPACE_SCRIPT), { return_stdout: true });
        return result.toLowerCase() === 'true';
    }

    // ============= PRIVATE FUNCTIONS =============

    /**
     * _migrate should perform migration
     * 
     * NOTE: Must be overwritten for tests
     * @param {string} file 
     */
    async _migrate(file) {
        return migrate(file);
    }

    /**
     * _recall should perform recall
     * 
     * NOTE: Must be overwritten for tests
     * @param {string} file 
     */
    async _recall(file) {
        return recall(file);
    }

    /**
     * _process_expired should process expired objects
     * 
     * NOTE: Must be overwritten for tests
     */
    async _process_expired() {
        return process_expired();
    }
}

exports.TapeCloudGlacierBackend = TapeCloudGlacierBackend;
