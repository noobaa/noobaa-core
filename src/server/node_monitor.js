/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var moment = require('moment');
var db = require('./db');
var Barrier = require('../util/barrier');
var dbg = require('../util/dbg')(__filename);
var size_utils = require('../util/size_utils');
var promise_utils = require('../util/promise_utils');


module.exports = {
    heartbeat: heartbeat,
};





/**
 * finding node by id for heatbeat requests uses a barrier for merging DB calls.
 * this is a DB query barrier to issue a single query for concurrent heartbeat requests.
 */
var heartbeat_find_node_by_id_barrier = new Barrier({
    max_length: 200,
    expiry_ms: 500, // milliseconds to wait for others to join
    process: function(node_ids) {
        dbg.log2('heartbeat_find_node_by_id_barrier', node_ids.length);
        return Q.when(db.Node
                .find({
                    deleted: null,
                    _id: {
                        $in: node_ids
                    },
                })
                // we are very selective to reduce overhead
                .select('ip port storage geolocation device_info.last_update')
                .exec())
            .then(function(res) {
                var nodes_by_id = _.indexBy(res, '_id');
                return _.map(node_ids, function(node_id) {
                    return nodes_by_id[node_id];
                });
            });
    }
});


/**
 * counting node used storage for heatbeat requests uses a barrier for merging DB calls.
 * this is a DB query barrier to issue a single query for concurrent heartbeat requests.
 */
var heartbeat_count_node_storage_barrier = new Barrier({
    max_length: 200,
    expiry_ms: 500, // milliseconds to wait for others to join
    process: function(node_ids) {
        dbg.log2('heartbeat_count_node_storage_barrier', node_ids.length);
        return Q.when(db.DataBlock.mapReduce({
                query: {
                    deleted: null,
                    node: {
                        $in: node_ids
                    },
                },
                map: function() {
                    /* global emit */
                    emit(this.node, this.size);
                },
                reduce: size_utils.reduce_sum
            }))
            .then(function(res) {
                // convert the map-reduce array to map of node_id -> sum of block sizes
                var nodes_storage = _.mapValues(_.indexBy(res, '_id'), 'value');
                return _.map(node_ids, function(node_id) {
                    return nodes_storage[node_id] || 0;
                });
            });
    }
});


/**
 * updating node timestamp for heatbeat requests uses a barrier for merging DB calls.
 * this is a DB query barrier to issue a single query for concurrent heartbeat requests.
 */
var heartbeat_update_node_timestamp_barrier = new Barrier({
    max_length: 200,
    expiry_ms: 500, // milliseconds to wait for others to join
    process: function(node_ids) {
        dbg.log2('heartbeat_update_node_timestamp_barrier', node_ids.length);
        return Q.when(db.Node
                .update({
                    deleted: null,
                    _id: {
                        $in: node_ids
                    },
                }, {
                    heartbeat: new Date()
                }, {
                    multi: true
                })
                .exec())
            .thenResolve();
    }
});



/**
 *
 * HEARTBEAT
 *
 */
