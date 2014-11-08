// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var assert = require('assert');
var Q = require('q');
var moment = require('moment');
var restful_api = require('../util/restful_api');
var size_utils = require('../util/size_utils');
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
var NodeVendor = require('./models/node_vendor');
var Bucket = require('./models/bucket');
var ObjectMD = require('./models/object_md');
var ObjectPart = require('./models/object_part');
var DataChunk = require('./models/data_chunk');
var DataBlock = require('./models/data_block');

var mgmt_server = new mgmt_api.Server({
    system_status: system_status,
    system_counters: system_counters,
}, [
    // middleware to verify the account session before any of this server calls
    account_server.account_session
]);

module.exports = mgmt_server;


function system_status(req) {
    var minimum_online_heartbeat = moment().subtract(5, 'minutes').toDate();
    return Q.all([
        Q.fcall(
            function() {
                return EdgeNode.mapReduce({
                    map: function() {
                        /* global emit */
                        emit('alloc', this.allocated_storage);
                        emit('used', this.used_storage);
                    },
                    reduce: size_utils.reduce_sum
                });
            }
        ),
        Q.fcall(
            function() {
                return DataChunk.mapReduce({
                    map: function() {
                        /* global emit */
                        emit('size', this.size);
                    },
                    reduce: size_utils.reduce_sum
                });
            }
        ),
        EdgeNode.count().exec(),
        EdgeNode.count({
            heartbeat: {
                $gt: minimum_online_heartbeat
            }
        }).exec()
    ]).spread(
        function(allocated_res, used_res, total_nodes, online_nodes) {
            var allocated_info = _.mapValues(_.indexBy(allocated_res, '_id'), 'value');
            var used_info = _.mapValues(_.indexBy(used_res, '_id'), 'value');
            if (used_info.size !== allocated_info.used) {
                // TODO not so good that we keep two used size counters...
                console.log('mismatching count of used size', allocated_info, used_info);
            }
            return {
                allocated_storage: allocated_info.alloc || 0,
                used_storage: used_info.size || 0,
                total_nodes: total_nodes,
                online_nodes: online_nodes,
            };
        }
    );
}


function system_counters(req) {
    return Q.all([
        Account.count().exec(),
        EdgeNode.count().exec(),
        NodeVendor.count().exec(),
        Bucket.count().exec(),
        ObjectMD.count().exec(),
        ObjectPart.count().exec(),
        DataChunk.count().exec(),
        DataBlock.count().exec(),
    ]).spread(
        function(
            accounts, nodes, node_vendors,
            buckets, objects, parts, chunks, blocks) {
            return {
                accounts: accounts,
                nodes: nodes,
                node_vendors: node_vendors,
                buckets: buckets,
                objects: objects,
                parts: parts,
                chunks: chunks,
                blocks: blocks,
            };
        }
    );
}
