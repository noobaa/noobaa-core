'use strict';
var fs = require('fs');
var net = require('net');
var tls = require('tls');
main();

function main() {
    var type = process.argv[2] || false;
    var port = parseInt(process.argv[3], 10) || 50505;
    var ip = process.argv[4] || '127.0.0.1';
    var ssl = process.argv[5] || false;
    if (/help/.test(type)) {
        return usage();
    }
    if (type === 'client') {
        run_client(port, ip, ssl);
    } else if (type === 'server') {
        run_server(port, ssl);
    } else {
        console.error('Unexpected type:', type);
        return usage();
    }
}

function usage() {
    console.log('\nUsage: [client|server] [port] [ip] [ssl]\n');
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

function run_client(port, ip, ssl) {
    console.log('CLIENT', ip + ':' + port);
    var conn = (ssl ? tls : net).connect({
        port: port,
        host: ip,
        // we allow self generated certificates to avoid public CA signing:
        rejectUnauthorized: false,
    }, function() {
        console.log('client connected', conn.getCipher && conn.getCipher());
        var buf = new Buffer(64 * 1024 * 1024);
        send();

        function send() {
            conn.removeListener('drain', send);
            while (conn.write(buf)) {
                conn.nb.send_bytes += buf.length;
            }
            conn.nb.send_bytes += buf.length;
            conn.on('drain', send);
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
    conn.on('data', function(data) {
        nb.recv_bytes += data.length;
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
