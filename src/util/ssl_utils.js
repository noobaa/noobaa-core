/* Copyright (C) 2016 NooBaa */
'use strict';

const config = require('../../config');
const fs = require('fs');
const tls = require('tls');
const path = require('path');
const https = require('https');
const Semaphore = require('../util/semaphore');
const dbg = require('./debug_module')(__filename);
const nb_native = require('./nb_native');
const { EventEmitter } = require('events');

class CertInfo extends EventEmitter {

    constructor(dir) {
        super();
        this.dir = dir;
        this.cert = null;
        this.is_loaded = false;
        this.is_generated = false;
        this.sem = new Semaphore(1);
    }

    async file_notification(event, filename) {
        try {
            const cert_on_disk = await _read_ssl_certificate(this.dir);
            if (this.cert.key === cert_on_disk.key) {
                return;
            }

            this.cert = cert_on_disk;
            this.is_generated = false;

            this.emit('update', this);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                dbg.warn(`SSL certificate failed to update from dir ${this.dir}:`, err.message);
            }
        }
    }
}

const certs = {
    MGMT: new CertInfo(config.MGMT_SERVICE_CERT_PATH),
    S3: new CertInfo(config.S3_SERVICE_CERT_PATH),
    EXTERNAL_DB: new CertInfo(config.EXTERNAL_DB_SERVICE_CERT_PATH),
    STS: new CertInfo(config.STS_SERVICE_CERT_PATH),
    IAM: new CertInfo(config.IAM_SERVICE_CERT_PATH),
    METRICS: new CertInfo(config.S3_SERVICE_CERT_PATH) // metric server will use the S3 cert.
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
async function get_ssl_cert_info(service, nsfs_config_root) {
    let cert_info;
    if ((service === 'S3' || service === 'METRICS') && nsfs_config_root) {
        const nsfs_ssl_cert_dir = path.join(nsfs_config_root, 'certificates/');
        cert_info = new CertInfo(nsfs_ssl_cert_dir);
    } else {
        cert_info = certs[service];
    }
    if (!cert_info) {
        throw new Error(`Invalid service name, got: ${service}`);
    }

    if (cert_info.is_loaded) {
        return cert_info;
    }

    return cert_info.sem.surround(async () => {
        if (cert_info.is_loaded) {
            return cert_info;
        }

        try {
            cert_info.cert = await _read_ssl_certificate(cert_info.dir);
            cert_info.is_generated = false;
            dbg.log0(`SSL certificate loaded from dir ${cert_info.dir}`);

        } catch (err) {
            if (err.code === 'ENOENT') {
                dbg.log0(`SSL certificate not found in dir ${cert_info.dir} for service ${service}`);
            } else {
                dbg.error(`SSL certificate failed to load from dir ${cert_info.dir}:`, err.message);
            }
            if (service !== 'EXTERNAL_DB') {
                dbg.warn(`Generating self-signed SSL certificate for ${service}`);
                cert_info.cert = generate_ssl_certificate();
                cert_info.is_generated = true;
            }
        }

        cert_info.is_loaded = true;

        try {
            fs.watch(cert_info.dir, {}, cert_info.file_notification.bind(cert_info));
        } catch (err) {
            if (err.code === 'ENOENT') {
                dbg.warn("Certificate folder ", cert_info.dir, " does not exist. New certificate won't be loaded.");
            } else {
                dbg.error("Failed to watch certificate dir ", cert_info.dir, ". err = ", err);
            }
        }

        return cert_info;
    });
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

function get_cert_dir(service) {
    const cert_info = certs[service];
    if (!cert_info) {
        throw new Error(`Invalid service name, got: ${service}`);
    }

    return cert_info.dir;
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

// An internal function to prevent code duplication
async function create_https_server(ssl_cert_info, honorCipherOrder, endpoint_handler) {
    const ssl_options = {...ssl_cert_info.cert, honorCipherOrder: honorCipherOrder};
    return https.createServer(ssl_options, endpoint_handler);
}

exports.generate_ssl_certificate = generate_ssl_certificate;
exports.verify_ssl_certificate = verify_ssl_certificate;
exports.get_ssl_cert_info = get_ssl_cert_info;
exports.is_using_generated_certs = is_using_generated_certs;
exports.get_cert_dir = get_cert_dir;
exports.create_https_server = create_https_server;

if (require.main === module) run_https_test_server();
