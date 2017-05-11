/* Copyright (C) 2016 NooBaa */
'use strict';

const url = require('url');
const http = require('http');
const https = require('https');
const pem = require('pem');
const fs = require('fs');
const path = require('path');

const P = require('./promise');

/**
 * see https://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.24
 */
function match_etag(condition, etag) {

    // trim white space
    condition = condition.trim();

    // * matches any etag
    if (condition === '*') return true;

    // detect exact match, but only allow it if no commas at all
    if (condition === `"${etag}"` && !condition.includes(',')) return true;

    // split the condition on commas followed by proper quoted-string
    // the then compare to find any match
    return condition.split(/,(?=\s*"[^"]*"\s*)/)
        .some(c => c.trim() === `"${etag}"`);
}

/**
 * Get http / https agent according to protocol
 */
function get_unsecured_http_agent(endpoint) {
    const protocol = url.parse(endpoint).protocol;
    return protocol === "https:" ?
        new https.Agent({
            rejectUnauthorized: false,
        }) :
        new http.Agent();
}

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


exports.match_etag = match_etag;
exports.get_unsecured_http_agent = get_unsecured_http_agent;
exports.get_ssl_certificate = get_ssl_certificate;
