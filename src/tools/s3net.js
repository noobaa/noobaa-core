/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const net = require('net');
const argv = require('minimist')(process.argv);

const dbg = require('../util/debug_module')(__filename);
const signature_utils = require('../util/signature_utils');
dbg.original_console();

const MB = 1024 * 1024;
const CRLF = '\r\n';
const CRLFx2 = `${CRLF}${CRLF}`;

s3net(argv);

/**
 * s3net() performs S3 request using raw network socket.
 * 
 * The reason we need such a tool is to check issues with content-length
 * that are otherwise rejected immediately by the nodejs http parser.
 * 
 * Request Flags:
 * --host 10.11.12.13
 * --port 9999
 * --bucket
 * --key
 * --method GET|PUT|...
 * --body
 * --access_key
 * --secret_key
 * --headers.Range 'bytes=123-456' for ranged read.
 */
async function s3net(req) {

    // authorize the request by setting defaults and calculating authorization header
    signature_utils.authorize_client_request(req);

    // set the connection header to close after the one request-response
    // so that we can wait for the 'close' event on the connection.
    req.headers.Connection = 'close';

    const conn = net.connect({
        host: req.host,
        port: req.port,
    });

    const close_promise = new Promise((resolve, reject) => {
        conn.on('error', reject);
        conn.on('close', resolve);
    });

    const res = {
        statusCode: 0,
        statusMessage: '',
        reading_headers: true,
        headers_text: '',
        headers: {},
        body_length: 0,
        body_buffers: [],
        last_body_len_print: 0,
        output: null,
    };

    if (req.output === true) {
        res.output = process.stdout;
    } else if (req.output) {
        res.output = fs.createWriteStream(req.output);
    }

    conn.on('data', data => (
        res.reading_headers ?
        read_headers(res, data) :
        read_body(res, data)
    ));

    // write request
    console.log('\n*** REQUEST', '*'.repeat(60));
    console.log(`${req.method} ${req.path} HTTP/1.1`);
    conn.write(`${req.method} ${req.path} HTTP/1.1${CRLF}`);
    for (const h of Object.keys(req.headers)) {
        console.log(`${h}: ${req.headers[h]}`);
        conn.write(`${h}: ${req.headers[h]}${CRLF}`);
    }
    console.log('');
    conn.write(CRLF);
    if (req.body) {
        console.log(req.body);
        conn.write(req.body);
        console.log('');
    }

    // wait for the connection to close
    await close_promise;

    const expected = parseInt(res.headers['content-length'], 10);
    if (expected === res.body_length) {
        console.log('\n*** BODY LENGTH IS GOOD! ***\n');
    } else {
        console.error('');
        console.error('$'.repeat(60));
        console.error('$'.repeat(60));
        console.error('$ ERROR: BAD BODY LENGTH. expected', expected, 'got', res.body_length);
        console.error('$'.repeat(60));
        console.error('$'.repeat(60));
        console.error('');
    }

    conn.destroy();
}

function read_headers(res, data) {

    // append to headers_text and lookup end of headers (CRLFx2)
    const headers_end_from_pos = Math.max(0, res.headers_text.length - 4);
    res.headers_text += data.toString();
    const pos = res.headers_text.indexOf(CRLFx2, headers_end_from_pos);
    if (pos < 0) return; // still no end of headers
    const body_buf = data.slice(pos + 4);
    const headers_text = res.headers_text.slice(0, pos);
    res.headers_text = null;
    res.reading_headers = false;

    const lines = headers_text.split(CRLF);
    const status_line = lines[0].match(/HTTP\/1.1 (\d+) (.*)$/);
    if (status_line) {
        res.statusCode = parseInt(status_line[1], 10);
        res.statusMessage = status_line[2];
    }
    for (const line of lines.slice(1)) {
        const [key, val] = line.split(':');
        res.headers[key.trim().toLowerCase()] = val.trim();
    }

    console.log('\n*** RESPONSE', '*'.repeat(60));
    console.log(headers_text);
    console.log('');
    if (!res.output) console.log('[[ Body output suppressed, use --output to print ]]');
    read_body(res, body_buf);
}

function read_body(res, data) {
    res.body_length += data.length;
    if (res.output) {
        res.output.write(data);
    } else if (res.body_length >= res.last_body_len_print + MB) {
        res.last_body_len_print += MB;
        console.log('RESPONSE BODY LENGTH', res.body_length);
    }
}
