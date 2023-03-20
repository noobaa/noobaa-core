/* Copyright (C) 2020 NooBaa */
/*eslint max-lines-per-function: ["error", 900]*/
'use strict';


const mocha = require('mocha');
const util = require('util');
const crypto = require('crypto');
const assert = require('assert');
const fs_utils = require('../../util/fs_utils');
const nb_native = require('../../util/nb_native');
const NamespaceFS = require('../../sdk/namespace_fs');
const buffer_utils = require('../../util/buffer_utils');
const test_ns_list_objects = require('./test_ns_list_objects');
const _ = require('lodash');
const P = require('../../util/promise');
const s3_utils = require('../../endpoint/s3/s3_utils');
const config = require('../../../config');
const fs = require('fs');
const { AbortController } = require('node-abort-controller');
const coretest = require('./coretest');
const { rpc_client } = coretest;
const nsfs_versioning = require('./test_bucketspace_versioning.js');
const inspect = (x, max_arr = 5) => util.inspect(x, { colors: true, depth: null, maxArrayLength: max_arr });

// TODO: In order to verify validity add content_md5_mtime as well
const XATTR_MD5_KEY = 'content_md5';

const MAC_PLATFORM = 'darwin';

const DEFAULT_FS_CONFIG = {
    uid: process.getuid(),
    gid: process.getgid(),
    backend: '',
    warn_threshold_ms: 100,
};

function make_dummy_object_sdk() {
    return {
        requesting_account: {
            nsfs_account_config: {
                uid: process.getuid(),
                gid: process.getgid(),
            }
        },
        abort_controller: new AbortController(),
        throw_if_aborted() {
            if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
        }
    };
}

