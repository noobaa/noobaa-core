'use strict';
const phone_home_utils = require('../../util/phone_home');
const dbg = require('../../util/debug_module')(__filename);
const P = require('../../util/promise');
const _ = require('lodash');
const promise_utils = require('../../util/promise_utils');
const fs_utils = require('../../util/fs_utils');
const os_utils = require('../../util/os_utils');
const server_rpc = require('../server_rpc');
const net_utils = require('../../util/net');
const net = require('net');
const system_store = require('../system_services/system_store').get_instance();

let server_conf = {};


function run() {
    dbg.log0('MONITOR: BEGIN');
    let server_status = {
        dns_status: "UNKNOWN",
        ph_status: "UNKNOWN",
        disk_usage: "UNKNOWN",
    };
    if (!system_store.is_finished_initial_load) {
        dbg.log0('waiting for system store to load');
        return;
    }
    server_conf = system_store.get_local_cluster_info();
    return system_store.refresh()
        .then(() => _verify_cluster_configuration())
        .then(() => _check_ntp(server_status))
        .then(monitoring_status => _check_dns_and_phonehome(monitoring_status))
        .then(monitoring_status => _check_proxy_configuration(monitoring_status))
        .then(monitoring_status => _check_remote_syslog(monitoring_status))
        .then(monitoring_status => _check_is_self_in_dns_table(monitoring_status))
        .then(monitoring_status => _check_internal_ips(monitoring_status))
        .then(monitoring_status => _check_disk_space(monitoring_status))
        .then(monitoring_status => {
            dbg.log0('MONITOR: END. status:', monitoring_status);
            return monitoring_status;
        });
}

function _verify_cluster_configuration() {
    dbg.log0('Verifying configuration in cluster');
    return _verify_ntp_cluster_config()
        .then(() => _verify_dns_cluster_config())
        .then(() => _verify_remote_syslog_cluster_config());
}

function _verify_ntp_cluster_config() {
    dbg.log0('Verifying date and time configuration in relation to cluster config');
    return P.all([os_utils.get_ntp(), os_utils.get_time_config()])
        .spread((platform_ntp, platform_time_config) => {
            dbg.log0('WOOP platform_ntp:', platform_ntp);
            dbg.log0('WOOP platform_time_config:', platform_time_config);
            if (server_conf.ntp.server || platform_ntp) {
                dbg.log0('WOOP server_conf.ntp.server:', server_conf.ntp.server);
                dbg.log0('WOOP server_conf.timezone:', server_conf.ntp.timezone);

                if (platform_ntp !== server_conf.ntp.server ||
                    platform_time_config.timezone !== server_conf.ntp.timezone) {
                    dbg.log0('WOOP calling set_ntp');
                    return os_utils.set_ntp(server_conf.ntp.server, server_conf.ntp.timezone);
                }
            }
        });
}

function _verify_dns_cluster_config() {
    dbg.log0('Verifying dns configuration in relation to cluster config');
    return os_utils.get_dns_servers()
        .then(platform_dns_servers => {
            dbg.log0('WOOP platform_dns_servers:', platform_dns_servers);
            dbg.log0('WOOP server_conf:', server_conf);
            if (_.difference(server_conf.dns_servers, platform_dns_servers).length > 0) {
                return os_utils.set_dns_server(server_conf.dns_servers)
                    .then(() => os_utils.restart_services());
            }
        });
}

function _verify_remote_syslog_cluster_config() {
    dbg.log0('Verifying remote syslog server configuration in relation to cluster config');
    let system = system_store.data.systems[0];
    return os_utils.get_syslog_server_configuration()
        .then(platform_syslog_server => {
            if (platform_syslog_server ||
                (system.remote_syslog_config && system.remote_syslog_config.enabled)) {
                platform_syslog_server.enabled = true;
                if (!_.isEqual(platform_syslog_server, system.remote_syslog_config)) { //TODO: fix this... won't work if syslog was disabled
                    return os_utils.reload_syslog_configuration(system.remote_syslog_config);
                }
            }
        });
}



function _check_ntp(monitoring_status) {
    dbg.log3('_check_ntp');
    dbg.log0('_check_ntp WOOP monitoring_status:', monitoring_status);
    dbg.log0('_check_ntp WOOP server_conf.ntp.server:', server_conf.ntp.server);
    if (!server_conf.ntp.server) return monitoring_status;
    monitoring_status.ntp_status = "UNKNOWN";
    return net_utils.ping(server_conf.ntp.server)
        .catch(err => {
            monitoring_status.ntp_status = "UNREACHABLE";
            throw err;
        })
        .then(() => promise_utils.exec(`ntpstat`, false, true)
            .then(netstat_res => {
                if (netstat_res.startsWith('unsynchronised')) throw new Error('unsynchronised');
                let regex_res = (/NTP server \(([\d\.]+)\) /).exec(netstat_res);
                if (!regex_res || !regex_res[1]) throw new Error('failed to check ntp sync');
                return net_utils.dns_resolve(server_conf.ntp.server)
                    .then(ip_table => {
                        if (!ip_table.some(val => val === regex_res[1])) throw new Error('syncronized to wrong ntp server');
                    });
            })
            .catch(err => {
                monitoring_status.ntp_status = "FAULTY";
                throw err;
            }))
        .then(() => {
            monitoring_status.ntp_status = "OPERATIONAL";
            return monitoring_status;
        })
        .catch(err => dbg.warn('error while checking ntp', err) && monitoring_status);
}

