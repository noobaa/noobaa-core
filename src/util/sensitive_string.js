/* Copyright (C) 2016 NooBaa */
'use strict';

const util = require('util');
const crypto = require('crypto');

class SensitiveString {
    constructor(val) {
        const type = typeof val;
        if (val instanceof SensitiveString) {
            this.hash = val.hash;
            this.val = val.unwrap();
        } else if (type === 'string') {
            this.val = val;
            const sha = crypto.createHash('sha512').update(this.val).digest('hex');
            this.hash = sha.slice(0, 16);
        } else if (type === 'undefined') {
            this.val = undefined;
            this.hash = 'undefined';
        } else {
            throw new TypeError(`SensitiveString should be a string, got ${type}`);
        }
        if (process.env.DISABLE_SENSITIVE_STRING === 'true') {
            this.sensitive_val = this.val;
        } else {
            this.sensitive_val = 'SENSITIVE-' + this.hash;
        }
    }

    [util.inspect.custom]() {
        return this.sensitive_val;
    }

    toString() {
        return this.sensitive_val;
    }

    toJSON() {
        return this.val;
    }

    toBSON() {
        return this.val;
    }

    valueOf() {
        return this.val;
    }

    unwrap() {
        return this.val;
    }

    static can_wrap(val) {
        return typeof val === 'string';
    }

}

module.exports = SensitiveString;
