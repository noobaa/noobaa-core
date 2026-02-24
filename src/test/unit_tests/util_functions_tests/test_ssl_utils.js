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

        const saved_min_version = config.TLS_MIN_VERSION;
        const saved_ciphers = config.TLS_CIPHERS;
        const saved_curves = config.TLS_CURVES;
        const saved_enabled_services = config.TLS_CONFIGURABLE_SERVERS;

        mocha.beforeEach(function() {
            config.TLS_MIN_VERSION = '';
            config.TLS_CIPHERS = '';
            config.TLS_CURVES = '';
            config.TLS_CONFIGURABLE_SERVERS = ['S3', 'STS', 'IAM'];
        });

        mocha.afterEach(function() {
            config.TLS_MIN_VERSION = saved_min_version;
            config.TLS_CIPHERS = saved_ciphers;
            config.TLS_CURVES = saved_curves;
            config.TLS_CONFIGURABLE_SERVERS = saved_enabled_services;
        });

        mocha.it('should not modify options when config is empty', function() {
            const options = { key: 'k', cert: 'c' };
            ssl_utils.apply_tls_config(options, 'S3');
            const expected_configurable_tls_config = { minVersion: undefined, ciphers: undefined, ecdhCurve: undefined };
            validate_configurable_tls_option_fields(options, expected_configurable_tls_config);
        });

        mocha.it('should not modify options when config values are undefined', function() {
            config.TLS_MIN_VERSION = undefined;
            config.TLS_CIPHERS = undefined;
            config.TLS_CURVES = undefined;
            const options = { key: 'k', cert: 'c' };
            ssl_utils.apply_tls_config(options, 'S3');
            const expected_configurable_tls_config = { minVersion: undefined, ciphers: undefined, ecdhCurve: undefined };
            validate_configurable_tls_option_fields(options, expected_configurable_tls_config);
        });

        mocha.it('should set minVersion TLSv1.2', function() {
            config.TLS_MIN_VERSION = 'TLSv1.2';
            const options = {};
            ssl_utils.apply_tls_config(options, 'S3');
            const expected_configurable_tls_config = {
                minVersion: config.TLS_MIN_VERSION,
                ciphers: undefined,
                ecdhCurve: undefined
            };
            validate_configurable_tls_option_fields(options, expected_configurable_tls_config);
        });

        mocha.it('should set minVersion TLSv1.3', function() {
            config.TLS_MIN_VERSION = 'TLSv1.3';
            const options = {};
            ssl_utils.apply_tls_config(options, 'S3');
            const expected_configurable_tls_config = {
                minVersion: config.TLS_MIN_VERSION,
                ciphers: undefined,
                ecdhCurve: undefined
            };
            validate_configurable_tls_option_fields(options, expected_configurable_tls_config);

        });

        mocha.it('should set a single cipher', function() {
            config.TLS_CIPHERS = 'TLS_AES_256_GCM_SHA384';
            const options = {};
            ssl_utils.apply_tls_config(options, 'S3');
            const expected_configurable_tls_config = {
                minVersion: undefined,
                ciphers: config.TLS_CIPHERS,
                ecdhCurve: undefined
            };
            validate_configurable_tls_option_fields(options, expected_configurable_tls_config);
        });

        mocha.it('should set multiple ciphers', function() {
            config.TLS_CIPHERS = 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384';
            const options = {};
            ssl_utils.apply_tls_config(options, 'S3');
            const expected_configurable_tls_config = {
                minVersion: undefined,
                ciphers: config.TLS_CIPHERS,
                ecdhCurve: undefined
            };
            validate_configurable_tls_option_fields(options, expected_configurable_tls_config);

        });

        mocha.it('should set a single ecdhCurve', function() {
            config.TLS_CURVES = 'P-256';
            const options = {};
            ssl_utils.apply_tls_config(options, 'S3');
            const expected_configurable_tls_config = {
                minVersion: undefined,
                ciphers: undefined,
                ecdhCurve: config.TLS_CURVES
            };
            validate_configurable_tls_option_fields(options, expected_configurable_tls_config);
        });

        mocha.it('should set multiple ecdhCurves', function() {
            config.TLS_CURVES = 'X25519:P-256:P-384';
            const options = {};
            ssl_utils.apply_tls_config(options, 'S3');
            const expected_configurable_tls_config = {
                minVersion: undefined,
                ciphers: undefined,
                ecdhCurve: config.TLS_CURVES
            };
            validate_configurable_tls_option_fields(options, expected_configurable_tls_config);
        });

        mocha.it('should set ecdhCurve as-is including PQC curve names', function() {
            config.TLS_CURVES = 'X25519MLKEM768:X25519:P-256';
            const options = {};
            ssl_utils.apply_tls_config(options, 'S3');
            const expected_configurable_tls_config = {
                minVersion: undefined,
                ciphers: undefined,
                ecdhCurve: config.TLS_CURVES
            };
            validate_configurable_tls_option_fields(options, expected_configurable_tls_config);
        });

        mocha.it('should set all TLS options together', function() {
            config.TLS_MIN_VERSION = 'TLSv1.2';
            config.TLS_CIPHERS = 'ECDHE-RSA-AES128-GCM-SHA256';
            config.TLS_CURVES = 'X25519:P-256:X25519MLKEM768';
            const s3_options = {};
            ssl_utils.apply_tls_config(s3_options, 'S3');
            const sts_options = {};
            ssl_utils.apply_tls_config(sts_options, 'STS');
            const iam_options = {};
            ssl_utils.apply_tls_config(iam_options, 'IAM');

            const expected_configurable_tls_config = {
                minVersion: config.TLS_MIN_VERSION,
                ciphers: config.TLS_CIPHERS,
                ecdhCurve: config.TLS_CURVES
            };
            validate_configurable_tls_option_fields(s3_options, expected_configurable_tls_config);
            validate_configurable_tls_option_fields(sts_options, expected_configurable_tls_config);
            validate_configurable_tls_option_fields(iam_options, expected_configurable_tls_config);
        });

        mocha.it('should preserve existing ssl_options properties', function() {
            config.TLS_MIN_VERSION = 'TLSv1.3';
            config.TLS_CIPHERS = 'TLS_AES_128_GCM_SHA256';
            config.TLS_CURVES = 'X25519';
            const options = { key: 'my-key', cert: 'my-cert', honorCipherOrder: true };
            ssl_utils.apply_tls_config(options, 'S3');
            assert.strictEqual(options.key, 'my-key');
            assert.strictEqual(options.cert, 'my-cert');
            assert.strictEqual(options.honorCipherOrder, true);
            const expected_configurable_tls_config = {
                minVersion: config.TLS_MIN_VERSION,
                ciphers: config.TLS_CIPHERS,
                ecdhCurve: config.TLS_CURVES
            };
            validate_configurable_tls_option_fields(options, expected_configurable_tls_config);

        });

        mocha.it('should skip TLS config for non-enabled service (MGMT)', function() {
            config.TLS_MIN_VERSION = 'TLSv1.3';
            const options = {};
            ssl_utils.apply_tls_config(options, 'MGMT');
            assert.strictEqual(options.minVersion, undefined);
        });
    });

    mocha.describe('create_https_server with TLS config', function() {

        const saved_min_version = config.TLS_MIN_VERSION;
        const saved_ciphers = config.TLS_CIPHERS;
        const saved_curves = config.TLS_CURVES;

        mocha.beforeEach(function() {
            config.TLS_MIN_VERSION = '';
            config.TLS_CIPHERS = '';
            config.TLS_CURVES = '';
        });

        mocha.afterEach(function() {
            config.TLS_MIN_VERSION = saved_min_version;
            config.TLS_CIPHERS = saved_ciphers;
            config.TLS_CURVES = saved_curves;
        });

        async function create_tls_server_and_connect(client_options, cert_options) {
            const ssl_cert = nb_native().x509({ dns: 'localhost', ...cert_options });
            const server = await ssl_utils.create_https_server(
                { cert: ssl_cert }, true, (req, res) => res.end('ok'), 'S3'
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

        mocha.it('should negotiate TLS 1.3 when minVersion is TLSv1.3', async function() {
            if (tls.DEFAULT_MAX_VERSION !== 'TLSv1.3') return;
            config.TLS_MIN_VERSION = 'TLSv1.3';
            const result = await create_tls_server_and_connect({ minVersion: 'TLSv1.3' });
            assert.strictEqual(result.protocol, 'TLSv1.3');
        });

        mocha.it('should reject TLS 1.2 client when server minimum is TLS 1.3', async function() {
            if (tls.DEFAULT_MAX_VERSION !== 'TLSv1.3') return;
            config.TLS_MIN_VERSION = 'TLSv1.3';
            await assert.rejects(
                () => create_tls_server_and_connect({ maxVersion: 'TLSv1.2' }),
                /TLSV1_ALERT_PROTOCOL_VERSION|ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION|tlsv1 alert protocol version|handshake failure/i
            );
        });

        mocha.it('should enforce specific cipher suite', async function() {
            config.TLS_CIPHERS = 'ECDHE-RSA-AES128-GCM-SHA256';
            const result = await create_tls_server_and_connect({ maxVersion: 'TLSv1.2' });
            assert.strictEqual(result.cipher.name, 'ECDHE-RSA-AES128-GCM-SHA256');
        });

        mocha.it('should enforce ecdhCurve P-256', async function() {
            config.TLS_CURVES = 'P-256';
            const result = await create_tls_server_and_connect({});
            console.log('Negotiated cipher:', result);
            assert.strictEqual(result.ephemeral.type, 'ECDH');
            assert.strictEqual(result.ephemeral.name, 'prime256v1');
        });

        /*TODO - re-enable once node supports KEM ephermal keys in tls.getEphemeralKeyInfo() - see
        https://nodejs.org/api/tls.html#tlssocketgetephemeralkeyinfo
        mocha.it('should enforce ecdhCurve X25519MLKEM768', async function() {
            config.TLS_CURVES = 'X25519MLKEM768';
            const result = await create_tls_server_and_connect({});
            assert.strictEqual(result.protocol, 'TLSv1.3');
            console.log('Negotiated cipher:', result);
            if (result.ephemeral.type) {
                assert.strictEqual(result.ephemeral.type, 'KEM');
                assert.strictEqual(result.ephemeral.name, 'x25519mlkem768');
            }
        });*/

        mocha.it('should enforce all TLS options combined', async function() {
            if (tls.DEFAULT_MAX_VERSION !== 'TLSv1.3') return;
            config.TLS_MIN_VERSION = 'TLSv1.3';
            config.TLS_CIPHERS = 'TLS_AES_256_GCM_SHA384';
            config.TLS_CURVES = 'X25519';
            const result = await create_tls_server_and_connect({ minVersion: 'TLSv1.3' });
            assert.strictEqual(result.protocol, 'TLSv1.3');
            assert.strictEqual(result.cipher.name, 'TLS_AES_256_GCM_SHA384');
        });
    });

});

/**
 * validate_configurable_tls_option_fields is a helper function to validate that the actual TLS config options match the expected TLS config options.
 * @param {*} actual_tls_config 
 * @param {*} expected_tls_config 
 */
function validate_configurable_tls_option_fields(actual_tls_config, expected_tls_config) {
    assert.strictEqual(actual_tls_config.minVersion, expected_tls_config.minVersion);
    assert.strictEqual(actual_tls_config.ciphers, expected_tls_config.ciphers);
    assert.strictEqual(actual_tls_config.ecdhCurve, expected_tls_config.ecdhCurve);
}
