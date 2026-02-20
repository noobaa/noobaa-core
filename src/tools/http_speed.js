/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const stream = require('stream');
const ssl_utils = require('../util/ssl_utils');
const semaphore = require('../util/semaphore');
const http_utils = require('../util/http_utils');
const Speedometer = require('../util/speedometer');
const buffer_utils = require('../util/buffer_utils');
const stream_utils = require('../util/stream_utils');

require('../util/console_wrapper').original_console();

const size_units_mult = Object.freeze({
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
});

argv.server = Boolean(argv.server);
argv.client = argv.client === true ? 'localhost' : argv.client;
argv.port = Number(argv.port) || 50505;
argv.ssl = Boolean(argv.ssl);
argv.forks = Number(argv.forks ?? 1);
argv.time = Number(argv.time ?? 60);
argv.hash = argv.hash ? String(argv.hash) : '';
argv.size = Number(argv.size ?? 1);
argv.size_units = argv.size_units || 'MB';
const size_bytes = argv.size * (size_units_mult[argv.size_units] || 1);
argv.buf = Number(argv.buf || size_bytes); // in Bytes
argv.method ||= 'GET';
argv.concur = Number(argv.concur ?? 1);
argv.nodelay = Boolean(argv.nodelay);

if (argv.help) usage();
if (!argv.server && !argv.client) {
    console.error('Missing --client or --server');
    usage();
}
if (argv.method !== 'GET' && argv.method !== 'PUT') {
    console.error('Invalid method:', argv.method);
    usage();
}

function usage() {
    console.log(`
    Client Usage: --client <host> [--port X] [--ssl] [--forks X] [--hash sha256] [--buf X (Bytes)] [--size X (MB)] [--concur X] [--method GET|PUT]

    Server Usage: --server        [--port X] [--ssl] [--forks X] [--hash sha256] [--buf X (Bytes)] [--size X (MB)]
    `);
    process.exit(1);
}

const buffers_pool_sem = new semaphore.Semaphore(8 * argv.concur * size_bytes, {
    timeout: 2 * 60 * 1000,
    timeout_error_code: 'HTTP_SPEED_BUFFER_POOL_TIMEOUT',
    warning_timeout: 10 * 60 * 1000,
});
const buffers_pool = new buffer_utils.BuffersPool({
    buf_size: argv.buf,
    sem: buffers_pool_sem,
    warning_timeout: 2 * 60 * 1000,
});

// set keep alive to make sure we don't reconnect between requests
// @ts-ignore
http.globalAgent.keepAlive = true;
// @ts-ignore
https.globalAgent.keepAlive = true;
const http_agent = argv.ssl ?
    new https.Agent({ keepAlive: true }) :
    new http.Agent({ keepAlive: true });

const speedometer = new Speedometer({
    name: 'HTTP',
    argv,
    num_workers: argv.forks,
    workers_func,
});
speedometer.start();

async function workers_func() {
    return argv.server ? run_server() : run_client();
}

async function run_server() {
    /** @type {http.ServerOptions} */
    const http_options = {
        ...ssl_utils.generate_ssl_certificate(),
        keepAlive: true,
        highWaterMark: 8 * argv.buf,
        noDelay: argv.nodelay,
    };
    const http_server = argv.ssl ?
        https.createServer(http_options) :
        http.createServer(http_options);
    await new Promise((resolve, reject) => http_server
        .on('close', resolve)
        .on('error', reject)
        .on('listening', () => {
            console.log('HTTP server listening on port', argv.port, '...');
        })
        .on('connection', http_utils.http_server_connections_logger)
        .on('request', handle_request)
        .listen(argv.port)
    );
}

/**
 * @param {http.IncomingMessage} req 
 * @param {http.ServerResponse} res 
 */
async function handle_request(req, res) {
    try {
        await speedometer.measure(async () => {
            req.on('error', err => {
                console.error('HTTP server request error', err.message);
            });
            res.on('error', err => {
                console.error('HTTP server response error', err.message);
            });
            if (req.method === 'GET') {
                res.setHeader('Content-Length', size_bytes);
                await write(res, size_bytes);
            } else if (req.method === 'PUT') {
                await read(req);
            } else {
                throw new Error('HTTP server request method not supported');
            }
            res.end();
            await stream.promises.finished(res);
        });
    } catch (err) {
        if (err.code !== 'ECONNRESET') {
            console.error('HTTP server error', err.message);
        }
        req.destroy();
        res.destroy();
    }
}

async function run_client() {
    await Promise.all(Array(argv.concur).fill(0).map(run_client_loop));
}

async function run_client_loop() {
    const end_time = Date.now() + (argv.time * 1000);
    while (Date.now() < end_time) {
        await speedometer.measure(make_request);
    }
}

async function make_request() {
    const req = (argv.ssl ? https : http).request({
        agent: http_agent,
        port: argv.port,
        hostname: argv.client,
        method: argv.method,
        // we allow self generated certificates to avoid public CA signing:
        rejectUnauthorized: false,
    });

    // create the promise before sending the request to already attach the event handlers
    const res_promise = new Promise((resolve, reject) => req
        .on('error', reject)
        .on('response', resolve)
    );

    req.chunkedEncoding = false;
    if (argv.nodelay) req.setNoDelay(true);
    if (argv.method === 'PUT') {
        req.setHeader('Content-Length', size_bytes);
        await write(req, size_bytes);
    }
    req.end();

    // wait for response
    /** @type {http.IncomingMessage} */
    const res = await res_promise;
    if (res.statusCode !== 200) {
        throw new Error(`HTTP client response status ${res.statusCode}`);
    }

    await read(res);
}

/**
 * @param {import('stream').Writable} writable 
 */
async function write(writable, size) {
    const hasher = argv.hash && crypto.createHash(argv.hash);
    let n = 0;
    await buffers_pool.use_buffer(async buffer => {
        while (n < size) {
            if (buffer.length > size - n) {
                buffer = buffer.subarray(0, size - n);
            }
            if (hasher) hasher.update(buffer);
            const ok = writable.write(buffer);
            if (!ok) {
                await stream_utils.wait_drain(writable);
            }
            n += buffer.length;
            speedometer.update(buffer.length);
        }
    });
}

/**
 * @param {import('stream').Readable} readable 
 */
async function read(readable) {
    const hasher = argv.hash && crypto.createHash(argv.hash);
    for await (const data of readable) {
        if (hasher) hasher.update(data);
        speedometer.update(data.length);
    }
}
