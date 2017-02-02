/* Copyright (C) 2016 NooBaa */
'use strict';

var api = require('../../api');
var rpc = api.new_rpc();
var argv = require('minimist')(process.argv);
var P = require('../../util/promise');
var ops = require('./basic_server_ops');
var assert = require('assert');
var dotenv = require('../../util/dotenv');
var AWS = require('aws-sdk');
var https = require('https');
var fs = require('fs');
var uuid = require('node-uuid');


dotenv.load();



var client = rpc.new_client({
    address: 'ws://127.0.0.1:' + process.env.PORT
});

let full_access_user = {
    name: 'full_access',
    email: 'full_access@noobaa.com',
    password: 'master',
    allowed_buckets: ['bucket1', 'bucket2']
};

let bucket1_user = {
    name: 'bucket1_access',
    email: 'bucket1_access@noobaa.com',
    password: 'onlyb1',
    allowed_buckets: ['bucket1']
};

let no_access_user = {
    name: 'no_access',
    email: 'no_access@noobaa.com',
    password: 'goaway',
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
        .then(() => client.bucket.create_bucket({name: 'bucket1'}))
        .then(() => client.bucket.create_bucket({name: 'bucket2'}))
        // add new accounts:
        .then(() => client.account.create_account(full_access_user))
        .then(() => client.account.create_account(bucket1_user))
        .then(() => client.account.create_account(no_access_user))
        .then(() => client.system.read_system())
        .then(system_info => {
            account = account_by_name(system_info.accounts, full_access_user.email);
            full_access_user.access_keys = account.access_keys[0];

            account = account_by_name(system_info.accounts, bucket1_user.email);
            bucket1_user.access_keys = account.access_keys[0];

            account = account_by_name(system_info.accounts, no_access_user.email);
            no_access_user.access_keys = account.access_keys[0];
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

function run_test() {
    return authenticate()
        .then(() => setup())
        .then(() => test_list_buckets_returns_allowed_buckets())
        .then(() => test_bucket_write_allowed())
        .then(() => test_bucket_read_allowed())
        .then(() => test_bucket_list_allowed())
        .then(() => test_bucket_write_denied())
        .then(() => test_bucket_read_denied())
        .then(() => test_bucket_list_denied())
        .then(() => test_create_bucket_add_creator_permissions())
        .then(() => test_delete_bucket_deletes_permissions())
        .then(() => test_no_s3_access())
        .then(() => {
            console.log('test_bucket_access PASSED');
        });
}


/********************Tests:****************************/


function test_list_buckets_returns_allowed_buckets() {
    let account;
    let full_access_user_buckets = 0;
    let bucket1_user_buckets = 0;
    let server = get_new_server(full_access_user);

    return client.system.read_system()
        .then(system_info => {
            account = account_by_name(system_info.accounts, full_access_user.email);
            full_access_user_buckets = (account.allowed_buckets || []).length;

            account = account_by_name(system_info.accounts, bucket1_user.email);
            bucket1_user_buckets = (account.allowed_buckets || []).length;
        })
        .then(() => P.ninvoke(server, 'listBuckets'))
            .then(data => {
                assert(data.Buckets.length === full_access_user_buckets,
                    'expecting ' + full_access_user_buckets + ' buckets in the list, but got ' + data.Buckets.length);

                const buckets = data.Buckets.map(bucket => bucket.Name);
                assert(buckets.indexOf('bucket1') !== -1, 'expecting bucket1 to be in the list');
                assert(buckets.indexOf('bucket2') !== -1, 'expecting bucket2 to be in the list');
            })
            .then(() => {
                server = get_new_server(bucket1_user);
                return P.ninvoke(server, 'listBuckets');
            })
            .then(data => {
                assert(data.Buckets.length === bucket1_user_buckets,
                    'expecting ' + bucket1_user_buckets + ' bucket in the list, but got ' + data.Buckets.length);

                const buckets = data.Buckets.map(bucket => bucket.Name);
                assert(buckets.indexOf('bucket1') !== -1, 'expecting bucket1 to be in the list');
            });
}


function test_bucket_write_allowed() {
    // test upload for allowed user
    return ops.generate_random_file(1)
        .then(fname => {
            // upload with full_access_user to both buckets:
            let server = get_new_server(full_access_user);
            let params1 = {
                Bucket: 'bucket1',
                Key: fname,
                Body: fs.createReadStream(fname)
            };
            let params2 = {
                Bucket: 'bucket2',
                Key: fname,
                Body: fs.createReadStream(fname)
            };
            return P.ninvoke(server, 'upload', params1)
                .then(resp => P.ninvoke(server, 'upload', params2));
        })
        .then(() => {
            return ops.generate_random_file(1)
                .then(fname => {
                    // upload with full_access_user to both buckets:
                    let server = get_new_server(bucket1_user);
                    let params = {
                        Bucket: 'bucket1',
                        Key: fname,
                        Body: fs.createReadStream(fname)
                    };
                    return P.ninvoke(server, 'upload', params);
                });
        });
}


function test_bucket_read_allowed() {
    return ops.generate_random_file(1)
        .then(fname => {
            let server = get_new_server(full_access_user);
            let params1 = {
                Bucket: 'bucket1',
                Key: fname,
                Body: fs.createReadStream(fname)
            };
            return P.ninvoke(server, 'upload', params1)
                .then(() => {
                    let server2 = get_new_server(bucket1_user);
                    let params2 = {
                        Bucket: 'bucket1',
                        Key: fname
                    };
                    return P.ninvoke(server2, 'getObject', params2);
                });
        });
}


function test_bucket_list_allowed() {
    return ops.generate_random_file(1)
        .then(fname => {
            let server = get_new_server(full_access_user);
            let params1 = {
                Bucket: 'bucket1',
                Key: fname,
                Body: fs.createReadStream(fname)
            };
            return P.ninvoke(server, 'upload', params1)
                .then(() => {
                    let server2 = get_new_server(bucket1_user);
                    let params2 = {
                        Bucket: 'bucket1'
                    };
                    return P.ninvoke(server2, 'listObjects', params2);
                });
        });
}


function test_bucket_write_denied() {
    // test upload for allowed user
    return ops.generate_random_file(1)
        .then(fname => {
            // upload with bucket1_user to bucket2
            let server = get_new_server(bucket1_user);
            let params1 = {
                Bucket: 'bucket2',
                Key: fname,
                Body: fs.createReadStream(fname)
            };
            return P.ninvoke(server, 'upload', params1)
                .then(resp => {
                    throw new Error('expecting upload to fail with statusCode 403- AccessDenied');
                })
                .catch(err => {
                    assert(err.statusCode === 403, 'expecting upload to fail with statusCode 403- AccessDenied');
                    return;
                });
        });
}

function test_bucket_read_denied() {
    return ops.generate_random_file(1)
        .then(fname => {
            let server = get_new_server(full_access_user);
            let params1 = {
                Bucket: 'bucket2',
                Key: fname,
                Body: fs.createReadStream(fname)
            };
            return P.ninvoke(server, 'upload', params1)
                .then(() => {
                    let server2 = get_new_server(bucket1_user);
                    let params2 = {
                        Bucket: 'bucket2',
                        Key: fname
                    };
                    return P.ninvoke(server2, 'getObject', params2)
                        .then(resp => {
                            throw new Error('expecting read to fail with statusCode 403- AccessDenied');
                        })
                        .catch(err => {
                            assert(err.statusCode === 403, 'expecting read to fail with statusCode 403- AccessDenied');
                            return;
                        });
                });
        });
}

function test_bucket_list_denied() {
    return ops.generate_random_file(1)
        .then(fname => {
            let server = get_new_server(full_access_user);
            let params1 = {
                Bucket: 'bucket2',
                Key: fname,
                Body: fs.createReadStream(fname)
            };
            return P.ninvoke(server, 'upload', params1)
                .then(() => {
                    let server2 = get_new_server(bucket1_user);
                    let params2 = {
                        Bucket: 'bucket2'
                    };
                    return P.ninvoke(server2, 'listObjects', params2)
                        .then(resp => {
                            throw new Error('expecting read to fail with statusCode 403- AccessDenied');
                        })
                        .catch(err => {
                            assert(err.statusCode === 403, 'expecting read to fail with statusCode 403- AccessDenied');
                            return;
                        });
                });
        });
}


function test_create_bucket_add_creator_permissions() {
    let server = get_new_server(full_access_user);
    let unique_bucket_name = 'bucket' + uuid();
    let params = {
        Bucket: unique_bucket_name
    };
    return P.ninvoke(server, 'createBucket', params)
        // check account server for permissions of full_access_user
        .then(() => client.system.read_system())
        .then(system_info => {
            const allowed_buckets = account_by_name(system_info.accounts, full_access_user.email).allowed_buckets;
            const has_access = allowed_buckets.includes(unique_bucket_name);
            assert(has_access, 'expecting full_access_user to have permissions to access ' + unique_bucket_name);
        });
}

function test_delete_bucket_deletes_permissions() {
    let server = get_new_server(full_access_user);
    let unique_bucket_name = 'bucket' + uuid();

    return P.ninvoke(server, 'createBucket', {Bucket: unique_bucket_name})
        .then(() => client.system.read_system())
        .then(system_info => {
            const user_has_access = account_by_name(system_info.accounts, full_access_user.email)
                .allowed_buckets
                .includes(unique_bucket_name);

            assert(user_has_access, 'expecting full_access_user to have permissions to access ' + unique_bucket_name);
        })
        .then(() => P.ninvoke(server, 'deleteBucket', {Bucket: unique_bucket_name}))
        .then(() => client.system.read_system())
        .then(system_info => {
            const user_has_access = account_by_name(system_info.accounts, full_access_user.email)
                .allowed_buckets
                .includes(unique_bucket_name);

            assert(!user_has_access, 'expecting full_access_user to not have permissions to access ' + unique_bucket_name);
        });
}


function test_no_s3_access() {
    let server = get_new_server(no_access_user);
    return P.ninvoke(server, 'listBuckets')
        .then(data => {
            assert(data.Buckets.length === 0, 'expecting an empty bucket list for no_access_user');
        });

}

function account_by_name(accounts, email) {
    return accounts.find(account => account.email === email);
}

if (require.main === module) {
    main();
}
