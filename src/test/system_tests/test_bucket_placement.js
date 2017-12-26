/* Copyright (C) 2016 NooBaa */
"use strict";

var basic_server_ops = require('../utils/basic_server_ops');
var config = require('../../../config');
var P = require('../../util/promise');
var api = require('../../api');
var argv = require('minimist')(process.argv);
var _ = require('lodash');
var dotenv = require('../../util/dotenv');
var promise_utils = require('../../util/promise_utils');
dotenv.load();

argv.ip = argv.ip || '127.0.0.1';
argv.access_key = argv.access_key || '123';
argv.secret_key = argv.secret_key || 'abc';
var rpc = api.new_rpc();
var client = rpc.new_client({
    address: 'ws://' + argv.ip + ':' + process.env.PORT
});

const TEST_BUCKET_NAME = 'bucket1';
const TEST_QUOTA_BUCKET_NAME = 'bucketquota';

module.exports = {
    run_test: run_test
};

// Does the Auth and returns the nodes in the system
function get_hosts_auth() {
    var auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return P.fcall(function() {
            return client.create_auth_token(auth_params);
        })
        .then(function() {
            return client.host.list_hosts({
                query: {
                    mode: ['OPTIMAL'],
                    pools: ['first.pool']
                }
            });
        });
}

function run_test() {
    // Used in order to get the nodes of the system
    var sys_hosts;
    // Used in order to get the key of the file
    var fkey = null;

    // Starting the test chain
    return get_hosts_auth()
        .then(function(res) {
            sys_hosts = res;
            if (sys_hosts.total_count < 6) {
                return P.reject("Not Enough Nodes For 2 Pools");
            }

            return client.pool.create_hosts_pool({
                name: "pool1",
                hosts: sys_hosts.hosts.map(host => host.name).slice(0, 3)
            });
        })
        .then(() => client.pool.create_hosts_pool({
            name: "pool2",
            hosts: sys_hosts.hosts.map(host => host.name).slice(3, 6)
        }))
        .then(() => client.tier.create_tier({
            name: 'tier1',
            attached_pools: ['pool1', 'pool2'],
            data_placement: 'SPREAD'
        }))
        .then(() => client.tiering_policy.create_policy({
            name: 'tiering1',
            tiers: [{
                order: 0,
                tier: 'tier1',
                spillover: false,
                disabled: false
            }]
        }))
        .then(() => client.bucket.create_bucket({
            name: TEST_BUCKET_NAME,
            tiering: 'tiering1',
        }))
        .then(() => basic_server_ops.generate_random_file(20))
        .then(fl => {
            fkey = fl;
            return basic_server_ops.upload_file(argv.ip, fkey, TEST_BUCKET_NAME, fkey);
        })
        .delay(3000)
        .catch(function(err) {
            console.log('Failed uploading file (SPREAD)', err);
            throw new Error('Failed uploading file (SPREAD) ' + err);
        })
        .then(() => client.object.read_object_mappings({
            bucket: TEST_BUCKET_NAME,
            key: fkey,
            adminfo: true
        }))
        .then(res => {
            _.each(res.parts, part => {
                _.each(part.chunk.frags, frag => {
                    if (frag.blocks.length !== 3) {
                        throw new Error("SPREAD NOT CORRECT!");
                    }
                });
            });
            return P.resolve();
        })
        .then(() => client.tier.update_tier({
            name: 'tier1',
            data_placement: 'MIRROR'
        }))
        .then(() => basic_server_ops.generate_random_file(20))
        .then(fl => {
            fkey = fl;
            return basic_server_ops.upload_file(argv.ip, fkey, TEST_BUCKET_NAME, fkey);
        })
        .delay(3000)
        .catch(function(err) {
            console.log('Failed uploading file (MIRROR)', err);
            throw new Error('Failed uploading file (MIRROR) ' + err);
        })
        .then(() => client.object.read_object_mappings({
            bucket: TEST_BUCKET_NAME,
            key: fkey,
            adminfo: true
        }))
        .then(res => {
            _.each(res.parts, part => {
                var pool1_count = 0;
                var pool2_count = 0;
                _.each(part.chunk.frags, frag => {
                    _.each(frag.blocks, block => {
                        if (block.adminfo.pool_name === 'pool1') {
                            pool1_count += 1;
                        } else {
                            pool2_count += 1;
                        }
                    });
                });
                if (pool1_count !== 3 && pool2_count !== 3) {
                    throw new Error("MIRROR NOT CORRECT!");
                }
            });
        })
        .then(() => perform_spillover_tests(fkey))
        .then(() => perform_quota_tests())
        .then(() => {
            rpc.disconnect_all();
            return P.resolve("Test Passed! Everything Seems To Be Fine...");
        })
        .catch(err => {
            console.error('test_bucket_placement FAILED: ', err.stack || err);
            rpc.disconnect_all();
            throw new Error('test_bucket_placement FAILED: ', err);
        })
        .then(console.log, console.error);
}

