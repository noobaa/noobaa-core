/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const tls = require('tls');
const path = require('path');
const https = require('https');

const P = require('./promise');
const dbg = require('./debug_module')(__filename);
const nb_native = require('./nb_native');

const SERVER_SSL_DIR_PATH = path.join('/etc', 'private_ssl_path');
const SERVER_SSL_KEY_PATH = path.join(SERVER_SSL_DIR_PATH, 'server.key');
const SERVER_SSL_CERT_PATH = path.join(SERVER_SSL_DIR_PATH, 'server.crt');

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

function read_ssl_certificate() {
    return P.resolve()
        .then(() => P.props({
            key: fs.readFileAsync(SERVER_SSL_KEY_PATH, 'utf8'),
            cert: fs.readFileAsync(SERVER_SSL_CERT_PATH, 'utf8'),
        }))
        .then(certificate => {
            // check that these key and certificate are valid, matching and can be loaded before using them
            verify_ssl_certificate(certificate);
            dbg.log('Using local certificate');
            return certificate;
        })
        .catch(err => {
            if (err.code !== 'ENOENT') {
                dbg.error('Local SSL certificate failed to load', err.message);
                dbg.warn('Fallback to generating self-signed certificate...');
            }
            dbg.warn('Generating self-signed certificate');
            return generate_ssl_certificate();
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

exports.SERVER_SSL_DIR_PATH = SERVER_SSL_DIR_PATH;
exports.SERVER_SSL_KEY_PATH = SERVER_SSL_KEY_PATH;
exports.SERVER_SSL_CERT_PATH = SERVER_SSL_CERT_PATH;
exports.generate_ssl_certificate = generate_ssl_certificate;
exports.verify_ssl_certificate = verify_ssl_certificate;
exports.read_ssl_certificate = read_ssl_certificate;

if (require.main === module) run_https_test_server();
