/* Copyright (C) 2016 NooBaa */
/*eslint max-lines-per-function: ["error", 700]*/

'use strict';

const _ = require('lodash');
const path = require('path');
const mocha = require('mocha');
const sinon = require('sinon');
const assert = require('assert');
const P = require('../../util/promise');
const config = require('../../../config');
const fs_utils = require('../../util/fs_utils');
const nb_native = require('../../util/nb_native');
const { ConfigFS, CONFIG_SUBDIRS, JSON_SUFFIX } = require('../../sdk/config_fs');
const mongo_utils = require('../../util/mongo_utils');
const test_utils = require('../system_tests/test_utils');
const NSFSHealth = require('../../manage_nsfs/health').NSFSHealth;
const { get_process_fs_context } = require('../../util/native_fs_utils');
const { ManageCLIError } = require('../../manage_nsfs/manage_nsfs_cli_errors');
const { TYPES, DIAGNOSE_ACTIONS, ACTIONS } = require('../../manage_nsfs/manage_nsfs_constants');
const { TMP_PATH, create_fs_user_by_platform, delete_fs_user_by_platform, exec_manage_cli } = require('../system_tests/test_utils');

const tmp_fs_path = path.join(TMP_PATH, 'test_nc_health');
const DEFAULT_FS_CONFIG = get_process_fs_context();

const bucket_storage_path = path.join(tmp_fs_path, 'bucket_storage_path');

