/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
if (argv.log_file) {
    dbg.set_log_to_file(argv.log_file);
}
dbg.set_process_name('test_bucket_lambda_triggers');

const _ = require('lodash');
const api = require('../../api');
const P = require('../../util/promise');
const dotenv = require('../../util/dotenv');
const ops = require('../utils/basic_server_ops');
const path = require('path');
const rpc = api.new_rpc();
const zip_utils = require('../../util/zip_utils');
const assert = require('assert');
const AWS = require('aws-sdk');
const fs = require('fs');
const test_utils = require('./test_utils');

dotenv.load();

const {
    mgmt_ip = 'localhost',
        mgmt_port = '8080',
        s3_ip = 'localhost',
        s3_port = '80',
} = argv;


/***         Config         ***/
const TIME_FOR_FUNC_TO_RUN = 15000;
const TIME_FOR_SDK_TO_UPDATE = 60000;
const NUM_OF_RETRIES = 10;
const POOL_NAME = 'test-pool';

var client = rpc.new_client({
    address: `ws://${mgmt_ip}:${mgmt_port}`
});

let full_access_user = {
    name: 'full_access',
    email: 'full_access@noobaa.com',
    password: 'master',
    has_login: true,
    s3_access: true,
    default_resource: POOL_NAME,
};

let bucket1_user = {
    name: 'bucket1_access',
    email: 'bucket1_access@noobaa.com',
    password: 'onlyb1',
    has_login: true,
    s3_access: true,
    default_resource: POOL_NAME,
};

const external_connection = {
    auth_method: 'AWS_V2',
    endpoint: `http://${s3_ip}:${s3_port}`,
    endpoint_type: 'S3_COMPATIBLE',
    identity: '123',
    secret: 'abc',
    name: 'conn1'
};

const ROLE_ARN = 'arn:aws:iam::112233445566:role/lambda-test';

const trigger_based_func_create = {
    FunctionName: 'create_backup_file',
    Description: 'will create second copy of the same file',
    Runtime: 'nodejs6',
    Handler: 'create_backup_file_func.handler',
    Role: ROLE_ARN,
    MemorySize: 128,
    VpcConfig: {
        SubnetIds: [POOL_NAME]
    },
    Files: [{
        path: 'create_backup_file_func.js',
        fs_path: path.join(__dirname, '../lambda/create_backup_file_func.js'),
    }]
};

const trigger_based_func_delete = {
    FunctionName: 'delete_backup_file',
    Description: 'will create second copy of the same file',
    Runtime: 'nodejs6',
    Handler: 'delete_backup_file_func.handler',
    Role: ROLE_ARN,
    MemorySize: 128,
    VpcConfig: {
        SubnetIds: [POOL_NAME]
    },
    Files: [{
        path: 'delete_backup_file_func.js',
        fs_path: path.join(__dirname, '../lambda/delete_backup_file_func.js'),
    }]
};

const trigger_based_func_read = {
    FunctionName: 'read_backup_file',
    Description: 'will create second copy of the same file',
    Runtime: 'nodejs6',
    Handler: 'create_backup_file_func.handler',
    Role: ROLE_ARN,
    MemorySize: 128,
    VpcConfig: {
        SubnetIds: [POOL_NAME]
    },
    Files: [{
        path: 'create_backup_file_func.js',
        fs_path: path.join(__dirname, '../lambda/create_backup_file_func.js'),
    }]
};


/***         Utils         ***/

async function authenticate() {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    await client.create_auth_token(auth_params);
}

function prepare_func(fn) {
    return P.resolve()
        .then(() => zip_utils.zip_from_files(fn.Files))
        .then(zipfile => zip_utils.zip_to_buffer(zipfile))
        .then(zip_buffer => {
            delete fn.Files;
            fn.Code = {
                ZipFile: zip_buffer
            };
        });
}

function get_new_server(user) {
    let access_key = user.access_keys.access_key.unwrap();
    let secret_key = user.access_keys.secret_key.unwrap();
    return new AWS.S3({
        endpoint: `http://${s3_ip}:${s3_port}`,
        s3ForcePathStyle: true,
        accessKeyId: access_key,
        secretAccessKey: secret_key,
        maxRedirects: 10,
    });
}

