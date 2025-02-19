/* Copyright (C) 2024 NooBaa */

'use strict';

const nb_native = require('./nb_native');

class NewlineReaderFilePathEntry {
    constructor(fs_context, filepath) {
        this.fs_context = fs_context;
        this.path = filepath;
    }

    async open(mode = 'rw*') {
        return nb_native().fs.open(this.fs_context, this.path, mode);
    }
}

class NewlineReader {
    /**
     * NewlineReader allows to read a file line by line while at max holding one line + 4096 bytes
     * in memory.
     * @param {nb.NativeFSContext} fs_context 
     * @param {string} filepath 
     * @param {{
     *  lock?: 'EXCLUSIVE' | 'SHARED'
     *  bufsize?: number;
     *  skip_leftover_line?: boolean;
     *  skip_overflow_lines?: boolean;
     * }} [cfg]
     **/
    constructor(fs_context, filepath, cfg) {
        this.path = filepath;
        this.lock = cfg?.lock;
        this.skip_leftover_line = Boolean(cfg?.skip_leftover_line);
        this.skip_overflow_lines = Boolean(cfg?.skip_overflow_lines);

        this.fs_context = fs_context;
        this.fh = null;
        this.eof = false;
        this.readoffset = 0;

        this.buf = Buffer.alloc(cfg?.bufsize || 64 * 1024);
        this.start = 0;
        this.end = 0;
        this.overflow_state = false;
    }

    info() {
        return {
            path: this.path,
            read_offset: this.readoffset,
            overflow_state: this.overflow_state,
            start: this.start,
            end: this.end,
            eof: this.eof,
        };
    }

    /**
     * nextline returns the next line from the given file
     * @returns {Promise<string | null>}
     */
    async nextline() {
        const next = await this.next();
        if (!next) return null;

        const [start, end] = next;
        return this.buf.toString('utf8', start, end);
    }

    /**
     * forEach takes a callback function and invokes it
     * with each line as parameter
     * 
     * The callback function can return `false` if it wants
     * to stop the iteration.
     * @param {(entry: string) => Promise<boolean>} cb 
     * @returns {Promise<[number, boolean]>}
     */
    async forEach(cb) {
        let entry = await this.nextline();
        let count = 0;
        while (entry !== null) {
            count += 1;
            if ((await cb(entry)) === false) return [count, false];

            entry = await this.nextline();
        }

        return [count, true];
    }

    /**
     * forEachFilePathEntry is a wrapper around `forEach` where each entry in
     * log file is assumed to be a file path and the given callback function
     * is invoked with that entry wrapped in a class with some convenient wrappers.
     * @param {(entry: NewlineReaderFilePathEntry) => Promise<boolean>} cb 
     * @returns {Promise<[number, boolean]>}
     */
    async forEachFilePathEntry(cb) {
        return this.forEach(entry => cb(new NewlineReaderFilePathEntry(this.fs_context, entry)));
    }

    /**
     * next iterates over the file and returns start and end index for the new line
     * with `this.buf`.
     * 
     * This function can help avoid the heavy cost of converting buffer to an encoded
     * string and also gives an opportunity to the caller to use any other encoding
     * than 'utf8' which is the default for `nextline()`.
     * 
     * NOTE: If `prevent_file_read` is provided then `next()` can return `null`
     * even if the file has not reached EOF, the caller should confirm EOF it with
     * `is_eof()`.
     * @param {boolean} [prevent_file_read]
     * @returns {Promise<[number, number]>}
     */
    async next(prevent_file_read) {
        if (!this.fh) await this.init();

        while (!this.eof) {
            // extract next line if terminated in current buffer
            if (this.start < this.end) {
                // here 10 is the value for the newline character
                const term_idx = this.buf.subarray(this.start, this.end).indexOf(10);
                if (term_idx >= 0) {
                    if (this.overflow_state) {
                        console.warn('line too long finally terminated:', this.info());
                        this.overflow_state = false;
                        this.start += term_idx + 1;
                        continue;
                    }

                    const start = this.start;
                    const end = this.start + term_idx;

                    this.start += term_idx + 1;
                    return [start, end];
                }
            }

            // relocate existing data to offset 0 in buf
            if (this.start > 0) {
                const n = this.buf.copy(this.buf, 0, this.start, this.end);
                this.start = 0;
                this.end = n;
            }

            // check limits
            if (this.buf.length <= this.end) {
                if (!this.skip_overflow_lines) {
                    throw new Error("line too long or non terminated");
                }

                console.warn('line too long or non terminated:', this.info());
                this.end = 0;
                this.start = 0;
                this.overflow_state = true;
            }

            if (prevent_file_read) return null;

            // read from file
            const avail = this.buf.length - this.end;
            const read = await this.fh.read(this.fs_context, this.buf, this.end, avail, this.readoffset);
            if (!read) {
                this.eof = true;

                // what to do with the leftover in the buffer on eof
                if (this.end > this.start) {
                    if (this.skip_leftover_line) {
                        console.warn("leftover at eof:", this.info());
                    } else if (this.overflow_state) {
                        console.warn('line too long finally terminated at eof:', this.info());
                    } else {
                        return [this.start, this.end];
                    }
                }

                return null;
            }

            this.readoffset += read;
            this.end += read;
        }

        return null;
    }

    /**
     * is_eof returns true if the reader has reached EOF
     * @returns {boolean}
     */
    is_eof() {
        return this.eof;
    }

    // reset will reset the reader and will allow reading the file from
    // the beginning again, this does not reopens the file so if the file
    // was moved, this will still keep on reading from the previous FD.
    reset() {
        this.eof = false;
        this.readoffset = 0;
        this.start = 0;
        this.end = 0;
        this.overflow_state = false;
    }

    async init() {
        let fh = null;
        try {
            // here we are opening the file with both read and write to make sure
            // fcntlock can acquire both `EXCLUSIVE` as well as `SHARED` lock based
            // on the need.
            // If incompatible file descriptor and lock types are used then fcntl
            // throws `EBADF`.
            fh = await nb_native().fs.open(this.fs_context, this.path, '+');
            if (this.lock) await fh.fcntllock(this.fs_context, this.lock);

            this.fh = fh;
        } catch (error) {
            if (fh) await fh.close(this.fs_context);

            throw error;
        }
    }

    async close() {
        if (this.fh) await this.fh.close(this.fs_context);
    }
}

exports.NewlineReader = NewlineReader;
exports.NewlineReaderEntry = NewlineReaderFilePathEntry;
