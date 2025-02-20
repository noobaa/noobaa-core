/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const ssl_utils = require('../util/ssl_utils');
const semaphore = require('../util/semaphore');
const Speedometer = require('../util/speedometer');
const buffer_utils = require('../util/buffer_utils');

require('../util/console_wrapper').original_console();

const size_units_mult = {
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
};

// common
argv.port = Number(argv.port) || 50505;
argv.ssl = Boolean(argv.ssl);
argv.forks = argv.forks || 1;
// client
argv.client = argv.client === true ? 'localhost' : argv.client;
argv.method ||= 'GET';
argv.size = argv.size || 100;
argv.size_units = argv.size_units || 'MB';
const size_bytes = argv.size * (size_units_mult[argv.size_units] || 1);
argv.buf = Math.min(argv.buf || 128 * 1024, size_bytes); // in Bytes
argv.concur = argv.concur || 1;
// server
argv.server = Boolean(argv.server);
argv.hash = argv.hash ? String(argv.hash) : '';

// set keep alive to make sure we don't reconnect between requests
// @ts-ignore
http.globalAgent.keepAlive = true;
// @ts-ignore
https.globalAgent.keepAlive = true;
const http_agent = argv.ssl ?
    new https.Agent({ keepAlive: true }) :
    new http.Agent({ keepAlive: true });

const buffers_pool_sem = new semaphore.Semaphore(1024 * 1024 * 1024, {
    timeout: 2 * 60 * 1000,
    timeout_error_code: 'HTTP_SPEED_BUFFER_POOL_TIMEOUT',
    warning_timeout: 10 * 60 * 1000,
});
const buffers_pool = new buffer_utils.BuffersPool({
    buf_size: argv.buf,
    sem: buffers_pool_sem,
    warning_timeout: 2 * 60 * 1000,
});

if (argv.exit) setTimeout(() => process.exit(), Number(argv.exit) * 1000);

const speedometer = new Speedometer('HTTP');
speedometer.run_workers(argv.forks, main, argv);

function main() {
    if (argv.help) {
        return usage();
    }
    if (argv.server) {
        return run_server();
    }
    if (argv.client) {
        return run_client();
    }
    return usage();
}

function usage() {
    console.log(`
    Client Usage: --client <host> [--port X] [--ssl] [--forks X] [--size X (MB)] [--buf X (Bytes)] [--concur X] [--method GET|PUT]

    Server Usage: --server        [--port X] [--ssl] [--forks X] [--hash sha256]
    `);
}

function run_server() {
    const http_options = { ...ssl_utils.generate_ssl_certificate(), keepAlive: true };
    const http_server = argv.ssl ? https.createServer(http_options) : http.createServer(http_options);

    http_server.on('error', err => {
        console.error('HTTP server error', err.message);
        process.exit();
    })
        .on('close', () => {
            console.error('HTTP server closed');
            process.exit();
        })
        .on('listening', () => {
            console.log('HTTP server listening on port', argv.port, '...');
        })
        .on('connection', conn => {
            // @ts-ignore
            const fd = conn._handle.fd;
            console.log(`HTTP connection accepted (fd ${fd})`);
            conn.once('close', () => {
                console.log(`HTTP connection closed (fd ${fd})`);
            });
        })
        .on('request', handle_request)
        .listen(argv.port);
}

/**
 * 
 * @param {http.IncomingMessage} req 
 * @param {http.ServerResponse} res 
 */
function handle_request(req, res) {
    const start_time = process.hrtime.bigint();
    req.on('error', err => {
        console.error('HTTP server request error', err.message);
        process.exit();
    });
    res.on('error', err => {
        console.error('HTTP server response error', err.message);
        process.exit();
    });

    if (req.method === 'GET') {
        run_sender(res);
        res.once('finish', () => {
            const took_ns = Number(process.hrtime.bigint() - start_time);
            speedometer.add_op(took_ns / 1e6);
        });
    } else if (req.method === 'PUT') {
        req.once('end', () => {
            res.end();
            const took_ns = Number(process.hrtime.bigint() - start_time);
            speedometer.add_op(took_ns / 1e6);
        });
        run_receiver(req);
    } else {
        res.statusCode = 405;
        res.end('Method Not Allowed');
        throw new Error('HTTP server request method not supported');
    }
}

function run_client() {
    for (let i = 0; i < argv.concur; ++i) {
        setImmediate(send_request);
    }
}

function send_request() {
    const start_time = process.hrtime.bigint();
    const req = (argv.ssl ? https : http)
        .request({
            agent: http_agent,
            port: argv.port,
            hostname: argv.client,
            method: argv.method,
            path: '/http_speed',
            headers: {
                'content-type': 'application/octet-stream',
            },
            // we allow self generated certificates to avoid public CA signing:
            rejectUnauthorized: false,
        })
        .once('error', err => {
            console.error('HTTP client request error', err.message);
            process.exit();
        })
        .once('response', res => {
            if (res.statusCode !== 200) {
                console.error('HTTP client response status', res.statusCode);
                process.exit();
            }
            res.once('error', err => {
                console.error('HTTP client response error', err.message);
                process.exit();
            });
            res.once('end', () => {
                const took_ns = Number(process.hrtime.bigint() - start_time);
                speedometer.add_op(took_ns / 1e6);
            });
            res.once('end', send_request);

            if (argv.method === 'GET') {
                run_receiver(res);
            } else {
                res.on('data', data => { /* noop */ });
            }
        });

    if (argv.method === 'GET') {
        req.end();
    } if (argv.method === 'PUT') {
        run_sender(req);
    }
}

/**
 * @param {import('stream').Writable} writable 
 */
function run_sender(writable) {
    const req_size = size_bytes;
    let n = 0;

    writable.on('drain', send);
    send();

    async function send() {
        let ok = true;
        while (ok && n < req_size) {
            // const buffer = Buffer.allocUnsafe(Math.min(buf_size, req_size - n));
            let { buffer, callback } = await buffers_pool.get_buffer();
            if (buffer.length > req_size - n) buffer = buffer.subarray(0, req_size - n);
            ok = writable.write(buffer, callback);
            n += buffer.length;
            speedometer.update(buffer.length);
        }
        if (n >= req_size) writable.end();
    }
}

/**
 * @param {import('stream').Readable} readable 
 */
function run_receiver(readable) {
    const hasher = argv.hash && crypto.createHash(argv.hash);
    readable.on('data', data => {
        if (hasher) hasher.update(data);
        speedometer.update(data.length);
    });
}
