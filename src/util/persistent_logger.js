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
     * @param {string} file file prefix
     * @param {{
     *  max_interval?: Number,
     *  locking?: "SHARED" | "EXCLUSIVE",
     *  disable_rotate?: boolean,
     * }} cfg 
     */
    constructor(dir, file, cfg) {
        this.dir = dir;
        this.file = file;
        this.cfg = cfg;
        this.active_path = path.join(this.dir, this.file);
        this.locking = cfg.locking;

        this.fs_context = native_fs_utils.get_process_fs_context();

        this.fh = null;
        this.fh_stat = null;
        this.local_size = 0;

        this.init_lock = new Semaphore(1);

        if (!cfg.disable_rotate) this._auto_rotate();
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

    async append(data) {
        const fh = await this.init();

        const buf = Buffer.from(data + "\n", 'utf8');
        await fh.write(this.fs_context, buf, buf.length);
        this.local_size += buf.length;
    }

    _auto_rotate() {
        this.swap_lock_file = path.join(this.dir, `swaplock.${this.file}`);

        setInterval(async () => {
            await this._swap();
        }, this.cfg.max_interval).unref();
    }

    async _swap() {
        if (!this.fh || !this.local_size) return;

        let slfh = null;
        try {
            // Taking this lock ensure that when the file isn't moved between us checking the inode
            // and performing the rename
            slfh = await nb_native().fs.open(this.fs_context, this.swap_lock_file, "rw");
            await slfh.flock(this.fs_context, 'EXCLUSIVE');

            let path_stat = null;
            try {
                // Ensure that the inode of the `this.active_path` is the same as the one we opened
                path_stat = await nb_native().fs.stat(this.fs_context, this.active_path, {});
            } catch (error) {
                if (error.code === 'ENOENT') {
                    // Some other process must have renamed the file
                    dbg.log1('got ENOENT for the active file');
                } else {
                    // TODO: Unexpected case, handle better
                    dbg.error('failed to stat current file:', error);
                }
            }

            if (path_stat && path_stat.ino === this.fh_stat.ino) {
                // Yes, time can drift. It can go in past or future. This at times might produce
                // duplicate names or might produce names which ideally would have produced in the past.
                //
                // Hence, the order of files in the directory is not guaranteed to be in order of "time".
                const inactive_file = `${this.file}.${Date.now()}`;
                try {
                    await nb_native().fs.rename(this.fs_context, this.active_path, path.join(this.dir, inactive_file));
                } catch (error) {
                    // It isn't really expected that this will fail assuming all the processes respect the locking
                    // semantics
                    // TODO: Unexpected case, handle better
                    dbg.error('failed to rename file', error);
                }
            }

            await this.close();
        } catch (error) {
            dbg.log0(
                'failed to get swap lock:', error,
                'dir:', this.dir,
                'file:', this.file,
            );
        } finally {
            if (slfh) await slfh.close(this.fs_context);
        }
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
     * It does not do so in any particular order.
     * @param {(file: string) => Promise<boolean>} cb callback
     */
    async process_inactive(cb) {
        const files = await nb_native().fs.readdir(this.fs_context, this.dir);
        const filtered = files.filter(f => f.name.startsWith(this.file) && f.name !== this.file && !native_fs_utils.isDirectory(f));

        for (const file of filtered) {
            const delete_processed = await cb(path.join(this.dir, file.name));
            if (delete_processed) {
                await nb_native().fs.unlink(this.fs_context, path.join(this.dir, file.name));
            }
        }
    }

    async _open() {
        return nb_native().fs.open(this.fs_context, this.active_path, 'as');
    }
}


exports.PersistentLogger = PersistentLogger;