mocha.describe('namespace_fs', function() {

    const src_bkt = 'src';
    const upload_bkt = 'test_ns_uploads_object';
    const mpu_bkt = 'test_ns_multipart_upload';

    const src_key = 'test/unit_tests/test_namespace_fs.js';
    let tmp_fs_path = '/tmp/test_namespace_fs';
    if (process.platform === MAC_PLATFORM) {
        tmp_fs_path = '/private/' + tmp_fs_path;
    }
    const dummy_object_sdk = make_dummy_object_sdk();
    const ns_src_bucket_path = `./${src_bkt}`;
    const ns_tmp_bucket_path = `${tmp_fs_path}/${src_bkt}`;

    const ns_src = new NamespaceFS({ bucket_path: ns_src_bucket_path, bucket_id: '1', namespace_resource_id: undefined });
    const ns_tmp = new NamespaceFS({ bucket_path: ns_tmp_bucket_path, bucket_id: '2', namespace_resource_id: undefined });

    mocha.before(async () => {
        await P.all(_.map([src_bkt, upload_bkt, mpu_bkt], async buck =>
            fs_utils.create_fresh_path(`${tmp_fs_path}/${buck}`)));
    });
    mocha.after(async () => {
        await P.all(_.map([src_bkt, upload_bkt, mpu_bkt], async buck =>
            fs_utils.folder_delete(`${tmp_fs_path}/${buck}`)));
    });
    mocha.after(async () => fs_utils.folder_delete(tmp_fs_path));

    mocha.describe('list_objects', function() {

        mocha.it('list src dir with delimiter', async function() {
            const res = await ns_src.list_objects({
                bucket: src_bkt,
                delimiter: '/',
            }, dummy_object_sdk);
            console.log(inspect(res, res.length));
            assert_sorted_list(res);
        });

        mocha.it('list src dir without delimiter', async function() {
            const res = await ns_src.list_objects({
                bucket: src_bkt,
            }, dummy_object_sdk);
            console.log(inspect(res, res.length));
            assert.deepStrictEqual(res.common_prefixes, []);
            assert_sorted_list(res);
        });

        mocha.it('list_object_versions', async function() {
            const res = await ns_src.list_object_versions({
                bucket: src_bkt,
                delimiter: '/',
            }, dummy_object_sdk);
            console.log(inspect(res, res.length));
            assert_sorted_list(res);
        });

        // include all the generic list tests
        test_ns_list_objects(ns_tmp, dummy_object_sdk, 'test_ns_list_objects');

        function assert_sorted_list(res) {
            let prev_key = '';
            for (const { key } of res.objects) {
                if (res.next_marker) {
                    assert(key <= res.next_marker, 'bad next_marker at key ' + key);
                }
                assert(prev_key <= key, 'objects not sorted at key ' + key);
                prev_key = key;
            }
            prev_key = '';
            for (const key of res.common_prefixes) {
                if (res.next_marker) {
                    assert(key <= res.next_marker, 'next_marker at key ' + key);
                }
                assert(prev_key <= key, 'prefixes not sorted at key ' + key);
                prev_key = key;
            }
        }
    });

    mocha.it('read_object_md', async function() {
        const res = await ns_src.read_object_md({
            bucket: src_bkt,
            key: src_key,
        }, dummy_object_sdk);
        console.log(inspect(res));
    });

    mocha.it('read_object_md fails on directory head', async function() {
        try {
            await ns_src.read_object_md({
                bucket: src_bkt,
                key: src_key.substr(0, src_key.lastIndexOf('/')),
            }, dummy_object_sdk);
            throw new Error('Should have failed on head of directory');
        } catch (error) {
            assert.strict.equal(error.message, 'NoSuchKey');
            assert.strict.equal(error.code, 'ENOENT');
            assert.strict.equal(error.rpc_code, 'NO_SUCH_OBJECT');
        }
    });

    mocha.describe('read_object_stream', function() {

        mocha.it('read full', async function() {
            const out = buffer_utils.write_stream();
            await ns_src.read_object_stream({
                bucket: src_bkt,
                key: src_key,
            }, dummy_object_sdk, out);
            const res = out.join().toString();
            assert.strict.equal(res.slice(13, 28), '(C) 2020 NooBaa');
            assert.strict.equal(res.slice(34, 40), 'eslint');
        });

        mocha.it('read range', async function() {
            const out = buffer_utils.write_stream();
            await ns_src.read_object_stream({
                bucket: src_bkt,
                key: src_key,
                start: 13,
                end: 28,
            }, dummy_object_sdk, out);
            const res = out.join().toString();
            assert.strict.equal(res, '(C) 2020 NooBaa');
        });

        mocha.it('read range above size', async function() {
            const too_high = 1000000000;
            const out = buffer_utils.write_stream();
            await ns_src.read_object_stream({
                bucket: src_bkt,
                key: src_key,
                start: too_high,
                end: too_high + 10,
            }, dummy_object_sdk, out);
            const res = out.join().toString();
            assert.strict.equal(res, '');
        });
    });

    mocha.describe('upload_object', function() {

        const upload_key = 'upload_key_1';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;

        mocha.it('upload, read, delete of a small object', async function() {
            const data = crypto.randomBytes(100);
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                xattr,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            console.log('upload_object response', inspect(upload_res));
            if (config.NSFS_CALCULATE_MD5) xattr[XATTR_MD5_KEY] = upload_res.etag;

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: upload_key,
            }, dummy_object_sdk, read_res);
            console.log('read_object_stream response', inspect(read_res));
            const read_data = read_res.join();
            assert.strictEqual(Buffer.compare(read_data, data), 0);

            const md = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: upload_key,
            }, dummy_object_sdk);
            console.log('read_object_md response', inspect(md));
            assert.deepStrictEqual(xattr, md.xattr);

            const delete_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key,
            }, dummy_object_sdk);
            console.log('delete_object response', inspect(delete_res));
        });
    });

    mocha.describe('List-objects', function() {
        const nsr = 'noobaa-nsr';
        const bucket_name = 'noobaa-bucket';
        let tmp_fs_root = '/tmp/test_namespace_fs_list_objects';
        if (process.platform === MAC_PLATFORM) {
            tmp_fs_root = '/private/' + tmp_fs_root;
        }
        const bucket_path = '/bucket';
        const full_path = tmp_fs_root + bucket_path;
        const version_dir = '/.versions';
        const full_path_version_dir = full_path + `${version_dir}`;
        const dir1 = full_path + '/dir1';
        const dir1_version_dir = dir1 + `${version_dir}`;
        const dir2 = full_path + '/dir2';
        const dir2_version_dir = dir2 + `${version_dir}`;
        let s3_client;
        let s3_admin;
        let accounts = [];
        const key = 'key';
        const body = 'AAAA';
        const version_key = 'version_key';
        const version_body = 'A1A1A1A';

        mocha.before(async function() {
            if (process.getgid() !== 0 || process.getuid() !== 0) {
                console.log('No Root permissions found in env. Skipping test');
                this.skip(); // eslint-disable-line no-invalid-this
            }
            // create paths
            await fs_utils.create_fresh_path(tmp_fs_root, 0o777);
            await fs_utils.create_fresh_path(full_path, 0o770);
            await fs_utils.file_must_exist(full_path);
            await fs_utils.create_fresh_path(full_path_version_dir, 0o770);
            await fs_utils.file_must_exist(full_path_version_dir);
            await fs_utils.create_fresh_path(dir1, 0o770);
            await fs_utils.file_must_exist(dir1);
            await fs_utils.create_fresh_path(dir1_version_dir, 0o770);
            await fs_utils.file_must_exist(dir1_version_dir);
            await fs_utils.create_fresh_path(dir2, 0o770);
            await fs_utils.file_must_exist(dir2);
            await fs_utils.create_fresh_path(dir2_version_dir, 0o770);
            await fs_utils.file_must_exist(dir2_version_dir);
            // export dir as a bucket
            await rpc_client.pool.create_namespace_resource({
                name: nsr,
                nsfs_config: {
                    fs_root_path: tmp_fs_root,
                }
            });
            const obj_nsr = { resource: nsr, path: bucket_path };
            await rpc_client.bucket.create_bucket({
                name: bucket_name,
                namespace: {
                    read_resources: [obj_nsr],
                    write_resource: obj_nsr
                }
            });
            const policy = {
                Version: '2012-10-17',
                Statement: [{
                    Sid: 'id-1',
                    Effect: 'Allow',
                    Principal: { AWS: "*" },
                    Action: ['s3:*'],
                    Resource: [`arn:aws:s3:::*`]
                },
            ]
            };
            // create accounts
            let res = await nsfs_versioning.generate_nsfs_account({ admin: true });
            s3_admin = nsfs_versioning.generate_s3_client(res.access_key, res.secret_key);
            await s3_admin.putBucketPolicy({
                Bucket: bucket_name,
                Policy: JSON.stringify(policy)
            }).promise();
            // create nsfs account
            res = await nsfs_versioning.generate_nsfs_account();
            s3_client = nsfs_versioning.generate_s3_client(res.access_key, res.secret_key);
            accounts.push(res.email);
            await s3_client.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } }).promise();
            const bucket_ver = await s3_client.getBucketVersioning({ Bucket: bucket_name }).promise();
            assert.equal(bucket_ver.Status, 'Enabled');
            await create_object(`${full_path}/${key}`, body, 'null');
            await create_object(`${full_path_version_dir}/${version_key}`, version_body, 'null');
            await create_object(`${dir1}/${key}`, body, 'null');
            await create_object(`${dir1_version_dir}/${version_key}`, version_body, 'null');
            await create_object(`${dir2}/${key}`, body, 'null');
            await create_object(`${dir1_version_dir}/${version_key}`, version_body, 'null');
        });

        mocha.after(async () => {
            fs_utils.folder_delete(tmp_fs_root);
            for (let email of accounts) {
                await rpc_client.account.delete_account({ email });
            }
        });

        mocha.it('list objects - should return only latest object', async function() {
            const res = await s3_client.listObjects({Bucket: bucket_name}).promise();
            res.Contents.forEach(val => {
                if (val.Key.includes('version') === true) {
                    assert.fail('Not Expected: list objects returned contents fo .version dir');
                }
            });
        });
    });

    mocha.describe('Get/Head object', function() {
        const nsr = 'get-head-versioned-nsr';
        const bucket_name = 'get-head-versioned-bucket';
        const disabled_bucket_name = 'get-head-disabled-bucket';
        let tmp_fs_root = '/tmp/test_namespace_fs_get_objects';
        if (process.platform === MAC_PLATFORM) {
            tmp_fs_root = '/private/' + tmp_fs_root;
        }

        const bucket_path = '/get-head-bucket';
        const vesion_dir = '/.versions';
        const full_path = tmp_fs_root + bucket_path;
        const disabled_bucket_path = '/get-head-disabled_bucket';
        const disabled_full_path = tmp_fs_root + disabled_bucket_path;
        const version_dir_path = full_path + vesion_dir;
        let file_pointer;
        const versionID_1 = 'mtime-12a345b-ino-c123d45';
        const versionID_2 = 'mtime-e56789f-ino-h56g789';
        const versionID_3 = 'mtime-1i357k9-ino-13l57j9';
        let s3_client;
        let s3_admin;
        let accounts = [];
        const dis_version_key = 'dis_version';
        const dis_version_body = 'AAAAA';
        const en_version_key = 'en_version';
        const en_version_body = 'BBBBB';
        const en_version_key_v1 = versionID_2;
        const en_version_body_v1 = 'CCCCC';
        const key_version = en_version_key + '_' + en_version_key_v1;
        const get_obj_path = `${full_path}/${en_version_key}`;
        mocha.before(async function() {
            const self = this; // eslint-disable-line no-invalid-this
            self.timeout(300000);
            if (process.getgid() !== 0 || process.getuid() !== 0) {
                console.log('No Root permissions found in env. Skipping test');
                this.skip(); // eslint-disable-line no-invalid-this
            }
            // create paths
            await fs_utils.create_fresh_path(tmp_fs_root, 0o777);
            await fs_utils.create_fresh_path(full_path, 0o770);
            await fs_utils.file_must_exist(full_path);
            await fs_utils.create_fresh_path(version_dir_path, 0o770);
            await fs_utils.file_must_exist(version_dir_path);
            await fs_utils.create_fresh_path(disabled_full_path, 0o770);
            await fs_utils.file_must_exist(disabled_full_path);
            // export dir as a bucket
            await rpc_client.pool.create_namespace_resource({
                name: nsr,
                nsfs_config: {
                    fs_root_path: tmp_fs_root,
                }
            });
            const obj_nsr = { resource: nsr, path: bucket_path };
            await rpc_client.bucket.create_bucket({
                name: bucket_name,
                namespace: {
                    read_resources: [obj_nsr],
                    write_resource: obj_nsr
                }
            });

            const disabled_nsr = { resource: nsr, path: disabled_bucket_path };
            await rpc_client.bucket.create_bucket({
                name: disabled_bucket_name,
                namespace: {
                    read_resources: [disabled_nsr],
                    write_resource: disabled_nsr
                }
            });

            const policy = {
                Version: '2012-10-17',
                Statement: [{
                    Sid: 'id-1',
                    Effect: 'Allow',
                    Principal: { AWS: "*" },
                    Action: ['s3:*'],
                    Resource: [`arn:aws:s3:::*`]
                },
            ]
            };
            // create accounts
            let res = await nsfs_versioning.generate_nsfs_account({ admin: true });
            s3_admin = nsfs_versioning.generate_s3_client(res.access_key, res.secret_key);
            await s3_admin.putBucketPolicy({
                Bucket: bucket_name,
                Policy: JSON.stringify(policy)
            }).promise();
            await s3_admin.putBucketPolicy({
                Bucket: disabled_bucket_name,
                Policy: JSON.stringify(policy)
            }).promise();
            // create nsfs account
            res = await nsfs_versioning.generate_nsfs_account();
            s3_client = nsfs_versioning.generate_s3_client(res.access_key, res.secret_key);
            accounts.push(res.email);
            // create a file in version disabled bucket
            await create_object(`${disabled_full_path}/${dis_version_key}`, dis_version_body, 'null');
            // create a file after when versioning not enabled
            await create_object(`${full_path}/${dis_version_key}`, dis_version_body, 'null');
            await s3_client.putBucketVersioning({ Bucket: bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } }).promise();
            const bucket_ver = await s3_client.getBucketVersioning({ Bucket: bucket_name }).promise();
            assert.equal(bucket_ver.Status, 'Enabled');
            // create base file after versioning enabled
            file_pointer = await create_object(get_obj_path, en_version_body, versionID_1);
        });

        mocha.after(async () => {
            if (file_pointer) await file_pointer.close(DEFAULT_FS_CONFIG, get_obj_path);
            fs_utils.folder_delete(tmp_fs_root);
            for (let email of accounts) {
                await rpc_client.account.delete_account({ email });
            }
        });

        mocha.it('get object, versioning not enabled - should return latest object', async function() {
            const res = await s3_client.getObject({Bucket: disabled_bucket_name, Key: dis_version_key}).promise();
            assert.equal(res.Body, dis_version_body);
        });

        mocha.it('get object, versioning not enabled, version id specified - should return NoSuchKey', async function() {
            try {
                await s3_client.getObject({Bucket: disabled_bucket_name, Key: dis_version_key, VersionId: versionID_1}).promise();
                assert.fail('Should fail');
            } catch (err) {
                    assert.equal(err.code, 'NoSuchKey');
            }
        });

        mocha.it('get object, file created before the version is enabled - should return latest object', async function() {
            const res = await s3_client.getObject({Bucket: bucket_name, Key: dis_version_key}).promise();
            assert.equal(res.Body, dis_version_body);
        });

        mocha.it('get object, file created before the version is enabled, version id specified - should return ENOENT', async function() {
            try {
                    await s3_client.getObject({Bucket: bucket_name, Key: dis_version_key, VersionId: versionID_1}).promise();
                    assert.fail('Should fail');
            } catch (err) {
                    assert.equal(err.code, 'NoSuchKey');
            }
        });

        mocha.it('get object, with version enabled, no version id specified - should return latest object', async function() {
            const res = await s3_client.getObject({Bucket: bucket_name, Key: en_version_key}).promise();
            assert.equal(res.Body, en_version_body);
        });

        mocha.it('get object, with version enabled, with version id specified and matching with main file - should return latest object', async function() {
            const res = await s3_client.getObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_1}).promise();
            assert.equal(res.Body, en_version_body);
        });

        mocha.it('get object, with version enabled, with version id specified and not matching with main file - should return $VersionId object', async function() {
            create_object(`${version_dir_path}/${key_version}`, en_version_body_v1, versionID_2);
            const res = await s3_client.getObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_2}).promise();
            assert.equal(res.Body, en_version_body_v1);
        });

        mocha.it('get object, with version enabled, with version id specified and versioned object not present - should return NoSuchKey', async function() {
            try {
                await s3_client.getObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_3}).promise();
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.code, 'NoSuchKey');
            }
        });

        mocha.it('get object, with version enabled, with wrong version id specified - should return Bad Request', async function() {
            try {
                await s3_client.getObject({Bucket: bucket_name, Key: en_version_key, VersionId: 'ctime-12-ino-12a'}).promise();
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.code, 'BadRequest');
            }
        });

        mocha.it('head object, version not enabled - should return latest object md', async function() {
            try {
                await s3_client.headObject({Bucket: disabled_bucket_name, Key: dis_version_key}).promise();
                assert.ok('Expected latest head object returned');
            } catch (err) {
                assert.fail('Latest head object not found');
            }
        });

        mocha.it('head object, version not enabled, version specified - should return object NotFound', async function() {
            try {
                await s3_client.headObject({Bucket: disabled_bucket_name, Key: dis_version_key, VersionId: versionID_1}).promise();
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.code, 'NotFound');
            }
        });

        mocha.it('head object, file created before the version is enabled - should return latest object md', async function() {
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: dis_version_key}).promise();
                assert.ok('Expected latest head object returned');
            } catch (err) {
                assert.fail('Latest head object not found');
            }
        });

        mocha.it('head object, file created before the version is enabled, version specified - should return NotFound', async function() {
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: dis_version_key, VersionId: versionID_1}).promise();
                assert.ok('Expected latest head object returned');
            } catch (err) {
                assert.equal(err.code, 'NotFound');
            }
        });

        mocha.it('head object, with version enabled, no version id specified - should return latest object md', async function() {
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key}).promise();
                assert.ok('Expected latest head object returned');
            } catch (err) {
                assert.fail(`Failed with an error: ${err.code}`);
            }
        });

        mocha.it('head object, with version enabled, with version id specified and matching with main file - should return latest object md', async function() {
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_1}).promise();
                assert.ok('Expected latest head object returned');
            } catch (err) {
                assert.fail(`Failed with an error: ${err.code}`);
            }
        });

        mocha.it('head object, with version enabled, with version id specified and not matching with main file - should return $VersionId object md', async function() {
            create_object(`${version_dir_path}/${key_version}`, en_version_body_v1, versionID_2);
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_2}).promise();
                assert.ok('Expected versioned object returned');
            } catch (err) {
                assert.fail(`Failed with an error: ${err.code}`);
            }
        });

        mocha.it('head object, with version enabled, versioned object not created - should return NotFound', async function() {
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_3}).promise();
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.code, 'NotFound');
            }
        });

        mocha.it('head object, with version enabled, wrong version id specified - should return NotFound', async function() {
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_3}).promise();
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.code, 'NotFound');
            }
        });
        mocha.it('Put object when version disbled and do put on the same object when version enabled - get object should return versioned object', async function() {
            let res = await s3_client.getObject({Bucket: disabled_bucket_name, Key: dis_version_key}).promise();
            assert.equal(res.Body, dis_version_body);
            const version_obj_path = disabled_full_path + '/.versions';
            const version_key = dis_version_key + '_null';
            const version_body = 'DDDDD';
            await s3_client.putBucketVersioning({ Bucket: disabled_bucket_name, VersioningConfiguration: { MFADelete: 'Disabled', Status: 'Enabled' } }).promise();
            const bucket_ver = await s3_client.getBucketVersioning({ Bucket: disabled_bucket_name }).promise();
            assert.equal(bucket_ver.Status, 'Enabled');
            // May be below 3 steps can be replaced with put_object() to create versioned object
            await fs_utils.create_fresh_path(version_obj_path, 0o770);
            await fs_utils.file_must_exist(version_obj_path);
            await create_object(`${version_obj_path}/${version_key}`, version_body, 'null');
            res = await s3_client.getObject({Bucket: disabled_bucket_name, Key: dis_version_key, VersionId: 'null'}).promise();
            assert.equal(res.Body, version_body);
        });

        mocha.it('get object, with version enabled, delete marker placed on latest object - should return NoSuchKey', async function() {
            const xattr_delete_marker = { 'user.delete_marker': 'true' };
            await file_pointer.replacexattr(DEFAULT_FS_CONFIG, xattr_delete_marker);
            try {
                await s3_client.getObject({Bucket: bucket_name, Key: en_version_key}).promise();
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.code, 'NoSuchKey');
            }
        });

        mocha.it('get object, with version enabled, delete marker placed on latest object, version id specified - should return the version object', async function() {
            const xattr_delete_marker = { 'user.delete_marker': 'true' };
            await file_pointer.replacexattr(DEFAULT_FS_CONFIG, xattr_delete_marker);
            const res = await s3_client.getObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_2}).promise();
            assert.equal(res.Body, en_version_body_v1);
        });

        mocha.it('head object, with version enabled, delete marked xattr placed on latest object - should return ENOENT', async function() {
            const xattr_delete_marker = { 'user.delete_marker': 'true' };
            await file_pointer.replacexattr(DEFAULT_FS_CONFIG, xattr_delete_marker);
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key}).promise();
                assert.fail('Should fail');
            } catch (err) {
                assert.equal(err.code, 'NotFound');
            }
        });

        mocha.it('head object, with version enabled, delete marked xattr placed on latest object, version id specified - should return the version object', async function() {
            const xattr_delete_marker = { 'user.delete_marker': 'true' };
            await file_pointer.replacexattr(DEFAULT_FS_CONFIG, xattr_delete_marker);
            try {
                await s3_client.headObject({Bucket: bucket_name, Key: en_version_key, VersionId: versionID_2}).promise();
                assert.ok('Expected versioned object returned');
            } catch (err) {
                assert.fail(`Failed with an error: ${err.code}`);
            }
        });
    });

    mocha.describe('multipart upload', function() {

        const mpu_key = 'mpu_upload';
        const xattr = { key: 'value', key2: 'value2' };
        xattr[s3_utils.XATTR_SORT_SYMBOL] = true;

        mocha.it('upload, read, delete a small multipart object', async function() {
            this.timeout(20000); // eslint-disable-line no-invalid-this

            const create_res = await ns_tmp.create_object_upload({
                bucket: mpu_bkt,
                key: mpu_key,
                xattr,
            }, dummy_object_sdk);
            console.log('create_object_upload response', inspect(create_res));

            const obj_id = create_res.obj_id;
            const num_parts = 10;
            const part_size = 1024 * 1024;
            const data = crypto.randomBytes(num_parts * part_size);
            const multiparts = [];
            for (let i = 0; i < num_parts; ++i) {
                const data_part = data.slice(i * part_size, (i + 1) * part_size);
                const part_res = await ns_tmp.upload_multipart({
                    obj_id,
                    bucket: mpu_bkt,
                    key: mpu_key,
                    num: i + 1,
                    source_stream: buffer_utils.buffer_to_read_stream(data_part),
                }, dummy_object_sdk);
                console.log('upload_multipart response', inspect(part_res));
                multiparts.push({ num: i + 1, etag: part_res.etag });

                const list_parts_res = await ns_tmp.list_multiparts({
                    obj_id,
                    bucket: mpu_bkt,
                    key: mpu_key,
                }, dummy_object_sdk);
                console.log('list_multiparts response', inspect(list_parts_res));
            }

            const list1_res = await ns_src.list_uploads({
                bucket: mpu_bkt,
            }, dummy_object_sdk);
            console.log('list_uploads response', inspect(list1_res));
            // TODO list_uploads is not implemented
            assert.deepStrictEqual(list1_res.objects, []);

            const complete_res = await ns_tmp.complete_object_upload({
                obj_id,
                bucket: mpu_bkt,
                key: mpu_key,
                multiparts,
            }, dummy_object_sdk);
            console.log('complete_object_upload response', inspect(complete_res));
            if (config.NSFS_CALCULATE_MD5) xattr[XATTR_MD5_KEY] = complete_res.etag;

            const list2_res = await ns_src.list_uploads({
                bucket: mpu_bkt,
            }, dummy_object_sdk);
            console.log('list_uploads response', inspect(list2_res));
            assert.deepStrictEqual(list2_res.objects, []);

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: mpu_bkt,
                key: mpu_key,
            }, dummy_object_sdk, read_res);
            console.log('read_object_stream response', inspect(read_res));
            const read_data = read_res.join();
            assert.strictEqual(Buffer.compare(read_data, data), 0);

            const md = await ns_tmp.read_object_md({
                bucket: upload_bkt,
                key: mpu_key,
            }, dummy_object_sdk);
            console.log('read_object_md response', inspect(md));
            assert.deepStrictEqual(xattr, md.xattr);

            const delete_res = await ns_tmp.delete_object({
                bucket: mpu_bkt,
                key: mpu_key,
            }, dummy_object_sdk);
            console.log('delete_object response', inspect(delete_res));
        });
    });

    mocha.describe('delete_object', function() {

        const dir_1 = '/a/b/c/';
        const dir_2 = '/a/b/';
        const upload_key_1 = dir_1 + 'upload_key_1';
        const upload_key_2 = dir_1 + 'upload_key_2';
        const upload_key_3 = dir_2 + 'upload_key_3';
        const data = crypto.randomBytes(100);

        mocha.before(async function() {
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_1,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            console.log('upload_object with path (before) response', inspect(upload_res));
        });

        mocha.it('do not delete the path', async function() {
            const source = buffer_utils.buffer_to_read_stream(data);
            await upload_object(ns_tmp, upload_bkt, upload_key_2, dummy_object_sdk, source);
            await delete_object(ns_tmp, upload_bkt, upload_key_2, dummy_object_sdk);

            let entries;
            try {
                entries = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, ns_tmp_bucket_path + dir_1);
            } catch (e) {
                assert.ifError(e);
            }
            console.log('do not delete the path - entries', entries);
            assert.strictEqual(entries.length, 1);
        });


        mocha.it('delete the path - stop when not empty', async function() {
            const source = buffer_utils.buffer_to_read_stream(data);
            await upload_object(ns_tmp, upload_bkt, upload_key_3, dummy_object_sdk, source);
            await delete_object(ns_tmp, upload_bkt, upload_key_1, dummy_object_sdk);

            let entries;
            try {
                entries = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, ns_tmp_bucket_path + dir_2);
            } catch (e) {
                assert.ifError(e);
            }
            console.log('stop when not empty - entries', entries);
            assert.strictEqual(entries.length, 1);

        });

        mocha.after(async function() {
            let entries_before;
            let entries_after;
            try {
                entries_before = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, ns_tmp_bucket_path);

                const delete_res = await ns_tmp.delete_object({
                    bucket: upload_bkt,
                    key: upload_key_3,
                }, dummy_object_sdk);
                console.log('delete_object response', inspect(delete_res));

                entries_after = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, ns_tmp_bucket_path);
            } catch (e) {
                assert.ifError(e);
            }
            assert.strictEqual(entries_after.length, entries_before.length - 1);
        });
    });

    mocha.describe('key with trailing /', function() {

        const dir_1 = '/a/b/c/';
        const dir_2 = '/a/b/';
        const upload_key_1 = dir_1 + 'upload_key_1/';
        const upload_key_2 = dir_2 + 'upload_key_2/';
        const data = crypto.randomBytes(100);

        mocha.before(async function() {
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_1,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            console.log('upload_object with trailing / response', inspect(upload_res));
        });

        mocha.it(`delete the path - stop when not empty and key with trailing /`, async function() {
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key_2,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            console.log('upload_object with trailing / (key 2) response', inspect(upload_res));

            const delete_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key_1,
            }, dummy_object_sdk);
            console.log('delete_object with trailing / response', inspect(delete_res));
        });

        mocha.after(async function() {
            const delete_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key_2,
            }, dummy_object_sdk);
            console.log('delete_object with trailing / (key 2) response', inspect(delete_res));
        });
    });

});

