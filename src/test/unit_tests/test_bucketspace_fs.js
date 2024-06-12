/* Copyright (C) 2016 NooBaa */
/*eslint max-lines-per-function: ["error", 600]*/
'use strict';

const fs = require('fs');
const os = require('os');
const _ = require('lodash');
const path = require('path');
const mocha = require('mocha');
const assert = require('assert');
const P = require('../../util/promise');
const config = require('../../../config');
const fs_utils = require('../../util/fs_utils');
const { get_process_fs_context, read_file, get_user_by_distinguished_name, get_bucket_tmpdir_name,
    update_config_file } = require('../../util/native_fs_utils');
const nb_native = require('../../util/nb_native');
const SensitiveString = require('../../util/sensitive_string');
const NamespaceFS = require('../../sdk/namespace_fs');
const BucketSpaceFS = require('../../sdk/bucketspace_fs');
const { TMP_PATH } = require('../system_tests/test_utils');
const { CONFIG_SUBDIRS } = require('../../manage_nsfs/manage_nsfs_constants');
const nc_mkm = require('../../manage_nsfs/nc_master_key_manager').get_instance();


const test_bucket = 'bucket1';
const test_bucket2 = 'bucket2';
const test_not_empty_bucket = 'notemptybucket';
const test_bucket_temp_dir = 'buckettempdir';
const test_bucket_invalid = 'bucket_invalid';
const test_bucket_iam_account = 'bucket-iam-account-can-access';

const tmp_fs_path = path.join(TMP_PATH, 'test_bucketspace_fs');
const config_root = path.join(tmp_fs_path, 'config_root');
const new_buckets_path = path.join(tmp_fs_path, 'new_buckets_path', '/');
const new_buckets_path_user1 = path.join(tmp_fs_path, 'new_buckets_path_user1', '/');
const new_buckets_path_user2 = path.join(tmp_fs_path, 'new_buckets_path_user2', '/');

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

const process_fs_context = get_process_fs_context();

// since the account in NS NSFS should be valid to the nsfs_account_schema
// had to remove additional properties: has_s3_access: 'true' and nsfs_only: 'true'
const account_user1 = {
    _id: '65a8edc9bc5d5bbf9db71b91',
    name: 'user1',
    email: 'user1@noobaa.io',
    allow_bucket_creation: true,
    access_keys: [{
        access_key: 'a-abcdefghijklmn123456',
        secret_key: 's-abcdefghijklmn123456'
    }],
    nsfs_account_config: {
        uid: 0,
        gid: 0,
        new_buckets_path: new_buckets_path_user1,
    },
    creation_date: '2023-10-30T04:46:33.815Z',
};

const account_user2 = {
    _id: '65a8edc9bc5d5bbf9db71b92',
    name: 'user2',
    email: 'user2@noobaa.io',
    allow_bucket_creation: true,
    access_keys: [{
        access_key: 'a-abcdefghijklmn123457',
        secret_key: 's-abcdefghijklmn123457'
    }],
    nsfs_account_config: {
        distinguished_name: "root",
        new_buckets_path: new_buckets_path_user2,
    },
    creation_date: '2023-10-30T04:46:33.815Z',
};

const account_user3 = {
    _id: '65a8edc9bc5d5bbf9db71b93',
    name: 'user3',
    email: 'user3@noobaa.io',
    allow_bucket_creation: true,
    access_keys: [{
        access_key: 'a-abcdefghijklmn123458',
        secret_key: 's-abcdefghijklmn123458'
    }],
    nsfs_account_config: {
        distinguished_name: os.userInfo().username,
        new_buckets_path: new_buckets_path_user2,
    },
    creation_date: '2023-10-30T04:46:33.815Z',
};

