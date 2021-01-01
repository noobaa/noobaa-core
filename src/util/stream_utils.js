/* Copyright (C) 2016 NooBaa */
'use strict';

const util = require('util');
const stream = require('stream');
const events = require('events');


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

const pipeline = util.promisify(stream.pipeline);

exports.wait_drain = wait_drain;
exports.wait_finished = wait_finished;
exports.get_tap_stream = get_tap_stream;
exports.pipeline = pipeline;
