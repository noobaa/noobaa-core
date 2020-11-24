/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');
const util = require('util');



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

exports.get_tap_stream = get_tap_stream;
exports.pipeline = pipeline;
