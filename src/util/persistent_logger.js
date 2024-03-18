/* Copyright (C) 2023 NooBaa */
'use strict';

const path = require('path');
const nb_native = require('./nb_native');
const native_fs_utils = require('./native_fs_utils');
const P = require('./promise');
const Semaphore = require('./semaphore');
const dbg = require('./debug_module')(__filename);

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

        this.init_lock = new Semaphore(1);

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
                    if (this.locking) await fh.flock(this.fs_context, this.locking);

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
        const fh = await this.init();

        const buf = Buffer.from(data + '\n', 'utf8');
        await fh.write(this.fs_context, buf, buf.length);
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
    async process_inactive(cb, replace_active = true) {
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

        for (const file of filtered_files) {
            dbg.log1('Processing', this.dir, file);
            const delete_processed = await cb(path.join(this.dir, file.name));
            if (delete_processed) {
                await nb_native().fs.unlink(this.fs_context, path.join(this.dir, file.name));
            }
        }
    }

    async _replace_active() {
        const inactive_file = `${this.namespace}.${Date.now()}.log`;
        const inactive_file_path = path.join(this.dir, inactive_file);

        try {
            await nb_native().fs.rename(this.fs_context, this.active_path, inactive_file_path);
        } catch (error) {
            dbg.warn('failed to rename active file:', error);
        }
    }

    async _open() {
        return nb_native().fs.open(this.fs_context, this.active_path, 'as');
    }

    _poll_active_file_change(poll_interval) {
        setInterval(async () => {
            try {
                const stat = await nb_native().fs.stat(this.fs_context, this.active_path);

                // Don't race with init process - Can happen if arogue/misconfigured
                // process is continuously moving the active file
                this.init_lock.surround(async () => {
                    // If the file has changed, re-init
                    if (stat.ino !== this.fh_stat.ino) {
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


exports.PersistentLogger = PersistentLogger;
