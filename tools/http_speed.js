'use strict';
let fs = require('fs');
let http = require('http');
let https = require('https');
let Speedometer = require('../src/util/speedometer');
let argv = require('minimist')(process.argv);
argv.size = argv.size || 10 * 1024 * 1024;
argv.port = parseInt(argv.port, 10) || 50505;
argv.concur = argv.concur || 1;
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
    console.log('\nUsage: --server [--port X] [--ssl] [--concur X] [--size X]\n');
    console.log('\nUsage: --client <host> [--port X] [--ssl] [--concur X] [--size X]\n');
}


function run_server(port, ssl) {
    console.log('SERVER', port, 'size', argv.size);
    let server = ssl ? https.createServer({
        key: fs.readFileSync('guy-key.pem'),
        cert: fs.readFileSync('guy-cert.pem'),
    }) : http.createServer();
    server.on('listening', () => console.log('listening for connections ...'));
    server.on('error', err => {
        console.error('server error', err.message);
        process.exit();
    });
    server.on('close', () => {
        console.error('server closed');
        process.exit();
    });
    run_receiver(server);
    server.listen(port);
}


function run_client(port, host, ssl) {
    console.log('CLIENT', host + ':' + port, 'size', argv.size);
    run_sender(port, host, ssl);
}


function run_sender(port, host, ssl) {
    let send_speedometer = new Speedometer('Send Speed');
    let send = () => {
        let buf = new Buffer(argv.size);
        let req = (ssl ? https : http).request({
            port: port,
            hostname: host,
            path: '/upload',
            method: 'POST',
            headers: {
                'content-type': 'application/octet-stream',
                'content-length': buf.length
            },
            // we allow self generated certificates to avoid public CA signing:
            rejectUnauthorized: false,
        }, res => {
            if (res.statusCode !== 200) {
                console.error('http status', res.statusCode);
                process.exit();
            }
            send_speedometer.update(buf.length);
            setImmediate(send);
        });
        req.on('error', err => {
            console.log('http error', err.message);
            process.exit();
        });
        req.end(buf);
    };

    for (let i = 0; i < argv.concur; ++i) {
        setImmediate(send);
    }
}


function run_receiver(server) {
    let recv_speedometer = new Speedometer('Receive Speed');
    server.on('request', (req, res) => {
        req.on('data', data => recv_speedometer.update(data.length));
        req.on('error', err => {
            console.log('http server error', err.message);
            process.exit();
        });
        req.on('end', () => {
            res.statusCode = 200;
            res.end();
        });
    });
}
