/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const http = require('http');
const https = require('https');
const stream = require('stream');
const crypto = require('crypto');
const cluster = require('cluster');
const ssl_utils = require('../util/ssl_utils');
const Speedometer = require('../util/speedometer');

require('../util/console_wrapper').original_console();

// common
argv.port = Number(argv.port) || 50505;
argv.ssl = Boolean(argv.ssl);
argv.forks = argv.forks || 1;
// client
argv.client = argv.client === true ? '127.0.0.1' : argv.client;
argv.size = argv.size === undefined ? (1024 ** 3) : argv.size; // in bytes
argv.buf = argv.buf || 128 * 1024; // in Bytes
argv.concur = argv.concur || 1;
// server
argv.server = Boolean(argv.server);
argv.hash = argv.hash ? String(argv.hash) : '';

// set keep alive to make sure we don't reconnect between requests
http.globalAgent.keepAlive = true;
const http_agent = argv.ssl ?
    new https.Agent({ keepAlive: true }) :
    new http.Agent({ keepAlive: true });

const send_speedometer = new Speedometer('Send Speed');
const recv_speedometer = new Speedometer('Receive Speed');
const master_speedometer = new Speedometer('Total Speed');

if (cluster.isMaster) {
    delete argv._;
    console.log('ARGV', JSON.stringify(argv));
}

if (argv.forks > 1 && cluster.isMaster) {
    master_speedometer.fork(argv.forks);
} else {
    main();
}

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
    Client Usage: --client <host> [--port X] [--ssl] [--forks X] [--size X (MB)] [--buf X (Bytes)] [--concur X]

    Server Usage: --server        [--port X] [--ssl] [--forks X] [--hash sha256]
    `);
}

function run_server() {
    const server = argv.ssl ?
        https.createServer(ssl_utils.generate_ssl_certificate()) :
        http.createServer();

    server.on('error', err => {
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
            const fd = conn._handle.fd;
            console.log(`HTTP connection accepted (fd ${fd})`);
            conn.once('close', () => {
                console.log(`HTTP connection closed (fd ${fd})`);
            });
        })
        .on('request', run_server_request)
        .listen(argv.port);
}

/**
 * 
 * @param {http.IncomingMessage} req 
 * @param {http.ServerResponse} res 
 */
function run_server_request(req, res) {
    const op_start_time = process.hrtime.bigint();
    req.on('error', err => {
        console.error('HTTP server request error', err.message);
        process.exit();
    });
    res.on('error', err => {
        console.error('HTTP server response error', err.message);
        process.exit();
    });
    req.once('end', () => {
        recv_speedometer.add_op(
            Number(process.hrtime.bigint() - op_start_time) / 1000000
        );
        res.end();
    });
    run_receiver(req);
}

function run_client() {
    for (let i = 0; i < argv.concur; ++i) {
        setImmediate(run_client_request);
    }
}

function run_client_request() {
    const op_start_time = process.hrtime.bigint();
    const req = (argv.ssl ? https : http)
        .request({
            agent: http_agent,
            port: argv.port,
            hostname: argv.client,
            path: '/upload',
            method: 'PUT',
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
                })
                .once('end', () => send_speedometer.add_op(
                    Number(process.hrtime.bigint() - op_start_time) / 1000000
                ))
                .once('end', run_client_request)
                .on('data', data => { /* noop */ });
            // setImmediate(run_client_request);
        });

    run_sender(req);
}

/**
 * @param {http.ClientRequest} writable 
 */
function run_sender(writable) {
    var n = 0;

    writable.on('drain', send);
    send();

    function send() {
        const buf = Buffer.allocUnsafe(Math.min(argv.buf, argv.size - n));
        var ok = true;
        while (ok && n < argv.size) {
            ok = writable.write(buf);
            n += buf.length;
            send_speedometer.update(buf.length);
        }
        if (n >= argv.size) writable.end();
    }
}

/**
 * @param {http.IncomingMessage} readable 
 */
function run_receiver(readable) {
    const hasher = argv.hash && crypto.createHash(argv.hash);
    if (argv.client) {
        const req = (argv.ssl ? https : http)
            .request({
                agent: http_agent,
                port: argv.port + 1,
                hostname: argv.client,
                path: '/upload',
                method: 'PUT',
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
                    })
                    .on('data', data => { /* noop */ });
            });

        readable.pipe(new stream.Transform({
            transform(data, encoding, callback) {
                if (hasher) hasher.update(data);
                recv_speedometer.update(data.length);
                callback(null, data);
            }
        })).pipe(req);
    } else {
        readable.on('data', data => {
            if (hasher) hasher.update(data);
            recv_speedometer.update(data.length);
        });
    }
}
