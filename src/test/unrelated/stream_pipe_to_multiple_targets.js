/* Copyright (C) 2016 NooBaa */
'use strict';

const util = require('util');
const assert = require('assert');
const stream = require('stream');
const crypto = require('crypto');
const events = require('events');
const argv = require('minimist')(process.argv);

const TICK = 250;
const CHUNK_SIZE = 16 * 1024;

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
        this.stopped = false;
    }

    /**
     * @override
     * @param {Number} size 
     */
    _read(size) {
        if (this.stopped) {
            console.log(`  - end ${this.name}`);
            this.push(null);
        } else {
            console.log(`  - read ${this.name}`);
            crypto.randomBytes(CHUNK_SIZE,
                (err, buf) => (err ? this.emit('error', err) : this.push(buf))
            );
        }
    }

    stop() {
        this.stopped = true;
    }
}

/**
 * WriteTarget simulates a target that receives the data and computes its hash.
 */
class WriteTarget extends stream.Writable {

    constructor(name, latency) {
        super({ highWaterMark: 4 * CHUNK_SIZE });
        this.name = name;
        this.latency = latency;
        this.hasher = crypto.createHash('sha512');
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

const wait_finished = util.promisify(stream.finished);

async function main() {
    try {
        console.log('main: starting ...');

        const source = new ReadSource('source');
        const hub = new WriteTarget('hub', 2 * TICK);
        const cache = new WriteTarget('cache', TICK);

        if (argv.slow_cache) {
            console.log('main: using slow cache');
            cache.latency = 8 * TICK;
        }

        // Set timer to check if thee cache is slow and disable it
        setInterval(() => {
            const hub_fill_rate = hub.writableLength / hub.writableHighWaterMark;
            const cache_fill_rate = cache.writableLength / cache.writableHighWaterMark;
            console.log('main: checking buffers -',
                'hub', (hub_fill_rate * 100).toFixed(0) + '%',
                'cache', (cache_fill_rate * 100).toFixed(0) + '%',
            );
            if (hub_fill_rate === 0 && cache_fill_rate >= 1) {
                console.log('main: stop cache - too slow');
                cache.destroy();
            }
        }, TICK).unref();

        // Set timer to stop the source stream
        setTimeout(() => {
            console.log('main: stop source - will take a couple of seconds to finish ...');
            source.stop();
        }, 40 * TICK);


        if (argv.for_await) {

            // for-await can iterate streams
            for await (const chunk of source) {
                await Promise.all([
                    hub.write(chunk) ? undefined : events.once(hub, 'drain'),
                    cache.write(chunk) ? undefined : events.once(cache, 'drain'),
                ]);
            }
            hub.end();
            cache.end();

        } else {
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
        }

        await Promise.allSettled([
            wait_finished(hub),
            wait_finished(cache),
        ]);

        if (cache.destroyed) {
            console.log('main: skipping cache check since it was canceled ...');
            assert.strictEqual(hub.writableFinished, true);
        } else {
            console.log('main: cache check ...');
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
