/* Copyright (C) 2016 NooBaa */
'use strict';

const util = require('util');
const crypto = require('crypto');

class SensitiveString {
    constructor(val) {
        const type = typeof val;
        if (val instanceof SensitiveString) {
            this.md5 = val.md5;
            this.val = val.unwrap();
        } else if (type === 'string') {
            this.val = val;
            this.md5 = crypto.createHash('md5').update(this.val).digest('hex');
        } else if (type === 'undefined') {
            this.val = undefined;
            this.md5 = 'undefined';
        } else {
            throw new TypeError(`SensitiveString should be a string, got ${type}`);
        }
    }

    [util.inspect.custom]() {
        return 'SENSITIVE-' + this.md5;
    }

    toString() {
        return 'SENSITIVE-' + this.md5;
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
