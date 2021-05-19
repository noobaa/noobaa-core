/* Copyright (C) 2016 NooBaa */
'use strict';

const net = require('net');
const tls = require('tls');
const argv = require('minimist')(process.argv);
const crypto = require('crypto');
const cluster = require('cluster');
const ssl_utils = require('../util/ssl_utils');
const Speedometer = require('../util/speedometer');

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
        argv.client = (typeof(argv.client) === 'string' && argv.client) || 'localhost';
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

function run_sender(conn) {
    const buf = Buffer.allocUnsafe(argv.buf);
    conn.on('drain', () => {
        let ok = true;
        while (ok) {
            ok = conn.write(buf);
            send_speedometer.update(buf.length);
        }
    });
    conn.emit('drain');
}

function run_sender_frame(conn) {
    const buf = Buffer.allocUnsafe(argv.buf);
    const hdr = Buffer.allocUnsafe(4);
    conn.on('drain', () => {
        let ok = true;
        while (ok) {
            hdr.writeUInt32BE(buf.length, 0);
            const w1 = conn.write(hdr);
            const w2 = conn.write(buf);
            ok = w1 && w2;
            send_speedometer.update(buf.length);
        }
    });
    conn.emit('drain');
}

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
