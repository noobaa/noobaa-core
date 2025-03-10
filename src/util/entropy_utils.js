/* Copyright (C) 2025 NooBaa */
'use strict';

const util = require('util');
const chance = require('chance')();
const child_process = require('child_process');
const config = require('../../config');
const blockutils = require('linux-blockutils');

const DEVICE_TYPE_DISK = 'disk';

const async_exec = util.promisify(child_process.exec);
const get_block_info_async = util.promisify(blockutils.getBlockInfo);

/**
 * get_block_device_disk_info
 * (on Linux) will return array of disk devices
 *            that their names starts with /dev/
 *            and their size it a number in bytes
 * (else) will return an empty array
 * Note: under the hood it uses blockutils.getBlockInfo which calls lsblk command
 * @returns {Promise<object[]>}
 */
async function get_block_device_disk_info() {
    if (!config.IS_LINUX) return [];
    try {
        const block_devices = await get_block_info_async({});
        if (!block_devices) return [];

        return block_devices.reduce((acc, block_device) => {
            if (block_device.TYPE === DEVICE_TYPE_DISK) {
                acc.push({
                        name: `/dev/${block_device.NAME}`,
                        size: Number(block_device.SIZE),
                    });
            }
            return acc;
        }, []);
    } catch (err) {
        console.error('get_block_device_info got an error', err);
        return [];
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
 * @param {object[]} available_disks
 * @returns {Promise<object | undefined>}
 */
async function pick_a_disk(available_disks) {
    // the priority array is the whitelist and also sets the priority
    // (0 index highest priority, n-1 index lowest priority)
    const priority = ['/dev/sd', '/dev/vd', '/dev/xvd', 'dev/dasd', '/dev/nvme'];
    const priority_disk_array = available_disks.reduce((acc, disk) => {
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

exports.get_block_device_disk_info = get_block_device_disk_info;
exports.pick_a_disk = pick_a_disk;
exports.add_entropy = add_entropy;
