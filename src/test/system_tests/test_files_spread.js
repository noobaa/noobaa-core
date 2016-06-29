"use strict";

var basic_server_ops = require('./basic_server_ops');
var P = require('../../util/promise');
var api = require('../../api');
var argv = require('minimist')(process.argv);
var _ = require('lodash');
var dotenv = require('dotenv');
dotenv.load();

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
function get_nodes_auth() {
    var auth_params = {
        email: 'demo@noobaa.com',
        password: 'DeMo',
        system: 'demo'
    };
    return P.fcall(function() {
            return client.create_auth_token(auth_params);
        })
        .then(function() {
            return client.node.list_nodes({
                query: {
                    online: true,
                }
            });
        });
}

function run_test() {
    // Used in order to get the nodes of the system
    var sys_nodes;
    // Used in order to get the key of the file
    var fkey = null;

    // Starting the test chain
    return get_nodes_auth()
        .then(function(res) {
            sys_nodes = res;
            if (sys_nodes.total_count < 6) {
                return P.reject("Not Enough Nodes For 2 Pools");
            }

            return client.pool.create_pool({
                name: "pool1",
                nodes: _.map(sys_nodes.nodes.slice(0, 3), node => _.pick(node, 'name'))
            });
        })
        .then(() => client.pool.create_pool({
            name: "pool2",
            nodes: _.map(sys_nodes.nodes.slice(3, 6), node => _.pick(node, 'name'))
        }))
        .then(() => client.tier.create_tier({
            name: 'tier1',
            pools: ['pool1', 'pool2'],
            data_placement: 'SPREAD'
        }))
        .then(() =>
            client.tiering_policy.create_policy({
                name: 'tiering1',
                tiers: [{
                    order: 0,
                    tier: 'tier1'
                }]
            }))
        .then(() => client.bucket.create_bucket({
            name: 'bucket1',
            tiering: 'tiering1',
        }))
        .then(() => basic_server_ops.generate_random_file(20))
        .then((fl) => {
            fkey = fl;
            return basic_server_ops.upload_file(argv.ip, fkey, 'bucket1', fkey);
        })
        .delay(3000)
        .catch(function(err) {
            console.log('Failed uploading file (SPREAD)', err);
            throw new Error('Failed uploading file (SPREAD) ' + err);
        })
        .then(() => {
            return client.object.read_object_mappings({
                bucket: 'bucket1',
                key: fkey,
                adminfo: true
            });
        })
        .then((res) => {
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
        .then((fl) => {
            fkey = fl;
            return basic_server_ops.upload_file(argv.ip, fkey, 'bucket1', fkey);
        })
        .delay(3000)
        .catch(function(err) {
            console.log('Failed uploading file (MIRROR)', err);
            throw new Error('Failed uploading file (MIRROR) ' + err);
        })
        .then(() => {
            return client.object.read_object_mappings({
                bucket: 'bucket1',
                key: fkey,
                adminfo: true
            });
        })
        .then((res) => {
            _.each(res.parts, part => {
                var pool1_count = 0;
                var pool2_count = 0;
                _.each(part.chunk.frags, frag => {
                    _.each(frag.blocks, block => {
                        if (block.adminfo.pool_name === 'pool1') {
                            pool1_count++;
                        } else {
                            pool2_count++;
                        }
                    });
                });
                if (pool1_count !== 3 && pool2_count !== 3) {
                    throw new Error("MIRROR NOT CORRECT!");
                }
            });
            rpc.disconnect_all();
            return P.resolve("Test Passed! Everything Seems To Be Fine...");
        })
        .catch(err => {
            console.error('test_files_spread FAILED: ', err.stack || err);
            rpc.disconnect_all();
            throw new Error('test_files_spread FAILED: ', err);
        })
        .then(console.log, console.error);
}

function main() {
    return run_test()
        .then(function() {
            process.exit(0);
        })
        .catch(function(err) {
            process.exit(1);
        });
}

if (require.main === module) {
    main();
}
