/* Copyright (C) 2016 NooBaa */
/*eslint max-lines-per-function: ['error', 800]*/

'use strict';

const path = require('path');
const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const config = require('../../../../../config');
const pkg = require('../../../../../package.json');
const fs = require('fs');
const fs_utils = require('../../../../util/fs_utils');
const nb_native = require('../../../../util/nb_native');
const { ConfigFS } = require('../../../../sdk/config_fs');
const mongo_utils = require('../../../../util/mongo_utils');
const test_utils = require('../../../system_tests/test_utils');
const NSFSHealth = require('../../../../manage_nsfs/health').NSFSHealth;
const { get_process_fs_context } = require('../../../../util/native_fs_utils');
const { ManageCLIError } = require('../../../../manage_nsfs/manage_nsfs_cli_errors');
const { TYPES, DIAGNOSE_ACTIONS, ACTIONS } = require('../../../../manage_nsfs/manage_nsfs_constants');
const { TMP_PATH, create_fs_user_by_platform, delete_fs_user_by_platform, exec_manage_cli, TEST_TIMEOUT } = require('../../../system_tests/test_utils');
const { CONFIG_DIR_PHASES } = require('../../../../sdk/config_fs');

const tmp_fs_path = path.join(TMP_PATH, 'test_nc_health');
const DEFAULT_FS_CONFIG = get_process_fs_context();

const bucket_storage_path = path.join(tmp_fs_path, 'bucket_storage_path');
const os = require('os');
const { health_warnings } = require('../../../../manage_nsfs/health');
const hostname = os.hostname();

const valid_system_json = {
    [hostname]: {
        current_version: pkg.version,
        upgrade_history: { successful_upgrades: [] },
    },
};

const get_service_state_mock_default_response = [{ service_status: 'active', pid: 1000 }, { service_status: 'active', pid: 2000 }];
const get_endpoint_response_mock_default_response = [{ response: { response_code: 'RUNNING', total_fork_count: 0 } }];
const get_system_config_mock_default_response = [{
    ...valid_system_json, config_directory: {
        phase: CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED, config_dir_version: '1.0.0',
        package_version: pkg.version, upgrade_history: []
} }];
const default_mock_upgrade_status = { message: 'there is no in-progress upgrade' };

const connection_from_file_path = path.join(tmp_fs_path, 'connection_from_file');
const connection_from_file = {
  agent_request_object: {
    host: "localhost",
    port: 9999,
    timeout: 100
  },
  notification_protocol: "http",
  name: "http_notif",
};

const config_root = path.join(tmp_fs_path, 'config_root_nsfs_health');
const config_fs = new ConfigFS(config_root);
const root_path = path.join(tmp_fs_path, 'root_path_nsfs_health/');
const config_root_invalid = path.join(tmp_fs_path, 'config_root_nsfs_health_invalid');
const tmp_lifecycle_logs_dir_path = path.join(TMP_PATH, 'test_lifecycle_logs');

