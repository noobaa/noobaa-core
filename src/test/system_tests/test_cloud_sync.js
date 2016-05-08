'use strict';

var api = require('../../api');
var rpc = api.new_rpc();
var target_rpc = api.new_rpc();
var argv = require('minimist')(process.argv);
var P = require('../../util/promise');
var ops = require('./basic_server_ops');
var _ = require('lodash');
var assert = require('assert');
var promise_utils = require('../../util/promise_utils');
var dotenv = require('dotenv');
dotenv.load();

// var dbg = require('../util/debug_module')(__filename);


let TEST_CTX = {
    connection_name: 'test_connection',
    source_ip: '127.0.0.1',
    source_bucket: 'files',
    target_ip: argv.target_ip || '127.0.0.1',
    target_port: argv.target_port || process.env.PORT,
    target_bucket: argv.target_bucket || 'target'
};



var client = rpc.new_client({
    address: 'ws://127.0.0.1:' + process.env.PORT
});

var target_client = target_rpc.new_client({
    address: 'ws://' + TEST_CTX.target_ip + ':' + TEST_CTX.target_port
});

module.exports = {
    run_test: run_test
};

function authenticate() {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo',
        system: 'demo'
    };
    return P.fcall(function() {
            return client.create_auth_token(auth_params);
        })
        .delay(1000)
        .then(function() {
            return target_client.create_auth_token(auth_params);
        });
}


function set_cloud_sync(params) {
    return P.when()
        .then(
            () => client.account.add_account_sync_credentials_cache({
                name: TEST_CTX.connection_name,
                endpoint: TEST_CTX.target_ip,
                access_key: '123',
                secret_key: 'abc'
            })
        )
        .then(
            () => client.bucket.set_cloud_sync({
                name: TEST_CTX.source_bucket,
                connection: TEST_CTX.connection_name,
                policy: {
                    target_bucket: TEST_CTX.target_bucket,
                    c2n_enabled: params.c2n,
                    n2c_enabled: params.n2c,
                    schedule: 1,
                    additions_only: !params.deletions
                }
            })
        )
        .fail(
            error => {
                console.warn('Failed with', error, error.stack);
                process.exit(0);
            }
        );
}

function compare_object_lists(file_names, fail_msg, expected_len) {
    let timeout_ms = 3 * 60 * 1000; // 3 wait up to 3 minutes for changes to sync
    let start_ts = Date.now();
    let done = false;
    var source_list;
    var target_list;
    return promise_utils.pwhile(
            () => {
                let diff = Date.now() - start_ts;
                return (diff < timeout_ms && !done);
            },
            () => {
                return client.object.list_objects({
                        bucket: TEST_CTX.source_bucket
                    })
                    // get objects list on the source
                    .then(function(source_objects) {
                        source_list = _.map(source_objects.objects, 'key');
                        return target_client.object.list_objects({
                            bucket: TEST_CTX.target_bucket
                        });
                    })
                    .then((target_objects) => {
                        target_list = _.map(target_objects.objects, 'key');
                        // sort all lists:
                        source_list.sort();
                        target_list.sort();
                        if (!_.isUndefined(expected_len)) {
                            done = (source_list.length === expected_len && target_list.length === expected_len);
                        } else {
                            done = (target_list.length === source_list.length);
                        }
                    })
                    .delay(10000); // wait 10 seconds between each check
            }
        )
        .then(function() {
            assert(target_list.length === source_list.length, fail_msg + ': mismatch between lists length.');
            for (var i = 0; i < source_list.length; i++) {
                assert(target_list[i] === source_list[i], fail_msg + ': mismatch between sorce\\target objects:',
                    target_list[i], source_list[i]);
            }
            if (!_.isUndefined(expected_len)) {
                assert(source_list.length === expected_len, fail_msg + ': expected_len is ' + expected_len + '. got source_list.length=' + source_list.length);
            }
            console.log('source bucket and target bucket are synced. sync took ~', (Date.now() - start_ts) / 1000, 'seconds');
        });
}

