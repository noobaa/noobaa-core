/* Copyright (C) 2016 NooBaa */
'use strict';

const net = require('net');
const tls = require('tls');
const argv = require('minimist')(process.argv);
const crypto = require('crypto');
const ssl_utils = require('../util/ssl_utils');
const semaphore = require('../util/semaphore');
const Speedometer = require('../util/speedometer');
const buffer_utils = require('../util/buffer_utils');

require('../util/console_wrapper').original_console();

// common
argv.port = Number(argv.port) || 50505;
argv.ssl = Boolean(argv.ssl);
argv.forks = argv.forks || 1;
argv.frame = Boolean(argv.frame);
// client
argv.buf = argv.buf || 128 * 1024; // in Bytes
argv.concur = argv.concur || 1;
// server
argv.hash = argv.hash ? String(argv.hash) : '';

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

const recv_speedometer = new Speedometer({ name: 'TCP Recv' });
const send_speedometer = new Speedometer({
    name: 'TCP Send',
    argv,
    num_workers: argv.forks,
    primary_init,
    workers_func,
});
send_speedometer.start();

async function primary_init() {
    if (argv.help) {
        return usage();
    }
}

async function workers_func() {
    if (argv.server) {
        return run_server();
    }
    if (argv.client) {
        argv.client = (typeof argv.client === 'string' && argv.client) || 'localhost';
        return run_client();
    }
    return usage();
}

function usage() {
    console.log(`
    Client Usage: --client <host> [--port X] [--ssl] [--forks X] [--frame] [--buf X (Bytes)] [--concur X]

    Server Usage: --server        [--port X] [--ssl] [--forks X] [--frame] [--hash sha256]
    `);
}

function run_server() {
    const server = argv.ssl ?
        tls.createServer(ssl_utils.generate_ssl_certificate()) :
        net.createServer();

    server.on('error', err => {
        console.error('TCP server error', err.message);
        process.exit();
    })
        .on('close', () => {
            console.error('TCP server closed');
            process.exit();
        })
        .on('listening', () => {
            console.log('TCP server listening on port', argv.port, '...');
        })
        .on(argv.ssl ? 'secureConnection' : 'connection', conn => {
            const fd = conn._handle.fd;
            console.log(`TCP connection accepted from ${conn.remoteAddress}:${conn.remotePort} (fd ${fd})`);
            conn.once('close', () => {
                console.log(`TCP connection closed from ${conn.remoteAddress}:${conn.remotePort} (fd ${fd})`);
            });
            conn.once('error', err => {
                console.log(`TCP connection error from ${conn.remoteAddress}:${conn.remotePort} (fd ${fd}):`, err);
            });
            if (argv.frame) {
                run_receiver_frame(conn);
            } else {
                run_receiver(conn);
            }
        })
        .listen(argv.port);
}

function run_client() {
    for (let i = 0; i < argv.concur; ++i) {
        setImmediate(run_client_conn);
    }
}

function run_client_conn() {
    /** @type {net.Socket} */
    // @ts-ignore
    const conn = (argv.ssl ? tls : net).connect({
        port: argv.port,
        host: argv.client,
        // we allow self generated certificates to avoid public CA signing:
        rejectUnauthorized: false,
    })
        .once('error', err => {
            console.error('TCP client connection error', err.message);
            process.exit();
        })
        .once('close', () => {
            console.error('TCP client connection closed');
            process.exit();
        })
        .once('connect', () => {
            if (argv.frame) {
                run_sender_frame(conn);
            } else {
                run_sender(conn);
            }
        });

    return conn;
}

/** 
 * @param {net.Socket} conn
 */
function run_sender(conn) {
    conn.on('drain', send);
    send();

    async function send() {
        let ok = true;
        while (ok) {
            const { buffer, callback } = await buffers_pool.get_buffer();
            ok = conn.write(buffer, callback);
            send_speedometer.update(buffer.length);
        }
    }
}

/** 
 * @param {net.Socket} conn
 */
function run_sender_frame(conn) {
    conn.on('drain', send);
    send();

    async function send() {
        let ok = true;
        while (ok) {
            const { buffer, callback } = await buffers_pool.get_buffer();
            const hdr = Buffer.allocUnsafe(4);
            hdr.writeUInt32BE(buffer.length, 0);
            const w1 = conn.write(hdr);
            const w2 = conn.write(buffer, callback);
            ok = w1 && w2;
            send_speedometer.update(buffer.length);
        }
    }
}

/** 
 * @param {net.Socket} conn
 */
function run_receiver(conn) {
    const hasher = argv.hash && crypto.createHash(argv.hash);
    conn.on('readable', () => {
        let ok = true;
        while (ok) {
            const data = conn.read();
            if (data) {
                if (hasher) hasher.update(data);
                recv_speedometer.update(data.length);
            } else {
                ok = false;
            }
        }
    });
}

/** 
 * @param {net.Socket} conn
 */
function run_receiver_frame(conn) {
    const hasher = argv.hash && crypto.createHash(argv.hash);
    let hdr = null;
    conn.on('readable', () => {
        let ok = true;
        while (ok) {
            if (hdr) {
                const len = hdr.readUInt32BE(0);
                const data = conn.read(len);
                if (data) {
                    if (hasher) hasher.update(data);
                    recv_speedometer.update(data.length);
                    hdr = null;
                } else {
                    ok = false;
                }
            } else {
                hdr = conn.read(4);
                if (!hdr) {
                    ok = false;
                }
            }
        }
    });
}