mocha.describe('nsfs_symlinks_validations', function() {

    let tmp_fs_path = '/tmp/test_nsfs_symboliclinks';
    if (process.platform === MAC_PLATFORM) {
        tmp_fs_path = '/private/' + tmp_fs_path;
    }
    const bucket = 'bucket1';
    const bucket_full_path = tmp_fs_path + '/' + bucket;
    const expected_dirs = ['d1', 'd2', 'd3/d3d1'];
    const expected_files = ['f1', 'f2', 'f3', 'd2/f4', 'd2/f5', 'd3/d3d1/f6'];
    const expected_links = [{ t: 'f1', n: 'lf1' }, { t: '/etc', n: 'ld2' }];
    const dummy_object_sdk = make_dummy_object_sdk();

    const ns = new NamespaceFS({ bucket_path: bucket_full_path, bucket_id: '1', namespace_resource_id: undefined });

    mocha.before(async () => {
        await fs_utils.create_fresh_path(`${bucket_full_path}`);
        await P.all(_.map(expected_dirs, async dir =>
            fs_utils.create_fresh_path(`${bucket_full_path}/${dir}`)));
        await P.all(_.map(expected_files, async file =>
            create_file(`${bucket_full_path}/${file}`)));
        await P.all(_.map(expected_links, async link =>
            fs.promises.symlink(link.t, `${bucket_full_path}/${link.n}`)));

    });

    mocha.after(async () => {
        await P.all(_.map(expected_files, async file =>
            fs_utils.folder_delete(`${bucket_full_path}/${file}`)));
    });
     mocha.after(async () => fs_utils.folder_delete(tmp_fs_path));

    mocha.describe('without_symlinks', function() {
                mocha.it('without_symlinks:list iner dir', async function() {
            const res = await list_objects(ns, bucket, '/', 'd2/', dummy_object_sdk);
            assert.strictEqual(res.objects.length, 2, 'amount of files is not as expected');
        });

        mocha.it('without_symlinks:list iner dir without delimiter', async function() {
            const res = await list_objects(ns, bucket, undefined, 'd2/', dummy_object_sdk);
            assert.strictEqual(res.objects.length, 2, 'amount of files is not as expected');
        });

        mocha.it('without_symlinks:read_object_md', async function() {
            try {
                await read_object_md(ns, bucket, 'd2/f4', dummy_object_sdk);
            } catch (err) {
                assert(err, 'read_object_md failed with err');
            }
        });

        mocha.it('without_symlinks:read_object_stream', async function() {
            try {
                await read_object_stream(ns, bucket, 'd2/f4', dummy_object_sdk);
            } catch (err) {
                assert(err, 'read_object_stream failed with err');
            }
        });

        mocha.it('without_symlinks:upload_object', async function() {
            const data = crypto.randomBytes(100);
            const source = buffer_utils.buffer_to_read_stream(data);
            try {
                await upload_object(ns, bucket, 'd2/uploaded-file1', dummy_object_sdk, source);
            } catch (err) {
                assert(err, 'upload_object failed with err');
            }
        });

        mocha.it('without_symlinks:delete_object', async function() {
            try {
                await delete_object(ns, bucket, 'd2/uploaded-file1', dummy_object_sdk);
            } catch (err) {
                assert(err, 'delete_object failed with err');
            }
        });
    });

    mocha.describe('by_symlinks', function() {
                mocha.it('by_symlinks:list root dir', async function() {
            const res = await list_objects(ns, bucket, '/', undefined, dummy_object_sdk);
            assert.strictEqual(res.objects.length, 4, 'amount of files is not as expected');
        });

        mocha.it('by_symlinks:list src dir without delimiter', async function() {
            const res = await list_objects(ns, bucket, undefined, undefined, dummy_object_sdk);
            console.log("IGOR", res.objects);
            assert.strictEqual(res.objects.length, 7, 'amount of files is not as expected');
        });

        mocha.it('by_symlinks:list iner dir', async function() {
            const res = await list_objects(ns, bucket, '/', 'ld2/', dummy_object_sdk);
            assert.strictEqual(res.objects.length, 0, 'amount of files is not as expected');
        });

        mocha.it('by_symlinks:list iner dir without delimiter', async function() {
            const res = await list_objects(ns, bucket, undefined, 'ld2/', dummy_object_sdk);
            assert.strictEqual(res.objects.length, 0, 'amount of files is not as expected');
        });

        mocha.it('by_symlinks:read_object_md', async function() {
            try {
                await read_object_md(ns, bucket, 'd2/f4', dummy_object_sdk);
            } catch (err) {
                assert.strictEqual(err.code, 'EACCES', 'read_object_md should return access denied');
            }
        });

        mocha.it('by_symlinks:read_object_stream', async function() {
            try {
                await read_object_stream(ns, bucket, 'ld2/f4', dummy_object_sdk);
            } catch (err) {
                assert.strictEqual(err.code, 'EACCES', 'read_object_stream should return access denied');
            }
        });

        mocha.it('by_symlinks:upload_object', async function() {
            const data = crypto.randomBytes(100);
            const source = buffer_utils.buffer_to_read_stream(data);
            try {
                await upload_object(ns, bucket, 'ld2/uploaded-file1', dummy_object_sdk, source);
            } catch (err) {
                assert.strictEqual(err.code, 'EACCES', 'upload_object should return access denied');
            }
        });

        mocha.it('by_symlinks:delete_object', async function() {
            try {
                await delete_object(ns, bucket, 'ld2/f5', dummy_object_sdk);
            } catch (err) {
                assert.strictEqual(err.code, 'EACCES', 'delete_object should return access denied');
            }
        });
    });


});

