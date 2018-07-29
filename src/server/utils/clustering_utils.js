/* Copyright (C) 2016 NooBaa */
'use strict';

//While the appropriate place is under util/ since used by server and bg_workers
//Since its using the system_store, its located under server/utils

const _ = require('lodash');
const util = require('util');
const url = require('url');
const os = require('os');
const moment = require('moment');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const size_utils = require('../../util/size_utils');
const os_utils = require('../../util/os_utils');
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const system_store = require('../system_services/system_store').get_instance();
const { SERVER_MIN_REQUIREMENTS, DEBUG_MODE_PERIOD } = require('../../../config');

function get_topology() {
    return system_store.get_local_cluster_info();
}


function update_host_address(address) {
    var current_clustering = system_store.get_local_cluster_info();
    //TODO:: publish changes to cluster!

    _.each(current_clustering.shards, function(shard, i) {
        var ind = _.findIndex(shard.servers, function(srv) {
            return srv.address === current_clustering.owner_address;
        });

        if (ind !== -1) {
            current_clustering.shards[i].servers[ind].address = url.parse(address).hostname;
        }
    });

    dbg.log0('clustering info after host update is', util.inspect(current_clustering, {
        depth: 6
    }));

    current_clustering.owner_address = url.parse(address).hostname;
    return system_store.make_changes({
            update: {
                clusters: [current_clustering]
            }
        })
        .catch(err => {
            dbg.log0('Failed updating host address in clustering info');
            throw new Error('Failed updating host address in clustering info', err, err.stack);
        });
}

//Recieves array in the cluster info form ([{address:X},{address:y}]) and returns the array of IPs
function extract_servers_ip(arr) {
    return arr.map(srv => srv.address);
}

