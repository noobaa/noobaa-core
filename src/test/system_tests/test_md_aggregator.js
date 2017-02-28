/* Copyright (C) 2016 NooBaa */
"use strict";
const basic_server_ops = require('./basic_server_ops');
const P = require('../../util/promise');
const promise_utils = require('../../util/promise_utils');
const api = require('../../api');
const request = require('request');
const _ = require('lodash');
const argv = require('minimist')(process.argv);
const dotenv = require('../../util/dotenv');
const os_utils = require('../../util/os_utils');
dotenv.load();

const SERVICES_WAIT_IN_SECONDS = 30;
// TODO: This was implemented to work on local servers only
// The reason is that there is no component to control the services remotely
// If there will be a component in the future just change the method control_services
argv.ip = argv.ip || '127.0.0.1';
argv.access_key = argv.access_key || '123';
argv.secret_key = argv.secret_key || 'abc';
var rpc = api.new_rpc();
var client = rpc.new_client({
    address: 'ws://' + argv.ip + ':' + process.env.PORT
});

module.exports = {
    run_test: run_test
};

// Does the Auth and returns the nodes in the system
function create_auth() {
    var auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo1',
        system: 'demo'
    };
    return P.fcall(function() {
            return client.create_auth_token(auth_params);
        })
        .return();
}

// Services is an array of strings for each service or ['all']
// Command: stop, start, restart
function control_services(command, services) {
    return promise_utils.exec(`supervisorctl ${command} ${(services || []).join(' ')}`);
}

// Does the Auth and returns the nodes in the system
function create_bucket(bucket_name) {
    return P.resolve()
        .then(() => client.tier.create_tier({
            name: `${bucket_name}tier`,
            attached_pools: ['default_pool'],
            data_placement: 'SPREAD'
        }))
        .then(() =>
            client.tiering_policy.create_policy({
                name: `${bucket_name}tiering`,
                tiers: [{
                    order: 0,
                    tier: `${bucket_name}tier`
                }]
            }))
        .then(() => client.bucket.create_bucket({
            name: bucket_name,
            tiering: `${bucket_name}tiering`,
        }));
}

function upload_file_to_bucket(bucket_name) {
    let fkey;
    return P.resolve()
        .then(() => basic_server_ops.generate_random_file(1))
        .then(fl => {
            fkey = fl;
            return basic_server_ops.upload_file(argv.ip, fkey, bucket_name, fkey);
        })
        .return(fkey);
}

function jump_system_time_by_milli(milli) {
    const pre_change_time = Date.now();
    return os_utils.get_time_config()
        .then(res => client.cluster_server.update_time_config({
            timezone: res.timezone || '',
            epoch: (pre_change_time + milli) / 1000
        }))
        .then(() => control_services('restart', ['all']))
        .then(() => control_services('stop', ['bg_workers']))
        .then(wait_for_s3_and_web(SERVICES_WAIT_IN_SECONDS));
}

function init_system_to_ntp() {
    return os_utils.get_time_config()
        .then(res => client.cluster_server.update_time_config({
            timezone: res.timezone || '',
            ntp_server: 'pool.ntp.org'
        }))
        .then(() => control_services('restart', ['all']))
        .then(wait_for_s3_and_web(SERVICES_WAIT_IN_SECONDS));
}

function prepare_buckets_with_objects() {
    const HALF_HOUR_IN_MILLI = 30 * 60 * 1000;
    const CYCLES_TO_TEST = 10;
    let buckets_used = [];

    return promise_utils.loop(CYCLES_TO_TEST, cycle => {
            let current_fkey;
            const cycle_jump = CYCLES_TO_TEST - cycle;
            const cycle_bucket_name = `slothaggregator${cycle}`;

            return jump_system_time_by_milli(-cycle_jump * HALF_HOUR_IN_MILLI)
                .then(create_bucket(cycle_bucket_name))
                .then(upload_file_to_bucket(cycle_bucket_name))
                .then(fkey => {
                    current_fkey = fkey;
                })
                .then(() => P.each(buckets_used, function(bucket_obj) {
                    return upload_file_to_bucket(bucket_obj.bucket_name)
                        .then(fkey => {
                            let bucket_f = buckets_used.find(function(b_obj) {
                                return String(b_obj.bucket_name) === String(bucket_obj.bucket_name);
                            });
                            bucket_f.file_names.push(fkey);
                        });
                }))
                .then(() => {
                    buckets_used.push({
                        bucket_name: cycle_bucket_name,
                        file_names: [current_fkey]
                    });
                });
        })
        .return(buckets_used);
}

