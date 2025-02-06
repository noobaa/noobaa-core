/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const util = require('util');
const events = require('events');
const chance = require('chance')();
const bindings = require('bindings');
const child_process = require('child_process');
const config = require('../../config');

const async_exec = util.promisify(child_process.exec);
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

/**
 * generate_entropy will create randomness by changing the MD5
 * using information from the device (disk)
 * it will run as long as the callback it true
 * @param {function} loop_cond
 */
async function generate_entropy(loop_cond) {
    if (process.platform !== 'linux' || process.env.container === 'docker') return;
    while (loop_cond()) {
        try {
            await async_delay(1000);
            const ENTROPY_AVAIL_PATH = '/proc/sys/kernel/random/entropy_avail';
            const entropy_avail = parseInt(await fs.promises.readFile(ENTROPY_AVAIL_PATH, 'utf8'), 10);
            console.log(`generate_entropy: entropy_avail ${entropy_avail}`);
            if (entropy_avail >= 512) return;

            const disk_names = [
                '/dev/sda', '/dev/vda', '/dev/xvda', '/dev/dasda',
                '/dev/nvme0n1', '/dev/nvme1n1'
            ];
            let disk_details = await get_disk_name_and_size(disk_names);
            if (disk_details.disk_size) {
                add_entropy(disk_details.disk_name, disk_details.disk_size);
            } else {
                // we don't have a disk size from one of the hard-coded candidates
                // we will try to get it on the environment that we run on
                const disk_names_from_env = await get_disk_names();
                const additional_disk_names = [];
                const set_disk_names = new Set(disk_names); // to go over the original disk names only once
                for (const disk_name_from_env of disk_names_from_env) {
                    // add only the names of disks that we didn't have in the original_array_of_disk_names
                    if (!set_disk_names.has(disk_name_from_env)) {
                        additional_disk_names.push(disk_name_from_env);
                    }
                }
                disk_details = await get_disk_name_and_size(additional_disk_names);
                if (disk_details.disk_size) {
                    add_entropy(disk_details.disk_name, disk_details.disk_size);
                } else {
                    throw new Error('No disk candidates found');
                }
            }
        } catch (err) {
            console.log('generate_entropy: error', err);
        }
    }
}

/**
 * get_disk_size will execute the blockdev command
 * on each disk in a loop until we have disk size to work with
 * and returns an object holding the disk_size and the disk
 * @param {string[]} array_of_disk_names
 * @returns {Promise<object>}
 */
async function get_disk_name_and_size(array_of_disk_names) {
    let disk_size;
    let disk_name;
    for (disk_name of array_of_disk_names) {
        try {
            const res = await async_exec(`blockdev --getsize64 ${disk_name}`);
            disk_size = parseInt(res.stdout, 10);
            break;
        } catch (err) {
            //continue to next candidate
        }
    }
    return { disk_size, disk_name };
}

/**
 * add_entropy will execute dd command which pipes to md5sum
 * in order to get the MD5 hash to change
 * @param {string} disk_name
 * @param {number} disk_size
 */
async function add_entropy(disk_name, disk_size) {
    const bs = 1024 * 1024;
    const count = 32;
    const disk_size_in_blocks = disk_size / bs;
    const skip = chance.integer({ min: 0, max: disk_size_in_blocks });
    console.log(`add_entropy: adding entropy: dd if=${disk_name} bs=${bs} count=${count} skip=${skip} | md5sum`);
    await async_exec(`dd if=${disk_name} bs=${bs} count=${count} skip=${skip} | md5sum`);
}

/**
 * get_disk_names will return the disk names using lsblk command
 * we use this function in case we didn't found a candidate from the hard-coded disk name 
 * @returns {Promise<string[]>}
 */
async function get_disk_names() {
    try {
        const res = await async_exec(`lsblk --json`);
        const res_json = JSON.parse(res.stdout);
        const disks = res_json.blockdevices.filter(block_device => block_device.type === 'disk');
        // will take the disk name add add '/dev/ prefix to it (to match the original array)
        const array_of_disk_names = disks.map(disk => '/dev/' + disk.name);
        return array_of_disk_names;
    } catch (err) {
        console.log('get_disk_names: got an error:', err);
        return [];
    }
}

module.exports = nb_native;
