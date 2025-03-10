/* Copyright (C) 2025 NooBaa */
'use strict';

const fs = require('fs');
const util = require('util');
const chance = require('chance')();
const child_process = require('child_process');
const config = require('../../config');
const os_utils = require('../util/os_utils');

const async_exec = util.promisify(child_process.exec);
const async_delay = util.promisify(setTimeout);


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
            const disk_details = await pick_a_disk();
            if (disk_details) {
                add_entropy(disk_details.name, disk_details.size);
            } else {
                throw new Error('No disk candidates found');
            }
        } catch (err) {
            console.log('generate_entropy: error', err);
        }
    }
}

/**
 * pick_a_disk will pick a disk that:
 *  - The disk name is in the priority array - the lower index in the array the higher priority
 *  - Its size is higher than config.DISK_SIZE_THRESHOLD
 * 
 * The item that is returned is an object with properties: name, size and priority
 * (we could delete the priority property as it is used only inside this function)
 * 
 * if none matches then it would return undefined
 * @returns {Promise<object | undefined>}
 */
async function pick_a_disk() {
    const disk_array = await os_utils.get_block_device_disk_info();
    // the priority array is the whitelist and also sets the priority
    // (0 index highest priority, n-1 index lowest priority)
    const priority = ['/dev/sd', '/dev/vd', '/dev/xvd', 'dev/dasd', '/dev/nvme'];
    const priority_disk_array = disk_array.reduce((acc, disk) => {
        // in add_entropy we read 32 MiB from the disk, we decided on a threshold of 100 MB
        if (disk.size > config.DISK_SIZE_THRESHOLD) {
            for (let index = 0; index < priority.length; index++) {
                const prefix = priority[index];
                if (disk.name.startsWith(prefix)) {
                    disk.priority = index;
                    acc.push(disk);
                }
            }
        }
        return acc;
    }, []);
    // sort the array based on the priority
    const sorted_priority_disk_array = priority_disk_array.sort(
        (item1, item2) => item1.priority - item2.priority);
    const first_element = sorted_priority_disk_array.length > 0 ? sorted_priority_disk_array[0] : undefined;
    return first_element;
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

exports.generate_entropy = generate_entropy;
exports.pick_a_disk = pick_a_disk;