mocha.describe('namespace_fs copy object', function() {

    const src_bkt = 'src';
    const upload_bkt = 'test_ns_uploads_object';
    let tmp_fs_path = '/tmp/test_namespace_fs';
    if (process.platform === MAC_PLATFORM) {
        tmp_fs_path = '/private/' + tmp_fs_path;
    }
    const dummy_object_sdk = make_dummy_object_sdk();

    const ns_tmp_bucket_path = `${tmp_fs_path}/${src_bkt}`;

    const ns_tmp = new NamespaceFS({ bucket_path: ns_tmp_bucket_path, bucket_id: '3', namespace_resource_id: undefined });

    mocha.before(async () => {
        await P.all(_.map([src_bkt, upload_bkt], async buck =>
            fs_utils.create_fresh_path(`${tmp_fs_path}/${buck}`)));
    });
    mocha.after(async () => {
        await P.all(_.map([src_bkt, upload_bkt], async buck =>
            fs_utils.folder_delete(`${tmp_fs_path}/${buck}`)));
    });
    mocha.after(async () => fs_utils.folder_delete(tmp_fs_path));

    mocha.describe('upload_object (copy)', function() {
        const upload_key = 'upload_key_1';
        let copy_xattr = {};
        const copy_key_1 = 'copy_key_1';
        const data = crypto.randomBytes(100);

        mocha.before(async function() {
            const upload_res = await ns_tmp.upload_object({
                bucket: upload_bkt,
                key: upload_key,
                source_stream: buffer_utils.buffer_to_read_stream(data)
            }, dummy_object_sdk);
            // This is needed for the copy to work because we have a dummy_object_sdk that does not populate
            copy_xattr[XATTR_MD5_KEY] = upload_res.etag;
            console.log('upload_object response', inspect(upload_res));
        });

        mocha.it('copy, read of a small object copy - link flow', async function() {
            const params = {
                bucket: upload_bkt,
                key: copy_key_1,
                xattr: copy_xattr,
                copy_source: { key: upload_key }
            };
            const copy_res = await ns_tmp.upload_object(params, dummy_object_sdk);
            console.log('upload_object (copy) response', inspect(copy_res));

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: copy_key_1,
            }, dummy_object_sdk, read_res);
            console.log('read_object_stream (copy) response', inspect(read_res));
            const read_data = read_res.join();
            assert.strictEqual(Buffer.compare(read_data, data), 0);

            const delete_copy_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: copy_key_1,
            }, dummy_object_sdk);
            console.log('delete_object (copy) response', inspect(delete_copy_res));
        });

        mocha.it('copy, read of the small object twice to the same file name', async function() {
            const params = {
                bucket: upload_bkt,
                key: copy_key_1,
                xattr: copy_xattr,
                copy_source: {
                    key: upload_key,
                }
            };
            let copy_res = await ns_tmp.upload_object(params, dummy_object_sdk);
            console.log('upload_object: copy twice (1) to the same file name response', inspect(copy_res));

            copy_res = await ns_tmp.upload_object(params, dummy_object_sdk);
            console.log('upload_object: copy twice (2) to the same file name response', inspect(copy_res));

            const read_res = buffer_utils.write_stream();
            await ns_tmp.read_object_stream({
                bucket: upload_bkt,
                key: copy_key_1,
            }, dummy_object_sdk, read_res);
            console.log('read_object_stream: copy twice to the same file name response', inspect(read_res));
            const read_data = read_res.join();
            assert.strictEqual(Buffer.compare(read_data, data), 0);

            const delete_copy_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: copy_key_1,
            }, dummy_object_sdk);
            console.log('delete_object: copy twice to the same file name response', inspect(delete_copy_res));
        });

        mocha.after(async function() {
            const delete_res = await ns_tmp.delete_object({
                bucket: upload_bkt,
                key: upload_key,
            }, dummy_object_sdk);
            console.log('delete_object response', inspect(delete_res));
        });
    });

});

