/* Copyright (C) 2025 NooBaa */
'use strict';

const config = require('../../../../config');
const entropy_utils = require('../../../util/entropy_utils');

describe('entropy_utils', () => {

    describe('get_block_device_disk_info', () => {

        it('(on Linux) should return array of disk devices that their names starts with ' +
            '/dev/, and their size it a number in bytes ' +
            '(else) empty array', async () => {
            const res = await entropy_utils.get_block_device_disk_info();
            expect(Array.isArray(res)).toBe(true);
            const is_linux = process.platform === 'linux';
            console.log('is_linux', is_linux, ' entropy_utils.get_block_device_disk_info res', res);
            if (is_linux) {
                res.forEach(item => {
                    expect(item.name.startsWith('/dev/')).toBe(true);
                    expect(typeof(item.size)).toBe('number');
                });
            } else {
                expect(res.length).toBe(0);
            }
        });

    });

    describe('pick_a_disk', () => {

        it('should return sd disk with size greater than 100 MiB', async () => {
            const mock_arr = [
                { name: '/dev/sda', size: config.ENTROPY_DISK_SIZE_THRESHOLD + 1 },
                { name: '/dev/vda', size: 5 } // size too small
            ];
            const res = await entropy_utils.pick_a_disk(mock_arr);
            expect(res.name.startsWith('/dev/sd')).toBe(true);
            expect(res.size).toBeGreaterThan(config.ENTROPY_DISK_SIZE_THRESHOLD);
        });

        it('should return vd disk with size greater than 100 MiB', async () => {
            const mock_arr = [
                 {name: '/dev/sda', size: 5 }, // size too small
                { name: '/dev/vda', size: config.ENTROPY_DISK_SIZE_THRESHOLD + 1 }];
            const res = await entropy_utils.pick_a_disk(mock_arr);
            expect(res.name.startsWith('/dev/vd')).toBe(true);
            expect(res.size).toBeGreaterThan(config.ENTROPY_DISK_SIZE_THRESHOLD);
        });

        it('should return nvme disk with size greater than 100 MiB', async () => {
            const mock_arr = [
                { name: '/dev/nvme1n1', size: config.ENTROPY_DISK_SIZE_THRESHOLD + 1 },
                { name: '/dev/some_disk', size: config.ENTROPY_DISK_SIZE_THRESHOLD + 1 } // name is not in whitelist
            ];
            const res = await entropy_utils.pick_a_disk(mock_arr);
            expect(res.name.startsWith('/dev/nvme')).toBe(true);
            expect(res.size).toBeGreaterThan(config.ENTROPY_DISK_SIZE_THRESHOLD);
        });

        it('should return undefined', async () => {
            const mock_arr = [
                { name: '/dev/sda', size: config.ENTROPY_DISK_SIZE_THRESHOLD - 1 }, // size too small
                { name: '/dev/vda', size: config.ENTROPY_DISK_SIZE_THRESHOLD - 1 } // size too small
            ];
            const res = await entropy_utils.pick_a_disk(mock_arr);
            expect(res).toBeUndefined();
        });

        it('should return vd disk with size greater than 100 MiB', async () => {
            const mock_arr = [
                { name: '/dev/vda', size: config.ENTROPY_DISK_SIZE_THRESHOLD + 1 },
                { name: '/dev/nvme1n1', size: config.ENTROPY_DISK_SIZE_THRESHOLD + 1 }
            ];
            const res = await entropy_utils.pick_a_disk(mock_arr);
            expect(res.name.startsWith('/dev/vda')).toBe(true); // vd in higher priority than nvme
            expect(res.size).toBeGreaterThan(config.ENTROPY_DISK_SIZE_THRESHOLD);
        });
    });
});
