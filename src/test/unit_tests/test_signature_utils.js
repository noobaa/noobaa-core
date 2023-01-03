/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const fs = require('fs');
const url = require('url');
const net = require('net');
const path = require('path');
const http = require('http');
const mocha = require('mocha');
const crypto = require('crypto');

const signature_utils = require('../../util/signature_utils');

function log(...args) {
    if (process.env.SUPPRESS_LOGS) return;
    console.log(...args);
}

mocha.describe('signature_utils', function() {

    const SIG_TEST_SUITE = path.join(__dirname, 'signature_test_suite');

    const SECRETS = {
        'AKIDEXAMPLE': 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
        '123': 'abc',
    };

    const http_server = http.createServer(accept_signed_request);

    mocha.before(function() {
        return new Promise((resolve, reject) =>
            http_server
                .once('listening', resolve)
                .once('error', reject)
                .listen());
    });

    mocha.after(function() {
        http_server.close();
    });

    add_tests_from(path.join(SIG_TEST_SUITE, 'aws4_testsuite'), '.sreq');
    add_tests_from(path.join(SIG_TEST_SUITE, 'awscli'), '.sreq');
    add_tests_from(path.join(SIG_TEST_SUITE, 'awssdkjs'), '.sreq');
    add_tests_from(path.join(SIG_TEST_SUITE, 'awssdknodejs'), '.sreq');
    add_tests_from(path.join(SIG_TEST_SUITE, 'awssdkjava'), '.sreq');
    add_tests_from(path.join(SIG_TEST_SUITE, 'awssdkruby2'), '.sreq');
    add_tests_from(path.join(SIG_TEST_SUITE, 'cyberduck'), '.sreq');
    add_tests_from(path.join(SIG_TEST_SUITE, 'postman'), '.sreq');
    add_tests_from(path.join(SIG_TEST_SUITE, 'presigned'), '.sreq');
    add_tests_from(path.join(SIG_TEST_SUITE, 'rgw'), '.sreq');

    function add_tests_from(fname, extension) {

        // try to read it as a directory,
        // if not a directory assume its a file
        try {
            const entries = fs.readdirSync(fname);
            for (const entry of entries) {
                add_tests_from(path.join(fname, entry), extension);
            }
            return;
        } catch (err) {
            if (err.code !== 'ENOTDIR') throw err;
        }

        const test_name = path.basename(fname);

        if (extension && !fname.endsWith(extension)) {
            return;
        }

        if (test_name === 'get-header-value-multiline.sreq') {
            console.warn('Skipping', test_name, '- the multiline header test is broken');
            return;
        }

        if (test_name === 'post-vanilla-query-space.sreq') {
            console.warn('Skipping', test_name, '- the query space test is broken');
            return;
        }

        mocha.it(test_name, function() {
            log('Test:', test_name);
            const request_data = fs.readFileSync(fname);
            return send_signed_request(request_data);
        });
    }

    const LF = '\n';
    const LF2 = '\n\n';
    const CRLF = '\r\n';
    const CRLF2 = '\r\n\r\n';

    /**
     * Fixing the buffer from file in git to include CRLF line endings for the http headers section.
     * @param {Buffer} buf
     * @returns {Buffer}
     */
    function fix_http_crlf(buf) {
        const index_lf2 = buf.indexOf(LF2);
        const index_crlf2 = buf.indexOf(CRLF2);
        const end_lf2 = index_lf2 >= 0 ? index_lf2 + LF2.length : buf.length;
        const end_crlf2 = index_crlf2 >= 0 ? index_crlf2 + CRLF2.length : buf.length;
        const end = Math.min(end_lf2, end_crlf2);
        const header = buf.slice(0, end)
            .toString()
            .replaceAll(CRLF, LF)
            .replaceAll(LF, CRLF)
            .trimEnd();
        const body = buf.slice(end);
        return Buffer.concat([Buffer.from(header), Buffer.from(CRLF2), body]);
    }

    /**
     * send_signed_request is the client function
     * that takes a raw http request dump of a signed http request,
     * and sends it to the http server for verification.
     * @param {Buffer} signed_req_buf
     */
    async function send_signed_request(signed_req_buf) {
        const server_addr = /** @type {net.AddressInfo} */ (http_server.address());
        const socket = net.connect({ port: server_addr.port });
        const http_req_buf = fix_http_crlf(signed_req_buf);
        socket.write(http_req_buf);
        let reply = '';
        await new Promise((resolve, reject) => socket
            .setEncoding('utf8')
            .on('data', data => { reply += data; })
            .once('error', reject)
            .once('end', resolve)
        );
        socket.destroy();
        reply = reply.trim();
        log('REPLY:', reply);
        const CONT = 'HTTP/1.1 100 Continue';
        if (reply.startsWith(CONT)) {
            reply = reply.slice(CONT.length).trim();
        }
        if (reply.startsWith('HTTP/1.1 200 OK')) {
            return;
        }
        throw new Error('BAD REPLY: ' + reply);
    }

    /**
     * accept_signed_request is the server function
     * that receives the signed http request, calculates signature
     * and checks if the signature is correct
     */
    async function accept_signed_request(req, res) {
        try {
            let body_len = 0;
            req.originalUrl = req.url;
            const parsed_url = url.parse(req.originalUrl, true);
            req.url = parsed_url.pathname;
            req.query = parsed_url.query;
            const virtual_hosted_bucket = req.headers.host.split('.', 1)[0];
            if ((/[a-zA-Z][a-zA-Z0-9]*/).test(virtual_hosted_bucket)) {
                req.virtual_hosted_bucket = virtual_hosted_bucket;
            }
            res.setHeader('Connection', 'close');
            if (req.method === 'OPTIONS') return res.end();
            log(
                'Handle:', req.method, req.originalUrl,
                'query', req.query,
                'headers', req.headers);
            const hasher = crypto.createHash('sha256');
            await new Promise((resolve, reject) => req
                .on('data', data => {
                    hasher.update(data);
                    body_len += data.length;
                    log(`Request body length so far ${body_len}`);
                })
                .once('end', resolve)
                .once('error', reject)
            );
            const sha256_buf = hasher.digest();
            log(`Request body ended body length ${body_len} sha256 ${sha256_buf.toString('hex')}`);
            const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';
            const STREAMING_PAYLOAD = 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';
            const content_sha256_hdr = req.headers['x-amz-content-sha256'];
            req.content_sha256_sig = req.query['X-Amz-Signature'] ?
                UNSIGNED_PAYLOAD :
                content_sha256_hdr;
            if (typeof content_sha256_hdr === 'string' &&
                content_sha256_hdr !== UNSIGNED_PAYLOAD &&
                content_sha256_hdr !== STREAMING_PAYLOAD) {
                req.content_sha256_buf = Buffer.from(content_sha256_hdr, 'hex');
                if (req.content_sha256_buf.length !== 32) {
                    throw new Error('InvalidDigest');
                }
            }
            if (req.content_sha256_buf) {
                if (Buffer.compare(req.content_sha256_buf, sha256_buf)) {
                    throw new Error('XAmzContentSHA256Mismatch');
                }
            } else {
                req.content_sha256_buf = sha256_buf;
                if (!req.content_sha256_sig) req.content_sha256_sig = req.content_sha256_buf.toString('hex');
            }
            const auth_token = signature_utils.make_auth_token_from_request(req);
            const signature = signature_utils.get_signature_from_auth_token(auth_token, SECRETS[auth_token.access_key]);
            log('auth_token', auth_token, 'signature', signature);
            if (signature !== auth_token.signature) {
                throw new Error('Signature mismatch');
            }
            res.end(JSON.stringify(auth_token));

        } catch (err) {
            console.error('SIGNATURE ERROR', err.stack);
            res.statusCode = 500;
            res.end();
        }
    }

});
