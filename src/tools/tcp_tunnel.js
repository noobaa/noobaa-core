/* Copyright (C) 2016 NooBaa */
'use strict';

const net = require('net');
const tls = require('tls');
const path = require('path');
const HTTPRecorder = require('../util/http_recorder');

exports.tunnel_port = tunnel_port;
exports.tunnel_connection = tunnel_connection;

if (require.main === module) {
    main();
}

function main() {
    // eslint-disable-next-line global-require
    const argv = require('minimist')(process.argv.slice(2));
    if (argv.help) {
        console.log(`
Usage: node ${path.relative('.', __filename)} (options) [80:6001 443s:6443s ...]

Options:
    --help                      Show this help
    --host <name|ip>            Tunnel to that host (default localhost)
    --record_http [extension]   Parse the stream as HTTP and record requests to files (see below).
                                Optional file extension (default 'sreq')

List of tunnels:
    Each tunnel will have the following format: source:target[:optional-tag]
    Source and target are port numbers, with optional 's' suffix for SSL.
    The tunnel will listen on the source port on the running machine.
    For every incoming connection it will connect to the target port and tunnel data in both directions.

SSL:
    SSL for source means to listen on the source port for SSL socket and do the SSL handshake by the tunnel (self signed certificate).
    SSL for target means to connect to the target port with SSL socket.
    Mixing between SSL and non-SSL source and target ports is supported.
    Examples:
    1. 443:6443     will tunnel encrypted data without deciphering it at all. Notice that record_http will not work in that case.
    2. 443s:6443s   the tunnel will decipher the SSL against the client and will connect with SSL to the target.
    3. 443s:80      the tunnel will do SSL handshake with the client and will decipher and tunnel the plain data to port 8080.
    4. 80:443s      the tunnel will create an SSL connection to port 443 and will tunnel data from port 80.

Recording HTTP:
    The TCP stream is parsed as HTTP stream and every request is saved to a file on the current working directory.
    In order to parse and record HTTP requests the tunnel must be able to read the plain data of the stream.
    So it will not work in example number 1 of the SSL section were the data is tunneled without deciphering.
`);
        return;
    }
    const hostname = argv.host || 'localhost';
    const record_http = argv.record_http;
    const tunnels = argv._ || [];
    if (!tunnels.length) {
        tunnels.push('80:6001');
        tunnels.push('443s:6443s');
    }
    for (const tun of tunnels) {
        const tun_args = tun.split(':');
        const source = tun_args[0];
        const target = tun_args[1];
        const source_ssl = source.endsWith('s');
        const target_ssl = target.endsWith('s');
        const source_port = Number(source.replace(/s$/, ''));
        const target_port = Number(target.replace(/s$/, ''));
        if (!Number.isInteger(source_port) || source_port <= 0 || source_port >= 64 * 1024 ||
            !Number.isInteger(target_port) || target_port <= 0 || target_port >= 64 * 1024) {
            console.error('Invalid port numbers');
            console.error('source_port:', source_port, 'parsed from:', source);
            console.error('target_port:', target_port, 'parsed from:', target);
            console.error('Use --help.');
            process.exit(1);
        }
        const name = `[${tun}]`;
        tunnel_port({
            source_ssl,
            source_port,
            target_ssl,
            target_port,
            hostname,
            name,
            record_http,
        });
    }
}

function tunnel_port({
    source_ssl,
    source_port,
    target_ssl,
    target_port,
    hostname,
    name,
    record_http
}) {
    const server = source_ssl ? tls.createServer({
        key: ssl_key(),
        cert: ssl_cert(),
    }) : net.createServer();
    return server
        .on(source_ssl ? 'secureConnection' : 'connection', conn =>
            tunnel_connection({
                conn,
                target_ssl,
                target_port,
                hostname,
                name,
                record_http,
            }))
        .on('error', err => console.error(name, 'server error', err.stack || err))
        .on('listening', () => console.log(name, 'listening ...', record_http ? '(Recording HTTP)' : ''))
        .listen(source_port);
}

