'use strict';
let fs = require('fs');
let net = require('net');
let tls = require('tls');
let argv = require('minimist')(process.argv);
argv.mem = argv.mem || 64 * 1024;
argv.port = parseInt(argv.port, 10) || 50505;
argv.frame = argv.frame || false;
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
    console.log('\nUsage: --server [--port X] [--ssl] [--frame] [--mem X]\n');
    console.log('\nUsage: --client <host> [--port X] [--ssl] [--frame] [--mem X]\n');
}

function run_server(port, ssl) {
    console.log('SERVER', port, 'mem', argv.mem);
    let server;
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
    console.log('CLIENT', host + ':' + port, 'mem', argv.mem);
    let conn = (ssl ? tls : net).connect({
        port: port,
        host: host,
        // we allow self generated certificates to avoid public CA signing:
        rejectUnauthorized: false,
    }, function() {
        console.log('client connected', conn.getCipher && conn.getCipher() || '');
        let buf = new Buffer(argv.mem);
        let send;
        if (argv.frame) {
            send = function() {
                // conn.cork();
                let full = false;
                while (!full) {
                    let hdr = new Buffer(4);
                    hdr.writeUInt32BE(buf.length, 0);
                    full = conn.write(hdr) || full;
                    full = conn.write(buf) || full;
                    conn.nb.send_bytes += buf.length;
                }
                // conn.uncork();
            };
        } else {
            send = function() {
                // conn.cork();
                while (conn.write(buf)) {
                    conn.nb.send_bytes += buf.length;
                }
                conn.nb.send_bytes += buf.length;
                // conn.uncork();
            };
        }

        conn.on('drain', send);
        send();
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
    let nb = conn.nb = {
        send_bytes: 0,
        recv_bytes: 0,
        last_send_bytes: 0,
        last_recv_bytes: 0,
        start_time: Date.now(),
        last_time: Date.now()
    };
    conn._readableState.highWaterMark = 8 * argv.mem;
    if (argv.frame) {
        let hdr;
        conn.on('readable', function() {
            while (true) {
                if (!hdr) {
                    hdr = conn.read(4);
                    if (!hdr) break;
                }
                let len = hdr.readUInt32BE(0);
                let data = conn.read(len);
                if (!data) break;
                hdr = null;
                nb.recv_bytes += data.length;
            }
        });
    } else {
        conn.on('readable', function() {
            while (true) {
                let data = conn.read();
                if (!data) break;
                // if (data.length < argv.mem) {
                //     console.log('SMALL BUFFER', data.length);
                // }
                nb.recv_bytes += data.length;
            }
        });
    }
    setInterval(function() {
        let now = Date.now();
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