mocha.describe('nsfs nc health', function() {
    let Health;

    mocha.before(async () => {
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
        mocha.afterEach(() => {
            restore_health_if_needed(Health);
        });

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
        this.timeout(10000);// eslint-disable-line no-invalid-this
        const new_buckets_path = `${root_path}new_buckets_path_user1/`;
        const orig_health_buckets_count_limit = config.NC_HEALTH_BUCKETS_COUNT_LIMIT_WARNING;
        const orig_health_accounts_count_limit = config.NC_HEALTH_ACCOUNTS_COUNT_LIMIT_WARNING;

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
        const account2_options = {
            name: 'account2',
            uid: process.getuid(),
            gid: process.getgid(),
            new_buckets_path: new_buckets_path
        };
        const account_inaccessible_options = { name: 'account_inaccessible', uid: 999, gid: 999, new_buckets_path: bucket_storage_path };
        const bucket_inaccessible_options = { name: 'bucket2', path: bucket_storage_path + '/bucket2', owner: account_inaccessible_options.name};
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
            this.timeout(5000);// eslint-disable-line no-invalid-this
            config.NSFS_NC_CONF_DIR = config_root;
            const https_port = 6443;
            Health = new NSFSHealth({ config_root, https_port, config_fs });
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await fs_utils.create_fresh_path(new_buckets_path + '/bucket1');
            await fs_utils.file_must_exist(new_buckets_path + '/bucket1');
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, {config_root, ...account1_options});
            await exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, {config_root, ...bucket1_options});
            await fs_utils.file_must_exist(path.join(config_root, 'master_keys.json'));
            test_utils.set_health_mock_functions(Health, { get_service_memory_usage: [100]});
            for (const user of Object.values(fs_users)) {
                await create_fs_user_by_platform(user.distinguished_name, user.distinguished_name, user.uid, user.gid);
            }
        });

        mocha.after(async () => {
            this.timeout(5000);// eslint-disable-line no-invalid-this
            fs_utils.folder_delete(new_buckets_path);
            fs_utils.folder_delete(path.join(new_buckets_path, 'bucket1'));
            await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, {config_root, name: bucket1_options.name});
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, {config_root, name: account1_options.name});
            for (const user of Object.values(fs_users)) {
                await delete_fs_user_by_platform(user.distinguished_name);
            }
            await fs_utils.folder_delete(config_root);
        });

        mocha.afterEach(async () => {
            await fs_utils.file_delete(config_fs.config_json_path);
            restore_health_if_needed(Health);
            config.NC_HEALTH_BUCKETS_COUNT_LIMIT_WARNING = orig_health_buckets_count_limit;
            config.NC_HEALTH_ACCOUNTS_COUNT_LIMIT_WARNING = orig_health_accounts_count_limit;
        });

        mocha.it('Health all condition is success', async function() {
            valid_system_json.config_directory = {
                config_dir_version: config_fs.config_dir_version,
                upgrade_package_version: pkg.version,
                phase: CONFIG_DIR_PHASES.CONFIG_DIR_UNLOCKED,
                upgrade_status: default_mock_upgrade_status
            };
            valid_system_json[hostname].config_dir_version = config_fs.config_dir_version;
            await Health.config_fs.create_system_config_file(JSON.stringify(valid_system_json));
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
            });
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            const health_status = await Health.nc_nsfs_health();
            await fs_utils.file_delete(Health.config_fs.system_json_path);
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets.length, 0);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts[0].name, 'account1');
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets[0].name, 'bucket1');
            assert_config_dir_status(health_status, valid_system_json.config_directory);
        });

        mocha.it('health should report on invalid connections', async function() {
            fs.writeFileSync(connection_from_file_path, JSON.stringify(connection_from_file));
            await exec_manage_cli(TYPES.CONNECTION, ACTIONS.ADD, { config_root, from_file: connection_from_file_path });

            Health.all_connection_details = true;
            const health_status = await Health.nc_nsfs_health();
            Health.all_connection_details = false;

            assert.strictEqual(health_status.checks.connections_status.invalid_storages[0].name, connection_from_file.name);
        });

        mocha.it('health should test notification storage', async function() {
            Health.notif_storage_threshold = true;
            config.NOTIFICATION_LOG_DIR = TMP_PATH;
            const health_status = await Health.nc_nsfs_health();
            Health.notif_storage_limit = false;

            console.log("PSA fs stats =", fs.statfsSync(config.NOTIFICATION_LOG_DIR));

            assert(health_status.checks.notif_storage_threshold_details.result.indexOf(' threshold') > -1);
            assert.strictEqual(health_status.checks.notif_storage_threshold_details.threshold, config.NOTIFICATION_SPACE_CHECK_THRESHOLD);
        });

        mocha.it('NooBaa service is inactive', async function() {
            test_utils.set_health_mock_functions(Health, {
                get_service_state: [{ service_status: 'inactive', pid: 0 }],
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'NOTOK');
            assert.strictEqual(health_status.error.error_code, 'NOOBAA_SERVICE_FAILED');
        });

        mocha.it('NooBaa endpoint return error response is inactive', async function() {
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: [{ response: { response_code: 'MISSING_FORKS', total_fork_count: 3, running_workers: ['1', '3'] } }],
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'NOTOK');
            assert.strictEqual(health_status.error.error_code, 'NOOBAA_ENDPOINT_FORK_MISSING');
        });

        mocha.it('NSFS account with invalid storage path', async function() {
            // create it manually because we can not skip invalid storage path check on the CLI
            const account_invalid_options = { _id: mongo_utils.mongoObjectId(), name: 'account_invalid', nsfs_account_config: { new_buckets_path: path.join(new_buckets_path, '/invalid') } };
            await test_utils.write_manual_config_file(TYPES.ACCOUNT, config_fs, account_invalid_options);
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].name, 'account_invalid');
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_invalid_options.name});
        });

        mocha.it('NSFS bucket with invalid storage path', async function() {
            this.timeout(5000);// eslint-disable-line no-invalid-this
            const resp = await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...account2_options });
            const parsed_res = JSON.parse(resp).response.reply;
            // create it manually because we can not skip invalid storage path check on the CLI
            const bucket_invalid = { _id: mongo_utils.mongoObjectId(), name: 'bucket_invalid', path: new_buckets_path + '/bucket1/invalid', owner_account: parsed_res._id };
            await test_utils.write_manual_config_file(TYPES.BUCKET, config_fs, bucket_invalid);
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets.length, 1);
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets[0].name, bucket_invalid.name);
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets[0].code, 'STORAGE_NOT_EXIST');
            await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, { config_root, name: bucket_invalid.name});
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account2_options.name});
        });

        mocha.it('Bucket with inaccessible path - uid gid', async function() {
            this.timeout(5000);// eslint-disable-line no-invalid-this
            await config_fs.create_config_json_file(JSON.stringify({ NC_DISABLE_ACCESS_CHECK: true }));
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...account_inaccessible_options });
            await exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, {config_root, ...bucket_inaccessible_options});
            await config_fs.delete_config_json_file();
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets.length, 1);
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets[0].code, 'ACCESS_DENIED');
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets[0].name, bucket_inaccessible_options.name);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].code, 'ACCESS_DENIED');
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].name, account_inaccessible_options.name);

            await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, { config_root, name: bucket_inaccessible_options.name});
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_inaccessible_options.name});
        });

        mocha.it('Bucket with inaccessible owner', async function() {
            this.timeout(5000);// eslint-disable-line no-invalid-this
            //create bucket manually, cli wont allow bucket with invalid owner
            const bucket_invalid_owner = { _id: mongo_utils.mongoObjectId(), name: 'bucket_invalid_account', path: new_buckets_path + '/bucket_account', owner_account: 'invalid_account' };
            await test_utils.write_manual_config_file(TYPES.BUCKET, config_fs, bucket_invalid_owner);
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets.length, 1);
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets[0].code, 'INVALID_ACCOUNT_OWNER');
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets[0].name, 'bucket_invalid_account');

            await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, { config_root, name: 'bucket_invalid_account'});
        });

        mocha.it('Bucket with empty owner', async function() {
            this.timeout(5000);// eslint-disable-line no-invalid-this
            //create bucket manually, cli wont allow bucket with empty owner
            const bucket_invalid_owner = { _id: mongo_utils.mongoObjectId(), name: 'bucket_invalid_account', path: new_buckets_path + '/bucket_account' };
            await test_utils.write_manual_config_file(TYPES.BUCKET, config_fs, bucket_invalid_owner);
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets.length, 1);
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets[0].code, 'MISSING_ACCOUNT_OWNER');
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets[0].name, 'bucket_invalid_account');

            await exec_manage_cli(TYPES.BUCKET, ACTIONS.DELETE, { config_root, name: 'bucket_invalid_account'});
        });

        mocha.it('NSFS invalid bucket schema json', async function() {
            // create it manually because we can not skip json schema check on the CLI
            const bucket_invalid_schema = { _id: mongo_utils.mongoObjectId(), name: 'bucket_invalid_schema', path: new_buckets_path };
            await test_utils.write_manual_config_file(TYPES.BUCKET, config_fs, bucket_invalid_schema, 'invalid');
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets.length, 1);
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets[0].name, bucket_invalid_schema.name);
            // delete it manually because we can not read non json files using the CLI
            await test_utils.delete_manual_config_file(TYPES.BUCKET, config_fs, bucket_invalid_schema);
        });

        mocha.it('NSFS invalid account schema json', async function() {
            // create it manually because we can not skip json schema check on the CLI
            const account_invalid_schema = { _id: mongo_utils.mongoObjectId(), name: 'account_invalid_schema', path: new_buckets_path, bla: 5 };
            await test_utils.write_manual_config_file(TYPES.ACCOUNT, config_fs, account_invalid_schema, 'invalid');
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].name, account_invalid_schema.name);
            // delete it manually because we can not read non json files using the CLI
            await test_utils.delete_manual_config_file(TYPES.ACCOUNT, config_fs, account_invalid_schema);
        });

        mocha.it('Health all condition is success, all_account_details is false', async function() {
            Health.all_account_details = false;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.buckets_status.invalid_buckets.length, 0);
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets[0].name, 'bucket1');
            assert.strictEqual(health_status.checks.accounts_status, undefined);
        });

        mocha.it('Health all condition is success, all_bucket_details is false', async function() {
            Health.all_account_details = true;
            Health.all_bucket_details = false;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.buckets_status, undefined);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts[0].name, 'account1');
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 0);
        });

        mocha.it('Config root path without bucket and account folders', async function() {
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            Health.config_root = config_root_invalid;
            const old_config_fs = Health.config_fs;
            Health.config_fs = new ConfigFS(config_root_invalid);
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
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
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].code, 'ACCESS_DENIED');
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].name, account_inaccessible_options.name);
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_inaccessible_options.name});
        });

        mocha.it('Account with inaccessible path - uid gid - NC_DISABLE_ACCESS_CHECK: true - should be valid', async function() {
            await config_fs.create_config_json_file(JSON.stringify({ NC_DISABLE_ACCESS_CHECK: true }));
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, debug: 5, ...account_inaccessible_options});
            await config_fs.delete_config_json_file();
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
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
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
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
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_inaccessible_dn_options.name });
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].code, 'ACCESS_DENIED');
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].name, account_inaccessible_dn_options.name);
        });

        mocha.it('Account with inaccessible path - dn - NC_DISABLE_ACCESS_CHECK: true - should be valid', async function() {
            await config_fs.create_config_json_file(JSON.stringify({ NC_DISABLE_ACCESS_CHECK: true }));
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...account_inaccessible_dn_options });
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
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
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
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
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: invalid_account_dn_options.name });
            assert.strictEqual(health_status.checks.buckets_status.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            const found = health_status.checks.accounts_status.invalid_accounts.filter(account =>
                account.name === invalid_account_dn_options.name);
            assert.strictEqual(found.length, 1);
            assert.strictEqual(found[0].code, 'INVALID_DISTINGUISHED_NAME');
        });

        mocha.it('Account with new_buckets_path missing and allow_bucket_creation false, valid account', async function() {
            const account_valid = { name: 'account_valid', uid: 999, gid: 999, allow_bucket_creation: false };
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...account_valid });
            Health.all_account_details = true;
            Health.all_bucket_details = false;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_valid.name });
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts[0].name, account_valid.name);
        });

        mocha.it('Account with new_buckets_path missing and allow_bucket_creation true, invalid account', async function() {
            const account_invalid = { name: 'account_invalid', uid: 999, gid: 999, allow_bucket_creation: true };
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { config_root, ...account_invalid });
            Health.all_account_details = true;
            Health.all_bucket_details = false;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            assert.strictEqual(health_status.checks.accounts_status.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.accounts_status.invalid_accounts.length, 1);
            await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.DELETE, { config_root, name: account_invalid.name });
        });

        mocha.it('accounts count below limit', async function() {
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            console.log('health_status', health_status);
            assert.strictEqual(health_status.checks.buckets_status.count, 1);
            assert.strictEqual(health_status.checks.accounts_status.count, 1);
            assert.strictEqual(health_status.warnings.length, 0);
        });

        mocha.it('accounts count above limit - should emit warning', async function() {
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            config.NC_HEALTH_ACCOUNTS_COUNT_LIMIT_WARNING = 0;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            console.log('health_status', health_status);
            assert.strictEqual(health_status.checks.buckets_status.count, 1);
            assert.strictEqual(health_status.checks.accounts_status.count, 1);
            assert.strictEqual(health_status.warnings.length, 1);
            assert.strictEqual(health_status.warnings.includes(health_warnings.ACCOUNTS_COUNT_LIMIT_WARNING), true);
        });

        mocha.it('buckets count below limit', async function() {
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            console.log('health_status', health_status);
            assert.strictEqual(health_status.checks.buckets_status.count, 1);
            assert.strictEqual(health_status.checks.accounts_status.count, 1);
            assert.strictEqual(health_status.warnings.length, 0);
        });

        mocha.it('buckets count above limit - should emit warning', async function() {
            config.NC_HEALTH_BUCKETS_COUNT_LIMIT_WARNING = 0;
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            console.log('health_status', health_status);
            assert.strictEqual(health_status.checks.buckets_status.count, 1);
            assert.strictEqual(health_status.checks.accounts_status.count, 1);
            assert.strictEqual(health_status.warnings.length, 1);
            assert.strictEqual(health_status.warnings.includes(health_warnings.BUCKETS_COUNT_LIMIT_WARNING), true);
        });

        mocha.it('buckets and accounts count above limit - should emit warnings', async function() {
            Health.all_account_details = true;
            Health.all_bucket_details = true;
            config.NC_HEALTH_BUCKETS_COUNT_LIMIT_WARNING = 0;
            config.NC_HEALTH_ACCOUNTS_COUNT_LIMIT_WARNING = 0;
            test_utils.set_health_mock_functions(Health, {
                get_service_state: get_service_state_mock_default_response,
                get_endpoint_response: get_endpoint_response_mock_default_response,
                get_system_config_file: get_system_config_mock_default_response
            });
            const health_status = await Health.nc_nsfs_health();
            console.log('health_status', health_status);
            assert.strictEqual(health_status.checks.buckets_status.count, 1);
            assert.strictEqual(health_status.checks.accounts_status.count, 1);
            assert.strictEqual(health_status.warnings.length, 2);
            assert.strictEqual(health_status.warnings.includes(health_warnings.ACCOUNTS_COUNT_LIMIT_WARNING), true);
            assert.strictEqual(health_status.warnings.includes(health_warnings.BUCKETS_COUNT_LIMIT_WARNING), true);
        });

        mocha.it('Health all condition - failed config directory upgrade status', async function() {
            valid_system_json.config_directory = {
                config_dir_version: config_fs.config_dir_version,
                upgrade_package_version: pkg.version,
                phase: CONFIG_DIR_PHASES.CONFIG_DIR_LOCKED,
                upgrade_history: {
                    successful_upgrades: [],
                    last_failure: { error: 'mock error'}
                },
                error: 'last_upgrade_failed'
            };
            valid_system_json[hostname].config_dir_version = config_fs.config_dir_version;
            await Health.config_fs.create_system_config_file(JSON.stringify(valid_system_json));
            const health_status = await Health.nc_nsfs_health();
            await fs_utils.file_delete(Health.config_fs.system_json_path);
            assert_config_dir_status(health_status, valid_system_json.config_directory);
        });

        mocha.it('Health all condition - valid ongoing config directory upgrade', async function() {
            valid_system_json.config_directory = {
                config_dir_version: config_fs.config_dir_version,
                upgrade_package_version: pkg.version,
                phase: CONFIG_DIR_PHASES.CONFIG_DIR_LOCKED,
                upgrade_history: {
                    successful_upgrades: [],
                },
                in_progress_upgrade: { from_version: '5.17.8', to_version: '5.18.0'}
            };
            await Health.config_fs.create_system_config_file(JSON.stringify(valid_system_json));
            const health_status = await Health.nc_nsfs_health();
            await fs_utils.file_delete(Health.config_fs.system_json_path);
            assert_config_dir_status(health_status, valid_system_json.config_directory);
        });

        mocha.it('health should report on blocked hosts - config directory data is missing, host is blocked for updates', async function() {
            valid_system_json.config_directory = undefined;
            valid_system_json[hostname].config_dir_version = config_fs.config_dir_version;
            await Health.config_fs.create_system_config_file(JSON.stringify(valid_system_json));
            const health_status = await Health.nc_nsfs_health();
            await fs_utils.file_delete(Health.config_fs.system_json_path);
            assert_config_dir_status(health_status, {
                error: 'config directory data is missing, must upgrade config directory',
                blocked_hosts: {
                    [hostname]: {
                        host_version: valid_system_json[hostname].current_version,
                        host_config_dir_version: valid_system_json[hostname].config_dir_version,
                        error: `host's config_dir_version is ${valid_system_json[hostname].config_dir_version}, system's config_dir_version is undefined, updates to the config directory will be blocked until the config dir upgrade`
                    }
                }
            });
        });
    });
});


