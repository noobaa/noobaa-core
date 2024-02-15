/* Copyright (C) 2020 NooBaa */
/*eslint max-lines-per-function: ["error", 800]*/
/*eslint max-statements: ["error", 80, { "ignoreTopLevelFunctions": true }]*/
'use strict';


const mocha = require('mocha');
const util = require('util');
const AWS = require('aws-sdk'); // GAP upload is still using AWS SDK V2
const { S3 } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require("@smithy/node-http-handler");
// const { Upload } = require('@aws-sdk/lib-storage'); // GAP upload is still using AWS SDK V2
const http = require('http');
const assert = require('assert');
const os = require('os');
const test_utils = require('../system_tests/test_utils');
const coretest = require(test_utils.get_coretest_path());
const { rpc_client, EMAIL, PASSWORD, SYSTEM } = coretest;
const ManageCLIError = require('../../manage_nsfs/manage_nsfs_cli_errors').ManageCLIError;

const fs_utils = require('../../util/fs_utils');
coretest.setup({});
const { stat } = require('../../util/nb_native')().fs;
const path = require('path');
const _ = require('lodash');
const fs = require('fs');
const config = require('../../../config');
const MAC_PLATFORM = 'darwin';

const inspect = (x, max_arr = 5) => util.inspect(x, { colors: true, depth: null, maxArrayLength: max_arr });

const new_account_params = {
    has_login: false,
    s3_access: true,
};

const DEFAULT_FS_CONFIG = {
    uid: process.getuid(),
    gid: process.getgid(),
    backend: '',
    warn_threshold_ms: 100,
};

