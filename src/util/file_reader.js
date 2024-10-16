/* Copyright (C) 2024 NooBaa */

'use strict';

const nb_native = require('./nb_native');
// const config = require('../../config');
// const { BuffersPool } = require('./buffer_utils');
// const Semaphore = require('./semaphore');

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
    // BUF_SIZE returns the internal buffer size used
    // by the newline reader - This is immutable value
    static get BUF_SIZE() {
        return 4096;
    }

    /**
     * NewlineReader allows to read a file line by line while at max holding one line + 4096 bytes
     * in memory.
     * @param {nb.NativeFSContext} fs_context 
     * @param {string} filepath 
     * @param {'EXCLUSIVE' | 'SHARED'} [lock]
     * @param {{
     *  max_partial_read_size?: number,
     *  return_eof?: boolean,
     * }} [cfg]
     */
    constructor(fs_context, filepath, lock, cfg) {
        this.path = filepath;
        this.lock = lock;
        this.buf = Buffer.alloc(NewlineReader.BUF_SIZE);

        this.fs_context = fs_context;
        this.fh = null;

        this.readoffset = 0;
        this.eof = false;
        this._return_eof = Boolean(cfg?.return_eof);

        this._partialread_buf = Buffer.allocUnsafe(2 * NewlineReader.BUF_SIZE);
        this._partialread_buf_len = 0;
        this._max_partial_read_size = cfg?.max_partial_read_size || Infinity;
    }

    /**
     * 
     * @param {Buffer} buffer 
     */
    #_save_partialread(buffer) {
        // Expand the buffer size
        if (this._partialread_buf_len + buffer.length >= this._partialread_buf.length) {
            if (this._max_partial_read_size <= this._partialread_buf_len + buffer.length) {
                throw new Error("partial read exceeds maximum partial read size");
            }

            let multiplier = 2;

            // Increase the buffer size by 1.5 times only once we hit 1MiB limit
            // Which means being able to hold roughly 128 more chunks of buffer (assuming
            // BUF_SIZE to be 4096).
            if (this._partialread_buf.length > 1 * 1024 * 1024) {
                multiplier = 1.5;
            }

            const newbuf = Buffer.allocUnsafe(this._partialread_buf.length * multiplier);
            newbuf.fill(this._partialread_buf, 0, this._partialread_buf.length);

            this._partialread_buf = newbuf;
        }

        this._partialread_buf.fill(buffer, this._partialread_buf_len, this._partialread_buf_len + buffer.length);
        this._partialread_buf_len += buffer.length;
    }

    /**
     * nextline returns the next line from the given file
     * @returns {Promise<string | null>}
     */
    async nextline() {
        if (!this.fh) await this.init();

        if (this.eof) {
            if (!this._return_eof || !this._partialread_buf_len) return null;

            const line = this._partialread_buf.subarray(0, this._partialread_buf_len).toString('utf8');
            this._partialread_buf_len = 0;
            return line;
        }

        // Ensure that we process previous reads first
        let read = this._partialread_buf_len;
        let newline_idx = this._partialread_buf.subarray(0, read).indexOf('\n', 0, 'utf8');

        // Will keep reading till we find at least one new line character
        if (newline_idx === -1) {
            read = 0;
            while (newline_idx === -1) {
                read = await this.fh.read(this.fs_context, this.buf, 0, this.buf.length, this.readoffset);
                this.readoffset += read;
                if (read === 0) {
                    this.eof = true;

                    // This will just check if we have something
                    // in partial read buffer and return it if
                    // needed
                    return this.nextline();
                }

                const buf_part = this.buf.subarray(0, read);
                newline_idx = buf_part.indexOf('\n', 0, 'utf8');
                this.#_save_partialread(buf_part);
            }
        }

        // _partialread_buf has at least 1 complete line
        const computed_newline_idx = (this._partialread_buf_len - read) + newline_idx;
        const line = this._partialread_buf.subarray(0, computed_newline_idx).toString('utf8');
        const next_line = this._partialread_buf.subarray(computed_newline_idx + 1, this._partialread_buf_len);

        this._partialread_buf_len = 0;
        this.#_save_partialread(next_line);

        return line;
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

    // reset will reset the reader and will allow reading the file from
    // the beginning again, this does not reopens the file so if the file
    // was moved, this will still keep on reading from the previous FD.
    reset() {
        this._partialread_buf_len = 0;
        this.eof = false;
        this.readoffset = 0;
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
