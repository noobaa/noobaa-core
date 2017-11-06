/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');
const nb_native = require('../../util/nb_native');

mocha.describe('nb_native b64', function() {

    function b64(input) {
        const input_b64 = input.toString('base64');
        const encoded = nb_native().b64_encode(input);
        assert.strictEqual(encoded, input_b64);
        const decoded = nb_native().b64_decode(input_b64);
        assert.strictEqual(decoded.toString('base64'), input_b64);
    }

    for (const s of [
            'M',
            'Ma',
            'Man',
            '1',
            '12',
            '123',
            '1234',
            '12345',
            '123456',
            '1234567',
            '12345678',
            '123456789',
            '1234567890',
        ]) {
        mocha.it(`test ${s}`, function() {
            b64(Buffer.from(s));
        });
    }

    for (let i = 0; i < 1000; ++i) {
        const input = crypto.randomBytes(i);
        mocha.it(`length${i}`, function() {
            b64(input);
        });
    }

    for (let i = 0; i < 1000; ++i) {
        const len = Math.floor(Math.random() * 100000);
        const input = crypto.randomBytes(len);
        mocha.it(`random${i} - length${len}`, function() {
            b64(input);
        });
    }

});