function _check_dns_and_phonehome(monitoring_status) {
    dbg.log3('_check_dns_and_phonehome');
    dbg.log0('_check_dns_and_phonehome WOOP:', monitoring_status);
    return P.resolve()
        .then(() => phone_home_utils.verify_connection_to_phonehome())
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
        .catch(err => dbg.warn('Error when trying to check dns and phonehome status.', err.stack || err))
        .then(() => monitoring_status);
}

function _check_proxy_configuration(monitoring_status) {
    dbg.log3('_check_proxy_configuration');
    dbg.log0('_check_proxy_configuration WOOP:', monitoring_status);
    let system = system_store.data.systems[0];
    if (!system.phone_home_proxy_address) {
        return monitoring_status;
    }
    return net_utils.ping(system.phone_home_proxy_address)
        .then(() => {
            monitoring_status.proxy_status = "OPERATIONAL";
        })
        .catch(err => {
            monitoring_status.proxy_status = "UNREACHABLE";
            dbg.warn('Error when trying to check phone home proxy status.', err.stack || err);
        })
        .then(() => monitoring_status);

}

function _check_remote_syslog(monitoring_status) {
    dbg.log3('_check_remote_syslog');
    dbg.log0('_check_remote_syslog WOOP:', system_store.data.systems[0].remote_syslog_config);
    let system = system_store.data.systems[0];
    if (!system.remote_syslog_config) {
        return monitoring_status;
    }
    monitoring_status.remote_syslog_status = "UNKNOWN";
    if (!system.remote_syslog_config.address) {
        return monitoring_status;
    }
    return net_utils.ping(system.remote_syslog_config.address)
        .then(() => {
            monitoring_status.remote_syslog_status = "OPERATIONAL";
        })
        .catch(err => {
            monitoring_status.remote_syslog_status = "UNREACHABLE";
            dbg.warn('Error when trying to check remote syslog status.', err.stack || err);
        })
        .then(() => monitoring_status);
}

function _check_is_self_in_dns_table(monitoring_status) {
    dbg.log3('_check_is_self_in_dns_table');
    dbg.log0('_check_is_self_in_dns_table WOOP:', monitoring_status);
    let system_dns = system_store.data.systems[0].base_address;
    let address = server_conf.owner_address;
    dbg.log0(`WOOP _check_is_self_in_dns_table address:`, address);
    if (!system_dns || net.isIPv4(system_dns) || net.isIPv6(system_dns)) return monitoring_status; // dns name is not configured
    return net_utils.dns_resolve(system_dns)
        .then(ip_address_table => {
            dbg.log0(`WOOP _check_is_self_in_dns_table ip_address_table:`, ip_address_table);
            if (_.includes(ip_address_table, address)) {
                monitoring_status.dns_name = "OPERATIONAL";
            } else {
                monitoring_status.dns_name = "UNREACHABLE";
            }
        })
        .catch(err => {
            monitoring_status.dns_name = "FAULTY";
            dbg.warn(`Error when trying to find address in dns resolve table: ${server_conf.owner_address}. err:`, err.stack || err);
        })
        .then(() => monitoring_status);
}

function _check_internal_ips(monitoring_status) {
    dbg.log3('_check_internal_ips');
    dbg.log0('_check_internal_ips WOOP:', monitoring_status);

    return server_rpc.client.cluster_server.check_cluster_status()
        .then(cluster_status => {
            dbg.log0('_check_internal_ips WOOP:', cluster_status);
            if (cluster_status && cluster_status.length > 0) {
                monitoring_status.cluster_status = cluster_status;
            }
        })
        .catch(err => {
            monitoring_status.cluster_status = "UNKNOWN";
            dbg.warn(`Error when trying to check cluster servers' status.`, err.stack || err);
        })
        .then(() => monitoring_status);
}

function _check_disk_space(monitoring_status) {
    dbg.log3('_check_disk_space');
    dbg.log0('_check_disk_space WOOP:', monitoring_status);

    return fs_utils.disk_usage()
        .then(res => {
            monitoring_status.disk_usage = res.size;
        })
        .then(() => monitoring_status);
}

// EXPORTS
exports.run = run;