function calculate_expected_storage_stats_for_buckets(buckets_array, storage_read_by_bucket) {
    return P.each(buckets_array, bucket => {
        let current_bucket_storage = {
            chunks_capacity: 0,
            // Notice that this is relevant in case of 1MB objects
            objects_size: bucket.file_names.length,
            blocks_size: 0
        };

        return P.each(bucket.file_names, function(file_name) {
                return client.object.read_object_mappings({
                        bucket: bucket.bucket_name,
                        key: file_name,
                        adminfo: true
                    })
                    .then(res => {
                        current_bucket_storage.blocks_size += res.object_md.capacity_size || 0;
                        current_bucket_storage.chunks_capacity +=
                            _.sum(_.map(res.parts, part => part.chunk.compress_size || 0));
                    });
            })
            .then(() => {
                if ((current_bucket_storage.chunks_capacity !==
                        storage_read_by_bucket[bucket.bucket_name].chunks_capacity) ||
                    (current_bucket_storage.objects_size !==
                        storage_read_by_bucket[bucket.bucket_name].objects_size) ||
                    (current_bucket_storage.blocks_size !==
                        storage_read_by_bucket[bucket.bucket_name].blocks_size)
                ) {
                    console.error(`${bucket.bucket_name}: calculated - ${current_bucket_storage}
                    expected - ${storage_read_by_bucket[bucket.bucket_name]}`);
                    throw new Error(`Failed for bucket ${bucket.bucket_name}`);
                }
            });
    });
}

function run_test() {
    let test_buckets;
    return control_services('stop', ['bg_workers'])
        .then(prepare_buckets_with_objects)
        .then(buckets => {
            test_buckets = buckets;
        })
        .then(init_system_to_ntp)
        // The calculation should take about 10 minutes
        .delay(15 * 60 * 1000)
        .then(client.system.read_system({}))
        .then(sys_res => {
            let storage_by_bucket;

            sys_res.buckets.forEach(bucket => {
                storage_by_bucket[bucket.name] = {
                    // TODO: Should include objects count, maybe histogram also
                    chunks_capacity: bucket.data.size_reduced,
                    objects_size: bucket.data.size,
                    blocks_size: bucket.storage.used
                };
            });

            return calculate_expected_storage_stats_for_buckets(
                test_buckets,
                storage_by_bucket
            );
        });
}

function main() {
    return create_auth()
        .then(run_test)
        .then(function() {
            rpc.disconnect_all();
            console.log("Test Passed! Everything Seems To Be Fine...");
            process.exit(0);
        })
        .catch(function(err) {
            console.error('TEST FAILED: ', err.stack || err);
            rpc.disconnect_all();
            process.exit(1);
        });
}

if (require.main === module) {
    main();
}

// S3 and WEB are the only ones that we check
// Ideally we should check mongodb and bg as well
function wait_for_s3_and_web(max_seconds_to_wait) {
    return P.all([
            wait_for_server_to_start(max_seconds_to_wait, String(process.env.S3_PORT || 80)),
            wait_for_server_to_start(max_seconds_to_wait, String(process.env.PORT) || 8080)
        ])
        .return();
}

function wait_for_server_to_start(max_seconds_to_wait, port) {
    var isNotListening = true;
    var MAX_RETRIES = max_seconds_to_wait;
    var wait_counter = 1;
    //wait up to 10 seconds
    console.log('waiting for server to start (1)');

    return promise_utils.pwhile(
            function() {
                return isNotListening;
            },
            function() {
                return P.ninvoke(request, 'get', {
                        url: 'http://127.0.0.1:' + port,
                        rejectUnauthorized: false,
                    })
                    .then(function() {
                        console.log('server started after ' + wait_counter + ' seconds');
                        isNotListening = false;
                    })
                    .catch(function(err) {
                        console.log('waiting for server to start(2)');
                        wait_counter += 1;
                        if (wait_counter >= MAX_RETRIES) {
                            console.Error('Too many retries after restart server', err);
                            throw new Error('Too many retries');
                        }
                        return P.delay(1000);
                    });
            })
        .return();
}
