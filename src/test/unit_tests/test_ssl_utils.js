/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
// const tls = require('tls');
const mocha = require('mocha');
const assert = require('assert');
const https = require('https');

// const P = require('../../util/promise');
const ssl_utils = require('../../util/ssl_utils');
const nb_native = require('../../util/nb_native');

mocha.describe('ssl_utils', function() {

    const x509 = nb_native().x509;
    const x509_verify = nb_native().x509_verify;

    mocha.describe('nb_native().x509()', function() {

        mocha.it('should generate cert', function() {

            const x = x509();
            check_cert(x);

            const res = x509_verify(x);
            assert.strictEqual(typeof res, 'object');
            assert.deepStrictEqual(res.owner, res.issuer);
            assert.strictEqual(typeof res.owner, 'object');
            assert.strictEqual(res.owner.CN, 'selfsigned.noobaa.io');
        });

        mocha.it('should generate self-signed https cert', async function() {
            await test_https_with_cert(x509({ dns: 'localhost' }));
            await test_https_with_cert(x509({ dns: 'localhost', days: 1 }));
        });

        mocha.it('should generate unauthorized https cert due to expired date', async function() {
            try {
                await test_https_with_cert(x509({ dns: 'localhost', days: -1 }));
                assert.fail('did not detect expired certificate');
            } catch (err) {
                assert.strictEqual(err.message, 'certificate has expired');
            }

            // but should work as unauthorized cert
            await test_https_with_cert(x509({ dns: 'localhost', days: -1 }), { rejectUnauthorized: false });
        });

        mocha.it('should generate unauthorized https cert due to DNS mismatch', async function() {
            try {
                await test_https_with_cert(x509());
                assert.fail('did not detect DNS mismatch');
            } catch (err) {
                assert.strictEqual(err.message,
                    'Hostname/IP does not match certificate\'s altnames: Host: localhost. ' +
                    'is not in the cert\'s altnames: DNS:selfsigned.noobaa.io');
            }

            // but should work as unauthorized cert
            await test_https_with_cert(x509(), { rejectUnauthorized: false });
        });

    });

    mocha.describe('generate_ssl_certificate', function() {

        mocha.it('should generate a valid cert', function() {

            const x = ssl_utils.generate_ssl_certificate();
            check_cert(x);

            const res = x509_verify(x);
            assert.strictEqual(typeof res, 'object');
            assert.deepStrictEqual(res.owner, res.issuer);
            assert.strictEqual(typeof res.owner, 'object');
            assert.strictEqual(res.owner.CN, 'selfsigned.noobaa.io');
        });

        mocha.it('should detect invalid key', function() {

            const x = ssl_utils.generate_ssl_certificate();
            check_cert(x);

            // update the key to be invalid
            x.key = x.key.slice(0, 500) + '!' + x.key.slice(501);

            assert.throws(() => ssl_utils.verify_ssl_certificate(x),
                /^Error: error:09091064:PEM routines:PEM_read_bio_ex:bad base64 decode$/);
            assert.throws(() => x509_verify(x),
                /^Error: Private key PEM decode failed$/);
        });

        mocha.it('should detect invalid cert', function() {

            const x = ssl_utils.generate_ssl_certificate();
            check_cert(x);

            // update the cert to be invalid
            x.cert = x.cert.slice(0, 500) + '!' + x.cert.slice(501);

            assert.throws(() => ssl_utils.verify_ssl_certificate(x),
                /^Error: error:09091064:PEM routines:PEM_read_bio_ex:bad base64 decode$/);
            assert.throws(() => x509_verify(x),
                /^Error: X509 PEM decode failed$/);
        });

        mocha.it('should detect mismatch key cert', function() {

            const x = ssl_utils.generate_ssl_certificate();
            check_cert(x);

            const other = ssl_utils.generate_ssl_certificate();
            check_cert(other);

            // replace the key with another valid key
            x.key = other.key;

            assert.throws(() => ssl_utils.verify_ssl_certificate(x),
                /^Error: error:0B080074:x509 certificate routines:X509_check_private_key:key values mismatch$/);
            assert.throws(() => x509_verify(x),
                /^Error: X509 verify failed$/);
        });

    });


    function check_cert(x) {
        assert.strictEqual(typeof x.key, 'string');
        assert.strictEqual(typeof x.cert, 'string');
        const key_lines = x.key.trim().split('\n');
        const cert_lines = x.cert.trim().split('\n');
        assert.strictEqual(key_lines[0], '-----BEGIN PRIVATE KEY-----');
        assert.strictEqual(key_lines[key_lines.length - 1], '-----END PRIVATE KEY-----');
        assert.strictEqual(cert_lines[0], '-----BEGIN CERTIFICATE-----');
        assert.strictEqual(cert_lines[cert_lines.length - 1], '-----END CERTIFICATE-----');
        // const key_buf = Buffer.from(key_lines.slice(1, -1).join(''), 'base64');
        // const cert_buf = Buffer.from(cert_lines.slice(1, -1).join(''), 'base64');
        ssl_utils.verify_ssl_certificate(x);
    }

    async function test_https_with_cert(ssl_cert, { rejectUnauthorized = true } = {}) {
        const server = https.createServer({ ...ssl_cert, honorCipherOrder: true });
        try {
            await new Promise((resolve, reject) => {
                server.on('error', reject);
                server.on('request', (req, res) => {
                    req.on('data', d => d);
                    res.end(JSON.stringify(req.headers, null, 4));
                });
                server.listen(resolve);
            });
            const { port } = server.address();
            await new Promise((resolve, reject) => {
                const req = https.request({
                    method: 'GET',
                    port,
                    ca: ssl_cert.cert,
                    rejectUnauthorized,
                    timeout: 1000,
                });
                req.on('error', reject);
                req.on('response', res => {
                    res.on('data', d => d);
                    res.on('error', reject);
                    res.on('end', resolve);
                });
                req.end();
            });
        } finally {
            server.close();
        }
    }

});
