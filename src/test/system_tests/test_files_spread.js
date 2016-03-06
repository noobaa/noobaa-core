"use strict";

var bso = require('./basic_server_ops');
var P = require('../../util/promise');
var api = require('../../api');
var argv = require('minimist')(process.argv);

argv.ip = argv.ip || '127.0.0.1';
argv.access_key = argv.access_key || '123';
argv.secret_key = argv.secret_key || 'abc';
var rpc = api.new_rpc();
var client = rpc.new_client({
    address: 'ws://' + argv.ip + ':5001'
});

// Does the Auth and returns the nodes in the system
function GetNodesAuth() {
    return P.fcall(function() {
            var auth_params = {
                email: 'demo@noobaa.com',
                password: 'DeMo',
                system: 'demo'
            };
            return client.create_auth_token(auth_params);
        })
        .then(function() {
            return client.node.list_nodes({
                query: {
                    state: 'online',
                }
            });
        });
}

function main() {
    // Used in order to get the nodes of the system
    var SysNodes;
    // Used in order to get the key of the file
    var fkey = null;

    // Starting the test chain
    GetNodesAuth().then(function(res) {
            SysNodes = res;
            if (SysNodes.total_count < 6) {
                return P.reject("Not Enough Nodes For 2 Pools");
            }

            return client.pool.create_pool({
                name: "pool1",
                nodes: [SysNodes.nodes[0].name, SysNodes.nodes[1].name, SysNodes.nodes[2].name],
            });
        })
        .then(() => client.pool.create_pool({
            name: "pool2",
            nodes: [SysNodes.nodes[3].name, SysNodes.nodes[4].name, SysNodes.nodes[5].name],
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
        .then(() => bso.generate_random_file(20))
        .then((fl) => {
            fkey = fl;
            return bso.upload_file(argv.ip, fkey, 'bucket1');
        })
        .delay(60000).then(() => {
            return client.object.read_object_mappings({
                bucket: 'bucket1',
                key: fkey,
                adminfo: true
            });
        })
        .then((res) => {
            var fp = 0;
            var fb = 0;

            //console.log("SPREAD Parts Number: " + res.parts.length);
            for (fp = 0; fp < res.parts.length; fp++) {
                //console.log("SPREAD Frags Number: " + res.parts[fp].chunk.frags.length);
                //console.log("SPREAD Blocks Number: " + res.parts[fp].chunk.frags[0].blocks.length);
                for (fb = 0; fb < res.parts[fp].chunk.frags[0].blocks.length; fb++) {
                    //console.log("SPREAD Blocks Info: " + res.parts[fp].chunk.frags[0].blocks[fb]);
                    if (res.parts[fp].chunk.frags[0].blocks.length !== 3)
                        return P.reject("SPREAD NOT CORRECT!");
                }
            }
            return P.resolve();
        })
        .then(() => client.tier.update_tier({
            name: 'tier1',
            data_placement: 'MIRROR'
        }))
        .delay(60000).then(() => {
            return client.object.read_object_mappings({
                bucket: 'bucket1',
                key: fkey,
                adminfo: true
            });
        })
        .then((res) => {
            var fp = 0;
            var fb = 0;
            var countarr = [0, 0];

            //console.log("MIRROR Parts Number: " + res.parts.length);
            for (fp = 0; fp < res.parts.length; fp++) {
                //    console.log("MIRROR Frags Number: " + res.parts[fp].chunk.frags.length);
                //    console.log("MIRROR Blocks Number: " + res.parts[fp].chunk.frags[0].blocks.length);
                for (fb = 0; fb < res.parts[fp].chunk.frags[0].blocks.length; fb++) {
                    //        console.log("MIRROR Blocks Info: " + res.parts[fp].chunk.frags[0].blocks[fb]);
                    if (res.parts[fp].chunk.frags[0].blocks[fb].adminfo.pool_name === 'pool1') {
                        countarr[0]++;
                    } else {
                        countarr[1]++;
                    }
                }

                if (countarr[0] !== 3 && countarr[1] !== 3)
                    return P.reject("MIRROR NOT CORRECT!");

                countarr = [0, 0];
            }
            return P.resolve("Test Passed! Everything Seems To Be Fine...");
        })
        .then(console.log, console.error).done();
}

if (require.main === module) {
    main();
}