//Return all servers in the cluster, regardless of role
function get_all_cluster_members() {
    let servers = system_store.data.clusters.map(top => top.owner_address);
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

function pretty_topology(topology) {
    return util.inspect(topology, {
        showHidden: false,
        depth: 10
    });
}

function rs_array_changes(new_array, name, is_config) {
    var current;
    if (is_config) {
        current = extract_servers_ip(get_topology().config_servers).sort();
    } else {
        var shard_idx = _.findIndex(get_topology().shards, function(s) {
            return name === s.shardname;
        });
        current = extract_servers_ip(get_topology().shards[shard_idx].servers);
    }
    var changes = Array.from(new_array).sort();

    if (current.length !== changes.length) {
        return true;
    }

    var changed = false;
    _.each(current, function(c_srv, i) {
        if (c_srv !== changes[i]) {
            changed = true;
        }
    });

    return changed;

}

function find_shard_index(shardname) {
    var shard_idx = _.findIndex(get_topology().shards, function(s) {
        return shardname === s.shardname;
    });

    return shard_idx;
}

function get_cluster_info(rs_status) {
    const get_hb = true;
    let local_info = system_store.get_local_cluster_info(get_hb);
    let shards = local_info.shards.map(shard => ({
        shardname: shard.shardname,
        servers: []
    }));
    // list online members accoring to local mongo rs status
    let online_members = [local_info.owner_address];
    if (local_info.is_clusterized && local_info.heartbeat) {
        online_members = _get_online_members(rs_status || local_info.heartbeat.health.mongo_rs_status);
    }
    _.each(system_store.data.clusters, cinfo => {
        let shard = shards.find(s => s.shardname === cinfo.owner_shardname);
        const memory = {
            total: 0,
            used: 0,
            free: 0
        };
        let cpus = {
            count: 0,
            usage: 0
        };
        let version = '0';
        let is_connected = 'DISCONNECTED';
        let hostname = os.hostname();
        let time_epoch = moment().unix();
        let location = cinfo.location;
        let single_server = system_store.data.clusters.length === 1;
        let storage = {
            total: 0,
            free: 0
        };
        if (single_server) {
            is_connected = 'CONNECTED';
        }
        if (cinfo.heartbeat) {
            const { totalmem, freemem } = cinfo.heartbeat.health.os_info;
            memory.total = totalmem;
            memory.used = totalmem - freemem;
            memory.free = freemem;

            cpus.count = cinfo.heartbeat.health.os_info.cpus.length;
            cpus.usage = cinfo.heartbeat.health.usage || 0;
            version = cinfo.heartbeat.version;
            if (online_members.indexOf(cinfo.owner_address) !== -1) {
                is_connected = 'CONNECTED';
            }
            hostname = cinfo.heartbeat.health.os_info.hostname;
            storage = cinfo.heartbeat.health.storage;
        }
        const debug_time = cinfo.debug_mode ?
            Math.max(0, DEBUG_MODE_PERIOD - (Date.now() - cinfo.debug_mode)) :
            undefined;
        let server_info = {
            version: version,
            hostname: hostname,
            secret: cinfo.owner_secret,
            addresses: cinfo.owner_address === '127.0.0.1' ? os_utils.get_local_ipv4_ips() : [cinfo.owner_address].concat(os_utils.get_local_ipv4_ips()),
            status: is_connected,
            memory: memory,
            storage: storage,
            cpus: cpus,
            location: location,
            upgrade: _.omit(cinfo.upgrade, 'stage_changed_date'),
            debug: _.omitBy({
                level: cinfo.debug_level,
                time_left: debug_time
            }, _.isUndefined),
            ntp_server: cinfo.ntp && cinfo.ntp.server,
            timezone: cinfo.ntp && cinfo.ntp.timezone,
            dns_servers: cinfo.dns_servers || [],
            search_domains: cinfo.search_domains || [],
            time_epoch: time_epoch,
            vmtools_installed: Boolean(cinfo.vmtools_installed),
            ip_collision: Boolean(cinfo.ip_collision)
        };

        const status = cinfo.services_status;
        if (status) {
            server_info.services_status = _.omitBy({
                dns_servers: status.dns_status,
                dns_name_resolution: status.dns_name,
                phonehome_server: status.ph_status,
                phonehome_proxy: status.proxy_status,
                ntp_server: status.ntp_status,
                remote_syslog: status.remote_syslog_status,
                cluster_communication: {
                    test_completed: status.cluster_status !== 'UNKNOWN',
                    results: status.cluster_status === 'UNKNOWN' ? undefined : status.cluster_status
                }
            }, _.isUndefined);
        } else {
            server_info.services_status = {
                phonehome_server: {
                    status: 'UNKNOWN',
                    test_time: Date.now()
                },
                cluster_communication: {}
            };
        }
        shard.servers.push(server_info);
    });
    _.each(shards, shard => {
        if (shard.servers.length < 3) {
            shard.high_availabilty = false;
        } else {
            let num_connected = shard.servers.filter(server => server.status === 'CONNECTED').length;
            // to be highly available the cluster must be able to stand a failure and still
            // have a majority to vote for a master.
            shard.high_availabilty = num_connected > (shard.servers.length + 1) / 2;
        }
    });
    const min_requirements = get_min_requirements();
    // This is a fix for the buffer of 1GB that we take in config.js
    min_requirements.ram += size_utils.GIGABYTE;
    let cluster_info = {
        master_secret: _get_master_secret(rs_status),
        shards: shards,
        min_requirements
    };
    return cluster_info;
}

function _get_online_members(rs_status) {
    let online_members = [];
    if (rs_status && rs_status.members) {
        _.each(rs_status.members, member => {
            // STARTUP state is used when a server was just added, and we want to show it as online.
            if (member.stateStr === 'PRIMARY' || member.stateStr === 'SECONDARY' || member.stateStr.indexOf('STARTUP') > -1) {
                let res_address = member.name.substring(0, member.name.indexOf(':'));
                online_members.push(res_address);
            }
        });
    }
    return online_members;
}

function _get_master_secret(rs_status) {
    let local_info = system_store.get_local_cluster_info(true);
    let master_secret = local_info.owner_secret;
    if (!local_info.is_clusterized) {
        return master_secret;
    }
    if (_.isUndefined(rs_status) && local_info.heartbeat) {
        rs_status = local_info.heartbeat.health.mongo_rs_status;
    }

    if (rs_status && rs_status.members) {
        const master_member = rs_status.members.find(member => member.stateStr === 'PRIMARY');
        const master_address = master_member.name.substring(0, master_member.name.indexOf(':'));
        master_secret = (system_store.data.clusters.find(server => server.owner_address === master_address)).owner_secret;
    }

    return master_secret;
}

function get_potential_masters() {
    //TODO: For multiple shards, this should probably change?
    var masters = [];
    _.each(get_topology().shards[0].servers, function(s) {
        masters.push({
            address: s.address
        });
    });
    return masters;
}

function get_member_upgrade_status(ip) {
    dbg.log0('UPGRADE:', 'get upgrade status for ip', ip);
    let server_entry = system_store.data.clusters.find(server => server.owner_address === ip);
    dbg.log0('UPGRADE:', 'found server:', server_entry);
    if (!server_entry || !server_entry.upgrade) return 'NOT_READY';
    return server_entry.upgrade.status;
}

function get_member_upgrade_stage(ip) {
    dbg.log0('UPGRADE:', 'get upgrade stage for ip', ip);
    let server_entry = system_store.data.clusters.find(server => server.owner_address === ip);
    dbg.log0('UPGRADE:', 'found server:', server_entry);
    if (!server_entry || !server_entry.upgrade) return;
    return server_entry.upgrade.stage;
}

function can_upload_package_in_cluster() {
    const NOT_ALLOW_TO_UPLOAD_IN_MODES = [
        'PENDING',
        'UPGRADING',
        'PRE_UPGRADE_PENDING',
        'PRE_UPGRADE_READY'
    ];
    if (_.some(system_store.data.clusters, server => _.includes(NOT_ALLOW_TO_UPLOAD_IN_MODES, server.status))) {
        return false;
    }

    return true;
}


function get_local_upgrade_path() {
    let local_info = system_store.get_local_cluster_info();
    return local_info && local_info.upgrade;
}

function send_master_update(is_master, master_address) {
    let system = system_store.data.systems[0];
    if (!system) return P.resolve();
    let hosted_agents_promise = is_master ?
        server_rpc.client.hosted_agents.start() :
        server_rpc.client.hosted_agents.stop();
    let update_master_promise = _.isUndefined(master_address) ?
        P.resolve() :
        server_rpc.client.redirector.publish_to_cluster({
            method_api: 'server_inter_process_api',
            method_name: 'update_master_change',
            target: '', // required but irrelevant
            request_params: {
                master_address: master_address
            }
        });
    return P.join(
            server_rpc.client.system.set_webserver_master_state({
                is_master: is_master
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system._id,
                    role: 'admin'
                })
            }).catch(err => dbg.error('got error on set_webserver_master_state.', err)),

            hosted_agents_promise.catch(err => dbg.error('got error on hosted_agents_promise.', err)),

            update_master_promise.catch(err => dbg.error('got error on update_master_promise.', err))
        )
        .return();
}

function get_min_requirements() {
    const { RAM_GB, STORAGE_GB, CPU_COUNT } = SERVER_MIN_REQUIREMENTS;
    return {
        ram: RAM_GB * size_utils.GIGABYTE,
        storage: STORAGE_GB * size_utils.GIGABYTE,
        cpu_count: CPU_COUNT,
    };
}



//Exports
exports.get_topology = get_topology;
exports.update_host_address = update_host_address;
exports.extract_servers_ip = extract_servers_ip;
exports.verify_cluster_id = verify_cluster_id;
exports.is_single_server = is_single_server;
exports.get_all_cluster_members = get_all_cluster_members;
exports.pretty_topology = pretty_topology;
exports.rs_array_changes = rs_array_changes;
exports.find_shard_index = find_shard_index;
exports.get_cluster_info = get_cluster_info;
exports.get_member_upgrade_status = get_member_upgrade_status;
exports.get_potential_masters = get_potential_masters;
exports.send_master_update = send_master_update;
exports.get_min_requirements = get_min_requirements;
exports.get_local_upgrade_path = get_local_upgrade_path;
exports.get_member_upgrade_stage = get_member_upgrade_stage;
exports.can_upload_package_in_cluster = can_upload_package_in_cluster;
