'use strict';
let fs = require('fs');
let net = require('net');
let tls = require('tls');
let cluster = require('cluster');
let Speedometer = require('../src/util/speedometer');
let argv = require('minimist')(process.argv);
argv.size = argv.size || 1024 * 1024;
argv.port = parseInt(argv.port, 10) || 50505;
argv.noframe = argv.noframe || false;
argv.forks = argv.forks || 1;

if (argv.forks > 1 && cluster.isMaster) {
    let master_speedometer = new Speedometer('Total Speed');
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
        argv.client = typeof(argv.client) === 'string' && argv.client || '127.0.0.1';
        run_client(argv.port, argv.client, argv.ssl);
    } else {
        return usage();
    }
}


function usage() {
    console.log('\nUsage: --server [--port X] [--ssl] [--noframe] [--size X]\n');
    console.log('\nUsage: --client <host> [--port X] [--ssl] [--noframe] [--size X]\n');
}


function run_server(port, ssl) {
    console.log('SERVER', port, 'size', argv.size);
    let server;
    if (ssl) {
        server = tls.createServer({
            key: fs.readFileSync('guy-key.pem'),
            cert: fs.readFileSync('guy-cert.pem'),
        }, conn => {
            setup_conn(conn);
            run_receiver(conn);
        });
    } else {
        server = net.createServer(conn => {
            setup_conn(conn);
            run_receiver(conn);
        });
    }
    server.on('listening', () => console.log('listening for connections ...'));
    server.on('error', err => console.error('server error', err.message));
    server.listen(port);
}


function run_client(port, host, ssl) {
    console.log('CLIENT', host + ':' + port, 'size', argv.size);
    let conn = (ssl ? tls : net).connect({
        port: port,
        host: host,
        // we allow self generated certificates to avoid public CA signing:
        rejectUnauthorized: false,
    }, () => {
        console.log('client connected', conn.getCipher && conn.getCipher() || '');
        run_sender(conn);
    });
    setup_conn(conn);
}


function setup_conn(conn) {
    // conn._readableState.highWaterMark = 8 * argv.size;
    // conn._writableState.highWaterMark = 8 * argv.size;
    conn.on('error', function(err) {
        console.log('connection error', err.message);
    });
    conn.on('close', function() {
        console.log('done.');
        process.exit();
    });
}


function run_sender(conn) {
    let send_speedometer = new Speedometer('Send Speed');
    send_speedometer.enable_cluster();
    let send;
    if (!argv.noframe) {
        send = () => {
            // conn.cork();
            let write_more = true;
            while (write_more) {
                let hdr = new Buffer(4);
                let buf = new Buffer(argv.size);
                hdr.writeUInt32BE(buf.length, 0);
                write_more = conn.write(hdr) && write_more;
                write_more = conn.write(buf) && write_more;
                send_speedometer.update(buf.length);
            }
            // conn.uncork();
        };
    } else {
        send = () => {
            // conn.cork();
            let write_more = true;
            while (write_more) {
                let buf = new Buffer(argv.size);
                write_more = conn.write(buf) && write_more;
                send_speedometer.update(buf.length);
            }
            // conn.uncork();
        };
    }

    conn.on('drain', send);
    send();
}


function run_receiver(conn) {
    let recv_speedometer = new Speedometer('Receive Speed');
    recv_speedometer.enable_cluster();
    if (!argv.noframe) {
        let hdr;
        conn.on('readable', () => {
            while (true) {
                if (!hdr) {
                    hdr = conn.read(4);
                    if (!hdr) break;
                }
                let len = hdr.readUInt32BE(0);
                let data = conn.read(len);
                if (!data) break;
                hdr = null;
                recv_speedometer.update(data.length);
            }
        });
    } else {
        conn.on('readable', () => {
            while (true) {
                let data = conn.read();
                if (!data) break;
                // if (data.length < argv.size) {
                //     console.log('SMALL BUFFER', data.length);
                // }
                recv_speedometer.update(data.length);
            }
        });
    }
}
