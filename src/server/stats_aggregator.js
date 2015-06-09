/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var promise_utils = require('../util/promise_utils');
var dbg = require('noobaa-util/debug_module')(__filename);
var config = require('../../config.js');
var system_server = require('./system_server.js');
var bucket_server = require('./bucket_server.js');
var tier_server = require('./tier_server.js');
var account_server = require('./account_server');
var node_server = require('./node_server');
var object_mapper = require('./object_mapper.js');

dbg.set_level(2);
/*
 * Stats Aggregator Server
 */

var stats_aggregator = {
    get_systems_stats: get_systems_stats,
    get_nodes_stats: get_nodes_stats,
    get_ops_stats: get_ops_stats,
    get_all_stats: get_all_stats,
};

module.exports = stats_aggregator;


/*
 * Stats Collction API
 */

//Collect systems related stats and usage
function get_systems_stats(req) {
    var sys_stats;

    sys_stats.installid = ''; //TODO: Actual uniq & persistent installtion ID
    sys_stats.version = process.env.CURRENT_VERSION || 'Unknown';
    sys_stats.agent_version = process.env.AGENT_VERSION || 'Unknown';

    dbg.log('NB1:: starting get_systems_stats');
    return Q.fcall(function() {
            //Get ALL systems
            return system_server.list_systems({
                account: {
                    is_support: true
                }
            });
        })
        .then(function(res) {
            dbg.log('NB1:: got all systems');
            sys_stats.count = res.systems.length;
            //Per each system fill out the needed info
            return Q.all(_.map(res.systems, function(sys, i) {
                return Q.fcall(function() {
                        dbg.log('NB1:: running on system #', i);
                        return tier_server.list_tiers({
                            system: sys,
                        });
                    })
                    .then(function(tiers) {
                        dbg.log('NB1:: got tiers');
                        sys_stats.systems[i].tiers = tiers.length;
                        return bucket_server.list_buckets({
                            system: sys
                        });
                    })
                    .then(function(buckets) {
                        dbg.log('NB1:: got buckets');
                        sys_stats.systems[i].buckets = buckets.length;
                        return object_mapper.chunks_and_objects_count(sys.id);
                    })
                    .then(function(objects) {
                        dbg.log('NB1:: got objects');
                        sys_stats.systems[i].chunks = objects.chunks_num;
                        sys_stats.systems[i].objects = objects.objects_num;
                        return account_server.get_system_accounts({
                            system: sys
                        });
                    })
                    .then(function(accounts) {
                        dbg.log('NB1:: got accounts');
                        sys_stats.systems[i].roles = accounts.length;
                        return system_server.read_system({
                            system: sys
                        });
                    })
                    .then(function(res_system) {
                        dbg.log('NB1:: got read system');
                        sys_stats.systems[i].allocated_space = res_system.storage.alloc;
                        sys_stats.systems[i].used_space = res_system.storage.used;
                        sys_stats.systems[i].total_space = res_system.storage.total;
                        sys_stats.systems[i].associated_nodes.on = res_system.nodes.online;
                        sys_stats.systems[i].associated_nodes.off = res_system.nodes.count - res_system.nodes.online;
                        dbg.log('NB1:: FULL sys stats ', sys_stats);
                        return sys_stats;
                    })
                    .then(null, function(err) {
                        dbg.log0('Error in collecting systems stats, skipping current sampling point', err);
                        throw new Error('Error in collecting systems stats');
                    });
            }));
        });
}

//Collect nodes related stats and usage
function get_nodes_stats(req) {
    //var nodes_stats;
    /*
    use node_server.group_nodes
    add the following info avg allocation
    avg_usage
    OS


    return Q.fcall(function() {
            //Get ALL systems
            //return node_server.group_nodes({});
        })
        .then(function(res) {})
        .then(null, function(err) {
            dbg.log0('Error in collecting nodes stats, skipping current sampling point', err);
            throw new Error('Error in collecting systems stats');
        });*/
}

function get_ops_stats(req) {

}

//Collect operations related stats and usage
function get_all_stats(req) {
    //var self = this;
    var stats_payload = {
        sys_stats: null,
        nodes_stats: null,
        ops_stats: null,
    };

    dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'BEGIN');
    return Q.fcall(function() {
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Systems');
            return get_systems_stats();
        })
        .then(function(sys_stats) {
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Nodes');
            stats_payload.sys_stats = sys_stats;
            return get_nodes_stats();
        })
        .then(function(node_stats) {
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', '  Collecting Ops');
            stats_payload.node_stats = node_stats;
            return get_ops_stats();
        })
        .then(function(ops_stats) {
            stats_payload.ops_stats = ops_stats;
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'SENDING');
        })
        .then(function() {
            dbg.log('NB:: stats collected ', stats_payload.sys_stats);
            dbg.log2('SYSTEM_SERVER_STATS_AGGREGATOR:', 'END');
            return stats_payload;
        })
        .then(null, function(err) {
            return {};
        });
}


/*
 * Background Wokrer
 */
if ((config.central_stats.send_stats !== 'true') &&
    (config.central_stats.central_listener)) {
    dbg.log('Central Statistics gathering enabled');
    promise_utils.run_background_worker({
        name: 'system_server_stats_aggregator',
        batch_size: 1,
        time_since_last_build: 60000, // TODO increase...
        building_timeout: 300000, // TODO increase...
        delay: (60 * 1000), //60m //TODO:: up to (60*60*1000) //60m

        //Run the system statistics gatheting
        run_batch: function() {
            Q.fcall(function() {
                    return get_all_stats({});
                })
                .then(null, function(err) {

                });
        }
    });
}
