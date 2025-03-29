/* Copyright (C) 2022 NooBaa */
/* eslint-disable no-invalid-this */
/* eslint max-lines-per-function: ["error", 2000]*/

'use strict';

const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
const util = require('util');
const mocha = require('mocha');
const assert = require('assert');
const mongodb = require('mongodb');
const _ = require('lodash');
const crypto = require('crypto');
const stream = require('stream');
const moment = require('moment');

const ObjectIO = require('../../sdk/object_io');
const P = require('../../util/promise');
const config = require('../../../config');
const MDStore = require('../../server/object_services/md_store').MDStore;
const coretest = require('./coretest');
const lifecycle = require('../../server/bg_services/lifecycle');
const http_utils = require('../../util/http_utils');
const commonTests = require('../lifecycle/common');
const seed = crypto.randomBytes(16);
const generator = crypto.createCipheriv('aes-128-gcm', seed, Buffer.alloc(12));

const { rpc_client, EMAIL } = coretest;
const Bucket = 'first.bucket';
const Key = `test-get-lifecycle-object-${Date.now()}`;
const TagName = 'tagname';
const TagName2 = 'tagname2';
const TagValue = 'tagvalue';
const TagValue2 = 'tagvalue2';

const object_io = new ObjectIO();
object_io.set_verification_mode();


