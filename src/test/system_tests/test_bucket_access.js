/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
if (argv.log_file) {
    dbg.set_log_to_file(argv.log_file);
}
dbg.set_process_name('test_bucket_access');

const api = require('../../api');
const dotenv = require('../../util/dotenv');
const ops = require('../utils/basic_server_ops');
const rpc = api.new_rpc();
const test_utils = require('./test_utils');

const fs = require('fs');
const AWS = require('aws-sdk');
const { v4: uuid } = require('uuid');
const assert = require('assert');


dotenv.load();

const {
    no_setup,
    mgmt_ip = 'localhost',
    mgmt_port = '8080',
    s3_ip = 'localhost',
    s3_port = '80',
} = argv;

const target_s3_endpoint = `http://${s3_ip}:${s3_port}`;
const POOL_NAME = 'test-pool';

const client = rpc.new_client({
    address: `ws://${mgmt_ip}:${mgmt_port}`
});

const full_access_user = {
    name: 'full_access',
    email: 'full_access@noobaa.com',
    has_login: false,
    s3_access: true,
    allowed_buckets: {
        full_permission: false,
        permission_list: ['bucket1', 'bucket2']
    },
    default_resource: POOL_NAME
};

const bucket1_user = {
    name: 'bucket1_access',
    email: 'bucket1_access@noobaa.com',
    has_login: false,
    s3_access: true,
    allowed_buckets: {
        full_permission: false,
        permission_list: ['bucket1']
    },
    default_resource: POOL_NAME
};

const no_access_user = {
    name: 'no_access',
    email: 'no_access@noobaa.com',
    has_login: false,
    s3_access: false,
};

module.exports = {
    run_test: run_test
};

function authenticate() {
    const auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params);
}

async function main() {
    try {
        await run_test();
        process.exit(0);
    } catch (err) {
        console.error('run_test failed with error:', err, err.stack);
        process.exit(1);
    }
}

async function setup() {
    if (no_setup) {
        return;
    }

    // Create a default pool for the users.
    await test_utils.create_hosts_pool(client, POOL_NAME, 3);
    // Create test buckets.
    await client.bucket.create_bucket({ name: 'bucket1' });
    await client.bucket.create_bucket({ name: 'bucket2' });
    // add new accounts:
    await client.account.create_account(full_access_user);
    await client.account.create_account(bucket1_user);
    await client.account.create_account(no_access_user);
    const system_info = await client.system.read_system();

    let account = account_by_name(system_info.accounts, full_access_user.email);
    full_access_user.access_keys = account.access_keys[0];

    // replicate permission_list - loops over the permission_list and generates 
    // S3 policies which gives the user equivalent permissions over the buckets that permission_list was giving.
    await Promise.all(
        full_access_user
            .allowed_buckets
            .permission_list
            .map(bucket => test_utils.generate_s3_policy(full_access_user.email, bucket, ['s3:*']))
            .map(generated => client.bucket.put_bucket_policy({ name: generated.params.bucket, policy: generated.policy }))
    );

    account = account_by_name(system_info.accounts, bucket1_user.email);
    bucket1_user.access_keys = account.access_keys[0];

    // replicate permission_list - loops over the permission_list and generates 
    // S3 policies which gives the user equivalent permissions over the buckets that permission_list was giving.
    await Promise.all(
        full_access_user
            .allowed_buckets
            .permission_list
            .map(bucket => test_utils.generate_s3_policy(full_access_user.email, bucket, ['s3:*']))
            .map(generated => client.bucket.put_bucket_policy({ name: generated.params.bucket, policy: generated.policy }))
    );

    account = account_by_name(system_info.accounts, no_access_user.email);
    no_access_user.access_keys = account.access_keys[0];

    // replicate permission_list - loops over the permission_list and generates 
    // S3 policies which gives the user equivalent permissions over the buckets that permission_list was giving.
    await Promise.all(
        full_access_user
            .allowed_buckets
            .permission_list
            .map(bucket => test_utils.generate_s3_policy(full_access_user.email, bucket, ['s3:*']))
            .map(generated => client.bucket.put_bucket_policy({ name: generated.params.bucket, policy: generated.policy }))
    );
}

