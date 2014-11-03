// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var assert = require('assert');
var Q = require('q');
var restful_api = require('../util/restful_api');
var account_api = require('../api/account_api');
var edge_node_api = require('../api/edge_node_api');
var mgmt_api = require('../api/mgmt_api');
var account_server = require('./account_server');
var Agent = require('../agent/agent');
var LRU = require('noobaa-util/lru');
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
    list_nodes: list_nodes,
    read_node: read_node,
    add_nodes: add_nodes,
    remove_node: remove_node,
    reset_nodes: reset_nodes,
}, [
    // middleware to verify the account session before any of this server calls
    account_server.account_session
]);

module.exports = mgmt_server;


function system_stats(req) {
    return Q.all([
        Account.count(),
        EdgeNode.count(),
        Bucket.count(),
        ObjectMD.count(),
        ObjectPart.count(),
        DataChunk.count(),
        DataBlock.count(),
        Q.fcall(
            function() {
                return EdgeNode.aggregate([{
                    $group: {
                        _id: '',
                        allocated_storage: {
                            $sum: '$allocated_storage'
                        }
                    }
                }]);
            }
        ),
        Q.fcall(
            function() {
                return DataChunk.aggregate([{
                    $group: {
                        _id: '',
                        used_storage: {
                            $sum: '$size'
                        }
                    }
                }]);
            }
        )
    ]).spread(
        function(
            accounts, nodes,
            buckets, objects, parts, chunks, blocks,
            allocated_result, used_result) {
            return {
                allocated_storage: allocated_result.allocated_storage,
                used_storage: used_result.used_storage,
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

function list_nodes(req) {
    return Q.fcall(
        function() {
            return EdgeNode.find().exec();
        }
    ).then(
        function(nodes) {
            var nodes_reply = _.map(nodes,
                function(node) {
                    var node_reply = _.pick(node,
                        'name', 'ip', 'port', 'heartbeat',
                        'allocated_storage', 'used_storage');
                    node_reply.heartbeat = node_reply.heartbeat.toString();
                    return node_reply;
                }
            );
            return {
                nodes: nodes_reply
            };
        }
    );
}

function read_node(req) {
    // TODO
    throw new Error('TODO');
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

function add_nodes(req) {
    var count = req.restful_params.count;
    var promise = Q.resolve();
    var new_agents = _.times(count, function() {
        next_node_num += 1;
        var node_name = '' + next_node_num;
        var agent = new Agent({
            account_client: account_client,
            edge_node_client: edge_node_client,
            account_credentials: {
                email: req.account.email,
                password: 'aaa', // TODO
            },
            node_name: node_name,
        });
        promise = promise.then(
            function() {
                return agent.start();
            }
        );
        return agent;
    });
    return promise.then(
        function() {
            _.each(new_agents, function(agent) {
                node_agents[agent.node_name] = agent;
            });
        }
    );
}


function remove_node(req) {
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


function reset_nodes(req) {
    node_agents = {};
    next_node_num = 0;
    return Q.fcall(
        function() {
            return EdgeNode.find().remove().exec();
        }
    ).then(
        function() {}
    );
}
