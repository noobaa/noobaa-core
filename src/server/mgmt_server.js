// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var assert = require('assert');
var Q = require('q');
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
var Bucket = require('./models/bucket');
var ObjectMD = require('./models/object_md');
var ObjectPart = require('./models/object_part');
var DataChunk = require('./models/data_chunk');
var DataBlock = require('./models/data_block');

var mgmt_server = new mgmt_api.Server({
    system_stats: system_stats,
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
        )
    ]).spread(
        function(
            accounts, nodes,
            buckets, objects, parts, chunks, blocks,
            allocated_res, used_res) {
            var allocated_info = _.mapValues(_.indexBy(allocated_res, '_id'), 'value');
            var used_info = _.mapValues(_.indexBy(used_res, '_id'), 'value');
            if (used_info.size !== allocated_info.used) {
                // TODO not so good that we keep two used size counters...
                console.log('mismatching count of used size', allocated_info, used_info);
            }
            return {
                allocated_storage: allocated_info.allocated || 0,
                used_storage: used_info.size || 0,
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
