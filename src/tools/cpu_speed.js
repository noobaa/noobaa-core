/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/fips');
const crypto = require('crypto');
const argv = require('minimist')(process.argv);
const setImmediateAsync = require('timers/promises').setImmediate;
const Speedometer = require('../util/speedometer');

require('../util/console_wrapper').original_console();

argv.forks = Number(argv.forks ?? 1);
argv.size = Number(argv.size ?? (10 * 1024));
argv.hash = argv.hash || 'sha256';

const speedometer = new Speedometer({
    name: `CPU(${argv.hash})`,
    argv,
    num_workers: argv.forks,
    workers_func,
});
speedometer.start();

async function workers_func() {
    const hasher = crypto.createHash(argv.hash);
    const buf = crypto.randomBytes(1024 * 1024);
    let size = argv.size * 1024 * 1024;
    console.log(`Crunching ${argv.size} MB with ${argv.hash}...`);
    while (size > 0) {
        await speedometer.measure(async () => {
            hasher.update(buf);
            return buf.length;
        });
        size -= buf.length;
        await setImmediateAsync(); // release CPU
    }
}
