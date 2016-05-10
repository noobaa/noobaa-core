'use strict';

//While the appropriate place is under util/ since used by server and bg_workers
//Since its using the system_store, its located under server/utils

exports.get_topology = get_topology;
exports.update_cluster_info = update_cluster_info;
exports.extract_servers_ip = extract_servers_ip;
exports.verify_cluster_id = verify_cluster_id;
exports.is_single_server = is_single_server;
exports.get_all_cluster_members = get_all_cluster_members;

var _ = require('lodash');
var system_store = require('../stores/system_store');
var dbg = require('../../util/debug_module')(__filename);


function get_topology() {
    return system_store.get_local_cluster_info();
}

function update_cluster_info(params) {
    var current_clustering = system_store.get_local_cluster_info();
    var owner_secret = current_clustering.owner_secret;
    var update = _.defaults(_.pick(params, _.keys(current_clustering)), current_clustering);
    update.owner_secret = owner_secret; //Keep original owner_secret

    dbg.log0('Updating local cluster info for owner', owner_secret, 'previous cluster info',
        current_clustering, 'new cluster info', update);

    return system_store.make_changes({
        update: {
            clusters: [update]
        }
    });
}

//Recieves array in the cluster info form ([{address:X},{address:y}]) and returns the array of IPs
function extract_servers_ip(arr) {
    var ips = [];
    _.each(arr, function(srv) {
        ips.push(srv.address);
    });
    return ips;
}

//Return all servers in the cluster, regardless of role
function get_all_cluster_members() {
    var top = get_topology();
    var servers = [];
    _.each(top.shards, function(sh) {
        _.each(sh.servers, function(srv) {
            servers.push(srv.address);
        });
    });

    return servers;
}

//Verifies given clusterId is equal to current, throws on mismatch
function verify_cluster_id(cluster_id) {
    if (get_topology().cluster_id !== cluster_id) {
        dbg.error('ClusterID mismatch: has', get_topology().cluster_id, ' recieved:', cluster_id);
        throw new Error('ClusterID mismatch');
    }
}

//Checks if current server is a stand-alone server
function is_single_server() {
    var top = get_topology();
    if (!top.config_servers.length &&
        top.shards.length === 1 &&
        top.shard[0].servers.length === 1) {
        return true;
    }
    return false;
}
