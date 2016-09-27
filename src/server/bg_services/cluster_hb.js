'use strict';

const pkg = require('../../../package.json');
const system_store = require('../system_services/system_store').get_instance();
const os_utils = require('../../util/os_utils');
const dbg = require('../../util/debug_module')(__filename);
const MongoCtrl = require('../utils/mongo_ctrl');
const P = require('../../util/promise');

exports.do_heartbeat = do_heartbeat;


function do_heartbeat() {
    let current_clustering = system_store.get_local_cluster_info();
    if (current_clustering) {
        let heartbeat = {
            version: pkg.version,
            time: Date.now(),
            health: {
                os_info: os_utils.os_info(),
            }
        };
        return P.resolve().then(() => {
                if (current_clustering.is_clusterized) {
                    return MongoCtrl.get_mongo_rs_status();
                } else {
                    dbg.log0('server is not part of a cluster. skipping rs status');
                }
            })
            .then(mongo_status => {
                if (mongo_status) {
                    heartbeat.health.mongo_rs_status = mongo_status;
                }
                let update = {
                    _id: current_clustering._id,
                    heartbeat: heartbeat
                };
                dbg.log0('writing cluster server heartbeat to DB. heartbeat:', heartbeat);
                return system_store.make_changes({
                    update: {
                        clusters: [update]
                    }
                });
            })
            .return();
    } else {
        dbg.log0('no local cluster info. HB is not written');
    }
}
