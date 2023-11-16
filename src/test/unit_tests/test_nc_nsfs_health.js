/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const sinon = require('sinon');
const P = require('../../util/promise');
const fs_utils = require('../../util/fs_utils');
const nb_native = require('../../util/nb_native');
const NSFSHealth = require('../../cmd/health');
const native_fs_utils = require('../../util/native_fs_utils');
const config = require('../../../config');

const MAC_PLATFORM = 'darwin';
let tmp_fs_path = '/tmp/test_bucketspace_fs';
if (process.platform === MAC_PLATFORM) {
    tmp_fs_path = '/private/' + tmp_fs_path;
}
const DEFAULT_FS_CONFIG = {
    uid: process.getuid(),
    gid: process.getgid(),
    backend: '',
    warn_threshold_ms: 100,
};


mocha.describe('nsfs nc health', function() {

    const config_root = path.join(tmp_fs_path, 'config_root_nsfs_health');
    const root_path = path.join(tmp_fs_path, 'root_path_nsfs_health/');
    const accounts_schema_dir = 'accounts';
    const buckets_schema_dir = 'buckets';
    let health;

    mocha.before(async () => {
        await P.all(_.map([accounts_schema_dir, buckets_schema_dir], async dir =>
            fs_utils.create_fresh_path(`${config_root}/${dir}`)));
        await fs_utils.create_fresh_path(root_path);
    });
    mocha.after(async () => {
        fs_utils.folder_delete(`${config_root}`);
        fs_utils.folder_delete(`${root_path}`);
    });

    mocha.describe('health check', async function() {
        const acount_name = 'account1';
        const bucket_name = 'bucket1';
        const new_buckets_path = `${root_path}new_buckets_path_user1/`;
        const account1 = { name: acount_name, nsfs_account_config: { new_buckets_path: new_buckets_path } };
        const bucket1 = { name: bucket_name, path: new_buckets_path + '/bucket1' };
        mocha.before(async () => {
            const https_port = 6443;
            health = new NSFSHealth({ config_root, https_port });
            await fs_utils.create_fresh_path(new_buckets_path);
            await fs_utils.file_must_exist(new_buckets_path);
            await fs_utils.create_fresh_path(new_buckets_path + '/bucket1');
            await fs_utils.file_must_exist(new_buckets_path + '/bucket1');
            await write_config_file(config_root, accounts_schema_dir, acount_name, account1);
            await write_config_file(config_root, buckets_schema_dir, bucket_name, bucket1);
            const get_service_memory_usage = sinon.stub(health, "get_service_memory_usage");
            get_service_memory_usage.onFirstCall().returns(Promise.resolve(100));
        });

        mocha.after(async () => {
            fs_utils.folder_delete(new_buckets_path);
            fs_utils.folder_delete(path.join(new_buckets_path, 'bucket1'));
            fs_utils.file_delete(path.join(config_root, buckets_schema_dir, bucket1.name + '.json'));
            fs_utils.file_delete(path.join(config_root, accounts_schema_dir, account1.name + '.json'));
        });

        mocha.it('Health all condition is success', async function() {
            const get_service_state = sinon.stub(health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 100 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 200 }));
            const get_endpoint_response = sinon.stub(health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            health.all_account_details = true;
            health.all_bucket_details = true;
            const health_status = await health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.invalid_buckets.length, 0);
            assert.strictEqual(health_status.checks.valid_accounts.length, 1);
            assert.strictEqual(health_status.checks.valid_accounts[0].name, 'account1');
            assert.strictEqual(health_status.checks.valid_buckets.length, 1);
            assert.strictEqual(health_status.checks.valid_buckets[0].name, 'bucket1');
        });

        mocha.it('NSFS service is inactive', async function() {
            health.get_service_state.restore();
            health.get_endpoint_response.restore();
            const get_service_state = sinon.stub(health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'inactive', pid: 0 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 200 }));
            const get_endpoint_response = sinon.stub(health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'NOTOK');
            assert.strictEqual(health_status.error.error_code, 'NSFS_SERVICE_FAILED');
        });

        mocha.it('NSFS rsyslog service is inactive', async function() {
            health.get_service_state.restore();
            health.get_endpoint_response.restore();
            const get_service_state = sinon.stub(health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'inactive', pid: 0 }));
            const get_endpoint_response = sinon.stub(health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'NOTOK');
            assert.strictEqual(health_status.error.error_code, 'RSYSLOG_SERVICE_FAILED');
        });

        mocha.it('NSFS endpoint return error response is inactive', async function() {
            health.get_service_state.restore();
            health.get_endpoint_response.restore();
            const get_service_state = sinon.stub(health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'MISSING_FORKS', total_fork_count: 3, running_workers: ['1', '3']}}));
            const health_status = await health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'NOTOK');
            assert.strictEqual(health_status.error.error_code, 'NSFS_ENDPOINT_FORK_MISSING');
        });

        mocha.it('NSFS account with invalid storage path', async function() {
            health.get_service_state.restore();
            health.get_endpoint_response.restore();
            const account_invalid = { name: 'account_invalid', nsfs_account_config: { new_buckets_path: new_buckets_path + '/invalid' } };
            await write_config_file(config_root, accounts_schema_dir, account_invalid.name, account_invalid);
            const get_service_state = sinon.stub(health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.invalid_accounts.length, 1);
            assert.strictEqual(health_status.checks.invalid_accounts[0].name, 'account_invalid');
            fs_utils.file_delete(path.join(config_root, accounts_schema_dir, account_invalid.name + '.json'));
        });

        mocha.it('NSFS bucket with invalid storage path', async function() {
            health.get_service_state.restore();
            health.get_endpoint_response.restore();
            const bucket_invalid = { name: 'bucket_invalid', path: new_buckets_path + '/bucket1/invalid' };
            await write_config_file(config_root, buckets_schema_dir, bucket_invalid.name, bucket_invalid);
            const get_service_state = sinon.stub(health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.invalid_buckets.length, 1);
            assert.strictEqual(health_status.checks.invalid_buckets[0].name, 'bucket_invalid');
            fs_utils.file_delete(path.join(config_root, buckets_schema_dir, bucket_invalid.name + '.json'));
        });

        mocha.it('NSFS invalid bucket schema json', async function() {
            health.get_service_state.restore();
            health.get_endpoint_response.restore();
            const bucket_invalid_schema = { name: 'bucket_invalid_schema', path: new_buckets_path };
            await write_config_file(config_root, buckets_schema_dir, bucket_invalid_schema.name, bucket_invalid_schema, "invalid");
            const get_service_state = sinon.stub(health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.invalid_buckets.length, 1);
            assert.strictEqual(health_status.checks.invalid_buckets[0].name, 'bucket_invalid_schema.json');
            fs_utils.file_delete(path.join(config_root, buckets_schema_dir, bucket_invalid_schema.name + '.json'));
        });

        mocha.it('NSFS invalid account schema json', async function() {
            health.get_service_state.restore();
            health.get_endpoint_response.restore();
            const account_invalid_schema = { name: 'account_invalid_schema', path: new_buckets_path };
            await write_config_file(config_root, accounts_schema_dir, account_invalid_schema.name, account_invalid_schema, "invalid");
            const get_service_state = sinon.stub(health, "get_service_state");
            get_service_state.onFirstCall().returns(Promise.resolve({ service_status: 'active', pid: 1000 }))
                .onSecondCall().returns(Promise.resolve({ service_status: 'active', pid: 2000 }));
            const get_endpoint_response = sinon.stub(health, "get_endpoint_response");
            get_endpoint_response.onFirstCall().returns(Promise.resolve({response: {response_code: 'RUNNING', total_fork_count: 0}}));
            const health_status = await health.nc_nsfs_health();
            assert.strictEqual(health_status.status, 'OK');
            assert.strictEqual(health_status.checks.invalid_accounts.length, 1);
            assert.strictEqual(health_status.checks.invalid_accounts[0].name, 'account_invalid_schema.json');
            fs_utils.file_delete(path.join(config_root, buckets_schema_dir, account_invalid_schema.name + '.json'));
        });
    });
});

async function write_config_file(config_root, schema_dir, config_file_name, config_data, invalid_str = '') {
    const config_path = path.join(config_root, schema_dir, config_file_name + '.json');
    await nb_native().fs.writeFile(
        DEFAULT_FS_CONFIG,
        config_path, Buffer.from(JSON.stringify(config_data) + invalid_str), {
            mode: native_fs_utils.get_umasked_mode(config.BASE_MODE_FILE),
    });
}
