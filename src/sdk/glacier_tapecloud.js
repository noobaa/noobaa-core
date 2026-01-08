/* Copyright (C) 2024 NooBaa */
'use strict';

const { spawn } = require("child_process");
const events = require('events');
const os = require("os");
const path = require("path");
const { NewlineReader, NewlineReaderEntry } = require('../util/file_reader');
const { Glacier } = require("./glacier");
const config = require('../../config');
const { exec } = require('../util/os_utils');
const nb_native = require("../util/nb_native");
const { get_process_fs_context } = require("../util/native_fs_utils");
const dbg = require('../util/debug_module')(__filename);

const ERROR_DUPLICATE_TASK = "GLESM431E";

/** @import {LogFile} from "../util/persistent_logger" */

function get_bin_path(bin_name) {
    return path.join(config.NSFS_GLACIER_TAPECLOUD_BIN_DIR, bin_name);
}

class TapeCloudUtils {
    static MIGRATE_SCRIPT = 'migrate';
    static RECALL_SCRIPT = 'recall';
    static TASK_SHOW_SCRIPT = 'task_show';
    static PROCESS_EXPIRED_SCRIPT = 'process_expired';
    static LOW_FREE_SPACE_SCRIPT = 'low_free_space';

    /**
     * @param {*} task_id
     * @param {(entry: string) => Promise<void>} failure_recorder
     * @param {(entry: string) => Promise<void>} [success_recorder]
    */
    static async record_task_status(task_id, failure_recorder, success_recorder) {
        const fs_context = get_process_fs_context();
        const tmp = path.join(os.tmpdir(), `eeadm_task_out_${Date.now()}`);

        let temp_fh = null;
        let reader = null;
        try {
            temp_fh = await nb_native().fs.open(fs_context, tmp, 'rw');

            const proc = spawn(get_bin_path(TapeCloudUtils.TASK_SHOW_SCRIPT), [task_id], {
                stdio: ['pipe', temp_fh.fd, temp_fh.fd],
            });

            const [errcode] = await events.once(proc, 'exit');
            if (errcode) {
                throw new Error('process exited with non-zero exit code:', errcode);
            }

            reader = new NewlineReader(fs_context, tmp, { skip_overflow_lines: true });
            await reader.forEach(async line => {
                const failure_case = line.startsWith("Fail");
                const success_case = line.startsWith("Success");

                if (!failure_case && !success_case) return;

                // Success recorder is optional - early exit
                // if we don't have a recorder to record success
                if (success_case && !success_recorder) return;

                // (refer tapecloud [eeadm] manual)
                const [metadata, filename] = line.split(' -- ');

                if (!filename) {
                    dbg.error('invalid task show output - ', 'line:', line);
                    return;
                }

                const parsed_meta = metadata.split(/\s+/);
                if (parsed_meta.length !== 4) {
                    dbg.error('failed to parse "task show" output -', 'line:', line);
                    return;
                }

                if (failure_case) {
                    const failure_code = parsed_meta[1];
                    if (failure_code !== ERROR_DUPLICATE_TASK) {
                        dbg.warn('failed to migrate', filename, 'will record in failure/retry log');
                        await failure_recorder(filename);
                    }
                }

                if (success_case) {
                    await success_recorder(filename);
                }

                return true;
            });
        } finally {
            if (temp_fh) {
                await temp_fh.close(fs_context);

                // Preserve the tmp file
                if (config.NSFS_GLACIER_TAPECLOUD_PRESERVE_TASK_SHOW_OUTPUT) {
                    dbg.log0("preserved TASK_SHOW_SCRIPT output at - " + tmp);
                } else {
                    await nb_native().fs.unlink(fs_context, tmp);
                }
            }

            if (reader) {
                await reader.close();
            }
        }
    }

