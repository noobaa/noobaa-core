'use strict';
let _ = require('lodash');
let cluster = require('cluster');
let crypto = require('crypto');
let Speedometer = require('../util/speedometer');
let argv = require('minimist')(process.argv);
argv.forks = argv.forks || 1;
argv.size = argv.size || 1024;

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
    let speedometer = new Speedometer('CPU Speed');
    speedometer.enable_cluster();
    let hasher = crypto.createHash('sha256');
    let size = argv.size * 1024 * 1024;
    let buf = new Buffer(1024 * 1024);
    console.log('Crunching', argv.size, 'MB with SHA256...');
    run();

    function run() {
        if (size <= 0) process.exit();
        hasher.update(buf);
        speedometer.update(buf.length);
        size -= buf.length;
        setImmediate(run);
    }
}
