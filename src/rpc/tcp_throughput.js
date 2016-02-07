'use strict';
var fs = require('fs');
var net = require('net');
var tls = require('tls');
var argv = require('minimist')(process.argv);
argv.mem = argv.mem || 1024 * 1024;
argv.port = parseInt(argv.port, 10) || 50505;
main();

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
    console.log('\nUsage: --server [--port X] [--ssl]\n');
    console.log('\nUsage: --client <host> [--port X] [--ssl]\n');
}

function run_server(port, ssl) {
    console.log('SERVER', port);
    var server;
    if (ssl) {
        server = tls.createServer({
            key: fs.readFileSync('guy-key.pem'),
            cert: fs.readFileSync('guy-cert.pem'),
        }, setup_conn);
    } else {
        server = net.createServer(setup_conn);
    }
    server.on('listening', function() {
        console.log('listening for connections ...');
    });
    server.on('error', function(err) {
        console.error('server error', err.message);
    });
    server.listen(port);
}

function run_client(port, host, ssl) {
    console.log('CLIENT', host + ':' + port);
    var conn = (ssl ? tls : net).connect({
        port: port,
        host: host,
        // we allow self generated certificates to avoid public CA signing:
        rejectUnauthorized: false,
    }, function() {
        console.log('client connected', conn.getCipher && conn.getCipher() || '');
        var buf = new Buffer(argv.mem);
        conn.on('drain', send);
        send();

        function send() {
            conn.cork();
            while (conn.write(buf)) {
                conn.nb.send_bytes += buf.length;
            }
            conn.nb.send_bytes += buf.length;
            conn.uncork();
        }
    });
    setup_conn(conn);
}

function setup_conn(conn) {
    conn.on('error', function(err) {
        console.log('connection error', err.message);
    });
    conn.on('close', function() {
        console.log('done.');
        process.exit();
    });
    var nb = conn.nb = {
        send_bytes: 0,
        recv_bytes: 0,
        last_send_bytes: 0,
        last_recv_bytes: 0,
        start_time: Date.now(),
        last_time: Date.now()
    };
    conn._readableState.highWaterMark = 8 * argv.mem;
    conn.on('readable', function() {
        while (true) {
            var data = conn.read();
            if (!data) break;
            if (data.length < argv.mem) {
                console.log('SMALL BUFFER', data.length);
            }
            nb.recv_bytes += data.length;
        }
    });
    setInterval(function() {
        var now = Date.now();
        console.log(
            'Send: ' +
            ((nb.send_bytes - nb.last_send_bytes) / 1024 / 1024 /
                (now - nb.last_time) * 1000).toFixed(1) + ' MB/sec (~' +
            (nb.send_bytes / 1024 / 1024 /
                (now - nb.start_time) * 1000).toFixed(1) + ' MB/sec) ' +
            'Receive: ' +
            ((nb.recv_bytes - nb.last_recv_bytes) / 1024 / 1024 /
                (now - nb.last_time) * 1000).toFixed(1) + ' MB/sec (~' +
            (nb.recv_bytes / 1024 / 1024 /
                (now - nb.start_time) * 1000).toFixed(1) + ' MB/sec)');
        nb.last_time = now;
        nb.last_send_bytes = nb.send_bytes;
        nb.last_recv_bytes = nb.recv_bytes;
    }, 1000);
}