async function list_objects(ns, bucket, delimiter, prefix, dummy_object_sdk) {
    const res = await ns.list_objects({
        bucket: bucket,
        delimiter: delimiter,
        prefix: prefix,
    }, dummy_object_sdk);
    console.log(JSON.stringify(res));
    return res;
}

async function upload_object(ns, bucket, file_key, dummy_object_sdk, source) {
    const xattr = { key: 'value', key2: 'value2' };
    xattr[s3_utils.XATTR_SORT_SYMBOL] = true;
    const upload_res = await ns.upload_object({
        bucket: bucket,
        key: file_key,
        xattr,
        source_stream: source
    }, dummy_object_sdk);
    console.log('upload_object response', inspect(upload_res));
    return upload_object;
}

async function delete_object(ns, bucket, file_key, dummy_object_sdk) {
    const delete_copy_res = await ns.delete_object({
        bucket: bucket,
        key: file_key,
    }, dummy_object_sdk);
    console.log('delete_object do not delete the path response', inspect(delete_copy_res));
    return delete_copy_res;
}

async function read_object_md(ns, bucket, file_key, dummy_object_sdk) {
    const res = await ns.read_object_md({
        bucket: bucket,
        key: file_key,
    }, dummy_object_sdk);
    console.log(inspect(res));
    return res;
}

async function read_object_stream(ns, bucket, file_key, dummy_object_sdk) {
    const out = buffer_utils.write_stream();
    await ns.read_object_stream({
        bucket: bucket,
        key: file_key,
    }, dummy_object_sdk, out);
    console.log(inspect(out));
    return out;
}

function create_file(file_path) {
    return fs.promises.appendFile(file_path, file_path + '\n');
}

async function create_object(object_path, data, version_id) {
    const target_file = await nb_native().fs.open(DEFAULT_FS_CONFIG, object_path, 'w+');
    await fs.promises.writeFile(object_path, data);
    if (version_id !== 'null') {
        const xattr_version_id = { 'user.version_id': `${version_id}` };
        await target_file.replacexattr(DEFAULT_FS_CONFIG, xattr_version_id);
    }
    return target_file;
}