// currently will pass only when running locally
mocha.describe('bucket operations - namespace_fs', function() {
    const nsr = 'nsr';
    const bucket_name = 'src-bucket';
    const tmp_fs_root = get_tmp_path_by_os('/tmp/test_bucket_namespace_fs');
    const bucket_path = '/src';
    const other_bucket_path = '/src1';
    let account_wrong_uid;
    let account_correct_uid;
    let s3_owner;
    let s3_wrong_uid;
    let s3_wrong_uid_aws_sdk_v2_temp; // GAP upload is still using AWS SDK V2
    let s3_wrong_id_endpoint_address; // GAP upload is still using AWS SDK V2
    let s3_correct_uid;
    let s3_correct_uid_default_nsr;
    let account_wrong_dn;
    let s3_correct_dn_default_nsr;

    const s3_creds = {
        forcePathStyle: true,
        region: config.DEFAULT_REGION,
        requestHandler: new NodeHttpHandler({
            httpAgent: new http.Agent({ keepAlive: false })
        }),
    };

    mocha.before(async function() {
        if (test_utils.invalid_nsfs_root_permissions()) this.skip(); // eslint-disable-line no-invalid-this
        await fs_utils.create_fresh_path(tmp_fs_root + '/new_s3_buckets_dir', 0o770);
        await fs_utils.create_fresh_path(tmp_fs_root + bucket_path, 0o770);
        await fs_utils.create_fresh_path(tmp_fs_root + other_bucket_path, 0o770);
    });
    mocha.after(async () => {
        await fs_utils.folder_delete(tmp_fs_root);
    });
    mocha.it('read namespace resource before creation', async function() {
        try {
            await rpc_client.pool.read_namespace_resource({ name: 'dummy' });
        } catch (err) {
            assert.ok(err.rpc_code === 'NO_SUCH_NAMESPACE_RESOURCE');
        }
    });
    mocha.it('export dir as a bucket', async function() {
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
    });
    mocha.it('export same dir as bucket - should fail', async function() {
        // TODO: supporting it on NC is still on discussion
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        const obj_nsr = { resource: nsr, path: bucket_path };
        try {
            await rpc_client.bucket.create_bucket({
                name: bucket_name + '-should-fail',
                namespace: {
                    read_resources: [obj_nsr],
                    write_resource: obj_nsr
                }
            });
            assert.fail(`created 2 buckets on the same dir:`);
        } catch (err) {
            assert.ok(err.rpc_code === 'BUCKET_ALREADY_EXISTS');
        }
    });
    mocha.it('export other dir as bucket - and update bucket path to original bucket path', async function() {
        const obj_nsr = { resource: nsr, path: bucket_path };
        const other_obj_nsr = { resource: nsr, path: other_bucket_path };
        await rpc_client.bucket.create_bucket({
            name: bucket_name + '-other1',
            namespace: {
                read_resources: [other_obj_nsr],
                write_resource: other_obj_nsr
            }
        });
        // TODO: supporting it on NC is still on discussion
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        try {
            await rpc_client.bucket.update_bucket({
                name: bucket_name + '-other1',
                namespace: {
                    read_resources: [obj_nsr],
                    write_resource: obj_nsr
                }
            });
            assert.fail(`can not update nsfs bucket for using path of existing exported bucket:`);
        } catch (err) {
            assert.equal(err.rpc_code, 'BUCKET_ALREADY_EXISTS');
        }
    });

    mocha.it('Init S3 owner connection', async function() {
        const admin_keys = (await rpc_client.account.read_account({ email: EMAIL, })).access_keys;
        s3_creds.credentials = {
            accessKeyId: admin_keys[0].access_key.unwrap(),
            secretAccessKey: admin_keys[0].secret_key.unwrap(),
        };
        s3_creds.endpoint = coretest.get_http_address();
        s3_owner = new S3(s3_creds);
    });

    mocha.it('list buckets without uid, gid', async function() {
        // Give s3_owner access to the required buckets
        await Promise.all(
            ['first.bucket']
            .map(bucket => test_utils.generate_s3_policy(EMAIL, bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_owner.listBuckets({});
        console.log(inspect(res));
        const list_ok = bucket_in_list(['first.bucket'], [bucket_name], res.Buckets);
        assert.ok(list_ok);
    });
    mocha.it('create account 1 with uid, gid - wrong uid', async function() {
        account_wrong_uid = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_wrong_uid0@noobaa.com',
            name: 'account_wrong_uid0',
            nsfs_account_config: {
                uid: 26041992,
                gid: 26041992,
                new_buckets_path: '/',
                nsfs_only: false
            }
        });
        console.log(inspect(account_wrong_uid));
        s3_creds.credentials = {
            accessKeyId: account_wrong_uid.access_keys[0].access_key.unwrap(),
            secretAccessKey: account_wrong_uid.access_keys[0].secret_key.unwrap(),
        };
        s3_wrong_id_endpoint_address = coretest.get_http_address();
        s3_creds.endpoint = s3_wrong_id_endpoint_address;
        s3_wrong_uid = new S3(s3_creds);
    });
    mocha.it('list buckets with wrong uid, gid', async function() {
        // Give s3_wrong_uid access to the required buckets
        await Promise.all(
            ['first.bucket']
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_wrong_uid.listBuckets({});
        console.log(inspect(res));
        const list_ok = bucket_in_list(['first.bucket'], [bucket_name], res.Buckets);
        assert.ok(list_ok);
    });
    mocha.it('update account', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const email = 'account_wrong_uid0@noobaa.com';
        const account = await rpc_client.account.read_account({ email: email });
        const default_resource = account.default_resource;
        const arr = [{ nsfs_account_config: { uid: 26041993 }, default_resource, should_fail: false },
            {
                nsfs_account_config: { new_buckets_path: 'dummy_dir1/' },
                default_resource,
                should_fail: process.env.NC_CORETEST,
                error_code: ManageCLIError.InvalidAccountNewBucketsPath.code
            },
            {
                nsfs_account_config: {},
                default_resource,
                should_fail: !process.env.NC_CORETEST,
                error_code: 'FORBIDDEN'
            },
            { nsfs_account_config: { uid: 26041992 }, default_resource, should_fail: false }
        ];
        for (const item of arr) {
            await update_account_nsfs_config(email, item.default_resource, item.nsfs_account_config, item.should_fail, item.error_code);
        }
    });
    mocha.it('list namespace resources after creation', async function() {
        await rpc_client.create_auth_token({
            email: EMAIL,
            password: PASSWORD,
            system: SYSTEM,
        });
        const res = await rpc_client.pool.read_namespace_resource({ name: nsr });
        assert.ok(res.name === nsr && res.fs_root_path === tmp_fs_root);
    });
    mocha.it('create account 2 uid, gid', async function() {
        account_correct_uid = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_correct_uid@noobaa.com',
            name: 'account_correct_uid',
            nsfs_account_config: {
                uid: process.getuid(),
                gid: process.getgid(),
                new_buckets_path: '/',
                nsfs_only: false
            }
        });
        console.log(inspect(account_correct_uid));
        s3_creds.credentials = {
            accessKeyId: account_correct_uid.access_keys[0].access_key.unwrap(),
            secretAccessKey: account_correct_uid.access_keys[0].secret_key.unwrap(),
        };
        s3_creds.endpoint = coretest.get_http_address();
        s3_correct_uid = new S3(s3_creds);
    });
    // s3 workflow 
    mocha.it('create account with namespace resource as default pool but without nsfs_account_config', async function() {
        // not supported in NC
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        try {
            const res = await rpc_client.account.create_account({
                ...new_account_params,
                email: 'account_s3_correct_uid1@noobaa.com',
                name: 'account_s3_correct_uid1',
                s3_access: true,
                default_resource: nsr
            });
            assert.fail(inspect(res));
        } catch (err) {
            assert.strictEqual(err.message, 'Invalid account configuration - must specify nsfs_account_config when default resource is a namespace resource');
        }
    });
    mocha.it('create s3 bucket with correct uid and gid - existing directory', async function() {
        const account_s3_correct_uid1 = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_s3_correct_uid1@noobaa.com',
            name: 'account_s3_correct_uid1',
            s3_access: true,
            default_resource: nsr,
            nsfs_account_config: {
                uid: process.getuid(),
                gid: process.getgid(),
                new_buckets_path: '/',
                nsfs_only: false
            }
        });
        s3_creds.credentials = {
            accessKeyId: account_s3_correct_uid1.access_keys[0].access_key.unwrap(),
            secretAccessKey: account_s3_correct_uid1.access_keys[0].secret_key.unwrap(),
        };
        s3_creds.endpoint = coretest.get_http_address();
        s3_correct_uid_default_nsr = new S3(s3_creds);
        const buck1 = 'buck1';
        fs_utils.create_fresh_path(tmp_fs_root + '/buck1');
        try {
            const res = await s3_correct_uid_default_nsr.createBucket({
                Bucket: buck1,
            });
            assert.fail(inspect(res));
        } catch (err) {
            assert.strictEqual(err.Code, 'BucketAlreadyExists');
        }
        await fs_utils.file_must_exist(path.join(tmp_fs_root, '/buck1'));
    });
    mocha.it('create s3 bucket with correct uid and gid', async function() {
        const account_s3_correct_uid = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_s3_correct_uid@noobaa.com',
            name: 'account_s3_correct_uid',
            s3_access: true,
            default_resource: nsr,
            nsfs_account_config: {
                uid: process.getuid(),
                gid: process.getgid(),
                new_buckets_path: '/new_s3_buckets_dir',
                nsfs_only: false
            }
        });
        s3_creds.credentials = {
            accessKeyId: account_s3_correct_uid.access_keys[0].access_key.unwrap(),
            secretAccessKey: account_s3_correct_uid.access_keys[0].secret_key.unwrap(),
        };
        s3_creds.endpoint = coretest.get_http_address();
        s3_correct_uid_default_nsr = new S3(s3_creds);
        const res = await s3_correct_uid_default_nsr.createBucket({ Bucket: bucket_name + '-s3', });
        console.log(inspect(res));
        await fs_utils.file_must_exist(path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3'));
    });
    mocha.it('create s3 bucket with correct distinguished name', async function() {
        const account_s3_correct_dn = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_s3_correct_dn@noobaa.com',
            name: 'account_s3_correct_dn',
            s3_access: true,
            default_resource: nsr,
            nsfs_account_config: {
                distinguished_name: os.userInfo().username,
                new_buckets_path: '/new_s3_buckets_dir',
                nsfs_only: false
            }
        });
        s3_creds.credentials = {
            accessKeyId: account_s3_correct_dn.access_keys[0].access_key.unwrap(),
            secretAccessKey: account_s3_correct_dn.access_keys[0].secret_key.unwrap(),
        };
        s3_creds.endpoint = coretest.get_http_address();
        s3_correct_dn_default_nsr = new S3(s3_creds);
        const res = await s3_correct_dn_default_nsr.createBucket({ Bucket: bucket_name + '-s3-2', });
        console.log(inspect(res));
        await fs_utils.file_must_exist(path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3-2'));
    });
    mocha.it('create s3 bucket with incorrect uid and gid', async function() {
        const incorrect_params = {
            ...new_account_params,
            email: 'account_s3_incorrect_uid@noobaa.com',
            name: 'account_s3_incorrect_uid',
            s3_access: true,
            default_resource: nsr,
            nsfs_account_config: {
                uid: 26041992,
                gid: 26041992,
                new_buckets_path: '/new_s3_buckets_dir',
                nsfs_only: false
            }
        };
        const account_s3_incorrect_uid = await rpc_client.account.create_account(incorrect_params);
        s3_creds.credentials = {
            accessKeyId: account_s3_incorrect_uid.access_keys[0].access_key.unwrap(),
            secretAccessKey: account_s3_incorrect_uid.access_keys[0].secret_key.unwrap(),
        };
        s3_creds.endpoint = coretest.get_http_address();
        const s3_incorrect_uid_default_nsr = new S3(s3_creds);
        try {
            await s3_incorrect_uid_default_nsr.createBucket({
                Bucket: bucket_name + '-s3-should-fail',
            });
            assert.fail('unpreviliged account could create bucket on nsfs: ');
        } catch (err) {
            assert.ok(err + '- failed as it should');
            assert.strictEqual(err.Code, 'AccessDenied');
        }
        await fs_utils.file_must_not_exist(path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3-should-fail'));
    });
    mocha.it('create s3 bucket with wrong dn', async function() {
        const incorrect_params = {
            ...new_account_params,
            email: 'account_wrong_dn0@noobaa.com',
            name: 'account_wrong_dn0',
            s3_access: true,
            default_resource: nsr,
            nsfs_account_config: {
                distinguished_name: 'shaul101',
                new_buckets_path: '/new_s3_buckets_dir',
                nsfs_only: false
            }
        };
        account_wrong_dn = await rpc_client.account.create_account(incorrect_params);
        s3_creds.credentials = {
            accessKeyId: account_wrong_dn.access_keys[0].access_key.unwrap(),
            secretAccessKey: account_wrong_dn.access_keys[0].secret_key.unwrap(),
        };
        s3_creds.endpoint = coretest.get_http_address();
        const s3_incorrect_uid_default_nsr = new S3(s3_creds);
        try {
            await s3_incorrect_uid_default_nsr.createBucket({
                Bucket: bucket_name + '-s3-should-fail',
            });
            assert.fail('none existing user could create bucket on nsfs: ');
        } catch (err) {
            assert.ok(err + '- failed as it should');
            assert.strictEqual(err.Code, 'AccessDenied');
        }
        await fs_utils.file_must_not_exist(path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3-should-fail'));
    });
    mocha.it('update account dn', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const email = 'account_wrong_dn0@noobaa.com';
        const account = await rpc_client.account.read_account({ email: email });
        const default_resource = account.default_resource;
        const arr = [{ nsfs_account_config: { distinguished_name: 'bla' }, default_resource, should_fail: false },
            { nsfs_account_config: { new_buckets_path: 'dummy_dir1/' }, default_resource, should_fail: process.env.NC_CORETEST, error_code: ManageCLIError.InvalidAccountNewBucketsPath.code},
            { nsfs_account_config: {}, default_resource, should_fail: !process.env.NC_CORETEST, error_code: 'FORBIDDEN' },
            { nsfs_account_config: { distinguished_name: 'shaul101' }, default_resource, should_fail: false }
        ];
        for (const item of arr) {
            await update_account_nsfs_config(email, item.default_resource, item.nsfs_account_config, item.should_fail, item.error_code);
        }
    });
    mocha.it('list buckets with uid, gid', async function() {
        // Give s3_correct_uid access to the required buckets
        await Promise.all(
            [bucket_name]
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_correct_uid.listBuckets({});
        console.log(inspect(res));
        const list_ok = bucket_in_list([bucket_name], [], res.Buckets);
        assert.ok(list_ok);
    });
    mocha.it('list buckets with dn', async function() {
        const res = await s3_correct_dn_default_nsr.listBuckets({});
        console.log(inspect(res));
        const list_ok = bucket_in_list([bucket_name + '-s3-2'], [], res.Buckets);
        assert.ok(list_ok);
    });

    mocha.it('put object with out uid gid', async function() {
        try {
            const res = await s3_owner.putObject({ Bucket: bucket_name + '-s3', Key: 'ob1.txt', Body: 'AAAABBBBBCCCCCCDDDDD' });
            console.log(inspect(res));
            assert.fail('unpreviliged account could put object on nsfs bucket');
        } catch (err) {
            assert.strictEqual(err.Code, 'AccessDenied');
        }
    });
    // GAP upload is still using AWS SDK V2
    mocha.it('upload object with wrong uid gid', async function() {
        const s3_creds_aws_sdk_v2 = {
            s3ForcePathStyle: true,
            signatureVersion: 'v4',
            computeChecksums: true,
            s3DisableBodySigning: false,
            region: 'us-east-1',
            httpOptions: { agent: new http.Agent({ keepAlive: false }) },
        };
        s3_creds_aws_sdk_v2.accessKeyId = account_wrong_uid.access_keys[0].access_key.unwrap();
        s3_creds_aws_sdk_v2.secretAccessKey = account_wrong_uid.access_keys[0].secret_key.unwrap();
        s3_creds_aws_sdk_v2.endpoint = s3_wrong_id_endpoint_address;
        s3_wrong_uid_aws_sdk_v2_temp = new AWS.S3(s3_creds_aws_sdk_v2);

        try {
            const res = await s3_wrong_uid_aws_sdk_v2_temp.upload({ Bucket: bucket_name + '-s3', Key: 'ob1.txt', Body: 'AAAABBBBBCCCCCCDDDDD' }).promise();
            console.log(inspect(res));
            assert.fail('unpreviliged account could upload object on nsfs bucket');
        } catch (err) {
            assert.strictEqual(err.code, 'AccessDenied');
        }
    });
    mocha.it('list parts with wrong uid gid', async function() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(600000);
        // Give s3_correct_uid access to the required buckets
        const generated = await test_utils.generate_s3_policy('*', bucket_name, ['s3:*']);
        await rpc_client.bucket.put_bucket_policy({
                name: bucket_name,
                policy: generated.policy,
        });

        const res1 = await s3_correct_uid.createMultipartUpload({
            Bucket: bucket_name,
            Key: 'ob1.txt'
        });
        await s3_correct_uid.uploadPart({
            Bucket: bucket_name,
            Key: 'ob1.txt',
            UploadId: res1.UploadId,
            PartNumber: 1,
            Body: 'AAAABBBBBCCCCCCDDDDD',
        });
        try {
            // list_multiparts
            const res = await s3_wrong_uid.listParts({ Bucket: bucket_name + '-s3', Key: 'ob1.txt', UploadId: res1.UploadId });
            console.log(inspect(res));
            assert.fail('unpreviliged account could not list object parts on nsfs bucket');
        } catch (err) {
            assert.strictEqual(err.Code, 'AccessDenied');
        }
    });
    mocha.it('put object with correct uid gid', async function() {
        // Give s3_correct_uid access to the required buckets
        await Promise.all(
            [bucket_name + '-s3']
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_correct_uid.putObject({ Bucket: bucket_name + '-s3', Key: 'ob1.txt', Body: 'AAAABBBBBCCCCCCDDDDD' });
        assert.ok(res && res.ETag);
    });
    mocha.it('delete bucket without uid, gid - bucket is not empty', async function() {
        // account without uid and gid not supported in NC
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        try {
            const res = await s3_owner.deleteBucket({ Bucket: bucket_name + '-s3' });
            console.log(inspect(res));
            assert.fail('unpreviliged account could delete bucket on nsfs: ');
        } catch (err) {
            assert.strictEqual(err.Code, 'AccessDenied');
        }
    });
    mocha.it('copy objects with wrong uid gid', async function() {
        try {
            const res = await s3_wrong_uid.copyObject({ Bucket: bucket_name + '-s3', Key: 'ob2.txt', CopySource: bucket_name + '-s3/ob1.txt' });
            console.log(inspect(res));
            assert.fail('unpreviliged account could copy objects on nsfs bucket');
        } catch (err) {
            assert.strictEqual(err.Code, 'AccessDenied');
        }
    });

    mocha.it('copy objects with correct uid gid - same inode', async function() {
        // same inode check fails if MD5 xattr doesn't exist
        config.NSFS_CALCULATE_MD5 = true;
        const key = 'ob11.txt';
        const source_key = key;
        const put_res = await s3_correct_uid.putObject({ Bucket: bucket_name + '-s3', Key: source_key, Body: 'AAAABBBBBCCCCCCDDDDD' });
        assert.ok(put_res && put_res.ETag);
        await s3_correct_uid.copyObject({ Bucket: bucket_name + '-s3', Key: key, CopySource: bucket_name + `-s3/${source_key}` });
        config.NSFS_CALCULATE_MD5 = false;

        const p = path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3', key);
        const stat1 = await fs.promises.stat(p);
        const p_source = path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3', source_key);
        const stat_source = await fs.promises.stat(p_source);

        assert.equal(stat1.nlink, 1);
        assert.deepEqual(stat1, stat_source);
        await s3_correct_uid.deleteObject({ Bucket: bucket_name + '-s3', Key: key });
    });

    mocha.it('copy objects with correct uid gid - non server side copy - fallback', async function() {
        const key = 'ob22.txt';
        const source_key = 'ob1.txt';
        await s3_correct_uid.copyObject({ Bucket: bucket_name + '-s3',
            Key: key,
            CopySource: bucket_name + `-s3/${source_key}`,
            MetadataDirective: 'REPLACE',
            Metadata: { 'new_xattr': 'new_xattr_val' } });

        const p = path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3', key);
        const stat1 = await stat(DEFAULT_FS_CONFIG, p);

        const p_source = path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3', source_key);
        const stat_source = await stat(DEFAULT_FS_CONFIG, p_source);

        await s3_correct_uid.deleteObject({ Bucket: bucket_name + '-s3', Key: 'ob22.txt' });

        assert.equal(stat1.nlink, 1);
        assert.notEqual(stat1.ino, stat_source.ino);
        assert.notEqual(stat1.mtimeMs, stat_source.mtimeMs);
        assert.equal(stat1.xattr['user.new_xattr'], 'new_xattr_val');
        assert.deepEqual(_.omit(stat1.xattr, 'user.new_xattr'), stat_source.xattr);
    });

    mocha.it('copy objects with correct uid gid - link', async function() {
        const key = 'ob2.txt';
        const source_key = 'ob1.txt';
        await s3_correct_uid.copyObject({
            Bucket: bucket_name + '-s3',
            Key: key,
            CopySource: bucket_name + `-s3/${source_key}`,
            Metadata: {'wont_replace': 'wont'} });

        const p = path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3', key);
        const stat1 = await stat(DEFAULT_FS_CONFIG, p);

        const p_source = path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3', source_key);
        const stat_source = await stat(DEFAULT_FS_CONFIG, p_source);

        await s3_correct_uid.deleteObject({ Bucket: bucket_name + '-s3', Key: key });

        assert.equal(stat1.nlink, 2);
        assert.equal(stat1.ino, stat_source.ino);
        assert.equal(stat1.mtimeMs, stat_source.mtimeMs);
        assert.deepEqual(stat1.xattr, stat_source.xattr);
        assert.equal(stat1.xattr['user.wont_replace'], undefined);

    });

    mocha.it('list objects with wrong uid gid', async function() {
        try {
            const res = await s3_wrong_uid.listObjects({ Bucket: bucket_name + '-s3' });
            console.log(inspect(res));
            assert.fail('unpreviliged account could list objects on nsfs bucket');
        } catch (err) {
            assert.strictEqual(err.Code, 'AccessDenied');
        }
    });
    mocha.it('delete bucket with uid, gid - bucket is not empty', async function() {
        try {
            const res = await s3_correct_uid_default_nsr.deleteBucket({ Bucket: bucket_name + '-s3' });
            console.log(inspect(res));
            assert.fail('should fail deletion od bucket, bucket is not empty');
        } catch (err) {
            assert.strictEqual(err.Code, 'BucketNotEmpty');
        }
    });
    mocha.it('delete object without uid, gid - bucket is empty', async function() {
        try {
            const res = await s3_owner.deleteObject({ Bucket: bucket_name + '-s3', Key: 'ob1.txt' });
            console.log(inspect(res));
            assert.fail('unpreviliged account could delete object on nsfs bucket ');
        } catch (err) {
            assert.strictEqual(err.Code, 'AccessDenied');
        }
    });
    mocha.it('delete object with uid, gid', async function() {
        const res = await s3_correct_uid_default_nsr.deleteObject({ Bucket: bucket_name + '-s3', Key: 'ob1.txt' });
        console.log(inspect(res));
    });
    mocha.it('delete non existing object without failing', async function() {
        const key_to_delete = 'non-existing-obj';
        const res = await s3_correct_uid_default_nsr.deleteObject({ Bucket: bucket_name + '-s3', Key: key_to_delete});
        const res_without_metadata = _.omit(res, '$metadata');
        assert.deepEqual(res_without_metadata, {});
    });

    mocha.it('delete multiple non existing objects without failing', async function() {
        const keys_to_delete = [
            { Key: 'non-existing-obj1' },
            { Key: 'non-existing-obj2' },
            { Key: 'non-existing-obj3' }
        ];
        const res = await s3_correct_uid_default_nsr.deleteObjects({ Bucket: bucket_name + '-s3',
            Delete: {
                Objects: keys_to_delete
            }
        });
        assert.deepEqual(res.Deleted, keys_to_delete);
        assert.equal(res.Errors, undefined);

    });
    mocha.it('delete bucket without uid, gid - bucket is empty', async function() {
        // account without uid and gid is not supported in NC
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        try {
            const res = await s3_owner.deleteBucket({ Bucket: bucket_name + '-s3' });
            console.log(inspect(res));
            assert.fail('unpreviliged account could delete bucket on nsfs: ');
        } catch (err) {
            assert.strictEqual(err.Code, 'AccessDenied');
        }
    });
    mocha.it('delete account by uid, gid - account has buckets - should fail', async function() {
        // deletion of account that owns bucket currently allowd in NC - remove when supported
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        await s3_correct_uid_default_nsr.createBucket({ Bucket: 'bucket-to-delete123' });
        try {
            await rpc_client.account.delete_account({ email: 'account_s3_correct_uid@noobaa.com' });
            assert.fail(`delete account succeeded for account that has buckets`);
        } catch (err) {
            assert.equal(err.rpc_code, 'FORBIDDEN');
        }

        try {
            await rpc_client.account.delete_account_by_property({ nsfs_account_config: { uid: process.getuid(), gid: process.getgid() } });
            assert.fail(`delete account succeeded for account that has buckets`);
        } catch (err) {
            assert.equal(err.rpc_code, 'FORBIDDEN');
        }
       await s3_correct_uid_default_nsr.deleteBucket({ Bucket: 'bucket-to-delete123' });

    });

    mocha.it('delete bucket with uid, gid - bucket is empty', async function() {
        const res = await s3_correct_uid_default_nsr.deleteBucket({ Bucket: bucket_name + '-s3' });
        console.log(inspect(res));
    });
    mocha.it('list buckets after deletion', async function() {
        const res = await s3_correct_uid.listBuckets({});
        console.log(inspect(res));
        const list_ok = bucket_in_list([], [bucket_name + '-s3'], res.Buckets);
        assert.ok(list_ok);
    });
    mocha.it('check dir doesnt exist after deletion', async function() {
        await fs_utils.file_must_not_exist(path.join(tmp_fs_root, '/new_s3_buckets_dir', bucket_name + '-s3'));
        await fs_utils.file_must_exist(path.join(tmp_fs_root, '/new_s3_buckets_dir'));
    });
    mocha.it('delete account by uid, gid', async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const read_account_resp1 = await rpc_client.account.read_account({ email: 'account_wrong_uid0@noobaa.com' });
        assert.ok(read_account_resp1);
        // create another account with the same uid gid
        const account_wrong_uid1 = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_wrong_uid1@noobaa.com',
            name: 'account_wrong_uid1',
            nsfs_account_config: {
                uid: 26041992,
                gid: 26041992,
                new_buckets_path: '/',
                nsfs_only: false
            }
        });
        console.log(inspect(account_wrong_uid1));
        assert.ok(account_wrong_uid1);
        await rpc_client.account.delete_account_by_property({
            nsfs_account_config: {
                uid: 26041992,
                gid: 26041992,
            }
        });
        // check that both accounts deleted
        for (let i = 0; i < 2; i++) {
            try {
                const deleted_account_exist = await rpc_client.account.read_account({ email: `account_wrong_uid${i}@noobaa.com` });
                assert.fail(`found account: ${deleted_account_exist} - account should be deleted`);
            } catch (err) {
                if (process.env.NC_CORETEST) {
                    assert.equal(JSON.parse(err.stdout).error.code, ManageCLIError.NoSuchAccountName.code);
                } else {
                    assert.equal(err.rpc_code, 'NO_SUCH_ACCOUNT');
                }
            }
        }
        const list_account_resp2 = (await rpc_client.account.list_accounts({})).accounts;
        assert.ok(list_account_resp2.length > 0);
    });
    mocha.it('delete account by dn', async function() {
        // TODO: unskip when added list by distinguished name
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const read_account_resp1 = await rpc_client.account.read_account({ email: 'account_wrong_dn0@noobaa.com' });
        assert.ok(read_account_resp1);
        // create another account with the same uid gid
        const account_wrong_dn1 = await rpc_client.account.create_account({
            ...new_account_params,
            email: 'account_wrong_dn1@noobaa.com',
            name: 'account_wrong_dn1',
            nsfs_account_config: {
                distinguished_name: 'shaul101',
                new_buckets_path: '/',
                nsfs_only: false
            }
        });
        console.log(inspect(account_wrong_dn1));
        assert.ok(account_wrong_dn1);
        await rpc_client.account.delete_account_by_property({
            nsfs_account_config: {
                distinguished_name: 'shaul101',
            }
        });
        // check that both accounts deleted
        for (let i = 0; i < 2; i++) {
            try {
                const deleted_account_exist = await rpc_client.account.read_account({ email: `account_wrong_dn${i}@noobaa.com` });
                assert.fail(`found account: ${deleted_account_exist} - account should be deleted`);
            } catch (err) {
                if (process.env.NC_CORETEST) {
                    assert.equal(JSON.parse(err.stdout).error.code, ManageCLIError.NoSuchAccountName.code);
                } else {
                    assert.equal(err.rpc_code, 'NO_SUCH_ACCOUNT');
                }
            }
        }
        const list_account_resp2 = (await rpc_client.account.list_accounts({})).accounts;
        assert.ok(list_account_resp2.length > 0);
    });
    mocha.it('delete account by uid, gid - no such account', async function() {
        // on NC - list will return empty, we won't run any delete
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        const list_account_resp1 = (await rpc_client.account.list_accounts({})).accounts;
        assert.ok(list_account_resp1.length > 0);
        try {
            await rpc_client.account.delete_account_by_property({ nsfs_account_config: { uid: 26041993, gid: 26041993 } });
            assert.fail(`delete account succeeded for none existing account`);
        } catch (err) {
            assert.equal(err.rpc_code, 'NO_SUCH_ACCOUNT');
        }
    });
    mocha.it('delete bucket with uid, gid - bucket is empty', async function() {
        // Give s3_correct_uid_default_nsr access to the required buckets
        await Promise.all(
            [bucket_name + '-other1', bucket_name]
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await s3_correct_uid_default_nsr.deleteBucket({ Bucket: bucket_name });
        await s3_correct_uid_default_nsr.deleteBucket({ Bucket: bucket_name + '-other1' });
    });
});


