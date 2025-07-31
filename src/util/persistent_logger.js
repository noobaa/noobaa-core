/* Copyright (C) 2023 NooBaa */
'use strict';

const path = require('path');
const nb_native = require('./nb_native');
const native_fs_utils = require('./native_fs_utils');
const P = require('./promise');
const semaphore = require('./semaphore');
const { NewlineReader } = require('./file_reader');
const dbg = require('./debug_module')(__filename);
const APPEND_ATTEMPTS_LIMIT = 5;

/**
 * PersistentLogger is a logger that is used to record data onto disk separated by newlines.
 * 
 * WAL should ideally use DirectIO to avoid fsyncgate (this does not)
 *   Refer: [Can applications recover from fsync failures?](https://ramalagappan.github.io/pdfs/papers/cuttlefs.pdf)
 * 
 * Cannot recover from bit rot (Use RAID or something).
 */
class PersistentLogger {
    /**
     * @param {string} dir parent directory
     * @param {string} namespace file prefix
     * @param {{
     *  poll_interval?: Number,
     *  locking?: "SHARED" | "EXCLUSIVE",
     * }} cfg 
     */
    constructor(dir, namespace, cfg) {
        this.dir = dir;
        this.namespace = namespace;
        this.file = namespace + '.log';
        this.cfg = cfg;
        this.active_path = path.join(this.dir, this.file);
        this.locking = cfg.locking;
        this.inactive_regex = new RegExp(`^${this.namespace}[.][\\d]+[.]log$`);

        this.fs_context = native_fs_utils.get_process_fs_context();

        this.fh = null;
        this.fh_stat = null;
        this.local_size = 0;

        this.init_lock = new semaphore.Semaphore(1);

        if (cfg.poll_interval) this._poll_active_file_change(cfg.poll_interval);
    }

    async init() {
        if (this.fh) return this.fh;

        return this.init_lock.surround(async () => {
            if (this.fh) return this.fh;

            const total_retries = 10;
            const backoff = 5;

            for (let retries = 0; retries < total_retries; retries++) {
                let fh = null;
                try {
                    fh = await this._open();
                    if (this.locking) await fh.fcntllock(this.fs_context, this.locking);

                    const fh_stat = await fh.stat(this.fs_context);
                    const path_stat = await nb_native().fs.stat(this.fs_context, this.active_path);

                    if (fh_stat.ino === path_stat.ino && fh_stat.nlink > 0) {
                        this.fh = fh;
                        this.local_size = 0;
                        this.fh_stat = fh_stat;

                        // Prevent closing the fh if we succedded in the init
                        fh = null;

                        return this.fh;
                    }

                    dbg.log0(
                        'failed to init active log file, retry:', retries + 1,
                        'active path:', this.active_path,
                    );
                    await P.delay(backoff * (1 + Math.random()));
                } catch (error) {
                    dbg.log0(
                        'an error occured during init:', error,
                        'active path:', this.active_path,
                    );
                    throw error;
                } finally {
                    if (fh) await fh.close(this.fs_context);
                }
            }

            dbg.log0(
                'init retries exceeded, total retries:',
                total_retries,
                'active path:', this.active_path,
            );
            throw new Error('init retries exceeded');
        });
    }

    /**
     * appends the given data to the log file
     * @param {string} data 
     */
    async append(data) {
        const buf = Buffer.from(data + '\n', 'utf8');

        for (let attempt = 0; attempt < APPEND_ATTEMPTS_LIMIT; ++attempt) {
            const fh = await this.init();
            //if another process has deleted the active file,
            //this process' _poll_active_file_change might have closed the fd
            //in that case fd is -1
            //in order to avoid inter-process locking, we just re-init
            //the fd to the new active file.
            if (fh.fd === -1) continue;
            await fh.write(this.fs_context, buf, buf.length);
            break;
        }

        this.local_size += buf.length;
    }

    async close() {
        const fh = this.fh;

        this.fh = null;
        this.fh_stat = null;
        this.local_size = 0;

        if (fh) await fh.close(this.fs_context);
    }

    async remove() {
        try {
            await nb_native().fs.unlink(this.fs_context, this.active_path);
        } catch (error) {
            // ignore
        }
    }

    /**
     * process_inactive takes a callback and runs it on all past WAL files.
     * It does so in lexographically sorted order.
     * @param {(file: string) => Promise<boolean>} cb callback
     * @param {boolean} replace_active
     */
    async _process(cb, replace_active = true) {
        if (replace_active) {
            await this._replace_active();
        }

        let filtered_files = [];
        try {
            const files = await nb_native().fs.readdir(this.fs_context, this.dir);
            filtered_files = files
                .sort((a, b) => a.name.localeCompare(b.name))
                .filter(f => this.inactive_regex.test(f.name) && f.name !== this.file && !native_fs_utils.isDirectory(f));
        } catch (error) {
            dbg.error('failed reading dir:', this.dir, 'with error:', error);
            return;
        }

        let result = true;
        for (const file of filtered_files) {
            dbg.log1('Processing', this.dir, file);
            const delete_processed = await cb(path.join(this.dir, file.name));
            if (delete_processed) {
                await nb_native().fs.unlink(this.fs_context, path.join(this.dir, file.name));
            } else {
                result = false;
            }
        }
        return result;
    }

