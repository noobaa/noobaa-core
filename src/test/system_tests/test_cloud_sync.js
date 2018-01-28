/* Copyright (C) 2016 NooBaa */
'use strict';

var P = require('../../util/promise');
var api = require('../../api');
var ops = require('../utils/basic_server_ops');
var config = require('../../../config.js');
var dotenv = require('../../util/dotenv');
var target_rpc = api.new_rpc();
var promise_utils = require('../../util/promise_utils');

var _ = require('lodash');
var argv = require('minimist')(process.argv);
var assert = require('assert');

var rpc = api.new_rpc();
dotenv.load();

// var dbg = require('../util/debug_module')(__filename);


let TEST_CTX = {
    connection_name: 'test_connection',
    source_ip: '127.0.0.1',
    source_bucket: 'first.bucket',
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
    run_test: run_basic_test
};

function authenticate() {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
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
    return P.resolve()
        .then(
            () => client.account.add_external_connection({
                name: TEST_CTX.connection_name,
                endpoint: 'http://' + TEST_CTX.target_ip,
                identity: '123',
                secret: 'abc',
                endpoint_type: 'S3_COMPATIBLE'
            })
        )
        .catch(error => {
            if (error.message !== 'External Connection Already Exists') {
                throw new Error(error);
            }
        })
        .then(
            () => client.bucket.set_cloud_sync({
                name: params.source_bucket_name,
                connection: TEST_CTX.connection_name,
                target_bucket: params.target_bucket_name,
                policy: {
                    c2n_enabled: params.c2n_enabled,
                    n2c_enabled: params.n2c_enabled,
                    schedule_min: 1,
                    additions_only: !params.deletions
                }
            })
        )
        .catch(
            error => {
                console.warn('Failed with', error, error.stack);
                throw new Error(error);
            }
        );
}

function compare_object_lists(params) {
    const fail_msg = params.fail_msg;
    const expected_len = params.expected_len;
    let timeout_ms = 5 * 60 * 1000; // 3 wait up to 3 minutes for changes to sync
    let start_ts = Date.now();
    let done = false;
    var source_list;
    var target_list;
    let status_list = [];
    return promise_utils.pwhile(
            () => {
                let diff = Date.now() - start_ts;
                return (diff < timeout_ms && !done);
            },
            () => client.bucket.get_cloud_sync({
                name: params.source_bucket
            })
            .then(cloud_sync_info => {
                if (_.last(status_list) !== cloud_sync_info.status) {
                    status_list.push(cloud_sync_info.status);
                }
                return client.object.list_objects({
                    bucket: params.source_bucket
                });
            })
            // get objects list on the source
            .then(function(source_objects) {
                source_list = _.map(source_objects.objects, 'key');
                return target_client.object.list_objects({
                    bucket: params.target_bucket
                });
            })
            .then(target_objects => {
                target_list = _.map(target_objects.objects, 'key');
                // sort all lists:
                source_list.sort();
                target_list.sort();
                if (_.isUndefined(expected_len)) {
                    done = (target_list.length === source_list.length) && _.last(status_list) === 'SYNCED';
                } else {
                    done = (source_list.length === expected_len && target_list.length === expected_len) &&
                        _.last(status_list) === 'SYNCED';
                }
            })
            .delay(5000)) // wait 10 seconds between each check
        .then(function() {
            assert(_.last(status_list) === 'SYNCED', `Did not finish in expected state but instead is now: ${_.last(status_list)}`);
            assert(target_list.length === source_list.length, fail_msg + ': mismatch between lists length.');
            for (var i = 0; i < source_list.length; i++) {
                assert(target_list[i] === source_list[i], fail_msg + ': mismatch between sorce\\target objects:',
                    target_list[i], source_list[i]);
            }
            if (!_.isUndefined(expected_len)) {
                assert(source_list.length === expected_len, fail_msg + ': expected_len is ' + expected_len + '. got source_list.length=' + source_list.length);
            }
            console.log('during status checks every 5 seconds, these were the statuses: ', status_list);
            if (status_list.length === 0 || (!status_list.includes('SYNCING') && !status_list.includes('PENDING'))) {
                console.warn('Did not pass through expected status states');
                assert(!params.must_go_through_syncing, fail_msg + 'Did not pass through expected status states');
            }
            console.log('source bucket and target bucket are synced. sync took ~', (Date.now() - start_ts) / 1000, 'seconds');
        });
}

