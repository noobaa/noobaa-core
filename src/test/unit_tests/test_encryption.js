/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

const system_store = require('../../server/system_services/system_store').get_instance();
const db_client = require('../../util/db_client').instance();
const P = require('../../util/promise');
const assert = require('assert');
const mocha = require('mocha');
const AWS = require('aws-sdk');
const _ = require('lodash');
const http = require('http');

let s3;
let coretest_access_key;
let coretest_secret_key;
let wrapped_coretest_secret_key;

mocha.describe('Encryption tests', function() {
    const { rpc_client, EMAIL, SYSTEM } = coretest;
    let response_account;
    let accounts = [];
    let buckets = [];

    mocha.before(async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
    });

    mocha.describe('Check master keys in system', async function() {
        mocha.it('load system store', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            await system_store.load();
            const coretest_account = account_by_name(system_store.data.accounts, EMAIL);
            update_coretest_globals(coretest_account);
        });

        mocha.it('System master key test', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            const db_system = await db_client.collection('systems').findOne({ name: SYSTEM });
            const root_key_id = system_store.master_key_manager.get_root_key_id();
            await compare_master_keys({db_master_key_id: db_system.master_key_id, father_master_key_id: root_key_id});
        });

        mocha.it('corestest account master key test', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            const db_coretest_account = await db_client.collection('accounts').findOne({ email: EMAIL });
            const db_system = await db_client.collection('systems').findOne({ name: SYSTEM });
            await compare_master_keys({db_master_key_id: db_coretest_account.master_key_id,
                father_master_key_id: db_system.master_key_id});
        });

        mocha.it('Coretest acount access keys test', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            const db_coretest_account = await db_client.collection('accounts').findOne({ email: EMAIL });
            const system_store_account = account_by_name(system_store.data.accounts, EMAIL);
            // check secret key in db is encrypted by the account master key id
            const secrets = {
                db_secret: db_coretest_account.access_keys[0].secret_key,
                system_store_secret: system_store_account.access_keys[0].secret_key.unwrap(),
                encrypt_and_compare_secret: system_store_account.access_keys[0].secret_key
            };
            compare_secrets(secrets, system_store_account.master_key_id._id);
            await check_master_key_in_db(system_store_account.master_key_id._id);
        });

        mocha.it('configure s3 succefully', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            configure_s3(coretest_access_key, coretest_secret_key);
        });

        mocha.it('create buckets succefully', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            let i;
            for (i = 0; i < 5; i++) {
                await s3.createBucket({ Bucket: `bucket${i}` }).promise();
                const db_bucket = await db_client.collection('buckets').findOne({ name: `bucket${i}` });
                const db_system = await db_client.collection('systems').findOne({ name: SYSTEM });
                buckets.push({bucket_name: `bucket${i}`});
                await check_master_key_in_db(db_bucket.master_key_id);
                // check if the resolved bucket master key in system is encrypted in db by the system master key
                await compare_master_keys({db_master_key_id: db_bucket.master_key_id,
                father_master_key_id: db_system.master_key_id});
            }
        });

        mocha.it('upload objects succefully and compare chunks cipher keys', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            await P.all(_.map(buckets.slice(0, 2), async cur_bucket => {
                const bucket_name = cur_bucket.bucket_name;
                const key = `key-${bucket_name}`;
                await put_object(bucket_name, key);
                await compare_chunks(bucket_name, key, rpc_client);
                await delete_object(bucket_name, key);
            }));
        });

        mocha.it('multipart upload objects succefully and compare chunks cipher keys', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            await P.all(_.map(buckets.slice(3, 4), async cur_bucket => {
                const bucket_name = cur_bucket.bucket_name;
                const key = `key${bucket_name}-multipart`;
                await multipart_upload(bucket_name, key);
                await compare_chunks(bucket_name, key, rpc_client);
                await delete_object(bucket_name, key);
            }));
        });

        mocha.it('delete buckets succefully', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            await P.all(_.map(buckets, async cur_bucket => {
                await rpc_client.bucket.delete_bucket({
                    name: cur_bucket.bucket_name,
                });
            }));
        });

       mocha.it('create accounts and compare acount access keys succefully', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            const db_system = await db_client.collection('systems').findOne({ name: SYSTEM });
            let new_account_params = {
                has_login: false,
                s3_access: true,
                allowed_buckets: {
                    full_permission: true
                }
            };
            let i;
            for (i = 0; i < 20; i++) {
                response_account = await rpc_client.account.create_account({...new_account_params,
                     email: `email${i}`, name: `name${i}`});
                accounts.push({email: `email${i}`, create_account_result: response_account});
                const db_account = await db_client.collection('accounts').findOne({ email: `email${i}` });
                const system_store_account = account_by_name(system_store.data.accounts, `email${i}`);

                // check account secret key in db is encrypted
                const secrets = {
                    db_secret: db_account.access_keys[0].secret_key,
                    system_store_secret: system_store_account.access_keys[0].secret_key.unwrap(),
                    encrypt_and_compare_secret: response_account.access_keys[0].secret_key
                };
                compare_secrets(secrets, system_store_account.master_key_id._id);
                await check_master_key_in_db(db_account.master_key_id);
                await compare_master_keys({db_master_key_id: db_account.master_key_id,
                father_master_key_id: db_system.master_key_id});
            }
        });

        mocha.it('create external connections succefully', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            const external_connection = {
                auth_method: 'AWS_V2',
                endpoint: coretest.get_http_address(),
                endpoint_type: 'S3_COMPATIBLE',
                name: 'conn1',
                identity: coretest_access_key || '123',
                secret: coretest_secret_key || 'abc',
            };
            await P.all(_.map(accounts, async cur_account => {
                await rpc_client.account.add_external_connection(external_connection, { auth_token:
                    cur_account.create_account_result.token });
            }));
            await system_store.load();

            await P.all(_.map(accounts, async cur_account => {
                const db_account = await db_client.collection('accounts').findOne({ email: cur_account.email });
                const system_store_account = account_by_name(system_store.data.accounts, cur_account.email);

                // check account sync creds secret key in db is encrypted by the account master key
                const secrets = {
                    db_secret: db_account.sync_credentials_cache[0].secret_key,
                    system_store_secret: system_store_account.sync_credentials_cache[0].secret_key.unwrap(),
                    encrypt_and_compare_secret: wrapped_coretest_secret_key
                };
                compare_secrets(secrets, system_store_account.master_key_id._id);
                await check_master_key_in_db(system_store_account.master_key_id._id);
            }));
        });

        mocha.it('create namespace resources succefully', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            await P.all(_.map(accounts.slice(10), async cur_account => {
                const namespace_resource_name = `${cur_account.email}-namespace-resource`;
                await rpc_client.pool.create_namespace_resource({
                    name: namespace_resource_name,
                    connection: 'conn1',
                    target_bucket: 'first.bucket'
                }, { auth_token: cur_account.create_account_result.token });
            }));

            await system_store.load();

            await P.all(_.map(accounts.slice(10), async cur_account => {
                const namespace_resource_name = `${cur_account.email}-namespace-resource`;
                const db_account = await db_client.collection('accounts').findOne({ email: cur_account.email });
                const system_store_account = account_by_name(system_store.data.accounts, cur_account.email);
                const db_ns_resource = await db_client.collection('namespace_resources').findOne({ name: namespace_resource_name });

                const system_store_ns_resource = pool_by_name(system_store.data.namespace_resources,
                     namespace_resource_name); // system store data supposed to be decrypted

                // check s3 creds key in db is encrypted
                const secrets = {
                    db_secret: db_ns_resource.connection.secret_key,
                    system_store_secret: system_store_ns_resource.connection.secret_key.unwrap(),
                    encrypt_and_compare_secret: wrapped_coretest_secret_key
                };
                compare_secrets(secrets, system_store_account.master_key_id._id);
                await check_master_key_in_db(system_store_account.master_key_id._id);
                // check that account sync cred secret key equals to ns_resource's connection's secret key in db and in system store
                assert.strictEqual(db_ns_resource.connection.secret_key, db_account.sync_credentials_cache[0].secret_key);
                assert.strictEqual(system_store_ns_resource.connection.secret_key.unwrap(),
                    system_store_account.sync_credentials_cache[0].secret_key.unwrap());
            }));
        });

        mocha.it('regenerate creds coretest 1', async function() {
                this.timeout(600000); // eslint-disable-line no-invalid-this
                await rpc_client.account.generate_account_keys({ email: EMAIL });
                await system_store.load();

                const db_account = await db_client.collection('accounts').findOne({ email: EMAIL });
                const system_store_account = account_by_name(system_store.data.accounts, EMAIL);

                // check secret key changed succefully
                assert.notStrictEqual(coretest_secret_key, system_store_account.access_keys[0].secret_key.unwrap());
                update_coretest_globals(system_store_account);

                // check s3 creds key in db is encrypted after regeneration
                const secrets = {
                    db_secret: db_account.access_keys[0].secret_key,
                    system_store_secret: system_store_account.access_keys[0].secret_key.unwrap(),
                    encrypt_and_compare_secret: system_store_account.access_keys[0].secret_key
                };
                compare_secrets(secrets, system_store_account.master_key_id._id);
        });

        mocha.it('update connections succefully - accounts + namespace resources', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            await P.all(_.map(accounts, async cur_account => {
                await rpc_client.account.update_external_connection({ name: 'conn1',
                identity: coretest_access_key, secret: coretest_secret_key },
                { auth_token: cur_account.create_account_result.token });
            }));

            await system_store.load();

            // 1. check secrets of sync creds accounts in db updated
            // 3. check secrets of namespace resources connection in db updated
            await P.all(_.map(accounts.slice(10), async cur_account => {
                const db_account = await db_client.collection('accounts').findOne({ email: cur_account.email });
                const system_store_account = account_by_name(system_store.data.accounts, cur_account.email);

                // check sync creds key in db is encrypted
                const secrets = {
                    db_secret: db_account.sync_credentials_cache[0].secret_key,
                    system_store_secret: system_store_account.sync_credentials_cache[0].secret_key.unwrap(),
                    encrypt_and_compare_secret: wrapped_coretest_secret_key
                };
                compare_secrets(secrets, system_store_account.master_key_id._id);

                // check secrets of namespace resources connection in db updated and encrypted by the account master_key_id
                const namespace_resource_name = `${cur_account.email}-namespace-resource`;
                const db_ns_resource = await db_client.collection('namespace_resources').findOne({ name: namespace_resource_name });
                const system_store_ns_resource = pool_by_name(system_store.data.namespace_resources,
                        namespace_resource_name);

                const ns_secrets = {
                    db_secret: db_ns_resource.connection.secret_key,
                    system_store_secret: system_store_ns_resource.connection.secret_key.unwrap(),
                    encrypt_and_compare_secret: wrapped_coretest_secret_key
                };
                compare_secrets(ns_secrets, system_store_account.master_key_id._id);
                await check_master_key_in_db(system_store_account.master_key_id._id);
                // check that account sync cred secret key equals to ns_resource's connection's secret key in db and in system store
                assert.strictEqual(db_ns_resource.connection.secret_key, db_account.sync_credentials_cache[0].secret_key);
                assert.strictEqual(system_store_ns_resource.connection.secret_key.unwrap(),
                    system_store_account.sync_credentials_cache[0].secret_key.unwrap());
            }));
        });

        mocha.it('delete namespace resources succefully', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            await P.all(_.map(accounts.slice(10), async cur_account => {
                const pool_name = `${cur_account.email}-namespace-resource`;
                await rpc_client.pool.delete_namespace_resource({
                    name: pool_name,
                }, { auth_token: cur_account.create_account_result.token });
            }));
        });

        mocha.it('create cloud pools succefully', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            await P.all(_.map(accounts.slice(0, 5), async cur_account => {
                const pool_name = `${cur_account.email}-cloud-pool`;
                await rpc_client.pool.create_cloud_pool({
                    name: pool_name,
                    connection: 'conn1',
                    target_bucket: 'first.bucket',
                }, { auth_token: cur_account.create_account_result.token });
            }));

            await system_store.load();

            await P.all(_.map(accounts.slice(0, 5), async cur_account => {
                const pool_name = `${cur_account.email}-cloud-pool`;
                const db_account = await db_client.collection('accounts').findOne({ email: cur_account.email });
                const system_store_account = account_by_name(system_store.data.accounts, cur_account.email);
                const db_pool = await db_client.collection('pools').findOne({ name: pool_name });
                const system_store_pool = pool_by_name(system_store.data.pools, pool_name);

                // check account s3 creds key in db is encrypted
                const secrets = {
                    db_secret: db_pool.cloud_pool_info.access_keys.secret_key,
                    system_store_secret: system_store_pool.cloud_pool_info.access_keys.secret_key.unwrap(),
                    encrypt_and_compare_secret: wrapped_coretest_secret_key
                };
                await check_master_key_in_db(system_store_account.master_key_id._id);
                compare_secrets(secrets, system_store_account.master_key_id._id);
                // check that account sync cred secret key equals to pool's connection's secret key in db and in system store
                assert.strictEqual(db_pool.cloud_pool_info.access_keys.secret_key, db_account.sync_credentials_cache[0].secret_key);
                assert.strictEqual(system_store_pool.cloud_pool_info.access_keys.secret_key.unwrap(),
                    system_store_account.sync_credentials_cache[0].secret_key.unwrap());
            }));
        });

        mocha.it('regenerate creds coretest 2', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            await rpc_client.account.generate_account_keys({ email: EMAIL });
            await system_store.load();

            const db_account = await db_client.collection('accounts').findOne({ email: EMAIL }); // db data - supposed to be encrypted
            const system_store_account = account_by_name(system_store.data.accounts, EMAIL); // system store data supposed to be decrypted

            // check secret key changed succefully
            assert.notStrictEqual(coretest_secret_key, system_store_account.access_keys[0].secret_key.unwrap());
            update_coretest_globals(system_store_account);

            // check s3 creds key in db is encrypted after regeneration
            const secrets = {
                db_secret: db_account.access_keys[0].secret_key,
                system_store_secret: system_store_account.access_keys[0].secret_key.unwrap(),
                encrypt_and_compare_secret: system_store_account.access_keys[0].secret_key
            };
            compare_secrets(secrets, system_store_account.master_key_id._id);
        });

        mocha.it('update connections succefully - accounts + pools', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            await P.all(_.map(accounts, async cur_account => {
                await rpc_client.account.update_external_connection({ name: 'conn1',
                identity: coretest_access_key, secret: coretest_secret_key },
                { auth_token: cur_account.create_account_result.token });
            }));

            await system_store.load();

            // 1. check secrets of sync creds accounts in db updated
            // 2. check secrets of pools connection in db updated
            await P.all(_.map(accounts.slice(0, 5), async cur_account => {
                const db_account = await db_client.collection('accounts').findOne({ email: cur_account.email }); // db data - supposed to be encrypted
                const system_store_account = account_by_name(system_store.data.accounts, cur_account.email); // system store data supposed to be decrypted

                // check sync creds key in db is encrypted
                const secrets = {
                    db_secret: db_account.sync_credentials_cache[0].secret_key,
                    system_store_secret: system_store_account.sync_credentials_cache[0].secret_key.unwrap(),
                    encrypt_and_compare_secret: wrapped_coretest_secret_key
                };
                compare_secrets(secrets, system_store_account.master_key_id._id);
                // check pools connection secret key in db is encrypted and updated
                const pool_name = `${cur_account.email}-cloud-pool`;
                const db_pool = await db_client.collection('pools').findOne({ name: pool_name }); // db data - supposed to be encrypted
                const system_store_pool = pool_by_name(system_store.data.pools, pool_name); // system store data supposed to be decrypted

                const pools_secrets = {
                    db_secret: db_pool.cloud_pool_info.access_keys.secret_key,
                    system_store_secret: system_store_pool.cloud_pool_info.access_keys.secret_key.unwrap(),
                    encrypt_and_compare_secret: wrapped_coretest_secret_key
                };
                compare_secrets(pools_secrets, system_store_account.master_key_id._id);
                // check that account sync cred secret key equals to pool's connection's secret key in db and in system store
                assert.strictEqual(db_pool.cloud_pool_info.access_keys.secret_key, db_account.sync_credentials_cache[0].secret_key);
                assert.strictEqual(system_store_pool.cloud_pool_info.access_keys.secret_key.unwrap(),
                    system_store_account.sync_credentials_cache[0].secret_key.unwrap());
            }));
        });

        mocha.it('delete pools succefully', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            await P.all(_.map(accounts.slice(0, 5), async cur_account => {
                const pool_name = `${cur_account.email}-cloud-pool`;
                await rpc_client.pool.delete_pool({
                    name: pool_name,
                }, { auth_token: cur_account.create_account_result.token });
            }));
        });

        mocha.it('regenerate creds for all accounts (non coretest) succefully', async function() {
            this.timeout(600000); // eslint-disable-line no-invalid-this
            await P.all(_.map(accounts, async cur_account => {
                await rpc_client.account.generate_account_keys({ email: cur_account.email });
            }));
            await system_store.load();
            await P.all(_.map(accounts, async cur_account => {
                const db_account = await db_client.collection('accounts').findOne({ email: cur_account.email });
                const system_store_account = account_by_name(system_store.data.accounts, cur_account.email);
                // check account s3 secret key in db is encrypted
                const secrets = {
                    db_secret: db_account.access_keys[0].secret_key,
                    system_store_secret: system_store_account.access_keys[0].secret_key.unwrap(),
                    encrypt_and_compare_secret: system_store_account.access_keys[0].secret_key
                };
                compare_secrets(secrets, system_store_account.master_key_id._id);
            }));
        });

    });
});

