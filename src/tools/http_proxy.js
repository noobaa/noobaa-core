'use strict';

let http = require('http');
let https = require('https');
let url = require('url');
let argv = require('minimist')(process.argv);
let pem = require('../util/pem');

// see https://en.wikipedia.org/wiki/URL_redirection#HTTP_status_codes_3xx
const STATUS_CODES_3XX = {
    MOVED_PERMANENTLY: 301, // HTTP/1.0 equivalent of permanent redirect
    FOUND: 302, // HTTP/1.0 equivalent of temporary redirect
    SEE_OTHER: 303, // HTTP/1.1 force GET
    TEMPORARY_REDIRECT: 307, // HTTP/1.1 redirect GET/POST
    PERMANENT_REDIRECT: 308, // HTTP/1.1 redirect GET/POST
};
const REDIRECT_STATUS_CODE = STATUS_CODES_3XX.TEMPORARY_REDIRECT;

exports.proxy_port = proxy_port;
exports.proxy_request = proxy_request;
exports.forward_request = forward_request;

if (require.main === module) {
    main();
}

function main() {
    argv.host = argv.host || '127.0.0.1';
    argv.port = parseInt(argv.port, 10) || 80;
    argv.port2 = parseInt(argv.port2, 10) || 6001;
    proxy_port(argv.port, 'http://' + argv.host + ':' + argv.port2);
    if (argv.ssl || argv.ssl2) {
        argv.ssl = parseInt(argv.ssl, 10) || 443;
        argv.ssl2 = parseInt(argv.ssl2, 10) || 6443;
        pem.createCertificate({
            days: 365 * 100,
            selfSigned: true
        }, function(err, cert) {
            if (err) throw err;
            proxy_port(argv.ssl, 'https://' + argv.host + ':' + argv.ssl2, cert);
        });
    }
}

function proxy_port(port, address, cert) {
    let addr_url = url.parse(address);
    let server = (addr_url.protocol === 'https:' ?
            https.createServer({
                key: cert.serviceKey,
                cert: cert.certificate
            }) : http.createServer())
        .on('request', (req, res) => {
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
    console.log(req.method, req.url);
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Credentials', true);
        res.setHeader('Access-Control-Allow-Methods',
            req.headers['access-control-request-method'] ||
            'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers',
            req.headers['access-control-request-headers'] ||
            'Content-Type, Authorization, ETag, X-Amz-User-Agent, X-Amz-Date, X-Amz-Content-Sha256');
        // must answer 200 to options requests
        res.writeHead(200);
        res.end();
    } else if (req.method === 'GET' || req.method === 'POST') {
        res.writeHead(REDIRECT_STATUS_CODE, {
            Location: addr_url.href + req.url
        });
        res.end();
    } else {
        forward_request(addr_url, req, res);
    }
}

function forward_request(addr_url, req, res) {
    req.on('error', err => on_error(err));
    res.on('error', err => on_error(err));
    let res2;
    let req2 = (addr_url.protocol === 'https:' ? https : http)
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
        if (!res.headersSent) {
            res.writeHead(500, 'HTTP PROXY ERROR');
            res.end();
        } else {
            console.error('HTTP PROXY ERROR: headers already sent, so just closing', err);
            res.close();
            // TODO can we handle better?
        }
    }
}
