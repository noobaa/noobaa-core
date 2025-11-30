/* Copyright (C) 2025 NooBaa */
/* eslint-disable max-statements */
/* eslint-disable max-lines-per-function */
'use strict';

const path = require('path');
const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const SensitiveString = require('../../../../util/sensitive_string');
const fs_utils = require('../../../../util/fs_utils');
const { TMP_PATH, generate_nsfs_account, get_new_buckets_path_by_test_env, generate_iam_client,
         require_coretest, is_nc_coretest } = require('../../../system_tests/test_utils');
const { CreateUserCommand, UpdateUserCommand, DeleteUserCommand } = require('@aws-sdk/client-iam');
const IamError = require('../../../../endpoint/iam/iam_errors').IamError;


const coretest = require_coretest();
let setup_options;
if (is_nc_coretest) {
    setup_options = { should_run_iam: true, https_port_iam: 7005, debug: 5 };
}
coretest.setup(setup_options);
const { rpc_client, EMAIL, get_current_setup_options, stop_nsfs_process, start_nsfs_process } = coretest;

let iam_account;
let account_res;
let config_root;

mocha.describe('IAM advanced integration tests', async function() {
    this.timeout(50000); // eslint-disable-line no-invalid-this

    mocha.before(async () => {
        // we want to make sure that we run this test with a couple of forks (by default setup it is 0)
        if (is_nc_coretest) {
            config_root = path.join(TMP_PATH, 'test_nc_iam');
            // on NC - new_buckets_path is full absolute path
            // on Containerized - new_buckets_path is the directory
            const new_bucket_path_param = get_new_buckets_path_by_test_env(config_root, '/');

            const current_setup_options = get_current_setup_options();
            const same_setup = _.isEqual(current_setup_options, setup_options);
            if (!same_setup) {
                console.log('current_setup_options', current_setup_options, 'same_setup', same_setup);
                await stop_nsfs_process();
                await start_nsfs_process(setup_options);
            }
            await fs_utils.create_fresh_path(new_bucket_path_param);
            await fs_utils.file_must_exist(new_bucket_path_param);
            account_res = await generate_nsfs_account(rpc_client, EMAIL, new_bucket_path_param, { admin: true });
        } else {
            // test are running from an account (not admin)
            const account = await rpc_client.account.create_account({
                name: "test-account",
                email: "test-account@noobaa.io",
                has_login: false,
                s3_access: true,
            });
            account_res = account.access_keys[0];
        }

        // needed details for creating the account (and then the client)
        const coretest_endpoint_iam = coretest.get_https_address_iam();
        const access_key = account_res.access_key instanceof SensitiveString ? account_res.access_key.unwrap() : account_res.access_key;
        const secret_key = account_res.secret_key instanceof SensitiveString ? account_res.secret_key.unwrap() : account_res.secret_key;
        iam_account = generate_iam_client(access_key, secret_key, coretest_endpoint_iam);
    });

    mocha.after(async () => {
        if (is_nc_coretest) {
            fs_utils.folder_delete(`${config_root}`);
        }
    });

    mocha.describe('IAM User API', async function() {
        const username = 'Mateo';
        const username_lowercase = username.toLowerCase();
        const username_uppercase = username.toUpperCase();

        mocha.describe('IAM CreateUser API', async function() {
            mocha.before(async () => {
                // create a user
                const input = {
                    UserName: username
                };
                const command = new CreateUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });

            mocha.after(async () => {
                // delete a user
                const input = {
                    UserName: username
                };
                const command = new DeleteUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });

            mocha.it('create a user with username that already exists should fail', async function() {
                try {
                    const input = {
                        UserName: username
                    };
                    const command = new CreateUserCommand(input);
                    await iam_account.send(command);
                    assert.fail('create user with existing username - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.EntityAlreadyExists.code);
                }
            });

            mocha.it('create a user with username that already exists (lower case) should fail', async function() {
                try {
                    const input = {
                        UserName: username_lowercase
                    };
                    const command = new CreateUserCommand(input);
                    await iam_account.send(command);
                    assert.fail('create user with existing username (lower case) - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.EntityAlreadyExists.code);
                }
            });

            mocha.it('create a user with username that already exists (upper case) should fail', async function() {
                try {
                    const input = {
                        UserName: username_uppercase
                    };
                    const command = new CreateUserCommand(input);
                    await iam_account.send(command);
                    assert.fail('create user with existing username (upper case) - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.EntityAlreadyExists.code);
                }
            });
        });

        mocha.describe('IAM UpdateUser API', async function() {
            mocha.beforeEach(async () => {
                // create a user
                const input = {
                    UserName: username
                };
                const command = new CreateUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });

            mocha.afterEach(async () => {
                // delete a user
                const input = {
                    UserName: username
                };
                const command = new DeleteUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });

            mocha.it('update a user with same username', async function() {
                const input = {
                    UserName: username,
                    NewUserName: username,
                };
                const command = new UpdateUserCommand(input);
                const response = await iam_account.send(command);
                _check_status_code_ok(response);
            });

            mocha.it('update a user with new username that already exists (lower case) should fail', async function() {
                try {
                    const input = {
                        UserName: username,
                        NewUserName: username_lowercase,
                    };
                    const command = new UpdateUserCommand(input);
                    await iam_account.send(command);
                    assert.fail('update user with existing username (lower case) - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.EntityAlreadyExists.code);
                }
            });

            mocha.it('update a user with new username that already exists (upper case) should fail', async function() {
                try {
                    const input = {
                        UserName: username,
                        NewUserName: username_uppercase,
                    };
                    const command = new UpdateUserCommand(input);
                    await iam_account.send(command);
                    assert.fail('update user with existing username (upper case) - should throw an error');
                } catch (err) {
                    const err_code = err.Error.Code;
                    assert.equal(err_code, IamError.EntityAlreadyExists.code);
                }
            });
        });

    });
});

/**
 * _check_status_code_ok is an helper function to check that we got an response from the server
 * @param {{ $metadata: { httpStatusCode: number; }; }} response
 */
function _check_status_code_ok(response) {
    assert.equal(response.$metadata.httpStatusCode, 200);
}