mocha.describe('nsfs nc health', function() {

    const config_root = path.join(tmp_fs_path, 'config_root_nsfs_health');
    const config_fs = new ConfigFS(config_root);
    const root_path = path.join(tmp_fs_path, 'root_path_nsfs_health/');
    const config_root_invalid = path.join(tmp_fs_path, 'config_root_nsfs_health_invalid');
    let Health;

    mocha.before(async () => {
        await P.all(_.map([CONFIG_SUBDIRS.ACCOUNTS, CONFIG_SUBDIRS.BUCKETS], async dir =>
            fs_utils.create_fresh_path(path.join(config_root, dir))));
        await fs_utils.create_fresh_path(root_path);
        await fs_utils.create_fresh_path(config_root_invalid);
        await nb_native().fs.mkdir(DEFAULT_FS_CONFIG, bucket_storage_path, 0o770);
    });
    mocha.after(async () => {
        fs_utils.folder_delete(config_root);
        fs_utils.folder_delete(root_path);
        fs_utils.folder_delete(config_root_invalid);
        await nb_native().fs.rmdir(DEFAULT_FS_CONFIG, bucket_storage_path);
    });

    mocha.describe('nsfs nc health cli validations', function() {
        mocha.it('https_port flag type validation - should fail', async function() {
            try {
                await exec_manage_cli(TYPES.DIAGNOSE, DIAGNOSE_ACTIONS.HEALTH, { 'http_port': '' });
                assert.fail('should have failed with InvalidArgument');
            } catch (err) {
                const res = JSON.parse(err.stdout);
                assert.equal(res.error.code, ManageCLIError.InvalidArgument.code);
            }
        });

        mocha.it('all_account_details flag type validation - should fail', async function() {
            try {
                await exec_manage_cli(TYPES.DIAGNOSE, DIAGNOSE_ACTIONS.HEALTH, { 'all_account_details': 'bla' });
                assert.fail('should have failed with InvalidBooleanValue');
            } catch (err) {
                const res = JSON.parse(err.stdout);
                assert.equal(res.error.code, ManageCLIError.InvalidBooleanValue.code);
            }
        });

        mocha.it('all_bucket_details flag type validation - should fail', async function() {
            try {
                await exec_manage_cli(TYPES.DIAGNOSE, DIAGNOSE_ACTIONS.HEALTH, { 'all_bucket_details': 7000 });
                assert.fail('should have failed with InvalidArgumentType');
            } catch (err) {
                const res = JSON.parse(err.stdout);
                assert.equal(res.error.code, ManageCLIError.InvalidArgumentType.code);
            }
        });

        mocha.it('all_bucket_details flag type validation', async function() {
            const res = await exec_manage_cli(TYPES.DIAGNOSE, DIAGNOSE_ACTIONS.HEALTH, { 'all_bucket_details': true });
            const parsed_res = JSON.parse(res).response.reply;
            assert.notEqual(parsed_res.checks.buckets_status, undefined);
            assert.ok(parsed_res.checks.buckets_status.invalid_buckets.length >= 0);
            assert.ok(parsed_res.checks.buckets_status.valid_buckets.length >= 0);
            assert.equal(parsed_res.checks.accounts_status, undefined);
        });

        mocha.it('all_account_details flag type validation', async function() {
            const res = await exec_manage_cli(TYPES.DIAGNOSE, DIAGNOSE_ACTIONS.HEALTH, { 'all_account_details': true });
            const parsed_res = JSON.parse(res).response.reply;
            assert.notEqual(parsed_res.checks.accounts_status, undefined);
            assert.ok(parsed_res.checks.accounts_status.invalid_accounts.length >= 0);
            assert.ok(parsed_res.checks.accounts_status.valid_accounts.length >= 0);
            assert.equal(parsed_res.checks.buckets_status, undefined);
        });
    });

    mocha.describe('health check', function() {
        const new_buckets_path = `${root_path}new_buckets_path_user1/`;
        const account1_options = {
            name: 'account1',
            uid: process.getuid(),
            gid: process.getgid(),
            new_buckets_path: new_buckets_path
        };
        const bucket1_options = {
            name: 'bucket1',
            path: new_buckets_path + '/bucket1',
            owner: account1_options.name
        };
        const account_inaccessible_options = { name: 'account_inaccessible', uid: 999, gid: 999, new_buckets_path: bucket_storage_path };
        const account_inaccessible_dn_options = { name: 'account_inaccessible_dn', user: 'inaccessible_dn', new_buckets_path: bucket_storage_path };
        const invalid_account_dn_options = { name: 'invalid_account_dn', user: 'invalid_account_dn', new_buckets_path: bucket_storage_path };
        const fs_users = {
            other_user: {
                distinguished_name: account_inaccessible_dn_options.user,
                uid: 1312,
                gid: 1312
            }
        };
        mocha.before(async () => {
            const https_port = 6443;
            Health = new NSFSHealth({ config_root, https_port, config_fs });
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await fs_utils.create_fresh_path(new_buckets_path + '/bucket1');
            await fs_utils.file_must_exist(new_buckets_path + '/bucket1');
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, {config_root, ...account1_options});
            await exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, {config_root, ...bucket1_options});
            const get_service_memory_usage = sinon.stub(Health, "get_service_memory_usage");
            get_service_memory_usage.onFirstCall().returns(Promise.resolve(100));
            for (const user of Object.values(fs_users)) {
                await create_fs_user_by_platform(user.distinguished_name, user.distinguished_name, user.uid, user.gid);
            }
        });

        mocha.after(async () => {
            fs_utils.folder_delete(new_buckets_path);
            fs_utils.folder_delete(path.join(new_buckets_path, 'bucket1'));
            await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, {config_root, name: bucket1_options.name});
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, {config_root, name: account1_options.name});
            for (const user of Object.values(fs_users)) {
                await delete_fs_user_by_platform(user.distinguished_name);
            }
        });

        mocha.afterEach(async () => {
            await fs_utils.file_delete(config_fs.config_json_path);
        });

        mocha.it('Health all condition is success', async function() {
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 100 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 200 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets.length, 0);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts[0].name, 'account1');
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets[0].name, 'bucket1');
        });

        mocha.it('NooBaa service is inactive', async function() {
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'inactive', pid: 0 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 200 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'NOTOK');
            assert.strictEqual(health_status.error.error_code, 'NOOBAA_SERVICE_FAILED');
        });

        mocha.it('NooBaa endpoint return error response is inactive', async function() {
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'MISSING_FORKS', total_fork_count: 3, running_workers: ['1', '3']}}));
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'NOTOK');
            assert.strictEqual(health_status.error.error_code, 'NOOBAA_ENDPOINT_FORK_MISSING');
        });

        mocha.it('NSFS account with invalid storage path', async function() {
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            // create it manually because we can not skip invalid storage path check on the CLI
            const account_invalid_options = { _id: mongo_utils.mongoObjectId(), name: 'account_invalid', nsfs_account_config: { new_buckets_path: path.join(new_buckets_path, '/invalid') } };
            await test_utils.write_manual_config_file(TYPES.ACCOUNT, config_fs, account_invalid_options);
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].name, 'account_invalid');
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_invalid_options.name});
        });

        mocha.it('NSFS bucket with invalid storage path', async function() {
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            // create it manually because we can not skip invalid storage path check on the CLI
            const bucket_invalid = { _id: mongo_utils.mongoObjectId(), name: 'bucket_invalid', path: new_buckets_path + '/bucket1/invalid', owner: account1_options.name };
            await test_utils.write_manual_config_file(TYPES.BUCKET, config_fs, bucket_invalid);
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets.length, 1);
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets[0].name, bucket_invalid.name);
            await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, { config_root, name: bucket_invalid.name});
        });

        mocha.it('NSFS invalid bucket schema json', async function() {
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            // create it manually because we can not skip json schema check on the CLI
            const bucket_invalid_schema = { _id: mongo_utils.mongoObjectId(), name: 'bucket_invalid_schema', path: new_buckets_path };
            await test_utils.write_manual_config_file(TYPES.BUCKET, config_fs, bucket_invalid_schema, 'invalid');

            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets.length, 1);
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets[0].name, bucket_invalid_schema.name + JSON_SUFFIX);
            // delete it manually because we can not read non json files using the CLI
            await test_utils.delete_manual_config_file(TYPES.BUCKET, config_fs, bucket_invalid_schema);
        });

        mocha.it('NSFS invalid account schema json', async function() {
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            // create it manually because we can not skip json schema check on the CLI
            const account_invalid_schema = { _id: mongo_utils.mongoObjectId(), name: 'account_invalid_schema', path: new_buckets_path, bla: 5 };
            await test_utils.write_manual_config_file(TYPES.ACCOUNT, config_fs, account_invalid_schema, 'invalid');
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].name, account_invalid_schema.name + JSON_SUFFIX);
            // delete it manually because we can not read non json files using the CLI
            await test_utils.delete_manual_config_file(TYPES.ACCOUNT, config_fs, account_invalid_schema);
        });

        mocha.it('Health all condition is success, all_account_details is false', async function() {
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            Health.all_account_details = false;
            Health.all_bucket_details = true;
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 100 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 200 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets.length, 0);
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets[0].name, 'bucket1');
            assert.strictEqual(health_status.checks.accounts_status, undefined);
        });

        mocha.it('Health all condition is success, all_bucket_details is false', async function() {
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            Health.all_account_details = true;
            Health.all_bucket_details = false;
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 100 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 200 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.buckets_status, undefined);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts[0].name, 'account1');
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 0);
        });

        mocha.it('Config root path without bucket and account folders', async function() {
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            Health.config_root = config_root_invalid;
            const old_config_fs = Health.config_fs;
            Health.config_fs = new ConfigFS(config_root_invalid);
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 100 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 200 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 0);
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets.length, 0);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 0);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 0);
            //revert to config root
            Health.config_root = config_root;
            Health.config_fs = old_config_fs;
        });

        mocha.it('Account with inaccessible path - uid gid', async function() {
            await config_fs.create_config_json_file(JSON.stringify({ NC_DISABLE_ACCESS_CHECK: true }));
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...account_inaccessible_options });
            await config_fs.delete_config_json_file();
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].code, "ACCESS_DENIED");
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].name, account_inaccessible_options.name);
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_inaccessible_options.name});
        });

        mocha.it('Account with inaccessible path - uid gid - NC_DISABLE_ACCESS_CHECK: true - should be valid', async function() {
            await config_fs.create_config_json_file(JSON.stringify({ NC_DISABLE_ACCESS_CHECK: true }));
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, debug: 5, ...account_inaccessible_options});
            await config_fs.delete_config_json_file();
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            config.NC_DISABLE_ACCESS_CHECK = true;
            const health_status = await Health.nc_nsfs_health();
            config.NC_DISABLE_ACCESS_CHECK = false;
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_inaccessible_options.name});
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 2);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 0);
            const inaccessible_is_valid = health_status.checks.accounts_status.valid_accounts.find(account =>
                account.name === account_inaccessible_options.name);
            assert.strictEqual(inaccessible_is_valid.storage_path, account_inaccessible_options.new_buckets_path);
        });

        mocha.it('Account with inaccessible path - uid gid - NC_DISABLE_HEALTH_ACCESS_CHECK: true - should be valid', async function() {
            await config_fs.create_config_json_file(JSON.stringify({ NC_DISABLE_ACCESS_CHECK: true }));
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...account_inaccessible_options });
            await config_fs.delete_config_json_file();
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            config.NC_DISABLE_HEALTH_ACCESS_CHECK = true;
            const health_status = await Health.nc_nsfs_health();
            config.NC_DISABLE_HEALTH_ACCESS_CHECK = false;
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_inaccessible_options.name });
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 2);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 0);
            const inaccessible_is_valid = health_status.checks.accounts_status.valid_accounts.find(account =>
                account.name === account_inaccessible_options.name);
            assert.strictEqual(inaccessible_is_valid.storage_path, account_inaccessible_options.new_buckets_path);
        });

        mocha.it('Account with inaccessible path - dn', async function() {
            await config_fs.create_config_json_file(JSON.stringify({ NC_DISABLE_ACCESS_CHECK: true }));
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...account_inaccessible_dn_options });
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await Health.nc_nsfs_health();
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_inaccessible_dn_options.name });
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].code, "ACCESS_DENIED");
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].name, account_inaccessible_dn_options.name);
        });

        mocha.it('Account with inaccessible path - dn - NC_DISABLE_ACCESS_CHECK: true - should be valid', async function() {
            await config_fs.create_config_json_file(JSON.stringify({ NC_DISABLE_ACCESS_CHECK: true }));
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...account_inaccessible_dn_options });
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({ response: { response_code: 'RUNNING', total_fork_count: 0 } }));
            config.NC_DISABLE_ACCESS_CHECK = true;
            const health_status = await Health.nc_nsfs_health();
            config.NC_DISABLE_ACCESS_CHECK = false;
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_inaccessible_dn_options.name });
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 2);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 0);
            const inaccessible_is_valid = health_status.checks.accounts_status.valid_accounts.find(account =>
                account.name === account_inaccessible_dn_options.name);
            assert.strictEqual(inaccessible_is_valid.storage_path, account_inaccessible_dn_options.new_buckets_path);
        });

        mocha.it('Account with inaccessible path - dn - NC_DISABLE_HEALTH_ACCESS_CHECK: true - should be valid', async function() {
            await config_fs.create_config_json_file(JSON.stringify({ NC_DISABLE_ACCESS_CHECK: true }));
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...account_inaccessible_dn_options });
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({ response: { response_code: 'RUNNING', total_fork_count: 0 } }));
            config.NC_DISABLE_HEALTH_ACCESS_CHECK = true;
            const health_status = await Health.nc_nsfs_health();
            config.NC_DISABLE_HEALTH_ACCESS_CHECK = false;
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_inaccessible_dn_options.name });
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 2);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 0);
            const inaccessible_is_valid = health_status.checks.accounts_status.valid_accounts.find(account =>
                account.name === account_inaccessible_dn_options.name);
            assert.strictEqual(inaccessible_is_valid.storage_path, account_inaccessible_dn_options.new_buckets_path);
        });

        mocha.it('Account with invalid dn', async function() {
            await config_fs.create_config_json_file(JSON.stringify({ NC_DISABLE_ACCESS_CHECK: true }));
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...invalid_account_dn_options });
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await Health.nc_nsfs_health();
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: invalid_account_dn_options.name });
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            const found = health_status.checks.accounts_status.invalid_accounts.filter(account =>
                account.name === invalid_account_dn_options.name);
            assert.strictEqual(found.length, 1);
            assert.strictEqual(found[0].code, "INVALID_DISTINGUISHED_NAME");
        });

        mocha.it('Account with new_buckets_path missing and allow_bucket_creation false, valid account', async function() {
            const account_valid = { name: 'account_valid', uid: 999, gid: 999, allow_bucket_creation: false };
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...account_valid });
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            Health.all_account_details = true;
            Health.all_bucket_details = false;
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await Health.nc_nsfs_health();
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_valid.name });
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].name, account_valid.name);
        });

        mocha.it('Account with new_buckets_path missing and allow_bucket_creation true, invalid account', async function() {
            const account_invalid = { name: 'account_invalid', uid: 999, gid: 999, allow_bucket_creation: true };
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...account_invalid });
            Health.get_service_state.restore();
            Health.get_endpoint_response.restore();
            Health.all_account_details = true;
            Health.all_bucket_details = false;
            const get_service_state = sinon.stub(Health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(Health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_invalid.name });
        });
    });
});

