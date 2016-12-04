'use strict';
const phone_home_utils = require('../../util/phone_home');
const dbg = require('../../util/debug_module')(__filename);
const P = require('../../util/promise');
const _ = require('lodash');
const promise_utils = require('../../util/promise_utils');
const os_utils = require('../../util/os_utils');
const server_rpc = require('../server_rpc');
const net_utils = require('../../util/net');
const net = require('net');
const system_store = require('../system_services/system_store').get_instance();

let server_conf = {};
let monitoring_status = {};

function run() {
    dbg.log0('MONITOR: BEGIN');
    monitoring_status = {
        dns_status: "UNKNOWN",
        ph_status: "UNKNOWN",
    };
    if (!system_store.is_finished_initial_load) {
        dbg.log0('waiting for system store to load');
        return;
    }
    server_conf = system_store.get_local_cluster_info();
    return system_store.refresh()
        .then(() => _verify_cluster_configuration())
        .then(() => _check_ntp())
        .then(() => _check_dns_and_phonehome())
        .then(() => _check_proxy_configuration())
        .then(() => _check_remote_syslog())
        .then(() => _check_is_self_in_dns_table())
        .then(() => _check_internal_ips())
        .then(() => _check_disk_space())
        .then(() => {
            dbg.log0('MONITOR: END. status:', monitoring_status);
            return monitoring_status;
        });
}

/*
 * verify this server is synced with cluster configuration.
 * will rectify and align server to cluster
 */
function _verify_cluster_configuration() {
    dbg.log1('Verifying configuration in cluster');
    return _verify_ntp_cluster_config()
        .then(() => _verify_dns_cluster_config())
        .then(() => _verify_remote_syslog_cluster_config());
}

function _verify_ntp_cluster_config() {
    dbg.log2('Verifying date and time configuration in relation to cluster config');
    let cluster_conf = server_conf.ntp;
    return P.all([os_utils.get_ntp(), os_utils.get_time_config()])
        .spread((platform_ntp, platform_time_config) => {
            let platform_conf = {
                server: platform_ntp,
                timezone: platform_time_config.timezone
            };
            if ((!_.isEmpty(platform_conf) || !_.isEmpty(cluster_conf)) &&
                !_.isEqual(platform_conf, cluster_conf)) {
                dbg.warn(`platform ntp not synced to cluster. Platform conf: `, platform_conf, 'cluster_conf:', cluster_conf);
                return os_utils.set_ntp(cluster_conf.server, cluster_conf.timezone);
            }
        })
        .catch(err => dbg.error('failed to reconfigure ntp cluster config on the server. reason:', err));
}

function _verify_dns_cluster_config() {
    dbg.log2('Verifying dns configuration in relation to cluster config');
    let cluster_conf = server_conf.dns_servers;
    return os_utils.get_dns_servers()
        .then(platform_dns_servers => {
            if ((!_.isEmpty(platform_dns_servers) || !_.isEmpty(cluster_conf)) &&
                !_.isEqual(platform_dns_servers, cluster_conf)) {
                dbg.warn(`platform dns settings not synced to cluster. Platform conf: `, platform_dns_servers, 'cluster_conf:', cluster_conf);
                return os_utils.set_dns_server(cluster_conf)
                    .then(() => os_utils.restart_services());
            }
        })
        .catch(err => dbg.error('failed to reconfigure dns cluster config on the server. reason:', err));
}

function _verify_remote_syslog_cluster_config() {
    dbg.log2('Verifying remote syslog server configuration in relation to cluster config');
    let cluster_conf = system_store.data.systems[0].remote_syslog_config;
    return os_utils.get_syslog_server_configuration()
        .then(platform_syslog_server => {
            if ((!_.isEmpty(platform_syslog_server) || !_.isEmpty(cluster_conf)) &&
                !_.isEqual(platform_syslog_server, cluster_conf)) {
                dbg.warn(`platform remote syslog not synced to cluster. Platform conf: `, platform_syslog_server, 'cluster_conf:', cluster_conf);
                return os_utils.reload_syslog_configuration(cluster_conf);
            }
        })
        .catch(err => dbg.error('failed to reconfigure remote syslog cluster config on the server. reason:', err));
}