    /**
     * tapecloud_failure_handler takes the error and runs task_show on the task
     * ID to identify the failed entries and record them to the recorder
     * @param {*} error
     * @param {(entry: string) => Promise<void>} failure_recorder
     * @param {(entry: string) => Promise<void>} [success_recorder]
     */
    static async tapecloud_failure_handler(error, failure_recorder, success_recorder) {
        const { stdout } = error;

        // Find the line in the stdout which has the line 'task ID is, <id>' and extract id
        // ID in latest version must look like 1005:1111:4444
        const match = stdout.match(/task ID is ([\w]+(:[\w]+)*)/);
        if (!match || match.length < 2) {
            throw error;
        }

        const task_id = match[1];

        // Fetch task status and see what failed
        await TapeCloudUtils.record_task_status(task_id, failure_recorder, success_recorder);
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
     * @param {(entry: string) => Promise<void>} failure_recorder
     * @returns {Promise<boolean>} Indicates success if true
     */
    static async migrate(file, failure_recorder) {
        try {
            dbg.log1("Starting migration for file", file);
            const out = await exec(`${get_bin_path(TapeCloudUtils.MIGRATE_SCRIPT)} ${file}`, { return_stdout: true });
            dbg.log4("migrate finished with:", out);
            dbg.log1("Finished migration for file", file);
            return true;
        } catch (error) {
            await TapeCloudUtils.tapecloud_failure_handler(error, failure_recorder);
            return false;
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
     * @param {(entry: string) => Promise<void>} failure_recorder
     * @param {(entry: string) => Promise<void>} success_recorder
     * @returns {Promise<boolean>} Indicates success if true
     */
    static async recall(file, failure_recorder, success_recorder) {
        try {
            dbg.log1("Starting recall for file", file);
            const out = await exec(`${get_bin_path(TapeCloudUtils.RECALL_SCRIPT)} ${file}`, { return_stdout: true });
            dbg.log4("recall finished with:", out);
            dbg.log1("Finished recall for file", file);
            return true;
        } catch (error) {
            await TapeCloudUtils.tapecloud_failure_handler(error, failure_recorder, success_recorder);
            return false;
        }
    }

    static async process_expired() {
        dbg.log1("Starting process_expired");
        const out = await exec(`${get_bin_path(TapeCloudUtils.PROCESS_EXPIRED_SCRIPT)}`, { return_stdout: true });
        dbg.log4("process_expired finished with:", out);
        dbg.log1("Finished process_expired");
    }
}

class TapeCloudGlacier extends Glacier {
    static LOG_DELIM = ' -- ';

    /**
     * @param {nb.NativeFSContext} fs_context
     * @param {LogFile} log_file
     * @param {(entry: string) => Promise<void>} failure_recorder
     * @returns {Promise<boolean>}
     */
    async stage_migrate(fs_context, log_file, failure_recorder) {
        dbg.log2('TapeCloudGlacier.stage_migrate starting for', log_file.log_path);

        // Wrap failure recorder to make sure we correctly encode the entries
        // before appending them to the failure log
        const encoded_failure_recorder = async failure => failure_recorder(this.encode_log(failure));

        try {
            await log_file.collect(Glacier.MIGRATE_STAGE_WAL_NAME, async (entry, batch_recorder) => {
                entry = this.decode_log(entry);

                let entry_fh;
                let should_migrate = true;
                try {
                    entry_fh = await nb_native().fs.open(fs_context, entry);
                    const stat = await entry_fh.stat(fs_context, {
                        xattr_get_keys: [
                            Glacier.XATTR_RESTORE_REQUEST,
                            Glacier.XATTR_RESTORE_EXPIRY,
                            Glacier.STORAGE_CLASS_XATTR,
                        ],
                    });
                    should_migrate = await this.should_migrate(fs_context, entry, stat);
                } catch (err) {
                    await entry_fh?.close(fs_context);

                    if (err.code === 'ENOENT') {
                        // Skip this file
                        return;
                    }

                    dbg.log0(
                        'adding log entry', entry,
                        'to failure recorder due to error', err,
                    );

                    // Can't really do anything if this fails - provider
                    // needs to make sure that appropriate error handling
                    // is being done there
                    await encoded_failure_recorder(entry);
                    return;
                }

                // Skip the file if it shouldn't be migrated
                if (!should_migrate) return;

                // Mark the file staged
                try {
                    await entry_fh.replacexattr(fs_context, { [Glacier.XATTR_STAGE_MIGRATE]: Date.now().toString() });
                    await batch_recorder(this.encode_log(entry));
                } catch (error) {
                    dbg.error('failed to mark the entry migrate staged', error);

                    // Can't really do anything if this fails - provider
                    // needs to make sure that appropriate error handling
                    // is being done there
                    await encoded_failure_recorder(entry);
                } finally {
                    await entry_fh?.close(fs_context);
                }
            });

            return true;
        } catch (error) {
            dbg.error('unexpected error in staging migrate:', error, 'for:', log_file.log_path);
            return false;
        }
    }

    /**
     * @param {nb.NativeFSContext} fs_context
     * @param {LogFile} log_file
     * @param {(entry: string) => Promise<void>} failure_recorder
     * @returns {Promise<boolean>}
     */
    async migrate(fs_context, log_file, failure_recorder) {
        dbg.log2('TapeCloudGlacier.migrate starting for', log_file.log_path);

        // Wrap failure recorder to make sure we correctly encode the entries
        // before appending them to the failure log
        const encoded_failure_recorder = async failure => failure_recorder(this.encode_log(failure));

        try {
            // This will throw error only if our eeadm error handler
            // panics as well and at that point it's okay to
            // not handle the error and rather keep the log file around
            await this._migrate(log_file.log_path, encoded_failure_recorder);

            // Un-stage all the files - We don't need to deal with the cases
            // where some files have migrated and some have not as that is
            // not important for staging/un-staging.
            await log_file.collect_and_process(async entry => {
                entry = this.decode_log(entry);

                let fh;
                try {
                    fh = await nb_native().fs.open(fs_context, entry);
                    await fh.replacexattr(fs_context, {}, Glacier.XATTR_STAGE_MIGRATE);
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        // This is OK
                        return;
                    }

                    dbg.error('failed to remove stage marker:', error, 'for:', entry);

                    // Add the enty to the failure log - This could be wasteful as it might
                    // add entries which have already been migrated but this is a better
                    // retry.
                    await encoded_failure_recorder(entry);
                } finally {
                    await fh?.close(fs_context);
                }
            });

            return true;
        } catch (error) {
            dbg.error('unexpected error in processing migrate:', error, 'for:', log_file.log_path);
            return false;
        }
    }

    /**
     * @param {nb.NativeFSContext} fs_context
     * @param {LogFile} log_file
     * @param {(entry: string) => Promise<void>} failure_recorder
     * @returns {Promise<boolean>}
     */
    async stage_restore(fs_context, log_file, failure_recorder) {
        dbg.log2('TapeCloudGlacier.stage_restore starting for', log_file.log_path);

        // Wrap failure recorder to make sure we correctly encode the entries
        // before appending them to the failure log
        const encoded_failure_recorder = async failure => failure_recorder(this.encode_log(failure));

        try {
            await log_file.collect(Glacier.RESTORE_STAGE_WAL_NAME, async (entry, batch_recorder) => {
                entry = this.decode_log(entry);

                let fh;
                try {
                    fh = await nb_native().fs.open(fs_context, entry);
                    const stat = await fh.stat(fs_context, {
                        xattr_get_keys: [
                            Glacier.XATTR_RESTORE_REQUEST,
                            Glacier.STORAGE_CLASS_XATTR,
                            Glacier.XATTR_STAGE_MIGRATE,
                        ],
                    });

                    const should_restore = await Glacier.should_restore(fs_context, entry, stat);
                    if (!should_restore) {
                        // Skip this file
                        return;
                    }

                    // If the file staged for migrate then add it to failure log for retry
                    //
                    // It doesn't matter if we read the appropriate value for this xattr or not
                    // 1. If we read nothing we are sure that this file is not staged
                    // 2. If we read the appropriate value then the file is either being migrated
                    // or has recently completed migration but hasn't been unmarked.
                    // 3. If we read corrupt value then either the file is getting staged or is
                    // getting un-staged - In either case we must requeue.
                    if (stat.xattr[Glacier.XATTR_STAGE_MIGRATE]) {
                        await encoded_failure_recorder(entry);
                    } else {
                        await batch_recorder(this.encode_log(entry));
                    }
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        // Skip this file
                        return;
                    }

                    dbg.log0(
                        'adding log entry', entry,
                        'to failure recorder due to error', error,
                    );
                    await encoded_failure_recorder(entry);
                } finally {
                    await fh?.close(fs_context);
                }
            });

            return true;
        } catch (error) {
            dbg.error('unexpected error in staging restore:', error, 'for:', log_file.log_path);
            return false;
        }
    }

    /**
     * @param {nb.NativeFSContext} fs_context
     * @param {LogFile} log_file
     * @param {(entry: string) => Promise<void>} failure_recorder
     * @returns {Promise<boolean>}
     */
    async restore(fs_context, log_file, failure_recorder) {
        dbg.log2('TapeCloudGlacier.restore starting for', log_file.log_path);

        // Wrap failure recorder to make sure we correctly encode the entries
        // before appending them to the failure log
        const encoded_failure_recorder = async failure => failure_recorder(this.encode_log(failure));

        try {
            const success = await this._recall(
                log_file.log_path,
                async entry_path => {
                    entry_path = this.decode_log(entry_path);
                    dbg.log2('TapeCloudGlacier.restore.partial_failure - entry:', entry_path);
                    await encoded_failure_recorder(entry_path);
                },
                async entry_path => {
                    entry_path = this.decode_log(entry_path);
                    dbg.log2('TapeCloudGlacier.restore.partial_success - entry:', entry_path);
                    await this._finalize_restore(fs_context, entry_path, encoded_failure_recorder);
                }
            );

            // We will iterate through the entire log file iff and we get a success message from
            // the recall call.
            if (success) {
                await log_file.collect_and_process(async (entry_path, batch_recorder) => {
                    entry_path = this.decode_log(entry_path);
                    dbg.log2('TapeCloudGlacier.restore.batch - entry:', entry_path);
                    await this._finalize_restore(fs_context, entry_path, encoded_failure_recorder);
                });
            }

            return true;
        } catch (error) {
            dbg.error('unexpected error in processing restore:', error, 'for:', log_file.log_path);
            return false;
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
        const result = await exec(get_bin_path(TapeCloudUtils.LOW_FREE_SPACE_SCRIPT), { return_stdout: true });
        return result.toLowerCase().trim() === 'true';
    }

    /**
     * encode_log takes string of data and escapes all the backslash and newline
     * characters
     * @example 
     * // /Users/noobaa/data/buc/obj\nfile => /Users/noobaa/data/buc/obj\\nfile
     * // /Users/noobaa/data/buc/obj\file => /Users/noobaa/data/buc/obj\\file
     * @param {string} data 
     * @returns {string}
     */
    encode_log(data) {
        const encoded = data.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
        return `${TapeCloudGlacier.LOG_DELIM}${encoded}`;
    }

    /**
     * 
     * @param {string} data 
     * @returns {string}
     */
    decode_log(data) {
        if (!data.startsWith(TapeCloudGlacier.LOG_DELIM)) return data;
        return data.substring(TapeCloudGlacier.LOG_DELIM.length)
            .replace(/\\n/g, '\n')
            .replace(/\\\\/g, '\\');
    }

    // ============= PRIVATE FUNCTIONS =============

    /**
     * _migrate should perform migration
     *
     * NOTE: Must be overwritten for tests
     * @param {string} file
     * @param {(entry: string) => Promise<void>} recorder
	 * @returns {Promise<boolean>}
     */
    async _migrate(file, recorder) {
        return TapeCloudUtils.migrate(file, recorder);
    }

    /**
     * _recall should perform recall
     *
     * NOTE: Must be overwritten for tests
     * @param {string} file
     * @param {(entry: string) => Promise<void>} failure_recorder
     * @param {(entry: string) => Promise<void>} success_recorder
	 * @returns {Promise<boolean>}
     */
    async _recall(file, failure_recorder, success_recorder) {
        return TapeCloudUtils.recall(file, failure_recorder, success_recorder);
    }

    /**
     * _process_expired should process expired objects
     *
     * NOTE: Must be overwritten for tests
     */
    async _process_expired() {
        return TapeCloudUtils.process_expired();
    }

    /**
     * finalizes the restore by setting the required EAs
     *
     * @param {nb.NativeFSContext} fs_context
     * @param {string} entry_path
     * @param {(entry: string) => Promise<void>} [failure_recorder]
    */
    async _finalize_restore(fs_context, entry_path, failure_recorder) {
        dbg.log2('TapeCloudGlacier.restore._finalize_restore - entry:', entry_path);

        const entry = new NewlineReaderEntry(fs_context, entry_path);
        let fh = null;
        try {
            try {
                fh = await entry.open("r");
            } catch (error) {
                // restore does check if a file exist or not before triggering eeadm call but the file could get deleted
                // after `restore` performs that check so check it here once again
                if (error.code === 'ENOENT') {
                    dbg.warn(`TapeCloudGlacierBackend._finalize_restore: log entry unexpectedly not found: ${entry.path}`);
                    return;
                }
                throw error;
            }

            // stat will by default read GPFS_DMAPI_XATTR_TAPE_PREMIG and
            // user.noobaa.restore.request
            const stat = await fh.stat(fs_context, {});

            // This is a hacky solution and would work only if
            // config.NSFS_GLACIER_DMAPI_ENABLE is enabled. This prevents
            // the following case:
            // 1. PUT obj
            // 2. NOOBAA MIGRATE TRIGGERED (staging xattr placed)
            // 3. PUT obj (staging xattr gone)
            // 4. RESTORE-OBJECT obj
            // 5. NOOBAA RESTORE TRIGGERED
            // 6. EEADM RESTORE TRIGGERED - File is resident
            // 7. EEADM MIGRATE MIGRATES the resident file
            // 9. NooBaa finalizes the restore
            if (
                config.NSFS_GLACIER_DMAPI_FINALIZE_RESTORE_ENABLE &&
                !stat.xattr[Glacier.GPFS_DMAPI_XATTR_TAPE_PREMIG]
            ) {
                dbg.warn("TapeCloudGlacier._finalize_restore: file not premig yet - will retry - for", entry_path);
                if (!failure_recorder) {
                    throw new Error('restored file not actually restored');
                }

                await failure_recorder(entry_path);
                return;
            }

            const days = Number(stat.xattr[Glacier.XATTR_RESTORE_REQUEST]);

            // In case of invocation on the same file multiple times,
            // this xattr will not be present hence `days` will be NaN
            if (isNaN(days)) {
                dbg.warn("TapeCloudGlacier._finalize_restore: days is NaN - skipping restore for", entry_path);
                return;
            }

            const expires_on = Glacier.generate_expiry(
                new Date(),
                days,
                config.NSFS_GLACIER_EXPIRY_TIME_OF_DAY,
                config.NSFS_GLACIER_EXPIRY_TZ,
            );

            // First set the expiry so that we don't lose the number of days in
            // case of a partial failure. `replacexattr` first clears the xattrs
            // and then proceeds to set the xattr which makes it highly prone to
            // partial failure such that we lose the attribute forever and
            // consequently never really process the restore request (until it
            // is submitted again).

            await fh.replacexattr(fs_context, {
                [Glacier.XATTR_RESTORE_EXPIRY]: expires_on.toISOString(),
            });

            await fh.replacexattr(fs_context, undefined, Glacier.XATTR_RESTORE_REQUEST);
        } catch (error) {
            dbg.error(`failed to process ${entry.path}`, error);
            throw error;
        } finally {
            if (fh) await fh.close(fs_context);
        }
    }
}

exports.TapeCloudGlacier = TapeCloudGlacier;
exports.TapeCloudUtils = TapeCloudUtils;