mocha.describe('list objects - namespace_fs', async function() {
    const namespace_resource_name = 'nsr1-list';
    const bucket_name = 'bucket-to-list1';
    const tmp_fs_root = get_tmp_path_by_os('/tmp/test_bucket_namespace_fs1');
    const bucket_path = '/bucket123';
    const s3_b_name = 's3-created-bucket';
    const s3_root_b_name = 's3-root-created-bucket';

    const body = 'AAAABBBBBCCCCCCDDDDD';
    const accounts = {
        'account1': { uid: 2000, gid: 2000 },
        'account2': { uid: 2001, gid: 2001 },
        'account3': { uid: 2002, gid: 2002 },
        'account4': { uid: process.getuid(), gid: process.getgid()}
    };
    const permit_ugo = 0o777;
    const permit_ug = 0o770;
    const full_path = path.join(tmp_fs_root, bucket_path);

    mocha.before(async function() {
        this.timeout(30000); // eslint-disable-line no-invalid-this
        if (test_utils.invalid_nsfs_root_permissions()) this.skip(); // eslint-disable-line no-invalid-this

        await fs_utils.create_fresh_path(tmp_fs_root, permit_ugo);
        await fs_utils.file_must_exist(tmp_fs_root);
        await fs_utils.create_fresh_path(full_path, permit_ug);
        await fs_utils.file_must_exist(full_path);
        await rpc_client.pool.create_namespace_resource({
            name: namespace_resource_name,
            nsfs_config: {
                fs_root_path: tmp_fs_root,
            }
        });
        const obj_nsr = { resource: namespace_resource_name, path: bucket_path };
        await rpc_client.bucket.create_bucket({
            name: bucket_name,
            namespace: {
                read_resources: [obj_nsr],
                write_resource: obj_nsr
            }
        });

        const s3_policy = test_utils.generate_s3_policy('*', bucket_name, ['s3:*']);
        await rpc_client.bucket.put_bucket_policy({ name: s3_policy.params.bucket, policy: s3_policy.policy });

        for (const account_name of Object.keys(accounts)) {
            const { uid, gid } = accounts[account_name];
            const account = await generate_nsfs_account({ uid, gid, account_name, default_resource: namespace_resource_name });
            const s3_client = generate_s3_client(account.access_key, account.secret_key);
            accounts[account_name].s3_client = s3_client;
        }
    });
    mocha.after(async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        await rpc_client.bucket.delete_bucket({ name: bucket_name });
        await rpc_client.bucket.delete_bucket({ name: s3_b_name });
        await rpc_client.bucket.delete_bucket({ name: s3_root_b_name });

        for (const account_name of Object.keys(accounts)) {
            await rpc_client.account.delete_account({ email: `${account_name}@noobaa.com` });
        }
        await fs_utils.folder_delete(tmp_fs_root);
    });

    mocha.it('list buckets - uid & gid mismatch - should fail', async function() {
        const { s3_client } = accounts.account1;
        const res = await s3_client.listBuckets({});
        assert.equal(res.Buckets.length, 1);
        assert.equal(res.Buckets[0].Name, 'first.bucket');
    });

    mocha.it('put object 1 account_with_access - uid & gid mismatch - should fail', async function() {
        try {
            const { s3_client } = accounts.account1;
            await s3_client.putObject({ Bucket: bucket_name, Key: 'key1', Body: body });
            assert.fail(`put object succeeded for account without permissions`);
        } catch (err) {
            assert.equal(err.Code, 'AccessDenied');
        }
    });

    mocha.it('list objects - no access to bucket - uid & gid mismatch - should fail', async function() {
        try {
            const { s3_client } = accounts.account3;
            await s3_client.listObjects({ Bucket: bucket_name });
            assert.fail(`list objects succeeded for account without permissions`);
        } catch (err) {
            assert.equal(err.Code, 'AccessDenied');
        }
    });

    mocha.it('create s3 bucket', async function() {
        const { s3_client } = accounts.account1;
        await s3_client.createBucket({ Bucket: s3_b_name});
        const s3_policy = test_utils.generate_s3_policy('*', s3_b_name, ['s3:*']);
        await rpc_client.bucket.put_bucket_policy({ name: s3_b_name, policy: s3_policy.policy });
    });


    mocha.it('list objects s3_b_name - uid & gid mismatch - should fail', async function() {
        try {
            const { s3_client } = accounts.account3;
            await s3_client.listObjects({ Bucket: s3_b_name });
            assert.fail(`list objects succeeded for account without permissions`);
        } catch (err) {
            assert.equal(err.Code, 'AccessDenied');
        }
    });

    mocha.it('list buckets - uid & gid mismatch - account1', async function() {
        const { s3_client } = accounts.account1;
        const res = await s3_client.listBuckets({});
        assert.equal(res.Buckets.length, 2);
        assert.equal(res.Buckets.filter(bucket => bucket.Name === s3_b_name || bucket.Name === 'first.bucket').length, 2);
    });

    mocha.it('list buckets - uid & gid mismatch - account2', async function() {
        const { s3_client } = accounts.account2;
        const res = await s3_client.listBuckets({});
        assert.equal(res.Buckets.length, 1);
        assert.equal(res.Buckets[0].Name, 'first.bucket');
    });

    mocha.it('create s3 bucket by root', async function() {
        const { s3_client } = accounts.account4;
        await s3_client.createBucket({ Bucket: s3_root_b_name});
        const s3_policy = test_utils.generate_s3_policy('*', s3_root_b_name, ['s3:*']);
        await rpc_client.bucket.put_bucket_policy({ name: s3_root_b_name, policy: s3_policy.policy });
    });

    mocha.it('list buckets - uid & gid match - account with permission', async function() {
        const { s3_client } = accounts.account4;
        const res = await s3_client.listBuckets({});
        assert.equal(res.Buckets.length, 4);
    });

    mocha.it('change mode of /bucket123/ to 0o777: ', async function() {
        await fs.promises.chmod(full_path, permit_ugo);
        const stat1 = await fs.promises.stat(full_path);
        assert.equal(stat1.mode, 16895);
    });

    mocha.it('put object 1 account1', async function() {
        const { s3_client } = accounts.account1;
        await s3_client.putObject({ Bucket: bucket_name, Key: 'dir1/key1', Body: body });
    });

    mocha.it('list objects - account1', async function() {
        const { s3_client } = accounts.account1;
        const res = await s3_client.listObjects({ Bucket: bucket_name });
        assert.equal(object_in_list(res, 'dir1/key1'), true);
    });

    mocha.it('list objects - account2', async function() {
        const { s3_client } = accounts.account2;
        const res = await s3_client.listObjects({ Bucket: bucket_name });
        assert.equal(object_in_list(res, 'dir1/key1'), false);
    });
});


