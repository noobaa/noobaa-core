/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');

const config = require('../../../../config');
const { start_endpoint_https_server, make_tls_request } = require('./tls_utils');

/**
 * Tests that endpoint HTTPS servers correctly enforce TLS_MIN_VERSION.
 *
 * The tests use http_utils.start_https_server (the same function called by
 * endpoint.js for every service type) and verify that clients using a protocol
 * version below the configured minimum are rejected.
 */
mocha.describe('endpoint TLS min version', function() {

    const saved_min_version = config.TLS_MIN_VERSION;

    mocha.afterEach(function() {
        config.TLS_MIN_VERSION = saved_min_version;
    });

    for (const service of config.TLS_CONFIGURABLE_SERVERS) {

        mocha.describe(`${service} service`, function() {

            mocha.it('should accept TLS 1.2 and TLS 1.3 when TLS_MIN_VERSION is not set', async function() {
                config.TLS_MIN_VERSION = '';
                const { server, port } = await start_endpoint_https_server(service);
                try {
                    const res12 = await make_tls_request(port, { maxVersion: 'TLSv1.2' });
                    assert.strictEqual(res12.protocol, 'TLSv1.2');

                    const res13 = await make_tls_request(port, { minVersion: 'TLSv1.3' });
                    assert.strictEqual(res13.protocol, 'TLSv1.3');
                } finally {
                    await new Promise(resolve => server.close(resolve));
                }
            });

            mocha.it('should accept TLS 1.2 and TLS 1.3 when TLS_MIN_VERSION is TLSv1.2', async function() {
                config.TLS_MIN_VERSION = 'TLSv1.2';
                const { server, port } = await start_endpoint_https_server(service);
                try {
                    const res12 = await make_tls_request(port, { maxVersion: 'TLSv1.2' });
                    assert.strictEqual(res12.protocol, 'TLSv1.2');

                    const res13 = await make_tls_request(port, { minVersion: 'TLSv1.3' });
                    assert.strictEqual(res13.protocol, 'TLSv1.3');
                } finally {
                    await new Promise(resolve => server.close(resolve));
                }
            });

            mocha.it('should accept only TLS 1.3 when TLS_MIN_VERSION is TLSv1.3', async function() {
                config.TLS_MIN_VERSION = 'TLSv1.3';
                const { server, port } = await start_endpoint_https_server(service);
                try {
                    const res13 = await make_tls_request(port, { minVersion: 'TLSv1.3' });
                    assert.strictEqual(res13.protocol, 'TLSv1.3');

                    await assert.rejects(
                        () => make_tls_request(port, { maxVersion: 'TLSv1.2' }),
                        /TLSV1_ALERT_PROTOCOL_VERSION|ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION|tlsv1 alert protocol version|handshake failure/i
                    );
                } finally {
                    await new Promise(resolve => server.close(resolve));
                }
            });

            mocha.it('should verify negotiated protocol version matches expectation', async function() {
                config.TLS_MIN_VERSION = 'TLSv1.2';
                const { server, port } = await start_endpoint_https_server(service);
                try {
                    const res12 = await make_tls_request(port, {
                        minVersion: 'TLSv1.2',
                        maxVersion: 'TLSv1.2',
                    });
                    assert.strictEqual(res12.protocol, 'TLSv1.2');

                    const res13 = await make_tls_request(port, {
                        minVersion: 'TLSv1.3',
                        maxVersion: 'TLSv1.3',
                    });
                    assert.strictEqual(res13.protocol, 'TLSv1.3');
                } finally {
                    await new Promise(resolve => server.close(resolve));
                }
            });
        });
    }

    mocha.describe('FORK_HEALTH service (excluded from TLS config)', function() {

        mocha.it('should accept TLS 1.2 even when TLS_MIN_VERSION is TLSv1.3', async function() {
            config.TLS_MIN_VERSION = 'TLSv1.3';
            const { server, port } = await start_endpoint_https_server('FORK_HEALTH');
            try {
                const res = await make_tls_request(port, { maxVersion: 'TLSv1.2' });
                assert.strictEqual(res.protocol, 'TLSv1.2');
            } finally {
                await new Promise(resolve => server.close(resolve));
            }
        });
    });
});
