/* Copyright (C) 2016 NooBaa */
'use strict';

const child_process = require('child_process');
const util = require('util');
const os_utils = require('../../../util/os_utils');

describe('os_utils', () => {

    describe('disk free', () => {

        it('should work with flag', async () => {
            const execFile = util.promisify(child_process.execFile);
            const { stdout } = await execFile('/bin/df', ['-kPl']);
            const expected_drives = stdout.trim().split(/\r\n|\r|\n/).slice(1);

            const actual_drives = await os_utils._df(null, 'l');
            expect(actual_drives.length).toBe(expected_drives.length);
        });

        it('should work with file', async () => {
            const actual_drives = await os_utils._df('src/server');
            expect(actual_drives.length).toBe(1);
        });

        it('should return error with invalid input', async () => {
            await expect(() => os_utils._df(null, 'wqe')).rejects.toThrow();
        });

        it('should work with no input', async () => {
            const execFile = util.promisify(child_process.execFile);
            const { stdout } = await execFile('/bin/df', []);
            const expected_drives = stdout.trim().split(/\r\n|\r|\n/).slice(1);

            const actual_drives = await os_utils._df();
            expect(actual_drives.length).toBe(expected_drives.length);
        });

        it('should parse correctly', async () => {
            const drives = await os_utils._df();
            drives.forEach(drive => {
                expect(typeof(drive.filesystem)).toBe('string');
                expect(typeof(drive.size)).toBe('number');
                expect(typeof(drive.used)).toBe('number');
                expect(typeof(drive.available)).toBe('number');
                expect(typeof(drive.capacity)).toBe('number');
                expect(typeof(drive.mount)).toBe('string');
            });
        });

    });
});
