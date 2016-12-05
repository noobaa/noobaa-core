/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const net = require('net');
const path = require('path');
const http = require('http');
const mocha = require('mocha');
// const assert = require('assert');
const express = require('express');

const P = require('../../util/promise');
const signature_utils = require('../../util/signature_utils');


mocha.describe('signature_utils', function() {

    const AWS4_TESTSUITE_DIR = path.join(__dirname, 'aws4_testsuite', 'aws4_testsuite');
    const SAMPLES_SECRET_KEY = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';

    const app = express();
    const http_server = http.createServer(app);
    app.use(handle_signed_request);

    mocha.before(function() {
        return new P((resolve, reject) =>
            http_server
            .once('listening', resolve)
            .once('error', reject)
            .listen());
    });

    mocha.after(function() {
        http_server.close();
    });

    add_tests_from_dir(AWS4_TESTSUITE_DIR);

    function add_tests_from_dir(dir) {
        const test_name = path.basename(dir);
        const signed_req_file = path.join(dir, test_name + '.sreq');

        if (test_name === 'get-header-value-multiline') {
            console.log('Skipping', test_name,
                '- the multiline header test is broken canonical request is wrong !@#');
            return;
        }

        // if (test_name === 'post-sts-token' ||
        //     test_name === 'normalize-path') {
        //     console.log('Skipping:', name, '- this test is not trivial and has a readme');
        //     throw err;
        // }

        if (!fs.existsSync(signed_req_file)) {
            try {
                const entries = fs.readdirSync(dir);
                for (const entry of entries) {
                    add_tests_from_dir(path.join(dir, entry));
                }
            } catch (err) {
                if (err.code !== 'ENOTDIR') throw err;
            }
            return;
        }

        mocha.it(test_name, function() {
            console.log('Test:', test_name);
            const signed_req_buf = fs.readFileSync(signed_req_file);
            return send_signed_request(signed_req_buf);
        });
    }

    function send_signed_request(signed_req_buf) {
        const socket = net.connect({
            port: http_server.address().port
        }, () => {
            if (true) {
                socket.write(signed_req_buf);
                socket.write('\n\n');
                return;
            }
            const eol = signed_req_buf.indexOf('\n');
            const rest = signed_req_buf.slice(eol);
            const parts = signed_req_buf
                .slice(0, eol)
                .toString('utf8')
                .match(/^(\S+) (\S+) (\S+)$/);
            const method = parts[1];
            const vers = parts[3];
            const qpos = parts[2].indexOf('?');
            const pathname = qpos < 0 ? parts[2] : parts[2].slice(0, qpos);
            const search = qpos < 0 ? '' : parts[2].slice(qpos);
            const url_enc = encodeURI(pathname) +
                (search ? '?' + search
                    .slice(1)
                    .split('&')
                    .map(x => x
                        .split('=').map(encodeURIComponent).join('=')
                    )
                    .join('&') :
                    '');
            console.log('Sending:', method, search, url_enc, vers, rest.toString());
            socket.write(method);
            socket.write(' ');
            socket.write(url_enc);
            socket.write(' ');
            socket.write(vers);
            socket.write(rest);
            socket.write('\n\n');
        });
        let reply = '';
        return new P((resolve, reject) => socket
                .setEncoding('utf8')
                .on('data', data => {
                    reply += data;
                })
                .once('error', reject)
                .once('end', resolve)
            )
            .then(() => {
                socket.destroy();
                console.log('REPLY:', reply);
                if (!reply.startsWith('HTTP/1.1 200 OK')) {
                    throw new Error(reply);
                }
            });
    }

    function handle_signed_request(req, res) {
        console.log('Handling:', req.method, req.originalUrl, req.query, req.headers);
        res.set('Connection', 'close');
        try {
            signature_utils.authenticate_request(req);
            const signature = signature_utils.signature({
                secret_key: SAMPLES_SECRET_KEY,
                access_key: req.access_key,
                string_to_sign: req.string_to_sign,
                noobaa_v4: req.noobaa_v4,
            });
            if (signature !== req.signature) {
                throw new Error('Signature mismatch');
            }
            const reply = _.pick(req,
                'access_key',
                'signature',
                'noobaa_v4',
                'string_to_sign'
            );
            res.json(reply);
        } catch (err) {
            console.error('SIGNATURE ERROR', err.stack);
            res.statusCode = 500;
            res.end();
        }
    }

});
