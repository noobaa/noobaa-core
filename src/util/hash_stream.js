'use strict';

var P = require('./promise');
var crypto = require('crypto');
var Transform = require('stream').Transform;

class HashStream extends Transform {

    constructor(options) {
        super(options);
        this._defer = P.defer();
        this._hash = crypto.createHash(options.hash_type);
    }

    _transform(data, encoding, callback) {
        this._hash.update(data);
        callback(null, data);
    }

    _flush(callback) {
        this._defer.resolve(this._hash.digest()); // raw buffer
        callback();
    }

    wait_digest() {
        return this._defer.promise;
    }

}

module.exports = HashStream;
