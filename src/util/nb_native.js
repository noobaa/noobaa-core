/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const util = require('util');
const events = require('events');
const bindings = require('bindings');
const config = require('../../config');
const entropy_utils = require('./entropy_utils');

const async_delay = util.promisify(setTimeout);

let nb_native_napi;

/**
 * @returns {nb.Native}
 */
function nb_native() {

    if (nb_native_napi) return nb_native_napi;

    nb_native_napi = bindings('nb_native.node');

    // see https://github.com/bnoordhuis/node-event-emitter
    const nb_native_nan = bindings('nb_native_nan.node');
    inherits(nb_native_nan.Nudp, events.EventEmitter);
    inherits(nb_native_nan.Ntcp, events.EventEmitter);
    _.defaults(nb_native_napi, nb_native_nan);

    // GGG HACK TRACING STAT CALLS - TODO: REMOVE
    if (process.env.GGG_TRACE_STAT === 'true') {
        const original_stat = nb_native_napi.fs.stat;
        nb_native_napi.fs.stat = function(...args) {
            console.trace('fs.stat', ...args, new Error('TRACE').stack);
            return original_stat(...args);
        };
    }

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
    if (process.env.LOCAL_MD_SERVER) {
        console.log('init_rand_seed: starting ...');
    }
    let still_reading = true;
    const promise = entropy_utils.generate_entropy(() => still_reading);

    const seed = await read_rand_seed(32);
    if (seed) {
        // console.log(`init_rand_seed: seeding with ${seed.length} bytes`);
        nb_native_napi.rand_seed(seed);
    }

    still_reading = false;
    await promise;
    // console.log('init_rand_seed: done');
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
            const random_dev = config.ENABLE_DEV_RANDOM_SEED ? '/dev/random' : '/dev/urandom';
            if (!fh) {
                if (process.env.LOCAL_MD_SERVER) {
                    console.log(`read_rand_seed: opening ${random_dev} ...`);
                }
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

module.exports = nb_native;