    /**
     * process is a safe wrapper around _process function which creates a failure logger for the
     * callback function which allows persisting failures to disk
     * @param {(file: string, failure_recorder: (entry: string) => Promise<void>) => Promise<boolean>} cb callback
     */
    async process(cb) {
        let failure_log = null;
        let result = false;

        try {
            // This logger is getting opened only so that we can process all the process the entries
            failure_log = new PersistentLogger(
                this.dir,
                `${this.namespace}.failure`, { locking: 'EXCLUSIVE' },
            );

            try {
                // Process all the inactive and currently active log
                result = await this._process(async file => cb(file, failure_log.append.bind(failure_log)));
            } catch (error) {
                dbg.error('failed to process logs, error:', error, 'log_namespace:', this.namespace);
            }

            try {
                // Process the inactive failure logs (don't process the current though)
                // This will REMOVE the previous failure logs and will merge them with the current failures
                await failure_log._process(async file => cb(file, failure_log.append.bind(failure_log)), false);
            } catch (error) {
                dbg.error('failed to process failure logs:', error, 'log_namespace:', this.namespace);
            }

            try {
                // Finally replace the current active so as to consume them in the next iteration
                await failure_log._replace_active(!result);
            } catch (error) {
                dbg.error('failed to replace active failure log:', error, 'log_namespace:', this.namespace);
            }
            return result;
        } finally {
            if (failure_log) await failure_log.close();
        }
    }

    async _replace_active(log_noent) {
        const inactive_file = `${this.namespace}.${Date.now()}.log`;
        const inactive_file_path = path.join(this.dir, inactive_file);

        try {
            await nb_native().fs.rename(this.fs_context, this.active_path, inactive_file_path);
        } catch (error) {
            if (log_noent || error.code !== 'ENOENT') {
                dbg.warn('failed to rename active file:', error);
            }
        }
    }

    async _open() {
        await native_fs_utils._create_path(this.dir, this.fs_context);

        // here we are opening the file with both read and write to make sure
        // fcntlock can acquire both `EXCLUSIVE` as well as `SHARED` lock based
        // on the need.
        // If incompatible file descriptor and lock types are used then fcntl
        // throws `EBADF`.
        return nb_native().fs.open(this.fs_context, this.active_path, 'as+');
    }

    _poll_active_file_change(poll_interval) {
        setInterval(async () => {
            try {
                const stat = await nb_native().fs.stat(this.fs_context, this.active_path);

                // Don't race with init process - Can happen if arogue/misconfigured
                // process is continuously moving the active file
                this.init_lock.surround(async () => {
                    // If the file has changed, re-init
                    if (this.fh_stat && stat.ino !== this.fh_stat.ino) {
                        dbg.log1('active file changed, closing for namespace:', this.namespace);
                        await this.close();
                    }
                });
            } catch (error) {
                if (error.code === 'ENOENT') {
                    dbg.log1('active file removed, closing for namespace:', this.namespace);
                    await this.close();
                }
            }
        }, poll_interval).unref();
    }
}

class LogFile {
    /**
     * @param {nb.NativeFSContext} fs_context 
     * @param {string} log_path 
     */
    constructor(fs_context, log_path) {
        this.fs_context = fs_context;
        this.log_path = log_path;
    }

    /**
     * batch_and_consume takes 2 functins, first function iterates over the log file
     * line by line and can choose to add some entries to a batch and then the second
     * function will be invoked to a with a path to the persistent log.
     * 
     * 
     * The fact that this function allows easy iteration and then later on optional consumption
     * of that batch provides the ability to invoke this funcition recursively composed in whatever
     * order that is required.
     * @param {(entry: string, batch_recorder: (entry: string) => Promise<void>) => Promise<void>} collect
     * @param {(batch: string) => Promise<void>} [process]
     * @returns {Promise<void>}
     */
    async collect_and_process(collect, process) {
        let log_reader = null;
        let filtered_log = null;
        try {
            filtered_log = new PersistentLogger(
                path.dirname(this.log_path),
                `tmp_consume_${Date.now().toString()}`, { locking: 'EXCLUSIVE' }
            );

            log_reader = new NewlineReader(
                this.fs_context,
                this.log_path, { lock: 'EXCLUSIVE', skip_overflow_lines: true, skip_leftover_line: true },
            );
            await log_reader.forEach(async entry => {
                await collect(entry, filtered_log.append.bind(filtered_log));
                return true;
            });

            if (filtered_log.local_size === 0) return;

            await filtered_log.close();
            await process?.(filtered_log.active_path);
        } catch (error) {
            dbg.error('unexpected error in consuming log file:', this.log_path);

            // bubble the error to the caller
            throw error;
        } finally {
            if (log_reader) {
                await log_reader.close();
            }

            if (filtered_log) {
                await filtered_log.close();
                await filtered_log.remove();
            }
        }
    }
}

exports.PersistentLogger = PersistentLogger;
exports.LogFile = LogFile;
