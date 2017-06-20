/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const net = require('net');
const url = require('url');
const moment = require('moment');

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const os_utils = require('../../util/os_utils');
const fs_utils = require('../../util/fs_utils');
const net_utils = require('../../util/net_utils');
const ssl_utils = require('../../util/ssl_utils');
const server_rpc = require('../server_rpc');
const system_store = require('../system_services/system_store').get_instance();
const promise_utils = require('../../util/promise_utils');
const phone_home_utils = require('../../util/phone_home');
const config_file_store = require('../system_services/config_file_store').instance();
const Dispatcher = require('../notifications/dispatcher');

let server_conf = {};
let monitoring_status = {};

function run() {
    dbg.log0('SERVER_MONITOR: BEGIN');
    monitoring_status = {
        dns_status: "UNKNOWN",
        ph_status: {
            status: "UNKNOWN",
            test_time: moment().unix()
        },
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
            dbg.log0('SERVER_MONITOR: END. status:', monitoring_status);
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
        .then(() => _verify_remote_syslog_cluster_config())
        .then(() => _verify_server_certificate());
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
            if (!_are_platform_and_cluster_conf_equal(platform_conf, cluster_conf)) {
                dbg.warn(`platform ntp not synced to cluster. Platform conf: `, platform_conf, 'cluster_conf:', cluster_conf);
                return os_utils.set_ntp(cluster_conf.server, cluster_conf.timezone);
            }
        })
        .catch(err => dbg.error('failed to reconfigure ntp cluster config on the server. reason:', err));
}

function _verify_dns_cluster_config() {
    dbg.log2('Verifying dns configuration in relation to cluster config');
    let cluster_conf = {
        dns_servers: server_conf.dns_servers,
        search_domains: server_conf.search_domains
    };
    return os_utils.get_dns_servers()
        .then(platform_dns_config => {
            if (!_are_platform_and_cluster_conf_equal(platform_dns_config, cluster_conf)) {
                dbg.warn(`platform dns settings not synced to cluster. Platform conf: `, platform_dns_config, 'cluster_conf:', cluster_conf);
                return os_utils.set_dns_server(cluster_conf)
                    .then(() => os_utils.restart_services());
            }
        })
        .catch(err => dbg.error('failed to reconfigure dns cluster config on the server. reason:', err));
}


function _verify_server_certificate() {
    dbg.log2('Verifying certificate in relation to cluster config');
    return P.join(
            config_file_store.get(ssl_utils.SERVER_SSL_CERT_PATH),
            config_file_store.get(ssl_utils.SERVER_SSL_KEY_PATH),
            fs.readFileAsync(ssl_utils.SERVER_SSL_CERT_PATH, 'utf8')
            .catch(err => dbg.warn('could not read crt file', (err && err.code) || err)),
            fs.readFileAsync(ssl_utils.SERVER_SSL_KEY_PATH, 'utf8')
            .catch(err => dbg.warn('could not read key file', (err && err.code) || err))
        )
        .spread((certificate, key, platform_cert, platform_key) => {
            if (!_are_platform_and_cluster_conf_equal(platform_cert, certificate && certificate.data) ||
                !_are_platform_and_cluster_conf_equal(platform_key, key && key.data)) {
                dbg.warn('platform certificate not synced to cluster. Resetting now');
                return fs_utils.create_fresh_path(ssl_utils.SERVER_SSL_DIR_PATH)
                    .then(() => P.join(
                        certificate && certificate.data && fs.writeFileAsync(ssl_utils.SERVER_SSL_CERT_PATH, certificate.data),
                        key && key.data && fs.writeFileAsync(ssl_utils.SERVER_SSL_KEY_PATH, key.data)
                    ))
                    .then(() => os_utils.restart_services());
            }
        });
}


function _verify_remote_syslog_cluster_config() {
    dbg.log2('Verifying remote syslog server configuration in relation to cluster config');
    let cluster_conf = system_store.data.systems[0].remote_syslog_config;
    return os_utils.get_syslog_server_configuration()
        .then(platform_syslog_server => {
            if (!_are_platform_and_cluster_conf_equal(platform_syslog_server, cluster_conf)) {
                dbg.warn(`platform remote syslog not synced to cluster. Platform conf: `, platform_syslog_server, 'cluster_conf:', cluster_conf);
                return os_utils.reload_syslog_configuration(cluster_conf);
            }
        })
        .catch(err => dbg.error('failed to reconfigure remote syslog cluster config on the server. reason:', (err && err.code) || err));
}

function _are_platform_and_cluster_conf_equal(platform_conf, cluster_conf) {
    platform_conf = _.omitBy(platform_conf, _.isEmpty);
    cluster_conf = _.omitBy(cluster_conf, _.isEmpty);
    return (_.isEmpty(platform_conf) && _.isEmpty(cluster_conf)) || // are they both either empty or undefined
        _.isEqual(platform_conf, cluster_conf); // if not, are they equal
}

function _check_ntp() {
    dbg.log2('_check_ntp');
    if (_.isEmpty(server_conf.ntp) || _.isEmpty(server_conf.ntp.server)) return;
    monitoring_status.ntp_status = "UNKNOWN";
    return net_utils.ping(server_conf.ntp.server)
        .catch(err => {
            monitoring_status.ntp_status = "UNREACHABLE";
            Dispatcher.instance().alert('MAJOR',
                system_store.data.systems[0]._id,
                `NTP Server ${server_conf.ntp.server} could not be reached`,
                Dispatcher.rules.once_daily);
            throw err;
        })
        .then(() => promise_utils.exec(`ntpstat`, true, true))
        .then(netstat_res => {
            if (netstat_res.startsWith('unsynchronised')) {
                Dispatcher.instance().alert('MAJOR',
                    system_store.data.systems[0]._id,
                    `Local server time is not synchorinised with NTP Server`,
                    Dispatcher.rules.once_daily);
                throw new Error('unsynchronised');
            }
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
            monitoring_status.ntp_status = monitoring_status.ntp_status || "FAULTY";
            dbg.warn('error while checking ntp', err);
        });
}