mocha.describe('health - lifecycle', function() {
    const Health = new NSFSHealth({ config_root, config_fs, lifecycle: true });
    const orig_lifecycle_logs_dir = config.NC_LIFECYCLE_LOGS_DIR;

    mocha.before(async () => {
        await fs_utils.create_fresh_path(config_root);
        config.NC_LIFECYCLE_LOGS_DIR = tmp_lifecycle_logs_dir_path;
    });

    mocha.after(async () => {
        fs_utils.folder_delete(config_root);
        config.NC_LIFECYCLE_LOGS_DIR = orig_lifecycle_logs_dir;
    });

    mocha.beforeEach(async () => {
        await config_fs.create_config_json_file(JSON.stringify({ NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path }));
    });

    mocha.afterEach(async () => {
        fs_utils.folder_delete(tmp_lifecycle_logs_dir_path);
        await config_fs.delete_config_json_file();
    });

    mocha.it('Health lifecycle - lifecycle worker never ran on host', async function() {
        try {
            await nb_native().fs.readdir(config_fs.fs_context, tmp_lifecycle_logs_dir_path);
            assert.fail('tmp_lifecycle_logs_dir_path should not exist');
        } catch (err) {
            assert.equal(err.code, 'ENOENT');
        }
        const health_status = await Health.nc_nsfs_health();
        const empty_lifecycle_health_status = {};
        assert_lifecycle_status(health_status, empty_lifecycle_health_status, false);
    });

    mocha.it('Health lifecycle - after 1 run of the lifecycle worker', async function() {
        await exec_manage_cli(TYPES.LIFECYCLE, '', { config_root, disable_service_validation: true, disable_runtime_validation: true }, true);
        const lifecycle_log_entries = await nb_native().fs.readdir(config_fs.fs_context, tmp_lifecycle_logs_dir_path);
        assert.strictEqual(lifecycle_log_entries.length, 1);
        const log_file_path = path.join(tmp_lifecycle_logs_dir_path, lifecycle_log_entries[0].name);
        const lifecycle_log_json = await config_fs.get_config_data(log_file_path, { silent_if_missing: true });
        const health_status = await Health.nc_nsfs_health();
        assert_lifecycle_status(health_status, lifecycle_log_json, false);
    });

    mocha.it('Health lifecycle - should report on timeout error', async function() {
        await config_fs.update_config_json_file(JSON.stringify({
            NC_LIFECYCLE_TIMEOUT_MS: 1,
            NC_LIFECYCLE_LOGS_DIR: tmp_lifecycle_logs_dir_path
        }));
        await exec_manage_cli(TYPES.LIFECYCLE, '', { config_root, disable_service_validation: true, disable_runtime_validation: true }, true);
        const lifecycle_log_entries = await nb_native().fs.readdir(config_fs.fs_context, tmp_lifecycle_logs_dir_path);
        assert.strictEqual(lifecycle_log_entries.length, 1);
        const log_file_path = path.join(tmp_lifecycle_logs_dir_path, lifecycle_log_entries[0].name);
        const lifecycle_log_json = await config_fs.get_config_data(log_file_path, {silent_if_missing: true});
        const health_status = await Health.nc_nsfs_health();
        assert_lifecycle_status(health_status, lifecycle_log_json, true);
    });

    mocha.it('Health lifecycle - run lifecycle 3 times - should report on latest run', async function() {
        this.timeout(TEST_TIMEOUT);// eslint-disable-line no-invalid-this
        let latest_lifecycle;
        for (let i = 0; i < 3; i++) {
            latest_lifecycle = await exec_manage_cli(TYPES.LIFECYCLE, '', { config_root, disable_service_validation: true, disable_runtime_validation: true }, true);
        }
        const parsed_res_latest_lifecycle = JSON.parse(latest_lifecycle);
        const lifecycle_log_entries = await nb_native().fs.readdir(config_fs.fs_context, tmp_lifecycle_logs_dir_path);
        assert.strictEqual(lifecycle_log_entries.length, 3);
        const latest_log_file_path = _.maxBy(lifecycle_log_entries, entry => entry.name);
        const is_latest = latest_log_file_path.name.endsWith(parsed_res_latest_lifecycle.response.reply.lifecycle_run_times.run_lifecycle_start_time + '.json');
        assert.equal(is_latest, true);
        const log_file_path = path.join(tmp_lifecycle_logs_dir_path, latest_log_file_path.name);
        const lifecycle_log_json = await config_fs.get_config_data(log_file_path, { silent_if_missing: true });
        const health_status = await Health.nc_nsfs_health();
        assert_lifecycle_status(health_status, lifecycle_log_json, false);
    });
});

