/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const net = require('net');
const tls = require('tls');
const cluster = require('cluster');
const Speedometer = require('../util/speedometer');

const argv = require('minimist')(process.argv);
argv.size = argv.size || 10;
argv.concur = argv.concur || 16;
argv.port = parseInt(argv.port, 10) || 50505;
argv.noframe = argv.noframe || false;
argv.forks = argv.forks || 1;

if (argv.forks > 1 && cluster.isMaster) {
    const master_speedometer = new Speedometer('Total Speed');
    master_speedometer.enable_cluster();
    for (let i = 0; i < argv.forks; i++) {
        console.warn('Forking', i + 1);
        cluster.fork();
    }
    cluster.on('exit', function(worker, code, signal) {
        console.warn('Fork pid ' + worker.process.pid + ' died');
    });
} else {
    main();
}


function main() {
    if (argv.help) {
        return usage();
    }
    if (argv.server) {
        run_server(argv.port, argv.ssl);
    } else if (argv.client) {
        argv.client = (typeof(argv.client) === 'string' && argv.client) || '127.0.0.1';
        run_client(argv.port, argv.client, argv.ssl);
    } else {
        return usage();
    }
}


function usage() {
    console.log('\nUsage: --server [--port X] [--ssl] [--noframe] [--size X (MB)]\n');
    console.log('\nUsage: --client <host> [--port X] [--ssl] [--noframe] [--size X (MB)]\n');
}


function run_server(port, ssl) {
    console.log('SERVER', port, 'size', argv.size);
    const recv_speedometer = new Speedometer('Receive Speed');
    recv_speedometer.enable_cluster();

    let server;
    if (ssl) {
        server = tls.createServer({
            key: fs.readFileSync('guy-key.pem'),
            cert: fs.readFileSync('guy-cert.pem'),
        }, handle_conn);
    } else {
        server = net.createServer(handle_conn);
    }
    server.on('listening', () => console.log('listening for connections ...'));
    server.on('error', err => console.error('server error', err.message));
    server.listen(port);

    function handle_conn(conn) {
        console.log('Accepted connection from', conn.remoteAddress + ':' + conn.remotePort);
        setup_conn(conn);
        run_receiver(conn, recv_speedometer);
    }
}


function run_client(port, host, ssl) {
    console.log('CLIENT', host + ':' + port, 'size', argv.size, 'MB', 'concur', argv.concur);
    const send_speedometer = new Speedometer('Send Speed');
    send_speedometer.enable_cluster();

    for (let i = 0; i < argv.concur; ++i) {
        const conn = (ssl ? tls : net).connect({
            port: port,
            host: host,
            // we allow self generated certificates to avoid public CA signing:
            rejectUnauthorized: false,
        });
        setup_conn(conn);
        setup_sender(conn);
    }

    function setup_sender(conn) {
        conn.on('connect', () => run_sender(conn, send_speedometer));
    }
}


function setup_conn(conn) {
    conn.on('error', function(err) {
        console.log('connection error', err.message);
    });
    conn.on('close', function() {
        console.log('done.');
        process.exit();
    });
}


function run_sender(conn, send_speedometer) {
    let send;
    if (argv.noframe) {
        send = () => {
            var write_more;
            do {
                const buf = Buffer.allocUnsafe(argv.size * 1024 * 1024);
                write_more = conn.write(buf);
                send_speedometer.update(buf.length);
            } while (write_more);
        };
    } else {
        send = () => {
            var write_more;
            do {
                const hdr = Buffer.allocUnsafe(4);
                const buf = Buffer.allocUnsafe(argv.size * 1024 * 1024);
                hdr.writeUInt32BE(buf.length, 0);
                const w1 = conn.write(hdr);
                const w2 = conn.write(buf);
                write_more = w1 && w2;
                send_speedometer.update(buf.length);
            } while (write_more);
        };
    }

    conn.on('drain', send);
    send();
}


function run_receiver(conn, recv_speedometer) {
    if (argv.noframe) {
        conn.on('readable', () => {
            var read_more;
            do {
                let data = conn.read();
                if (!data) {
                    read_more = false;
                    break;
                }
                read_more = true;
                recv_speedometer.update(data.length);
            } while (read_more);
        });
    } else {
        var hdr;
        conn.on('readable', () => {
            var read_more;
            do {
                if (!hdr) {
                    hdr = conn.read(4);
                    if (!hdr) {
                        read_more = false;
                        break;
                    }
                }
                let len = hdr.readUInt32BE(0);
                let data = conn.read(len);
                if (!data) {
                    read_more = false;
                    break;
                }
                hdr = null;
                read_more = true;
                recv_speedometer.update(data.length);
            } while (read_more);
        });
    }
}