function get_new_lambda(user) {
    let access_key = user.access_keys.access_key.unwrap();
    let secret_key = user.access_keys.secret_key.unwrap();
    return new AWS.Lambda({
        region: 'us-east-1',
        endpoint: `http://${s3_ip}:${s3_port}`,
        accessKeyId: access_key,
        secretAccessKey: secret_key,
        sslEnabled: false,
    });
}

function account_by_name(accounts, email) {
    return accounts.find(account => account.email.unwrap() === email);
}

function bucket_by_name(buckets, name) {
    return buckets.find(bucket => bucket.name.unwrap() === name);
}

/***         Tests         ***/

async function setup() {
    const triggered_buckets = ['bucket1', 'ns.external.bucket1'];
    let account;
    let system_info = await client.system.read_system();
    // const internal_resource = system_info.pools.find(item => item.name.indexOf('system-internal') > -1).name;
    if (!argv.no_setup) {
        await test_utils.create_hosts_pool(client, POOL_NAME, 3);

        // Create test buckets.
        await client.bucket.create_bucket({ name: 'bucket1' });
        await client.bucket.create_bucket({ name: 'bucket2' });

        // //find the internal pool and set spillover on thge buckets

        // await client.bucket.update_bucket({ name: 'bucket1', spillover: internal_resource });
        // await client.bucket.update_bucket({ name: 'bucket2', spillover: internal_resource });

        // Create NS buckets and resources
        await client.bucket.create_bucket({ name: 'ns.internal.bucket1' });
        await client.bucket.create_bucket({ name: 'ns.internal.bucket2' });

        // await client.bucket.update_bucket({ name: 'ns.internal.bucket1', spillover: internal_resource });
        // await client.bucket.update_bucket({ name: 'ns.internal.bucket2', spillover: internal_resource });

        await client.account.add_external_connection(external_connection);

        await client.pool.create_namespace_resource({
            connection: external_connection.name,
            name: 'ns.rsc.on.buck1',
            target_bucket: 'ns.internal.bucket1'
        });

        await client.pool.create_namespace_resource({
            connection: external_connection.name,
            name: 'ns.rsc.on.buck2',
            target_bucket: 'ns.internal.bucket2'
        });
        const nsr1 = { resource: 'ns.rsc.on.buck1' };
        const nsr2 = { resource: 'ns.rsc.on.buck2' };
        await client.bucket.create_bucket({
            name: 'ns.external.bucket1',
            namespace: {
                read_resources: [ nsr1 ],
                write_resource: nsr2
            }
        });

        // add new accounts:
        await client.account.create_account(_.clone(full_access_user));
        await client.account.create_account(_.clone(bucket1_user));
    }

    system_info = await client.system.read_system();

    account = account_by_name(system_info.accounts, full_access_user.email);
    full_access_user.access_keys = account.access_keys[0];

    account = account_by_name(system_info.accounts, bucket1_user.email);
    bucket1_user.access_keys = account.access_keys[0];

    return triggered_buckets;
}

