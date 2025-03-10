/* Copyright (C) 2025 NooBaa */
'use strict';

// module to mock (must be before the import)
jest.mock('../../../util/os_utils');
const os_utils = require('../../../util/os_utils');

const entropy_utils = require('../../../util/entropy_utils');
const config = require('../../../../config');

describe('entropy_utils', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('pick_a_disk', () => {

        it('should return sd disk with size greater than 100 MiB', async () => {
            const mock_arr = [
                { name: '/dev/sda', size: config.DISK_SIZE_THRESHOLD + 1 },
                { name: '/dev/vda', size: 5 } // size too small
            ];
            os_utils.get_block_device_disk_info = jest.fn().mockResolvedValue(mock_arr);
            const res = await entropy_utils.pick_a_disk();
            expect(res.name.startsWith('/dev/sd')).toBe(true);
            expect(res.size).toBeGreaterThan(config.DISK_SIZE_THRESHOLD);
        });

        it('should return vd disk with size greater than 100 MiB', async () => {
            const mock_arr = [
                 {name: '/dev/sda', size: 5 }, // size too small
                { name: '/dev/vda', size: config.DISK_SIZE_THRESHOLD + 1 }];
            os_utils.get_block_device_disk_info = jest.fn().mockResolvedValue(mock_arr);
            const res = await entropy_utils.pick_a_disk();
            expect(res.name.startsWith('/dev/vd')).toBe(true);
            expect(res.size).toBeGreaterThan(config.DISK_SIZE_THRESHOLD);
        });

        it('should return nvme disk with size greater than 100 MiB', async () => {
            const mock_arr = [
                { name: '/dev/nvme1n1', size: config.DISK_SIZE_THRESHOLD + 1 },
                { name: '/dev/some_disk', size: config.DISK_SIZE_THRESHOLD + 1 } // name is not in whitelist
            ];
            os_utils.get_block_device_disk_info = jest.fn().mockResolvedValue(mock_arr);
            const res = await entropy_utils.pick_a_disk();
            expect(res.name.startsWith('/dev/nvme')).toBe(true);
            expect(res.size).toBeGreaterThan(config.DISK_SIZE_THRESHOLD);
        });

        it('should return undefined', async () => {
            const mock_arr = [
                { name: '/dev/sda', size: config.DISK_SIZE_THRESHOLD - 1 }, // size too small
                { name: '/dev/vda', size: config.DISK_SIZE_THRESHOLD - 1 } // size too small
            ];
            os_utils.get_block_device_disk_info = jest.fn().mockResolvedValue(mock_arr);
            const res = await entropy_utils.pick_a_disk();
            expect(res).toBeUndefined();
        });

        it('should return vd disk with size greater than 100 MiB', async () => {
            const mock_arr = [
                { name: '/dev/vda', size: config.DISK_SIZE_THRESHOLD + 1 },
                { name: '/dev/nvme1n1', size: config.DISK_SIZE_THRESHOLD + 1 }
            ];
            os_utils.get_block_device_disk_info = jest.fn().mockResolvedValue(mock_arr);
            const res = await entropy_utils.pick_a_disk();
            expect(res.name.startsWith('/dev/vda')).toBe(true); // vd in higher priority than nvme
            expect(res.size).toBeGreaterThan(config.DISK_SIZE_THRESHOLD);
        });
    });
});