/**
 * assert_config_dir_status asserts config directory status
 * @param {Object} health_status 
 * @param {Object} expected_config_dir 
 */
function assert_config_dir_status(health_status, expected_config_dir) {
    const actual_config_dir_health = health_status.checks.config_directory_status;
    assert.strictEqual(actual_config_dir_health.error, expected_config_dir.error);
    assert.deepStrictEqual(actual_config_dir_health.blocked_hosts, expected_config_dir.blocked_hosts);
    assert.strictEqual(actual_config_dir_health.phase, expected_config_dir.phase);
    assert.strictEqual(actual_config_dir_health.config_dir_version, expected_config_dir.config_dir_version);
    assert.strictEqual(actual_config_dir_health.upgrade_package_version, expected_config_dir.upgrade_package_version);
    assert_upgrade_status(actual_config_dir_health.upgrade_status, expected_config_dir);
}

/**
 * assert_upgrade_status asserts there the actual and expected upgrade_status
 * @param {Object} actual_upgrade_status 
 * @param {Object} expected_upgrade_status
 */
function assert_upgrade_status(actual_upgrade_status, expected_upgrade_status) {
    const actual_upgrade_status_res = actual_upgrade_status?.in_progress_upgrade ||
        actual_upgrade_status?.last_failure ||
        actual_upgrade_status?.message;
    const expected_upgrade_status_res = expected_upgrade_status?.in_progress_upgrade ||
        expected_upgrade_status?.upgrade_history?.last_failure ||
        expected_upgrade_status?.upgrade_status?.message;
    assert.deepStrictEqual(actual_upgrade_status_res, expected_upgrade_status_res);
}