function verify_object_lists_after_delete(params) {
    const file_names = params.file_names;
    const fail_msg = params.fail_msg;
    const deleted_from_target = params.deleted_from_target;
    let timeout_ms = 3 * 60 * 1000; // 3 wait up to 3 minutes for changes to sync
    let start_ts = Date.now();
    let done = false;
    var source_list;
    var target_list;
    let status_list = [];
    return promise_utils.pwhile(
            () => {
                let diff = Date.now() - start_ts;
                return (diff < timeout_ms && !done);
            },
            () => client.bucket.get_cloud_sync({
                name: params.source_bucket
            })
            .then(cloud_sync_info => {
                if (_.last(status_list) !== cloud_sync_info.status) {
                    status_list.push(cloud_sync_info.status);
                }
                return client.object.list_objects({
                    bucket: params.source_bucket
                });
            })
            // get objects list on the source
            .then(function(source_objects) {
                source_list = _.map(source_objects.objects, 'key');
                return target_client.object.list_objects({
                    bucket: params.target_bucket
                });
            })
            .then(target_objects => {
                target_list = _.map(target_objects.objects, 'key');
                // sort all lists:
                source_list.sort();
                target_list.sort();
                done = (Math.abs(source_list.length - target_list.length) === file_names.length) &&
                    _.last(status_list) === 'SYNCED';
            })
            .delay(10000)) // wait 10 seconds between each check
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
    return run_basic_test()
        .then(() => run_policy_edit_test())
        .then(() => {
            console.log('test_cloud_sync PASSED');
            return rpc.disconnect_all();
        })
        .then(function() {
            process.exit(0);
        })
        .catch(function() {
            process.exit(1);
        });
}

