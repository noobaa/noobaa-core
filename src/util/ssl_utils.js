/* Copyright (C) 2016 NooBaa */
'use strict';

const https = require('https');
const pem = require('pem');
const fs = require('fs');
const path = require('path');

const P = require('./promise');
const dbg = require('./debug_module')(__filename);

function get_ssl_certificate() {
    console.log('certificate location:', path.join('/etc', 'private_ssl_path', 'server.key'));
    if (fs.existsSync(path.join('/etc', 'private_ssl_path', 'server.key')) &&
        fs.existsSync(path.join('/etc', 'private_ssl_path', 'server.crt'))) {
        console.log('Using local certificate');
        var local_certificate = {
            key: fs.readFileSync(path.join('/etc', 'private_ssl_path', 'server.key')),
            cert: fs.readFileSync(path.join('/etc', 'private_ssl_path', 'server.crt'))
        };
        return local_certificate;
    } else {

        console.log('Generating self signed certificate');
        return P.fromCallback(callback => pem.createCertificate({
                days: 365 * 100,
                selfSigned: true
            }, callback))
            .then(cert => ({
                key: cert.serviceKey,
                cert: cert.certificate
            }));
    }
}

function validate_cert_and_key_match(cert, key) {
    return P.join(
        P.fromCallback(callback => pem.getModulus(cert, callback))
        .catch(err => {
            dbg.error('Can\'t read certificate file', err);
            throw new Error('Can\'t read certificate file');
        }),
        P.fromCallback(callback => pem.getModulus(key, callback))
        .catch(err => {
            dbg.error('Can\'t read private key file', err);
            throw new Error('Can\'t read private key file');
        })
    ).spread(function(cert_res, key_res) {
        if (cert_res.modulus !== key_res.modulus) {
            throw new Error('No match between key and certificate');
        }
    });
}

function test_certificate(cert, key) {
    // Helper function to validate that the newly added certification and private key provided can be used
    // with the webserver - it will start a dummy https server with the provided settings
    // and if for some reason the https server won't be able to start will reject the promise with the error
    const server_options = {
        key: key,
        cert: cert,
    };
    const server = https.createServer(server_options, (req, res) => {
        res.writeHead(200);
        res.end('Server is up');
    }); // starting the temp server
    return P.fromCallback(callback => server.listen(0, callback))
        .then(() => {
            dbg.log0('Testing on port', server.address().port);
            const client_options = {
                host: '127.0.0.1',
                port: server.address().port,
                path: '/',
                method: 'GET',
                rejectUnauthorized: false // won't throw exception if the user will upload self-signed ssl ceritificate
            };
            return new P((resolve, reject) => {
                try {
                    let rq = https.request(client_options, res => {
                        resolve(res);
                    });
                    rq.on('error', err => reject(err));
                    rq.end();
                } catch (err) {
                    reject(err);
                }
            });
        })
        .then(res => {
            dbg.log0('Result status code', res.statusCode);
            if (res.statusCode !== 200) { // just another checkup - will save error to log
                dbg.error('Expected Result code to be 200, got', res.statusCode);
            }
        })
        .catch(err => {
            dbg.error('The provided certificate could not be loaded', err);
            throw new Error('The provided certificate could not be loaded');
        })
        .finally(() => server.close());
}

exports.get_ssl_certificate = get_ssl_certificate;
exports.validate_cert_and_key_match = validate_cert_and_key_match;
exports.test_certificate = test_certificate;
