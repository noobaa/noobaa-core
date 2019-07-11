/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const os = require('os');
const moment = require('moment');

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const os_utils = require('../../util/os_utils');
const fs_utils = require('../../util/fs_utils');
const ssl_utils = require('../../util/ssl_utils');
const Dispatcher = require('../notifications/dispatcher');
const server_rpc = require('../server_rpc');
const system_store = require('../system_services/system_store').get_instance();
const promise_utils = require('../../util/promise_utils');
const phone_home_utils = require('../../util/phone_home');
const config_file_store = require('../system_services/config_file_store').instance();
const clustering_utils = require('../utils/clustering_utils.js');

const dotenv = require('../../util/dotenv');

let server_conf = {};
let monitoring_status = {};
let ip_collision = [];

if (!process.env.PLATFORM) {
    console.log('loading .env file...');
    dotenv.load();
}

async function run() {
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

    await system_store.refresh();
    await run_monitors();

    dbg.log0('SERVER_MONITOR: END. status:', monitoring_status);
    return {
        services: monitoring_status,
        ip_collision
    };
}

async function run_monitors() {
    const { CONTAINER_PLATFORM } = process.env;
    const os_type = os.type();
    const is_master = clustering_utils.check_if_master();

    await _verify_server_certificate();
    await _check_dns_and_phonehome();
    await _check_internal_ips();
    await _check_disk_space();

    if (os_type === 'Linux') {
        await _check_for_duplicate_ips();
    }

    // Address auto detection should only run on master machine.
    if (is_master) {
        await _check_address_changes(CONTAINER_PLATFORM);
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

function _are_platform_and_cluster_conf_equal(platform_conf, cluster_conf) {
    platform_conf = _.omitBy(platform_conf, _.isEmpty);
    cluster_conf = _.omitBy(cluster_conf, _.isEmpty);
    return (_.isEmpty(platform_conf) && _.isEmpty(cluster_conf)) || // are they both either empty or undefined
        _.isEqual(platform_conf, cluster_conf); // if not, are they equal
}

function _check_dns_and_phonehome() {
    dbg.log2('_check_dns_and_phonehome');
    return phone_home_utils.verify_connection_to_phonehome()
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

async function _check_address_changes(container_platform) {
    dbg.log2('_check_address_changes');
    try {
        const [system] = system_store.data.systems;
        const system_address = container_platform === 'KUBERNETES' ?
            await os_utils.discover_k8s_services() :
            await os_utils.discover_virtual_appliance_address();

        // This works because the lists are always sorted, see discover_k8s_services().
        if (!_.isEqual(system.system_address, system_address)) {
            await system_store.make_changes({
                update: {
                    systems: [{
                        _id: system.id,
                        $set: { system_address }
                    }]
                }
            });
        }
    } catch (err) {
        dbg.error('Trying to discover address changes failed');
    }
}

// EXPORTS
exports.run = run;
