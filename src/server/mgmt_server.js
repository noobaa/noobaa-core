// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var assert = require('assert');
var Q = require('q');
var restful_api = require('../util/restful_api');
var fssize_utils = require('../util/fssize_utils');
var account_api = require('../api/account_api');
var edge_node_api = require('../api/edge_node_api');
var mgmt_api = require('../api/mgmt_api');
var account_server = require('./account_server');
var Agent = require('../agent/agent');
var LRU = require('noobaa-util/lru');
var Semaphore = require('noobaa-util/semaphore');
// db models
var Account = require('./models/account');
var EdgeNode = require('./models/edge_node');
var Bucket = require('./models/bucket');
var ObjectMD = require('./models/object_md');
var ObjectPart = require('./models/object_part');
var DataChunk = require('./models/data_chunk');
var DataBlock = require('./models/data_block');

var mgmt_server = new mgmt_api.Server({
    system_stats: system_stats,
    start_agents: start_agents,
    stop_agents: stop_agents,
}, [
    // middleware to verify the account session before any of this server calls
    account_server.account_session
]);

module.exports = mgmt_server;



function system_stats(req) {
    return Q.all([
        Account.count().exec(),
        EdgeNode.count().exec(),
        Bucket.count().exec(),
        ObjectMD.count().exec(),
        ObjectPart.count().exec(),
        DataChunk.count().exec(),
        DataBlock.count().exec(),
        Q.fcall(
            function() {
                return EdgeNode.mapReduce({
                    map: function() {
                        /* global emit */
                        emit('allocated', this.allocated_storage);
                        emit('used', this.used_storage);
                    },
                    reduce: fssize_utils.reduce_sum
                }).exec();
            }
        ),
        Q.fcall(
            function() {
                return DataChunk.mapReduce({
                    map: function() {
                        /* global emit */
                        emit('size', this.size);
                    },
                    reduce: fssize_utils.reduce_sum
                }).exec();
            }
        )
    ]).spread(
        function(
            accounts, nodes,
            buckets, objects, parts, chunks, blocks,
            allocated_res, used_res) {
            return {
                allocated_storage: allocated_res.allocated_storage,
                used_storage: used_res.used_storage,
                counters: {
                    accounts: accounts,
                    nodes: nodes,
                    buckets: buckets,
                    objects: objects,
                    parts: parts,
                    chunks: chunks,
                    blocks: blocks,
                }
            };
        }
    );
}




// TODO the next code is for testing only - manage node agents in the current process TODO

var node_agents = {};
var next_node_num = 0;
var account_client = new account_api.Client({
    path: '/api/account_api/',
    port: 5001, // TODO
});
var edge_node_client = new edge_node_api.Client({
    path: '/api/edge_node_api/',
    port: 5001, // TODO
});

function start_agents(req) {
    var node_names = req.restful_params.nodes;
    return Q.fcall(
        function() {
            return EdgeNode.find({
                account: req.account.id,
                name: {
                    $in: node_names
                }
            }).exec();
        }
    ).then(
        function(nodes) {
            return start_node_agents(req.account, nodes);
        }
    );
}

function start_node_agents(account, nodes) {
    var sem = new Semaphore(3);
    return Q.all(_.map(nodes,
        function(node) {
            var agent = node_agents[node.name] || new Agent({
                account_client: account_client,
                edge_node_client: edge_node_client,
                account_credentials: {
                    email: account.email,
                    password: 'aaa', // TODO
                },
                node_name: node.name,
                node_geolocation: node.geolocation,
            });
            return sem.surround(function() {
                return agent.start();
            }).thenResolve(agent);
        }
    )).then(
        function(new_agents) {
            _.each(new_agents, function(agent) {
                node_agents[agent.node_name] = agent;
            });
        }
    );
}


function stop_agents(req) {
    var name = req.restful_api.name;
    var agent = node_agents[name];
    if (!agent) {
        console.log('node to remove not found', name);
        return;
    }
    return Q.fcall(
        function() {
            agent.stop();
        }
    ).then(
        function() {
            delete node_agents[name];
        }
    );
}