function tunnel_connection({
    conn,
    target_ssl,
    target_port,
    hostname,
    name,
    record_http
}) {
    const conn_name = human_addr(conn.remoteAddress + ':' + conn.remotePort);
    const target_conn = target_ssl ?
        tls.connect({
            port: target_port,
            host: hostname,
            rejectUnauthorized: false,
        }) :
        net.connect(target_port, hostname);
    conn.on('close', () => on_error('source closed'));
    target_conn.on('close', () => on_error('target closed'));
    conn.on('error', err => on_error('source error', err));
    target_conn.on('error', err => on_error('target error', err));
    target_conn.on(target_ssl ? 'secureConnect' : 'connect', () => {
        console.log(name, conn_name, 'tunneling ...');
        conn.pipe(target_conn);
        target_conn.pipe(conn);
        if (record_http) {
            conn.pipe(new HTTPRecorder(msg => {
                const prefix =
                    (msg.headers['x-amz-user-agent'] ||
                        msg.headers['user-agent'] ||
                        'http_recorder')
                    .split('/', 1)[0]
                    .replace(/-/g, '')
                    .toLowerCase();
                const extension = typeof(record_http) === 'string' ? record_http : 'sreq';
                return `${prefix}_${msg.method}_${Date.now().toString(36)}.${extension}`;
            }));
        }
    });

    let last_bytes_read = conn.bytesRead;
    let last_bytes_written = conn.bytesWritten;
    const report_interval = setInterval(() => {
        const nread = conn.bytesRead - last_bytes_read;
        const nwrite = conn.bytesWritten - last_bytes_written;
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

function ssl_key() {
    return `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAx1dRbX6F9q7V56EmMGlhuksnqXPcQM4cL/FfwQG/15CPG8Mp
3bEPIOSGvbhaDiTgisAJ5sKhIfI7Ac5BQpps8Y9YJQDhIr4hXkFFjZ7nu2t/KxbC
g4S/9+p+USySt9zsr+ER0W3k69G7pHcngLbiuUkJMz9ku4Zq2iDBmZLvO+H98Wwk
u5udx0yuAq0rvM24JE4dBRTk57bOmBp9L6R6AhZKh9q8YigXwtoB2JKy5pCxu8Jj
G+1FdQ9AO+JwS6cHRM9XVhbpTg3V5Y98rP0jlNMiGEixFfJ0xFv4cslXkO+pbw3N
Ek25RXCILUbbk7ZMQoH6X6Xc9vIOKqA5KYs7FwIDAQABAoIBAQCLE6TAG/IjNcAP
pyMZy6xfaWf2ldspa6PG30TLSAkswLLXz8Y54fqIHGjVnPVXwOrYYzuFQG1jXblF
fT2S1mMD9dqtlnt83eIx/KAmOqO64zkKOwri749vzK7su4hxtzV7UDA6Sc3Zqa6d
BHUPHIn6c7Zzhtsk6pdKMGhiWV2IDNwazXkZZU7CzEBZzpaWHDNWwgxR9ACwDtuG
1TqJt++xgxybCpGhtma7JCFSAHMIxwecjv8QJsQYT/yJ5foc8/qxZEZd3vuxNZc9
ZzRvNrU4LDVHPDDGrq65UN8G8Sll+n1SQrpWFOvz0b/jmjDIs2qi5/8yD2YUCHZG
D/onrwmBAoGBAPO5xlX2jR5BFt4g6ethJxJ1iRUxmNMkH41XjZfFfBEd0fqIfj/L
U+bJVu5WH2cZrU+T1V5a6jN+wMYh/EW+jygy4pxUv/Wj1T824Lsa1Y12X2MSIqRH
TMp3/SrnQGW5WvG493phYnDG8AaX8fw+YdlUZOjfToyby4QE0Y1j80YHAoGBANFh
UP9Z8vk4Kxbodv5Pf0SsHobxBaxhY+epZpH51PUIcR0PBSny/C/NLQI7HJNvk/14
IYmbd6LR2L2LinUn2uQfqKZ6q2VApIf5bJzaANzTthKg6faqJVrigqIk5YCYHQqX
hHWfhaoiHLE13xI+cNmN9L7DBQK3BiSpJI42R55xAoGBAMrcxWYFyp31BWisMqfV
fKUTqZ83YgHUXmLSDivWl5bToFQMyjClN9evnCjTDF5Pc/75iK55s9ha12/TF9yh
aRzHhfEjZYe67yMntVRnWHrfnTOkA6uDITqhNttAEkzZRAZQs8RsTHicTWrfi+4t
qlovsbJXNFU60+G19QnfuLx/AoGAJzDrA1Dn3OQ5lIkgtMtWjBkXgbSdlj2IgLVB
oLM9vDu/SGwmUErOD3h9IzzDRYmODtSsmmBCTXSv+BKlcPZrz2VpoPe3GzW1VkpG
nTllDfCG1QfPoz8HzPI293imiKJwVSo1PfsE/upxqm3l+jk70Ez08bv5NR/jA3ux
fvkEANECgYAlh8o3iPTNXRieiwDiHMxJL2zY876ExZGyxBcTA5q1dQNGGJfWH0+L
ZXuxpKQV/SgP8FrUali23z7cZ4jPTU+Ziav6O8gd5u3limwVA99QcXax2pTYXycS
gn1SstfEENVozLwgTsYdBhk7H6cK7tZHHF0mKTenpz1SaMbK5E8DLw==
-----END RSA PRIVATE KEY-----
`;
}

function ssl_cert() {
    return `-----BEGIN CERTIFICATE-----
MIIDBjCCAe4CCQDPzi0wXa1CGTANBgkqhkiG9w0BAQUFADBFMQswCQYDVQQGEwJB
VTETMBEGA1UECBMKU29tZS1TdGF0ZTEhMB8GA1UEChMYSW50ZXJuZXQgV2lkZ2l0
cyBQdHkgTHRkMB4XDTE3MDExMDE2NDc1NloXDTE3MDIwOTE2NDc1NlowRTELMAkG
A1UEBhMCQVUxEzARBgNVBAgTClNvbWUtU3RhdGUxITAfBgNVBAoTGEludGVybmV0
IFdpZGdpdHMgUHR5IEx0ZDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEB
AMdXUW1+hfau1eehJjBpYbpLJ6lz3EDOHC/xX8EBv9eQjxvDKd2xDyDkhr24Wg4k
4IrACebCoSHyOwHOQUKabPGPWCUA4SK+IV5BRY2e57trfysWwoOEv/fqflEskrfc
7K/hEdFt5OvRu6R3J4C24rlJCTM/ZLuGatogwZmS7zvh/fFsJLubncdMrgKtK7zN
uCROHQUU5Oe2zpgafS+kegIWSofavGIoF8LaAdiSsuaQsbvCYxvtRXUPQDvicEun
B0TPV1YW6U4N1eWPfKz9I5TTIhhIsRXydMRb+HLJV5DvqW8NzRJNuUVwiC1G25O2
TEKB+l+l3PbyDiqgOSmLOxcCAwEAATANBgkqhkiG9w0BAQUFAAOCAQEAg5uxXk8P
fCVkRWQDEIJVbJPpWV/sAtHHjGIaFthxykhk0hqN1zDIu5APCw3Is6BJ/EkcmC/3
BzALcQBcxhtGPqmjCyYZ0EOj01F9tICUNYU/aAg2P5Mds2yAY7OH8vPiE7oD22p6
vxSof1T0MFVSZ6hm9X7Y6lH4rr6dOhTNQRIbJDFZzNQmRk1EBzLCZXorRKXbi/e+
eqD+tdztCQN5uK2LReJgrrwDlMzh9OR5aTInuqdGzX9PdWimXo+SPUheZUSm366S
S1hOP3iKPBufXI+z1xVaGqvJcqoCswgA1YF3Yiy3FVk06UVQbGaLSOjV/N4Qn9EF
fzMKyfTfm1GeLw==
-----END CERTIFICATE-----
`;
}
