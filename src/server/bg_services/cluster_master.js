/* Copyright (C) 2016 NooBaa */
'use strict';

// var _ = require('lodash');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config.js');
const system_store = require('../system_services/system_store').get_instance();
const promise_utils = require('../../util/promise_utils');
const MongoCtrl = require('../utils/mongo_ctrl');
const bg_workers = require('../bg_workers');
// const server_rpc = require('../server_rpc');
// const auth_server = require('../common_services/auth_server');
const cutil = require('../utils/clustering_utils');

var is_cluster_master = false;
let cluster_master_retries = 0;
const RETRY_DELAY = 5000;
const MAX_RETRIES = 4;

exports.background_worker = background_worker;

function background_worker() {
    if (!system_store.is_finished_initial_load) {
        dbg.log0('System did not finish initial load');
        return;
    }

    dbg.log2(`checking cluster_master`);

    let current_clustering = system_store.get_local_cluster_info();
    if (current_clustering && current_clustering.is_clusterized) {
        // TODO: Currently checks the replica set master since we don't have shards
        // We always need to send so the webserver will be updated if the
        return P.resolve()
            .then(() => MongoCtrl.is_master())
            .then(is_master => {
                if (!is_master.ismaster && is_cluster_master) {
                    dbg.log0(`this server was master before, but now is not. remove master workers`);
                    bg_workers.remove_master_workers();
                } else if (is_master.ismaster && !is_cluster_master) {
                    dbg.log0(`this server is master now and wasn't before. start services in ${config.CLUSTER_MASTER_INTERVAL / 1000} seconds`);
                    // Used in order to disable race condition on master switch
                    promise_utils.delay_unblocking(config.CLUSTER_MASTER_INTERVAL)
                        .then(() => {

                            // Need to run the workers only if the server still master
                            if (is_cluster_master) {
                                dbg.log0(`still master - start services`);
                                return bg_workers.run_master_workers();
                            }
                            dbg.log0(`not really master - will not start services`);
                        });
                }
                is_cluster_master = is_master.ismaster;
                dbg.log1(`sending master update - is_master = ${is_cluster_master}`);
                cluster_master_retries = 0;
                return cutil.send_master_update(is_cluster_master, is_master.master_address);
            })
            .catch(err => {
                if (cluster_master_retries > MAX_RETRIES && is_cluster_master) {
                    dbg.error(`number of retries exceeded ${MAX_RETRIES}. step down as master if was master before`);
                    // step down after MAX_RETRIES
                    is_cluster_master = false;
                    bg_workers.remove_master_workers();
                    cutil.send_master_update(is_cluster_master);
                }
                cluster_master_retries += 1;
                dbg.error(`got error: ${err}. retry in 5 seconds`);
                return RETRY_DELAY;

            });
    } else {
        dbg.log0('no local cluster info or server is not part of a cluster. therefore will be cluster master');
        return cutil.send_master_update(true)
            .then(() => {
                if (!is_cluster_master) {
                    bg_workers.run_master_workers();
                    is_cluster_master = true;
                }
            })
            .catch(err => {
                dbg.error('send_master_update had an error:', err.stack || err);
            });
    }
}