function run_basic_test() {
    let file_sizes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    let file_names = [];
    let expected_after_del = 0;

    const source_params = _params_by_name({
        suffix: 'test1-source'
    });
    const target_params = _params_by_name({
        suffix: 'test1-target'
    });

    return authenticate()
        .then(() => _create_bucket(source_params))
        .then(() => _create_bucket(target_params))
        .then(() => P.all(_.map(file_sizes, size => ops.generate_random_file(size))))
        .then(function(res_file_names) {
            let i = 0;
            file_names = res_file_names;
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i];
                    i += 1;
                    console.log('calling upload_file(', fname, ')');
                    return ops.upload_file(TEST_CTX.source_ip, fname, source_params.bucket, fname)
                        .delay(1000);
                });
        })
        .then(() => {
            // start cloud sync from source to target and check file list on the target.
            let cloud_sync_params = {
                n2c_enabled: true,
                c2n_enabled: true,
                deletions: true,
                source_bucket_name: source_params.bucket,
                target_bucket_name: target_params.bucket
            };
            return set_cloud_sync(cloud_sync_params)
                .then(() => {
                    console.log('set cloud_sync with these params:', cloud_sync_params, ' waiting for changes to sync');

                })
                .then(function() {
                    //check target file list against local
                    return compare_object_lists({
                        fail_msg: 'sync source to target failed',
                        source_bucket: source_params.bucket,
                        target_bucket: target_params.bucket,
                        must_go_through_syncing: true
                    });
                });
        })
        .then(() => P.all(_.map(file_sizes, size => ops.generate_random_file(size))))
        .then(function(res_file_names) {
            let i = 0;
            file_names = res_file_names;
            console.log('uploading files to  target bucket');
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i];
                    i += 1;
                    console.log('calling upload_file(', fname, ')');
                    return ops.upload_file(TEST_CTX.target_ip, fname, target_params.bucket, fname)
                        .delay(1000);
                });
        })
        .then(() => console.log('uploaded files to target bucket. waiting for changes to sync'))
        // .delay(60000 * 2)
        .then(function() {
            //check target file list against local
            return compare_object_lists({
                fail_msg: 'sync target additions to source failed',
                source_bucket: source_params.bucket,
                target_bucket: target_params.bucket,
            });
        })
        .then(function() {
            let i = 0;
            console.log('deleting from source files that were uploaded to target');
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i];
                    i += 1;
                    let obj_path = {
                        bucket: source_params.bucket,
                        key: fname
                    };
                    return client.object.delete_object(obj_path);
                });
        })
        // list objects on target to verify the number of objects later
        .then(function() {
            return client.object.list_objects({
                bucket: source_params.bucket
            });

        })
        .then(obj_list => {
            expected_after_del = obj_list.objects.length;
            console.log('waiting for deletions to sync for 3 minutes..');
        })
        // .delay(2 * 60000)
        .then(() => compare_object_lists({
            fail_msg: 'sync target additions to source failed',
            source_bucket: source_params.bucket,
            target_bucket: target_params.bucket,
            expected_len: expected_after_del
        }))
        .then(function() {
            // remove cloud_sync policy
            console.log('removing cloud_sync policy');
            return client.bucket.delete_cloud_sync({
                name: source_params.bucket
            });
        })
        .then(() => {
            // start cloud sync from source to target and check file list on the target.
            let cloud_sync_params = {
                n2c_enabled: true,
                c2n_enabled: false,
                deletions: false,
                source_bucket_name: source_params.bucket,
                target_bucket_name: target_params.bucket
            };
            return set_cloud_sync(cloud_sync_params)
                .then(() => {
                    console.log('set cloud_sync with these params:', cloud_sync_params, ' waiting for changes to sync');

                })
                .then(function() {
                    //check target file list against local
                    return compare_object_lists({
                        fail_msg: 'sync source to target failed',
                        source_bucket: source_params.bucket,
                        target_bucket: target_params.bucket,
                    });
                });
        })
        .then(() => P.all(_.map(file_sizes, size => ops.generate_random_file(size))))
        .then(function(res_file_names) {
            let i = 0;
            file_names = res_file_names;
            console.log('uploading files to  target bucket');
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i];
                    i += 1;
                    console.log('calling upload_file(', fname, ')');
                    return ops.upload_file(TEST_CTX.source_ip, fname, source_params.bucket, fname)
                        .delay(1000);
                });
        })
        .then(() => console.log('uploaded files to target bucket. waiting for changes to sync'))
        // .delay(60000 * 2)
        .then(function() {
            //check target file list against local
            return compare_object_lists({
                fail_msg: 'sync target additions to source failed',
                source_bucket: source_params.bucket,
                target_bucket: target_params.bucket,
            });
        })
        .then(function() {
            let i = 0;
            console.log('deleting from source files that were uploaded to target');
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i];
                    i += 1;
                    let obj_path = {
                        bucket: source_params.bucket,
                        key: fname
                    };
                    return client.object.delete_object(obj_path);
                });
        })
        .then(() => verify_object_lists_after_delete({
            file_names,
            fail_msg: 'sync deletions from source to target failed',
            deleted_from_target: false,
            source_bucket: source_params.bucket,
            target_bucket: target_params.bucket
        }))
        .then(function() {
            // remove cloud_sync policy
            console.log('removing cloud_sync policy');
            return client.bucket.delete_cloud_sync({
                name: source_params.bucket
            });
        })
        .then(() => {
            // start cloud sync from source to target and check file list on the target.
            let cloud_sync_params = {
                n2c_enabled: false,
                c2n_enabled: true,
                deletions: false,
                source_bucket_name: source_params.bucket,
                target_bucket_name: target_params.bucket
            };
            return set_cloud_sync(cloud_sync_params)
                .then(() => {
                    console.log('set cloud_sync with these params:', cloud_sync_params, ' waiting for changes to sync');

                })
                .then(function() {
                    //check target file list against local
                    return compare_object_lists({
                        fail_msg: 'sync source to target failed',
                        source_bucket: source_params.bucket,
                        target_bucket: target_params.bucket,
                    });
                });
        })
        .then(() => P.all(_.map(file_sizes, size => ops.generate_random_file(size))))
        .then(function(res_file_names) {
            let i = 0;
            file_names = res_file_names;
            console.log('uploading files to  target bucket');
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i];
                    i += 1;
                    console.log('calling upload_file(', fname, ')');
                    return ops.upload_file(TEST_CTX.target_ip, fname, target_params.bucket, fname)
                        .delay(1000);
                });
        })
        .then(() => console.log('uploaded files to target bucket. waiting for changes to sync'))
        // .delay(60000 * 2)
        .then(function() {
            //check target file list against local
            return compare_object_lists({
                fail_msg: 'sync target additions to source failed',
                source_bucket: source_params.bucket,
                target_bucket: target_params.bucket,
            });
        })
        .then(function() {
            let i = 0;
            console.log('deleting from source files that were uploaded to target');
            return promise_utils.pwhile(
                () => i < file_sizes.length,
                () => {
                    let fname = file_names[i];
                    i += 1;
                    let obj_path = {
                        bucket: target_params.bucket,
                        key: fname
                    };
                    return target_client.object.delete_object(obj_path);
                });
        })
        .then(() => verify_object_lists_after_delete({
            file_names,
            fail_msg: 'sync deletions from source to target failed',
            deleted_from_target: true,
            source_bucket: source_params.bucket,
            target_bucket: target_params.bucket
        }))
        .then(function() {
            // remove cloud_sync policy
            console.log('removing cloud_sync policy');
            return client.bucket.delete_cloud_sync({
                name: source_params.bucket,
            });
        })
        .catch(err => {
            rpc.disconnect_all();
            console.error('test_cloud_sync FAILED: ', err.stack || err);
            throw new Error('test_cloud_sync FAILED: ', err);
        });
}

