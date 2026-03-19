/* Copyright (C) 2016 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const https = require('https');
const tls = require('tls');

const config = require('../../../../config');
const ssl_utils = require('../../../util/ssl_utils');
const nb_native = require('../../../util/nb_native');

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
                process.version.startsWith('v16') ?
                    /^Error: error:09091064:PEM routines:PEM_read_bio_ex:bad base64 decode$/ :
                    /^Error: error:1E08010C:DECODER routines::unsupported$/
            );
            assert.throws(() => x509_verify(x),
                /^Error: Private key PEM decode failed$/);
        });

        mocha.it('should detect invalid cert', function() {

            const x = ssl_utils.generate_ssl_certificate();
            check_cert(x);

            // update the cert to be invalid
            x.cert = x.cert.slice(0, 500) + '!' + x.cert.slice(501);

            assert.throws(() => ssl_utils.verify_ssl_certificate(x),
                process.version.startsWith('v16') ?
                    /^Error: error:09091064:PEM routines:PEM_read_bio_ex:bad base64 decode$/ :
                    /^Error: error:04800064:PEM routines::bad base64 decode$/
            );
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

            assert.throws(
                () => ssl_utils.verify_ssl_certificate(x),
                process.version.startsWith('v16') ?
                    /^Error: error:0B080074:x509 certificate routines:X509_check_private_key:key values mismatch$/ :
                    /^Error: error:05800074:x509 certificate routines::key values mismatch$/
            );
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

    mocha.describe('apply_tls_config', function() {

        const saved_min_version = config.ENDPOINT_TLS_MIN_VERSION;
        const saved_ciphers = config.ENDPOINT_TLS_CIPHERS;
        const saved_curves = config.ENDPOINT_TLS_CURVE_PREFERENCES;
        const saved_enabled_services = config.ENDPOINT_TLS_ENABLED_SERVICES;

        mocha.beforeEach(function() {
            config.ENDPOINT_TLS_MIN_VERSION = '';
            config.ENDPOINT_TLS_CIPHERS = '';
            config.ENDPOINT_TLS_CURVE_PREFERENCES = '';
            config.ENDPOINT_TLS_ENABLED_SERVICES = ['S3', 'STS', 'IAM', 'METRICS'];
        });

        mocha.afterEach(function() {
            config.ENDPOINT_TLS_MIN_VERSION = saved_min_version;
            config.ENDPOINT_TLS_CIPHERS = saved_ciphers;
            config.ENDPOINT_TLS_CURVE_PREFERENCES = saved_curves;
            config.ENDPOINT_TLS_ENABLED_SERVICES = saved_enabled_services;
        });

        mocha.it('should not modify options when config is empty', function() {
            const options = { key: 'k', cert: 'c' };
            ssl_utils.apply_tls_config(options);
            assert.strictEqual(options.minVersion, undefined);
            assert.strictEqual(options.ciphers, undefined);
            assert.strictEqual(options.ecdhCurve, undefined);
        });

        mocha.it('should not modify options when config values are undefined', function() {
            config.ENDPOINT_TLS_MIN_VERSION = undefined;
            config.ENDPOINT_TLS_CIPHERS = undefined;
            config.ENDPOINT_TLS_CURVE_PREFERENCES = undefined;
            const options = { key: 'k', cert: 'c' };
            ssl_utils.apply_tls_config(options);
            assert.strictEqual(options.minVersion, undefined);
            assert.strictEqual(options.ciphers, undefined);
            assert.strictEqual(options.ecdhCurve, undefined);
        });

        mocha.it('should set minVersion TLSv1.2', function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.2';
            const options = {};
            ssl_utils.apply_tls_config(options);
            assert.strictEqual(options.minVersion, 'TLSv1.2');
            assert.strictEqual(options.ciphers, undefined);
            assert.strictEqual(options.ecdhCurve, undefined);
        });

        mocha.it('should set minVersion TLSv1.3', function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.3';
            const options = {};
            ssl_utils.apply_tls_config(options);
            assert.strictEqual(options.minVersion, 'TLSv1.3');
            assert.strictEqual(options.ciphers, undefined);
            assert.strictEqual(options.ecdhCurve, undefined);
        });

        mocha.it('should set a single cipher', function() {
            config.ENDPOINT_TLS_CIPHERS = 'TLS_AES_256_GCM_SHA384';
            const options = {};
            ssl_utils.apply_tls_config(options);
            assert.strictEqual(options.ciphers, 'TLS_AES_256_GCM_SHA384');
            assert.strictEqual(options.minVersion, undefined);
            assert.strictEqual(options.ecdhCurve, undefined);
        });

        mocha.it('should set multiple ciphers', function() {
            config.ENDPOINT_TLS_CIPHERS = 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384';
            const options = {};
            ssl_utils.apply_tls_config(options);
            assert.strictEqual(options.ciphers, 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384');
            assert.strictEqual(options.minVersion, undefined);
            assert.strictEqual(options.ecdhCurve, undefined);
        });

        mocha.it('should set a single ecdhCurve', function() {
            config.ENDPOINT_TLS_CURVE_PREFERENCES = 'P-256';
            const options = {};
            ssl_utils.apply_tls_config(options);
            assert.strictEqual(options.ecdhCurve, 'P-256');
            assert.strictEqual(options.minVersion, undefined);
            assert.strictEqual(options.ciphers, undefined);
        });

        mocha.it('should set multiple ecdhCurves', function() {
            config.ENDPOINT_TLS_CURVE_PREFERENCES = 'X25519:P-256:P-384';
            const options = {};
            ssl_utils.apply_tls_config(options);
            assert.strictEqual(options.ecdhCurve, 'X25519:P-256:P-384');
            assert.strictEqual(options.minVersion, undefined);
            assert.strictEqual(options.ciphers, undefined);
        });

        mocha.it('should set ecdhCurve as-is including PQC curve names', function() {
            config.ENDPOINT_TLS_CURVE_PREFERENCES = 'X25519MLKEM768:X25519:P-256';
            const options = {};
            ssl_utils.apply_tls_config(options);
            assert.strictEqual(options.ecdhCurve, 'X25519MLKEM768:X25519:P-256');
        });

        mocha.it('should set all TLS options together', function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.2';
            config.ENDPOINT_TLS_CIPHERS = 'ECDHE-RSA-AES128-GCM-SHA256';
            config.ENDPOINT_TLS_CURVE_PREFERENCES = 'X25519:P-256';
            const options = {};
            ssl_utils.apply_tls_config(options);
            assert.strictEqual(options.minVersion, 'TLSv1.2');
            assert.strictEqual(options.ciphers, 'ECDHE-RSA-AES128-GCM-SHA256');
            assert.strictEqual(options.ecdhCurve, 'X25519:P-256');
        });

        mocha.it('should preserve existing ssl_options properties', function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.3';
            config.ENDPOINT_TLS_CIPHERS = 'TLS_AES_128_GCM_SHA256';
            config.ENDPOINT_TLS_CURVE_PREFERENCES = 'X25519';
            const options = { key: 'my-key', cert: 'my-cert', honorCipherOrder: true };
            ssl_utils.apply_tls_config(options);
            assert.strictEqual(options.key, 'my-key');
            assert.strictEqual(options.cert, 'my-cert');
            assert.strictEqual(options.honorCipherOrder, true);
            assert.strictEqual(options.minVersion, 'TLSv1.3');
        });

        mocha.it('should apply TLS config for enabled service (S3)', function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.3';
            const options = {};
            ssl_utils.apply_tls_config(options, 'S3');
            assert.strictEqual(options.minVersion, 'TLSv1.3');
        });

        mocha.it('should apply TLS config for enabled service (STS)', function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.3';
            const options = {};
            ssl_utils.apply_tls_config(options, 'STS');
            assert.strictEqual(options.minVersion, 'TLSv1.3');
        });

        mocha.it('should apply TLS config for enabled service (IAM)', function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.3';
            const options = {};
            ssl_utils.apply_tls_config(options, 'IAM');
            assert.strictEqual(options.minVersion, 'TLSv1.3');
        });

        mocha.it('should skip TLS config for non-enabled service (MGMT)', function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.3';
            const options = {};
            ssl_utils.apply_tls_config(options, 'MGMT');
            assert.strictEqual(options.minVersion, undefined);
        });

        mocha.it('should apply TLS config for enabled service (METRICS)', function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.3';
            config.ENDPOINT_TLS_CIPHERS = 'TLS_AES_256_GCM_SHA384';
            const options = {};
            ssl_utils.apply_tls_config(options, 'METRICS');
            assert.strictEqual(options.minVersion, 'TLSv1.3');
            assert.strictEqual(options.ciphers, 'TLS_AES_256_GCM_SHA384');
        });

        mocha.it('should apply TLS config when service is dynamically added to enabled list', function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.3';
            config.ENDPOINT_TLS_ENABLED_SERVICES = ['S3', 'STS', 'IAM', 'METRICS', 'CUSTOM'];
            const options = {};
            ssl_utils.apply_tls_config(options, 'CUSTOM');
            assert.strictEqual(options.minVersion, 'TLSv1.3');
        });

        mocha.it('should apply TLS config when no service is specified (backward compat)', function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.3';
            const options = {};
            ssl_utils.apply_tls_config(options);
            assert.strictEqual(options.minVersion, 'TLSv1.3');
        });
    });

    mocha.describe('create_https_server with TLS config', function() {

        const saved_min_version = config.ENDPOINT_TLS_MIN_VERSION;
        const saved_ciphers = config.ENDPOINT_TLS_CIPHERS;
        const saved_curves = config.ENDPOINT_TLS_CURVE_PREFERENCES;

        mocha.beforeEach(function() {
            config.ENDPOINT_TLS_MIN_VERSION = '';
            config.ENDPOINT_TLS_CIPHERS = '';
            config.ENDPOINT_TLS_CURVE_PREFERENCES = '';
        });

        mocha.afterEach(function() {
            config.ENDPOINT_TLS_MIN_VERSION = saved_min_version;
            config.ENDPOINT_TLS_CIPHERS = saved_ciphers;
            config.ENDPOINT_TLS_CURVE_PREFERENCES = saved_curves;
        });

        async function create_tls_server_and_connect(client_options, cert_options) {
            const ssl_cert = nb_native().x509({ dns: 'localhost', ...cert_options });
            const server = await ssl_utils.create_https_server(
                { cert: ssl_cert }, true, (req, res) => res.end('ok')
            );
            try {
                await new Promise((resolve, reject) => {
                    server.on('error', reject);
                    server.listen(resolve);
                });
                const { port } = server.address();
                return await new Promise((resolve, reject) => {
                    const req = https.request({
                        method: 'GET',
                        port,
                        ca: ssl_cert.cert,
                        rejectUnauthorized: true,
                        timeout: 1000,
                        ...client_options,
                    });
                    req.on('error', reject);
                    req.on('response', res => {
                        resolve({
                            protocol: res.socket.getProtocol(),
                            cipher: res.socket.getCipher(),
                            ephemeral: res.socket.getEphemeralKeyInfo(),
                        });
                        res.on('data', d => d);
                        res.on('end', resolve);
                    });
                    req.end();
                });
            } finally {
                server.close();
            }
        }

        mocha.it('should negotiate TLS >= 1.2 when minVersion is TLSv1.2', async function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.2';
            const result = await create_tls_server_and_connect({});
            const version_num = parseFloat(result.protocol.replace('TLSv', ''));
            assert.ok(version_num >= 1.2, `Expected TLS >= 1.2, got ${result.protocol}`);
        });

        mocha.it('should negotiate TLS 1.3 when minVersion is TLSv1.3', async function() {
            if (tls.DEFAULT_MAX_VERSION !== 'TLSv1.3') return;
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.3';
            const result = await create_tls_server_and_connect({ minVersion: 'TLSv1.3' });
            assert.strictEqual(result.protocol, 'TLSv1.3');
        });

        mocha.it('should reject TLS 1.2 client when server minimum is TLS 1.3', async function() {
            if (tls.DEFAULT_MAX_VERSION !== 'TLSv1.3') return;
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.3';
            await assert.rejects(
                () => create_tls_server_and_connect({ maxVersion: 'TLSv1.2' }),
                /TLSV1_ALERT_PROTOCOL_VERSION|ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION|handshake failure/i
            );
        });

        mocha.it('should enforce specific cipher suite', async function() {
            config.ENDPOINT_TLS_CIPHERS = 'ECDHE-RSA-AES128-GCM-SHA256';
            const result = await create_tls_server_and_connect({ maxVersion: 'TLSv1.2' });
            assert.strictEqual(result.cipher.name, 'ECDHE-RSA-AES128-GCM-SHA256');
        });

        mocha.it('should enforce ecdhCurve P-256', async function() {
            config.ENDPOINT_TLS_CURVE_PREFERENCES = 'P-256';
            const result = await create_tls_server_and_connect({});
            assert.strictEqual(result.ephemeral.type, 'ECDH');
            assert.strictEqual(result.ephemeral.name, 'prime256v1');
        });

        mocha.it('should enforce all TLS options combined', async function() {
            if (tls.DEFAULT_MAX_VERSION !== 'TLSv1.3') return;
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.3';
            config.ENDPOINT_TLS_CIPHERS = 'TLS_AES_256_GCM_SHA384';
            config.ENDPOINT_TLS_CURVE_PREFERENCES = 'X25519';
            const result = await create_tls_server_and_connect({ minVersion: 'TLSv1.3' });
            assert.strictEqual(result.protocol, 'TLSv1.3');
            assert.strictEqual(result.cipher.name, 'TLS_AES_256_GCM_SHA384');
        });

        mocha.it('should reject expired certificate with TLS config applied', async function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.2';
            await assert.rejects(
                () => create_tls_server_and_connect({}, { days: -1 }),
                /certificate has expired/
            );
        });

        mocha.it('should reject DNS mismatch certificate with TLS config applied', async function() {
            config.ENDPOINT_TLS_MIN_VERSION = 'TLSv1.2';
            const ssl_cert = nb_native().x509();
            const server = await ssl_utils.create_https_server(
                { cert: ssl_cert }, true, (req, res) => res.end('ok')
            );
            try {
                await new Promise((resolve, reject) => {
                    server.on('error', reject);
                    server.listen(resolve);
                });
                const { port } = server.address();
                await assert.rejects(
                    () => new Promise((resolve, reject) => {
                        const req = https.request({
                            method: 'GET', port, ca: ssl_cert.cert,
                            rejectUnauthorized: true, timeout: 1000,
                        });
                        req.on('error', reject);
                        req.on('response', res => {
                            res.on('data', d => d);
                            res.on('end', resolve);
                        });
                        req.end();
                    }),
                    /Hostname\/IP does not match certificate/
                );
            } finally {
                server.close();
            }
        });
    });

});
