/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');
const nb_native = require('../../util/nb_native');

mocha.describe('nb_native hashes', async function() {
    function md5(input) {
        const MD5 = new (nb_native().MD5_MB)();
        const native_md5 = MD5.update(Buffer.from(input)).digest().toString('hex');
        const crypto_md5 = crypto.createHash('md5').update(input).digest('hex');
        assert.strictEqual(native_md5, crypto_md5);
    }

    async function md5_async(input) {
        const MD5Async = new (nb_native().crypto.MD5Async)();
        await MD5Async.update(Buffer.from(input));
        const native_md5_async = await MD5Async.digest();
        const crypto_md5 = crypto.createHash('md5').update(input).digest('hex');
        assert.strictEqual(native_md5_async.toString('hex'), crypto_md5);
    }

    function sha1(input) {
        const SHA1 = new (nb_native().SHA1_MB)();
        const native_sha1 = SHA1.update(Buffer.from(input)).digest().toString('hex');
        const crypto_sha1 = crypto.createHash('sha1').update(input).digest('hex');
        assert.strictEqual(native_sha1, crypto_sha1);
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
        mocha.it(`MD5 ${s}`, function() {
            md5(Buffer.from(s));
        });
        mocha.it(`MD5 Async ${s}`, async function() {
            await md5_async(Buffer.from(s));
        });
        mocha.it(`SHA1 ${s}`, function() {
            sha1(Buffer.from(s));
        });
    }

    for (let i = 0; i < 10; ++i) {
        const input = crypto.randomBytes(i);
        mocha.it(`MD5 length${i}`, function() {
            md5(input);
        });
        mocha.it(`MD5 Async length${i}`, async function() {
            await md5_async(input);
        });
        mocha.it(`SHA1 length${i}`, function() {
            sha1(input);
        });
    }

    for (let i = 0; i < 10; ++i) {
        const len = Math.floor(Math.random() * 100000);
        const input = crypto.randomBytes(len);
        mocha.it(`MD5 random${i} - length${len}`, function() {
            md5(input);
        });
        mocha.it(`MD5 Async random${i} - length${len}`, async function() {
            await md5_async(input);
        });
        mocha.it(`SHA1 random${i} - length${len}`, function() {
            sha1(input);
        });
    }

});
