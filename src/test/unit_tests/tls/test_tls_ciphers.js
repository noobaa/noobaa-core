/* Copyright (C) 2016 NooBaa */
/* eslint-disable max-lines-per-function */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const { execSync } = require('child_process');

const config = require('../../../../config');
const ssl_utils = require('../../../util/ssl_utils');
const { start_endpoint_https_server, make_tls_request } = require('./tls_utils');

/**
 * Tests that configured TLS cipher suites are actually negotiated
 * during a real TLS handshake against a live HTTPS server.
 *
 * ECDHE-ECDSA ciphers require an ECDSA certificate — the default RSA cert
 * from nb_native().x509() won't work — so a separate cert is generated.
 */

const TLS13_CIPHERS = [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
];

const ECDHE_RSA_CIPHERS = [
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-CHACHA20-POLY1305',
];

const ECDHE_ECDSA_CIPHERS = [
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-ECDSA-CHACHA20-POLY1305',
];

/**
 * Generates a self-signed ECDSA certificate (prime256v1) for localhost.
 * ECDHE-ECDSA ciphers require the server to hold an ECDSA private key
 * so it can sign the TLS key exchange. The default cert from nb_native().x509()
 * is RSA, so the server cannot perform ECDSA signatures with it and the
 * handshake fails. This function provides an ECDSA key pair for that purpose.
 * @returns {{key: string, cert: string}} PEM-encoded private key and certificate
 */
function generate_ecdsa_cert() {
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecdsa-'));
    const key_path = path.join(tmpdir, 'key.pem');
    const cert_path = path.join(tmpdir, 'cert.pem');
    execSync(
        `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1` +
        ` -keyout "${key_path}" -out "${cert_path}" -days 1 -nodes` +
        ` -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost"`,
        { stdio: 'pipe' }
    );
    const key = fs.readFileSync(key_path, 'utf8');
    const cert = fs.readFileSync(cert_path, 'utf8');
    fs.rmSync(tmpdir, { recursive: true });
    return { key, cert };
}

/**
 * Starts an HTTPS server using the provided ECDSA certificate via
 * ssl_utils.create_https_server, listening on a random port.
 * @param {{key: string, cert: string}} ecdsa_cert
 * @param {string} [service] - service name passed to create_https_server (default: 'S3')
 * @returns {Promise<{server: import('https').Server, port: number}>}
 */
async function start_ecdsa_server(ecdsa_cert, service = 'S3') {
    const server = await ssl_utils.create_https_server(
        { cert: ecdsa_cert }, true, (req, res) => res.end('ok'), service
    );
    await new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, resolve);
    });
    return { server, port: server.address().port };
}

mocha.describe('TLS cipher negotiation', function() {

    const saved_ciphers = config.TLS_CIPHERS;
    const ecdsa_cert = generate_ecdsa_cert();

    mocha.afterEach(function() {
        config.TLS_CIPHERS = saved_ciphers;
    });

    for (const service of config.TLS_CONFIGURABLE_SERVERS) {

        mocha.describe(`${service} service`, function() {

            mocha.describe('TLS 1.3 ciphers', function() {

                for (const cipher_name of TLS13_CIPHERS) {
                    mocha.it(`should negotiate ${cipher_name}`, async function() {
                        config.TLS_CIPHERS = cipher_name;
                        const { server, port } = await start_endpoint_https_server(service);
                        try {
                            const res = await make_tls_request(port, { ciphers: cipher_name });
                            assert.strictEqual(res.cipher.name, cipher_name);
                        } catch (err) {
                            assert.fail(`Unexpected error negotiating ${cipher_name}: ${err.message}`);
                        } finally {
                            server.close();
                        }
                    });
                }
            });

            mocha.describe('ECDHE-RSA ciphers', function() {

                for (const cipher_name of ECDHE_RSA_CIPHERS) {
                    mocha.it(`should negotiate ${cipher_name}`, async function() {
                        config.TLS_CIPHERS = cipher_name;
                        const { server, port } = await start_endpoint_https_server(service);
                        try {
                            const res = await make_tls_request(port, {
                                maxVersion: 'TLSv1.2',
                                ciphers: cipher_name,
                            });
                            assert.strictEqual(res.cipher.name, cipher_name);
                        } catch (err) {
                            assert.fail(`Unexpected error negotiating ${cipher_name}: ${err.message}`);
                        } finally {
                            server.close();
                        }
                    });
                }
            });

            mocha.describe('ECDHE-ECDSA ciphers', function() {

                for (const cipher_name of ECDHE_ECDSA_CIPHERS) {
                    mocha.it(`should negotiate ${cipher_name}`, async function() {
                        config.TLS_CIPHERS = cipher_name;
                        const { server, port } = await start_ecdsa_server(ecdsa_cert, service);
                        try {
                            const res = await make_tls_request(port, {
                                maxVersion: 'TLSv1.2',
                                ciphers: cipher_name,
                            });
                            assert.strictEqual(res.cipher.name, cipher_name);
                        } catch (err) {
                            assert.fail(`Unexpected error negotiating ${cipher_name}: ${err.message}`);
                        } finally {
                            server.close();
                        }
                    });
                }
            });
        });
    }
});