const bucketspace_fs = new BucketSpaceFS({ config_root }, undefined);
const dummy_object_sdk = make_dummy_object_sdk();
const dummy_ns = {
    read_resources: [
      {
        resource: {
            fs_root_path: '',
        }
      },
    ],
    write_resource: {
        resource: {
            fs_root_path: '',
        },
      },
      should_create_underlying_storage: true
};
function make_dummy_object_sdk() {
    return {
        requesting_account: {
            _id: '65a8edc9bc5d5bbf9db71b92',
            force_md5_etag: false,
            name: new SensitiveString('user2'),
            email: new SensitiveString('user2@noobaa.io'),
            allow_bucket_creation: true,
            nsfs_account_config: {
                uid: 0,
                gid: 0,
                new_buckets_path: new_buckets_path,
            }
        },
        abort_controller: new AbortController(),
        throw_if_aborted() {
            if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
        },
        read_bucket_sdk_namespace_info(name) {
            dummy_ns.write_resource.path = path.join(new_buckets_path, name.toString());
            dummy_ns.read_resources[0].resource.name = name.toString();
            if (name === test_bucket_temp_dir) {
                dummy_ns.should_create_underlying_storage = false;
            } else {
                dummy_ns.should_create_underlying_storage = true;
            }
            return dummy_ns;
        },
        _get_bucket_namespace(name) {
            const buck_path = path.join(new_buckets_path, name);
            const dummy_nsfs = new NamespaceFS({
                bucket_path: buck_path,
                bucket_id: '1',
                namespace_resource_id: undefined,
                access_mode: undefined,
                versioning: undefined,
                force_md5_etag: undefined,
                stats: undefined
            });
            return dummy_nsfs;
        },
        is_nsfs_bucket(ns) {
            const fs_root_path = ns?.write_resource?.resource?.fs_root_path;
            return Boolean(fs_root_path || fs_root_path === '');
        },
        read_bucket_sdk_config_info(name) {
            return bucketspace_fs.read_bucket_sdk_info({ name });
        },
        async read_bucket_sdk_policy_info(name) {
            const bucket_info = await bucketspace_fs.read_bucket_sdk_info({ name });
            return { s3_policy: bucket_info.s3_policy };
        },
        async read_bucket_full_info(name) {
            const buck_path = path.join(new_buckets_path, name);
            const bucket = (await bucketspace_fs.read_bucket_sdk_info({ name }));
            if (name === test_bucket_temp_dir) {
                bucket.namespace.should_create_underlying_storage = false;
            } else {
                bucket.namespace.should_create_underlying_storage = true;
            }
            return {
                ns: new NamespaceFS({
                    bucket_path: buck_path,
                    bucket_id: '1',
                    namespace_resource_id: undefined,
                    access_mode: undefined,
                    versioning: undefined,
                    force_md5_etag: undefined,
                    stats: undefined
                }),
                bucket
            };
        }
    };
}

// account_user2 (copied from the dummy sdk)
// is the root account of account_iam_user1
const account_iam_user1 = {
    _id: '65a8edc9bc5d5bbf9db71b94',
    name: 'iam_user_1',
    email: 'iam_user_1@noobaa.io',
    owner: dummy_object_sdk.requesting_account._id,
    allow_bucket_creation: dummy_object_sdk.requesting_account.allow_bucket_creation,
    access_keys: [{
        access_key: 'a-abcdefghijklmn123459',
        secret_key: 's-abcdefghijklmn123459Example'
    }],
    nsfs_account_config: {
        uid: dummy_object_sdk.requesting_account.nsfs_account_config.uid,
        gid: dummy_object_sdk.requesting_account.nsfs_account_config.gid,
        new_buckets_path: dummy_object_sdk.requesting_account.nsfs_account_config.new_buckets_path
    },
    creation_date: '2023-11-30T04:46:33.815Z',
};

// account_user2 (copied from the dummy sdk)
// is the root account of account_iam_user2
const account_iam_user2 = {
    _id: '65a8edc9bc5d5bbf9db71b95',
    name: 'iam_user_2',
    email: 'iam_user_2@noobaa.io',
    owner: dummy_object_sdk.requesting_account._id,
    allow_bucket_creation: dummy_object_sdk.requesting_account.allow_bucket_creation,
    access_keys: [{
        access_key: 'a-abcdefghijklmn123460',
        secret_key: 's-abcdefghijklmn123460Example'
    }],
    nsfs_account_config: {
        uid: dummy_object_sdk.requesting_account.nsfs_account_config.uid,
        gid: dummy_object_sdk.requesting_account.nsfs_account_config.gid,
        new_buckets_path: dummy_object_sdk.requesting_account.nsfs_account_config.new_buckets_path
    },
    creation_date: '2023-12-30T04:46:33.815Z',
};