mocha.describe('lifecycle', () => {

    let s3;
    mocha.before(async function() {
        this.timeout(60000);

        const account_info = await rpc_client.account.read_account({ email: EMAIL, });
        s3 = new S3({
            endpoint: coretest.get_http_address(),
            credentials: {
                accessKeyId: account_info.access_keys[0].access_key.unwrap(),
                secretAccessKey: account_info.access_keys[0].secret_key.unwrap(),
            },
            forcePathStyle: true,
            region: config.DEFAULT_REGION,
            requestHandler: new NodeHttpHandler({
                httpAgent: http_utils.get_unsecured_agent(coretest.get_http_address())
            }),
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
        mocha.it('test rule size', async () => {
            await commonTests.test_filter_size(Bucket, s3);
        });
        mocha.it('test and prefix size', async () => {
            await commonTests.test_and_prefix_size(Bucket, Key, s3);
        });
        mocha.it('test version', async () => {
            await commonTests.test_version(Bucket, Key, s3);
        });
        mocha.it('test multipath', async () => {
            await commonTests.test_multipart(Bucket, Key, s3);
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
            const create_time = new Date();
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
            const listObjectResult = await rpc_client.object.list_objects_admin({ bucket: Bucket, prefix: key });
            console.log('list_objects_admin objects: ', util.inspect(listObjectResult.objects));
            const actualLength = listObjectResult.objects.length;
            assert.strictEqual(actualLength, 0, `listObjectResult actual ${actualLength} !== expected 0`);
        }

        mocha.it('test prefix, absolute date expiration', async () => {
            const key = crypto.randomUUID();
            const prefix = key.split('-')[0];
            const age = 17;
            const bucket = Bucket;

            await create_mock_object(key, bucket, age);

            const putLifecycleParams = commonTests.date_lifecycle_configuration(bucket, prefix);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await lifecycle.background_worker();
            await verify_object_deleted(key);
        });
        mocha.it('test prefix, absolute date and tags expiration', async () => {
            const key = crypto.randomUUID();
            const prefix = key.split('-')[0];
            const age = 17;
            const bucket = Bucket;
            const tagging = [{ key: 'tagname1', value: 'tagvalue1' }, { key: 'tagname2', value: 'tagvalue2' }, { key: 'tagname3', value: 'tagvalue3' }];

            await create_mock_object(key, bucket, age, undefined, tagging);
            // match by tags subset, out of order
            const filter_tagging = [{ key: 'tagname3', value: 'tagvalue3' }, { key: 'tagname2', value: 'tagvalue2' }];
            const putLifecycleParams = commonTests.date_lifecycle_configuration_and_tags(bucket, prefix, filter_tagging);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await lifecycle.background_worker();
            await verify_object_deleted(key);
        });
        mocha.it('test size less, absolute date expiration', async () => {
            const key = crypto.randomUUID();
            const age = 17;
            const size = 64;
            const bucket = Bucket;

            await create_mock_object(key, bucket, age);
            const putLifecycleParams = commonTests.size_less_lifecycle_configuration(bucket, size);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await lifecycle.background_worker();
            await verify_object_deleted(key);
        });
        mocha.it('test size interval, absolute date expiration', async () => {
            const key = crypto.randomUUID();
            const age = 17;
            const gt = 1;
            const size_object = 2;
            const lt = 3;
            const bucket = Bucket;

            await create_mock_object(key, bucket, age, size_object);
            const putLifecycleParams = commonTests.size_gt_lt_lifecycle_configuration(bucket, gt, lt);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await lifecycle.background_worker();
            await verify_object_deleted(key);
        });
        mocha.it('test size less, relative days expiration', async () => {
            const key = crypto.randomUUID();
            const object_age = 2;
            const days = 1;
            const size = 1;
            const bucket = Bucket;

            await create_mock_object(key, bucket, object_age);
            const putLifecycleParams = commonTests.size_less_days_lifecycle_configuration(bucket, size, days);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await lifecycle.background_worker();
            await verify_object_deleted(key);
        });
        mocha.it('test tag, relative days expiration', async () => {
            const key = crypto.randomUUID();
            const object_age = 2;
            const days = 1;
            const tag = { key: 'tagname', value: 'tagvalue' };
            const tagging = [tag];
            const bucket = Bucket;

            await create_mock_object(key, bucket, object_age, undefined, tagging);
            const putLifecycleParams = commonTests.tag_days_lifecycle_configuration(bucket, days, tag);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await lifecycle.background_worker();
            await verify_object_deleted(key);
        });

        console.log('✅ The lifecycle test was completed successfully');
    });

    mocha.describe('bucket-lifecycle-multipart-upload', function() {
        // Not supported in other DBs
        if (config.DB_TYPE !== 'postgres') return;

        this.timeout(60000);
        const multipart_bucket = 'test-multipart-bucket';

        mocha.before(async function() {
            await rpc_client.bucket.create_bucket({ name: multipart_bucket });
        });

        mocha.after(async function() {
            await rpc_client.bucket.delete_bucket({ name: multipart_bucket });
        });

        mocha.it('basic test cleanup abandoned multipart upload', async function() {
            const bucket = multipart_bucket;
            const key = 'test-lifecycle-multipart-basic-0';
            const parts_age = 3;
            const parts_count = 7;
            const part_size = 45;

            const putLifecycleParams = {
                Bucket: bucket,
                LifecycleConfiguration: {
                    Rules: [
                        {
                            AbortIncompleteMultipartUpload: {
                                // 10 less days have gone by since upload created
                                DaysAfterInitiation: parts_age + 10,
                            },
                            Filter: {
                                Prefix: ''
                            },
                            Status: 'Enabled',
                        }
                    ],
                },
            };

            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            const obj_id = await create_mock_multipart_upload(key, multipart_bucket, parts_age, part_size, parts_count);
            await lifecycle.background_worker();

            // Ensure that there are still same number of parts
            const mp_list = await rpc_client.object.list_multiparts({ obj_id, bucket, key });
            assert.strictEqual(mp_list.multiparts.length, parts_count);

            // Change DaysAfterInitiation
            putLifecycleParams.LifecycleConfiguration.Rules[0].AbortIncompleteMultipartUpload.DaysAfterInitiation = parts_age - 10;
            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await lifecycle.background_worker();

            // Ensure the object is gone
            await verify_mulitparts_aborted(obj_id, bucket, key);
        });

        mocha.it('test cleanup abandoned multipart upload with prefix', async function() {
            const bucket = multipart_bucket;
            const prefix = 'test-lifecycle-multipart-with-prefix-';
            const parts_age = 3;
            const parts_count = 7;
            const part_size = 45;

            const putLifecycleParams = {
                Bucket: bucket,
                LifecycleConfiguration: {
                    Rules: [
                        {
                            AbortIncompleteMultipartUpload: {
                                // 10 less days have gone by since upload created
                                DaysAfterInitiation: parts_age + 10,
                            },
                            Filter: {
                                Prefix: prefix,
                            },
                            Status: 'Enabled',
                        }
                    ],
                },
            };

            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            const obj_id_1 = await create_mock_multipart_upload(prefix + "0", multipart_bucket, parts_age, part_size, parts_count);
            const obj_id_2 = await create_mock_multipart_upload(prefix + "1", multipart_bucket, parts_age, part_size, parts_count);
            await lifecycle.background_worker();

            // Ensure that there are still same number of parts
            const mp_list_1 = await rpc_client.object.list_multiparts({ obj_id: obj_id_1, bucket, key: prefix + "0" });
            const mp_list_2 = await rpc_client.object.list_multiparts({ obj_id: obj_id_2, bucket, key: prefix + "1" });
            assert.strictEqual(mp_list_1.multiparts.length, parts_count);
            assert.strictEqual(mp_list_2.multiparts.length, parts_count);

            // Change DaysAfterInitiation
            putLifecycleParams.LifecycleConfiguration.Rules[0].AbortIncompleteMultipartUpload.DaysAfterInitiation = parts_age - 10;
            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await lifecycle.background_worker();

            // Ensure the object is gone
            await verify_mulitparts_aborted(obj_id_1, bucket, prefix + "0");
            await verify_mulitparts_aborted(obj_id_2, bucket, prefix + "1");
        });

        async function verify_mulitparts_aborted(obj_id, bucket, key) {
            // @ts-ignore
            assert.rejects(() => rpc_client.object.list_multiparts({ obj_id, bucket, key }), err => err.rpc_code === 'NO_SUCH_UPLOAD');
        }

        async function create_mock_multipart_upload(key, bucket, age, part_size, num_parts) {
            const content_type = 'test/test';
            const size = num_parts * part_size;
            const data = generator.update(Buffer.alloc(size));
            const { obj_id } = await rpc_client.object.create_object_upload({ bucket, key, content_type });
            const mp_list_before = await rpc_client.object.list_multiparts({ obj_id, bucket, key });
            coretest.log('list_multiparts before', mp_list_before);
            assert.strictEqual(mp_list_before.multiparts.length, 0);
            const multiparts_ids = [];

            const get_part_slice = i => data.slice(i * part_size, (i + 1) * part_size);
            const upload_multipart = async (i, mp_data, split, finish) => {
                const resp = await object_io.upload_multipart({
                    client: rpc_client,
                    obj_id,
                    bucket,
                    key,
                    num: i + 1,
                    size: mp_data.length,
                    source_stream: readable_buffer(mp_data, split, finish),
                });
                console.log("upload_multipart", resp);
                multiparts_ids.push(new mongodb.ObjectId(resp.multipart_id));
            };
            // upload the real multiparts we want to complete with
            await Promise.all(_.times(num_parts,
                i => upload_multipart(i, get_part_slice(i))
            ));

            // go back in time
            const update = {
                // eslint-disable-next-line new-cap
                upload_started: new mongodb.ObjectId(moment().subtract(age, 'days').unix()),
            };

            console.log('create_mock_multipart_upload bucket', bucket, 'obj_id', obj_id, 'multiparts_ids', multiparts_ids);
            await MDStore.instance().update_object_by_id(obj_id, update);

            const mp_list_after = await rpc_client.object.list_multiparts({ obj_id, bucket, key });
            coretest.log('mp_list_after after', mp_list_after);
            assert.strictEqual(mp_list_after.multiparts.length, num_parts);

            return obj_id;
        }

        mocha.it('lifecyle - listMultiPart verify', async () => {
            await create_mock_multipart_upload('test-lifecycle-multipart', multipart_bucket, 3, 45, 7);
        });
    });

    mocha.describe('bucket-lifecycle-version', function() {
        // Not supported in other DBs
        if (config.DB_TYPE !== 'postgres') return;

        this.timeout(60000);
        const version_bucket = 'test-version-bucket';

        mocha.before(async function() {
            await rpc_client.bucket.create_bucket({ name: version_bucket });
            await rpc_client.bucket.update_bucket({
                name: version_bucket,
                versioning: 'ENABLED'
            });
        });

        mocha.after(async function() {
            await rpc_client.bucket.delete_bucket({ name: version_bucket }).catch(_.noop); // might fail, that's okay
        });

        mocha.it('basic test cleanup noncurrent versions', async function() {
            const bucket = version_bucket;
            const key = 'test-lifecycle-version-basic-0';
            const age = 30;
            const versions_count = 7;

            const putLifecycleParams = {
                Bucket: bucket,
                LifecycleConfiguration: {
                    Rules: [
                        {
                            NoncurrentVersionExpiration: {
                                NoncurrentDays: age + 10,
                            },
                            Filter: {
                                Prefix: ''
                            },
                            Status: 'Enabled',
                        }
                    ],
                },
            };

            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await create_mock_version(key, bucket, age, versions_count);
            await lifecycle.background_worker();

            // Ensure that there are still same number of parts
            let versions_list = await rpc_client.object.list_object_versions({ bucket, prefix: key });
            assert.strictEqual(versions_list.objects.length, versions_count);

            // Change NoncurrentDays
            putLifecycleParams.LifecycleConfiguration.Rules[0].NoncurrentVersionExpiration.NoncurrentDays = age - 10;
            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await lifecycle.background_worker();

            versions_list = await rpc_client.object.list_object_versions({ bucket, prefix: key });
            assert.strictEqual(versions_list.objects.length, 2);
        });

        mocha.it('basic test cleanup noncurrent versions with prefix', async function() {
            const bucket = version_bucket;
            const prefix = 'test-lifecycle-version-with-prefix-' + crypto.randomBytes(8).toString('hex') + "-";
            const age = 30;
            const versions_count = 7;

            const putLifecycleParams = {
                Bucket: bucket,
                LifecycleConfiguration: {
                    Rules: [
                        {
                            NoncurrentVersionExpiration: {
                                NoncurrentDays: age + 10,
                            },
                            Filter: {
                                Prefix: prefix,
                            },
                            Status: 'Enabled',
                        }
                    ],
                },
            };

            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await create_mock_version(prefix + "0", bucket, age, versions_count);
            await create_mock_version(prefix + "1", bucket, age, versions_count);
            await lifecycle.background_worker();

            // Ensure that there are still same number of parts
            let versions_list = await rpc_client.object.list_object_versions({ bucket, prefix });
            assert.strictEqual(versions_list.objects.length, versions_count * 2);

            // Change NoncurrentDays
            putLifecycleParams.LifecycleConfiguration.Rules[0].NoncurrentVersionExpiration.NoncurrentDays = age - 10;
            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await lifecycle.background_worker();

            versions_list = await rpc_client.object.list_object_versions({ bucket, prefix });
            assert.strictEqual(versions_list.objects.length, 2 * 2);
        });

        mocha.it('test cleanup noncurrent versions with newer noncurrent versions', async function() {
            const bucket = version_bucket;
            const key = 'test-lifecycle-version-newer-noncurrent-0';
            const age = 30;
            const versions_count = 7;

            const putLifecycleParams = {
                Bucket: bucket,
                LifecycleConfiguration: {
                    Rules: [
                        {
                            NoncurrentVersionExpiration: {
                                // Age exceeds but newernoncurrent versions doesn't
                                // so no expiration should happen
                                NoncurrentDays: age - 10,
                                NewerNoncurrentVersions: 10
                            },
                            Filter: {
                                Prefix: ''
                            },
                            Status: 'Enabled',
                        }
                    ],
                },
            };

            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await create_mock_version(key, bucket, age, versions_count);
            await lifecycle.background_worker();

            // Ensure that there are still same number of parts
            let versions_list = await rpc_client.object.list_object_versions({ bucket, prefix: key });
            assert.strictEqual(versions_list.objects.length, versions_count);

            // Change NewerNoncurrentVersions
            putLifecycleParams.LifecycleConfiguration.Rules[0].NoncurrentVersionExpiration.NewerNoncurrentVersions = 1;
            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await lifecycle.background_worker();

            versions_list = await rpc_client.object.list_object_versions({ bucket, prefix: key });
            assert.strictEqual(versions_list.objects.length, 2);
        });

        async function create_mock_version(version_key, bucket, age, version_count, expire_all = false) {
            const obj_upload_ids = [];
            for (let i = 0; i < version_count; ++i) {
                const content_type = 'application/octet_stream';
                const { obj_id } = await rpc_client.object.create_object_upload({ bucket, key: version_key, content_type });
                await rpc_client.object.complete_object_upload({ obj_id, bucket, key: version_key });

                // everything but last will be aged, 
                // For simple Expiration rule all version should be expired 
                if (expire_all || i < version_count - 1) {
                    obj_upload_ids.push(new mongodb.ObjectId(obj_id));
                }
            }
            // go back in time
            if (age > 0) {
                const update = {
                    create_time: moment().subtract(age, 'days').toDate(),
                };
                console.log('blow_version_objects: bucket', bucket, 'multiparts_ids', obj_upload_ids, " obj_upload_ids length: ", obj_upload_ids.length, "update :", update);
                const update_result = await MDStore.instance().update_objects_by_ids(obj_upload_ids, update);
                console.log('blow_version_objects: update_objects_by_ids', update_result);
            }
        }

        mocha.it('lifecyle - version object expired', async () => {
            const age = 30;
            const version_count = 10;
            const version_bucket_key = 'test-lifecycle-version1';
            await create_mock_version(version_bucket_key, version_bucket, age, version_count, true);
            const putLifecycleParams = commonTests.days_lifecycle_configuration(version_bucket, version_bucket_key);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await lifecycle.background_worker();
            // version_count count only, not deleted
            await verify_version_deleted(version_count + 1, version_bucket_key);
        });

        mocha.it('lifecyle - version object not expired', async () => {
            const age = 5;
            const version_count = 10;
            const version_bucket_key = 'test-lifecycle-version2';
            await create_mock_version(version_bucket_key, version_bucket, age, version_count, true);
            const putLifecycleParams = commonTests.days_lifecycle_configuration(version_bucket, version_bucket_key);
            await s3.putBucketLifecycleConfiguration(putLifecycleParams);
            await lifecycle.background_worker();
            // version_count count plus delete marker
            await verify_version_deleted(version_count, version_bucket_key);
        });

        async function verify_version_deleted(expected_length, key) {
            const obj_params = {
                bucket: version_bucket,
                prefix: key,
            };
            const list_obj = await rpc_client.object.list_object_versions(obj_params);
            console.log('list_objects_admin objects: ', util.inspect(list_obj.objects));
            const actual_length = list_obj.objects.length;
            assert.strictEqual(actual_length, expected_length, `listObjectResult actual ${actual_length} !== ${expected_length}`);
        }
    });

    function readable_buffer(data, split = 1, finish = 'end') {
        const max = Math.ceil(data.length / split);
        let pos = 0;
        return new stream.Readable({
            read() {
                if (pos < data.length) {
                    const len = Math.min(data.length - pos, max);
                    const buf = data.slice(pos, pos + len);
                    pos += len;
                    setImmediate(() => this.push(buf));
                } else if (finish === 'fail') {
                    this.emit('error', new Error('TEST_OBJECT_IO FAIL ON FINISH'));
                } else {
                    this.push(null);
                }
            }
        });
    }
});
