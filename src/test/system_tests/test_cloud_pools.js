'use strict';

var api = require('../../api');
var rpc = api.new_rpc();
var target_rpc = api.new_rpc();
// var argv = require('minimist')(process.argv);
var P = require('../../util/promise');
// var ops = require('./basic_server_ops');
// var _ = require('lodash');
// var assert = require('assert');
// var promise_utils = require('../../util/promise_utils');

// var dbg = require('../util/debug_module')(__filename);


let TEST_CTX = {
    source_ip: '127.0.0.1',
    source_bucket: 'files',
    target_ip: '192.168.0.71',
    target_port: '5001',
    target_bucket: 'ca-tester'
};


var client = rpc.new_client({
    address: 'ws://127.0.0.1:5001'
        // address: 'ws://192.168.0.71:8080'
});

var target_client = target_rpc.new_client({ // eslint-disable-line no-unused-vars
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
    return authenticate()
        .then(() => client.account.add_account_sync_credentials_cache({
            name: 'aws',
            endpoint: 'https://s3.amazonaws.com',
            access_key: 'AKIAIGLTF7IWOW4M3ZHQ',
            secret_key: '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'
        }))
        .then(() => client.pool.create_cloud_pool({
            name: 'cloud-pool-aws',
            connection: 'aws',
            target_bucket: 'ca-tester',
        }))
        // .then(() => process.exit(0))
        .catch(error => console.error(error));
}


if (require.main === module) {
    main();
}


// cloud_info: {
//     endpoint: '127.0.0.1',
//     target_bucket: 'files',
//     access_keys: {
//         access_key: '123',
//         secret_key: 'abc'
//     }
// }
