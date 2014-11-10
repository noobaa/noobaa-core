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
}, [
    // middleware to verify the account session before any of this server calls
    account_server.account_session
]);

module.exports = mgmt_server;

/**
 * return the system status, *not* from single account perspective.
 */
function system_status(req) {
    var minimum_online_heartbeat = moment().subtract(5, 'minutes').toDate();
    return Q.all([
        // nodes - count, online count, allocated/used storage
        EdgeNode.mapReduce({
            scope: {
                // have to pass variables to map/reduce with a scope
                minimum_online_heartbeat: minimum_online_heartbeat,
            },
            map: function() {
                /* global emit */
                emit('count', 1);
                if (this.heartbeat >= minimum_online_heartbeat) {
                    emit('online', 1);
                }
                emit('alloc', this.allocated_storage);
                emit('used', this.used_storage);
            },
            reduce: size_utils.reduce_sum
        }),
        // used_parts - count usage from object parts
        ObjectPart.mapReduce({
            map: function() {
                /* global emit */
                emit('size', this.end - this.start);
            },
            reduce: size_utils.reduce_sum
        }),
        // used_chunks - count usage from chunks
        DataChunk.mapReduce({
            map: function() {
                /* global emit */
                emit('size', this.size);
            },
            reduce: size_utils.reduce_sum
        }),
    ]).spread(
        function(nodes, used_parts, used_chunks) {
            nodes = _.mapValues(_.indexBy(nodes, '_id'), 'value');
            // used_parts counts the size of parts, so if we share chunks between parts
            // then it will be higher than used_chunks.
            used_parts = _.mapValues(_.indexBy(used_parts, '_id'), 'value');
            used_chunks = _.mapValues(_.indexBy(used_chunks, '_id'), 'value');
            if (used_chunks.size !== nodes.used) {
                console.log('skews in nodes used storage', nodes, used_chunks);
            }
            return {
                allocated_storage: nodes.alloc || 0,
                used_objects_storage: used_parts.size || 0,
                used_chunks_storage: used_chunks.size || 0,
                total_nodes: nodes.count || 0,
                online_nodes: nodes.online || 0,
            };
        }
    );
}