function make_dummy_object_sdk_for_account(dummy_object_sdk_to_copy, account) {
    const dummy_object_sdk_for_account = _.cloneDeep(dummy_object_sdk_to_copy);
    dummy_object_sdk_for_account.requesting_account = account;
    dummy_object_sdk_for_account.requesting_account.name = new SensitiveString(
        dummy_object_sdk_for_account.requesting_account.name);
    dummy_object_sdk_for_account.requesting_account.email = new SensitiveString(
            dummy_object_sdk_for_account.requesting_account.email);
    return dummy_object_sdk_for_account;
}

function make_invalid_dummy_object_sdk() {
    return {
        requesting_account: {
            force_md5_etag: false,
            email: 'user2@noobaa.io',
            allow_bucket_creation: false,
            nsfs_account_config: {
                uid: 0,
                gid: 0,
                new_buckets_path: new_buckets_path,
            }
        },
    };
}

mocha.describe('bucketspace_fs', function() {
    const dummy_data = {
        test: 'test',
    };

    mocha.before(async () => {
        await P.all(_.map([CONFIG_SUBDIRS.ACCOUNTS, CONFIG_SUBDIRS.ACCESS_KEYS, CONFIG_SUBDIRS.BUCKETS, CONFIG_SUBDIRS.ROOT_ACCOUNTS],
            async dir =>
            await fs_utils.create_fresh_path(`${config_root}/${dir}`))
        );
        await fs_utils.create_fresh_path(new_buckets_path);
        for (let account of [account_user1, account_user2, account_user3, account_iam_user1, account_iam_user2]) {
            account = await nc_mkm.encrypt_access_keys(account);
            const account_path = get_config_file_path(CONFIG_SUBDIRS.ACCOUNTS, account._id);
            const account_access_path = get_symlink_path(CONFIG_SUBDIRS.ACCESS_KEYS, account.access_keys[0].access_key);
            const root_account_dir = path.join(CONFIG_SUBDIRS.ROOT_ACCOUNTS, account.name);
            await fs_utils.create_fresh_path(path.join(config_root, root_account_dir));
            const root_account_path = get_symlink_path(root_account_dir, account.name);
            await fs.promises.writeFile(account_path, JSON.stringify(account));
            await fs.promises.symlink(account_path, account_access_path);
            await fs.promises.symlink(account_path, root_account_path);
        }
    });
    mocha.after(async () => {
        fs_utils.folder_delete(`${config_root}`);
        fs_utils.folder_delete(`${new_buckets_path}`);
    });


    mocha.describe('read_account_by_access_key', function() {
        mocha.it('read account by valid access key', async function() {
            const access_key = account_user1.access_keys[0].access_key.toString();
            const res = await bucketspace_fs.read_account_by_access_key({ access_key });
            assert.strictEqual(res.email.unwrap(), account_user1.email);
            assert.strictEqual(res.access_keys[0].access_key.unwrap(), account_user1.access_keys[0].access_key);
        });

        mocha.it('check uid/gid from distinguished name (root)', async function() {
            const access_key = account_user2.access_keys[0].access_key.toString();
            const res = await bucketspace_fs.read_account_by_access_key({ access_key });
            assert.strictEqual(res.email.unwrap(), account_user2.email);
            assert.strictEqual(res.access_keys[0].access_key.unwrap(), account_user2.access_keys[0].access_key);
            const distinguished_name = res.nsfs_account_config.distinguished_name.unwrap();
            assert.strictEqual(distinguished_name, 'root');
            const res2 = await get_user_by_distinguished_name({ distinguished_name });
            assert.strictEqual(res2.uid, 0);
        });

        mocha.it('check uid/gid from distinguished name (none root)', async function() {
            const access_key = account_user3.access_keys[0].access_key.toString();
            const res = await bucketspace_fs.read_account_by_access_key({ access_key });
            assert.strictEqual(res.email.unwrap(), account_user3.email);
            assert.strictEqual(res.access_keys[0].access_key.unwrap(), account_user3.access_keys[0].access_key);
            const distinguished_name = res.nsfs_account_config.distinguished_name.unwrap();
            assert.strictEqual(distinguished_name, os.userInfo().username);
            const res2 = await get_user_by_distinguished_name({ distinguished_name });
            assert.strictEqual(res2.uid, process.getuid());
        });


        mocha.it('read account by invalid access key', async function() {
            try {
                const access_key = account_user1.access_keys[0].access_key.toString() + 'invalid';
                await bucketspace_fs.read_account_by_access_key({ access_key });
            } catch (err) {
                assert.ok(err.rpc_code === 'NO_SUCH_ACCOUNT');
            }
        });
    });

    mocha.describe('create_bucket', function() {
        mocha.it('create bucket and validate bucket folder and schema config', async function() {
            const param = { name: test_bucket};
            await bucketspace_fs.create_bucket(param, dummy_object_sdk);
            const bucket_config_path = get_config_file_path(CONFIG_SUBDIRS.BUCKETS, param.name);
            const stat1 = await fs.promises.stat(bucket_config_path);
            assert.equal(stat1.nlink, 1);
            const objects = await nb_native().fs.readdir(ACCOUNT_FS_CONFIG, new_buckets_path);
            assert.equal(objects.length, 1);
            assert.ok(objects[0].name.startsWith(param.name));
        });
        mocha.it('validate bucket access with default context', async function() {
            try {
                const param = { name: test_bucket};
                const invalid_objects = await nb_native().fs.readdir(DEFAULT_FS_CONFIG, path.join(new_buckets_path, param.name));
                assert.equal(invalid_objects.length, 0);
            } catch (err) {
                assert.ok(err.code === 'EACCES');
                assert.ok(err.message === 'Permission denied');
            }
        });
        mocha.it('validate bucket access with account specific context', async function() {
            const param = { name: test_bucket};
            await await nb_native().fs.writeFile(ACCOUNT_FS_CONFIG, path.join(new_buckets_path, param.name, 'dummy_data.json'),
            Buffer.from(JSON.stringify(dummy_data)), {
                mode: config.BASE_MODE_FILE,
            });
            const objects = await nb_native().fs.readdir(ACCOUNT_FS_CONFIG, path.join(new_buckets_path, param.name));
            assert.equal(objects.length, 1);
        });
        mocha.it('validate bucket access with user not allowed to create bucket', async function() {
            try {
                const test_bucket_not_allowed = 'bucket4';
                const param = { name: test_bucket_not_allowed};
                const local_object_sdk = make_invalid_dummy_object_sdk();
                await bucketspace_fs.create_bucket(param, local_object_sdk);
                assert.fail('should have failed with UNAUTHORIZED bucket creation');
            } catch (err) {
                assert.ok(err.rpc_code === 'UNAUTHORIZED');
            }
        });
        mocha.it('should fail - create bucket by iam account', async function() {
            // currently we do not allow IAM accounts to create buckets
            try {
                const param = { name: test_bucket_iam_account};
                const dummy_object_sdk_for_iam_account = make_dummy_object_sdk_for_account(dummy_object_sdk, account_iam_user1);
                await bucketspace_fs.create_bucket(param, dummy_object_sdk_for_iam_account);
                assert.fail('should have failed with UNAUTHORIZED bucket creation');
            } catch (err) {
                assert.ok(err.rpc_code === 'UNAUTHORIZED');
            }
        });
        mocha.after(async function() {
            await fs_utils.folder_delete(`${new_buckets_path}/${test_bucket}`);
            await fs_utils.folder_delete(`${new_buckets_path}/${test_bucket_iam_account}`);
            let file_path = get_config_file_path(CONFIG_SUBDIRS.BUCKETS, test_bucket);
            await fs_utils.file_delete(file_path);
            file_path = get_config_file_path(CONFIG_SUBDIRS.BUCKETS, test_bucket_iam_account);
            await fs_utils.file_delete(file_path);
        });
    });

    mocha.describe('list_buckets', async function() {
        mocha.before(async function() {
            await create_bucket(test_bucket);
        });
        mocha.it('list buckets', async function() {
            const objects = await bucketspace_fs.list_buckets(dummy_object_sdk);
            assert.equal(objects.buckets.length, 1);
            assert.equal(objects.buckets[0].name.unwrap(), 'bucket1');
        });
        mocha.it('list buckets - only for bucket with config', async function() {
            await fs_utils.create_path(`${new_buckets_path}/${test_bucket_invalid}`);
            const objects = await bucketspace_fs.list_buckets(dummy_object_sdk);
            assert.equal(objects.buckets.length, 1);
        });
        mocha.it('list buckets - iam accounts', async function() {
            // root account created a bucket

            // account_iam_user2 can list the created bucket (the implicit policy - same root account)
            const dummy_object_sdk_for_iam_account = make_dummy_object_sdk_for_account(dummy_object_sdk, account_iam_user1);
            const res = await bucketspace_fs.list_buckets(dummy_object_sdk_for_iam_account);
            assert.equal(res.buckets.length, 1);

            // account_iam_user2 can list the created bucket (the implicit policy - same root account)
            const dummy_object_sdk_for_iam_account2 = make_dummy_object_sdk_for_account(dummy_object_sdk, account_iam_user2);
            const res2 = await bucketspace_fs.list_buckets(dummy_object_sdk_for_iam_account2);
            assert.equal(res2.buckets.length, 1);
        });
        mocha.after(async function() {
            await fs_utils.folder_delete(`${new_buckets_path}/${test_bucket}`);
            const file_path = get_config_file_path(CONFIG_SUBDIRS.BUCKETS, test_bucket);
            await fs_utils.file_delete(file_path);
        });
        mocha.it('list buckets - validate creation_date', async function() {
            const expected_bucket_name = 'bucket1';
            const objects = await bucketspace_fs.list_buckets(dummy_object_sdk);
            assert.equal(objects.buckets.length, 1);
            assert.equal(objects.buckets[0].name.unwrap(), expected_bucket_name);
            const bucket_config_path = get_config_file_path(CONFIG_SUBDIRS.BUCKETS, expected_bucket_name);
            const bucket_data = await read_file(process_fs_context, bucket_config_path);
            assert.equal(objects.buckets[0].creation_date, bucket_data.creation_date);
        });
    });
    mocha.describe('delete_bucket', function() {
        mocha.before(async function() {
            await create_bucket(test_bucket);
            await fs_utils.file_must_exist(path.join(new_buckets_path, test_bucket));

        });
        mocha.it('delete_bucket with valid bucket name ', async function() {
            const param = { name: test_bucket };
            await bucketspace_fs.delete_bucket(param, dummy_object_sdk);
            const objects = await bucketspace_fs.list_buckets(dummy_object_sdk);
            assert.equal(objects.buckets.length, 0);
        });
        mocha.it('delete_bucket with invalid bucket name ', async function() {
            try {
                const param = { name: test_bucket_invalid};
                await bucketspace_fs.delete_bucket(param, dummy_object_sdk);
            } catch (err) {
                assert.ok(err.code === 'ENOENT');
            }
        });
        mocha.it('delete_bucket for non empty buckets', async function() {
            const param = { name: test_not_empty_bucket};
            await create_bucket(param.name);
            const bucket_file_path = path.join(new_buckets_path, param.name, 'dummy.txt');
            await nb_native().fs.writeFile(ACCOUNT_FS_CONFIG, bucket_file_path,
                Buffer.from(JSON.stringify("data")), {
                    mode: config.BASE_MODE_FILE,
                });
            try {
                await bucketspace_fs.delete_bucket(param, dummy_object_sdk);
                assert.fail('should have failed with NOT EMPTY');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'NOT_EMPTY');
                assert.equal(err.message, 'underlying directory has files in it');
            }
        });

        mocha.it('delete_bucket for should_create_underlying_storage false', async function() {
            const param = { name: test_bucket_temp_dir };
            await create_bucket(param.name);
            await fs.promises.stat(path.join(new_buckets_path, param.name));
            const bucket_config_path = get_config_file_path(CONFIG_SUBDIRS.BUCKETS, param.name);
            const data = await fs.promises.readFile(bucket_config_path);
            const bucket = await JSON.parse(data.toString());
            const bucket_temp_dir_path = path.join(new_buckets_path, param.name, get_bucket_tmpdir_name(bucket._id));
            await nb_native().fs.mkdir(ACCOUNT_FS_CONFIG, bucket_temp_dir_path);
            await fs.promises.stat(bucket_temp_dir_path);
            await bucketspace_fs.delete_bucket(param, dummy_object_sdk);
            try {
                await fs.promises.stat(bucket_temp_dir_path);
                assert.fail('stat should have failed with ENOENT');
            } catch (err) {
                assert.strictEqual(err.code, 'ENOENT');
                assert.match(err.message, /.noobaa-nsfs_/);
            }
            try {
                await fs.promises.stat(bucket_config_path);
                assert.fail('stat should have failed with ENOENT');
            } catch (err) {
                assert.strictEqual(err.code, 'ENOENT');
                const path_for_err_msg = path.join(TMP_PATH, 'test_bucketspace_fs/config_root/buckets/buckettempdir.json');
                assert.equal(err.message, `ENOENT: no such file or directory, stat '${path_for_err_msg}'`);
            }
            await fs.promises.stat(path.join(new_buckets_path, param.name));
        });

        mocha.it('delete buckets - iam accounts (another IAM account deletes the bucket)', async function() {
            // root account created the bucket
            await create_bucket(test_bucket_iam_account);

            // account_iam_user1 can see the bucket in the list
            const dummy_object_sdk_for_account_iam_user1 = make_dummy_object_sdk_for_account(dummy_object_sdk, account_iam_user1);
            const res = await bucketspace_fs.list_buckets(dummy_object_sdk_for_account_iam_user1);
            assert.ok(res.buckets.length > 0);
            assert.ok(res.buckets.some(bucket => bucket.name.unwrap() === test_bucket_iam_account));

            const param = { name: test_bucket_iam_account};
            // account_iam_user2 can delete the created bucket (the implicit policy - same root account)
            const dummy_object_sdk_for_account_iam_user2 = make_dummy_object_sdk_for_account(dummy_object_sdk, account_iam_user2);
            await bucketspace_fs.delete_bucket(param, dummy_object_sdk_for_account_iam_user2);
        });

        mocha.it('delete_bucket after the ULS was deleted (should_create_underlying_storage true)', async function() {
            const param = { name: test_bucket2 };
            await create_bucket(param.name);

            // this is not a case that we want, but it might happen: if somehow the ULS (Underline Storage) was deleted
            const uls_path = path.join(new_buckets_path, param.name);
            await fs.promises.stat(uls_path);
            await fs.promises.rm(uls_path, { recursive: true }); // somehow the ULS is deleted

            await bucketspace_fs.delete_bucket(param, dummy_object_sdk);
            const bucket_config_path = get_config_file_path(CONFIG_SUBDIRS.BUCKETS, param.name);
            await fs_utils.file_must_not_exist(bucket_config_path);
        });

        mocha.it('delete_bucket after the ULS was deleted (should_create_underlying_storage false)', async function() {
            const param = { name: test_bucket2 };
            await create_bucket(param.name);

            // we want to mock a bucket creation using the CLI,
            // we manually change the should_create_underlying_storage to false
            const bucket_config_path = get_config_file_path(CONFIG_SUBDIRS.BUCKETS, param.name);
            const data = await fs.promises.readFile(bucket_config_path);
            const bucket = await JSON.parse(data.toString());
            assert.ok(bucket.should_create_underlying_storage === true);
            bucket.should_create_underlying_storage = false;
            await update_config_file(process_fs_context, CONFIG_SUBDIRS.BUCKETS, bucket_config_path, JSON.stringify(bucket));
            await fs_utils.file_must_exist(bucket_config_path);

            // this is not a case that we want, but it might happen: if somehow the ULS (Underline Storage) was deleted
            const uls_path = path.join(new_buckets_path, param.name);
            await fs.promises.stat(uls_path);
            await fs.promises.rm(uls_path, { recursive: true }); // somehow the ULS is deleted

            await bucketspace_fs.delete_bucket(param, dummy_object_sdk);
            await fs_utils.file_must_not_exist(bucket_config_path);
        });
    });
    mocha.describe('set_bucket_versioning', function() {
        mocha.before(async function() {
            await create_bucket(test_bucket);
        });
        mocha.it('set_bucket_versioning ', async function() {
            const param = {name: test_bucket, versioning: 'ENABLED'};
            await bucketspace_fs.set_bucket_versioning(param, dummy_object_sdk);
            const bucket_config_path = get_config_file_path(CONFIG_SUBDIRS.BUCKETS, param.name);
            const bucket = await read_file(process_fs_context, bucket_config_path);
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
            await bucketspace_fs.put_bucket_encryption(param);

            const output_encryption = await bucketspace_fs.get_bucket_encryption(param);
            assert.deepEqual(output_encryption, encryption);
        });
        mocha.it('delete_bucket_encryption ', async function() {
            const encryption = {
                algorithm: 'AES256',
                kms_key_id: 'kms-123'
            };
            const param = {name: test_bucket};
            const output_encryption = await bucketspace_fs.get_bucket_encryption(param);
            assert.deepEqual(output_encryption, encryption);
            await bucketspace_fs.delete_bucket_encryption(param);
            const empty_encryption = await bucketspace_fs.get_bucket_encryption(param);
            assert.ok(empty_encryption === undefined);
        });
    });

    mocha.describe('bucket website operations', function() {
        mocha.it('put_bucket_website ', async function() {
            const website = {
                website_configuration: {
                    redirect_all_requests_to: {
                        host_name: 's3.noobaa.io',
                        protocol: 'HTTPS',
                    }
                }
            };
            const param = {name: test_bucket, website: website};
            await bucketspace_fs.put_bucket_website(param);
            const output_web = await bucketspace_fs.get_bucket_website(param);
            assert.deepEqual(output_web.website, website);
        });
        mocha.it('delete_bucket_website ', async function() {
            const param = {name: test_bucket};
            await bucketspace_fs.delete_bucket_website(param);
            const output_web = await bucketspace_fs.get_bucket_website(param);
            assert.ok(output_web.website === undefined);
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
            const param = { name: test_bucket, policy: policy };
            await bucketspace_fs.put_bucket_policy(param);
            const policy_res = await bucketspace_fs.get_bucket_policy(param, dummy_object_sdk);
            assert.deepEqual(policy_res.policy, policy);
            const info_res = await bucketspace_fs.read_bucket_sdk_info(param);
            assert.deepEqual(info_res.s3_policy, policy);
        });

        mocha.it('delete_bucket_policy ', async function() {
            const param = {name: test_bucket};
            await bucketspace_fs.delete_bucket_policy(param);
            const delete_res = await bucketspace_fs.get_bucket_policy(param, dummy_object_sdk);
            assert.ok(delete_res.policy === undefined);
        });

        mocha.it('put_bucket_policy other account object', async function() {
            const policy = {
                    Version: '2012-10-17',
                    Statement: [{
                        Sid: 'id-22',
                        Effect: 'Allow',
                        Principal: { AWS: ['user1'] },
                        Action: ['s3:*'],
                        Resource: ['arn:aws:s3:::*']
                        }
                    ]
                };
            const param = { name: test_bucket, policy: policy };
            await bucketspace_fs.put_bucket_policy(param);
            const bucket_policy = await bucketspace_fs.get_bucket_policy(param, dummy_object_sdk);
            assert.deepEqual(bucket_policy.policy, policy);
            const info_res = await bucketspace_fs.read_bucket_sdk_info(param);
            assert.deepEqual(info_res.s3_policy, policy);
        });

        mocha.it('put_bucket_policy other account object - account does not exist', async function() {
            const policy = {
                    Version: '2012-10-17',
                    Statement: [{
                        Sid: 'id-22',
                        Effect: 'Allow',
                        Principal: { AWS: 'user10' },
                        Action: ['s3:*'],
                        Resource: ['arn:aws:s3:::*']
                        }
                    ]
                };
            const param = { name: test_bucket, policy: policy };
            try {
                await bucketspace_fs.put_bucket_policy(param);
                assert.fail('should have failed with invalid principal in policy');
            } catch (err) {
                assert.equal(err.rpc_code, 'MALFORMED_POLICY');
                assert.equal(err.message, 'Invalid principal in policy');
            }
        });

        mocha.it('put_bucket_policy other account array', async function() {
            const policy = {
                    Version: '2012-10-17',
                    Statement: [{
                        Sid: 'id-22',
                        Effect: 'Allow',
                        Principal: { AWS: ['user1', 'user2'] },
                        Action: ['s3:*'],
                        Resource: ['arn:aws:s3:::*']
                        }
                    ]
                };
            const param = {name: test_bucket, policy: policy};
            await bucketspace_fs.put_bucket_policy(param);
            const bucket_policy = await bucketspace_fs.get_bucket_policy(param, dummy_object_sdk);
            assert.deepEqual(bucket_policy.policy, policy);
            const info_res = await bucketspace_fs.read_bucket_sdk_info(param);
            assert.deepEqual(info_res.s3_policy, policy);
        });

        mocha.it('put_bucket_policy other account all', async function() {
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
            await bucketspace_fs.put_bucket_policy(param);
            const bucket_policy = await bucketspace_fs.get_bucket_policy(param, dummy_object_sdk);
            assert.deepEqual(bucket_policy.policy, policy);
            const info_res = await bucketspace_fs.read_bucket_sdk_info(param);
            assert.deepEqual(info_res.s3_policy, policy);
        });

        mocha.it('delete_bucket_policy ', async function() {
            const param = { name: test_bucket };
            await bucketspace_fs.delete_bucket_policy(param);
            const bucket_policy = await bucketspace_fs.get_bucket_policy(param, dummy_object_sdk);
            assert.ok(bucket_policy.policy === undefined);
        });
    });

    mocha.describe('bucket logging operations', function() {
        mocha.it('put_bucket_logging ', async function() {
            const logging = {
                log_bucket: test_bucket,
                log_prefix: 'test/'
            };
            const param = {name: test_bucket, logging: { ...logging} };
            await bucketspace_fs.put_bucket_logging(param);
            const output_log = await bucketspace_fs.get_bucket_logging(param);
            assert.deepEqual(output_log, logging);
        });
        mocha.it('delete_bucket_logging', async function() {
            const param = {name: test_bucket};
            await bucketspace_fs.delete_bucket_logging(param);
            const output_log = await bucketspace_fs.get_bucket_logging(param);
            assert.ok(output_log === undefined);
        });
    });
});

async function create_bucket(bucket_name) {
    const param = { name: bucket_name};
    await bucketspace_fs.create_bucket(param, dummy_object_sdk);
    const bucket_config_path = get_config_file_path(CONFIG_SUBDIRS.BUCKETS, param.name);
    const stat1 = await fs.promises.stat(bucket_config_path);
    assert.equal(stat1.nlink, 1);
}


function get_config_file_path(config_type_path, file_name) {
    return path.join(config_root, config_type_path, file_name + '.json');
}

// returns the path of the access_key symlink to the config file json
function get_symlink_path(config_type_path, file_name) {
    return path.join(config_root, config_type_path, file_name + '.symlink');
}