mocha.describe('nsfs account configurations', function() {
    this.timeout(10000); // eslint-disable-line no-invalid-this
    const nsr1 = 'nsr1';
    const nsr2 = 'nsr2';
    const bucket_name1 = 'src-bucket1';
    const non_nsfs_bucket1 = 'first.bucket';
    const non_nsfs_bucket2 = 'second.bucket';
    const nsr2_connection = 'nsr2_connection';
    const tmp_fs_root1 = get_tmp_path_by_os('/tmp/test_bucket_namespace_fs2');
    const bucket_path = '/nsfs_accounts';
    const accounts = {}; // {account_name : s3_account_object...}
    const regular_bucket_name = ['regular-bucket', 'regular-bucket1', 'regular-bucket2'];
    const regular_bucket_fail = ['regular-bucket-fail', 'regular-bucket-fail1', 'regular-bucket-fail2'];
    const data_bucket = 'data-bucket';
    const s3_creds = {
        forcePathStyle: true,
        region: config.DEFAULT_REGION,
        requestHandler: new NodeHttpHandler({
            httpAgent: new http.Agent({ keepAlive: false })
        }),
    };
    mocha.before(function() {
        if (test_utils.invalid_nsfs_root_permissions()) this.skip(); // eslint-disable-line no-invalid-this
        // the following test suite tests account with/without nsfs_only and different nsfs/non nsfs buckets
        // which is not relevant to NC
        if (process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
    });

    mocha.before(async () => fs_utils.create_fresh_path(tmp_fs_root1 + bucket_path, 0o770));
    mocha.after(async () => {
        for (const bucket_name of [bucket_name1, data_bucket, non_nsfs_bucket2]) {
            try {
                await rpc_client.bucket.delete_bucket({ name: bucket_name });
            } catch (err) {
                console.error('failed deleting bucket: ', bucket_name, err);
            }
        }
        await fs_utils.folder_delete(tmp_fs_root1);
    });
    mocha.it('export dir as a bucket', async function() {
        await rpc_client.pool.create_namespace_resource({
            name: nsr1,
            nsfs_config: {
                fs_root_path: tmp_fs_root1,
            }
        });
        const obj_nsr = { resource: nsr1, path: bucket_path };
        await rpc_client.bucket.create_bucket({
            name: bucket_name1,
            namespace: {
                read_resources: [obj_nsr],
                write_resource: obj_nsr
            }
        });

        await rpc_client.bucket.create_bucket({
            name: data_bucket,
        });
    });

    mocha.it('create s3 compatible ns bucket', async function() {
        const admin_keys = (await rpc_client.account.read_account({ email: EMAIL, })).access_keys;
        await rpc_client.account.add_external_connection({
            name: nsr2_connection,
            endpoint: coretest.get_http_address(),
            endpoint_type: 'S3_COMPATIBLE',
            identity: admin_keys[0].access_key.unwrap(),
            secret: admin_keys[0].secret_key.unwrap()
        });
        await rpc_client.pool.create_namespace_resource({
            name: nsr2,
            connection: nsr2_connection,
            target_bucket: data_bucket
        });
        const obj_nsr = { resource: nsr2 };
        await rpc_client.bucket.create_bucket({
            name: non_nsfs_bucket2,
            namespace: {
                read_resources: [obj_nsr],
                write_resource: obj_nsr
            }
        });
    });

    mocha.it('create accounts', async function() {
        const names_and_default_resources = {
            account1: { default_resource: undefined, nsfs_only: false }, // undefined = default_pool
            account2: { default_resource: nsr2, nsfs_only: false }, // nsr2 = s3 compatible nsr
            account3: { default_resource: nsr1, nsfs_only: false }, // nsr1 = nsfs nsr
            account_nsfs_only1: { default_resource: undefined, nsfs_only: true },
            account_nsfs_only2: { default_resource: nsr2, nsfs_only: true },
            account_nsfs_only3: { default_resource: nsr1, nsfs_only: true }
        };
        for (const name of Object.keys(names_and_default_resources)) {
            const config1 = names_and_default_resources[name];
            const cur_account = await rpc_client.account.create_account({
                ...new_account_params,
                email: `${name}@noobaa.io`,
                name: name,
                default_resource: config1.default_resource,
                nsfs_account_config: {
                    uid: process.getuid(),
                    gid: process.getgid(),
                    new_buckets_path: '/',
                    nsfs_only: config1.nsfs_only
                }
            });
            s3_creds.credentials = {
                accessKeyId: cur_account.access_keys[0].access_key.unwrap(),
                secretAccessKey: cur_account.access_keys[0].secret_key.unwrap(),
            };
            s3_creds.endpoint = coretest.get_http_address();
            const cur_s3_account = new S3(s3_creds);
            accounts[name] = cur_s3_account;
        }
    });

    ///////////////////
    // create bucket //
    ///////////////////

    // default pool
    mocha.it('s3 put bucket allowed non nsfs buckets - default pool', async function() {
        const s3_account = accounts.account1;
        await s3_account.createBucket({ Bucket: regular_bucket_name[0] });
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1, non_nsfs_bucket1, non_nsfs_bucket2, regular_bucket_name[0]]
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_account.listBuckets({});
        console.log(inspect(res));
        const list_ok = bucket_in_list([bucket_name1, non_nsfs_bucket1, non_nsfs_bucket2, regular_bucket_name[0]], [], res.Buckets);
        assert.ok(list_ok);
    });

    // default nsr - nsfs 
    mocha.it('s3 put bucket allowed non nsfs buckets - default nsr - nsfs', async function() {
        const s3_account = accounts.account3;
        await s3_account.createBucket({ Bucket: regular_bucket_name[1] });
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1, non_nsfs_bucket1, non_nsfs_bucket2, regular_bucket_name[1]]
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_account.listBuckets({});
        console.log(inspect(res));
        const list_ok = bucket_in_list([bucket_name1, non_nsfs_bucket1, non_nsfs_bucket2, regular_bucket_name[1]], [], res.Buckets);
        assert.ok(list_ok);
    });

    mocha.it('s3 put bucket not allowed non nsfs buckets - default nsr - nsfs', async function() {
        const s3_account = accounts.account_nsfs_only3;
        await s3_account.createBucket({ Bucket: regular_bucket_name[2] });
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1, regular_bucket_name[2]]
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_account.listBuckets({});
        console.log(inspect(res));
        const list_ok = bucket_in_list([bucket_name1, regular_bucket_name[2]], [non_nsfs_bucket1, non_nsfs_bucket2], res.Buckets);
        assert.ok(list_ok);
    });

    mocha.it('s3 put bucket not allowed non nsfs buckets - default pool', async function() {
        try {
            const s3_account = accounts.account_nsfs_only1;
            await s3_account.createBucket({ Bucket: regular_bucket_fail[0] });
            assert.fail('account should not be allowed to create bucket');
        } catch (err) {
            assert.ok(err.Code === 'AccessDenied');
        }
    });

    // default nsr - s3 compatible
    mocha.it('s3 put bucket allowed non nsfs buckets - default nsr - s3 compatible', async function() {
        try {
            const s3_account = accounts.account2;
            await s3_account.createBucket({ Bucket: regular_bucket_fail[1] });
        } catch (err) {
            // create uls in namespace s3 compatible is not implement yet - but the error is not access denied
            assert.ok(err.Code === 'InternalError');
        }
    });

    mocha.it('s3 put bucket not allowed non nsfs buckets - default nsr - s3 compatible', async function() {
        try {
            const s3_account = accounts.account_nsfs_only2;
            await s3_account.createBucket({ Bucket: regular_bucket_fail[2] });
            assert.fail('account should not be allowed to create bucket');
        } catch (err) {
            assert.ok(err.Code === 'AccessDenied');
        }
    });


    ///////////////////
    // list buckets  //
    ///////////////////

    mocha.it('s3 list buckets allowed non nsfs buckets', async function() {
        const s3_account = accounts.account1;
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1, non_nsfs_bucket1, non_nsfs_bucket2]
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_account.listBuckets({});
        console.log(inspect(res));
        const list_ok = bucket_in_list([bucket_name1, non_nsfs_bucket1, non_nsfs_bucket2], [], res.Buckets);
        assert.ok(list_ok);
    });


    mocha.it('s3 list buckets allowed non nsfs buckets', async function() {
        const s3_account = accounts.account_nsfs_only1;
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1]
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        const res = await s3_account.listBuckets({});
        console.log(inspect(res));
        const list_ok = bucket_in_list([bucket_name1], [non_nsfs_bucket1, non_nsfs_bucket2], res.Buckets);
        assert.ok(list_ok);
    });

    ///////////////////
    //  put object   //
    ///////////////////

    mocha.it('s3 object bucket using nsfs_only=false account - regular-bucket', async function() {
        const s3_account = accounts.account1;
        // Give account access to the required buckets
        await Promise.all(
            [regular_bucket_name[0]]
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await put_and_delete_objects(s3_account,
            regular_bucket_name[0],
            'allowed_key',
            create_random_body()
        );
    });

    mocha.it('s3 put object using nsfs_only=true account - first.bucket', async function() {
        const s3_account = accounts.account_nsfs_only1;
        // Give account access to the required buckets
        await Promise.all(
            [non_nsfs_bucket1]
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await put_and_delete_objects(s3_account,
            non_nsfs_bucket1,
            'allowed_key12',
            create_random_body(),
            true
        );
    });

    mocha.it('s3 put object using nsfs_only=false account - second.bucket(s3 compatible namespace bucket)', async function() {
        const s3_account = accounts.account1;
        // Give account access to the required buckets
        await Promise.all(
            [non_nsfs_bucket2]
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await put_and_delete_objects(s3_account,
            non_nsfs_bucket2,
            'allowed_key',
            create_random_body()
        );
    });

    mocha.it('s3 put object using nsfs_only=true account - second.bucket(s3 compatible namespace bucket)', async function() {
        const s3_account = accounts.account_nsfs_only1;
        // Give account access to the required buckets
        await Promise.all(
            [non_nsfs_bucket2]
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await put_and_delete_objects(s3_account,
            non_nsfs_bucket2,
            'allowed_key',
            create_random_body(),
            true
        );
    });

    mocha.it('s3 put object allowed non nsfs buckets - nsfs bucket', async function() {
        const s3_account = accounts.account1;
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1]
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await put_and_delete_objects(s3_account,
            bucket_name1,
            'allowed_key-nsfs1',
            create_random_body()
        );
    });

    mocha.it('s3 put object allowed non nsfs buckets - nsfs bucket', async function() {
        const s3_account = accounts.account_nsfs_only1;
        // Give account access to the required buckets
        await Promise.all(
            [bucket_name1]
            .map(bucket => test_utils.generate_s3_policy('*', bucket, ['s3:*']))
            .map(generated =>
                rpc_client.bucket.put_bucket_policy({
                    name: generated.params.bucket,
                    policy: generated.policy,
                })
            )
        );
        await put_and_delete_objects(s3_account,
            bucket_name1,
            'allowed_key-nsfs2',
            create_random_body()
        );
    });


    mocha.it('delete buckets', async function() {
        for (const bucket of regular_bucket_name) {
            await rpc_client.bucket.delete_bucket({ name: bucket });
        }
    });

    ////////////////////////
    //   delete accounts  //
    ////////////////////////

    mocha.it('delete accounts', async function() {
        for (const account_name of Object.keys(accounts)) {
            await rpc_client.account.delete_account({ email: `${account_name}@noobaa.io` });
        }
    });
});

mocha.describe('list buckets - namespace_fs', async function() {
    const tmp_fs_root = get_tmp_path_by_os('/tmp/test_bucket_namespace_ls');
    const new_buckets_dir = '/lb_new_buckets_path';
    const new_buckets_path = path.join(tmp_fs_root, new_buckets_dir);
    const accounts = {
        'account1': {
            bucket: 'bucket1',
            create_bucket_via: 'S3',
            account_info: {
                uid: process.getuid(),
                gid: process.getuid(),
                new_buckets_path
            },
        },
        'account2': {
            bucket: 'bucket2',
            create_bucket_via: 'CLI',
            account_info: {
                user: 'root',
                new_buckets_path
            }
        },
        'account3': {
            bucket: 'bucket3',
            create_bucket_via: 'CLI',
            account_info: {
                uid: process.getuid(),
                gid: process.getuid(),
                new_buckets_path
            }
        },
        'account4': {
            bucket: 'bucket4',
            create_bucket_via: 'CLI',
            account_info: {
                uid: 1234,
                gid: 1234,
                new_buckets_path
            }
        },
    };

    mocha.before(async function() {
        this.timeout(30000); // eslint-disable-line no-invalid-this
        // TODO: support NSFS containerized, requires different rpc clients
        if (test_utils.invalid_nsfs_root_permissions() || !process.env.NC_CORETEST) this.skip(); // eslint-disable-line no-invalid-this
        await fs_utils.create_fresh_path(tmp_fs_root);
        await fs_utils.file_must_exist(tmp_fs_root);
        await fs_utils.create_fresh_path(new_buckets_path);
        await fs_utils.file_must_exist(new_buckets_path);
        const dummy_nsr = 'dummy_nsr';

        await rpc_client.pool.create_namespace_resource({
            name: dummy_nsr,
            nsfs_config: {
                fs_root_path: tmp_fs_root,
            }
        });

        for (const account_name of Object.keys(accounts)) {
            const { create_bucket_via, bucket, account_info } = accounts[account_name];
            const { uid, gid } = account_info;
            const account = await generate_nsfs_account({ uid, gid, account_name, new_buckets_path });
            const s3_client = generate_s3_client(account.access_key, account.secret_key);
            accounts[account_name].s3_client = s3_client;

            if (create_bucket_via === 'CLI') {
                const cli_bucket_path = path.join(tmp_fs_root, bucket);
                await fs_utils.create_fresh_path(cli_bucket_path);
                await fs_utils.file_must_exist(cli_bucket_path);
                if (account_name === 'account4') {
                    await fs.promises.chmod(cli_bucket_path, 770);
                    await fs.promises.chown(cli_bucket_path, uid, gid);
                }
                const obj_nsr = { resource: dummy_nsr, path: bucket };
                const create_bucket_options = {
                    name: bucket,
                    namespace: {
                        read_resources: [obj_nsr],
                        write_resource: obj_nsr
                    }
                };
                if (process.env.NC_CORETEST) create_bucket_options.owner = account_name;
                await rpc_client.bucket.create_bucket(create_bucket_options);
            } else {
                const res = await s3_client.createBucket({ Bucket: bucket });
                console.log('created bucket via s3', account_name, bucket, res);
            }
        }
    });

    mocha.after(async function() {
        this.timeout(60000); // eslint-disable-line no-invalid-this
        if (!process.env.NC_CORETEST) return;
        for (const account_name of Object.keys(accounts)) {
            const { bucket } = accounts[account_name];
            await rpc_client.bucket.delete_bucket({ name: bucket });
            await rpc_client.account.delete_account({ email: `${account_name}@noobaa.com` });
        }
        await fs_utils.folder_delete(tmp_fs_root);
    });

    mocha.it('list buckets - each account can list only its own bucket - no bucket policies applied ', async function() {
        for (const account of Object.values(accounts)) {
            const { s3_client } = account;
            const res = await s3_client.listBuckets({});
            const buckets = res.Buckets.map(bucket => bucket.Name).sort();
            assert.equal(buckets.length, 2);
            assert.deepStrictEqual(buckets, [account.bucket, 'first.bucket']);
        }
    });

    mocha.it('account1 - all accounts are allowed to list bucket1', async function() {
        // allow all accounts to list bucket1
        const public_bucket = accounts.account1.bucket;
        const bucket_policy = test_utils.generate_s3_policy('*', public_bucket, ['s3:ListBucket']);
        await rpc_client.bucket.put_bucket_policy({
            name: public_bucket,
            policy: bucket_policy.policy,
        });
        // check account2 and account3 can list bucket1
        // account2/account3 should be able to list -
        // 1. first.bucket
        // 2. buckets owned by the account (account2 can list bucket2 / account3 can list bucket3)
        // 3. bucket1 (by the given bucket policy)
        // account4 can not list bucket1 because of missing fs access permissions (unmatching uid/gid)
        // account4 can list -
        // 1. first.bucket
        // 2. bucket4 - owned by the account
        for (const account_name of ['account2', 'account3', 'account4']) {
            const account = accounts[account_name];
            const { s3_client, bucket } = account;
            const res = await s3_client.listBuckets({});
            const buckets = res.Buckets.map(bucket_info => bucket_info.Name).sort();
            if (account_name === 'account4') {
                assert.equal(buckets.length, 2);
                assert.deepStrictEqual(buckets, [bucket, 'first.bucket']);
            } else {
                assert.equal(buckets.length, 3);
                assert.deepStrictEqual(buckets, [accounts.account1.bucket, bucket, 'first.bucket']);
            }
        }

        // delete bucket policy
        await rpc_client.bucket.put_bucket_policy({
            name: public_bucket,
            policy: '',
        });
    });

    mocha.it('account2 - set allow only account1 list bucket2, account1/account2 can list bucket2 but account3 cant', async function() {
        const bucket2 = accounts.account2.bucket;
        const account_name = 'account1';
        // on NC the account identifier is account name, and on containerized it's the account's email
        // allow bucket2 to be listed by account1
        const account1_principal = process.env.NC_CORETEST ? account_name : `${account_name}@noobaa.com`;
        const bucket_policy = test_utils.generate_s3_policy(account1_principal, bucket2, ['s3:ListBucket']);
        await rpc_client.bucket.put_bucket_policy({
            name: bucket2,
            policy: bucket_policy.policy,
        });

        // account1 can list -
        // 1. bucket1
        // 2. bucket2 (due to the policy)
        // 3. first.bucket
        let s3_client = accounts.account1.s3_client;
        let res = await s3_client.listBuckets({});
        let buckets = res.Buckets.map(bucket => bucket.Name).sort();
        assert.equal(buckets.length, 3);
        assert.deepStrictEqual(buckets, [accounts.account1.bucket, accounts.account2.bucket, 'first.bucket']);

        // account3 can list -
        // 1. bucket3
        // 2. first.bucket
        s3_client = accounts.account3.s3_client;
        res = await s3_client.listBuckets({});
        buckets = res.Buckets.map(bucket => bucket.Name).sort();
        assert.equal(buckets.length, 2);
        assert.deepStrictEqual(buckets, [accounts.account3.bucket, 'first.bucket']);

        // delete bucket policy
        await rpc_client.bucket.put_bucket_policy({
            name: bucket2,
            policy: '',
        });
    });
});

function get_tmp_path_by_os(_path) {
    return process.platform === MAC_PLATFORM ? '/private/' + _path : _path;
}

function generate_s3_client(access_key, secret_key) {
    return new S3({
        forcePathStyle: true,
        region: config.DEFAULT_REGION,
        requestHandler: new NodeHttpHandler({
            httpAgent: new http.Agent({ keepAlive: false })
        }),
        credentials: {
            accessKeyId: access_key,
            secretAccessKey: secret_key,
        },
        endpoint: coretest.get_http_address()
    });
}

async function generate_nsfs_account(options = {}) {
    const { uid, gid, new_buckets_path, nsfs_only, admin, default_resource, account_name } = options;
    if (admin) {
        const account = await rpc_client.account.read_account({
            email: EMAIL,
        });
        return {
            access_key: account.access_keys[0].access_key.unwrap(),
            secret_key: account.access_keys[0].secret_key.unwrap()
        };
    }
    const random_name = account_name || (Math.random() + 1).toString(36).substring(7);
    const nsfs_account_config = {
        uid: uid || process.getuid(),
        gid: gid || process.getgid(),
        new_buckets_path: new_buckets_path || '/',
        nsfs_only: nsfs_only || false
    };

    const account = await rpc_client.account.create_account({
        has_login: false,
        s3_access: true,
        email: `${random_name}@noobaa.com`,
        name: random_name,
        nsfs_account_config,
        default_resource
    });
    return {
        access_key: account.access_keys[0].access_key.unwrap(),
        secret_key: account.access_keys[0].secret_key.unwrap(),
        email: `${random_name}@noobaa.com`
    };
}

async function put_and_delete_objects(s3_account, bucket, key, body, should_fail) {
    try {
        await s3_account.putObject({
            Bucket: bucket,
            Key: key,
            Body: body
        });
        if (should_fail) {
            assert.fail(`put_object - action should fail but it didn't`);
        }
    } catch (err) {
        if (should_fail) {
            assert.ok(err.Code === 'AccessDenied');
            return;
        }
        assert.fail(`put_object failed ${err}, ${err.stack}`);
    }

    await s3_account.deleteObject({
        Bucket: bucket,
        Key: key,
    });
}

function create_random_body() {
    return Math.random().toString(36).slice(50);
}

function bucket_in_list(exist_buckets, not_exist_buckets, s3_buckets_list_response) {
    const bucket_names = s3_buckets_list_response.map(bucket => bucket.Name);
    const exist_checker = exist_buckets.every(v => bucket_names.includes(v));
    const doesnt_exist_checker = not_exist_buckets.every(v => !bucket_names.includes(v));
    return exist_checker && doesnt_exist_checker;
}

function object_in_list(res, key) {
    if (res.Contents) {
        const ans = res.Contents.find(obj => obj.Key === key);
        if (ans) return true;
    }
    return false;
}

async function update_account_nsfs_config(email, default_resource, new_nsfs_account_config, should_fail, error_code) {
    try {
        await rpc_client.account.update_account_s3_access({
            email,
            s3_access: true,
            default_resource,
            nsfs_account_config: new_nsfs_account_config
        });
        if (should_fail) {
            assert.fail(`update_account_nsfs_config - action should fail but it didn't`);
        }
    } catch (err) {
        if (should_fail) {
            if (process.env.NC_CORETEST) {
                assert.equal(JSON.parse(err.stdout).error.code, error_code);
            } else {
                assert.equal(err.rpc_code, error_code || 'FORBIDDEN');
            }
            return;
        }
        assert.fail(`update_account_nsfs_config failed ${err}, ${err.stack}`);
    }
}