function perform_spillover_tests(fkey) {
    console.log('Testing spillover');
    return P.resolve()
        .then(() => update_bucket_policy_to_spillover_only())
        .then(() => check_file_validity_on_spillover(fkey))
        .then(() => perform_upload_test_without_spillover());
}

function perform_quota_tests() {
    console.log('Testing Quota');
    return P.resolve()
        .then(() => client.tier.create_tier({
            name: 'tier2',
            attached_pools: ['pool1', 'pool2'],
            data_placement: 'SPREAD'
        }))
        .then(() => client.tiering_policy.create_policy({
            name: 'tiering2',
            tiers: [{
                order: 0,
                tier: 'tier2',
                spillover: false,
                disabled: false
            }]
        }))
        .then(() => client.bucket.create_bucket({
            name: TEST_QUOTA_BUCKET_NAME,
            tiering: 'tiering2',
        }))
        .then(() => update_quota_on_bucket(1))
        .tap(() => console.log(`Bucket ${TEST_QUOTA_BUCKET_NAME} quota was set to 1GB`))
        .then(() => basic_server_ops.generate_random_file(1))
        .tap(() => console.log('Uploading 1MB file'))
        .then(fl => basic_server_ops.upload_file(argv.ip, fl, TEST_QUOTA_BUCKET_NAME, fl)
            .catch(err => {
                throw new Error('perform_quota_tests should not fail ul 1mb when quota is 1gb', err);
            })
        )
        .tap(() => console.log('uploading 1.2GB file'))
        .then(() => basic_server_ops.generate_random_file(1200))
        .then(fl => basic_server_ops.upload_file(argv.ip, fl, TEST_QUOTA_BUCKET_NAME, fl))
        .tap(() => console.log('waiting for md_aggregation calculations'))
        .delay(120000)
        .then(() => basic_server_ops.generate_random_file(30))
        .then(fl => basic_server_ops.upload_file(argv.ip, fl, TEST_QUOTA_BUCKET_NAME, fl, 20, true)
            .then(res => {
                throw new Error('Upload Should not succeed when over quota');
            })
            .catch(() => {
                console.info('Expected failure of file over quota limit');
            })
        )
        .then(() => update_quota_on_bucket());
}

function update_quota_on_bucket(limit_gb) {
    return P.resolve()
        .then(() => {
            if (limit_gb) {
                return client.bucket.update_bucket({
                    name: TEST_QUOTA_BUCKET_NAME,
                    quota: {
                        size: limit_gb,
                        unit: 'GIGABYTE'
                    }
                });
            } else {
                return client.bucket.update_bucket({
                    name: TEST_QUOTA_BUCKET_NAME,
                });
            }
        })
        .catch(err => {
            throw new Error(`Failed setting quota with ${limit_gb}`, err);
        });
}

