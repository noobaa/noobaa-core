'use strict';

let net = require('net');

exports.tunnel_port = tunnel_port;
exports.tunnel_connection = tunnel_connection;

if (require.main === module) {
    main();
}

function main() {
    let argv = require('minimist')(process.argv);
    argv.host = argv.host || '127.0.0.1';
    argv.port = parseInt(argv.port, 10) || 80;
    argv.port2 = parseInt(argv.port2, 10) || 6001;
    tunnel_port(argv.port, argv.port2, argv.host, 'TCP TUNNEL');
    if (argv.ssl || argv.ssl2) {
        argv.ssl = parseInt(argv.ssl, 10) || 443;
        argv.ssl2 = parseInt(argv.ssl2, 10) || 6443;
        tunnel_port(argv.ssl, argv.ssl2, argv.host, 'SSL TUNNEL');
    }
}

function tunnel_port(source_port, target_port, hostname, name) {
    name = (name || '') + ' [' + source_port + '->' + human_addr(hostname + ':' + target_port) + ']';
    return net.createServer()
        .on('connection', conn => tunnel_connection(conn, target_port, hostname, name))
        .on('error', (err) => {
            console.error(name, 'server error', err.stack || err);
        })
        .on('listening', () => {
            console.log(name, 'listening ...');
        })
        .listen(source_port);
}

function tunnel_connection(conn, target_port, hostname, name) {
    let conn_name = human_addr(conn.remoteAddress + ':' + conn.remotePort);
    let target_conn = net.connect(target_port, hostname);
    conn.on('close', () => on_error('source closed'));
    target_conn.on('close', () => on_error('target closed'));
    conn.on('error', err => on_error('source error', err));
    target_conn.on('error', err => on_error('target error', err));
    target_conn.on('connect', () => {
        console.log(name, conn_name, 'tunneling ...');
        conn.pipe(target_conn);
        target_conn.pipe(conn);
    });

    let last_bytes_read = conn.bytesRead;
    let last_bytes_written = conn.bytesWritten;
    let report_interval = setInterval(() => {
        let nread = conn.bytesRead - last_bytes_read;
        let nwrite = conn.bytesWritten - last_bytes_written;
        if (nread || nwrite) {
            console.log(name, conn_name, 'report: read', nread, 'write', nwrite);
            last_bytes_read = conn.bytesRead;
            last_bytes_written = conn.bytesWritten;
        }
    }, 1000);

    function on_error(desc, err) {
        console.warn(name, conn_name, desc, err || '');
        conn.destroy();
        target_conn.destroy();
        clearInterval(report_interval);
    }
}

function human_addr(addr) {
    return addr
        .replace(/^::ffff:/, '') // ipv6 prefix for ipv4 addresses
        .replace(/^::1:/, '') // ipv6 localhost
        .replace(/^::0:1:/, '') // ipv6 localhost
        .replace(/^127\.0\.0\.1:/, '') // ipv4 localhost
        .replace(/^localhost:/, ''); // named localhost
}
