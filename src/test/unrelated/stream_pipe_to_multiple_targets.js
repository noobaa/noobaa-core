/* Copyright (C) 2016 NooBaa */
'use strict';

const assert = require('assert');
const stream = require('stream');
const crypto = require('crypto');

const TICK = 100;
const CHUNK_SIZE = 16;

/**
 * ReadSource simulates a read stream that generates data
 * until it is explicitly requested to stop()
 */
class ReadSource extends stream.Readable {

    constructor(name) {
        // highWaterMark is the read buffer size (bytes)
        // when buffer is FULL => stop reading from "socket"
        super({ highWaterMark: 4 * CHUNK_SIZE });
        this.name = name;
        this.stop_reading = false;
    }

    /**
     * @override
     * @param {Number} size 
     */
    _read(size) {
        if (this.stop_reading) {
            console.log(`  - end ${this.name}`);
            this.push(null);
        } else {
            console.log(`  - read ${this.name}`);
            this.push(crypto.pseudoRandomBytes(CHUNK_SIZE));
        }
    }

    stop() {
        this.stop_reading = true;
    }
}

/**
 * WriteTarget simulates a target that receives the data and computes its hash.
 */
class WriteTarget extends stream.Writable {

    constructor(name, latency) {
        super({ highWaterMark: CHUNK_SIZE });
        this.name = name;
        this.latency = latency;
        this.hasher = crypto.createHash('sha512');
        this.done_promise = new Promise((resolve, reject) => {
            this.once('finish', resolve);
            this.once('error', reject);
            this.once('close', () => reject(new Error('Writer Closed')));
        });
    }

    /**
     * @override
     * @param {Buffer} chunk
     * @param {String} encoding
     * @param {Function} callback
     */
    _write(chunk, encoding, callback) {
        console.log(`  - write ${this.name} - ${chunk.length} bytes`);
        this.hasher.update(chunk);
        setTimeout(callback, this.latency);
    }

    /**
     * @override
     * @param {Function} callback
     */
    _final(callback) {
        this.hash = this.hasher.digest('hex');
        console.log(`  - final ${this.name} - sha512=${this.hash}`);
        setImmediate(callback);
    }
}

async function main() {
    try {
        console.log('main: starting ...');

        const source = new ReadSource('source');
        const hub = new WriteTarget('hub', 2 * TICK);
        const cache = new WriteTarget('cache', TICK);

        if (process.argv.includes('slowcache')) {
            cache.latency = 4 * TICK;
        }

        const inter1 = new stream.PassThrough();
        const inter2 = new stream.PassThrough();

        source.pipe(inter1);
        source.pipe(inter2);

        setTimeout(() => {
            inter1.pipe(hub);
        }, 500);
        setTimeout(() => {
            inter2.pipe(cache);
        }, 1100);

        setTimeout(() => {
            if (hub.writableLength === 0 && cache.writableLength >= cache.writableHighWaterMark) {
                console.log('main: detected slow cache, lets unpipe');
                source.unpipe(cache);
                cache.destroy();
            }
        }, 15 * TICK);

        setTimeout(() => {
            console.log('main: stop source - will take a couple of seconds to finish ...');
            source.stop();
        }, 30 * TICK);

        console.log('main: waiting for both targets ...');
        await Promise.allSettled([hub.done_promise, cache.done_promise]);
        console.log('main: both writers are done ...');

        if (cache.destroyed) {
            console.log('main: skipping cache check since it was canceled ...');
            assert.strictEqual(hub.writableFinished, true);
        } else {
            console.log('main: checking cache check ...');
            assert.strictEqual(hub.writableFinished, true);
            assert.strictEqual(cache.writableFinished, true);
            assert.strictEqual(hub.hash, cache.hash);
        }

        console.log('main: done.');

    } catch (err) {
        console.error('main: ERROR', err.stack);
        process.exit(1);
    }
}

main();
