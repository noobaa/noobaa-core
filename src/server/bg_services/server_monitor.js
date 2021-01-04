/* Copyright (C) 2016 NooBaa */
'use strict';

const moment = require('moment');

const _ = require('lodash');
const dbg = require('../../util/debug_module')(__filename);
const os_utils = require('../../util/os_utils');
const Dispatcher = require('../notifications/dispatcher');
const server_rpc = require('../server_rpc');
const system_store = require('../system_services/system_store').get_instance();
const ssl_utils = require('../../util/ssl_utils');
const db_client = require('../../util/db_client');


const dotenv = require('../../util/dotenv');

let monitoring_status = {};

if (!process.env.PLATFORM) {
    console.log('loading .env file...');
    dotenv.load();
}

async function run() {
    dbg.log0('SERVER_MONITOR: BEGIN');
    monitoring_status = {
        dns_status: "OPERATIONAL",
        ph_status: {
            status: "OPERATIONAL",
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

    await system_store.refresh();
    await run_monitors();

    dbg.log0('SERVER_MONITOR: END. status:', monitoring_status);
    return {
        services: monitoring_status
    };
}

async function run_monitors() {
    const { CONTAINER_PLATFORM } = process.env;

    _check_dns_and_phonehome();
    await _check_internal_ips();
    await _verify_ssl_certs();
    await _check_db_disk_usage();
    await _check_address_changes(CONTAINER_PLATFORM);
}

function _check_dns_and_phonehome() {
    monitoring_status.dns_status = "OPERATIONAL";
    monitoring_status.ph_status = {
        status: "OPERATIONAL",
        test_time: moment().unix()
    };
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

async function _verify_ssl_certs() {
    dbg.log2('_verify_ssl_certs');
    const updated = await ssl_utils.update_certs_from_disk();
    if (updated) {
        dbg.log0('_verify_ssl_certs: SSL certificates changed, restarting relevant services');
        await os_utils.restart_services([
            'webserver'
        ]);
    }
}

async function _check_db_disk_usage() {
    dbg.log2('_check_db_disk_usage');
    const { fsUsedSize, fsTotalSize } = await db_client.instance().get_db_stats();
    if (fsTotalSize - fsUsedSize < 10 * (1024 ** 3)) { // Free is lower than 10GB
        Dispatcher.instance().alert(
            'MAJOR',
            system_store.data.systems[0]._id,
            `NooBaa DB is running low on disk space, it is recommended to increase the disk size of the persistent volume (PV) backing the database`,
            Dispatcher.rules.once_weekly
        );
    }
}

async function _check_address_changes(container_platform) {
    dbg.log2('_check_address_changes');
    try {
        const [system] = system_store.data.systems;
        const system_address = container_platform === 'KUBERNETES' ?
            await os_utils.discover_k8s_services() : [];

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
