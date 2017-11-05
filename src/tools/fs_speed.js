/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const argv = require('minimist')(process.argv);
const path = require('path');
const crypto = require('crypto');
const cluster = require('cluster');
const Speedometer = require('../util/speedometer');

argv.size = argv.size || 1;
argv.size_units = argv.size_units || 'MB';
argv.concur = argv.concur || 1;
argv.forks = argv.forks || 1;
argv.dir = argv.dir || 'fs_speed';

const size_units_table = {
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
};

if (!size_units_table[argv.size_units]) {
    throw new Error('Invalid size_units ' + argv.size_units);
}

const size = argv.size * size_units_table[argv.size_units];
const zero_buffer = Buffer.alloc(size);
const master_speedometer = new Speedometer('Total Speed');
const speedometer = new Speedometer('FS Speed');

let file_id = 0;
let cipher;
let cipher_bytes = 0;
let cipher_limit = 0;

try {
    fs.mkdirSync(argv.dir);
} catch (err) {
    if (err.code !== 'EEXIST') throw err;
}

if (argv.forks > 1 && cluster.isMaster) {
    master_speedometer.fork(argv.forks);
} else {
    for (let i = 0; i < argv.concur; ++i) {
        setImmediate(worker);
    }
}

function worker() {
    const buf = generate_data();
    const fname = `file-${file_id}-worker-${process.pid}`;
    file_id += 1;
    fs.writeFile(path.join(argv.dir, fname), buf, err => {
        if (err) throw err;
        speedometer.update(size);
        setImmediate(worker);
    });
}

function generate_data() {
    if (!cipher || cipher_bytes > cipher_limit) {
        cipher_bytes = 0;
        cipher_limit = 1024 * 1024 * 1024;
        // aes-128-gcm requires 96 bits IV (12 bytes) and 128 bits key (16 bytes)
        cipher = crypto.createCipheriv('aes-128-gcm',
            crypto.randomBytes(16), crypto.randomBytes(12));
    }
    cipher_bytes += size;
    return cipher.update(zero_buffer);
}