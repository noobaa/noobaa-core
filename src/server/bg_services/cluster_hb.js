/* Copyright (C) 2016 NooBaa */
'use strict';

const os = require('os');

const P = require('../../util/promise');
const pkg = require('../../../package.json');
const dbg = require('../../util/debug_module')(__filename);
const os_utils = require('../../util/os_utils');
const Dispatcher = require('../notifications/dispatcher');
const size_utils = require('../../util/size_utils');
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
function do_heartbeat({ skip_server_monitor } = {}) {
    let current_clustering = system_store.get_local_cluster_info();
    let server_below_min_req = false;
    let server_name;
    if (current_clustering) {
        let heartbeat = {
            version: pkg.version,
            time: Date.now(),
            health: {
                usage: 0
            },
        };
        return P.resolve()
            .then(() => os_utils.os_info()
                .then(os_info => {
                    heartbeat.health.os_info = os_info;
                    //Adjust tolerance of minimum RAM requirement to 1 GB below actual minimum
                    const min_ram = clustering_utils.get_min_requirements().ram;
                    if (heartbeat.health.os_info.totalmem < (min_ram + size_utils.GIGABYTE) &&
                        heartbeat.health.os_info.totalmem >= min_ram) {
                        heartbeat.health.os_info.totalmem = min_ram;
                    }
                    heartbeat.health.usage = os_utils.calc_cpu_usage(os.cpus(), this.cpu_info);
                    this.cpu_info = os_info.cpu_info;
                }))
            .then(() => Promise.all([
                os_utils.read_drives(),
                os_utils.get_raw_storage()
            ]))
            .then(([drives, raw_storage]) => {
                let root = drives.find(drive => drive.mount === '/');
                if (root) {
                    root.storage.total = raw_storage;
                }
                return {
                    storage: root && root.storage
                };
            })
            .then(info => {
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
                return P.resolve()
                    .then(() => {
                        if (!skip_server_monitor) {
                            return server_monitor.run();
                        }
                    })
                    .then(status => {
                        if (status) {
                            update.services_status = status.services;
                        }
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
                        `Server ${name} configuration is below minimum requirements. This can result in overall performance issues,
                         especially on internal storage performance. Consult server page for more information.`,
                        Dispatcher.rules.only_once_by_regex(
                            `^Server .*${current_clustering.owner_secret} configuration is below minimum requirements.*`
                        ));
                }
                return P.resolve();
            })
            .then(() => {
                // return nothing. 
            });
    } else {
        dbg.log0('no local cluster info. HB is not written');
        return P.resolve();
    }
}
