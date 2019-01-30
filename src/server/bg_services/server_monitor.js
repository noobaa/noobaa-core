/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const os = require('os');
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
const Dispatcher = require('../notifications/dispatcher');
const server_rpc = require('../server_rpc');
const system_store = require('../system_services/system_store').get_instance();
const promise_utils = require('../../util/promise_utils');
const phone_home_utils = require('../../util/phone_home');
const config_file_store = require('../system_services/config_file_store').instance();


const dotenv = require('../../util/dotenv');

let server_conf = {};
let monitoring_status = {};
let ip_collision = [];

if (!process.env.PLATFORM) {
    console.log('loading .env file...');
    dotenv.load();
}

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
    if (!system_store.data.systems[0]) {
        dbg.log0('system does not exist, skipping');
        return;
    }
    server_conf = system_store.get_local_cluster_info(true);

    return system_store.refresh()
        .then(() => _verify_cluster_configuration())
        .then(() => _check_ntp())
        .then(() => _check_dns_and_phonehome())
        .then(() => _check_proxy_configuration())
        .then(() => _check_remote_syslog())
        .then(() => _verify_and_update_public_ip())
        .then(() => _check_is_self_in_dns_table())
        .then(() => _check_internal_ips())
        .then(() => _check_network_configuration())
        .then(() => _check_disk_space())
        .then(() => _check_for_duplicate_ips())
        .then(() => {
            dbg.log0('SERVER_MONITOR: END. status:', monitoring_status);
            return {
                services: monitoring_status,
                ip_collision
            };
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
        .then(() => _verify_proxy_cluster_config())
        .then(() => _verify_remote_syslog_cluster_config())
        .then(() => _verify_server_certificate())
        .then(() => _verify_vmtools());
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

function _verify_proxy_cluster_config() {
    dbg.log2('Verifying proxy configuration in relation to cluster config');
    let cluster_conf = _.isEmpty(system_store.data.systems[0].phone_home_proxy_address) ? { proxy: undefined } : {
        proxy: system_store.data.systems[0].phone_home_proxy_address
    };
    return os_utils.get_yum_proxy()
        .then(platform_proxy => {
            let platform_conf = {
                proxy: platform_proxy
            };
            if (!_are_platform_and_cluster_conf_equal(platform_conf, cluster_conf)) {
                dbg.warn(`platform proxy settings not synced to cluster. Platform conf: `, platform_conf, 'cluster_conf:', cluster_conf);
                return os_utils.set_yum_proxy(cluster_conf.proxy);
            }
        })
        .catch(err => dbg.error('failed to reconfigure proxy config on the server. reason:', err));
}

function _verify_dns_cluster_config() {
    if (os.type() === 'Darwin') return;
    if (process.env.PLATFORM === 'docker') return;

    dbg.log2('Verifying dns configuration in relation to cluster config');
    let cluster_conf = {
        dns_servers: _.compact(server_conf.dns_servers),
        search_domains: _.compact(server_conf.search_domains)
    };

    return os_utils.ensure_dns_and_search_domains(cluster_conf)
        .catch(err => dbg.error('failed to reconfigure dns cluster config on the server. reason:', err));
}

async function _verify_vmtools() {
    if (process.env.PLATFORM !== 'esx') return;
    if (os.type() !== 'Linux') return;
    dbg.log2('Verifying vmtools configuration in relation to cluster config');
    let cluster_vmtools_install = server_conf.vmtools_installed;
    const server_vmtools_install = await os_utils.is_vmtools_installed();
    if (cluster_vmtools_install && !server_vmtools_install) {
        dbg.warn(`Server doesn't have vmtools installed while cluster have it enabled, installing...`);
        await os_utils.install_vmtools();
    }
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
                    .then(() => os_utils.restart_noobaa_services());
            }
        });
}