function heartbeat(params) {
    var node_id = params.id;
    var node;

    dbg.log1('HEARTBEAT enter', node_id);

    var hb_delay_ms = process.env.AGENT_HEARTBEAT_DELAY_MS || 60000;
    hb_delay_ms *= 1 + Math.random(); // jitter of 2x max
    hb_delay_ms = hb_delay_ms | 0; // make integer
    hb_delay_ms = Math.max(hb_delay_ms, 1000); // force above 1 second
    hb_delay_ms = Math.min(hb_delay_ms, 300000); // force below 5 minutes

    var reply = {
        // TODO avoid returning storage property unless filled - do that once agents are updated
        storage: {
            alloc: 0,
            used: 0,
        },
        version: process.env.AGENT_VERSION || '',
        delay_ms: hb_delay_ms
    };

    // code for testing performance of server with no heartbeat work
    if (process.env.HEARTBEAT_MODE === 'ignore') {
        return reply;
    }

    // the DB calls are optimized by merging concurrent requests to use a single query
    // by using barriers that wait a bit for concurrent calls to join together.
    var promise = Q.all([
            heartbeat_find_node_by_id_barrier.call(node_id),
            heartbeat_count_node_storage_barrier.call(node_id)
        ])
        .spread(function(node_arg, storage_used) {
            node = node_arg;

            if (!node) {
                // we don't fail here because failures would keep retrying
                // to find this node, and the node is not in the db.
                console.error('IGNORE MISSING NODE FOR HEARTBEAT', node_id);
                return;
            }

            var agent_storage = params.storage;

            // the heartbeat api returns the expected alloc to the agent
            // in order for it to perform the necessary pre-allocation,
            // so this check is here just for logging
            if (agent_storage.alloc !== node.storage.alloc) {
                console.log('NODE change allocated storage from',
                    agent_storage.alloc, 'to', node.storage.alloc);
            }

            // verify the agent's reported usage
            if (agent_storage.used !== storage_used) {
                console.log('NODE agent used storage not in sync',
                    agent_storage.used, 'counted used', storage_used);
                // TODO trigger a detailed usage check / reclaiming
            }


            var updates = {};

            // check if need to update the node used storage count
            if (node.storage.used !== storage_used) {
                updates['storage.used'] = storage_used;
            }

            // TODO detect nodes that try to change ip, port too rapidly
            if (params.geolocation &&
                params.geolocation !== node.geolocation) {
                updates.geolocation = params.geolocation;
            }
            if (params.ip && params.ip !== node.ip) {
                updates.ip = params.ip;
            }
            if (params.port && params.port !== node.port) {
                updates.port = params.port;
            }

            // to avoid frequest updates of the node check if the last update of
            // device_info was less than 1 hour ago and if so drop the update.
            // this will allow more batching by heartbeat_update_node_timestamp_barrier.
            if (params.device_info &&
                should_update_device_info(node.device_info, params.device_info)) {
                updates.device_info = params.device_info;
            }

            dbg.log2('NODE heartbeat', node_id, params.ip + ':' + params.port);

            if (_.isEmpty(updates)) {
                // when only timestamp is updated we optimize by merging DB calls with a barrier
                return heartbeat_update_node_timestamp_barrier.call(node_id);
            } else {
                updates.heartbeat = new Date();
                return node.update(updates).exec();
            }

        }).then(function() {
            reply.storage = {
                alloc: node.storage.alloc || 0,
                used: node.storage.used || 0,
            };
            return reply;
        });

    if (process.env.HEARTBEAT_MODE === 'background') {
        return reply;
    } else {
        return promise;
    }
}




/**
 *
 * NODE_MONITOR_WORKER
 *
 * background worker that scans chunks and builds them according to their blocks status
 *
 * /
var node_monitor_worker = promise_utils.run_background_worker({

    name: 'node_monitor_worker',
    batch_size: 100,
    time_since_last_build: 3000, // TODO increase...
    building_timeout: 60000, // TODO increase...

    /**
     * run the next batch of node scan
     * /
    run_batch: function() {
        var self = this;
        return Q.fcall(function() {
                dbg.log0('NODE_MONITOR_WORKER:', 'RUN');
            })
            .then(function() {
                // return the delay before next batch
                if (self.last_node_id) {
                    return 1000;
                } else {
                    return 60000;
                }
            }, function(err) {
                // return the delay before next batch
                dbg.log0('NODE_MONITOR_WORKER:', 'ERROR', err, err.stack);
                return 10000;
            });
    }

});
*/





// UTILS //////////////////////////////////////////////////////////





// check if device_info should update only if the last update was more than an hour ago
function should_update_device_info(node_device_info, new_device_info) {
    var last = new Date(node_device_info && node_device_info.last_update || 0);
    var last_time = last.getTime() || 0;
    var now = new Date();
    var now_time = now.getTime();
    var skip_time = 3600000;

    if (last_time > now_time - skip_time &&
        last_time < now_time + skip_time) {
        return false;
    }

    // add the current time to the info which will be saved
    new_device_info.last_update = now;
    return true;
}
