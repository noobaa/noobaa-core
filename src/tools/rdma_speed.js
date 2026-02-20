/* Copyright (C) 2025 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const http = require('http');
const https = require('https');
const assert = require('assert');
const events = require('events');
const setImmediateAsync = require('timers/promises').setImmediate;
const querystring = require('querystring');
const nb_native = require('../util/nb_native');
const ssl_utils = require('../util/ssl_utils');
const { Semaphore } = require('../util/semaphore');
const Speedometer = require('../util/speedometer');
const buffer_utils = require('../util/buffer_utils');

require('../util/console_wrapper').original_console();

const size_units_mult = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
};

// set keep alive to make sure we don't reconnect between requests
// @ts-ignore
http.globalAgent.keepAlive = true;
// @ts-ignore
https.globalAgent.keepAlive = true;
// const http_agent = argv.ssl ?
//     new https.Agent({ keepAlive: true }) :
//     new http.Agent({ keepAlive: true });

argv.ip ||= '172.16.0.61';
argv.port ||= 18515;
argv.op ||= "GET";
argv.key ||= "/rdma_speed";
argv.forks ||= 1;
argv.concur ||= 1;

argv.size ||= 16;
argv.pool_size ||= (4 * argv.size);
argv.size_units ||= 'MB';
const size_mult = size_units_mult[argv.size_units] || 1;
const size_bytes = argv.size * size_mult;
const pool_bytes = argv.pool_size * size_mult;

if (argv.help) usage();

/** @type {nb.CuObjServerNapi} */
let rdma_server;

const FILL_GET = 'G'.charCodeAt(0);
const FILL_PUT = 'P'.charCodeAt(0);
const FILL_CLIENT = 'C'.charCodeAt(0);
const FILL_SERVER = 'S'.charCodeAt(0);

const buffers_pool_sem = new Semaphore(pool_bytes, {
    timeout: 2 * 60 * 1000,
    timeout_error_code: 'RDMA_BUFFER_POOL_TIMEOUT',
    warning_timeout: 10 * 60 * 1000,
});
const buffers_pool = new buffer_utils.BuffersPool({
    buf_size: size_bytes,
    sem: buffers_pool_sem,
    warning_timeout: 2 * 60 * 1000,
    buffer_alloc: size => {
        const buf = nb_native().fs.dio_buffer_alloc(size);
        if (rdma_server) rdma_server.register_buffer(buf);
        return buf;
    },
});

const speedometer = new Speedometer({
    name: 'RDMA',
    argv,
    num_workers: argv.forks,
    workers_func,
});
speedometer.start();

async function workers_func() {
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
    Client Usage: --client --ip 1.1.1.1 --port 12345 [--ssl] [--forks X] [--concur X] [--op GET|PUT] [--size X] [--size_units MB]

    Server Usage: --server --ip 1.1.1.1 --port 12345 [--ssl] [--forks X]
    `);
    process.exit(1);
}

async function run_server() {
    const { CuObjServerNapi } = nb_native();
    rdma_server = new CuObjServerNapi({
        ip: argv.ip,
        port: 0, // every fork will get a different port
        log_level: 'ERROR',
    });
    console.log('RDMA server:', argv.ip, argv.port);

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
        .on('request', run_server_request)
        .listen(argv.port);

    await events.once(http_server, 'close');
}


async function run_server_request(req, res) {
    const start_time = process.hrtime.bigint();

    const op_type = req.method === 'GET' ? 'GET' : 'PUT';
    const op_key = String(req.url);
    const parsed_info = querystring.parse(String(req.headers['x-rdma-info']));
    const rdma_info = {
        desc: String(parsed_info.desc),
        addr: String(parsed_info.addr),
        size: Number(parsed_info.size),
        offset: Number(parsed_info.offset),
    };

    let ret_size = 0;
    let buffer_pool_cleanup;
    try {
        const pooled_buffer = await buffers_pool.get_buffer();
        const buffer = pooled_buffer.buffer;
        buffer_pool_cleanup = pooled_buffer.callback;

        if (argv.fill && op_type === 'GET') {
            buffer.fill(FILL_GET);
        }

        ret_size = await rdma_server.rdma(
            op_type,
            op_key,
            rdma_info.desc,
            0,
            buffer,
            0,
            buffer.length,
        );

        if (argv.fill && op_type === 'PUT') {
            assert.strictEqual(buffer[0], FILL_PUT);
            assert.strictEqual(buffer[buffer.length - 1], FILL_PUT);
            buffer.fill(FILL_SERVER);
        }

        res.statusCode = 200;
        res.setHeader('x-rdma-reply', String(ret_size));
        res.end();

    } finally {
        if (buffer_pool_cleanup) buffer_pool_cleanup();
    }

    const took_ms = Number(process.hrtime.bigint() - start_time) / 1e6;
    speedometer.update(ret_size, took_ms);
}

async function run_client() {
    await Promise.all(
        Array(argv.concur).fill().map(() => run_client_loop())
    );
}

async function run_client_loop() {
    const { CuObjClientNapi } = nb_native();
    const rdma_client = new CuObjClientNapi();
    console.log('RDMA client');

    for (; ;) {
        await run_client_request(rdma_client);
        await setImmediateAsync();
    }
}

async function run_client_request(rdma_client) {
    const start_time = process.hrtime.bigint();

    let ret_size = 0;
    let buffer_pool_cleanup;
    try {
        const pooled_buffer = await buffers_pool.get_buffer();
        const buffer = pooled_buffer.buffer;
        buffer_pool_cleanup = pooled_buffer.callback;

        if (argv.fill && argv.op === 'PUT') {
            buffer.fill(FILL_PUT);
        }

        ret_size = await rdma_client.rdma(argv.op, buffer, async (rdma_info, callback) => {
            const res_size = await send_http_request(rdma_info);
            assert.strictEqual(res_size, buffer.length);
            callback(null, res_size);
        });

        assert.strictEqual(ret_size, buffer.length);

        if (argv.fill && argv.op === 'GET') {
            assert.strictEqual(buffer[0], FILL_GET);
            assert.strictEqual(buffer[buffer.length - 1], FILL_GET);
            buffer.fill(FILL_CLIENT);
        }

    } finally {
        if (buffer_pool_cleanup) buffer_pool_cleanup();
    }

    const took_ms = Number(process.hrtime.bigint() - start_time) / 1e6;
    speedometer.update(ret_size, took_ms);
}

async function send_http_request(rdma_info) {
    const rmda_header = querystring.stringify({ ...rdma_info });
    const http_options = {
        // agent: http_agent,
        hostname: argv.ip,
        port: argv.port,
        method: argv.op,
        path: argv.key,
        headers: {
            'x-rdma-info': rmda_header,
            'Content-Type': 'application/octet-stream',
        },
        // we allow self generated certificates to avoid public CA signing:
        rejectUnauthorized: false,
    };

    const res = await new Promise((resolve, reject) => {
        const req = (argv.ssl ? https : http).request(http_options);
        req.on('response', resolve);
        req.on('error', reject);
        req.end();
    });

    // have to read the empty response to get the connection reused
    await new Promise((resolve, reject) => res
        .on('end', resolve)
        .on('error', reject)
        .on('data', data => { /* noop */ })
    );

    const res_size = Number(res.headers['x-rdma-reply']);
    return res_size;
}
