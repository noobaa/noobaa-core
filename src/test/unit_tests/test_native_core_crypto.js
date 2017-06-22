/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const tls = require('tls');
const mocha = require('mocha');
const assert = require('assert');

// const P = require('../../util/promise');
const native_core = require('../../util/native_core');

mocha.describe('native_core_crypto', function() {

    const nc = native_core();

    mocha.describe('x509', function() {

        mocha.it('should generate valid certificate', function() {
            const x = nc.x509();
            assert.equal(typeof x.key, 'string');
            assert.equal(typeof x.cert, 'string');
            const res = nc.x509_verify(x);
            assert(res);
            assert.equal(typeof res.owner, 'object');
            assert.equal(typeof res.issuer, 'object');
            tls.createSecureContext(x);
        });

        mocha.it('should detect invalid key', function() {
            const x = nc.x509();
            x.key = x.key.slice(0, 500) + '!' + x.key.slice(501);
            assert.throws(() => nc.x509_verify(x),
                /^Error: Private key PEM decode failed: bad base64 decode$/);
            assert.throws(() => tls.createSecureContext(x),
                /^Error: error:0906D064:PEM routines:PEM_read_bio:bad base64 decode$/);
        });

        mocha.it('should detect invalid cert', function() {
            const x = nc.x509();
            x.cert = x.cert.slice(0, 500) + '!' + x.cert.slice(501);
            assert.throws(() => nc.x509_verify(x),
                /^Error: X509 PEM decode failed: bad base64 decode$/);
            assert.throws(() => tls.createSecureContext(x),
                /^Error: error:0906D064:PEM routines:PEM_read_bio:bad base64 decode$/);
        });

        mocha.it('should detect micmatch key cert', function() {
            const x = nc.x509();
            const y = nc.x509();
            x.key = y.key;
            assert.throws(() => nc.x509_verify(x),
                /^Error: X509 verify failed: PEM lib$/);
            assert.throws(() => tls.createSecureContext(x),
                /^Error: error:0B080074:x509 certificate routines:X509_check_private_key:key values mismatch$/);
        });

    });

});
