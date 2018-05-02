/* Copyright (C) 2016 NooBaa */
'use strict';

var api = require('../../api');
var P = require('../../util/promise');
var dotenv = require('../../util/dotenv');
var ops = require('../utils/basic_server_ops');
var config = require('../../../config.js');
const path = require('path');
var rpc = api.new_rpc();
const promise_utils = require('../../util/promise_utils');
var argv = require('minimist')(process.argv);
const zip_utils = require('../../util/zip_utils');
var assert = require('assert');
var AWS = require('aws-sdk');
var https = require('https');
var fs = require('fs');

dotenv.load();
const TIME_FOR_FUNC_TO_RUN = 15000;
const NUM_OF_RETRIES = 3;

var client = rpc.new_client({
    address: 'ws://127.0.0.1:' + process.env.PORT
});

let full_access_user = {
    name: 'full_access',
    email: 'full_access@noobaa.com',
    password: 'master',
    has_login: true,
    s3_access: true,
    allowed_buckets: {
        full_permission: false,
        permission_list: ['bucket1', 'bucket2']
    },
    default_pool: config.NEW_SYSTEM_POOL_NAME,
};

let bucket1_user = {
    name: 'bucket1_access',
    email: 'bucket1_access@noobaa.com',
    password: 'onlyb1',
    has_login: true,
    s3_access: true,
    allowed_buckets: {
        full_permission: false,
        permission_list: ['bucket1']
    },
    default_pool: config.NEW_SYSTEM_POOL_NAME,
};

const ROLE_ARN = 'arn:aws:iam::112233445566:role/lambda-test';
const POOLS = [config.NEW_SYSTEM_POOL_NAME];

const trigger_based_func = {
    FunctionName: 'create_backup_file',
    Description: 'will create second copy of the same file',
    Runtime: 'nodejs6',
    Handler: 'create_backup_file_func.handler',
    Role: ROLE_ARN,
    MemorySize: 128,
    VpcConfig: {
        SubnetIds: POOLS
    },
    Files: [{
        path: 'create_backup_file_func.js',
        fs_path: path.join(__dirname, '../lambda/create_backup_file_func.js'),
    }]
};

const trigger_based_func2 = {
    FunctionName: 'delete_backup_file',
    Description: 'will create second copy of the same file',
    Runtime: 'nodejs6',
    Handler: 'delete_backup_file_func.handler',
    Role: ROLE_ARN,
    MemorySize: 128,
    VpcConfig: {
        SubnetIds: POOLS
    },
    Files: [{
        path: 'delete_backup_file_func.js',
        fs_path: path.join(__dirname, '../lambda/delete_backup_file_func.js'),
    }]
};

module.exports = {
    run_test: run_test
};

