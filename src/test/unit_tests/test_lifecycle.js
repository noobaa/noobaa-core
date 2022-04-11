/* Copyright (C) 2022 NooBaa */
/* eslint-disable no-invalid-this */

'use strict';

const AWS = require('aws-sdk');
const P = require('../../util/promise');
const http_utils = require('../../util/http_utils');
const mocha = require('mocha');
const { v4: uuid } = require('uuid');
const assert = require('assert');
const util = require('util');
const lifecycle = require('../../server/bg_services/lifecycle');
const MDStore = require('../../server/object_services/md_store').MDStore;
const mongodb = require('mongodb');

const commonTests = require('../lifecycle/common');
const coretest = require('./coretest');
const { rpc_client, EMAIL } = coretest;
const Bucket = 'first.bucket';
const Key = `test-get-lifecycle-object-${Date.now()}`;
const TagName = 'tagname';
const TagName2 = 'tagname2';
const TagValue = 'tagvalue';
const TagValue2 = 'tagvalue2';

mocha.describe('lifecycle', () => {

    let s3;
    mocha.before(async function() {
        this.timeout(60000);

        const account_info = await rpc_client.account.read_account({ email: EMAIL, });
        s3 = new AWS.S3({
            endpoint: coretest.get_http_address(),
            accessKeyId: account_info.access_keys[0].access_key.unwrap(),
            secretAccessKey: account_info.access_keys[0].secret_key.unwrap(),
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            computeChecksums: true,
            s3DisableBodySigning: false,
            region: 'us-east-1',
            httpOptions: { agent: http_utils.get_unsecured_agent(coretest.get_http_address()) },
        });
        coretest.log('S3 CONFIG', s3.config);
    });

    mocha.describe('bucket-lifecycle-data-representation', function() {
        this.timeout(60000);

        mocha.it('test rules length', async () => {
            await commonTests.test_rules_length(Bucket, Key, s3);
        });
        mocha.it('test rule status', async () => {
            await commonTests.test_rule_status(Bucket, Key, s3);
        });
        mocha.it('test expiration date', async () => {
            await commonTests.test_expiration_date(Bucket, Key, s3);
        });
        mocha.it('test rule filter', async () => {
            await commonTests.test_rule_filter(Bucket, Key, s3);
        });
        mocha.it('test expiration days', async () => {
            await commonTests.test_expiration_days(Bucket, Key, s3);
        });
        mocha.it('test filter tag', async () => {
            await commonTests.test_filter_tag(Bucket, TagName, TagValue, s3);
        });
        mocha.it('test and tag', async () => {
            await commonTests.test_and_tag(Bucket, TagName, TagValue, TagName2, TagValue2, s3);
        });
        mocha.it('test and tags prefix days', async () => {
            await commonTests.test_and_tag_prefix(Bucket, Key, TagName, TagValue, TagName2, TagValue2, s3);
        });
        mocha.it('test rule id', async () => {
            await commonTests.test_rule_id(Bucket, Key, s3);
        });
        mocha.it('test empty rule', async () => {
            await commonTests.test_empty_filter(Bucket, s3);
        });
        mocha.it('test rule size', async () => {
            await commonTests.test_filter_size(Bucket, s3);
        });
        mocha.it('test and prefix size', async () => {
            await commonTests.test_and_prefix_size(Bucket, Key, s3);
        });
    });

    mocha.describe('bucket-lifecycle-bg-worker', function() {
        this.timeout(60000);

        async function create_mock_object(key, bucket, age, size, tagging) {
            const content_type = 'application/octet-stream';
            console.log('create_object_upload bucket', bucket, 'key', key, 'content-type', content_type);
            const { obj_id } = await rpc_client.object.create_object_upload({ bucket, key, content_type });
            console.log('create_object_upload obj_id', obj_id);
            const completeUploadResult = await rpc_client.object.complete_object_upload({ obj_id, bucket, key });
            console.log('completeUploadResult', completeUploadResult);

            // go back in time
            let create_time = new Date();
            create_time.setDate(create_time.getDate() - age);
            const update = {
                create_time,
            };
            if (size) update.size = size;
            if (tagging) update.tagging = tagging;

            console.log('create_mock_object bucket', bucket, 'key', key, 'update', util.inspect(update));
            const id = new mongodb.ObjectId(obj_id);
            console.log('create_mock_object id', id, 'obj_id', obj_id);

            const updateResult = await MDStore.instance().update_object_by_id(id, update);
            console.log('update_object_by_id', updateResult);

            const object_md = await rpc_client.object.read_object_md({ bucket, key, adminfo: {} });
            console.log('read_object_md object_md', object_md);
            const actual_create_time = object_md.create_time;
            const actual_size = object_md.size;
            const actual_tags = object_md.tagging;
            assert.strictEqual(actual_create_time, create_time.getTime(), `object create_time/getTime actual ${actual_create_time} !== expected ${create_time.getTime()}`);
            assert((size === undefined) || (size === actual_size), `object size actual ${actual_size} !== expected ${size}`);
            assert((tagging === undefined) || (JSON.stringify(actual_tags) === JSON.stringify(tagging)), `object tags actual ${util.inspect(actual_tags)} !== expected ${util.inspect(tagging)}`);
        }

        async function verify_object_deleted(key) {
            await P.delay(100); // 0.1sec
            await rpc_client.system.read_system();
            /* read_activity_log fails w/postgres
               see https://github.com/noobaa/noobaa-core/runs/5750698669
            */
            if (process.env.DB_TYPE !== 'postgres') {
                const eventLogs = await rpc_client.events.read_activity_log({limit: 32});
                console.log('read_activity_log logs: ', util.inspect(eventLogs));
                const found = eventLogs.logs.find(e => (e.event === 'obj.deleted') && (e.obj.key === key));
                console.log('read_activity_log found log: ', found);
                assert(found && found.obj.key === key, `find deleted actual ${util.inspect(found)} expected ${key}`);
            }
            const listObjectResult = await rpc_client.object.list_objects_admin({ bucket: Bucket, prefix: key });
            console.log('list_objects_admin objects: ', util.inspect(listObjectResult.objects));
            const actualLength = listObjectResult.objects.length;
            assert.strictEqual(actualLength, 0, `listObjectResult actual ${actualLength} !== expected 0`);
        }
        mocha.it('test prefix, absolute date expiration', async () => {
            const key = uuid();
            const prefix = key.split('-')[0];
            const age = 17;
            const bucket = Bucket;

            await create_mock_object(key, bucket, age);

            const putLifecycleParams = commonTests.date_lifecycle_configuration(bucket, prefix);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams).promise();
            await lifecycle.background_worker();
            await verify_object_deleted(key);
        });
        mocha.it('test prefix, absolute date and tags expiration', async () => {
            const key = uuid();
            const prefix = key.split('-')[0];
            const age = 17;
            const bucket = Bucket;
            const tagging = [ {key: 'tagname1', value: 'tagvalue1'}, {key: 'tagname2', value: 'tagvalue2'}, {key: 'tagname3', value: 'tagvalue3'}];

            await create_mock_object(key, bucket, age, undefined, tagging);
            // match by tags subset, out of order
            const filter_tagging = [ {key: 'tagname3', value: 'tagvalue3'}, {key: 'tagname2', value: 'tagvalue2'} ];
            const putLifecycleParams = commonTests.date_lifecycle_configuration_and_tags(bucket, prefix, filter_tagging);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams).promise();
            await lifecycle.background_worker();
            await verify_object_deleted(key);
        });
        mocha.it('test size less, absolute date expiration', async () => {
            const key = uuid();
            const age = 17;
            const size = 64;
            const bucket = Bucket;

            await create_mock_object(key, bucket, age);
            const putLifecycleParams = commonTests.size_less_lifecycle_configuration(bucket, size);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams).promise();
            await lifecycle.background_worker();
            await verify_object_deleted(key);
        });
        mocha.it('test size interval, absolute date expiration', async () => {
            const key = uuid();
            const age = 17;
            const gt = 1;
            const size_object = 2;
            const lt = 3;
            const bucket = Bucket;

            await create_mock_object(key, bucket, age, size_object);
            const putLifecycleParams = commonTests.size_gt_lt_lifecycle_configuration(bucket, gt, lt);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams).promise();
            await lifecycle.background_worker();
            await verify_object_deleted(key);
        });
        mocha.it('test size less, relative days expiration', async () => {
            const key = uuid();
            const object_age = 2;
            const days = 1;
            const size = 1;
            const bucket = Bucket;

            await create_mock_object(key, bucket, object_age);
            const putLifecycleParams = commonTests.size_less_days_lifecycle_configuration(bucket, size, days);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams).promise();
            await lifecycle.background_worker();
            await verify_object_deleted(key);
        });
        mocha.it('test tag, relative days expiration', async () => {
            const key = uuid();
            const object_age = 2;
            const days = 1;
            const tag = { key: 'tagname', value: 'tagvalue'};
            const tagging = [ tag ];
            const bucket = Bucket;

            await create_mock_object(key, bucket, object_age, undefined, tagging);
            const putLifecycleParams = commonTests.tag_days_lifecycle_configuration(bucket, days, tag);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams).promise();
            await lifecycle.background_worker();
            await verify_object_deleted(key);
        });

        console.log('✅ The lifecycle test was completed successfully');
    });
});