function verify_object_lists_after_delete(file_names, fail_msg, deleted_from_target) {
    let timeout_ms = 3 * 60 * 1000; // 3 wait up to 3 minutes for changes to sync
    let start_ts = Date.now();
    let done = false;
    var source_list;
    var target_list;
    return promise_utils.pwhile(
            () => {
                let diff = Date.now() - start_ts;
                return (diff < timeout_ms && !done);
            },
            () => {
                return client.object.list_objects({
                        bucket: TEST_CTX.source_bucket
                    })
                    // get objects list on the source
                    .then(function(source_objects) {
                        source_list = _.map(source_objects.objects, 'key');
                        return target_client.object.list_objects({
                            bucket: TEST_CTX.target_bucket
                        });
                    })
                    .then((target_objects) => {
                        target_list = _.map(target_objects.objects, 'key');
                        // sort all lists:
                        source_list.sort();
                        target_list.sort();
                        done = (Math.abs(source_list.length - target_list.length) === file_names.length);
                    })
                    .delay(10000); // wait 10 seconds between each check
            }
        )
        .then(function() {
            let list_cmp;
            file_names.sort();
            if (deleted_from_target) {
                list_cmp = _.difference(source_list, target_list);
                list_cmp.sort();
            } else {
                list_cmp = _.difference(target_list, source_list);
                list_cmp.sort();
            }

            assert(list_cmp.length === file_names.length, fail_msg + ': mismatch between lists length.');

            for (var i = 0; i < list_cmp.length; i++) {
                assert(list_cmp[i] === file_names[i], fail_msg + ': mismatch between sorce\\target objects:',
                    list_cmp[i], file_names[i]);
            }

            console.log('source bucket and target bucket are synced. sync took ~', (Date.now() - start_ts) / 1000, 'seconds');
        });
}

function main() {
    return run_test()
        .then(function() {
            process.exit(0);
        })
        .fail(function(err) {
            process.exit(1);
        });
}

