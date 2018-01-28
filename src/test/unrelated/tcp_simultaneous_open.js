/* Copyright (C) 2016 NooBaa */
'use strict';

var net = require('net');
var tls = require('tls');
// var fs = require('fs');

var delay = 1;

if (process.argv[1]) {
    tcp_simultaneous_open(5555, 5556);
    tcp_simultaneous_open(5556, 5555);
} else {
    tcp_normal_open(5556);
}

function tcp_simultaneous_open(local_port, remote_port, attempts) {
    attempts = attempts || 0;
    var conn = net.connect({
        port: remote_port,
        localPort: local_port
    });
    conn.on('error', function(err) {
        process.stdout.write('.');
        conn.destroy();
        conn = null;
        attempts += 1;
        delay -= 0.5;
        if (delay < 1) {
            delay = 1;
        }
        if (attempts < 1000) {
            setTimeout(tcp_simultaneous_open, delay, local_port, remote_port, attempts);
        } else {
            console.log('PEW EXHAUSTED', err);
        }
    });
    conn.on('data', function(data) {
        console.log('PLAIN DATA:', data.toString());
        upgrade_to_tls(conn, local_port < remote_port);
    });
    conn.on('connect', function() {
        console.log('\nCONNECTED!', conn.address());
        conn.write(Buffer.from('FIRST PLAIN MESSAGE'));
    });
}

function tcp_normal_open(listen_port) {
    var server = net.createServer(function(conn) {
        server.close();
        conn.on('readable', function() {
            on_readable(conn, true);
        });
    });
    server.listen(listen_port, function() {
        var conn = net.connect(listen_port, function() {
            conn.write(new_seq_buffer(1));
        });
        conn.on('readable', function() {
            on_readable(conn, false);
        });
    });
}

function new_seq_buffer(seq) {
    var buffer = Buffer.alloc(4);
    buffer.writeInt32BE(seq, 0);
    return buffer;
}

function get_seq_buffer(buffer) {
    return buffer.readInt32BE(0);
}

function on_readable(conn, is_server) {
    var run = true;
    while (run) {
        var buffer = conn.read(4);
        if (!buffer) return;
        var seq = get_seq_buffer(buffer);
        console.log(is_server ? 'SERVER:' : 'CLIENT:', seq);
        if (seq >= 100) {
            setImmediate(do_upgrade);
        }
        if (seq <= 100) {
            conn.write(new_seq_buffer(seq + 1));
        }
        if (seq >= 100) {
            run = false;
            return;
        }
    }

    function do_upgrade() {
        upgrade_to_tls(conn, is_server);
    }
}

function upgrade_to_tls(conn, is_server) {
    var looper;
    var sconn;
    // conn.removeAllListeners();
    if (is_server) {
        sconn = new tls.TLSSocket(conn, {
            isServer: true,
            // secureContext: tls.createSecureContext({
            // key: fs.readFileSync('./ryans-key.pem'),
            // cert: fs.readFileSync('./ryans-cert.pem'),
            // ca: [fs.readFileSync('./ryans-cert.pem')],
            // })
        });
    } else {
        sconn = tls.connect({
            socket: conn,
            // key: fs.readFileSync('./ryans-key.pem'),
            // cert: fs.readFileSync('./ryans-cert.pem'),
            // ca: [fs.readFileSync('./ryans-cert.pem')],
        });
    }
    sconn.on('secure', once_connected);
    sconn.on('error', function(err) {
        console.error('TLS ERROR:', err);
        sconn.destroy();
    });
    sconn.on('close', function() {
        console.error('TLS CLOSED');
        clearInterval(looper);
        conn.destroy();
    });
    sconn.on('data', function(data) {
        console.log('TLS DATA:', data.toString());
    });

    function once_connected() {
        console.log('TLS CONNECTED:', sconn.localPort, '->', sconn.remotePort);
        sconn.write(Buffer.from('first secure message from ' +
            (is_server ? 'server ' : 'client ') + (new Date())));
        looper = setInterval(function() {
            sconn.write(Buffer.from('another secure message from ' +
                (is_server ? 'server ' : 'client ') + (new Date())));
        }, 1000);
    }
}
