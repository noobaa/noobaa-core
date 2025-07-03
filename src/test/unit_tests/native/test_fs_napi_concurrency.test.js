/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../../util/promise');
const nb_native = require('../../../util/nb_native');
const test_utils = require('../../system_tests/test_utils');
const { TEST_TIMEOUT } = require('../../system_tests/test_utils');
const { get_process_fs_context } = require('../../../util/native_fs_utils');

const DEFAULT_FS_CONFIG = get_process_fs_context();

describe('fs napi concurrency tests', function() {

    describe('getpwnam concurrency tests', function() {

        const users = [];
        beforeAll(async () => {
            for (let i = 0; i < 20; i++) {
                const username = `user-${i}`;
                const expected_config = { uid: 7000 + i, gid: 7000 + i };
                await test_utils.create_fs_user_by_platform(username, username, expected_config.uid, expected_config.gid);
                users.push({ username, expected_config });
            }
        }, TEST_TIMEOUT);

        afterAll(async () => {
            for (let i = 0; i < users.length; i++) {
                await test_utils.delete_fs_user_by_platform(users[i].username);
            }
        }, TEST_TIMEOUT);

        it('getpwnam concurrency tests', async function() {
            for (let i = 0; i < users.length; i++) {
                nb_native().fs.getpwname(
                    DEFAULT_FS_CONFIG,
                    users[i].username
                )
                .catch(err => {
                    console.log('getpwname error - ', err);
                    throw err;
                }).then(res => {
                    console.log('getpwname res', res);
                    users[i].actual_config = res;
                });
            }
            await P.delay(5000);
            for (let i = 0; i < users.length; i++) {
                const actual = users[i].actual_config;
                const expected = users[i].expected_config;
                expect(actual.uid).toBe(expected.uid);
                expect(actual.gid).toBe(expected.gid);
            }
            }, TEST_TIMEOUT);
    });
});
