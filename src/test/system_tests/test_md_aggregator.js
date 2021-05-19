/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const util = require('util');
const argv = require('minimist')(process.argv);
const request = require('request');

const dotenv = require('../../util/dotenv');
dotenv.load();

const P = require('../../util/promise');
const api = require('../../api');
const os_utils = require('../../util/os_utils');
const basic_server_ops = require('../utils/basic_server_ops');

const SERVICES_WAIT_IN_SECONDS = 30;
//This was implemented to work on local servers only
// The reason is that there is no component to control the services remotely
// If there will be a component in the future just change the method control_services
argv.ip = argv.ip || 'localhost';
argv.access_key = argv.access_key || '123';
argv.secret_key = argv.secret_key || 'abc';
var rpc = api.new_rpc();
var client = rpc.new_client({
    address: 'ws://' + argv.ip + ':' + process.env.PORT
});


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
        .then(() => {
            // do nothing. 
        });
}

// Services is an array of strings for each service or ['all']
// Command: stop, start, restart
function control_services(command, services) {
    return os_utils.exec(`supervisorctl ${command} ${(services || []).join(' ')}`, {
            ignore_rc: false,
            return_stdout: true
        })
        .then(res => {
            console.log('control_services response:', res);
        })
        .catch(err => {
            console.error('control_services had an error:', err);
            throw err;
        });
}

// Does the Auth and returns the nodes in the system
function create_bucket(bucket_name) {
    return P.resolve()
        .then(() => client.tier.create_tier({
            name: `${bucket_name}tier`,
            attached_pools: ['first-pool'],
            data_placement: 'SPREAD'
        }))
        .then(() => client.tiering_policy.create_policy({
            name: `${bucket_name}tiering`,
            tiers: [{
                order: 0,
                tier: `${bucket_name}tier`,
                spillover: false,
                disabled: false
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
            return basic_server_ops.upload_file(argv.ip, fl, bucket_name, fl);
        })
        .then(function() {
            return fkey;
        });
}

async function prepare_buckets_with_objects() {
    const CYCLES_TO_TEST = 2;
    const buckets_used = [];

    for (let cycle = 0; cycle < CYCLES_TO_TEST; ++cycle) {
        const cycle_bucket_name = `slothaggregator${cycle}`;
        //TODO:: used to update system time by milli cycke_jump * FIVE_MINUTES_IN_MILLI
        await create_bucket(cycle_bucket_name);
        const current_fkey = await upload_file_to_bucket(cycle_bucket_name);
        await Promise.all(buckets_used.map(async bucket_obj => {
            const fkey = await upload_file_to_bucket(bucket_obj.bucket_name);
            const bucket_f = buckets_used.find(
                b => String(b.bucket_name) === String(bucket_obj.bucket_name)
            );
            bucket_f.file_names.push(fkey);
        }));
        buckets_used.push({
            bucket_name: cycle_bucket_name,
            file_names: [current_fkey]
        });
    }
    await control_services('restart', ['all']);
    await wait_for_s3_and_web(SERVICES_WAIT_IN_SECONDS);
    return buckets_used;
}

function calculate_expected_storage_stats_for_buckets(buckets_array, storage_read_by_bucket) {
    console.log('calculate_expected_storage_stats_for_buckets started');
    return P.map_one_by_one(buckets_array, bucket => {
        let current_bucket_storage = {
            chunks_capacity: 0,
            objects_size: 0,
            blocks_size: 0
        };

        return P.map_one_by_one(bucket.file_names, function(file_name) {
                return client.object.read_object_mapping_admin({
                        bucket: bucket.bucket_name,
                        key: file_name,
                    })
                    .then(res => {
                        _.forEach(res.chunks, chunk => _.forEach(chunk.frags, frag => _.forEach(frag.blocks, block => {
                            current_bucket_storage.blocks_size += block.block_md.size;
                        })));
                        current_bucket_storage.objects_size += res.object_md.size;
                        current_bucket_storage.chunks_capacity +=
                            _.sum(_.map(res.chunks, chunk => chunk.compress_size || 0));
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
                    console.error(`${bucket.bucket_name}: calculated - ${util.inspect(current_bucket_storage, false, null, true)}
                        expected - ${util.inspect(storage_read_by_bucket[bucket.bucket_name], false, null, true)}`);
                    throw new Error(`Failed for bucket ${bucket.bucket_name}`);
                }
            });
    });
}

function run_test() {
    let test_buckets;
    return control_services('stop', ['bg_workers'])
        .then(() => create_auth())
        .then(() => prepare_buckets_with_objects())
        .then(buckets => {
            console.log('Waiting for calculations', buckets);
            test_buckets = buckets;
        })
        .then(() => P.delay(5 * 60 * 1000))
        .then(() => client.system.read_system({}))
        .then(sys_res => {
            let storage_by_bucket = {};

            sys_res.buckets.forEach(bucket => {
                if (String(bucket.name.unwrap()) !== 'first.bucket') {
                    storage_by_bucket[bucket.name.unwrap()] = {
                        //Should include objects count, maybe histogram also
                        chunks_capacity: bucket.data.size_reduced,
                        objects_size: bucket.data.size,
                        blocks_size: bucket.storage.values.used
                    };
                }
            });

            return calculate_expected_storage_stats_for_buckets(
                test_buckets,
                storage_by_bucket
            );
        });
}

function main() {
    return run_test()
        .then(function() {
            console.log('TEST PASSED! Everything Seems To Be Fine...');
            rpc.disconnect_all();
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
            wait_for_server_to_start(max_seconds_to_wait, String(process.env.ENDPOINT_PORT || 80)),
            wait_for_server_to_start(max_seconds_to_wait, String(process.env.PORT) || 8080),
            wait_for_mongodb_to_start(max_seconds_to_wait)
        ])
        .then(() => {
            // do nothing. 
        });
}

function wait_for_mongodb_to_start(max_seconds_to_wait) {
    var isNotListening = true;
    var MAX_RETRIES = max_seconds_to_wait;
    var wait_counter = 1;
    //wait up to 10 seconds
    console.log('waiting for mongodb to start (1)');

    return P.pwhile(
            function() {
                return isNotListening;
            },
            function() {
                return os_utils.exec('supervisorctl status mongo_wrapper', {
                        ignore_rc: false,
                        return_stdout: true
                    })
                    .then(function(res) {
                        if (String(res).indexOf('RUNNING') > -1) {
                            console.log('mongodb started after ' + wait_counter + ' seconds');
                            isNotListening = false;
                        } else {
                            throw new Error('Still waiting');
                        }
                    })
                    .catch(function(err) {
                        console.log('waiting for mongodb to start(2)');
                        wait_counter += 1;
                        if (wait_counter >= MAX_RETRIES) {
                            console.error('Too many retries after restart mongodb', err);
                            throw new Error('Too many retries');
                        }
                        return P.delay(1000);
                    });
            })
        .then(() => {
            // do nothing. 
        });
}

function wait_for_server_to_start(max_seconds_to_wait, port) {
    var isNotListening = true;
    var MAX_RETRIES = max_seconds_to_wait;
    var wait_counter = 1;
    //wait up to 10 seconds
    console.log('waiting for server to start (1)');

    return P.pwhile(
            function() {
                return isNotListening;
            },
            function() {
                return P.ninvoke(request, 'get', {
                        url: 'http://localhost:' + port,
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
                            console.error('Too many retries after restart server', err);
                            throw new Error('Too many retries');
                        }
                        return P.delay(1000);
                    });
            })
        .then(() => {
            // do nothing. 
        });
}

exports.run_test = run_test;
