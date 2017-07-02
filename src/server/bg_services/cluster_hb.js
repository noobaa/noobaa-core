/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const os = require('os');

const P = require('../../util/promise');
const pkg = require('../../../package.json');
const dbg = require('../../util/debug_module')(__filename);
const os_utils = require('../../util/os_utils');
const MongoCtrl = require('../utils/mongo_ctrl');
const Dispatcher = require('../notifications/dispatcher');
const system_store = require('../system_services/system_store').get_instance();
const server_monitor = require('./server_monitor');
const clustering_utils = require('../utils/clustering_utils');

exports.do_heartbeat = do_heartbeat;

/**
 *
 * CLUSTER_HB
 *
 * background worker saved cluster HB for each server on the cluster
 *
 * @this worker instance
 *
 */
function do_heartbeat() {
    let current_clustering = system_store.get_local_cluster_info();
    let server_below_min_req = false;
    let server_name;
    if (current_clustering) {
        let heartbeat = {
            version: pkg.version,
            time: Date.now(),
            health: {
                usage: 0
            }
        };
        return P.resolve()
            .then(() => os_utils.os_info(true)
                .then(os_info => {
                    heartbeat.health.os_info = os_info;
                    heartbeat.health.usage = _calc_cpu_usage(this.cpu_info);
                    this.cpu_info = os_info.cpu_info;
                }))
            .then(() => P.join(
                P.resolve()
                .then(() => {
                    if (current_clustering.is_clusterized) {
                        return MongoCtrl.get_hb_rs_status();
                    } else {
                        dbg.log0('server is not part of a cluster. skipping rs status');
                    }
                }),
                os_utils.read_drives(),
                os_utils.get_raw_storage()))
            .spread((mongo_status, drives, raw_storage) => {
                let root = drives.find(drive => drive.mount === '/');
                if (root) {
                    root.total = raw_storage;
                }
                return {
                    mongo_status: mongo_status,
                    storage: root.storage
                };
            })
            .then(info => {
                if (info.mongo_status) {
                    heartbeat.health.mongo_rs_status = info.mongo_status;
                }
                if (info.storage) {
                    heartbeat.health.storage = info.storage;
                }
                let update = {
                    _id: current_clustering._id,
                    heartbeat: heartbeat
                };
                //Check if server is below minimum requirements
                let min_requirements = clustering_utils.get_min_requirements();
                if (info.storage.total < min_requirements.storage ||
                    heartbeat.health.os_info.totalmem < min_requirements.ram ||
                    heartbeat.health.os_info.cpus.length < min_requirements.cpu_count) {
                    server_below_min_req = true;
                    server_name = heartbeat.health.os_info.hostname;
                }
                dbg.log0('writing cluster server heartbeat to DB. heartbeat:', heartbeat);
                return server_monitor.run()
                    .then(status => {
                        update.services_status = status;
                        return system_store.make_changes({
                            update: {
                                clusters: [update]
                            }
                        });
                    });
            })
            .then(() => {
                if (server_below_min_req) {
                    let name = server_name + '-' + current_clustering.owner_secret;
                    return Dispatcher.instance().alert('MAJOR',
                        system_store.data.systems[0]._id,
                        `Server ${name} configuration is below minimum requirements, consult server page for more information`,
                        Dispatcher.rules.only_once_by_regex(
                            `^Server .*${current_clustering.owner_secret} configuration is below minimum requirements, consult server page for more information$`
                        ));
                }
                return P.resolve();
            })
            .return();
    } else {
        dbg.log0('no local cluster info. HB is not written');
        return P.resolve();
    }
}

function _calc_cpu_usage(cpus_info) {
    let workset = os.cpus();
    if (cpus_info) {
        for (let i = 0; i < workset.length; ++i) {
            if (cpus_info[i]) {
                _.keys(cpus_info[i].times).forEach(key => {
                    workset[i].times[key] -= cpus_info[i].times[key];
                });
            }
        }
    }

    let usage = 0;
    for (let i = 0; i < workset.length; ++i) {
        let total = 0;
        _.keys(workset[i].times).forEach(key => {
            total += workset[i].times[key];
        });
        usage += (total - workset[i].times.idle) / total;
    }
    return usage;
}
