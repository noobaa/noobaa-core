/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');
const events = require('events');


/**
 * @param {stream.Writable} writable 
 * @returns {Promise}
 */
async function wait_drain(writable, options) {
    return events.once(writable, 'drain', options);
}

// get a stream that performs an operation on the given data and passes through the same data
function get_tap_stream(func) {
    return new stream.Transform({
        transform(data, encoding, callback) {
            func(data, encoding);
            this.push(data);
            callback();
        }
    });

}

/**
 * 
 * @param {(stream.Readable | stream.Writable | stream.Duplex)[]} streams 
 * @param {boolean?} reuse_last_stream
 * @param {stream.PipelineOptions?} options
 * @returns {Promise<void>}
 */
async function pipeline(streams, reuse_last_stream = false, options = {}) {
    if (!streams || !streams.length) throw new Error('Pipeline called without streams');
    if (streams.find(strm => strm.destroyed)) {
        const err = new Error('Pipeline called on destroyed stream');
        for (const strm of streams) {
            if (!strm.destroyed && strm.destroy) strm.destroy(err);
        }
        throw err;
    }
    // TODO: Need to follow https://github.com/nodejs/node/issues/40685 and check when Node will merge a fix
    // When we wait for finish on the last transform of the pipeline we are in a deadlock and the waiting for finishing never resolves.
    // By calling .resume() on the last_stream of the pipeline, the stream's data will be fully consumed and the finish will happen
    // we should call resume() only if the last stream of the pipeline won't be reused
    await stream.promises.pipeline(streams, options);
    if (!reuse_last_stream) {
        const last = streams[streams.length - 1];
        if ('readable' in last && last.readable) last.resume();
    }
}

exports.wait_drain = wait_drain;
exports.get_tap_stream = get_tap_stream;
exports.pipeline = pipeline;
