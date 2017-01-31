'use strict';

const pkg = require('../../../package.json');
const system_store = require('../system_services/system_store').get_instance();
const os_utils = require('../../util/os_utils');
const dbg = require('../../util/debug_module')(__filename);
const MongoCtrl = require('../utils/mongo_ctrl');
const P = require('../../util/promise');
const server_monitor = require('./server_monitor');

exports.do_heartbeat = do_heartbeat;


function do_heartbeat() {
    let current_clustering = system_store.get_local_cluster_info();
    if (current_clustering) {
        let heartbeat = {
            version: pkg.version,
            time: Date.now(),
            health: {}
        };
        return P.resolve()
            .then(() => os_utils.os_info(true)
                .then(os_info => {
                    heartbeat.health.os_info = os_info;
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
                os_utils.read_drives()))
            .spread((mongo_status, drives) => {
                let root = drives.find(drive => drive.mount === '/');
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
            .return();
    } else {
        dbg.log0('no local cluster info. HB is not written');
        return P.resolve();
    }
}
