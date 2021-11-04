/* Copyright (C) 2020 NooBaa */
'use strict';

const util = require('util');
const stream = require('stream');
const assert = require('assert');

const finished_async = util.promisify(stream.finished);
const pipeline_async = util.promisify(stream.pipeline);
const delay_async = util.promisify(setTimeout);
const inspect_readable_state = readable => util.inspect(readable._readableState, {
    breakLength: Infinity,
    colors: true,
    depth: null,
});

async function test_pipe(use_pipeline) {

    const N_READ_MAX = 100;
    const N_DECODE_MAX = 10;
    const TICK = 50;

    let n_read = 0;
    let n_decode = 0;

    const source = new stream.Readable({
        async read() {
            await delay_async(TICK);
            if (n_read < N_READ_MAX) {
                console.log('source:', n_read);
                const data = Buffer.allocUnsafe(4);
                data.writeInt32BE(n_read, 0);
                this.push(data);
                n_read += 1;
            } else {
                console.log('source: *** end ***');
                this.push(null);
            }
        },
        destroy(err, callback) {
            console.error('source: *** DESTROYED ***', err.message);
            return callback();
        },
    });

    const decoder = new stream.Transform({
        async transform(data, enc, callback) {
            await delay_async(TICK);
            console.log('decoder:', n_decode);
            const n = data.readInt32BE(0);
            assert.strictEqual(n, n_decode);
            this.push(data, enc);
            n_decode += 1;
            return n_decode > N_DECODE_MAX ?
                callback(new Error('INJECT ERROR')) :
                callback();
        },
        destroy(err, callback) {
            console.error('decoder: *** DESTROYED ***', err.message);
            return callback();
        },
    });

    const target = new stream.Writable({
        async write(data, enc, callback) {
            await delay_async(TICK);
            return callback();
        },
        destroy(err, callback) {
            console.error('target: *** DESTROYED ***', err.message);
            return callback();
        },
    });

    try {
        if (use_pipeline) {
            await pipeline_async(
                source,
                decoder,
                target
            );
        } else {
            source.pipe(decoder).pipe(target);
            console.error('main: waiting streams to finish ...');
            await Promise.all([
                finished_async(source),
                finished_async(decoder),
                finished_async(target),
            ]);
        }
    } catch (err) {
        console.error('main: caught', err);
    }

    // eslint-disable-next-line no-unmodified-loop-condition
    while (!source.destroyed && n_read < N_READ_MAX) {
        if (source.readableEnded) {
            console.error('main: source ended but not destroyed', inspect_readable_state(source));
        } else {
            console.error('main: source is still reading ...');
        }
        await delay_async(1000);
    }
}

async function main() {

    console.log('');
    console.log('*********************************');
    console.log('***          CASE 1           ***');
    console.log('***                           ***');
    console.log('*** test WITH stream.pipeline ***');
    console.log('***                           ***');
    console.log('*********************************');
    console.log('');

    await test_pipe(true);

    console.log('');
    console.log('************************************');
    console.log('***          CASE 2              ***');
    console.log('***                              ***');
    console.log('*** test WITHOUT stream.pipeline ***');
    console.log('***                              ***');
    console.log('************************************');
    console.log('');

    await test_pipe(false);

    console.log('');
    console.log('**************************************************************');
    console.log('***                                                        ***');
    console.log('***                                                        ***');
    console.log('***    NOTICE HOW THE ENTIRE SOURCE IS READ IN CASE 2 ...  ***');
    console.log('***                                                        ***');
    console.log('***                                                        ***');
    console.log('**************************************************************');
    console.log('');
}


main().catch(console.error);