function run_policy_edit_test() {
    console.log('starting policy edit tests');
    const source_params = _params_by_name({
        suffix: 'test2-source'
    });
    const target_params = _params_by_name({
        suffix: 'test2-target'
    });
    const cloud_sync_params = {
        source_bucket_name: source_params.bucket,
        target_bucket_name: target_params.bucket,
        policy: {
            c2n_enabled: true,
            n2c_enabled: false,
            schedule_min: 1,
            additions_only: true
        }
    };
    return _create_bucket(source_params)
        .then(() => _create_bucket(target_params))
        .then(() => set_cloud_sync(cloud_sync_params))
        .then(() => client.bucket.get_cloud_sync({
            name: source_params.bucket
        }))
        .then(cloud_sync => _compare_cloud_sync_policy(cloud_sync_params.policy, cloud_sync.policy))
        .then(() => {
            cloud_sync_params.policy.c2n_enabled = false;
            cloud_sync_params.policy.n2c_enabled = true;
            cloud_sync_params.policy.schedule_min = 5;
            return client.bucket.update_cloud_sync({
                name: cloud_sync_params.source_bucket_name,
                policy: cloud_sync_params.policy
            });
        })
        .then(() => client.bucket.get_cloud_sync({
            name: source_params.bucket
        }))
        .then(cloud_sync => _compare_cloud_sync_policy(cloud_sync_params.policy, cloud_sync.policy));
}

function _compare_cloud_sync_policy(expected, actual) {
    return P.resolve()
        .then(() => _compare_val_and_throw(expected.schedule_min, actual.schedule_min, 'schedule in minutes'))
        .then(() => _compare_val_and_throw(expected.c2n_enabled, actual.c2n_enabled, 'c2n_enabled'))
        .then(() => _compare_val_and_throw(expected.n2c_enabled, actual.n2c_enabled, 'n2c_enabled'))
        .then(() => _compare_val_and_throw(expected.additions_only, actual.additions_only, 'additions_only'))
        .then(() => _compare_val_and_throw(expected.paused, actual.paused, 'paused'));
}

function _compare_val_and_throw(expected, actual, name) {
    if (!expected || expected === actual) {
        return P.resolve();
    }
    return P.reject(`Policy not as expected. ${name} is ${actual} instead of ${expected}`);
}

if (require.main === module) {
    main();
}

/* * * * * * * * * * * *
    Helper Functions
* * * * * * * * * * * */

function _params_by_name(input) {
    return {
        tier: 'tier-' + input.suffix,
        tiering_policy: 'tiering-' + input.suffix,
        pools: input.pools || [config.NEW_SYSTEM_POOL_NAME],
        data_placement: input.data_placement || 'SPREAD',
        bucket: 'bucket-' + input.suffix,
    };
}

function _create_bucket(params) {
    return client.tier.create_tier({
            name: params.tier,
            attached_pools: params.pools,
            data_placement: params.data_placement
        })
        .then(() => client.tiering_policy.create_policy({
                name: params.tiering_policy,
                tiers: [{
                    order: 0,
                    tier: params.tier,
                    spillover: false,
                    disabled: false
                }]
            }))
        .then(() => client.bucket.create_bucket({
            name: params.bucket,
            tiering: params.tiering_policy,
        }));
}
