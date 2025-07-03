/* Copyright (C) 2024 NooBaa */
'use strict';

const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const fs_utils = require('../../../../util/fs_utils');
const nb_native = require('../../../../util/nb_native');
const { get_process_fs_context } = require('../../../../util/native_fs_utils');
const { ManageCLIResponse } = require('../../../../manage_nsfs/manage_nsfs_cli_responses');
const { exec_manage_cli, require_coretest, TMP_PATH } = require('../../../system_tests/test_utils');
const { TYPES, ACTIONS } = require('../../../../manage_nsfs/manage_nsfs_constants');

const DEFAULT_FS_CONFIG = get_process_fs_context();

const coretest = require_coretest();
coretest.setup({});

mocha.describe('cli logging flow', async function() {
    this.timeout(50000); // eslint-disable-line no-invalid-this
    const bucket_path = path.join(TMP_PATH, 'log_bucket');
    const pers_log_path = path.join(TMP_PATH, 'pers_logs');

    mocha.before(async () => {
        await fs_utils.create_fresh_path(pers_log_path);
        await fs_utils.create_fresh_path(bucket_path);
        await fs_utils.file_must_exist(bucket_path);
        await exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, { name: 'logbucketowner', user: 'root', new_buckets_path: bucket_path});
        await exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, { name: 'logbucket', path: bucket_path, owner: 'logbucketowner'});
        const data = '{"noobaa_bucket_logging":"true","op":"GET","bucket_owner":"admin@noobaa.io",' +
            '"source_bucket":"s3-bucket",' +
            '"object_key":"/s3-bucket?list-type=2&prefix=&delimiter=%2F&encoding-type=url",' +
            '"log_bucket":"logbucket",' +
            '"log_prefix":"","remote_ip":"100.64.0.2",' +
            '"request_uri":"/s3-bucket?list-type=2&prefix=&delimiter=%2F&encoding-type=url",' +
            '"http_status":102,"request_id":"lztyrl5k-7enflf-19sm"}';
        await nb_native().fs.writeFile(DEFAULT_FS_CONFIG, path.join(pers_log_path + '/', 'bucket_logging.log'),
            Buffer.from(data + '\n'));
    });

    mocha.it('cli run logging', async function() {
        const res = await exec_manage_cli(TYPES.LOGGING, '', {}, false, { 'GUARANTEED_LOGS_PATH': pers_log_path});
        const entries = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, bucket_path);
        const log_objects = entries.filter(entry => !entry.name.startsWith('.'));
        assert.equal(log_objects.length, 1); // 1 new log_object should have been uploaded to the bucket
        const parsed = JSON.parse(res);
        assert.equal(parsed.response.code, ManageCLIResponse.LoggingExported.code);
    });
});
