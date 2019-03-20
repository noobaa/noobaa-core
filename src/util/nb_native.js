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
const async_open_fd = util.promisify(fs.open);
const async_close_fd = util.promisify(fs.close);
const async_read_fd = util.promisify(fs.read);
const async_read_file = util.promisify(fs.readFile);

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

    init_rand_seed();

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
    let fd = 0;
    let offset = 0;
    const buf = Buffer.allocUnsafe(seed_bytes);
    while (offset < buf.length) {
        try {
            const count = buf.length - offset;
            if (!fd) {
                console.log(`read_rand_seed: opening /dev/random ...`);
                fd = await async_open_fd('/dev/random', 'r');
            }
            console.log(`read_rand_seed: reading ${count} bytes from /dev/random ...`);
            const { bytesRead } = await async_read_fd(fd, buf, offset, count, null);
            offset += bytesRead;
            console.log(`read_rand_seed: got ${bytesRead} bytes from /dev/random, total ${offset} ...`);
        } catch (err) {
            console.log('read_rand_seed: error', err);
            if (fd) {
                console.log('read_rand_seed: closing fd ...');
                try {
                    await async_close_fd(fd);
                } catch (close_err) {
                    console.log('read_rand_seed: closing fd error', close_err);
                }
                fd = 0;
            }
            console.log('read_rand_seed: delay before retry');
            await async_delay(1000);
        }
    }
    return buf;
}

async function generate_entropy(loop_cond) {
    if (process.platform !== 'linux' || process.env.container === 'docker') return;
    while (loop_cond()) {
        try {
            await async_delay(1000);
            const ENTROPY_AVAIL_PATH = '/proc/sys/kernel/random/entropy_avail';
            const entropy_avail = parseInt(await async_read_file(ENTROPY_AVAIL_PATH, 'utf8'), 10);
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
