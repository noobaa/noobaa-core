/* Copyright (C) 2016 NooBaa */
'use strict';

const zlib = require('zlib');
const RandStream = require('../util/rand_stream');
const Speedometer = require('../util/speedometer');
const argv = require('minimist')(process.argv);

argv.forks ||= 1;
argv.buf ||= 1024 * 1024;
argv.generator ||= 'crypto'; // see RandStream for options

const speedometer = new Speedometer({
    name: 'RAND',
    argv,
    num_workers: argv.forks,
    workers_func,
});
speedometer.start();

async function workers_func() {
    const len = (argv.len * 1024 * 1024) || Infinity;
    const input = new RandStream(len, {
        highWaterMark: argv.buf,
        generator: argv.generator,
    });
    input.on('data', data => speedometer.update(data.length));

    if (argv.gzip) {
        const gzip = zlib.createGzip();
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