async function multipart_upload(bucket, key) {
    let res = await s3.createMultipartUpload({Bucket: bucket, Key: key, ContentType: 'text/plain'}).promise();
    const upload_id = res.UploadId;

    res = await s3.uploadPart({ Bucket: bucket, Key: key, UploadId: upload_id, PartNumber: 1, Body: "TEST OF MULTIPART UPLOAD"}).promise();

    await s3.completeMultipartUpload({ Bucket: bucket, Key: key, UploadId: upload_id,
    MultipartUpload: {
        Parts: [{
            PartNumber: 1,
            ETag: res.ETag }]
    }}).promise();
}

async function put_object(bucket, key) {
    await s3.putObject({
        Bucket: bucket,
        Key: key,
        Body: 'CHECKING CIPHER KEYS OF CHUNKS ON REGULAR UPLOADS',
        ContentType: 'text/plain'
    }).promise();
}

async function delete_object(bucket, key) {
    await s3.deleteObject({
        Bucket: bucket,
        Key: key,
    }).promise();
}

function configure_s3(acc_key, sec_key) {
    s3 = new AWS.S3({
        endpoint: coretest.get_http_address(),
        accessKeyId: acc_key,
        secretAccessKey: sec_key,
        s3ForcePathStyle: true,
        signatureVersion: 'v4',
        computeChecksums: true,
        s3DisableBodySigning: false,
        region: 'us-east-1',
        httpOptions: { agent: new http.Agent({ keepAlive: false }) }
    });
}