function authenticate() {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return client.create_auth_token(auth_params);
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

function main() {
    return run_test()
        .then(function() {
            process.exit(0);
        })
        .catch(function(err) {
            console.error('run_test failed with error:', err, err.stack);
            process.exit(1);
        });
}

function setup() {
    if (argv.no_setup) {
        return;
    }

    let account;
    return P.resolve()
        // Create test buckets.
        .then(() => client.bucket.create_bucket({ name: 'bucket1' }))
        .then(() => client.bucket.create_bucket({ name: 'bucket2' }))
        // add new accounts:
        .then(() => client.account.create_account(full_access_user))
        .then(() => client.account.create_account(bucket1_user))
        // .then(() => client.account.create_account(no_access_user))
        .then(() => client.system.read_system())
        .then(system_info => {
            account = account_by_name(system_info.accounts, full_access_user.email);
            full_access_user.access_keys = account.access_keys[0];

            account = account_by_name(system_info.accounts, bucket1_user.email);
            bucket1_user.access_keys = account.access_keys[0];

            // account = account_by_name(system_info.accounts, no_access_user.email);
            // no_access_user.access_keys = account.access_keys[0];
        });
}

function get_new_server(user) {
    let access_key = user.access_keys.access_key;
    let secret_key = user.access_keys.secret_key;
    return new AWS.S3({
        endpoint: 'https://127.0.0.1',
        s3ForcePathStyle: true,
        accessKeyId: access_key,
        secretAccessKey: secret_key,
        maxRedirects: 10,
        httpOptions: {
            agent: new https.Agent({
                rejectUnauthorized: false,
            })
        }
    });
}

function get_new_lambda(user) {
    let access_key = user.access_keys.access_key;
    let secret_key = user.access_keys.secret_key;
    return new AWS.Lambda({
        region: 'us-east-1',
        endpoint: 'http://127.0.0.1:' + String(process.env.ENDPOINT_PORT || 80),
        accessKeyId: access_key,
        secretAccessKey: secret_key,
        sslEnabled: false,
    });
}

function run_test() {
    let trigger_id;
    let last_run;
    return authenticate()
        .then(() => setup())
        // .then(() => test_list_buckets_returns_allowed_buckets())
        .then(() => test_add_function(bucket1_user, trigger_based_func))
        .then(() => test_add_bucket_trigger('ObjectCreated', trigger_based_func))
        .then(() => client.system.read_system())
        .then(system_info => {
            const bucket = bucket_by_name(system_info.buckets, 'bucket1');
            trigger_id = bucket.triggers[0].id;
        })
        .then(() => test_trigger_run_when_should(bucket1_user, 'file0.dat'))
        .then(() => client.system.read_system())
        .then(system_info => {
            const bucket = bucket_by_name(system_info.buckets, 'bucket1');
            last_run = bucket.triggers[0].last_run;
        })
        .then(() => test_trigger_dont_run_when_shouldnt(bucket1_user, 'file1.notdat'))
        .then(() => {
            console.log('disabling bucket lambda trigger.');
            return client.bucket.update_bucket_lambda_trigger({
                bucket_name: 'bucket1',
                id: trigger_id,
                enabled: false
            });
        })
        .then(() => test_trigger_dont_run_when_shouldnt(bucket1_user, 'file2.dat'))
        .then(() => {
            console.log('enabling bucket lambda trigger.');
            return client.bucket.update_bucket_lambda_trigger({
                bucket_name: 'bucket1',
                id: trigger_id,
                enabled: true
            });
        })
        .then(() => test_trigger_run_when_should(bucket1_user, 'file3.dat'))
        .then(() => {
            console.log('changing bucket lambda trigger prefix to /bla.');
            return client.bucket.update_bucket_lambda_trigger({
                bucket_name: 'bucket1',
                id: trigger_id,
                object_prefix: '/bla'
            });
        })
        .then(() => test_trigger_dont_run_when_shouldnt(bucket1_user, '/tmp/file4.dat'))
        .then(() => {
            console.log('changing bucket lambda trigger prefix to /tmp.');
            return client.bucket.update_bucket_lambda_trigger({
                bucket_name: 'bucket1',
                id: trigger_id,
                object_prefix: '/tmp'
            });
        })
        .then(() => test_trigger_run_when_should(bucket1_user, '/tmp/file5.dat'))
        .then(() => client.system.read_system())
        .then(system_info => {
            console.log('Checking that last_run of bucket_trigger has advanced');
            const bucket = bucket_by_name(system_info.buckets, 'bucket1');
            const last_run_new = bucket.triggers[0].last_run;
            assert(last_run_new > last_run, `expecting last run to advance but didn't. previous last_run: ${new Date(last_run)} new last_run: ${new Date(last_run_new)}`);
            console.log(`last run has advanced as should. previous last_run: ${new Date(last_run)} new last_run: ${new Date(last_run_new)}`);
        })
        .then(() => test_trigger_run_when_should_multi(bucket1_user, '/tmp/multi-file', '.dat', 10))
        .then(() => client.bucket.update_bucket_s3_access({
            name: 'bucket1',
            allowed_accounts: ['full_access@noobaa.com']
        }))
        .then(() => test_trigger_dont_run_when_shouldnt(full_access_user, '/tmp/file6.dat')) // should fail as bucket1_user is the runner of the function
        .then(() => test_add_function(full_access_user, trigger_based_func2))
        .then(() => test_add_bucket_trigger('ObjectRemoved', trigger_based_func2))
        .then(() => test_delete_trigger_run(full_access_user, 'file3.dat'))
        .then(() => {
            console.log('test_bucket_lambda_triggers PASSED');
        });
}


/********************Tests:****************************/

function test_add_function(user, func) {
    let lambda = get_new_lambda(user);
    return prepare_func(func)
        .then(() => P.fromCallback(callback => lambda.deleteFunction({
                FunctionName: func.FunctionName,
            }, callback))
            .catch(err => {
                console.log('Delete function if exist:', func.FunctionName, err.message);
            }))
        .then(() => P.fromCallback(callback => lambda.createFunction(func, callback)))
        .then(() => console.log('function created.'));
}

function test_add_bucket_trigger(type, func) {
    return P.resolve()
        .then(() => client.bucket.add_bucket_lambda_trigger({
            bucket_name: 'bucket1',
            object_suffix: '.dat',
            func_name: func.FunctionName,
            event_name: type
        }))
        .then(() => console.log('bucket lambda trigger created.'));
}

function test_trigger_run_when_should(user, file_param) {
    let s3 = get_new_server(user);
    let file_not_created = true;
    let retries = 0;
    return ops.generate_random_file(1)
        .then(fname => {
            let params1 = {
                Bucket: 'bucket1',
                Key: file_param,
                Body: fs.createReadStream(fname)
            };
            return P.fromCallback(callback => s3.upload(params1, callback));
        })
        .then(() => promise_utils.pwhile(() => (retries < NUM_OF_RETRIES && file_not_created),
            () => {
                let params2 = {
                    Bucket: 'bucket1',
                    Key: file_param + '.json'
                };
                return P.fromCallback(callback => s3.headObject(params2, callback))
                    .then(() => {
                        file_not_created = false;
                    })
                    .catch(err => {
                        if (err.statusCode === 404) {
                            retries += 1;
                            console.log('file wasn\'t created yet...');
                            return P.delay(TIME_FOR_FUNC_TO_RUN);
                        } else {
                            throw new Error('expecting head to fail with statusCode 404 - File not found but got different error', err);
                        }
                    });
            }))
        .then(() => {
            assert(file_not_created === false, 'expecting file to be created but didn\'t');
            console.log('bucket lambda trigger worked. file created for:', file_param);
        });
}

function test_trigger_dont_run_when_shouldnt(user, file_param) {
    let s3 = get_new_server(user);
    return ops.generate_random_file(1)
        .then(fname => {
            let params1 = {
                Bucket: 'bucket1',
                Key: file_param,
                Body: fs.createReadStream(fname)
            };
            return P.fromCallback(callback => s3.upload(params1, callback));
        })
        .delay(TIME_FOR_FUNC_TO_RUN) // wait for the function to run...
        .then(() => {
            let params2 = {
                Bucket: 'bucket1',
                Key: file_param + '.json'
            };
            return P.fromCallback(callback => s3.headObject(params2, callback));
        })
        .then(resp => {
            throw new Error('expecting head to fail with statusCode 404 - File not found');
        })
        .catch(err => {
            assert(err.statusCode === 404, 'expecting upload to fail with statusCode 404 - File not found' + err.statusCode);
            console.log('bucket lambda trigger worked. file not created for:', file_param);
        });
}

function test_delete_trigger_run(user, file_param) {
    let s3 = get_new_server(user);
    let params = {
        Bucket: 'bucket1',
        Key: file_param
    };
    let params2 = {
        Bucket: 'bucket1',
        Key: file_param + '.json'
    };
    let file_not_deleted = true;
    let retries = 0;
    return P.fromCallback(callback => s3.headObject(params2, callback))
        .catch(err => {
            console.log('json file not exist - test can\'t succeed:', file_param + '.json', err);
            throw new Error('expecting head to fail with statusCode 404 - File not found');
        })
        .then(() => P.fromCallback(callback => s3.deleteObject(params, callback)))
        .then(() => promise_utils.pwhile(() => (retries < NUM_OF_RETRIES && file_not_deleted),
            () => P.fromCallback(callback => s3.headObject(params2, callback))
            .then(() => {
                retries += 1;
                console.log('file wasn\'t deleted yet...');
                return P.delay(TIME_FOR_FUNC_TO_RUN);
            })
            .catch(err => {
                if (err.statusCode === 404) {
                    file_not_deleted = false;
                } else {
                    throw new Error('expecting head to fail with statusCode 404 - File not found but got different error', err);
                }
            })))
        .then(() => {
            assert(file_not_deleted === false, 'expecting file to be deleted but didn\'t');
            console.log('bucket lambda trigger worked. file deleted for:', file_param);
        });
}

function test_trigger_run_when_should_multi(user, files_prefix, suffix, num_of_files) {
    let s3 = get_new_server(user);
    const names = [];
    for (let i = 0; i < num_of_files; ++i) {
        names.push(files_prefix + '_no_' + i + suffix);
    }
    return ops.generate_random_file(1)
        .then(fname => P.map(names, name => {
            let params1 = {
                Bucket: 'bucket1',
                Key: name,
                Body: fs.createReadStream(fname)
            };
            return P.fromCallback(callback => s3.upload(params1, callback));
        }))
        .delay(TIME_FOR_FUNC_TO_RUN * 2) // wait for the functions to run...
        .then(() => {
            let params2 = {
                Bucket: 'bucket1',
                Prefix: files_prefix
            };
            return P.fromCallback(callback => s3.listObjects(params2, callback));
        })
        .then(data => {
            assert(data.Contents.length === (num_of_files * 2), `bucket lambda trigger failed. files created: ${data.Contents}`);
            console.log(`bucket lambda trigger worked. files ${data.Contents.length} created`);
        });
}

function account_by_name(accounts, email) {
    return accounts.find(account => account.email === email);
}

function bucket_by_name(buckets, name) {
    return buckets.find(bucket => bucket.name === name);
}

if (require.main === module) {
    main();
}