function _check_dns_and_phonehome() {
    dbg.log2('_check_dns_and_phonehome');
    const options = _.isEmpty(system_store.data.systems[0].phone_home_proxy_address) ? undefined : {
        proxy: system_store.data.systems[0].phone_home_proxy_address
    };
    return phone_home_utils.verify_connection_to_phonehome(options)
        .then(res => {
            switch (res) {
                case "CONNECTED":
                    monitoring_status.dns_status = "OPERATIONAL";
                    monitoring_status.ph_status = {
                        status: "OPERATIONAL",
                        test_time: moment().unix()
                    };
                    break;
                case "MALFORMED_RESPONSE":
                    monitoring_status.dns_status = "OPERATIONAL";
                    monitoring_status.ph_status = {
                        status: "FAULTY",
                        test_time: moment().unix()
                    };
                    break;
                case "CANNOT_CONNECT_PHONEHOME_SERVER":
                    monitoring_status.dns_status = "OPERATIONAL";
                    monitoring_status.ph_status = {
                        status: "UNREACHABLE",
                        test_time: moment().unix()
                    };
                    Dispatcher.instance().alert('MAJOR',
                        system_store.data.systems[0]._id,
                        `Phone home server could not be reached`,
                        Dispatcher.rules.once_daily);
                    break;
                case "CANNOT_CONNECT_INTERNET":
                    monitoring_status.internet_connectivity = "FAULTY";
                    Dispatcher.instance().alert('MAJOR',
                        system_store.data.systems[0]._id,
                        `Phone home server could not be reached, phone home connectivity is used for proactive
                         support product statistics analysis. In most causes this is caused by lack of connectivity to the internet`,
                        Dispatcher.rules.once_daily);
                    break;
                case "CANNOT_RESOLVE_PHONEHOME_NAME":
                    monitoring_status.dns_status = "FAULTY";
                    Dispatcher.instance().alert('MAJOR',
                        system_store.data.systems[0]._id,
                        `DNS server cannot resolve Phone home server name`,
                        Dispatcher.rules.once_daily);
                    break;
                case "CANNOT_REACH_DNS_SERVER":
                    monitoring_status.dns_status = "UNREACHABLE";
                    Dispatcher.instance().alert('MAJOR',
                        system_store.data.systems[0]._id,
                        `DNS server can't be reached`,
                        Dispatcher.rules.once_daily);
                    break;
                default:
                    break;
            }
            if (_.isEmpty(server_conf.dns_servers)) {
                delete monitoring_status.dns_status;
            }
        })
        .catch(err => dbg.warn('Error when trying to check dns and phonehome status.', err.stack || err));
}

function _check_proxy_configuration() {
    dbg.log2('_check_proxy_configuration');
    let system = system_store.data.systems[0];
    if (_.isEmpty(system.phone_home_proxy_address)) return;
    return net_utils.ping(system.phone_home_proxy_address)
        .then(() => {
            monitoring_status.proxy_status = "OPERATIONAL";
        })
        .catch(err => {
            monitoring_status.proxy_status = "UNREACHABLE";
            Dispatcher.instance().alert('MAJOR',
                system_store.data.systems[0]._id,
                `Proxy server ${system.phone_home_proxy_address} could not be reached`,
                Dispatcher.rules.once_daily);
            dbg.warn('Error when trying to check phone home proxy status.', err.stack || err);
        });
}

function _check_remote_syslog() {
    dbg.log2('_check_remote_syslog');
    let system = system_store.data.systems[0];
    if (_.isEmpty(system.remote_syslog_config)) return;
    if (_.isEmpty(system.remote_syslog_config.address)) return;
    monitoring_status.remote_syslog_status = {
        test_time: moment().unix()
    };
    return net_utils.ping(system.remote_syslog_config.address)
        .then(() => {
            monitoring_status.remote_syslog_status.status = "OPERATIONAL";
        })
        .catch(err => {
            monitoring_status.remote_syslog_status.status = "UNREACHABLE";
            Dispatcher.instance().alert('MAJOR',
                system_store.data.systems[0]._id,
                `Remote syslog server ${system.remote_syslog_config.address} could not be reached`,
                Dispatcher.rules.once_daily);
            dbg.warn('Error when trying to check remote syslog status.', err.stack || err);
        });
}

function _check_is_self_in_dns_table() {
    dbg.log2('_check_is_self_in_dns_table');
    let system_dns = !_.isEmpty(system_store.data.systems[0].base_address) && url.parse(system_store.data.systems[0].base_address).hostname;
    let address = server_conf.owner_address;
    if (_.isEmpty(system_dns) || net.isIPv4(system_dns) || net.isIPv6(system_dns)) return; // dns name is not configured
    return net_utils.dns_resolve(system_dns)
        .then(ip_address_table => {
            if (_.includes(ip_address_table, address)) {
                monitoring_status.dns_name = "OPERATIONAL";
            } else {
                monitoring_status.dns_name = "FAULTY";
                Dispatcher.instance().alert('MAJOR',
                    system_store.data.systems[0]._id,
                    `Server DNS name ${system_dns} does not point to this server's IP`,
                    Dispatcher.rules.once_daily);
            }
        })
        .catch(err => {
            monitoring_status.dns_name = "UNKNOWN";
            Dispatcher.instance().alert('MAJOR',
                system_store.data.systems[0]._id,
                `Server DNS name ${system_dns} counld not be resolved`,
                Dispatcher.rules.once_daily);
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
