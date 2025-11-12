/* Copyright (C) 2025 NooBaa */
'use strict';

const fs = require('fs');
const util = require('util');
const chance = require('chance')();
const child_process = require('child_process');
const config = require('../../config');
const blockutils = require('linux-blockutils');

const DEVICE_TYPE_DISK = 'disk';

const async_delay = util.promisify(setTimeout);
const async_exec = util.promisify(child_process.exec);
const get_block_info_async = util.promisify(blockutils.getBlockInfo);

/**
 * generate_entropy will create randomness by changing the MD5
 * using information from the device (disk)
 * it will run as long as the callback it true
 * @param {() => Boolean} loop_cond
 */
async function generate_entropy(loop_cond) {
    if (process.platform !== 'linux' || process.env.container === 'docker') return;
    while (loop_cond()) {
        try {
            await async_delay(1000);

            // most likely we will read from the disk for no reason at all as the caller
            // already finished initializing its randomness
            if (!loop_cond()) break;

            const ENTROPY_AVAIL_PATH = '/proc/sys/kernel/random/entropy_avail';
            const entropy_avail = parseInt(await fs.promises.readFile(ENTROPY_AVAIL_PATH, 'utf8'), 10);
            console.log(`generate_entropy: entropy_avail ${entropy_avail}`);
            if (entropy_avail >= config.ENTROPY_MIN_THRESHOLD) return;
            const available_disks = await get_block_device_disk_info();
            const disk_details = pick_a_disk(available_disks);
            if (disk_details) {
                await generate_entropy_from_disk(disk_details.name, disk_details.size);
            } else {
                throw new Error('No disk candidates found');
            }
        } catch (err) {
            // we intentionally don't print the error
            // as console.err/warm and the error with stack trace
            // as the generate_entropy is our best effort to generate entropy
            // until Linux will finally do it
            console.log('generate_entropy: retrying');
        }
    }
}

/**
 * get_block_device_disk_info
 * (on Linux) will return array of disk devices
 *            that their names starts with /dev/
 *            and their size it a number in bytes
 * (else) will return an empty array
 * Note: under the hood it uses blockutils.getBlockInfo which calls lsblk command
 *       we used the option onlyStandard for parsing "disk" and "part" entries
 *       reference: https://github.com/mw-white/node-linux-blockutils
 * @returns {Promise<object[]>}
 */
async function get_block_device_disk_info() {
    const is_linux = process.platform === 'linux';
    if (!is_linux) return [];

    const block_devices = await get_block_info_async({ onlyStandard: true });
    if (!block_devices) return [];

    const available_disks = [];
    for (const block_device of block_devices) {
        if (block_device.TYPE === DEVICE_TYPE_DISK) {
            available_disks.push({
                name: `/dev/${block_device.NAME}`,
                size: Number(block_device.SIZE),
            });
        }
    }
    return available_disks;
}

/**
 * pick_a_disk will pick a disk that:
 *  - The disk name is in the disk_order_by_priority array - the lower index in the array the higher priority
 *  - Its size is higher than config.ENTROPY_DISK_SIZE_THRESHOLD
 * 
 * The item that is returned is an object with properties: name, size and priority
 * (we could delete the priority property as it is used only inside this function)
 * 
 * if none matches then it would return undefined
 * @param {object[]} available_disks
 * @returns {object | undefined}
 */
function pick_a_disk(available_disks) {
    // the disk_order_by_priority array is the whitelist and also sets the priority
    // (0 index highest priority, n-1 index lowest priority)
    // note: we decided on the order according to previous implantation we had in the past
    // as it added in patches we might want to reconsider it
    const disk_order_by_priority = ['/dev/sd', '/dev/vd', '/dev/xvd', '/dev/dasd', '/dev/nvme'];
    const priority_disk_array = [];
    for (const disk of available_disks) {
        if (disk.size > config.ENTROPY_DISK_SIZE_THRESHOLD) {
            for (let index = 0; index < disk_order_by_priority.length; index++) {
                const prefix = disk_order_by_priority[index];
                if (disk.name.startsWith(prefix)) {
                    disk.priority = index;
                    priority_disk_array.push(disk);
                }
            }
        }
    }
    // sort the array based on the priority
    const sorted_priority_disk_array = priority_disk_array.sort((item1, item2) => item1.priority - item2.priority);
    const first_element = sorted_priority_disk_array.length > 0 ? sorted_priority_disk_array[0] : undefined;
    return first_element;
}

/**
 * generate_entropy_from_disk will execute dd command which pipes to md5sum
 * in order to get the MD5 hash to change
 * @param {string} disk_name
 * @param {number} disk_size
 */
async function generate_entropy_from_disk(disk_name, disk_size) {
    const bs = 1024 * 1024;
    const count = 32;
    const disk_size_in_blocks = disk_size / bs;
    const skip = chance.integer({ min: 0, max: disk_size_in_blocks - 1}); // reduce 1 from the max because the range is inclusive in chance.integer()
    console.log(`generate_entropy_from_disk: adding entropy: dd if=${disk_name} bs=${bs} count=${count} skip=${skip} | md5sum`);
    await async_exec(`dd if=${disk_name} bs=${bs} count=${count} skip=${skip} | md5sum`);
}

exports.generate_entropy = generate_entropy;
exports.get_block_device_disk_info = get_block_device_disk_info;
exports.pick_a_disk = pick_a_disk;
exports.generate_entropy_from_disk = generate_entropy_from_disk;
