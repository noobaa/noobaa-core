/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const tls = require('tls');
const path = require('path');
const https = require('https');
const dbg = require('./debug_module')(__filename);
const nb_native = require('./nb_native');

const SSL_CERTS_DIR_PATHS = Object.freeze({
    MGMT: '/etc/mgmt-secret',
    S3: '/etc/s3-secret'
});

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

async function read_ssl_certificate(service) {
    if (!service || !Object.keys(SSL_CERTS_DIR_PATHS).includes(service)) {
        throw new Error(`Invalid service name, got: ${service}`);
    }

    try {
        const key_path = path.join(SSL_CERTS_DIR_PATHS[service], 'tls.key');
        const cert_path = path.join(SSL_CERTS_DIR_PATHS[service], 'tls.crt');
        const certificate = {
            key: await fs.readFileAsync(key_path, 'utf8'),
            cert: await fs.readFileAsync(cert_path, 'utf8'),
        };

        verify_ssl_certificate(certificate);
        dbg.log('Using local certificate');
        return certificate;

    } catch (err) {
        if (err.code !== 'ENOENT') {
            dbg.error('Local SSL certificate failed to load', err.message);
            dbg.warn('Fallback to generating self-signed certificate...');
        }
        dbg.warn('Generating self-signed certificate');
        return generate_ssl_certificate();
    }
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

exports.SSL_CERTS_DIR_PATHS = SSL_CERTS_DIR_PATHS;
exports.generate_ssl_certificate = generate_ssl_certificate;
exports.verify_ssl_certificate = verify_ssl_certificate;
exports.read_ssl_certificate = read_ssl_certificate;

if (require.main === module) run_https_test_server();
