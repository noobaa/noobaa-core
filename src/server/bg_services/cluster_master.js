'use strict';

const system_store = require('../system_services/system_store').get_instance();
const promise_utils = require('../../util/promise_utils');
const config = require('../../../config.js');
const dbg = require('../../util/debug_module')(__filename);
const MongoCtrl = require('../utils/mongo_ctrl');
const bg_workers_starter = require('../../bg_workers/bg_workers_starter');
const server_rpc = require('../server_rpc');
const auth_server = require('../common_services/auth_server');
const P = require('../../util/promise');

var is_cluster_master = false;

exports.background_worker = background_worker;

function background_worker() {
    if (!system_store.is_finished_initial_load) {
        dbg.log0('System did not finish initial load');
        return;
    }

    dbg.log0(`checking cluster_master`);

    let current_clustering = system_store.get_local_cluster_info();
    if (current_clustering && current_clustering.is_clusterized) {
        // TODO: Currently checks the replica set master since we don't have shards
        // We always need to send so the webserver will be updated if the
        return MongoCtrl.is_master()
            .then((is_master) => {
                if (!is_master.ismaster && is_cluster_master) {
                    dbg.log0(`this server was master before, but now is not. remove master workers`);
                    bg_workers_starter.remove_master_workers();
                } else if (is_master.ismaster && !is_cluster_master) {
                    dbg.log0(`this server is master now and wasn't before. start services in ${config.CLUSTER_MASTER_INTERVAL / 1000} seconds`);
                    // Used in order to disable race condition on master switch
                    promise_utils.delay_unblocking(config.CLUSTER_MASTER_INTERVAL)
                        .then(() => {

                            // Need to run the workers only if the server still master
                            if (system_store.is_cluster_master) {
                                dbg.log0(`still master - start services`);
                                return bg_workers_starter.run_master_workers();
                            }
                            dbg.log0(`not really master - will not start services`);
                        });
                }
                is_cluster_master = is_master.ismaster;
                dbg.log0(`sending master update - is_master = ${is_cluster_master}`);
                return send_master_update(is_cluster_master);
            })
            .catch((err) => {
                dbg.log0(`got error: ${err}. retry in 5 seconds`);
                return 5000;
            });
    } else if (!is_cluster_master) {
        dbg.log0('no local cluster info or server is not part of a cluster. therefore will be cluster master');
        return send_master_update(true)
            .then(() => {
                bg_workers_starter.run_master_workers();
                is_cluster_master = true;
            })
            .catch(err => {
                dbg.error('send_master_update had an error:', err.stack || err);
                return;
            });
    }
}

function send_master_update(is_master) {
    let system = system_store.data.systems[0];
    if (!system) return P.resolve();
    return P.fcall(function() {
            return server_rpc.client.system.set_webserver_master_state({
                is_master: is_master
            }, {
                auth_token: auth_server.make_auth_token({
                    system_id: system._id,
                    role: 'admin'
                })
            });
        })
        .return();
}
