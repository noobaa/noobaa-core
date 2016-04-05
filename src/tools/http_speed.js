'use strict';
let fs = require('fs');
let http = require('http');
let https = require('https');
let cluster = require('cluster');
let crypto = require('crypto');
let Speedometer = require('../util/speedometer');
let argv = require('minimist')(process.argv);
argv.size = argv.size || 16;
argv.port = parseInt(argv.port, 10) || 50505;
argv.concur = argv.concur || 16;
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

http.globalAgent.keepAlive = true;

let http_agent = new http.Agent({
    keepAlive: true
});

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
    console.log('\nUsage: --server [--port X] [--ssl] [--forks X] [--hash sha256]\n');
    console.log('\nUsage: --client <host> [--port X] [--ssl] [--concur X] [--size X (MB)]  [--forks X]\n');
}


function run_server(port, ssl) {
    console.log('SERVER', port, 'size', argv.size, 'MB');
    let server = ssl ? https.createServer({
        key: fs.readFileSync('guy-key.pem'),
        cert: fs.readFileSync('guy-cert.pem'),
    }) : http.createServer();
    server.on('listening', () => console.log('listening on port', argv.port, '...'));
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
    console.log('CLIENT', host + ':' + port, 'size', argv.size, 'MB', 'concur', argv.concur);
    run_sender(port, host, ssl);
}


function run_sender(port, host, ssl) {
    let send_speedometer = new Speedometer('Send Speed');
    send_speedometer.enable_cluster();

    function send() {
        let buf = new Buffer(argv.size * 1024 * 1024);
        let req = (ssl ? https : http).request({
            agent: http_agent,
            port: port,
            hostname: host,
            path: '/upload',
            method: 'PUT',
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
            res.on('data', () => {});
            res.on('end', send);
        });
        req.on('error', err => {
            console.log('http error', err.message);
            process.exit();
        });
        req.end(buf);
    }

    for (let i = 0; i < argv.concur; ++i) {
        setImmediate(send);
    }
}


function run_receiver(server) {
    let recv_speedometer = new Speedometer('Receive Speed');
    recv_speedometer.enable_cluster();
    server.on('connection', conn => {
        console.log('Accepted HTTP Connection (fd ' + conn._handle.fd + ')');
    });
    server.on('request', (req, res) => {
        let hasher = argv.hash && crypto.createHash(argv.hash);
        req.on('data', data => {
            if (hasher) {
                hasher.update(data);
            }
            recv_speedometer.update(data.length);
        });
        req.on('error', err => {
            console.log('http server error', err.message);
            process.exit();
        });
        req.on('end', () => {
            res.statusCode = 200;
            if (hasher) {
                res.end(hasher.digest('hex'));
            } else {
                res.end();
            }
        });
    });
}
