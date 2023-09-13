/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const P = require('../../util/promise');
const config = require('../../../config');
const fs_utils = require('../../util/fs_utils');

const BucketSpaceMultiFS = require('../../sdk/bucketspace_multi_fs');
const NamespaceFS = require('../../sdk/namespace_fs');
const nb_native = require('../../util/nb_native');


const MAC_PLATFORM = 'darwin';
const test_bucket = 'bucket1';
const test_bucket_invalid = 'bucket_invalid';

const ACCOUNT_FS_CONFIG = {
    uid: 0,
    gid: 0,
    backend: '',
    warn_threshold_ms: 100,
};

const DEFAULT_FS_CONFIG = {
    uid: 100,
    gid: 100,
    backend: '',
    warn_threshold_ms: 100,
};

const account_user1 = {
    name: 'user1',
    email: 'user1@noobaa.io',
    has_s3_access: 'true',
    access_keys: [{
        access_key: 'a-abcdefghijklmn123456',
        secret_key: 's-abcdefghijklmn123456'
    }],
    nsfs_account_config: {
        uid: 0,
        gid: 0,
        new_buckets_path: '/',
        nsfs_only: 'true'
    }
};
let tmp_fs_path = '/tmp/test_multi_fs';
if (process.platform === MAC_PLATFORM) {
    tmp_fs_path = '/private/' + tmp_fs_path;
}
const fs_root = path.join(tmp_fs_path, 'fs_root');
const config_root = path.join(tmp_fs_path, 'config_root');
const buckets = 'buckets';
const accounts = 'accounts';
const bucket_multi_fs = new BucketSpaceMultiFS({ fs_root, config_root });
const dummy_object_sdk = make_dummy_object_sdk();
const dummy_ns = {
    read_resources: [
      {
        resource: {
            fs_root_path: fs_root,
        }
      },
    ],
    write_resource: {
        resource: {
            fs_root_path: fs_root,
        },
      },
      should_create_underlying_storage: true
};

function make_dummy_object_sdk() {
    return {
        requesting_account: {
            force_md5_etag: false,
            nsfs_account_config: {
                uid: 0,
                gid: 0,
                new_buckets_path: '/',
            }
        },
        abort_controller: new AbortController(),
        throw_if_aborted() {
            if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
        },
        read_bucket_sdk_namespace_info(name) {
            dummy_ns.write_resource.path = name.toString();
            dummy_ns.read_resources[0].resource.name = name.toString();
            return dummy_ns;
        },
        _get_bucket_namespace(name) {
            const buck_path = path.join(fs_root, name);
            const dummy_nsfs = new NamespaceFS({ bucket_path: buck_path, bucket_id: '1', namespace_resource_id: undefined });
            return dummy_nsfs;
        },
        is_nsfs_bucket(ns) {
            return Boolean(ns?.write_resource?.resource?.fs_root_path);
        }
    };
}

