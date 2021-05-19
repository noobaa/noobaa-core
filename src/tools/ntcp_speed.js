/* Copyright (C) 2016 NooBaa */
'use strict';
let Ntcp = require('../util/nb_native')().Ntcp;
let Speedometer = require('../util/speedometer');
let argv = require('minimist')(process.argv);
argv.size = argv.size || 1024 * 1024;
argv.port = Number(argv.port) || 50505;
let g_servers = [];
let g_connections = [];
main();

function main() {
    if (argv.help) {
        return usage();
    }
    if (argv.server) {
        run_server(argv.port);
    } else if (argv.client) {
        argv.client = (typeof(argv.client) === 'string' && argv.client) || 'localhost';
        run_client(argv.port, argv.client);
    } else {
        return usage();
    }
}

function usage() {
    console.log('\nUsage: --server [--port X] [--size X]\n');
    console.log('\nUsage: --client <host> [--port X] [--size X]\n');
}

function run_server(port) {
    console.log('SERVER', port, 'size', argv.size);
    let server = new Ntcp();
    g_servers.push(server);
    server.on('connection', conn => {
        setup_conn(conn);
        run_receiver(conn);
    });
    server.on('listening', function() {
        console.log('listening for connections ...');
    });
    server.on('error', function(err) {
        console.error('server error', err.message);
        process.exit();
    });
    server.listen(port, '0.0.0.0');
}

function run_client(port, host) {
    console.log('CLIENT', host + ':' + port, 'size', argv.size);
    let conn = new Ntcp();
    conn.connect(port, host, () => run_sender(conn));
    setup_conn(conn);
}

function setup_conn(conn) {
    g_connections.push(conn);
    conn.on('error', function(err) {
        console.log('connection error', err.message);
    });
    conn.on('close', function() {
        console.log('done.');
        process.exit();
    });
}

function run_sender(conn) {
    console.log('client connected');
    let send_speedometer = new Speedometer('Send Speed');
    send();

    function send() {
        let buf = Buffer.allocUnsafe(argv.size);
        conn.write(buf, () => {
            send_speedometer.update(buf.length);
            setImmediate(send);
        });
    }
}

function run_receiver(conn) {
    let recv_speedometer = new Speedometer('Receive Speed');
    conn.on('message', data => recv_speedometer.update(data.length));
}