function _verify_remote_syslog_cluster_config() {
    dbg.log2('Verifying remote syslog server configuration in relation to cluster config');
    let system = system_store.data.systems[0];
    let syslog_conf = _.clone(system.remote_syslog_config);
    return os_utils.get_syslog_server_configuration()
        .then(platform_syslog_server => {
            if (!_are_platform_and_cluster_conf_equal(platform_syslog_server, syslog_conf)) {
                dbg.warn(`platform remote syslog not synced to cluster. Platform conf: `, platform_syslog_server, 'cluster_conf:', syslog_conf);
                if (syslog_conf) {
                    syslog_conf.enabled = true;
                }
                return os_utils.reload_syslog_configuration(syslog_conf);
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
    if (process.env.PLATFORM === 'docker') return;
    dbg.log2('_check_ntp');
    if (_.isEmpty(server_conf.ntp) || _.isEmpty(server_conf.ntp.server)) return;
    monitoring_status.ntp_status = "UNKNOWN";
    return os_utils.verify_ntp_server(server_conf.ntp.server)
        .catch(err => {
            monitoring_status.ntp_status = "UNREACHABLE";
            Dispatcher.instance().alert('MAJOR',
                system_store.data.systems[0]._id,
                `NTP Server ${server_conf.ntp.server} could not be reached, check NTP server configuration or connectivity`,
                Dispatcher.rules.once_daily);
            throw err;
        })
        .then(() => promise_utils.exec(`ntpstat`, {
            ignore_rc: true,
            return_stdout: true
        }))
        .then(ntpstat_res => {
            if (ntpstat_res.startsWith('unsynchronised')) {
                //Due to an issue with ntpstat not showing the correct ntpd status after ntf.conf change and ntpd restart
                //Double verify unsynched with ntpq
                return promise_utils.exec(`ntpq -np | tail -1`, {
                        ignore_rc: true,
                        return_stdout: true
                    })
                    .then(ntpq_res => {
                        if (!ntpq_res.startsWith('*')) {
                            monitoring_status.ntp_status = "FAULTY";
                            Dispatcher.instance().alert('MAJOR',
                                system_store.data.systems[0]._id,
                                `Local server time is not synchronized with NTP Server, check NTP server configuration`,
                                Dispatcher.rules.once_daily);
                            throw new Error('unsynchronised');
                        }
                    });
            }
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
                         support product statistics analysis. Check internet connection`,
                        Dispatcher.rules.once_daily);
                    break;
                case "CANNOT_RESOLVE_PHONEHOME_NAME":
                    monitoring_status.dns_status = "FAULTY";
                    Dispatcher.instance().alert('MAJOR',
                        system_store.data.systems[0]._id,
                        `DNS server/s cannot resolve Phone home server name`,
                        Dispatcher.rules.once_daily);
                    break;
                case "CANNOT_REACH_DNS_SERVER":
                    monitoring_status.dns_status = "UNREACHABLE";
                    Dispatcher.instance().alert('CRIT',
                        system_store.data.systems[0]._id,
                        `DNS server/s could not be reached, check DNS server configuration or connectivity`,
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

function _check_network_configuration() {
    dbg.log2('check_network_configuration');
    if (os.type() === 'Darwin') return;
    if (process.env.PLATFORM === 'azure') return; // no first_install_wizard - can't control network configuration
    if (process.env.PLATFORM === 'docker') return; // no first_install_wizard - can't control network configuration
    if (!server_conf.heartbeat) return;
    let ips = os_utils.get_local_ipv4_ips();
    if (server_conf.is_clusterized && !_.find(ips, ip => ip === server_conf.owner_address)) {
        Dispatcher.instance().alert('MAJOR',
            system_store.data.systems[0]._id,
            `IP address change was detected in server ${server_conf.heartbeat.health.os_info.hostname},
            please update the server IP in Cluster->${server_conf.heartbeat.health.os_info.hostname}->Change IP`,
            Dispatcher.rules.once_daily);
        dbg.log0('server ip was changed, IP:', server_conf.owner_address, 'not in the ip list:', ips);
    }
    let data = "";
    return os_utils.get_all_network_interfaces()
        .then(interfaces => {
            dbg.log2('current network interfaces are', interfaces);
            return P.map(interfaces, inter => {
                data += inter + '\n';
                return fs_utils.find_line_in_file('/data/noobaa_network', inter)
                    .then(line => {
                        if (!line) { // if didn't found the interface in the file
                            Dispatcher.instance().alert('MAJOR',
                                system_store.data.systems[0]._id,
                                `New network interface ${inter} was detected in server ${server_conf.heartbeat.health.os_info.hostname},
                            please configure it using the server console`);
                            dbg.log0('found new interface', inter);
                        }
                    });
            });
        })
        .then(() => fs_utils.replace_file('/data/noobaa_network', data))
        .catch(err => dbg.error(`_check_network_configuration caught ${err}`));
}

function _check_for_duplicate_ips() {
    dbg.log2('check_for_duplicate_ips');
    if (os.type() !== 'Linux') return;
    const nics = _.toPairs(_.omit(os.networkInterfaces(), 'lo'));
    const collisions = [];
    return P.map(nics, nic => {
            const inter_name = nic[0];
            const nic_info = nic[1];
            return P.map(nic_info, ip => {
                if (ip.family === 'IPv4') {
                    return promise_utils.exec(`arping -D -I ${inter_name} -c 2 ${ip.address}`, {
                            ignore_rc: false,
                            return_stdout: true
                        })
                        .then(result => dbg.log2(`No duplicate address was found for ip ${ip.address} of interface ${inter_name}`, 'result:', result))
                        .catch(() => {
                            collisions.push(ip.address);
                            Dispatcher.instance().alert('CRIT',
                                system_store.data.systems[0]._id,
                                `Duplicate address was found! IP: ${ip.address} ,Interface: ${inter_name}, Server: ${server_conf.heartbeat.health.os_info.hostname}
                            ,please fix this issue as soon as possible`, Dispatcher.rules.once_daily);
                            dbg.error(`Duplicate address was found for ip ${ip.address} of interface ${inter_name}`);
                        });
                }
            });
        })
        .then(() => {
            ip_collision = collisions;
        });
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
                `Proxy server ${system.phone_home_proxy_address} could not be reached, check Proxy configuration or connectivity`,
                Dispatcher.rules.once_daily);
            dbg.warn('Error when trying to check proxy status.', err.stack || err);
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
                `Remote syslog server ${system.remote_syslog_config.address} could not be reached, check Syslog configuration or connectivity`,
                Dispatcher.rules.once_daily);
            dbg.warn('Error when trying to check remote syslog status.', err.stack || err);
        });
}

function _check_is_self_in_dns_table() {
    dbg.log2('_check_is_self_in_dns_table');
    const system_dns = !_.isEmpty(system_store.data.systems[0].base_address) &&
        url.parse(system_store.data.systems[0].base_address).hostname;
    if (_.isEmpty(system_dns) || net.isIPv4(system_dns) || net.isIPv6(system_dns)) return; // dns name is not configured

    let addresses = [server_conf.owner_address];
    if (server_conf.owner_public_address) {
        addresses.push(server_conf.owner_public_address);
    }
    return net_utils.dns_resolve(system_dns)
        .then(ip_address_table => {
            if (ip_address_table.some(r => addresses.indexOf(r) >= 0)) {
                monitoring_status.dns_name = "OPERATIONAL";
            } else {
                monitoring_status.dns_name = "FAULTY";
                Dispatcher.instance().alert('CRIT',
                    system_store.data.systems[0]._id,
                    `Server DNS name ${system_dns} does not point to this server's IP`,
                    Dispatcher.rules.once_daily);
            }
        })
        .catch(err => {
            monitoring_status.dns_name = "UNKNOWN";
            Dispatcher.instance().alert('CRIT',
                system_store.data.systems[0]._id,
                `Server DNS name ${system_dns} could not be resolved`,
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
    //Alert on low disk space
    if (server_conf.heartbeat &&
        server_conf.heartbeat.health &&
        server_conf.heartbeat.health.storage &&
        server_conf.heartbeat.health.storage.free < 10 * 1024 * 1024 * 1024) { // Free is lower than 10GB
        Dispatcher.instance().alert('MAJOR',
            system_store.data.systems[0]._id,
            `Server ${server_conf.heartbeat.health.os_info.hostname} is running low on disk space, it is recommended
            to increase the disk size of the VM and then perform the increase option from the linux installer by logging into the machine with the noobaa user`,
            Dispatcher.rules.once_weekly);
    }
    return os_utils.handle_unreleased_fds();
}

async function _verify_and_update_public_ip() {
    dbg.log2('_verify_ip_vs_stun');
    //Verify what is the public IP of this server
    return net_utils.retrieve_public_ip()
        .catch(() => dbg.error('Failed retrieving public IP address'))
        .then(public_ip => {
            //If public IP can be deduced => if different then internal update owner_public_address
            if (public_ip &&
                server_conf.owner_address !== public_ip &&
                server_conf.owner_public_address !== public_ip) {
                return system_store.make_changes({
                        update: {
                            clusters: [{
                                _id: server_conf._id,
                                owner_public_address: public_ip
                            }]
                        }
                    })
                    .catch(() => dbg.error('Failed updating public IP address'));
            }
        });
}

// EXPORTS
exports.run = run;