/**
 * assert_lifecycle_status asserts the lifecycle status
 * @param {Object} health_status 
 * @param {Object} lifecycle_log_json 
 * @param {Boolean} is_error_expected
 * @returns {Void}
 */
function assert_lifecycle_status(health_status, lifecycle_log_json, is_error_expected = false) {
    assert.deepStrictEqual(health_status.checks.latest_lifecycle_run_status.total_stats, lifecycle_log_json.total_stats);
    assert.deepStrictEqual(health_status.checks.latest_lifecycle_run_status.lifecycle_run_times,
        lifecycle_log_json.lifecycle_run_times);
    const err_value = is_error_expected ? lifecycle_log_json.errors : undefined;
    assert.deepStrictEqual(health_status.checks.latest_lifecycle_run_status.errors, err_value);
}

/**
 * restore_health_if_needed restores health obj functions if needed
 * @param {*} health_obj 
 */
function restore_health_if_needed(health_obj) {
    if (health_obj?.get_service_state?.restore) health_obj.get_service_state.restore();
    if (health_obj?.get_endpoint_response?.restore) health_obj.get_endpoint_response.restore();
    if (health_obj?.config_fs?.get_system_config_file?.restore) health_obj.config_fs.get_system_config_file.restore();
    if (health_obj?.get_service_memory_usage?.restore) health_obj.get_service_memory_usage.restore();
}
