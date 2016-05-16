'use strict';

var api = require('../../api');
var rpc = api.new_rpc();
var target_rpc = api.new_rpc();
// var argv = require('minimist')(process.argv);
var P = require('../../util/promise');
var basic_server_ops = require('./basic_server_ops');
// var ops = require('./basic_server_ops');
// var _ = require('lodash');
// var assert = require('assert');
// var promise_utils = require('../../util/promise_utils');

// var dbg = require('../util/debug_module')(__filename);


let TEST_CTX = {
    source_ip: '127.0.0.1',
    source_bucket: 'files',
    target_ip: '127.0.0.1',
    target_port: '5001',
    target_bucket: 'jen-test'
};


var client = rpc.new_client({
    address: 'ws://127.0.0.1:5001'
        // address: 'ws://192.168.0.71:8080'
});

var target_client = target_rpc.new_client({
    address: 'ws://' + TEST_CTX.target_ip + ':' + TEST_CTX.target_port
});

function authenticate() {
    let auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo',
        system: 'demo'
    };
    return P.fcall(function() {
        return client.create_auth_token(auth_params);
    });
    // .delay(1000)
    // .then(function() {
    //     return target_client.create_auth_token(auth_params);
    // });
}

function main() {
    let file_sizes = [1];//, 2, 3];
    let file_names = ['нуба_1'];//, 'нуба_2', 'c3_нуба_3'];
    let fkey;
    return authenticate()
        .then(() => client.pool.create_cloud_pool({
            name: 'cloud-pool',
            cloud_info: {
                endpoint: 'https://s3.amazonaws.com',//'http://' + TEST_CTX.target_ip + ':80',//'https://s3.amazonaws.com',
                target_bucket: TEST_CTX.target_bucket,//'ca-tester',
                access_keys: {
                    access_key: 'AKIAJ2UZQOT2NJDH4DKQ',//'123',//'AKIAIGLTF7IWOW4M3ZHQ',
                    secret_key: '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',//'abc',//'0BDYktB03N0TkudH1invNPjj5ccR+WuaHpfXfwwz'
                }
            }
        }))
        .then(() => client.bucket.read_bucket({ name: TEST_CTX.source_bucket }))
        .then((bucket) => {
            // return client.bucket.create_bucket({ name: TEST_CTX.target_bucket })
            // .then((created_bucket) => {
            //     let tier_name = created_bucket.tiering.tiers[0].tier;
            //     return client.tier.read_tier({ name: tier_name })
            //     .then((tier) => {
            //         let new_pools = ['cloud-pool'];
            //         return client.tier.update_tier({
            //             name: tier.name,
            //             data_placement: 'MIRROR',
            //             pools: new_pools,
            //         })
            //     })
            // })
            //.then(() => bucket)
            return bucket;
        })
        .then((bucket) => {
            let tier_name = bucket.tiering.tiers[0].tier;
            return client.tier.read_tier({ name: tier_name })
            .then((tier) => {
                tier.pools.push('cloud-pool');
                let new_pools = tier.pools;
                return client.tier.update_tier({
                    name: tier.name,
                    data_placement: 'MIRROR',
                    pools: new_pools,
                })
            })
        })
        .delay(10000)
        .then(() => basic_server_ops.generate_random_file(file_sizes[0]))
        .then((fl) => {
            fkey = fl;
            return basic_server_ops.upload_file(TEST_CTX.source_ip, fkey, TEST_CTX.source_bucket, file_names[0]);
        })
        .delay(1000)
        .catch(error => console.error(error));
}

if (require.main === module) {
    main();
}
