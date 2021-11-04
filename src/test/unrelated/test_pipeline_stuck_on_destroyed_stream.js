/* Copyright (C) 2020 NooBaa */
'use strict';

const stream = require('stream');

async function main() {
    await new Promise(r => setTimeout(r, 100));

    const source = new stream.Readable({
        read() {
            setTimeout(() => this.push(Buffer.from(`hello world ${process.hrtime.bigint()}}`)), 100);
        }
    });
    source.on('error', err => console.log('*** SOURCE CLOSED', err.message));

    await new Promise(r => setTimeout(r, 100));
    setTimeout(() => source.destroy(new Error('DIE')), 1000);
    // source.destroy(new Error('DIE'));
    await new Promise(r => setTimeout(r, 100));

    // See https://github.com/nodejs/node/issues/36674
    console.log('*** PIPELINE', source.destroyed ? 'already destroyed !!!' : 'still not destroyed.');
    const strm = stream.pipeline(
        source,
        new stream.PassThrough(),
        err => console.log('*** PIPELINE:', err),
    );

    await write_stream_to_file(strm, '/dev/null');
}

/**
 * @param {stream.Readable} strm
 * @param {string} fname
 * @returns {Promise<void>}
 */
async function write_stream_to_file(strm, fname) {
    try {
        console.log('*** STREAM', strm.destroyed ? 'already destroyed !!!' : 'still not destroyed.');
        for await (const buf of strm) {
            console.log('*** READ', buf.toString());
        }
    } catch (err) {
        console.log('*** CATCH', err);
    } finally {
        // we expect this finally block to be executed in any case
        // but the async function can get "cancelled" if it awaits
        // a promise that is pending and gets garbage collected.
        console.log('*** FINALLY');
    }
}

main();