function account_by_name(accounts, email) {
    return accounts.find(account => account.email.unwrap() === email);
}

function pool_by_name(pools, pool_name) {
    return pools.find(pool => pool.name === pool_name);
}

async function check_master_key_in_db(master_key_id) {
    const db_account = await db_client.collection('master_keys').findOne({ _id: db_client.parse_object_id(master_key_id) });
    assert.ok(db_account);
}

function compare_secrets(secrets, master_key_id) {
    const {db_secret, system_store_secret, encrypt_and_compare_secret} = secrets;
    // 1. compare system store secret and original/response secret - should be equal
    assert.strictEqual(system_store_secret, encrypt_and_compare_secret.unwrap());

    // 2. compare system store secret and db secret - should not be equal
    assert.notStrictEqual(system_store_secret, db_secret);

    // 3. encrypt the original/response secret
    const encrypted_secret_key = system_store.master_key_manager.encrypt_sensitive_string_with_master_key_id(
        encrypt_and_compare_secret, master_key_id);

    // 4. compare the encrypted original/response secret to db secret - should be equal
    assert.strictEqual(encrypted_secret_key.unwrap(), db_secret);
}

async function compare_master_keys(master_keys) {
    const { db_master_key_id, father_master_key_id} = master_keys;
    const db_system_master_key = await db_client.collection('master_keys').findOne({ _id: db_master_key_id });
    const resolved_master_key = system_store.master_key_manager.resolved_master_keys_by_id[db_master_key_id];
    const encrypted_secret_key = system_store.master_key_manager.encrypt_buffer_with_master_key_id(
        Buffer.from(resolved_master_key.cipher_key, 'base64'), father_master_key_id);

    // check cipher key in db is encrypted by the father master key id
    assert.strictEqual(encrypted_secret_key.toString('base64'), db_system_master_key.cipher_key.toString('base64'));
}