function get_new_server(user) {
    const access_key = user.access_keys.access_key;
    const secret_key = user.access_keys.secret_key;
    return new AWS.S3({
        endpoint: target_s3_endpoint,
        s3ForcePathStyle: true,
        accessKeyId: access_key.unwrap(),
        secretAccessKey: secret_key.unwrap(),
        maxRedirects: 10,
    });
}

async function run_test() {
    await authenticate();
    await setup();
    await test_bucket_write_allowed();
    await test_bucket_read_allowed();
    await test_bucket_list_allowed();
    await test_bucket_write_denied();
    await test_bucket_read_denied();
    await test_bucket_list_denied();
    await test_create_bucket_add_creator_permissions();
    await test_delete_bucket_deletes_permissions();
    await test_no_s3_access();
    await test_ip_restrictions();
    console.log('test_bucket_access PASSED');
}

/********************Tests:****************************/


async function test_bucket_write_allowed() {
    console.log(`Starting test_bucket_write_allowed`);
    // test upload for allowed user
    let file_name = await ops.generate_random_file(1);
    // upload with full_access_user to both buckets:
    let server = get_new_server(full_access_user);
    const params1 = {
        Bucket: 'bucket1',
        Key: file_name,
        Body: fs.createReadStream(file_name)
    };
    const params2 = {
        Bucket: 'bucket2',
        Key: file_name,
        Body: fs.createReadStream(file_name)
    };
    await server.upload(params1).promise();
    await server.upload(params2).promise();

    file_name = await ops.generate_random_file(1);
    // upload with full_access_user to both buckets:
    server = get_new_server(bucket1_user);
    const params = {
        Bucket: 'bucket1',
        Key: file_name,
        Body: fs.createReadStream(file_name)
    };
    await server.upload(params).promise();
    console.log('test_bucket_write_allowed PASSED');
}

async function test_bucket_read_allowed() {
    console.log(`Starting test_bucket_read_allowed`);
    const file_name = await ops.generate_random_file(1);
    const server = get_new_server(full_access_user);
    const params1 = {
        Bucket: 'bucket1',
        Key: file_name,
        Body: fs.createReadStream(file_name)
    };
    await server.upload(params1).promise();
    const server2 = get_new_server(bucket1_user);
    const params2 = {
        Bucket: 'bucket1',
        Key: file_name
    };
    await server2.getObject(params2).promise();
    console.log('test_bucket_read_allowed PASSED');
}

async function test_bucket_list_allowed() {
    console.log(`Starting test_bucket_list_allowed`);
    const file_name = await ops.generate_random_file(1);

    const server = get_new_server(full_access_user);
    const params1 = {
        Bucket: 'bucket1',
        Key: file_name,
        Body: fs.createReadStream(file_name)
    };
    await server.upload(params1).promise();

    const server2 = get_new_server(bucket1_user);
    const params2 = {
        Bucket: 'bucket1'
    };
    await server2.listObjects(params2).promise();

}

async function test_bucket_write_denied() {
    console.log(`Starting test_bucket_write_denied`);
    // test upload for allowed user
    const file_name = await ops.generate_random_file(1);
    // upload with bucket1_user to bucket2
    const server = get_new_server(bucket1_user);
    const params1 = {
        Bucket: 'bucket2',
        Key: file_name,
        Body: fs.createReadStream(file_name)
    };
    try {
        await server.upload(params1).promise();

        throw new Error('expecting upload to fail with statusCode 403- AccessDenied');

    } catch (err) {
        assert(err.statusCode === 403, 'expecting upload to fail with statusCode 403- AccessDenied');
    }
}

async function test_bucket_read_denied() {
    console.log(`Starting test_bucket_read_denied`);
    const file_name = await ops.generate_random_file(1);

    const server = get_new_server(full_access_user);
    const params1 = {
        Bucket: 'bucket2',
        Key: file_name,
        Body: fs.createReadStream(file_name)
    };
    await server.upload(params1).promise();
    const server2 = get_new_server(bucket1_user);
    const params2 = {
        Bucket: 'bucket2',
        Key: file_name
    };
    try {
        await server2.getObject(params2).promise();
        throw new Error('expecting read to fail with statusCode 403- AccessDenied');
    } catch (err) {
        assert(err.statusCode === 403, 'expecting read to fail with statusCode 403- AccessDenied');
    }

}

