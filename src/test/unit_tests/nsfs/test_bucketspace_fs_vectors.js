/* Copyright (C) 2025 NooBaa */
/*eslint max-lines-per-function: ['error', 800]*/
'use strict';

const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const { TMP_PATH } = require('../../system_tests/test_utils');

const tmp_fs_path = path.join(TMP_PATH, 'test_bucketspace_fs_vectors');
const config_root = path.join(tmp_fs_path, 'config_root');
const new_buckets_path = path.join(tmp_fs_path, 'new_buckets_path', '/');

// set master keys file location before requiring nc_mkm
const config = require('../../../../config');
config.NC_MASTER_KEYS_FILE_LOCATION = path.join(config_root, 'master_keys.json');

const P = require('../../../util/promise');
const fs_utils = require('../../../util/fs_utils');
const SensitiveString = require('../../../util/sensitive_string');
const BucketSpaceFS = require('../../../sdk/bucketspace_fs');
const { CONFIG_SUBDIRS } = require('../../../sdk/config_fs');
const nc_mkm = require('../../../manage_nsfs/nc_master_key_manager').get_instance();

let vector_utils;
let lance_available = false;
try {
    vector_utils = require('../../../util/vectors_util');
    lance_available = true;
} catch (err) {
    console.log('LanceDB native binding not available, skipping vector data tests');
}

const bucketspace_fs = new BucketSpaceFS({ config_root }, undefined);

const process_uid = process.getuid();
const process_gid = process.getgid();

const root_account = {
    _id: '65a8edc9bc5d5bbf9db71c01',
    name: 'vec_root_user',
    email: 'vec_root_user@noobaa.io',
    allow_bucket_creation: true,
    access_keys: [{
        access_key: 'a-vecroot123456789012',
        secret_key: 's-vecroot123456789012'
    }],
    nsfs_account_config: {
        uid: process_uid,
        gid: process_gid,
        new_buckets_path,
    },
    creation_date: '2025-01-01T00:00:00.000Z',
};

const iam_account = {
    _id: '65a8edc9bc5d5bbf9db71c02',
    name: 'vec_iam_user',
    email: 'vec_iam_user@noobaa.io',
    owner: root_account._id,
    allow_bucket_creation: true,
    access_keys: [{
        access_key: 'a-veciam1234567890123',
        secret_key: 's-veciam1234567890123'
    }],
    nsfs_account_config: {
        uid: process_uid,
        gid: process_gid,
        new_buckets_path,
    },
    creation_date: '2025-01-01T00:00:00.000Z',
};

const other_account = {
    _id: '65a8edc9bc5d5bbf9db71c03',
    name: 'vec_other_user',
    email: 'vec_other_user@noobaa.io',
    allow_bucket_creation: true,
    access_keys: [{
        access_key: 'a-vecother12345678901',
        secret_key: 's-vecother12345678901'
    }],
    nsfs_account_config: {
        uid: process_uid,
        gid: process_gid,
        new_buckets_path,
    },
    creation_date: '2025-01-01T00:00:00.000Z',
};

const no_create_account = {
    _id: '65a8edc9bc5d5bbf9db71c04',
    name: 'vec_nocreate_user',
    email: 'vec_nocreate_user@noobaa.io',
    allow_bucket_creation: false,
    access_keys: [{
        access_key: 'a-vecnocrt12345678901',
        secret_key: 's-vecnocrt12345678901'
    }],
    nsfs_account_config: {
        uid: process_uid,
        gid: process_gid,
        new_buckets_path,
    },
    creation_date: '2025-01-01T00:00:00.000Z',
};

function make_dummy_object_sdk(account) {
    return {
        requesting_account: {
            ...account,
            name: new SensitiveString(account.name),
            email: new SensitiveString(account.email),
        },
        abort_controller: new AbortController(),
        throw_if_aborted() {
            if (this.abort_controller.signal.aborted) throw new Error('request aborted signal');
        },
    };
}

