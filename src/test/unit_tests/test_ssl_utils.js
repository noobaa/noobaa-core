/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
// const tls = require('tls');
const mocha = require('mocha');
const assert = require('assert');

// const P = require('../../util/promise');
const ssl_utils = require('../../util/ssl_utils');
const nb_native = require('../../util/nb_native');

mocha.describe('ssl_utils', function() {

    mocha.describe('generate_ssl_certificate', function() {

        mocha.it('should generate valid certificate', function() {
            const x = ssl_utils.generate_ssl_certificate();
            assert.equal(typeof x.key, 'string');
            assert.equal(typeof x.cert, 'string');
            ssl_utils.verify_ssl_certificate(x);
            const res = nb_native().x509_verify(x);
            assert(res);
            assert.equal(typeof res.owner, 'object');
            assert.equal(typeof res.issuer, 'object');
        });

        mocha.it('should detect invalid key', function() {
            const x = ssl_utils.generate_ssl_certificate();
            x.key = x.key.slice(0, 500) + '!' + x.key.slice(501);
            assert.throws(() => ssl_utils.verify_ssl_certificate(x),
                /^Error: error:0906D064:PEM routines:PEM_read_bio:bad base64 decode$/);
            assert.throws(() => nb_native().x509_verify(x),
                /^Error: Private key PEM decode failed$/);
        });

        mocha.it('should detect invalid cert', function() {
            const x = ssl_utils.generate_ssl_certificate();
            x.cert = x.cert.slice(0, 500) + '!' + x.cert.slice(501);
            assert.throws(() => ssl_utils.verify_ssl_certificate(x),
                /^Error: error:0906D064:PEM routines:PEM_read_bio:bad base64 decode$/);
            assert.throws(() => nb_native().x509_verify(x),
                /^Error: X509 PEM decode failed$/);
        });

        mocha.it('should detect micmatch key cert', function() {
            const x = ssl_utils.generate_ssl_certificate();
            const y = ssl_utils.generate_ssl_certificate();
            x.key = y.key;
            assert.throws(() => ssl_utils.verify_ssl_certificate(x),
                /^Error: error:0B080074:x509 certificate routines:X509_check_private_key:key values mismatch$/);
            assert.throws(() => nb_native().x509_verify(x),
                /^Error: X509 verify failed$/);
        });

    });

});
