/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var promise_utils = require('../util/promise_utils');
var dbg = require('noobaa-util/debug_module')(__filename);
var config = require('../../config.js');
var systems_server = require('./systems_server.js');
var bucket_server = require('./bucket_server.js');
var tier_server = require('./tier_server.js');
var object_mapper = require('./object_mapper.js');


/*
 * Stats prototypes
 */
var SYS_STATS = {
    installid: '',
    version: '',
    agent_version: '',
    count: 0,
    systems: [{
        tiers: 0,
        buckets: 0,
        chunks: 0,
        objects: 0,
        roles: 0,
        allocated_space: 0,
        used_space: 0,
        associated_nodes: 0,
    }]
};

var NODES_STATS = {
    count: 0,
    avg_allocation: 0,
    avg_usage: 0,
    os: [{
        win: 0,
        osx: 0
    }],
    avg_uptime: 0,
};

var OPS_STATS = {
  deletes: 0,
  writes: 0,
  reads: 0,
  list_objects: 0,
};

/*
 * Stats Collction
 */

//Collect systems related stats and usage
function systems_stats() {
    var sys_stats = SYS_STATS.prototype;

    sys_stats.installid = ''; //TODO: Actual uniq & persistent installtion ID
    sys_stats.version = process.env.CURRENT_VERSION || 'Unknown';
    sys_stats.agent_version = process.env.AGENT_VERSION || 'Unknown';

    Q.fcall(function() {
            //Get ALL systems
            return systems_server.list_systems({
                account: {
                    is_support: true
                }
            });
        })
        .then(function(res) {
            sys_stats.count = res.systems.length;
            //Per each system fill out the needed info
            _.each(res.systems, function(sys, i) {
                Q.fcall(function() {
                        return tier_server.list_tiers({
                            system: sys.id,
                        });
                    })
                    .then(function(tiers) {
                        sys_stats.systems[i].tiers = tiers.length;
                        return bucket_server.list_buckets({
                            system: sys
                        });
                    })
                    .then(function(buckets) {
                        sys_stats.systems[i].buckets = buckets.length;
                        return object_mapper.chunks_and_objects_count(sys.id);
                    })
                    .then(function(res) {
                        sys_stats.systems[i].chunks = res.chunks_num;
                        sys_stats.systems[i].objects = res.objects_num;
                    })
                    .then(function() {
                        return sys_stats;
                    });
            });
        });
}

//Collect nodes related stats and usage
function nodes_stats() {

}

//Collect operations related stats and usage
function ops_stats() {

}

/*
 * Background Wokrer
 */
if ((config.central_stats.send_stats !== 'true') &&
    (config.central_stats.central_listener)) {
    promise_utils.run_background_worker({
        name: 'system_server_stats_aggregator',
        batch_size: 1,
        time_since_last_build: 60000, // TODO increase...
        building_timeout: 300000, // TODO increase...
        delay: (60 * 60 * 1000), //60m

        //Run the system statistics gatheting
        run_batch: function() {
            //var self = this;
            var stats_payload = {
                sys_stats: null,
                nodes_stats: null,
                ops_stats: null,
            };

            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'BEGIN');
            return Q.fcall(function() {
                    dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Systems');
                    return systems_stats();
                })
                .then(function(sys_stats) {
                    dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Nodes');
                    stats_payload.sys_stats = sys_stats;
                    return nodes_stats();
                })
                .then(function(node_stats) {
                    dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Ops');
                    stats_payload.node_stats = node_stats;
                    return ops_stats();
                })
                .then(function(ops_stats) {
                    stats_payload.ops_stats = ops_stats;
                    dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'SENDING');
                })
                .then(function() {
                    dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'END');
                });
        }
    });
}