mocha.describe('bucketspace_fs vectors', function() {
    this.timeout(30000); // eslint-disable-line no-invalid-this

    const root_sdk = make_dummy_object_sdk(root_account);
    const iam_sdk = make_dummy_object_sdk(iam_account);
    const other_sdk = make_dummy_object_sdk(other_account);
    const no_create_sdk = make_dummy_object_sdk(no_create_account);

    mocha.before(async () => {
        await P.all(_.map([
            CONFIG_SUBDIRS.IDENTITIES,
            CONFIG_SUBDIRS.ACCOUNTS_BY_NAME,
            CONFIG_SUBDIRS.ACCESS_KEYS,
            CONFIG_SUBDIRS.BUCKETS,
            CONFIG_SUBDIRS.VECTOR_BUCKETS,
            CONFIG_SUBDIRS.VECTOR_INDEXES,
        ], async dir =>
            fs_utils.create_fresh_path(`${config_root}/${dir}`)
        ));
        await fs_utils.create_fresh_path(new_buckets_path);
        for (let account of [root_account, iam_account, other_account, no_create_account]) {
            account = await nc_mkm.encrypt_access_keys(account);
            const account_dir_path = bucketspace_fs.config_fs.get_identity_dir_path_by_id(account._id);
            const account_path = bucketspace_fs.config_fs.get_identity_path_by_id(account._id);
            const account_name_path = bucketspace_fs.config_fs.get_account_path_by_name(account.name);
            const account_access_path = bucketspace_fs.config_fs.get_account_or_user_path_by_access_key(
                account.access_keys[0].access_key
            );
            await fs.promises.mkdir(account_dir_path);
            await fs.promises.writeFile(account_path, JSON.stringify(account));
            await fs.promises.symlink(account_path, account_name_path);
            await fs.promises.symlink(account_path, account_access_path);
        }
    });

    mocha.after(async () => {
        fs_utils.folder_delete(config_root);
        fs_utils.folder_delete(new_buckets_path);
    });

    //////////////////////////////
    // VECTOR BUCKETS           //
    //////////////////////////////

    mocha.describe('create_vector_bucket', function() {
        mocha.it('should create a vector bucket', async function() {
            await bucketspace_fs.create_vector_bucket({
                vector_bucket_name: 'testvb1',
                vector_db_type: 'lance',
            }, root_sdk);

            const vb = await bucketspace_fs.get_vector_bucket({ vector_bucket_name: 'testvb1' }, root_sdk);
            assert.strictEqual(vb.name.unwrap(), 'testvb1');
            assert.strictEqual(vb.vector_db_type, 'lance');
            assert.strictEqual(vb.owner_account.id, root_account._id);
            assert.ok(vb.path);
            assert.ok(vb.creation_time);
        });

        mocha.it('should fail to create duplicate vector bucket', async function() {
            try {
                await bucketspace_fs.create_vector_bucket({
                    vector_bucket_name: 'testvb1',
                    vector_db_type: 'lance',
                }, root_sdk);
                assert.fail('should have thrown');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'BUCKET_ALREADY_EXISTS');
            }
        });

        mocha.it('should fail when account not allowed to create buckets', async function() {
            try {
                await bucketspace_fs.create_vector_bucket({
                    vector_bucket_name: 'testvb-nocreate',
                    vector_db_type: 'lance',
                }, no_create_sdk);
                assert.fail('should have thrown');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'UNAUTHORIZED');
            }
        });

        mocha.it('should default vector_db_type to lance', async function() {
            await bucketspace_fs.create_vector_bucket({
                vector_bucket_name: 'testvb-default-type',
            }, root_sdk);
            const vb = await bucketspace_fs.get_vector_bucket({ vector_bucket_name: 'testvb-default-type' }, root_sdk);
            assert.strictEqual(vb.vector_db_type, 'lance');
            // cleanup
            await bucketspace_fs.delete_vector_bucket({ vector_bucket_name: 'testvb-default-type' }, root_sdk);
        });

        mocha.it('IAM user creates vector bucket owned by root account', async function() {
            await bucketspace_fs.create_vector_bucket({
                vector_bucket_name: 'testvb-iam',
                vector_db_type: 'lance',
            }, iam_sdk);
            const vb = await bucketspace_fs.get_vector_bucket({ vector_bucket_name: 'testvb-iam' }, iam_sdk);
            // owner should be the root account (iam_account.owner), not the IAM user itself
            assert.strictEqual(vb.owner_account.id, root_account._id);
        });
    });

    mocha.describe('get_vector_bucket', function() {
        mocha.it('should get an existing vector bucket', async function() {
            const vb = await bucketspace_fs.get_vector_bucket({ vector_bucket_name: 'testvb1' }, root_sdk);
            assert.strictEqual(vb.name.unwrap(), 'testvb1');
            assert.strictEqual(vb.vector_db_type, 'lance');
        });

        mocha.it('should fail to get nonexistent vector bucket', async function() {
            try {
                await bucketspace_fs.get_vector_bucket({ vector_bucket_name: 'nonexistent' }, root_sdk);
                assert.fail('should have thrown');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'NO_SUCH_BUCKET');
            }
        });
    });

    mocha.describe('list_vector_buckets', function() {
        mocha.before(async function() {
            // create a bucket owned by other_account
            await bucketspace_fs.create_vector_bucket({
                vector_bucket_name: 'testvb-other',
                vector_db_type: 'lance',
            }, other_sdk);
        });

        mocha.it('should list only owned vector buckets', async function() {
            const res = await bucketspace_fs.list_vector_buckets({ max_results: 100 }, root_sdk);
            const names = res.items.map(vb => vb.name.unwrap());
            assert.ok(names.includes('testvb1'));
            assert.ok(names.includes('testvb-iam'));
            // other_account's bucket should NOT appear
            assert.ok(!names.includes('testvb-other'));
        });

        mocha.it('IAM user should see root account buckets', async function() {
            const res = await bucketspace_fs.list_vector_buckets({ max_results: 100 }, iam_sdk);
            const names = res.items.map(vb => vb.name.unwrap());
            assert.ok(names.includes('testvb1'));
            assert.ok(names.includes('testvb-iam'));
        });

        mocha.it('should filter by prefix', async function() {
            const res = await bucketspace_fs.list_vector_buckets({
                max_results: 100,
                prefix: 'testvb-i'
            }, root_sdk);
            assert.strictEqual(res.items.length, 1);
            assert.strictEqual(res.items[0].name.unwrap(), 'testvb-iam');
        });

        mocha.it('should paginate with max_results and next_token', async function() {
            const res1 = await bucketspace_fs.list_vector_buckets({ max_results: 1 }, root_sdk);
            assert.strictEqual(res1.items.length, 1);
            assert.ok(res1.next_token);

            const res2 = await bucketspace_fs.list_vector_buckets({
                max_results: 100,
                next_token: res1.next_token
            }, root_sdk);
            assert.ok(res2.items.length >= 1);
            // no overlap
            assert.ok(!res2.items.some(vb => vb.name.unwrap() === res1.items[0].name.unwrap()));
        });

        mocha.it('should return empty items for account with no buckets', async function() {
            const lonely_sdk = make_dummy_object_sdk({
                _id: '65a8edc9bc5d5bbf9db71c99',
                name: 'lonely_user',
                email: 'lonely@noobaa.io',
                allow_bucket_creation: true,
                access_keys: [{ access_key: 'a-lonely12345678901234', secret_key: 's-lonely12345678901234' }],
                nsfs_account_config: { uid: 0, gid: 0, new_buckets_path },
            });
            const res = await bucketspace_fs.list_vector_buckets({ max_results: 100 }, lonely_sdk);
            assert.strictEqual(res.items.length, 0);
        });
    });

    mocha.describe('delete_vector_bucket', function() {
        mocha.it('should fail to delete nonexistent vector bucket', async function() {
            try {
                await bucketspace_fs.delete_vector_bucket({ vector_bucket_name: 'nonexistent' }, root_sdk);
                assert.fail('should have thrown');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'NO_SUCH_BUCKET');
            }
        });

        mocha.it('should delete an empty vector bucket', async function() {
            await bucketspace_fs.create_vector_bucket({
                vector_bucket_name: 'testvb-to-delete',
                vector_db_type: 'lance',
            }, root_sdk);

            await bucketspace_fs.delete_vector_bucket({ vector_bucket_name: 'testvb-to-delete' }, root_sdk);

            try {
                await bucketspace_fs.get_vector_bucket({ vector_bucket_name: 'testvb-to-delete' }, root_sdk);
                assert.fail('should have thrown');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'NO_SUCH_BUCKET');
            }
        });

        mocha.it('should fail to delete non-empty vector bucket (has indices)', async function() {
            await bucketspace_fs.create_vector_bucket({
                vector_bucket_name: 'testvb-notempty',
                vector_db_type: 'lance',
            }, root_sdk);

            await bucketspace_fs.create_vector_index({
                vector_bucket_name: 'testvb-notempty',
                vector_index_name: 'idx1',
                dimension: 128,
                distance_metric: 'cosine',
            }, root_sdk);

            try {
                await bucketspace_fs.delete_vector_bucket({ vector_bucket_name: 'testvb-notempty' }, root_sdk);
                assert.fail('should have thrown');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'VECTOR_BUCKET_NOT_EMPTY');
            }

            // cleanup: delete index then bucket
            await bucketspace_fs.delete_vector_index({
                vector_bucket_name: 'testvb-notempty',
                vector_index_name: 'idx1',
            }, root_sdk);
            await bucketspace_fs.delete_vector_bucket({ vector_bucket_name: 'testvb-notempty' }, root_sdk);
        });
    });

    //////////////////////////////
    // VECTOR INDICES           //
    //////////////////////////////

    mocha.describe('create_vector_index', function() {
        mocha.it('should create a vector index', async function() {
            await bucketspace_fs.create_vector_index({
                vector_bucket_name: 'testvb1',
                vector_index_name: 'testidx1',
                dimension: 256,
                distance_metric: 'cosine',
            }, root_sdk);

            const vi = await bucketspace_fs.get_vector_index({
                vector_bucket_name: 'testvb1',
                vector_index_name: 'testidx1',
            }, root_sdk);
            assert.strictEqual(vi.name.unwrap(), 'testidx1');
            assert.strictEqual(vi.vector_bucket, 'testvb1');
            assert.strictEqual(vi.dimension, 256);
            assert.strictEqual(vi.distance_metric, 'cosine');
            assert.strictEqual(vi.data_type, 'float32');
            assert.strictEqual(vi.owner_account.id, root_account._id);
            assert.ok(vi.creation_time);
        });

        mocha.it('should fail to create duplicate vector index', async function() {
            try {
                await bucketspace_fs.create_vector_index({
                    vector_bucket_name: 'testvb1',
                    vector_index_name: 'testidx1',
                    dimension: 256,
                    distance_metric: 'cosine',
                }, root_sdk);
                assert.fail('should have thrown');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'BUCKET_ALREADY_EXISTS');
            }
        });

        mocha.it('should fail to create index on nonexistent bucket', async function() {
            try {
                await bucketspace_fs.create_vector_index({
                    vector_bucket_name: 'nonexistent',
                    vector_index_name: 'testidx1',
                    dimension: 256,
                    distance_metric: 'cosine',
                }, root_sdk);
                assert.fail('should have thrown');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'NO_SUCH_BUCKET');
            }
        });

        mocha.it('should create index with metadata_configuration', async function() {
            await bucketspace_fs.create_vector_index({
                vector_bucket_name: 'testvb1',
                vector_index_name: 'testidx-meta',
                dimension: 128,
                distance_metric: 'euclidean',
                metadata_configuration: {
                    non_filterable_metadata_keys: ['raw_text'],
                },
            }, root_sdk);

            const vi = await bucketspace_fs.get_vector_index({
                vector_bucket_name: 'testvb1',
                vector_index_name: 'testidx-meta',
            }, root_sdk);
            assert.deepStrictEqual(vi.metadata_configuration, {
                non_filterable_metadata_keys: ['raw_text'],
            });

            // cleanup
            await bucketspace_fs.delete_vector_index({
                vector_bucket_name: 'testvb1',
                vector_index_name: 'testidx-meta',
            }, root_sdk);
        });

        mocha.it('IAM user creates index owned by root account', async function() {
            await bucketspace_fs.create_vector_index({
                vector_bucket_name: 'testvb1',
                vector_index_name: 'testidx-iam',
                dimension: 64,
                distance_metric: 'cosine',
            }, iam_sdk);

            const vi = await bucketspace_fs.get_vector_index({
                vector_bucket_name: 'testvb1',
                vector_index_name: 'testidx-iam',
            }, iam_sdk);
            assert.strictEqual(vi.owner_account.id, root_account._id);
        });
    });

    mocha.describe('get_vector_index', function() {
        mocha.it('should get an existing vector index', async function() {
            const vi = await bucketspace_fs.get_vector_index({
                vector_bucket_name: 'testvb1',
                vector_index_name: 'testidx1',
            }, root_sdk);
            assert.strictEqual(vi.name.unwrap(), 'testidx1');
            assert.strictEqual(vi.dimension, 256);
        });

        mocha.it('should fail to get nonexistent vector index', async function() {
            try {
                await bucketspace_fs.get_vector_index({
                    vector_bucket_name: 'testvb1',
                    vector_index_name: 'nonexistent',
                }, root_sdk);
                assert.fail('should have thrown');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'NO_SUCH_BUCKET');
            }
        });
    });

    mocha.describe('list_vector_indices', function() {
        mocha.before(async function() {
            // create an index owned by other_account on a separate bucket
            await bucketspace_fs.create_vector_bucket({
                vector_bucket_name: 'testvb-other-idx',
                vector_db_type: 'lance',
            }, other_sdk);
            await bucketspace_fs.create_vector_index({
                vector_bucket_name: 'testvb-other-idx',
                vector_index_name: 'other-idx1',
                dimension: 128,
                distance_metric: 'cosine',
            }, other_sdk);
        });

        mocha.it('should list indices for a vector bucket', async function() {
            const res = await bucketspace_fs.list_vector_indices({
                vector_bucket_name: 'testvb1',
                max_results: 100,
            }, root_sdk);
            const names = res.items.map(vi => vi.name.unwrap());
            assert.ok(names.includes('testidx1'));
            assert.ok(names.includes('testidx-iam'));
        });

        mocha.it('should filter indices by ownership', async function() {
            // other_account's indices should not be visible to root_sdk
            const res = await bucketspace_fs.list_vector_indices({
                vector_bucket_name: 'testvb-other-idx',
                max_results: 100,
            }, root_sdk);
            assert.strictEqual(res.items.length, 0);
        });

        mocha.it('IAM user should see root account indices', async function() {
            const res = await bucketspace_fs.list_vector_indices({
                vector_bucket_name: 'testvb1',
                max_results: 100,
            }, iam_sdk);
            const names = res.items.map(vi => vi.name.unwrap());
            assert.ok(names.includes('testidx1'));
            assert.ok(names.includes('testidx-iam'));
        });

        mocha.it('should filter by prefix', async function() {
            const res = await bucketspace_fs.list_vector_indices({
                vector_bucket_name: 'testvb1',
                max_results: 100,
                prefix: 'testidx-i',
            }, root_sdk);
            assert.strictEqual(res.items.length, 1);
            assert.strictEqual(res.items[0].name.unwrap(), 'testidx-iam');
        });

        mocha.it('should paginate with max_results and next_token', async function() {
            const res1 = await bucketspace_fs.list_vector_indices({
                vector_bucket_name: 'testvb1',
                max_results: 1,
            }, root_sdk);
            assert.strictEqual(res1.items.length, 1);
            assert.ok(res1.next_token);

            const res2 = await bucketspace_fs.list_vector_indices({
                vector_bucket_name: 'testvb1',
                max_results: 100,
                next_token: res1.next_token,
            }, root_sdk);
            assert.ok(res2.items.length >= 1);
            assert.ok(!res2.items.some(vi => vi.name.unwrap() === res1.items[0].name.unwrap()));
        });

        mocha.it('should return empty items for bucket with no indices', async function() {
            await bucketspace_fs.create_vector_bucket({
                vector_bucket_name: 'testvb-empty-idx',
                vector_db_type: 'lance',
            }, root_sdk);
            const res = await bucketspace_fs.list_vector_indices({
                vector_bucket_name: 'testvb-empty-idx',
                max_results: 100,
            }, root_sdk);
            assert.strictEqual(res.items.length, 0);
            // cleanup
            await bucketspace_fs.delete_vector_bucket({ vector_bucket_name: 'testvb-empty-idx' }, root_sdk);
        });
    });

    mocha.describe('delete_vector_index', function() {
        mocha.it('should delete an existing vector index', async function() {
            await bucketspace_fs.create_vector_index({
                vector_bucket_name: 'testvb1',
                vector_index_name: 'testidx-to-delete',
                dimension: 64,
                distance_metric: 'cosine',
            }, root_sdk);

            await bucketspace_fs.delete_vector_index({
                vector_bucket_name: 'testvb1',
                vector_index_name: 'testidx-to-delete',
            }, root_sdk);

            try {
                await bucketspace_fs.get_vector_index({
                    vector_bucket_name: 'testvb1',
                    vector_index_name: 'testidx-to-delete',
                }, root_sdk);
                assert.fail('should have thrown');
            } catch (err) {
                assert.strictEqual(err.rpc_code, 'NO_SUCH_BUCKET');
            }
        });
    });

    //////////////////////////////
    // VECTOR DATA OPERATIONS   //
    //////////////////////////////

    // vector data operations require LanceDB native binding
    const describe_lance = lance_available ? mocha.describe : mocha.describe.skip;
    describe_lance('vector data operations (put, query, list, delete)', function() {
        const vb_name = 'testvb-data';
        const idx_name = 'dataidx';
        const dimension = 4;
        let vector_bucket;
        let vector_index;

        mocha.before(async function() {
            await bucketspace_fs.create_vector_bucket({
                vector_bucket_name: vb_name,
                vector_db_type: 'lance',
            }, root_sdk);
            await bucketspace_fs.create_vector_index({
                vector_bucket_name: vb_name,
                vector_index_name: idx_name,
                dimension,
                distance_metric: 'cosine',
            }, root_sdk);
            vector_bucket = await bucketspace_fs.get_vector_bucket({ vector_bucket_name: vb_name }, root_sdk);
            vector_index = await bucketspace_fs.get_vector_index({
                vector_bucket_name: vb_name,
                vector_index_name: idx_name,
            }, root_sdk);
        });

        mocha.it('should put vectors', async function() {
            const vectors = [
                { key: 'vec1', data: { float32: [1.0, 0.0, 0.0, 0.0] } },
                { key: 'vec2', data: { float32: [0.0, 1.0, 0.0, 0.0] } },
                { key: 'vec3', data: { float32: [0.0, 0.0, 1.0, 0.0] } },
                { key: 'vec4', data: { float32: [0.0, 0.0, 0.0, 1.0] } },
            ];
            await vector_utils.put_vectors(vector_bucket, vector_index, vectors);
        });

        mocha.it('should list vectors', async function() {
            const res = await vector_utils.list_vectors(vector_bucket, vector_index, { max_results: 100 });
            assert.ok(res.vectors);
            assert.strictEqual(res.vectors.length, 4);
            const keys = res.vectors.map(v => v.key);
            assert.ok(keys.includes('vec1'));
            assert.ok(keys.includes('vec2'));
            assert.ok(keys.includes('vec3'));
            assert.ok(keys.includes('vec4'));
        });

        mocha.it('should query vectors and return nearest match', async function() {
            const res = await vector_utils.query_vectors(vector_bucket, vector_index, {
                query_vector: { float32: [1.0, 0.0, 0.0, 0.0] },
                topk: 2,
                return_metadata: false,
                return_distance: true,
            });
            assert.ok(res.vectors);
            assert.strictEqual(res.vectors.length, 2);
            // the closest vector to [1,0,0,0] should be vec1
            assert.strictEqual(res.vectors[0].key, 'vec1');
            // distance should be returned
            assert.ok(res.vectors[0].distance !== undefined);
        });

        mocha.it('should query vectors with return_metadata', async function() {
            // insert vectors with metadata
            const vectors_with_meta = [
                { key: 'vmeta1', data: { float32: [0.5, 0.5, 0.0, 0.0] }, metadata: { category: 'test' } },
            ];
            await vector_utils.put_vectors(vector_bucket, vector_index, vectors_with_meta);

            const res = await vector_utils.query_vectors(vector_bucket, vector_index, {
                query_vector: { float32: [0.5, 0.5, 0.0, 0.0] },
                topk: 1,
                return_metadata: true,
                return_distance: false,
            });
            assert.ok(res.vectors);
            assert.strictEqual(res.vectors.length, 1);
            assert.strictEqual(res.vectors[0].key, 'vmeta1');
            assert.ok(res.vectors[0].metadata);
            assert.strictEqual(res.vectors[0].metadata.category, 'test');
        });

        mocha.it('should query vectors without return_distance', async function() {
            const res = await vector_utils.query_vectors(vector_bucket, vector_index, {
                query_vector: { float32: [0.0, 1.0, 0.0, 0.0] },
                topk: 1,
                return_metadata: false,
                return_distance: false,
            });
            assert.ok(res.vectors);
            assert.strictEqual(res.vectors.length, 1);
            assert.strictEqual(res.vectors[0].key, 'vec2');
            assert.strictEqual(res.vectors[0].distance, undefined);
            assert.strictEqual(res.vectors[0].metadata, undefined);
        });

        mocha.it('should delete vectors by key', async function() {
            await vector_utils.delete_vectors(vector_bucket, vector_index, ['vec3', 'vec4']);
            const res = await vector_utils.list_vectors(vector_bucket, vector_index, { max_results: 100 });
            const keys = res.vectors.map(v => v.key);
            assert.ok(!keys.includes('vec3'));
            assert.ok(!keys.includes('vec4'));
        });

        mocha.after(async function() {
            await vector_utils.delete_vector_index(vector_bucket, vector_index);
            vector_utils.delete_vector_bucket(vector_bucket);
            await bucketspace_fs.delete_vector_index({
                vector_bucket_name: vb_name,
                vector_index_name: idx_name,
            }, root_sdk);
            await bucketspace_fs.delete_vector_bucket({ vector_bucket_name: vb_name }, root_sdk);
        });
    });

    //////////////////////////////
    // CLEANUP                  //
    //////////////////////////////

    mocha.describe('cleanup', function() {
        mocha.it('should clean up test vector indices and buckets', async function() {
            // delete indices created during tests
            const indices_to_delete = [
                { vector_bucket_name: 'testvb1', vector_index_name: 'testidx1' },
                { vector_bucket_name: 'testvb1', vector_index_name: 'testidx-iam' },
                { vector_bucket_name: 'testvb-other-idx', vector_index_name: 'other-idx1' },
            ];
            for (const params of indices_to_delete) {
                try {
                    await bucketspace_fs.delete_vector_index(params, root_sdk);
                } catch (err) {
                    // ignore if already deleted
                }
            }
            // delete buckets
            const buckets_to_delete = ['testvb1', 'testvb-iam', 'testvb-other', 'testvb-other-idx'];
            for (const vector_bucket_name of buckets_to_delete) {
                try {
                    await bucketspace_fs.delete_vector_bucket({ vector_bucket_name }, root_sdk);
                } catch (err) {
                    // ignore if already deleted
                }
            }
        });
    });
});
