/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const util = require('util');
const events = require('events');
const chance = require('chance')();
const child_process = require('child_process');

const async_exec = util.promisify(child_process.exec);
const async_delay = util.promisify(setTimeout);

var nb_native_napi;

function nb_native() {

    if (nb_native_napi) return nb_native_napi;

    const bindings = require('bindings'); // eslint-disable-line global-require
    nb_native_napi = bindings('nb_native.node');

    // see https://github.com/bnoordhuis/node-event-emitter
    const nb_native_nan = bindings('nb_native_nan.node');
    inherits(nb_native_nan.Nudp, events.EventEmitter);
    inherits(nb_native_nan.Ntcp, events.EventEmitter);
    _.defaults(nb_native_napi, nb_native_nan);

    if (process.env.DISABLE_INIT_RANDOM_SEED !== 'true') {
        init_rand_seed();
    }

    return nb_native_napi;
}

// extend prototype
function inherits(target, source) {
    _.forIn(source.prototype, function(v, k) {
        target.prototype[k] = source.prototype[k];
    });
}

// https://wiki.openssl.org/index.php/Random_Numbers#Entropy
// doing as suggested and seeding with /dev/random
async function init_rand_seed() {

    console.log('init_rand_seed: starting ...');
    let still_reading = true;
    const promise = generate_entropy(() => still_reading);

    const seed = await read_rand_seed(32);
    if (seed) {
        console.log(`init_rand_seed: seeding with ${seed.length} bytes`);
        nb_native_napi.rand_seed(seed);
    }

    still_reading = false;
    await promise;
    console.log('init_rand_seed: done');
}

async function read_rand_seed(seed_bytes) {
    if (process.platform === 'win32') return;
    let fh;
    const clean_fh = async () => {
        // Ignore seed in standalone due to pkg issue: https://github.com/noobaa/noobaa-core/issues/6476
        if (!fh || Number.isInteger(fh)) return;
        console.log('read_rand_seed: closing fd ...');
        try {
            await fh.close();
        } catch (err) {
            console.log('read_rand_seed: closing fd error', err);
        }
        fh = undefined;
    };
    let offset = 0;
    const buf = Buffer.allocUnsafe(seed_bytes);
    while (offset < buf.length) {
        try {
            const count = buf.length - offset;
            const random_dev = process.env.DISABLE_DEV_RANDOM_SEED ? '/dev/urandom' : '/dev/random';
            if (!fh) {
                console.log(`read_rand_seed: opening ${random_dev} ...`);
                fh = await fs.promises.open(random_dev, 'r');
                // Ignore seed in standalone due to pkg issue: https://github.com/noobaa/noobaa-core/issues/6476
                if (Number.isInteger(fh)) break;
            }
            console.log(`read_rand_seed: reading ${count} bytes from ${random_dev} ...`);
            const { bytesRead } = await fh.read(buf, offset, count, null);
            offset += bytesRead;
            console.log(`read_rand_seed: got ${bytesRead} bytes from ${random_dev}, total ${offset} ...`);
        } catch (err) {
            console.log('read_rand_seed: error', err);
            await clean_fh();
            console.log('read_rand_seed: delay before retry');
            await async_delay(1000);
        }
    }
    await clean_fh();
    return buf;
}

async function generate_entropy(loop_cond) {
    if (process.platform !== 'linux' || process.env.container === 'docker') return;
    while (loop_cond()) {
        try {
            await async_delay(1000);
            const ENTROPY_AVAIL_PATH = '/proc/sys/kernel/random/entropy_avail';
            const entropy_avail = parseInt(await fs.promises.readFile(ENTROPY_AVAIL_PATH, 'utf8'), 10);
            console.log(`generate_entropy: entropy_avail ${entropy_avail}`);
            if (entropy_avail < 512) {
                const bs = 1024 * 1024;
                const count = 32;
                let disk;
                let disk_size;
                for (disk of ['/dev/sda', '/dev/vda', '/dev/xvda']) {
                    try {
                        const res = await async_exec(`blockdev --getsize64 ${disk}`);
                        disk_size = res.stdout;
                        break;
                    } catch (err) {
                        //continue to next candidate
                    }
                }
                if (disk_size) {
                    const disk_size_in_blocks = parseInt(disk_size, 10) / bs;
                    const skip = chance.integer({ min: 0, max: disk_size_in_blocks });
                    console.log(`generate_entropy: adding entropy: dd if=${disk} bs=${bs} count=${count} skip=${skip} | md5sum`);
                    await async_exec(`dd if=${disk} bs=${bs} count=${count} skip=${skip} | md5sum`);
                } else {
                    throw new Error('No disk candidates found');
                }
            }
        } catch (err) {
            console.log('generate_entropy: error', err);
        }
    }
}

module.exports = nb_native;
