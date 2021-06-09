/* Copyright (C) 2016 NooBaa */
'use strict';

const util = require('util');
const stream = require('stream');
const events = require('events');
const crypto = require('crypto');

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

// get a stream and returns it's md5
function get_stream_md5() {
    const md5_stream = new stream.Transform({
        transform(buf, encoding, next) {
            this.md5.update(buf);
            this.push(buf);
            next();
        }
    });
    md5_stream.md5 = crypto.createHash('md5');
    return md5_stream;
}


const pipeline = util.promisify(stream.pipeline);

exports.wait_drain = wait_drain;
exports.wait_finished = wait_finished;
exports.get_tap_stream = get_tap_stream;
exports.get_stream_md5 = get_stream_md5;
exports.pipeline = pipeline;
