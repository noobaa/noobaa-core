/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const stream = require('stream');
const nb_native = require('./nb_native');

const original_crypto = Object.freeze({ ...crypto });
let fips_mode = false;

/**
 * @returns {Boolean}
 */
function get_fips_mode() {
    return fips_mode;
}

class HashWrap extends stream.Transform {
    constructor(hash) {
        super();
        this.hash = hash;
    }
    update(data, encoding) {
        if (encoding || !Buffer.isBuffer(data)) {
            data = Buffer.from(data, encoding);
        }
        this.hash.update(data);
        return this;
    }
    digest(encoding) {
        const buf = this.hash.digest();
        const res = encoding ? buf.toString(encoding) : buf;
        return res;
    }
    _transform(data, encoding, callback) {
        this.update(data, encoding);
        callback();
    }
    _flush(callback) {
        this.push(this.digest());
        callback();
    }
    copy() {
        // unimplemented
        return null;
    }
}

/**
 * @param {Boolean} mode
 */
function set_fips_mode(mode = detect_fips_mode()) {
    fips_mode = mode;
    nb_native().set_fips_mode(mode);
    if (mode) {
        // monkey-patch the crypto.createHash() function to provide a non-crypto md5 flow
        crypto.createHash = function(algorithm, options) {
            switch (algorithm) {
                case 'md5': {
                    return new HashWrap(new(nb_native().MD5_MB)());
                }
                default:
                    return original_crypto.createHash(algorithm, options);
            }
        };
    } else if (crypto.createHash !== original_crypto.createHash) {
        crypto.createHash = original_crypto.createHash;
    }
}


/**
 * @returns {Boolean}
 */
function detect_fips_mode() {
    if (process.env.FIPS) return true;
    const fips_proc_file = process.env.FIPS_PROC_FILE || '/proc/sys/crypto/fips_enabled';
    try {
        const value = fs.readFileSync(fips_proc_file, 'utf8').trim();
        console.log(`detect_fips_mode: found ${fips_proc_file} with value ${value}`);
        return value === '1';
    } catch (err) {
        if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
            console.warn(`detect_fips_mode: failed to read ${fips_proc_file}:`, err);
        }
    }
    return false;
}

set_fips_mode();

exports.get_fips_mode = get_fips_mode;
exports.set_fips_mode = set_fips_mode;
exports.detect_fips_mode = detect_fips_mode;
exports.original_crypto = original_crypto;