async function compare_chunks(bucket_name, key, rpc_client) {
    const db_bucket = await db_client.collection('buckets').findOne({name: bucket_name});
    const db_chunks = await db_client.collection('datachunks').find({bucket: db_bucket._id, deleted: null});
    const api_chunks = (await rpc_client.object.read_object_mapping_admin({ bucket: bucket_name, key})).chunks;
    await P.all(_.map(db_chunks, async db_chunk => {
        const chunk_api = api_chunks.find(api_chunk => api_chunk._id.toString() === db_chunk._id.toString());
        await check_master_key_in_db(db_chunk.master_key_id);
        assert.strictEqual(db_chunk.master_key_id.toString(), db_bucket.master_key_id.toString());
        assert.strictEqual(db_chunk.master_key_id.toString(), chunk_api.master_key_id.toString());
        const encrypted_secret_key = system_store.master_key_manager.encrypt_buffer_with_master_key_id(
        Buffer.from(chunk_api.cipher_key_b64, 'base64'), chunk_api.master_key_id);
        // check cipher key in db is encrypted by the father master key id
        assert.strictEqual(encrypted_secret_key.toString('base64'), db_chunk.cipher_key.toString('base64'));
    }));
}

function update_coretest_globals(coretest_account) {
    coretest_access_key = coretest_account.access_keys[0].access_key.unwrap();
    coretest_secret_key = coretest_account.access_keys[0].secret_key.unwrap();
    wrapped_coretest_secret_key = coretest_account.access_keys[0].secret_key;
}