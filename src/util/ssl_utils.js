/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const tls = require('tls');
const path = require('path');
const https = require('https');
const Semaphore = require('../util/semaphore');
const dbg = require('./debug_module')(__filename);
const nb_native = require('./nb_native');

const init_cert_info = dir => ({
    dir,
    cert: null,
    is_loaded: false,
    is_generated: false,
    sem: new Semaphore(1)
});

const certs = {
    MGMT: init_cert_info('/etc/mgmt-secret'),
    S3: init_cert_info('/etc/s3-secret'),
};

function generate_ssl_certificate() {
    const ssl_cert = nb_native().x509();
    // TODO we should add honorCipherOrder here, but prefer to schedule it to next major version.
    // return { ...ssl_cert, honorCipherOrder: true };
    return ssl_cert;
}

function verify_ssl_certificate(certificate) {
    // createSecureContext checks that the certificate is valid and can be used,
    // or throws error if invalid
    tls.createSecureContext(certificate);
}

// Get SSL certificate (load once then serve from cache)
function get_ssl_certificate(service) {
    const cert_info = certs[service];
    if (!cert_info) {
        throw new Error(`Invalid service name, got: ${service}`);
    }

    if (cert_info.is_loaded) {
        return cert_info.cert;
    }

    return cert_info.sem.surround(async () => {
        if (cert_info.is_loaded) {
            return cert_info.cert;
        }

        try {
            cert_info.cert = await _read_ssl_certificate(cert_info.dir);
            cert_info.is_generated = false;
            dbg.log0(`SSL certificate loaded from dir ${cert_info.dir}`);

        } catch (err) {
            if (err.code === 'ENOENT') {
                dbg.log0(`SSL certificate not found in dir ${cert_info.dir}`);
            } else {
                dbg.error(`SSL certificate failed to load from dir ${cert_info.dir}:`, err.message);
            }
            dbg.warn(`Generating self-signed SSL certificate for ${service}`);
            cert_info.cert = generate_ssl_certificate();
            cert_info.is_generated = true;
        }

        cert_info.is_loaded = true;
        return cert_info.cert;
    });
}

// For each cert that was loaded into memory we check if the cert was changed on disk.
// If so we update it. If any of the certs was updated we return true else we return false.
async function update_certs_from_disk() {
    const promiseList = Object.values(certs).map(cert_info =>
        cert_info.sem.surround(async () => {
            if (!cert_info.is_loaded) {
                return false;
            }

            try {
                const cert_on_disk = await _read_ssl_certificate(cert_info.dir);
                if (cert_info.cert.key === cert_on_disk.key) {
                    return false;
                }

                cert_info.cert = cert_on_disk;
                cert_info.is_generated = false;
                return true;

            } catch (err) {
                if (err.code !== 'ENOENT') {
                    dbg.warn(`SSL certificate failed to update from dir ${cert_info.dir}:`, err.message);
                }
                return false;
            }
        })
    );

    const updatedList = await Promise.all(promiseList);
    return updatedList.some(Boolean);
}

// Read SSL certificate form disk
// This func is designed to throw in case there are not certificated on disk or that
// loaded certs cannot be verified.
async function _read_ssl_certificate(dir) {
    const [key, cert] = await Promise.all([
        fs.promises.readFile(path.join(dir, 'tls.key'), 'utf8'),
        fs.promises.readFile(path.join(dir, 'tls.crt'), 'utf8')
    ]);

    const certificate = { key, cert };
    verify_ssl_certificate(certificate);
    dbg.log2(`SSL certificate read successfuly from ${dir}`);
    return certificate;
}

function is_using_generated_certs() {
    return Object.values(certs).some(cert_info =>
        cert_info.is_loaded && cert_info.is_generated
    );
}

// create a default certificate and start an https server to test it in the browser
function run_https_test_server() {
    const server = https.createServer(generate_ssl_certificate());
    server.on('request', (req, res) => {
        res.end(JSON.stringify(req.headers, null, 4));
    });
    server.on('listening', () => {
        const { port } = /** @type {import('net').AddressInfo} */ (server.address());
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
exports.get_ssl_certificate = get_ssl_certificate;
exports.is_using_generated_certs = is_using_generated_certs;
exports.update_certs_from_disk = update_certs_from_disk;

if (require.main === module) run_https_test_server();
