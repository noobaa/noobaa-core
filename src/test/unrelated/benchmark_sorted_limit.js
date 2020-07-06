/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv.slice(2));
// const util = require('util');
// const assert = require('assert');
const crypto = require('crypto');

const sort_utils = require('../../util/sort_utils');

const gen = crypto.createCipheriv('aes-128-gcm', crypto.randomBytes(16), crypto.randomBytes(12));

function bench(Ctor, limit, compare, count, time) {
    const start = Date.now();
    let loops = 0;
    while (Date.now() - start < time) {
        const impl = new Ctor(limit, compare);
        for (let j = 0; j < count; ++j) {
            const val = argv.prefix + gen.update(Buffer.alloc(8)).toString('base64');
            impl.push(val);
        }
        impl.end();
        loops += 1;
    }
    const end = Date.now();
    return loops / (end - start) * 1000;
}

function main() {
    argv.time = argv.time || 200;
    argv.limit = argv.limit || 1000;
    argv.prefix = argv.prefix || '';
    console.log(argv);
    const ctors = [
        sort_utils.SortedLimitSplice,
        sort_utils.SortedLimitShift,
        sort_utils.SortedLimitEveryBatch,
        sort_utils.SortedLimitEveryPush,
    ];
    for (let count = 1; count < 200000; count *= 2) {
        process.stdout.write(`count: ${count} loops/sec: { `);
        for (const ctor of ctors) {
            const loops_per_sec = bench(ctor, argv.limit, undefined, count, argv.time);
            process.stdout.write(`${ctor.name}: ${loops_per_sec.toFixed(1)} `);
        }
        process.stdout.write('}\n');
    }
}

main();
