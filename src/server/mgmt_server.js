// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var assert = require('assert');
var Q = require('q');
var restful_api = require('../util/restful_api');
var mgmt_api = require('../api/mgmt_api');
var account_server = require('./account_server');
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
                    return _.pick(node,
                        'name', 'ip', 'port', 'heatbeat',
                        'allocated_storage', 'used_storage');
                }
            );
            return {
                nodes: nodes_reply
            };
        }
    );
}
