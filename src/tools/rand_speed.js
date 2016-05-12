'use strict';
let _ = require('lodash');
let zlib = require('zlib');
let cluster = require('cluster');
let RandStream = require('../util/rand_stream');
let Speedometer = require('../util/speedometer');
let argv = require('minimist')(process.argv);
argv.forks = argv.forks || 1;

if (argv.forks > 1 && cluster.isMaster) {
    let master_speedometer = new Speedometer('Total Speed');
    master_speedometer.enable_cluster();
    for (let i = 0; i < argv.forks; i++) {
        let worker = cluster.fork();
        console.warn('Worker start', worker.process.pid);
    }
    cluster.on('exit', function(worker, code, signal) {
        console.warn('Worker exit', worker.process.pid);
        if (_.isEmpty(cluster.workers)) {
            process.exit();
        }
    });
} else {
    main();
}

function main() {
    let speedometer = new Speedometer('Rand Speed');
    speedometer.enable_cluster();
    let len = (argv.len * 1024 * 1024) || Infinity;
    let input = new RandStream(len, {
        highWaterMark: 1024 * 1024,
        heavy_crypto: argv.heavy_crypto
    });
    input.on('data', data => speedometer.update(data.length));
    if (argv.gzip) {
        let gzip = zlib.createGzip();
        let plain_size = 0;
        let compressed_size = 0;
        input.on('data', data => {
            plain_size += data.length;
        });
        gzip.on('data', data => {
            compressed_size += data.length;
        });
        input.pipe(gzip);
        setInterval(() => {
            console.log('GZIP Compressed-vs-Data ratio:',
                (100 * compressed_size / plain_size).toFixed(0) + '%');
        }, 3000).unref();
    }
}