mocha.describe('bucketspace_multi_fs', function() {
    const dummy_data = {
        test: 'test',
    };

    mocha.before(async () => {
        await P.all(_.map([accounts, buckets], async dir =>
           fs_utils.create_fresh_path(`${config_root}/${dir}`)));

        await P.all(_.map([fs_root], async dir =>
            fs_utils.create_fresh_path(`${dir}`)));
        await fs.promises.writeFile(path.join(config_root, accounts,
            account_user1.access_keys[0].access_key + '.json'), JSON.stringify(account_user1));
    });
    mocha.after(async () => {
        fs_utils.folder_delete(`${config_root}`);
        fs_utils.folder_delete(`${fs_root}`);
    });


    mocha.describe('read_account_by_access_key', function() {
        mocha.it('read account by valid access key', async function() {
            const access_key = account_user1.access_keys[0].access_key.toString();
            const res = await bucket_multi_fs.read_account_by_access_key({ access_key });
            assert.strictEqual(res.email.unwrap(), account_user1.email);
            assert.strictEqual(res.access_keys[0].access_key.unwrap(), account_user1.access_keys[0].access_key);
        });

        mocha.it('read account by invalid access key', async function() {
            try {
                const access_key = account_user1.access_keys[0].access_key.toString() + 'invalid';
                await bucket_multi_fs.read_account_by_access_key({ access_key });
            } catch (err) {
                assert.ok(err.rpc_code === 'NO_SUCH_ACCOUNT');
            }
        });
    });

    mocha.describe('create_bucket', function() {
        mocha.it('creat bucket and validate bucket folder and schema config', async function() {
            const param = { name: test_bucket};
            await bucket_multi_fs.create_bucket(param, dummy_object_sdk);
            const bucket_config_path = path.join(config_root, buckets, param.name + '.json');
            const stat1 = await fs.promises.stat(bucket_config_path);
            assert.equal(stat1.nlink, 1);
            const objects = await nb_native().fs.readdir(ACCOUNT_FS_CONFIG, fs_root);
            assert.equal(objects.length, 1);
            assert.ok(objects[0].name.startsWith(param.name));
        });
        mocha.it('validate bucket access with default context', async function() {
            try {
            const param = { name: test_bucket};
            const invalid_objects = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, path.join(fs_root, param.name));
            assert.equal(invalid_objects.length, 0);
            } catch (err) {
                assert.ok(err.code === 'EACCES');
                assert.ok(err.message === 'Permission denied');
            }
        });
        mocha.it('validate bucket access with account specific context', async function() {
            const param = { name: test_bucket};
            await await nb_native().fs.writeFile(ACCOUNT_FS_CONFIG, path.join(fs_root, param.name, 'dummy_data.json'),
            Buffer.from(JSON.stringify(dummy_data)), {
                mode: config.BASE_MODE_FILE,
            });
            const objects = await nb_native().fs.readdir(ACCOUNT_FS_CONFIG, path.join(fs_root, param.name));
            assert.equal(objects.length, 1);
        });
        mocha.after(async function() {
            await P.all(_.map([fs_root], async dir =>
                await fs_utils.folder_delete(`${dir}/${test_bucket}`)));
            const file_path = path.join(config_root, buckets, test_bucket + '.json');
            await fs_utils.file_delete(file_path);
        });
    });

    mocha.describe('list_buckets', function() {
        mocha.before(async function() {
            await create_bucket(test_bucket);
        });
        mocha.it('list buckets', async function() {
            const objects = await bucket_multi_fs.list_buckets(dummy_object_sdk);
            assert.equal(objects.buckets.length, 1);
            assert.equal(objects.buckets[0].name.unwrap(), 'bucket1');
        });
        mocha.it('list buckets - only for bucket with config', async function() {
            await fs_utils.create_path(`${fs_root}/${test_bucket_invalid}`);
            const objects = await bucket_multi_fs.list_buckets(dummy_object_sdk);
            assert.equal(objects.buckets.length, 1);
        });
        mocha.after(async function() {
            await P.all(_.map([fs_root], async dir =>
                await fs_utils.folder_delete(`${dir}/${test_bucket}`)));
            const file_path = path.join(config_root, buckets, test_bucket + '.json');
            await fs_utils.file_delete(file_path);
        });
    });
    mocha.describe('delete_bucket', function() {
        mocha.before(async function() {
            create_bucket(test_bucket);
        });
        mocha.it('delete_bucket with valid bucket name ', async function() {
            const param = { name: test_bucket};
            await bucket_multi_fs.delete_bucket(param, dummy_object_sdk);
            const objects = await bucket_multi_fs.list_buckets(dummy_object_sdk);
            assert.equal(objects.buckets.length, 0);
        });
        mocha.it('delete_bucket with invalid bucket name ', async function() {
            try {
                const param = { name: test_bucket_invalid};
                await bucket_multi_fs.delete_bucket(param, dummy_object_sdk);
            } catch (err) {
                assert.ok(err.code === 'NoSuchBucket');
            }
        });
    });
    mocha.describe('set_bucket_versioning', function() {
        mocha.before(async function() {
            await create_bucket(test_bucket);
        });
        mocha.it('set_bucket_versioning ', async function() {
            const param = {name: test_bucket, versioning: 'ENABLED'};
            await bucket_multi_fs.set_bucket_versioning(param, dummy_object_sdk);
            const data = await fs.promises.readFile(path.join(config_root, buckets, param.name + '.json'));
            const bucket = JSON.parse(data.toString());
            assert.equal(bucket.versioning, 'ENABLED');

        });
    });

    mocha.describe('bucket encryption operations', function() {
        mocha.it('put_bucket_encryption ', async function() {
            const encryption = {
                algorithm: 'AES256',
                kms_key_id: 'kms-123'
            };
            const param = {name: test_bucket, encryption: encryption};
            await bucket_multi_fs.put_bucket_encryption(param);

            const output_encryption = await bucket_multi_fs.get_bucket_encryption(param);
            assert.deepEqual(output_encryption, encryption);
        });
        mocha.it('delete_bucket_encryption ', async function() {
            const encryption = {
                algorithm: 'AES256',
                kms_key_id: 'kms-123'
            };
            const param = {name: test_bucket};
            const output_encryption = await bucket_multi_fs.get_bucket_encryption(param);
            assert.deepEqual(output_encryption, encryption);
            await bucket_multi_fs.delete_bucket_encryption(param);
            const empty_encryption = await bucket_multi_fs.get_bucket_encryption(param);
            assert.ok(empty_encryption === undefined);
        });
    });

    mocha.describe('bucket website operations', function() {
        mocha.it('put_bucket_website ', async function() {
            const website = {
                website_configuration: [
                    {
                        redirect_all_requests_to: {
                            host_name: 's3.noobaa.io',
                            protocol: 'HTTPS',
                        }
                    }
                ]
            };
            const param = {name: test_bucket, website: website};
            await bucket_multi_fs.put_bucket_website(param);
            const output_web = await bucket_multi_fs.get_bucket_website(param);
            assert.deepEqual(output_web, website);
        });
        mocha.it('delete_bucket_website ', async function() {
            const param = {name: test_bucket};
            await bucket_multi_fs.delete_bucket_website(param);
            const output_web = await bucket_multi_fs.get_bucket_website(param);
            assert.ok(output_web === undefined);
        });
    });

    mocha.describe('bucket policy operations', function() {
        mocha.it('put_bucket_policy ', async function() {
            const policy = {
                    Version: '2012-10-17',
                    Statement: [{
                        Sid: 'id-22',
                        Effect: 'Allow',
                        Principal: '*',
                        Action: ['s3:*'],
                        Resource: ['arn:aws:s3:::*']
                        }
                    ]
                };
            const param = {name: test_bucket, policy: policy};
            await bucket_multi_fs.put_bucket_policy(param);
            const output_web = await bucket_multi_fs.get_bucket_policy(param);
            assert.deepEqual(output_web.policy, policy);
        });
        mocha.it('delete_bucket_policy ', async function() {
            const param = {name: test_bucket};
            await bucket_multi_fs.delete_bucket_policy(param);
            const output_web = await bucket_multi_fs.get_bucket_policy(param);
            assert.ok(output_web.policy === undefined);
        });
    });
});

async function create_bucket(bucket_name) {
    const param = { name: bucket_name};
    await bucket_multi_fs.create_bucket(param, dummy_object_sdk);
    const bucket_config_path = path.join(config_root, buckets, param.name + '.json');
    const stat1 = await fs.promises.stat(bucket_config_path);
    assert.equal(stat1.nlink, 1);
}
