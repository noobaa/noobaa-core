/* Copyright (C) 2016 NooBaa */
'use strict';

const util = require('util');
const stream = require('stream');
const events = require('events');
const _ = require('lodash');


/**
 * @param {stream.Writable} writable 
 * @returns {Promise}
 */
async function wait_drain(writable) {
    return events.once(writable, 'drain');
}

const wait_finished = util.promisify(stream.finished);

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

const async_pipeline = util.promisify(stream.pipeline);
async function pipeline(streams) {
    if (!streams || !streams.length) throw new Error('Pipeline called without streams');
    if (streams.find(strm => strm.destroyed)) {
        const err = new Error('Pipeline called on destroyed stream');
        for (const strm of streams) {
            if (!strm.destroyed) strm.destroy(err);
        }
        throw err;
    }
    // When we wait for finish on the last transform of the pipeline we are in a deadlock and the waiting for finishing never resolves.
    // Added a tap stream at the end just to make sure that we advance.
    // TODO: Need to examine more elegant solutions
    streams.push(get_tap_stream(_.noop));
    return async_pipeline(streams);
}

exports.wait_drain = wait_drain;
exports.wait_finished = wait_finished;
exports.get_tap_stream = get_tap_stream;
exports.pipeline = pipeline;
