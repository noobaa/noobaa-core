/* Copyright (C) 2016 NooBaa */
'use strict';

const mocha = require('mocha');
const assert = require('assert');

const config = require('../../../../config');
const os_utils = require('../../../util/os_utils');
const { start_endpoint_https_server, make_tls_request } = require('./tls_utils');

/**
 * Tests that configured TLS groups (ecdhCurve) are actually negotiated
 * during a real TLS handshake against a live HTTPS server.
 *
 * Standard ECDH groups are verified via getEphemeralKeyInfo().
 * PQC/hybrid groups use openssl s_client since Node.js TLS client
 * does not yet support all hybrid KEM groups.
 */

const STANDARD_GROUPS = ['X25519', 'secp256r1', 'secp384r1', 'secp521r1'];

const PQC_GROUPS = [
    'X25519MLKEM768',
    'SecP256r1MLKEM768',
    'SecP384r1MLKEM1024',
];

mocha.describe('TLS group negotiation', function() {

    const saved_groups = config.TLS_GROUPS;

    mocha.afterEach(function() {
        config.TLS_GROUPS = saved_groups;
    });

    mocha.describe('standard ECDH groups', function() {

        for (const group of STANDARD_GROUPS) {
            mocha.it(`should negotiate group ${group}`, async function() {
                config.TLS_GROUPS = group;
                const { server, port } = await start_endpoint_https_server('S3');
                try {
                    const res = await make_tls_request(port);
                    assert.strictEqual(res.ephemeral.type, 'ECDH');
                    // Node.js getEphemeralKeyInfo() reports secp256r1 as 'prime256v1' (ANSI name),
                    // all other groups use the same name as the OpenSSL group name.
                    const expected_name = group === 'secp256r1' ? 'prime256v1' : group;
                    assert.strictEqual(res.ephemeral.name, expected_name);
                } catch (err) {
                    assert.fail(`Unexpected error negotiating group ${group}: ${err.message}`);
                } finally {
                    server.close();
                }
            });
        }
    });

    mocha.describe('PQC/hybrid groups', function() {

        for (const group of PQC_GROUPS) {
            mocha.it(`should negotiate group ${group}`, async function() {
                config.TLS_GROUPS = group;

                const { server, port } = await start_endpoint_https_server('S3');
                try {
                    const negotiated = await make_openssl_request(port, group);
                    assert.ok(
                        negotiated.includes(group),
                        `Expected negotiated group to contain ${group} but got: ${negotiated}`
                    );
                } catch (err) {
                    assert.fail(`Failed to negotiate PQC group ${group}: ${err.message}`);
                } finally {
                    server.close();
                }
            });
        }
    });
});

/**
 * Connects to localhost:{port} using openssl s_client with the given TLS group
 * and TLS 1.3. Returns the negotiated group name parsed from the output.
 * Used for PQC/hybrid groups that Node.js TLS client cannot negotiate directly.
 * @param {number} port
 * @param {string} group - TLS group name (e.g. 'X25519MLKEM768')
 * @returns {Promise<string>} the negotiated group name
 */
async function make_openssl_request(port, group) {
    const output = await os_utils.exec(
        `openssl s_client -connect localhost:${port} -groups ${group} -tls1_3 < /dev/null 2>&1`,
        { timeout: 5000, return_stdout: true, ignore_rc: true }
    ) || '';
    if ((/handshake failure|alert number/i).test(output)) {
        throw new Error(`openssl handshake failure:\n${output.substring(0, 500)}`);
    }
    const group_match = output.match(/Server Temp Key:\s*(.+)/) ||
        output.match(/Negotiated group:\s*(\S+)/) ||
        output.match(/Negotiated TLS[\d.]+ group:\s*(\S+)/);
    if (!group_match) {
        throw new Error(`Could not determine negotiated group. Output:\n${output.substring(0, 500)}`);
    }
    return group_match[1];
}
