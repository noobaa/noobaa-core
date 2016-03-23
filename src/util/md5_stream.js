'use strict';

var P = require('./promise');
var crypto = require('crypto');
var Transform = require('stream').Transform;

class MD5Stream extends Transform {

    constructor(options) {
        super(options);
        this._defer = P.defer();
        this._md5 = crypto.createHash('md5');
    }

    _transform(data, encoding, callback) {
        this._md5.update(data);
        callback(null, data);
    }

    _flush(callback) {
        this._defer.resolve(this._md5.digest()); // raw buffer
        callback();
    }

    wait_digest() {
        return this._defer.promise;
    }

}

module.exports = MD5Stream;