function run_test() {
    let file_sizes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let file_names = [];
    let expected_after_del = 0;
    return authenticate()
        .then(() => {
            let should_create_bucket = _.isUndefined(argv.target_bucket);
            if (should_create_bucket) {
                client.tier.create_tier({
                        name: 'tier1',
                        pools: ['default_pool'],
                        data_placement: 'SPREAD'
                    })
                    .then(() =>
                        client.tiering_policy.create_policy({
                            name: 'tiering1',
                            tiers: [{
                                order: 0,
                                tier: 'tier1'
                            }]
                        }))
                    .then(() => client.bucket.create_bucket({
                        name: 'target',
                        tiering: 'tiering1',
                    }));
            }
        })
        .then(() => P.all(_.map(file_sizes, ops.generate_random_file)))
        .then(function(res_file_names) {
            let i = 0;
            file_names = res_file_names;
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i++];
                    console.log('calling upload_file(', fname, ')');
                    return ops.upload_file(TEST_CTX.source_ip, fname, TEST_CTX.source_bucket, fname)
                        .delay(1000);
                });
        })
        .then(() => {
            // start cloud sync from source to target and check file list on the target.
            let cloud_sync_params = {
                n2c: true,
                c2n: true,
                deletions: true
            };
            return set_cloud_sync(cloud_sync_params)
                .then(() => {
                    console.log('set cloud_sync with these params:', cloud_sync_params, ' waiting for changes to sync');

                })
                .then(function() {
                    //check target file list against local
                    return compare_object_lists(file_names, 'sync source to target failed');
                });
        })
        .then(() => P.all(_.map(file_sizes, ops.generate_random_file)))
        .then(function(res_file_names) {
            let i = 0;
            file_names = res_file_names;
            console.log('uploading files to  target bucket');
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i++];
                    console.log('calling upload_file(', fname, ')');
                    return ops.upload_file(TEST_CTX.target_ip, fname, TEST_CTX.target_bucket, fname)
                        .delay(1000);
                });
        })
        .then(() => console.log('uploaded files to target bucket. waiting for changes to sync'))
        // .delay(60000 * 2)
        .then(function() {
            //check target file list against local
            return compare_object_lists(file_names, 'sync target additions to source failed');
        })
        .then(function() {
            let i = 0;
            console.log('deleting from source files that were uploaded to target');
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i++];
                    let obj_path = {
                        bucket: 'files',
                        key: fname
                    };
                    return client.object.delete_object(obj_path);
                });
        })
        // list objects on target to verify the number of objects later
        .then(function() {
            return client.object.list_objects({
                bucket: TEST_CTX.source_bucket
            });

        })
        .then((obj_list) => {
            expected_after_del = obj_list.objects.length;
            console.log('waiting for deletions to sync for 3 minutes..');
        })
        // .delay(2 * 60000)
        .then(() => compare_object_lists(file_names, 'sync deletions from source to target failed', expected_after_del))
        .then(function() {
            // remove cloud_sync policy
            console.log('removing cloud_sync policy');
            return client.bucket.delete_cloud_sync({
                name: 'files'
            });
        })
        .then(() => {
            // start cloud sync from source to target and check file list on the target.
            let cloud_sync_params = {
                n2c: true,
                c2n: false,
                deletions: false
            };
            return set_cloud_sync(cloud_sync_params)
                .then(() => {
                    console.log('set cloud_sync with these params:', cloud_sync_params, ' waiting for changes to sync');

                })
                .then(function() {
                    //check target file list against local
                    return compare_object_lists(file_names, 'sync source to target failed');
                });
        })
        .then(() => P.all(_.map(file_sizes, ops.generate_random_file)))
        .then(function(res_file_names) {
            let i = 0;
            file_names = res_file_names;
            console.log('uploading files to  target bucket');
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i++];
                    console.log('calling upload_file(', fname, ')');
                    return ops.upload_file(TEST_CTX.source_ip, fname, TEST_CTX.source_bucket, fname)
                        .delay(1000);
                });
        })
        .then(() => console.log('uploaded files to target bucket. waiting for changes to sync'))
        // .delay(60000 * 2)
        .then(function() {
            //check target file list against local
            return compare_object_lists(file_names, 'sync target additions to source failed');
        })
        .then(function() {
            let i = 0;
            console.log('deleting from source files that were uploaded to target');
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i++];
                    let obj_path = {
                        bucket: 'files',
                        key: fname
                    };
                    return client.object.delete_object(obj_path);
                });
        })
        .then(() => verify_object_lists_after_delete(file_names, 'sync deletions from source to target failed', false))
        .then(function() {
            // remove cloud_sync policy
            console.log('removing cloud_sync policy');
            return client.bucket.delete_cloud_sync({
                name: 'files'
            });
        })
        .then(() => {
            // start cloud sync from source to target and check file list on the target.
            let cloud_sync_params = {
                n2c: false,
                c2n: true,
                deletions: false
            };
            return set_cloud_sync(cloud_sync_params)
                .then(() => {
                    console.log('set cloud_sync with these params:', cloud_sync_params, ' waiting for changes to sync');

                })
                .then(function() {
                    //check target file list against local
                    return compare_object_lists(file_names, 'sync source to target failed');
                });
        })
        .then(() => P.all(_.map(file_sizes, ops.generate_random_file)))
        .then(function(res_file_names) {
            let i = 0;
            file_names = res_file_names;
            console.log('uploading files to  target bucket');
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i++];
                    console.log('calling upload_file(', fname, ')');
                    return ops.upload_file(TEST_CTX.target_ip, fname, TEST_CTX.target_bucket, fname)
                        .delay(1000);
                });
        })
        .then(() => console.log('uploaded files to target bucket. waiting for changes to sync'))
        // .delay(60000 * 2)
        .then(function() {
            //check target file list against local
            return compare_object_lists(file_names, 'sync target additions to source failed');
        })
        .then(function() {
            let i = 0;
            console.log('deleting from source files that were uploaded to target');
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i++];
                    let obj_path = {
                        bucket: TEST_CTX.target_bucket,
                        key: fname
                    };
                    return target_client.object.delete_object(obj_path);
                });
        })
        .then(() => verify_object_lists_after_delete(file_names, 'sync deletions from source to target failed', true))
        .then(function() {
            // remove cloud_sync policy
            console.log('removing cloud_sync policy');
            return client.bucket.delete_cloud_sync({
                name: TEST_CTX.source_bucket,
            });
        })
        .then(() => {
            console.log('test_cloud_sync PASSED');
            rpc.disconnect_all();
            return;
        })

    .catch(err => {
        rpc.disconnect_all();
        console.error('test_cloud_sync FAILED: ', err.stack || err);
        throw new Error('test_cloud_sync FAILED: ', err);
    });
}


if (require.main === module) {
    main();
}