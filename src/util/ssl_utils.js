/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('./promise');
const fs = require('fs');
const tls = require('tls');
const path = require('path');
const https = require('https');
const Semaphore = require('../util/semaphore');
const dbg = require('./debug_module')(__filename);
const nb_native = require('./nb_native');

const SSL_CERTS_DIR_PATHS = Object.freeze({
    MGMT: '/etc/mgmt-secret',
    S3: '/etc/s3-secret'
});

let certs = null;
let using_generated_certs = true;

const certs_read_sem = new Semaphore(1);

function generate_ssl_certificate() {
    const ssl_cert = nb_native().x509();
    // TODO we should add honorCipherOrder here, but prefer to schedule it to next major version.
    // return { ...ssl_cert, honorCipherOrder: true };
    return ssl_cert;
}

function verify_ssl_certificate(certificate) {
    // check that these key and certificate are valid, matching and can be loaded before using them
    // throws if invalid
    tls.createSecureContext(certificate);
}

// Get SSL certificates from local memroy.
async function get_ssl_certificates() {
    if (certs !== null) {
        return certs;
    }

    return certs_read_sem.surround(async () => {
        if (certs !== null) {
            return certs;
        }

        try {
            certs = await _read_ssl_certificates();
            using_generated_certs = false;
            dbg.log0('Using mounted certificates');

        } catch (err) {
            if (err.code !== 'ENOENT') {
                dbg.error('One or more SSL certificates failed to load', err.message);
                dbg.warn('Fallback to generating self-signed certificates...');
            }

            dbg.warn('Generating self-signed certificates');
            certs = Object.keys(SSL_CERTS_DIR_PATHS)
                .reduce((c, service_name) => {
                        c[service_name] = generate_ssl_certificate();
                        return c;
                }, {});
            using_generated_certs = true;
        }

        return certs;
    });
}

async function get_ssl_certificate(service) {
    const all_certificates = await get_ssl_certificates();
    const certificate = all_certificates[service] || null;
    if (certificate === null) {
        throw new Error(`Invalid service name, got: ${service}`);
    }

    return certificate;
}

function update_certs_from_disk() {
    return certs_read_sem.surround(async () => {
        try {
            const certs_on_disk = await _read_ssl_certificates();
            if (_compare_with_loaded_certs(certs_on_disk)) {
                return false;
            }

            certs = certs_on_disk;
            using_generated_certs = false;
            return true;

        } catch (err) {
            if (err.code !== 'ENOENT') {
                dbg.warn('One or more SSL certificates failed to load', err.message);
            }
            return false;
        }
    });
}

// Read SSL certificates form disk
// This func is designed to throw in case there are not certificated on disk or that
// loaded certs cannot be verified.
function _read_ssl_certificates() {
    return P.props(
        _.mapValues(SSL_CERTS_DIR_PATHS, async dir => {
            const key_path = path.join(dir, 'tls.key');
            const cert_path = path.join(dir, 'tls.crt');
            const certificate = {
                key: await fs.promises.readFile(key_path, 'utf8'),
                cert: await fs.promises.readFile(cert_path, 'utf8')
            };

            verify_ssl_certificate(certificate);
            dbg.log2(`Certificate read successfuly from ${dir}`);
            return certificate;
        })
    );
}

function is_using_generated_certs() {
    return using_generated_certs;
}

function _compare_with_loaded_certs(new_certs) {
    if (!certs || using_generated_certs) {
        return false;
    }

    return Object.entries(certs).every(pair => {
        const [service_name, service_cert] = pair;
        return service_cert.key === new_certs[service_name].key;
    });
}

// create a default certificate and start an https server to test it in the browser
function run_https_test_server() {
    const server = https.createServer(generate_ssl_certificate());
    server.on('request', (req, res) => {
        res.end(JSON.stringify(req.headers, null, 4));
    });
    server.on('listening', () => {
        const { port } = server.address();
        console.log('');
        console.log('');
        console.log(`     --->  https://localhost:${port}  <----`);
        console.log('');
        console.log('');
    });
    server.listen();
}

exports.generate_ssl_certificate = generate_ssl_certificate;
exports.verify_ssl_certificate = verify_ssl_certificate;
exports.get_ssl_certificates = get_ssl_certificates;
exports.get_ssl_certificate = get_ssl_certificate;
exports.is_using_generated_certs = is_using_generated_certs;
exports.update_certs_from_disk = update_certs_from_disk;

if (require.main === module) run_https_test_server();
