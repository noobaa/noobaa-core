/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/fips');
const crypto = require('crypto');
const cluster = require('cluster');
const argv = require('minimist')(process.argv);
const Speedometer = require('../util/speedometer');

require('../util/console_wrapper').original_console();

argv.forks = argv.forks || 1;
argv.size = argv.size || (10 * 1024);
argv.hash = argv.hash || 'sha256';

if (argv.forks > 1 && cluster.isMaster) {
    const master_speedometer = new Speedometer('Total Speed');
    master_speedometer.fork(argv.forks);
} else {
    main();
}

function main() {
    const hasher = crypto.createHash(argv.hash);
    const buf = crypto.randomBytes(1024 * 1024);
    const speedometer = new Speedometer('CPU Speed');
    var size = argv.size * 1024 * 1024;
    console.log(`Crunching ${argv.size} MB with ${argv.hash}...`);
    run();

    function run() {
        if (size <= 0) process.exit();
        hasher.update(buf);
        speedometer.update(buf.length);
        size -= buf.length;
        setImmediate(run);
    }
}
