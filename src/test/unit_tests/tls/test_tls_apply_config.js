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

mocha.describe('apply_tls_config', function() {
    const saved_min_version = config.TLS_MIN_VERSION;
    const saved_ciphers = config.TLS_CIPHERS;
    const saved_groups = config.TLS_GROUPS;
    const saved_enabled_services = config.TLS_CONFIGURABLE_SERVERS;

    mocha.beforeEach(function() {
        config.TLS_MIN_VERSION = '';
        config.TLS_CIPHERS = '';
        config.TLS_GROUPS = '';
        config.TLS_CONFIGURABLE_SERVERS = ['S3', 'STS', 'IAM'];
    });

    mocha.afterEach(function() {
        config.TLS_MIN_VERSION = saved_min_version;
        config.TLS_CIPHERS = saved_ciphers;
        config.TLS_GROUPS = saved_groups;
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
        config.TLS_GROUPS = undefined;
        const options = { key: 'k', cert: 'c' };
        ssl_utils.apply_tls_config(options, 'S3');
        const expected_configurable_tls_config = { minVersion: undefined, ciphers: undefined, ecdhCurve: undefined };
        validate_configurable_tls_option_fields(options, expected_configurable_tls_config);
    });

    mocha.it('should set minVersion TLSv1.2', function() {
        config.TLS_MIN_VERSION = 'TLSv1.2';
        const options = {};
        ssl_utils.apply_tls_config(options, 'S3');
        validate_configurable_tls_option_fields(options, {
            minVersion: config.TLS_MIN_VERSION,
            ciphers: undefined,
            ecdhCurve: undefined
        });
    });

    mocha.it('should set minVersion TLSv1.3', function() {
        config.TLS_MIN_VERSION = 'TLSv1.3';
        const options = {};
        ssl_utils.apply_tls_config(options, 'S3');
        validate_configurable_tls_option_fields(options, {
            minVersion: config.TLS_MIN_VERSION,
            ciphers: undefined,
            ecdhCurve: undefined
        });
    });

    mocha.it('should set a single cipher', function() {
        config.TLS_CIPHERS = 'TLS_AES_256_GCM_SHA384';
        const options = {};
        ssl_utils.apply_tls_config(options, 'S3');
        validate_configurable_tls_option_fields(options, {
            minVersion: undefined,
            ciphers: config.TLS_CIPHERS,
            ecdhCurve: undefined
        });
    });

    mocha.it('should set multiple ciphers', function() {
        config.TLS_CIPHERS = 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384';
        const options = {};
        ssl_utils.apply_tls_config(options, 'S3');
        validate_configurable_tls_option_fields(options, {
            minVersion: undefined,
            ciphers: config.TLS_CIPHERS,
            ecdhCurve: undefined
        });
    });

    mocha.it('should set a single group via ecdhCurve', function() {
        config.TLS_GROUPS = 'P-256';
        const options = {};
        ssl_utils.apply_tls_config(options, 'S3');
        validate_configurable_tls_option_fields(options, {
            minVersion: undefined,
            ciphers: undefined,
            ecdhCurve: config.TLS_GROUPS
        });
    });

    mocha.it('should set multiple groups via ecdhCurve', function() {
        config.TLS_GROUPS = 'X25519:P-256:P-384';
        const options = {};
        ssl_utils.apply_tls_config(options, 'S3');
        validate_configurable_tls_option_fields(options, {
            minVersion: undefined,
            ciphers: undefined,
            ecdhCurve: config.TLS_GROUPS
        });
    });

    mocha.it('should set ecdhCurve as-is including PQC group names', function() {
        config.TLS_GROUPS = 'X25519MLKEM768:X25519:P-256';
        const options = {};
        ssl_utils.apply_tls_config(options, 'S3');
        validate_configurable_tls_option_fields(options, {
            minVersion: undefined,
            ciphers: undefined,
            ecdhCurve: config.TLS_GROUPS
        });
    });

    mocha.it('should set all TLS options together', function() {
        config.TLS_MIN_VERSION = 'TLSv1.2';
        config.TLS_CIPHERS = 'ECDHE-RSA-AES128-GCM-SHA256';
        config.TLS_GROUPS = 'X25519:P-256:X25519MLKEM768';
        const s3_options = {};
        ssl_utils.apply_tls_config(s3_options, 'S3');
        const sts_options = {};
        ssl_utils.apply_tls_config(sts_options, 'STS');
        const iam_options = {};
        ssl_utils.apply_tls_config(iam_options, 'IAM');

        const expected = {
            minVersion: config.TLS_MIN_VERSION,
            ciphers: config.TLS_CIPHERS,
            ecdhCurve: config.TLS_GROUPS
        };
        validate_configurable_tls_option_fields(s3_options, expected);
        validate_configurable_tls_option_fields(sts_options, expected);
        validate_configurable_tls_option_fields(iam_options, expected);
    });

    mocha.it('should preserve existing ssl_options properties', function() {
        config.TLS_MIN_VERSION = 'TLSv1.3';
        config.TLS_CIPHERS = 'TLS_AES_128_GCM_SHA256';
        config.TLS_GROUPS = 'X25519';
        const options = { key: 'my-key', cert: 'my-cert', honorCipherOrder: true };
        ssl_utils.apply_tls_config(options, 'S3');
        assert.strictEqual(options.key, 'my-key');
        assert.strictEqual(options.cert, 'my-cert');
        assert.strictEqual(options.honorCipherOrder, true);
        validate_configurable_tls_option_fields(options, {
            minVersion: config.TLS_MIN_VERSION,
            ciphers: config.TLS_CIPHERS,
            ecdhCurve: config.TLS_GROUPS
        });
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
    const saved_groups = config.TLS_GROUPS;

    mocha.beforeEach(function() {
        config.TLS_MIN_VERSION = '';
        config.TLS_CIPHERS = '';
        config.TLS_GROUPS = '';
    });

    mocha.afterEach(function() {
        config.TLS_MIN_VERSION = saved_min_version;
        config.TLS_CIPHERS = saved_ciphers;
        config.TLS_GROUPS = saved_groups;
    });

    /**
     * Creates an HTTPS server with a self-signed cert via ssl_utils.create_https_server,
     * connects a client with the given TLS options, and returns the negotiated
     * protocol, cipher, and ephemeral key info. The server is closed after the request.
     * @param {Object} client_options - TLS options passed to https.request
     * @param {Object} [cert_options] - options passed to nb_native().x509()
     * @returns {Promise<{protocol: string, cipher: Object, ephemeral: Object}>}
     */
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
                    const protocol = res.socket.getProtocol();
                    const cipher = res.socket.getCipher();
                    const ephemeral = res.socket.getEphemeralKeyInfo();
                    resolve({ protocol, cipher, ephemeral });
                    res.on('data', () => { /* drain */ });
                    res.on('end', () => { /* done */ });
                });
                req.end();
            });
        } catch (err) {
            assert.fail(`TLS server test failed: ${err.message}`);
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

    mocha.it('should enforce group P-256 via ecdhCurve', async function() {
        config.TLS_GROUPS = 'P-256';
        const result = await create_tls_server_and_connect({});
        assert.strictEqual(result.ephemeral.type, 'ECDH');
        assert.strictEqual(result.ephemeral.name, 'prime256v1');
    });

    /*TODO - re-enable once node supports KEM ephemeral keys in tls.getEphemeralKeyInfo() - see
    https://nodejs.org/api/tls.html#tlssocketgetephemeralkeyinfo
    mocha.it('should enforce group X25519MLKEM768 via ecdhCurve', async function() {
        config.TLS_GROUPS = 'X25519MLKEM768';
        const result = await create_tls_server_and_connect({});
        assert.strictEqual(result.protocol, 'TLSv1.3');
        if (result.ephemeral.type) {
            assert.strictEqual(result.ephemeral.type, 'KEM');
            assert.strictEqual(result.ephemeral.name, 'x25519mlkem768');
        }
    });*/

    mocha.it('should enforce all TLS options combined', async function() {
        if (tls.DEFAULT_MAX_VERSION !== 'TLSv1.3') return;
        config.TLS_MIN_VERSION = 'TLSv1.3';
        config.TLS_CIPHERS = 'TLS_AES_256_GCM_SHA384';
        config.TLS_GROUPS = 'X25519';
        const result = await create_tls_server_and_connect({ minVersion: 'TLSv1.3' });
        assert.strictEqual(result.protocol, 'TLSv1.3');
        assert.strictEqual(result.cipher.name, 'TLS_AES_256_GCM_SHA384');
    });
});

/**
 * Asserts that the configurable TLS fields (minVersion, ciphers, ecdhCurve)
 * on the actual config object match the expected values.
 * @param {Object} actual_tls_config - the options object after apply_tls_config
 * @param {{minVersion: string|undefined, ciphers: string|undefined, ecdhCurve: string|undefined}} expected_tls_config
 */
function validate_configurable_tls_option_fields(actual_tls_config, expected_tls_config) {
    assert.strictEqual(actual_tls_config.minVersion, expected_tls_config.minVersion);
    assert.strictEqual(actual_tls_config.ciphers, expected_tls_config.ciphers);
    assert.strictEqual(actual_tls_config.ecdhCurve, expected_tls_config.ecdhCurve);
}
