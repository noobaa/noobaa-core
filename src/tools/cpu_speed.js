/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/fips');
const crypto = require('crypto');
const argv = require('minimist')(process.argv);
const Speedometer = require('../util/speedometer');

require('../util/console_wrapper').original_console();

argv.forks = argv.forks || 1;
argv.size = argv.size || (10 * 1024);
argv.hash = argv.hash || 'sha256';

const speedometer = new Speedometer(`CPU(${argv.hash})`);
speedometer.run_workers(argv.forks, main, argv);

function main() {
    const hasher = crypto.createHash(argv.hash);
    const buf = crypto.randomBytes(1024 * 1024);
    let size = argv.size * 1024 * 1024;
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
