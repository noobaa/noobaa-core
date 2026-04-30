/* Copyright (C) 2016 NooBaa */
'use strict';

const https = require('https');
const http_utils = require('../../../util/http_utils');

/**
 * Starts an HTTPS server on a random port using http_utils.start_https_server,
 * the same function called by endpoint.js for every service type.
 * @param {string} service_type
 * @returns {Promise<{server: import('https').Server, port: number}>}
 */
async function start_endpoint_https_server(service_type) {
    const handler = (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ service: service_type, ok: true }));
    };
    const server = await http_utils.start_https_server(0, service_type, handler);
    return { server, port: server.address().port };
}

/**
 * Makes a TLS request to localhost on the given port.
 * Returns protocol, cipher, ephemeral key info, status code, and body.
 * @param {number} port
 * @param {Object} [client_tls_options]
 * @returns {Promise<{statusCode: number, protocol: string, cipher: Object, ephemeral: Object, body: string}>}
 */
function make_tls_request(port, client_tls_options = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            method: 'GET',
            hostname: 'localhost',
            port,
            path: '/',
            rejectUnauthorized: false,
            timeout: 3000,
            ...client_tls_options,
        });
        req.on('error', err => reject(new Error(`TLS request failed on port ${port}: ${err.message}`)));
        req.on('timeout', () => req.destroy(new Error(`TLS request timed out on port ${port}`)));
        req.on('response', res => {
            const protocol = res.socket.getProtocol();
            const cipher = res.socket.getCipher();
            const ephemeral = res.socket.getEphemeralKeyInfo();
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve({ statusCode: res.statusCode, protocol, cipher, ephemeral, body: data }));
        });
        req.end();
    });
}

exports.start_endpoint_https_server = start_endpoint_https_server;
exports.make_tls_request = make_tls_request;