async function run_test() {
    let trigger_id;
    let last_run;
    let last_run_new;
    let system_info;
    let bucket;
    await authenticate();
    const target_buckets = await setup();

    console.log(`Adding functions trigger_based_func_create, trigger_based_func_delete`);
    await test_add_function(bucket1_user, trigger_based_func_create);
    await test_add_function(full_access_user, trigger_based_func_delete);
    await test_add_function(bucket1_user, trigger_based_func_read);

    for (const b of target_buckets) {
        console.log(`Running test on ${b}`);
        //Test create trigger
        console.log(`Adding trigger for ${b}`);
        await test_add_bucket_trigger('ObjectCreated', trigger_based_func_create, b);
        system_info = await client.system.read_system();
        bucket = bucket_by_name(system_info.buckets, b);
        trigger_id = bucket.triggers[0].id;
        console.log(`testing trigger invoked for ${b}`);
        await test_trigger_run_when_should(bucket1_user, 'file0.dat', b);
        system_info = await client.system.read_system();
        bucket = bucket_by_name(system_info.buckets, b);
        last_run = bucket.triggers[0].last_run;

        console.log(`testing trigger not invoked for ${b}`);
        await test_trigger_dont_run_when_shouldnt(bucket1_user, 'file1.notdat', b);
        console.log(`disabling bucket lambda trigger on ${b}`);
        await client.bucket.update_bucket_lambda_trigger({
            bucket_name: b,
            id: trigger_id,
            enabled: false
        });
        await P.delay(TIME_FOR_SDK_TO_UPDATE);

        console.log(`testing trigger not invoked after removed for ${b}`);
        await test_trigger_dont_run_when_shouldnt(bucket1_user, 'file2.dat', b);
        console.log(`enabling bucket lambda trigger on ${b}`);
        await client.bucket.update_bucket_lambda_trigger({
            bucket_name: b,
            id: trigger_id,
            enabled: true
        });
        await P.delay(TIME_FOR_SDK_TO_UPDATE);
        await test_trigger_run_when_should(bucket1_user, 'file3.dat', b);
        // Used for DeleteObjects later on
        await test_trigger_run_when_should(bucket1_user, 'sloth_multiple.dat', b);
        console.log(`changing bucket lambda trigger prefix to /bla. on ${b}`);
        await client.bucket.update_bucket_lambda_trigger({
            bucket_name: b,
            id: trigger_id,
            object_prefix: '/bla'
        });
        await P.delay(TIME_FOR_SDK_TO_UPDATE);

        await test_trigger_dont_run_when_shouldnt(bucket1_user, '/tmp/file4.dat', b);
        console.log(`changing bucket lambda trigger prefix to /tmp on ${b}`);
        await client.bucket.update_bucket_lambda_trigger({
            bucket_name: b,
            id: trigger_id,
            object_prefix: '/tmp'
        });
        await P.delay(TIME_FOR_SDK_TO_UPDATE);

        await test_trigger_run_when_should(bucket1_user, '/tmp/file5.dat', b);
        system_info = await client.system.read_system();
        console.log(`Checking that last_run of bucket_trigger has advanced for ${b}`);
        bucket = bucket_by_name(system_info.buckets, b);
        last_run_new = bucket.triggers[0].last_run;
        assert(last_run_new > last_run, `expecting last run to advance but didn't. previous last_run: ${new Date(last_run)} new last_run: ${new Date(last_run_new)}`);
        console.log(`last run has advanced as should for ${b}. previous last_run: ${new Date(last_run)} new last_run: ${new Date(last_run_new)}`);

        console.log(`Checking that multi delete triggers as should for ${b}`);
        await test_trigger_run_when_should_multi(bucket1_user, b, '/tmp/multi-file', '.dat', 10);
        // should fail as bucket1_user was removed from bucket access and is the runner of the function
        await test_trigger_dont_run_when_shouldnt(full_access_user, '/tmp/file6.dat', b);

        console.log(`Checking object removed trigger for ${b}`);
        await test_add_bucket_trigger('ObjectRemoved', trigger_based_func_delete, b);
        await test_delete_trigger_run(full_access_user, 'file3.dat', b);
        await test_delete_trigger_run(full_access_user, 'sloth_multiple.dat', b, /* multiple */ true);
    }

    console.log('test_bucket_lambda_triggers PASSED');
}

async function test_add_function(user, func) {
    let lambda = get_new_lambda(user);
    await prepare_func(func);

    try {
        await lambda.deleteFunction({ FunctionName: func.FunctionName }).promise();
    } catch (err) {
        console.log('Delete function if exist:', func.FunctionName, err.message);
    }

    await lambda.createFunction(func).promise();
    console.log('function created.');
}

async function test_add_bucket_trigger(type, func, bucketname) {
    console.log(`adding trigger ${type} for ${bucketname}`);
    await client.bucket.add_bucket_lambda_trigger({
        bucket_name: bucketname,
        object_suffix: '.dat',
        func_name: func.FunctionName,
        event_name: type
    });
    await P.delay(TIME_FOR_SDK_TO_UPDATE);
    console.log('bucket lambda trigger created.');
}

async function test_trigger_run_when_should(user, file_param, bucketname) {
    console.log(`test trigger run for ${bucketname}`);
    let s3 = get_new_server(user);
    let file_not_created = true;
    let retries = 0;
    const fname = await ops.generate_random_file(1);
    let params1 = {
        Bucket: bucketname,
        Key: file_param,
        Body: fs.createReadStream(fname)
    };
    await s3.upload(params1).promise();
    while (retries < NUM_OF_RETRIES && file_not_created) {
        let params2 = {
            Bucket: bucketname,
            Key: file_param + '.json'
        };
        try {
            await s3.headObject(params2).promise();
            file_not_created = false;
        } catch (err) {
            if (err.statusCode === 404) {
                retries += 1;
                console.log('file wasn\'t created yet...');
                await P.delay(TIME_FOR_FUNC_TO_RUN);
            } else {
                throw new Error(`expecting head to fail with statusCode 404 - File not found but got different error ${err}`);
            }
        }
    }

    assert(file_not_created === false, `expecting file to be created but didn't uploaded ${bucketname}/${file_param} , retries ${retries}`);
    console.log(`bucket lambda trigger worked. file created for: ${bucketname}/${file_param}`);
}

