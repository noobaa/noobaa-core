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
     * @param {'EXCLUSIVE' | 'SHARED' | undefined} lock 
     */
    constructor(fs_context, filepath, lock) {
        this.path = filepath;
        this.lock = lock;
        this.buf = Buffer.alloc(4096);

        this.fs_context = fs_context;
        this.fh = null;

        this.readoffset = 0;
        this.readresults = [];
        this._partialread = "";
        this.eof = false;
    }

    /**
     * nextline returns the next line from the given file
     * @returns {Promise<string | null>}
     */
    async nextline() {
        if (!this.fh) await this.init();

        if (this.readresults.length) return this.readresults.shift();
        if (this.eof) return null;

        // Will keep reading till we find at least one new line character
        while (!this._partialread.includes('\n')) {
            const read = await this.fh.read(this.fs_context, this.buf, 0, this.buf.length, this.readoffset);
            if (read === 0) {
                this.eof = true;
                return null;
            }

            this.readoffset += read;

            this._partialread += this.buf.subarray(0, read).toString('utf-8');
        }

        // readresults will contain >= 1 result or else we would have kept looping above
        this.readresults = this._partialread.split('\n').slice(0, -1);

        const lastnewlineidx = this._partialread.lastIndexOf('\n');
        this._partialread = this._partialread.substring(lastnewlineidx + 1);

        return this.readresults.shift();
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
            if (!await cb(entry)) return [count, false];

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
        this.readresults = [];
        this._partialread = "";
        this.eof = false;
        this.readoffset = 0;
    }

    async init() {
        let fh = null;
        try {
            fh = await nb_native().fs.open(this.fs_context, this.path, 'r');
            if (this.lock) await fh.flock(this.fs_context, this.lock);

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