async function test_bucket_list_denied() {
    console.log(`Starting test_bucket_list_denied`);
    const file_name = await ops.generate_random_file(1);

    const server = get_new_server(full_access_user);
    const params1 = {
        Bucket: 'bucket2',
        Key: file_name,
        Body: fs.createReadStream(file_name)
    };
    await server.upload(params1).promise();

    const server2 = get_new_server(bucket1_user);
    const params2 = {
        Bucket: 'bucket2'
    };
    try {
        await server2.listObjects(params2).promise();
        throw new Error('expecting read to fail with statusCode 403- AccessDenied');
    } catch (err) {
        assert(err.statusCode === 403, 'expecting read to fail with statusCode 403- AccessDenied');
    }

}

async function test_create_bucket_add_creator_permissions() {
    console.log(`Starting test_create_bucket_add_creator_permissions`);
    const server = get_new_server(full_access_user);
    const unique_bucket_name = 'bucket' + uuid();
    const params = {
        Bucket: unique_bucket_name
    };
    await server.createBucket(params).promise();

    // Owners have full access to the bucket
    const bucket = await client.bucket.read_bucket({ rpc_params: { name: unique_bucket_name } });
    assert(bucket.owner_account.email.unwrap() === full_access_user.email, 'expecting full_access_user to have permissions to access ' + unique_bucket_name);
}

async function test_delete_bucket_deletes_permissions() {
    console.log(`Starting test_delete_bucket_deletes_permissions`);
    const server = get_new_server(full_access_user);
    const unique_bucket_name = 'bucket' + uuid();

    await server.createBucket({ Bucket: unique_bucket_name }).promise();

    let bucket = await client.bucket.read_bucket({ rpc_params: { name: unique_bucket_name } });
    assert(bucket.owner_account.email.unwrap() === full_access_user.email, 'expecting full_access_user to have permissions to access ' + unique_bucket_name);

    await server.deleteBucket({ Bucket: unique_bucket_name }).promise();

    try {
        await client.bucket.read_bucket({ rpc_params: { name: unique_bucket_name } });
        throw Error("the bucket must not exist");
    } catch (error) {
        assert(!error, 'expecting full_access_user to not have permissions to access ' + unique_bucket_name);
    }
}

async function test_no_s3_access() {
    console.log(`Starting test_no_s3_access`);
    const server = get_new_server(no_access_user);
    const data = await server.listBuckets().promise();
    assert(data.Buckets.length === 0, 'expecting an empty bucket list for no_access_user');
}

async function test_ip_restrictions() {
    console.log(`Starting test_ip_restrictions`);
    const server = get_new_server(full_access_user);
    const single_ip_restriction = {
        email: full_access_user.email,
        ips: [{ start: '10.0.0.1', end: '10.0.0.1' }]
    };
    const range_ip_restriction = {
        email: full_access_user.email,
        ips: [{ start: '10.0.0.1', end: '10.1.0.50' }]
    };
    const no_ip_restriction = {
        email: full_access_user.email,
        ips: null
    };

    await client.account.update_account(single_ip_restriction);
    try {
        await server.listBuckets().promise();
    } catch (err) {
        assert(err.statusCode === 403, 'expecting read to fail with statusCode 403- AccessDenied');
    }
    await client.account.update_account(no_ip_restriction);
    let data = await server.listBuckets().promise();
    assert(data.Buckets.length !== 0, 'expecting none empty bucket list for none-restricted IP');
    await client.account.update_account(range_ip_restriction);
    try {
        await server.listBuckets().promise();
    } catch (err) {
        assert(err.statusCode === 403, 'expecting read to fail with statusCode 403- AccessDenied');
    }
    await client.account.update_account(no_ip_restriction);
    data = await server.listBuckets().promise();
    assert(data.Buckets.length !== 0, 'expecting none empty bucket list for none-restricted IP');
}

function account_by_name(accounts, email) {
    return accounts.find(account => account.email.unwrap() === email.unwrap());
}

if (require.main === module) {
    main();
}