function _check_ntp() {
    dbg.log2('_check_ntp');
    if (!server_conf.ntp || !server_conf.ntp.server) return;
    monitoring_status.ntp_status = "UNKNOWN";
    return net_utils.ping(server_conf.ntp.server)
        .catch(err => {
            monitoring_status.ntp_status = "UNREACHABLE";
            throw err;
        })
        .then(() => promise_utils.exec(`ntpstat`, false, true))
        .then(netstat_res => {
            if (netstat_res.startsWith('unsynchronised')) throw new Error('unsynchronised');
            let regex_res = (/NTP server \(([\d.]+)\) /).exec(netstat_res);
            if (!regex_res || !regex_res[1]) throw new Error('failed to check ntp sync');
            return net_utils.dns_resolve(server_conf.ntp.server)
                .then(ip_table => {
                    if (!ip_table.some(val => val === regex_res[1])) throw new Error('syncronized to wrong ntp server');
                });
        })
        .then(() => {
            monitoring_status.ntp_status = "OPERATIONAL";
        })
        .catch(err => {
            monitoring_status.ntp_status = "FAULTY";
            dbg.warn('error while checking ntp', err);
        });
}

function _check_dns_and_phonehome() {
    dbg.log2('_check_dns_and_phonehome');
    return phone_home_utils.verify_connection_to_phonehome()
        .then(res => {
            switch (res) {
                case "CONNECTED":
                    monitoring_status.dns_status = "OPERATIONAL";
                    monitoring_status.ph_status = "OPERATIONAL";
                    break;
                case "MALFORMED_RESPONSE":
                    monitoring_status.dns_status = "OPERATIONAL";
                    monitoring_status.ph_status = "FAULTY";
                    break;
                case "CANNOT_CONNECT_PHONEHOME_SERVER":
                    monitoring_status.dns_status = "OPERATIONAL";
                    monitoring_status.ph_status = "UNREACHABLE";
                    break;
                case "CANNOT_CONNECT_INTERNET":
                    monitoring_status.internet_connectivity = "FAULTY";
                    break;
                case "CANNOT_RESOLVE_PHONEHOME_NAME":
                    monitoring_status.dns_status = "FAULTY";
                    break;
                case "CANNOT_REACH_DNS_SERVER":
                    monitoring_status.dns_status = "UNREACHABLE";
                    break;
                default:
                    break;
            }
        })
        .catch(err => dbg.warn('Error when trying to check dns and phonehome status.', err.stack || err));
}

function _check_proxy_configuration() {
    dbg.log2('_check_proxy_configuration');
    let system = system_store.data.systems[0];
    if (!system.phone_home_proxy_address) return;
    return net_utils.ping(system.phone_home_proxy_address)
        .then(() => {
            monitoring_status.proxy_status = "OPERATIONAL";
        })
        .catch(err => {
            monitoring_status.proxy_status = "UNREACHABLE";
            dbg.warn('Error when trying to check phone home proxy status.', err.stack || err);
        });
}

function _check_remote_syslog() {
    dbg.log2('_check_remote_syslog');
    let system = system_store.data.systems[0];
    if (!system.remote_syslog_config) return;
    monitoring_status.remote_syslog_status = "UNKNOWN";
    if (!system.remote_syslog_config.address) return;
    return net_utils.ping(system.remote_syslog_config.address)
        .then(() => {
            monitoring_status.remote_syslog_status = "OPERATIONAL";
        })
        .catch(err => {
            monitoring_status.remote_syslog_status = "UNREACHABLE";
            dbg.warn('Error when trying to check remote syslog status.', err.stack || err);
        });
}

function _check_is_self_in_dns_table() {
    dbg.log2('_check_is_self_in_dns_table');
    let system_dns = system_store.data.systems[0].base_address;
    let address = server_conf.owner_address;
    if (!system_dns || net.isIPv4(system_dns) || net.isIPv6(system_dns)) return; // dns name is not configured
    return net_utils.dns_resolve(system_dns)
        .then(ip_address_table => {
            if (_.includes(ip_address_table, address)) {
                monitoring_status.dns_name = "OPERATIONAL";
            } else {
                monitoring_status.dns_name = "UNREACHABLE";
            }
        })
        .catch(err => {
            monitoring_status.dns_name = "FAULTY";
            dbg.warn(`Error when trying to find address in dns resolve table: ${server_conf.owner_address}. err:`, err.stack || err);
        });
}

function _check_internal_ips() {
    dbg.log2('_check_internal_ips');
    return server_rpc.client.cluster_server.check_cluster_status()
        .then(cluster_status => {
            if (cluster_status && cluster_status.length > 0) {
                monitoring_status.cluster_status = cluster_status;
            }
        })
        .catch(err => {
            monitoring_status.cluster_status = "UNKNOWN";
            dbg.warn(`Error when trying to check cluster servers' status.`, err.stack || err);
        });
}

function _check_disk_space() {
    dbg.log2('_check_disk_space');
    // right now not doing anything with this. Should alert to user
    //    return fs_utils.disk_usage()
    //        .then(res => {
    //            monitoring_status.disk_usage = res.size;
    //        });
}

// EXPORTS
exports.run = run;
