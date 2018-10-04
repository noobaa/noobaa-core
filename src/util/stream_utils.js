/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');



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




exports.get_tap_stream = get_tap_stream;
