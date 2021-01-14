/* Copyright (C) 2016 NooBaa */
'use strict';

const url = require('url');
const http = require('http');
const https = require('https');
const ssl_utils = require('../util/ssl_utils');

// see https://en.wikipedia.org/wiki/URL_redirection#HTTP_status_codes_3xx
const STATUS_CODES_3XX = {
    MOVED_PERMANENTLY: 301, // HTTP/1.0 equivalent of permanent redirect
    FOUND: 302, // HTTP/1.0 equivalent of temporary redirect
    SEE_OTHER: 303, // HTTP/1.1 force GET
    TEMPORARY_REDIRECT: 307, // HTTP/1.1 redirect GET/POST
    PERMANENT_REDIRECT: 308, // HTTP/1.1 redirect GET/POST
};
const REDIRECT_STATUS_CODE = STATUS_CODES_3XX.FOUND;

if (require.main === module) {
    main();
}

function main() {
    // eslint-disable-next-line global-require
    const argv = require('minimist')(process.argv);
    argv.host = argv.host || 'localhost';
    argv.port = Number(argv.port) || 80;
    argv.port2 = Number(argv.port2) || 6001;
    proxy_port(argv.port, 'http://' + argv.host + ':' + argv.port2);
    if (argv.ssl || argv.ssl2) {
        argv.ssl = Number(argv.ssl) || 443;
        argv.ssl2 = Number(argv.ssl2) || 6443;
        proxy_port(argv.ssl, 'https://' + argv.host + ':' + argv.ssl2);
    }
}

function proxy_port(port, address) {
    const addr_url = url.parse(address);
    const server = addr_url.protocol === 'https:' ?
        https.createServer(ssl_utils.generate_ssl_certificate()) :
        http.createServer();
    server.on('request', (req, res) => {
            proxy_request(addr_url, req, res);
        })
        .on('error', err => {
            console.error('HTTP PROXY: server error', port, '->', address, err.stack || err);
        })
        .listen(port, () => {
            console.log('HTTP PROXY: listening', port, '->', address, '...');
        });
    return server;
}

function proxy_request(addr_url, req, res) {
    switch (req.method) {
        case 'OPTIONS':
            return options_request(addr_url, req, res);
        case 'GET':
        case 'HEAD':
        case 'POST':
            return redirect_request(addr_url, req, res);
        default:
            return forward_request(addr_url, req, res);
    }
}

function redirect_request(addr_url, req, res) {
    const location = url.resolve(addr_url.href, req.url);
    console.log(req.method, req.url, '->', REDIRECT_STATUS_CODE, location);
    res.writeHead(REDIRECT_STATUS_CODE, {
        Location: location
    });
    res.end();
}

function forward_request(addr_url, req, res) {
    req.on('error', err => on_error(err));
    res.on('error', err => on_error(err));
    let res2;
    const req2 = (addr_url.protocol === 'https:' ? https : http)
        .request({
            protocol: addr_url.protocol,
            hostname: addr_url.hostname,
            port: addr_url.port,
            method: req.method,
            path: req.url,
            headers: req.headers,
            auth: req.auth,
            // we allow self generated certificates to avoid public CA signing:
            rejectUnauthorized: false,
        })
        .on('error', err => on_error(err))
        .on('response', res2_arg => {
            res2 = res2_arg;
            res2.on('error', err => on_error(err));
            if (res2.statusCode >= 400) {
                console.warn(req.method, req.url, res2.statusCode, '(HTTP PROXY)');
            }
            res.writeHead(res2.statusCode, res2.headers);
            res2.pipe(res);
        });
    req.pipe(req2);

    function on_error(err) {
        console.error('HTTP PROXY ERROR:', err);
        req.close();
        if (req2) req2.close();
        if (res2) res2.close();
        if (res.headersSent) {
            console.error('HTTP PROXY ERROR: headers already sent, so just closing', err);
            res.close();
            // TODO can we handle better?
        } else {
            res.writeHead(500, 'HTTP PROXY ERROR');
            res.end();
        }
    }
}

function options_request(addr_url, req, res) {
    // TODO this implementation is not generic, need to ask options from the target server
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Methods',
        req.headers['access-control-request-method'] ||
        'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] ||
        'Content-Type,Content-MD5,Authorization,ETag,X-Amz-User-Agent,X-Amz-Date,X-Amz-Content-Sha256');
    // must answer 200 to options requests
    console.log(req.method, req.url, '->', 200);
    res.writeHead(200);
    res.end();
}

exports.proxy_port = proxy_port;
exports.redirect_request = redirect_request;
exports.forward_request = forward_request;
exports.options_request = options_request;