function update_bucket_policy_to_spillover_only() {
    return P.resolve()
        .then(() => client.tier.update_tier({
            name: 'tier1',
            attached_pools: [],
            data_placement: 'SPREAD'
        }))
        .then(() => client.bucket.update_bucket({
            name: TEST_BUCKET_NAME,
            tiering: 'tiering1',
            use_internal_spillover: true
        }));
}

function check_file_validity_on_spillover(fkey) {
    let abort_timeout_sec = 3 * 60;
    let first_iteration = true;
    let blocks_correct = false;
    let start_ts;

    return promise_utils.pwhile(
        function() {
            return !blocks_correct;
        },
        function() {
            blocks_correct = true;
            let not_in_spillover_pool_error = false;
            let replicas_not_correct_error = false;
            return client.object.read_object_mappings({
                    bucket: TEST_BUCKET_NAME,
                    key: fkey,
                    adminfo: true
                })
                .then(res => {
                    _.each(res.parts, part => {
                        let blocks_per_chunk_count = 0;
                        _.each(part.chunk.frags, frag => {
                            _.each(frag.blocks, block => {
                                blocks_per_chunk_count += 1;
                                if (!block.adminfo.pool_name
                                    .includes(config.INTERNAL_STORAGE_POOL_NAME)) {
                                    blocks_correct = false;
                                    not_in_spillover_pool_error = true;
                                }
                            });
                        });
                        if (blocks_per_chunk_count !== 1) {
                            blocks_correct = false;
                            replicas_not_correct_error = true;
                        }
                    });
                    if (blocks_correct) {
                        console.log('check_file_validity_on_spillover PASSED!');
                    } else {
                        if (first_iteration) {
                            start_ts = Date.now();
                            first_iteration = false;
                        }

                        let diff = Date.now() - start_ts;
                        if (diff > abort_timeout_sec * 1000) {
                            console.error('Failed check_file_validity_on_spillover!!! aborting after ' + abort_timeout_sec + ' seconds');
                            if (not_in_spillover_pool_error) {
                                console.error("check_file_validity_on_spillover BLOCK NOT IN SPILLOVER POOL");
                            }
                            if (replicas_not_correct_error) {
                                console.error("check_file_validity_on_spillover REPLICAS ON SPILLOVER NOT CORRECT!");
                            }
                            throw new Error('aborted check_file_validity_on_spillover after ' + abort_timeout_sec + ' seconds');
                        }
                        return P.delay(500);
                    }
                })
                .delay(1000);
        });
}

function perform_upload_test_without_spillover() {
    let catch_received = false;
    const err_timeout = new Error('TIMED OUT FROM PROMISE');
    return P.resolve()
        .then(() => client.bucket.update_bucket({
            name: TEST_BUCKET_NAME,
            tiering: 'tiering1',
            use_internal_spillover: false
        }))
        .then(() => basic_server_ops.generate_random_file(1))
        .then(fl => basic_server_ops.upload_file(argv.ip, fl, TEST_BUCKET_NAME, fl)
            // Since upload_file has a timeout of 20minutes, we do not want to wait
            // Please fix this value in case that you change put_object in ec2_wrapper
            // We currently use 10 seconds since it is the cycle length there to retry
            .timeout(10000, err_timeout)
            .catch(err => {
                if (err === err_timeout) {
                    console.error('DESIRED ERROR', err);
                    catch_received = true;
                } else {
                    console.warn('UNDESIRED ERROR', err);
                }
            })
            .then(() => {
                if (!catch_received) {
                    console.error('SHOULD NOT SUCCEED TO UPLOAD');
                    throw new Error('SHOULD NOT SUCCEED TO UPLOAD');
                }
            }));
}

function main() {
    return run_test()
        .then(function() {
            process.exit(0);
        })
        .catch(function() {
            process.exit(1);
        });
}

if (require.main === module) {
    main();
}