async function test_trigger_dont_run_when_shouldnt(user, file_param, bucketname) {
    console.log(`test trigger should not run for ${bucketname}`);
    let s3 = get_new_server(user);
    const fname = await ops.generate_random_file(1);

    let params1 = {
        Bucket: bucketname,
        Key: file_param,
        Body: fs.createReadStream(fname)
    };
    await s3.upload(params1).promise();
    await P.delay(TIME_FOR_FUNC_TO_RUN);

    let params2 = {
        Bucket: bucketname,
        Key: file_param + '.json'
    };

    try {
        await s3.headObject(params2).promise();
        throw new Error(`expecting head to fail with statusCode 404 - File not found ${bucketname}/${file_param}`);
    } catch (err) {
        assert(err.statusCode === 404, 'expecting upload to fail with statusCode 404 - File not found' + err.statusCode);
        console.log(`bucket lambda trigger worked. file not created for: ${bucketname}/${file_param}`);
    }
}

async function test_delete_trigger_run(user, file_param, bucketname, multiple) {
    console.log(`test delete trigger run for ${bucketname}`);
    let s3 = get_new_server(user);
    let params = {
        Bucket: bucketname,
        Key: file_param
    };
    let params2 = {
        Bucket: bucketname,
        Key: file_param + '.json'
    };
    let file_not_deleted = true;
    let retries = 0;
    try {
        await s3.headObject(params2).promise();
    } catch (err) {
        console.log('json file not exist - test can\'t succeed:', file_param + '.json', err);
        throw new Error(`expecting head to fail with statusCode 404 - File not found ${bucketname}/${file_param}`);
    }

    if (multiple) {
        await s3.deleteObjects({
            Bucket: bucketname,
            Delete: { Objects: [_.pick(params, 'Key')] },
        }).promise();
    } else {
        await s3.deleteObject(params).promise();
    }

    while (retries < NUM_OF_RETRIES && file_not_deleted) {
        try {
            await s3.headObject(params2).promise();
            retries += 1;
            console.log('file wasn\'t deleted yet...');
            await P.delay(TIME_FOR_FUNC_TO_RUN);
        } catch (err) {
            if (err.statusCode === 404) {
                file_not_deleted = false;
            } else {
                throw new Error(`expecting head to fail with statusCode 404 - File not found but got different error ${err}`);
            }
        }
    }

    assert(file_not_deleted === false, `expecting file to be deleted but didn't ${bucketname}/${file_param} retries ${retries}`);
    console.log(`bucket lambda trigger worked. file deleted for: ${bucketname}/${file_param}`);
}

async function test_trigger_run_when_should_multi(user, bucketname, files_prefix, suffix, num_of_files) {
    console.log(`test multi delete trigger should run for ${bucketname}`);
    let s3 = get_new_server(user);
    const names = [];
    for (let i = 0; i < num_of_files; ++i) {
        names.push(files_prefix + '_no_' + i + suffix);
    }
    const fname = await ops.generate_random_file(1);

    await P.map(names, name => {
        let params1 = {
            Bucket: bucketname,
            Key: name,
            Body: fs.createReadStream(fname)
        };
        return s3.upload(params1).promise();
    });
    await P.delay(TIME_FOR_FUNC_TO_RUN * 2); // wait for the functions to run...

    let params2 = {
        Bucket: bucketname,
        Prefix: files_prefix
    };
    const data = await s3.listObjects(params2).promise();

    assert(data.Contents.length === (num_of_files * 2), `bucket ${bucketname} lambda trigger failed. files created: ${data.Contents}`);
    console.log(`bucket lambda trigger worked. files ${data.Contents.length} created on ${bucketname}`);
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

module.exports = {
    run_test: run_test
};

if (require.main === module) {
    main();
}
